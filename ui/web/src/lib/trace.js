// Diagnostic tracing, off by default and switchable without a rebuild.
//
// ★ Why this is a gate and not a delete.
//
// The `[ff-trace]` lines are what ended a multi-round stuck-banner hunt on
// 2026-09-25/26. Four patches were aimed by inference and none of them landed;
// printing the Rust process lifecycle and the busy-registry contents named the
// fault in three lines. Deleting that on the way to a release would mean
// rebuilding it the next time, from memory, under pressure.
//
// But it must not be ON by default. `console.warn` on every registry change
// is loud enough to bury a real warning, and a user reading their own console
// should not have to tell our noise from their problem.
//
// So: off unless asked. From the app's console, `ffTrace(true)` and reproduce
// -- no rebuild, no dev server, works in a packaged build. The Rust half has
// the same switch as `FF_TRACE=1` in the environment.

const KEY = 'ff.trace';

function read() {
  try {
    if (localStorage.getItem(KEY) === '1') return true;
  } catch {
    // Private windows, blocked site data, and the test environment all throw
    // here. A diagnostic flag is never worth breaking a render over.
  }
  return import.meta.env?.VITE_FF_TRACE === '1';
}

let enabled = read();

/** Whether tracing is currently on. */
export function traceEnabled() {
  return enabled;
}

/**
 * Turn tracing on or off for this browser, persistently.
 *
 * Exposed as `window.ffTrace` so a stuck app can be instrumented from its own
 * console: `ffTrace(true)`, reproduce, read the log. Returns the new state so
 * the console prints confirmation.
 */
export function setTrace(on) {
  enabled = !!on;
  try {
    if (enabled) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Not persisted, but live for this session -- still useful.
  }
  return enabled;
}

/** Log a `[ff-trace]` line, or nothing at all when tracing is off. */
export function trace(...args) {
  if (!enabled) return;
  console.log('[ff-trace]', ...args);
}

if (typeof window !== 'undefined') {
  window.ffTrace = setTrace;
}
