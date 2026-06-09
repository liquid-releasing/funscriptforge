# OSS Integration Pattern

> This document describes the standard pattern used across the liquid-releasing
> project suite for integrating open-source tools. It lives here as a worked
> example and should be copied into FunscriptForge as the canonical reference.

---

## The Problem

Open-source projects change. When you build a UI directly on top of someone
else's classes and config structures, every upstream update is a potential
breaking change scattered across your entire codebase.

## The Solution: Fork → Adapter → UI

```
upstream repo          your fork
──────────────         ─────────────────────────────────────────────────────
processor.py           cli.py (adapter)  ──►  Tauri/React desktop app
funscript.py  ──────►  stable API        ──►  (future) HTTP/web server
config.py                                ──►  CLI / scripts / CI
```

`cli.py` is the **adapter** — it translates between the upstream API and a
stable contract that all front-ends bind to. When upstream changes, you fix
`cli.py`. The front-ends never change.

### Deployment targets, one adapter

| Target | UI layer | How it runs |
|--------|----------|-------------|
| Desktop (Windows-first) | Tauri + React app in `ui/web/` | Rust shell spawns `cli.py` (dev) or the frozen `forge-cli` (packaged) per call |
| SaaS (future) | Same React build | React → HTTP server wrapping `cli.py` |
| CLI / CI | none | `python cli.py <command>` directly |

The Rust shell calls `cli.py` over stdin/stdout JSON — it never imports upstream
Python. Whether the front-end is the desktop app, a future web server, or a CI
script, they all call the exact same `cli.py` functions.

### What cli.py must return

Because the front-end (React) renders the output, `cli.py` must only return types
that serialize cleanly to JSON and stay UI-framework agnostic:
- `dict`, `list`, `str`, `Path`
- `numpy` arrays serialized to plain lists (for waveform / chart data)
- Simple dataclasses
- **Never:** UI-toolkit objects, upstream class instances, open file handles

---

## Steps to add a new OSS integration

### 1. Fork and clone

```bash
gh repo fork <upstream-url> --clone=false
git clone https://github.com/liquid-releasing/<repo>.git
cd <repo>
git remote add upstream <original-url>
git remote -v  # verify both origin and upstream
```

### 2. Build `cli.py` — your adapter

Design the stable functions *you* want to expose before writing any UI:

```python
# cli.py — the only file the UI ever imports from

def load_file(path: str) -> dict:
    """Load source file. Returns simple dict, never an upstream object."""
    ...

def get_default_config() -> dict:
    """Return default config as a plain dict."""
    ...

def process(path: str, config: dict, on_progress=None) -> list[dict]:
    """Run the pipeline. Returns list of {suffix, path} dicts."""
    ...

def list_outputs(directory: str, stem: str) -> list[dict]:
    """Find generated output files. Returns list of {suffix, path} dicts."""
    ...
```

Rules for `cli.py`:
- **Only file the UI imports from** — never import upstream classes in the UI
- **Returns simple types** — `dict`, `list`, `str`, `Path` — never upstream objects
- **Owns the config structure** — wrap/translate upstream config internally
- **One file** — all upstream interaction in one place

### 3. Build the front-end on top of `cli.py`

The React app never imports Python at all — it calls `cli.py` subcommands through
the Rust bridge (`ui/web/src/api/forge.js` → `src-tauri/src/commands.rs`). Inside
the Python codebase, any module that drives the pipeline imports **only** from
`cli.py`:

```python
from cli import load_file, process, get_default_config   # ✓ only this

# Never:
# from processor import RestimProcessor                  # ✗
# from funscript import Funscript                        # ✗
```

### 4. Pull upstream updates

```bash
git fetch upstream
git merge upstream/main
```

If it breaks: the error is in `cli.py`. Fix the translation there. UI untouched.

### 5. Add to FunscriptForge as a tab

Because the front-end calls `cli.py` — not upstream internals — wiring a new
integration into FunscriptForge means:
1. Expose the operation as a `cli.py` subcommand returning JSON
2. Add a thin Rust command in `src-tauri/src/commands.rs` that spawns it
3. Add a React tab/screen that calls it through `forge.js` — no upstream code touched

---

## Worked Example: funscript-tools

| File | Role |
|------|------|
| `processor.py` | edger477's processing engine — **never imported by the front-end** |
| `cli.py` | adapter exposing `load_file`, `process`, `get_default_config` |
| `ui/web/` (React) | tab-based workflow UI — calls `cli.py` via the Rust bridge only |

Upstream repo: https://github.com/edger477/funscript-tools
Our fork: https://github.com/liquid-releasing/funscript-tools

---

## Why this matters for the whole suite

Every tool in the liquid-releasing ecosystem that wraps OSS follows this pattern:

```
funscript-tools  →  cli.py  →  FunscriptForge tab
[next tool]      →  cli.py  →  FunscriptForge tab
[next tool]      →  cli.py  →  FunscriptForge tab
```

FunscriptForge becomes the unified UI. Each `cli.py` is an independently
versioned, independently testable adapter. The UI is just tabs.
