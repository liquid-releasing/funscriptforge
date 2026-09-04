// Ownership rule for the shared footer busy banner.
//
// One banner is driven by many producers: App's own long operations (open,
// attach, import, revert) and every tab that runs something slow. They all
// clear it the same way — `setBusy(null)` in a `finally` — which clears
// whatever is CURRENT rather than what that producer set.
//
// That is fine until two overlap, and they do: a tab can unmount while its
// work is still in flight, resolve later, and clear a banner belonging to
// something else. Observed twice:
//
//   * an open/attach finishing after Analysis started, wiping the analysis
//     progress and leaving the footer claiming "ready to chain" mid-pipeline;
//   * arriving at Analysis from Generate, where Generate's outstanding work
//     landed a moment later and did the same — "skips into showing accept and
//     chain ... no longer showing the progress" (dogfood 2026-09-04).
//
// The rule: a banner remembers who set it, and only that owner may clear it.
// An unowned banner (legacy caller) stays clearable by anyone, so this can
// never wedge the banner permanently on.
//
// Extracted from App.jsx so it is testable — vitest never renders App, so
// logic left inline there is effectively unguarded.

/**
 * @param {object|null} prev  current busy value
 * @param {object|null} next  requested value; null/undefined means "clear"
 * @param {string} owner      who is asking
 * @returns {object|null} the new busy value
 */
export function applyBusyUpdate(prev, next, owner) {
  if (next == null) {
    // Refuse a clear from anyone other than the owner. An unowned banner is
    // clearable by anyone — otherwise a legacy caller could strand it.
    if (prev && prev.owner && prev.owner !== owner) return prev;
    return null;
  }
  return { ...next, owner };
}
