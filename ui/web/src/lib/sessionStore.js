// Per-project session — "where you left off" (active tab today; playhead /
// selection later). The single swap point for session persistence.
//
// v1 stores in localStorage keyed by the project's funscript path, so resume
// works with zero backend round-trip and zero recompile. The PORTABLE home is
// `<stem>.forge/session.json` (a small Rust read/write) so the session travels
// with the project and rides the `.forge`-as-document model — that's the
// immediate follow-up; only this file changes when we make the swap.

const PREFIX = 'ff.session.';
const keyFor = (path) => PREFIX + (path || '');

/** Read the saved session for a project funscript path, or null. */
export function loadSession(path) {
  if (!path) return null;
  try {
    const raw = localStorage.getItem(keyFor(path));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Persist the session for a project. `session` is a small plain object,
 *  e.g. { tab, at }. Non-fatal if storage is unavailable. */
export function saveSession(path, session) {
  if (!path || !session) return;
  try {
    localStorage.setItem(keyFor(path), JSON.stringify(session));
  } catch {
    /* storage full / disabled — resume is a convenience, never block on it */
  }
}
