# Backend startup latency — current state & the durable fix

_Written 2026-06-30, while closing the double-analyze release gate (D27a)._

## The problem (root cause)

The Tauri Rust bridge spawns a **fresh `cli.py` (or bundled `forge-cli`) process per
call** (`run_cli` → `cli_command` in `ui/web/src-tauri/src/commands.rs`). Every call
therefore re-imports the heavy scientific stack (`librosa` / `numba` / `scipy`,
pulled in at `cli.py` module top via `from assessment.analyzer import …`).

Measured (Prisoner, 67 min, 366 phrases, dev `.venv`):

| | cold OS file cache | warm |
|---|---|---|
| `cli.py --help` (import only) | **16.8 s** | **0.70 s** |
| assess, full recompute | 27 s | 10 s |
| assess, cached fast-path | 18 s | **~1.0 s** |

The ~15–17 s is **cold OS filesystem cache** (first read of miniconda's huge
package trees after boot/eviction), NOT a persistent per-call cost. Once warm,
a spawn is sub-second. The unavoidable floor: the *first* real analysis in a
session needs `librosa`, so it pays the cold read once — no architecture removes
that, only hiding it (prewarm) helps.

## What we shipped instead (good enough for the release gate)

1. **Double-analyze cache (D27a)** — `cmd_assess` reuses a fresh
   `<stem>.phrases.json` sidecar instead of re-running the analyzer; correct
   invalidation on funscript/chapters mtime. Re-entry: **~1 s warm**. Commit
   `7c6246b`.
2. **Launch prewarm** — `cli.py warmup` (imports the stack + one tiny
   `librosa.stft` to warm numba JIT), fired **detached at app launch** from
   `lib.rs` setup via `commands::prewarm_backend()`. Absorbs the one-time
   cold-disk read in the background before the user clicks anything.

Net effect: the common path (analyze → re-enter Phrases) is ~1 s; cold-start
first-impression is masked by the prewarm.

## What we deliberately did NOT do — and why

**Lazy imports** (defer `assessment.analyzer` / `visualizations.motion` into the
functions that use them): rejected. It only helps the narrow cold-disk + cached
case, and it **silently regresses** — the next top-level `from assessment…` quietly
puts the heavy stack back on the fast path, and we're re-debugging "why is Phrases
slow" months later. A half-measure that needs ongoing discipline is the opposite
of "don't revisit."

## The durable fix — persistent forge-cli worker (do this when we revisit)

Replace per-call spawning with **one long-lived Python worker** started at app
launch, speaking JSON-RPC to the Rust bridge over stdin/stdout (or a local
socket). Import is paid **once per session**; every command after — analyze,
assess, viewer-load, stim/multiaxis, polish, export — is warm and sub-second,
cold disk or not. No per-subcommand import discipline, no logic duplicated into
Rust, no creeping regression surface.

### Sketch
- **Python side:** a `cli.py serve` (or `forge-cli serve`) loop: read one JSON
  request per line `{ "id", "cmd", "args" }`, dispatch through the existing
  `dispatch{}` table, write one JSON response line `{ "id", "ok", "result"|"error" }`.
  Keep `print()`-to-stdout commands honest by routing their payload through the
  response envelope (most already return a single JSON blob — reuse that).
- **Rust side:** spawn the worker once in `setup` (next to `prewarm_backend`),
  hold its stdin/stdout behind a `Mutex`/channel, and make `run_cli` write a
  request + await the matching `id` instead of spawning. Keep a per-request
  timeout.
- **Concurrency:** today commands run as independent processes (natural
  parallelism + cancellation). A single worker serializes them. Options: a small
  **pool** of N workers, or keep CPU-bound jobs (analyze/generate) as one-shot
  spawns and route only the *light* commands (assess-cached, viewer-load,
  list-*, read-*) through the worker. The light commands are exactly the ones
  where spawn overhead hurts, so worker-for-light + spawn-for-heavy is a clean
  split and sidesteps most concurrency pain.

### Interplay to respect
- **D7 reaping** (`ACTIVE_CHILDREN`, `reap_active_children`): the worker is a
  long-lived child — register it and kill it on window-destroy / app-exit like
  the others. CPU-bound one-shot spawns keep their current per-PID registration.
- **Latest-wins preview** (`PREVIEW_PIDS` superseding): if stim/multiaxis move
  into the worker, replace process-kill cancellation with an in-worker cancel
  token (request supersede by key). Until then, leave them as one-shot spawns.
- **Bundled build:** `forge-cli` is a PyInstaller onedir — `serve` must work
  frozen (no reliance on source-tree cwd beyond what `cli_invocation` already
  resolves).

### Risk / scope
Medium. Touches the bridge's core call path + every command's I/O contract.
Do it as its own branch with a command-by-command parity pass (every subcommand
returns identical bytes through the worker vs. a spawn).

## When to revisit (trigger conditions)
- Cold-start latency is a felt first-impression problem despite the prewarm
  (e.g. memory pressure from a big video decode evicts the package files and the
  next light call goes cold again — the prewarm only warms once).
- We add more light, frequently-called bridge commands where per-call spawn
  overhead is the bottleneck.
- We want cancellation/superseding semantics richer than process-kill.

Until one of those bites, the cache + prewarm hold. The persistent worker is the
one-and-done answer when they do.
