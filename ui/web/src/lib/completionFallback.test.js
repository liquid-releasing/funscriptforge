import { describe, it, expect, vi } from 'vitest';
import {
  withCompletionFallback, completionExitCode, DEFAULT_GRACE_MS,
} from './completionFallback.js';
import { parseProgressLine } from './progressChannels.js';

// A rig that drives the completion event and the grace timer by hand, so the
// tests assert on ordering rather than on real time passing.
function rig() {
  let fire = null;
  let unsubscribed = 0;
  let pending = null;
  return {
    unsubscribed: () => unsubscribed,
    complete: (code = 0) => fire?.(code),
    tick: () => { const f = pending; pending = null; f?.(); },
    opts: (recover) => ({
      subscribe: (cb) => { fire = cb; return () => { unsubscribed += 1; }; },
      recover,
      setTimeoutFn: (fn) => { pending = fn; return 'timer'; },
      clearTimeoutFn: () => { pending = null; },
    }),
  };
}

describe('withCompletionFallback', () => {
  it('passes a normal reply straight through and unsubscribes', async () => {
    const r = rig();
    const recover = vi.fn();
    await expect(withCompletionFallback(Promise.resolve('reply'), r.opts(recover)))
      .resolves.toBe('reply');
    expect(recover).not.toHaveBeenCalled();
    expect(r.unsubscribed()).toBe(1);
  });

  it('passes a real rejection through', async () => {
    const r = rig();
    const boom = new Error('cli exited non-zero');
    await expect(withCompletionFallback(Promise.reject(boom), r.opts(vi.fn())))
      .rejects.toBe(boom);
  });

  it('★ recovers from disk when the reply is lost', async () => {
    // The measured fault: Rust returned 5016 bytes, the promise never settled.
    const r = rig();
    const never = new Promise(() => {});
    const recover = vi.fn().mockResolvedValue(['phrase-from-sidecar']);
    const p = withCompletionFallback(never, r.opts(recover));
    r.complete(0);          // backend announces it finished
    r.tick();               // grace elapses with no reply
    await expect(p).resolves.toEqual(['phrase-from-sidecar']);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(r.unsubscribed()).toBe(1);
  });

  it('★ lets a healthy reply win the race against the grace timer', async () => {
    // Completion normally arrives just BEFORE the reply. Recovering then would
    // replace a good result with a re-read for no reason.
    const r = rig();
    const recover = vi.fn();
    const p = withCompletionFallback(Promise.resolve('reply'), r.opts(recover));
    r.complete(0);
    await expect(p).resolves.toBe('reply');
    r.tick();               // timer fires after settlement — must be inert
    expect(recover).not.toHaveBeenCalled();
  });

  it('★ never recovers from a failed command', async () => {
    // A non-zero exit means the sidecar is missing or half-written. Reading it
    // would turn a clean failure into corrupt-looking success.
    const r = rig();
    const recover = vi.fn();
    let settled = false;
    const p = withCompletionFallback(new Promise(() => {}), r.opts(recover));
    p.then(() => { settled = true; }, () => { settled = true; });
    r.complete(1);
    r.tick();
    await Promise.resolve();
    expect(recover).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it('a second completion announcement does not recover twice', async () => {
    const r = rig();
    const recover = vi.fn().mockResolvedValue('once');
    const p = withCompletionFallback(new Promise(() => {}), r.opts(recover));
    r.complete(0);
    r.complete(0);
    r.tick();
    await expect(p).resolves.toBe('once');
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure inside recover rather than hanging', async () => {
    const r = rig();
    const p = withCompletionFallback(
      new Promise(() => {}),
      r.opts(() => Promise.reject(new Error('sidecar missing'))),
    );
    r.complete(0);
    r.tick();
    await expect(p).rejects.toThrow('sidecar missing');
  });

  it('degrades to the plain promise without a subscribe or recover', async () => {
    await expect(withCompletionFallback(Promise.resolve(1), {})).resolves.toBe(1);
    await expect(withCompletionFallback(Promise.resolve(2), { subscribe: () => {} }))
      .resolves.toBe(2);
  });

  it('survives a subscribe that throws', async () => {
    // A listener that cannot attach must not fail the call it was protecting.
    await expect(withCompletionFallback(Promise.resolve('ok'), {
      subscribe: () => { throw new Error('listen failed'); },
      recover: vi.fn(),
    })).resolves.toBe('ok');
  });

  it('has a grace short enough not to read as a hang', () => {
    expect(DEFAULT_GRACE_MS).toBeLessThanOrEqual(3000);
  });
});

describe('completionExitCode', () => {
  const parse = (l) => parseProgressLine(l);

  it('★ reads the line Rust actually emits', () => {
    expect(completionExitCode(parse('end::0::phrases::0'), 'phrases')).toBe(0);
    expect(completionExitCode(parse('end::0::phrases::1'), 'phrases')).toBe(1);
  });

  it('ignores another operation completing', () => {
    // The global channel carries every command; a generate finishing must not
    // be read as this analyze finishing.
    expect(completionExitCode(parse('end::0::generate::0'), 'phrases')).toBe(null);
  });

  it('ignores ordinary stage traffic', () => {
    expect(completionExitCode(parse('start::2::assess'), 'assess')).toBe(null);
    expect(completionExitCode(parse('done::2::assess'), 'assess')).toBe(null);
    expect(completionExitCode(parse('msg::3::assess::working'), 'assess')).toBe(null);
    expect(completionExitCode(null, 'assess')).toBe(null);
  });

  it('defaults a malformed exit code to success', () => {
    // The event fired, so the command finished; an unreadable code should not
    // block recovery.
    expect(completionExitCode(parse('end::0::phrases::'), 'phrases')).toBe(0);
  });
});
