// Recover a backend call whose reply was lost, using the event channel.
//
// ★ The measured fault (2026-09-25). `run_cli_with_progress` logged
//
//     [ff-trace] phrases child exited status=Some(0)
//     [ff-trace] phrases poller joined
//     [ff-trace] phrases returning 5016 bytes
//
// and the JS promise from `invoke('analyze_phrases', …)` never settled. The
// UI sat on "Analyzing…" until a 3-minute watchdog released it. Python had
// exited, the results were on disk, and 5 KB of JSON had been handed back —
// the reply simply never arrived.
//
// ★ What makes a fix possible: during that SAME command every progress event
// was delivered, which is how all six stage ticks appeared. Tauri's event
// system was healthy while the invoke callback was not. So Rust now announces
// completion on the operation's progress channel, and this turns that
// announcement into a usable result.
//
// This is deliberately NOT another timeout. A timeout guesses how long is too
// long; this waits for the backend to say it finished, then reads what it
// wrote. `stallWatchdog.js` remains underneath as the last resort for the case
// where even the events stop.

/** Default grace after "the backend says it finished" before we stop waiting
 *  for a reply that is evidently not coming. Long enough for a healthy reply
 *  to win the race; short enough that nobody calls it a hang. */
export const DEFAULT_GRACE_MS = 2000;

/**
 * Settle `promise`, or recover from disk if the backend announces completion
 * and the reply does not arrive shortly after.
 *
 * @param promise    the in-flight invoke
 * @param subscribe  (onComplete) => unsubscribe. Calls `onComplete(exitCode)`
 *                   when the operation's completion event arrives.
 * @param recover    () => Promise<result>, e.g. read the sidecar the command
 *                   already wrote. Only called when the reply is missing.
 * @param graceMs    how long to wait for the reply after completion
 * @param onRecover  optional notice that the fallback fired — worth logging,
 *                   since it means the IPC reply was lost
 *
 * Guarantees: settles exactly once; always unsubscribes and clears its timer;
 * a non-zero exit code is treated as failure and never recovered from.
 */
export function withCompletionFallback(promise, {
  subscribe,
  recover,
  graceMs = DEFAULT_GRACE_MS,
  onRecover,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (typeof subscribe !== 'function' || typeof recover !== 'function') {
    return promise;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let unsubscribe = null;

    const cleanup = () => {
      if (timer != null) { clearTimeoutFn(timer); timer = null; }
      if (typeof unsubscribe === 'function') { unsubscribe(); unsubscribe = null; }
    };
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(v);
    };

    const onComplete = (exitCode) => {
      // Already finished, or a second announcement — nothing to do.
      if (settled || timer != null) return;
      // A failed command has nothing worth recovering: the sidecar it would
      // have written is missing or half-written. Let the real rejection land,
      // or the watchdog underneath give up.
      if (exitCode != null && Number(exitCode) !== 0) return;
      timer = setTimeoutFn(() => {
        if (settled) return;
        Promise.resolve()
          .then(() => { onRecover?.(); return recover(); })
          .then((v) => finish(resolve, v), (e) => finish(reject, e));
      }, graceMs);
    };

    try {
      unsubscribe = subscribe(onComplete);
    } catch {
      // Cannot subscribe (no Tauri, listener failed) — degrade to the plain
      // promise rather than failing the call.
    }

    promise.then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}

/**
 * Does this parsed progress line announce that `op` finished?
 *
 * Rust emits `end::0::<op>::<exitCode>`. Depth 0 keeps it invisible to the
 * stage maps, which all require depth 2.
 *
 * @returns the exit code when it matches, else null
 */
export function completionExitCode(parsed, op) {
  if (!parsed || parsed.kind !== 'end' || parsed.leaf !== op) return null;
  const code = parseInt(parsed.rest, 10);
  return Number.isFinite(code) ? code : 0;
}
