// Coalesce a burst of writes into one, without ever losing the last one.
//
// The Events tab persists `.feel.yml` on every discrete edit, and each write
// spawns a CLI process. Chaining events is the DESIGNED workflow — the end of
// one carries forward as the begin of the next — so authoring a run of events
// spawned one process per event and the tab went sluggish behind them
// (dogfood 2026-09-05).
//
// Debouncing a SAVE is only safe if two things hold, and both are the caller's
// responsibility to wire:
//
//   * every path that reads the file back flushes first, or it can observe a
//     sidecar that is a whole burst out of date;
//   * unmount flushes, or leaving the tab mid-burst silently drops the last
//     edits the user made.
//
// A pending write that never lands is the same bug as a failed one, which is
// why this lives in its own module with tests rather than inline in a screen —
// vitest never renders those, so logic left there is unguarded. Same reason
// busyOwner.js and chainGate.js exist.

/**
 * @param {(payload: any) => Promise<any>} write  performs the real write
 * @param {number} delayMs  quiet period before an idle burst is written
 * @returns {{schedule: (p:any)=>void, flush: ()=>Promise<any>, hasPending: ()=>boolean}}
 */
export function createCoalescedWriter(write, delayMs = 600) {
  let timer = null;
  let pending = null;
  let hasPendingValue = false;

  // Take whatever is queued and write it. Safe to call with nothing queued —
  // callers use flush() defensively before reads, where "nothing to do" is the
  // common case and must not turn into a spurious write.
  function fire() {
    if (!hasPendingValue) return Promise.resolve();
    const payload = pending;
    pending = null;
    hasPendingValue = false;
    return Promise.resolve(write(payload));
  }

  return {
    // Queue a write. Each call REPLACES the queued payload: callers pass the
    // whole collection, so the last one is the only correct thing to persist.
    schedule(payload) {
      pending = payload;
      hasPendingValue = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, delayMs);
    },

    // Write anything outstanding NOW, and resolve when it lands. Call before
    // reading the file back, and on unmount.
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return fire();
    },

    // Mainly for tests and diagnostics: is a write still owed?
    hasPending() {
      return hasPendingValue;
    },
  };
}
