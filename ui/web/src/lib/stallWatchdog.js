// A watchdog for a backend call that can stop answering without failing.
//
// ★ The incident this exists for (dogfood 2026-09-25): an analyze ran to
// completion -- assessment.json and phrases.json on disk, every stage event
// delivered, the Python process exited -- and the UI still read "Analyzing…"
// six minutes later. The `await` never settled, so the `finally` that clears
// the busy banner never ran, and the footer claimed "in progress" on every
// tab. Nothing was wrong on disk; the UI was simply waiting forever for a
// reply that was never going to arrive.
//
// IPC delivery is not guaranteed. Tauri's own event layer leaks listeners
// (`unregisterListener` is dead code in 2.11), and a dropped response
// callback leaves an un-settleable Promise with no error, no rejection and no
// timeout. A Promise that never settles is indistinguishable from slow work,
// so nothing downstream can recover on its own.
//
// ★ The rule that makes this safe: measure silence since the LAST PROGRESS
// EVENT, not elapsed time since the start. Analysis legitimately runs for
// many minutes, and the chapter-clip tail can be quiet for a while, so a
// wall-clock timeout would abort healthy work. Silence means the backend
// stopped talking to us, which is the actual failure.
//
// This does NOT cancel the backend. The work may well have finished; we only
// stop pretending we are still waiting, and say so in terms the user can act
// on.

export class StallError extends Error {
  constructor(message, { silentMs } = {}) {
    super(message);
    this.name = 'StallError';
    this.stalled = true;
    this.silentMs = silentMs;
  }
}

/** Default: the backend has said nothing for three minutes. */
export const DEFAULT_STALL_MS = 180000;

/**
 * Has the backend gone quiet long enough to give up on it?
 *
 * @param lastEventAt  ms timestamp of the last progress event, or null
 * @param startedAt    ms timestamp the call began
 * @param now          current ms timestamp
 * @param stallMs      silence budget
 */
export function isStalled({ lastEventAt, startedAt, now, stallMs = DEFAULT_STALL_MS }) {
  const last = lastEventAt ?? startedAt;
  if (last == null || now == null) return false;
  return now - last >= stallMs;
}

/**
 * Wrap a pending call so it rejects with StallError once the backend has been
 * silent for `stallMs` — instead of hanging forever.
 *
 * `getLastEventAt()` is supplied by the caller because only it knows which
 * progress channel belongs to this operation; a ref updated by the progress
 * subscription is the intended shape.
 *
 * The returned Promise settles exactly once, and the poll timer is always
 * cleared — including when the underlying call rejects.
 */
export function withStallTimeout(promise, {
  getLastEventAt,
  startedAt = Date.now(),
  stallMs = DEFAULT_STALL_MS,
  pollMs = 5000,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onStall,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearIntervalFn(timer);
      fn(value);
    };
    const timer = setIntervalFn(() => {
      const lastEventAt = getLastEventAt?.() ?? null;
      const n = now();
      if (!isStalled({ lastEventAt, startedAt, now: n, stallMs })) return;
      const silentMs = n - (lastEventAt ?? startedAt);
      onStall?.(silentMs);
      finish(reject, new StallError(
        'Lost contact with the analyzer. It stopped reporting progress, so we '
        + 'stopped waiting — the work may already have finished. Reopen the '
        + 'project to pick up whatever completed.',
        { silentMs },
      ));
    }, pollMs);
    promise.then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}
