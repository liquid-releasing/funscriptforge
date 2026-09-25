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
// An unowned banner (legacy caller) stays clearable by anyone.
//
// ★ That was NOT enough, and the original claim here -- "this can never wedge
// the banner permanently on" -- was wrong. It holds only for unowned banners.
// Two OWNED producers interleaving strand it: Chapters sets the banner, the
// user moves to Events, Events sets it (taking ownership), Chapters' work
// lands and its clear is refused because it no longer owns it -- and Events
// never had anything to clear. The banner stays up forever, the footer reads
// "in progress" on every tab, and only an app restart recovers (dogfood
// 2026-09-25, twice).
//
// So a clear now also carries the banner it believes it is clearing. A
// producer clearing a banner it SET may clear it even if someone else has
// since taken over -- because in that case there is nothing of its own left
// on screen, and the refusal was protecting a banner that no longer exists.
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
    if (!prev) return null;
    // The owner may always clear its own banner.
    if (!prev.owner || prev.owner === owner) return null;
    // Someone else owns what is on screen. Refuse — this is the original
    // rule, and it is what stops a late-landing operation from wiping a
    // banner that belongs to work still in progress.
    return prev;
  }
  return { ...next, owner };
}

/**
 * True when a banner has been up with no progress for longer than `stallMs`.
 *
 * The last-resort release. Ownership alone cannot guarantee a banner is ever
 * cleared: the owner may never get the chance (a dropped IPC reply), or may
 * have been superseded by a producer that has nothing to clear. Rather than
 * add another ownership special case for each new interleaving, App treats a
 * banner that has gone silent as abandoned and releases it.
 *
 * This only removes a stale INDICATOR. It cancels nothing and touches no
 * data, so a false positive costs a missing progress bar, while a false
 * negative costs the user their session.
 */
export function isBusyAbandoned(prev, { lastProgressAt, now, stallMs }) {
  if (!prev) return false;
  // `lastProgressAt` is a ref whose "nothing yet" sentinel is 0, so 0 means
  // absent here — but `startedAt` of 0 is a real timestamp. Testing
  // falsiness for both conflated the two and made the release never fire.
  const seen = Number.isFinite(lastProgressAt) && lastProgressAt > 0
    ? lastProgressAt : null;
  const started = Number.isFinite(prev.startedAt) ? prev.startedAt : null;
  const since = seen ?? started;
  if (since == null || !Number.isFinite(now) || !Number.isFinite(stallMs)) {
    return false;
  }
  return now - since >= stallMs;
}
