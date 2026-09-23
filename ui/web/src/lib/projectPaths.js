// Path helpers for the Project tab's file list.
//
// These were inline in ProjectTab.jsx. They moved here when the tab grew a
// visible project-folder row (dogfood 2026-09-23: "I do not see a way to
// easily find the path to the project from the project tab") — the tab had
// been running every path through `basename()` and showing bare filenames,
// with the only reveal button on the forge-dir row. The directory was
// already known; it was just never displayed.
//
// Pure string work, no Tauri, so the rules are testable without a webview.

// Projects opened from the bundled sample have a synthetic path that no
// file explorer can resolve. Every helper here treats it as "no path".
const SAMPLE_SCHEME = 'sample://';

/** True for synthetic/sample paths that must never reach a file explorer. */
export function isRevealablePath(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.startsWith(SAMPLE_SCHEME)) return false;
  return true;
}

/** Last path segment, for either separator. Returns '' for empty input. */
export function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[/\\]/);
  return parts[parts.length - 1] || String(p);
}

/**
 * The folder holding a path, or undefined when there isn't one we can show
 * (sample projects, bare filenames, drive roots).
 *
 * Accepts either a project object (reads `.path`) or a plain string so the
 * callers that already hold one or the other don't each need a branch.
 */
export function projectDirname(projectOrPath) {
  const path = typeof projectOrPath === 'object' && projectOrPath !== null
    ? projectOrPath?.path
    : projectOrPath;
  if (!isRevealablePath(path)) return undefined;
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return idx > 0 ? path.slice(0, idx) : undefined;
}

/**
 * Collapse a long path for display, keeping the head and the tail so both
 * the drive and the project folder stay readable.
 *
 * The full path still goes in `title=` on the element, so truncation never
 * costs the user the thing they came for.
 */
export function ellipsizePath(path, max = 56) {
  if (!path) return '';
  const s = String(path);
  if (s.length <= max) return s;
  // Keep the tail — the project folder is what identifies the project — and
  // enough of the head to show the drive/root.
  const tail = s.slice(-(max - 12));
  const head = s.slice(0, 9);
  return `${head}…${tail}`;
}
