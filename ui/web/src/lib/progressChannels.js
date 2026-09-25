// Progress event channels and payload parsing.
//
// Background — the bug this exists to close:
//
// `ff:progress` was ONE global Tauri event name. Seven Rust commands emitted
// to it and four React subscribers listened, and the payload carried no job
// identity. So every subscriber heard every operation. A generate's
// `start::2::<stage>` landed in the Analysis tab's stage map and set a stage
// `running` whose matching `done` belonged to a different run and never
// arrived — the dogfood report "I'm stuck in assessing phrases, which was
// not completed when analysis happened."
//
// Why this is a correctness problem and not just tidiness: `cli.py assess`
// emits stages with an IMPLICIT close — "the analyzer only emits one event
// per stage (no explicit completion), so the next start implicitly marks the
// prior stage done" (cli.py ~line 290). That protocol is stateful and
// sequential: it is only well-defined if every event on the channel comes
// from the same run. Multiplexing two operations onto one channel breaks it
// outright, because a foreign `start` silently reassigns what "the previous
// stage" means. Scoping is what makes the assess protocol correct at all.
//
// Polish and Export had already noticed and patched around it with
// `if (!line.includes('::'))` — "not the analyzer's structured lines, which
// may still be flowing from another tab." That heuristic only worked because
// those two commands happen to emit unstructured lines. Scoping the channel
// replaces the accident with a guarantee.
//
// Rust now emits every line twice: once on the global `ff:progress` (the
// app-wide busy footer, which genuinely wants everything) and once on
// `ff:progress:<op>`. The payload format is identical on both.
//
// ⚠ `OPS` and `progressChannel` must stay in lockstep with
// `scoped_progress_event` in src-tauri/src/commands.rs. Both sides have
// tests pinning the exact strings.

/** The global channel. App.jsx's always-mounted footer listener uses it. */
export const GLOBAL_PROGRESS_EVENT = 'ff:progress';

/**
 * Operation names, one per streaming Rust command. The value is the `op`
 * string that command passes to `run_cli_with_progress`.
 */
export const OPS = Object.freeze({
  ANALYZE: 'analyze',     // analyze_chapters_with_videoflow
  GENERATE: 'generate',   // generate_funscript
  AUDIO: 'audio',         // analyze_audio_peaks
  PHRASES: 'phrases',     // analyze_phrases  (cli.py assess)
  POLISH: 'polish',       // polish_apply
  EXPORT: 'export',       // export_write
  IMPORT: 'import',       // import_forge_bundle
  REFRESH: 'refresh',     // refresh_project (re-stamp stations + bundle)
});

/** Event name for one operation's progress. */
export function progressChannel(op) {
  return `${GLOBAL_PROGRESS_EVENT}:${op}`;
}

const PREFIX = 'progress: ';

/**
 * Parse one progress payload.
 *
 * Wire format is `<kind>::<depth>::<leaf>[::<rest>]`, optionally prefixed
 * with "progress: ". `rest` is whatever follows the leaf — a `done` summary
 * ("13 chapters detected") or a `msg` body — re-joined, because the Python
 * side can emit a body that itself contains `::`.
 *
 * Returns null for an empty payload. Unstructured lines (Polish/Export emit
 * plain human-readable strings) come back with depth 0 and the whole line as
 * `leaf`, which is what those tabs want to show.
 */
export function parseProgressLine(payload) {
  const raw = String(payload ?? '');
  const line = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
  if (!line) return null;
  const parts = line.split('::');
  // A single-token payload is an unstructured status line, not a stage
  // event: report it as the leaf so callers can show it verbatim.
  const structured = parts.length > 1;
  return {
    line,
    structured,
    kind: structured ? parts[0] : '',
    depth: structured ? (parseInt(parts[1] || '0', 10) || 0) : 0,
    leaf: structured ? (parts[2] || '') : parts[0],
    rest: structured ? parts.slice(3).join('::') : '',
  };
}
