// Remembered view state for the Library screen.
//
// ★ Why this exists: App renders the library as `{tab === 'library' &&
// <LibraryScreen/>}`, so leaving the tab UNMOUNTS it and every piece of its
// local state resets. Picking a library root, going to Viewer and coming back
// put the user on "all roots" again — reported 2026-09-25: "I go from viewer
// to the library, it does not remember that I had already chosen a library."
//
// Lifting the state to App would fix the tab switch but not an app restart,
// and these are per-viewer conveniences rather than project data, so they
// belong in browser storage.
//
// ⚠ localStorage can be empty or throw — private windows, cleared site data,
// thumbnail capture. Every read and write is guarded, and the defaults have to
// produce a correct screen on their own.

const KEY = 'ff.library.prefs.v1';

export const DEFAULT_PREFS = Object.freeze({
  activeRootPath: null,      // null = all roots merged
  statusFilter: 'all',
  sortKey: 'lastEdited',
});

/** Read remembered prefs. Always returns a usable object. */
export function loadLibraryPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
    return {
      activeRootPath: typeof parsed.activeRootPath === 'string'
        ? parsed.activeRootPath : null,
      statusFilter: typeof parsed.statusFilter === 'string'
        ? parsed.statusFilter : DEFAULT_PREFS.statusFilter,
      sortKey: typeof parsed.sortKey === 'string'
        ? parsed.sortKey : DEFAULT_PREFS.sortKey,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs. Never throws — failing to remember is not an error. */
export function saveLibraryPrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({
      activeRootPath: prefs?.activeRootPath ?? null,
      statusFilter: prefs?.statusFilter ?? DEFAULT_PREFS.statusFilter,
      sortKey: prefs?.sortKey ?? DEFAULT_PREFS.sortKey,
    }));
  } catch {
    /* storage unavailable — the screen still works, it just forgets */
  }
}

/**
 * ★ The load-bearing rule: only restore a root that is still configured.
 *
 * A remembered root the user has since removed — or an external drive that is
 * not mounted today — would otherwise select a root with no scan behind it,
 * and the library would render empty with no explanation. Falling back to
 * "all roots" shows them their library instead of a blank screen.
 *
 * @param savedPath        remembered root path, or null
 * @param configuredPaths  the roots currently in the library config
 * @returns the path to select, or null for "all roots"
 */
export function reconcileActiveRoot(savedPath, configuredPaths) {
  if (!savedPath) return null;
  const paths = Array.isArray(configuredPaths) ? configuredPaths : [];
  return paths.includes(savedPath) ? savedPath : null;
}
