import { describe, it, expect, vi } from 'vitest';
import {
  isStalled, withStallTimeout, StallError, DEFAULT_STALL_MS,
} from './stallWatchdog.js';

describe('isStalled', () => {
  it('★ measures silence from the last event, not from the start', () => {
    // The load-bearing rule. Analysis runs for many minutes; timing from the
    // start would abort healthy work mid-pipeline.
    const startedAt = 0;
    expect(isStalled({ startedAt, lastEventAt: 500000, now: 500100, stallMs: 1000 }))
      .toBe(false);
    expect(isStalled({ startedAt, lastEventAt: 500000, now: 501100, stallMs: 1000 }))
      .toBe(true);
  });

  it('falls back to the start time before any event arrives', () => {
    expect(isStalled({ startedAt: 0, lastEventAt: null, now: 999, stallMs: 1000 }))
      .toBe(false);
    expect(isStalled({ startedAt: 0, lastEventAt: null, now: 1000, stallMs: 1000 }))
      .toBe(true);
  });

  it('never fires on missing timestamps', () => {
    expect(isStalled({ startedAt: null, lastEventAt: null, now: 5 })).toBe(false);
    expect(isStalled({ startedAt: 0, lastEventAt: null, now: null })).toBe(false);
  });

  it('defaults to three minutes of silence', () => {
    expect(DEFAULT_STALL_MS).toBe(180000);
  });
});

describe('withStallTimeout', () => {
  const rig = () => {
    let tick = null;
    let cleared = 0;
    let t = 0;
    return {
      cleared: () => cleared,
      advance: (ms) => { t += ms; tick?.(); },
      opts: (getLastEventAt = () => null) => ({
        getLastEventAt,
        startedAt: 0,
        stallMs: 1000,
        now: () => t,
        setIntervalFn: (fn) => { tick = fn; return 'timer'; },
        clearIntervalFn: () => { cleared += 1; tick = null; },
      }),
    };
  };

  it('resolves normally and clears its timer', async () => {
    const r = rig();
    await expect(withStallTimeout(Promise.resolve('ok'), r.opts())).resolves.toBe('ok');
    expect(r.cleared()).toBe(1);
  });

  it('passes a real rejection through, and still clears its timer', async () => {
    const r = rig();
    const boom = new Error('analyze failed');
    await expect(withStallTimeout(Promise.reject(boom), r.opts())).rejects.toBe(boom);
    expect(r.cleared()).toBe(1);
  });

  it('★ rejects a call that never settles', async () => {
    const r = rig();
    const never = new Promise(() => {});          // the observed hang
    const p = withStallTimeout(never, r.opts());
    r.advance(1000);
    await expect(p).rejects.toBeInstanceOf(StallError);
  });

  it('★ does not fire while progress keeps arriving', async () => {
    const r = rig();
    let last = 0;
    const never = new Promise(() => {});
    const p = withStallTimeout(never, r.opts(() => last));
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 20; i += 1) { r.advance(900); last += 900; }
    await Promise.resolve();
    expect(settled).toBe(false);   // 18s of work, never silent for a full 1s
  });

  it('reports how long the silence was, and calls onStall once', async () => {
    const r = rig();
    const onStall = vi.fn();
    const p = withStallTimeout(new Promise(() => {}), { ...r.opts(), onStall });
    r.advance(1500);
    r.advance(1500);                               // a second tick must not re-fire
    await expect(p).rejects.toMatchObject({ stalled: true, silentMs: 1500 });
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('a late resolution after a stall cannot re-settle the promise', async () => {
    const r = rig();
    let release;
    const late = new Promise((res) => { release = res; });
    const p = withStallTimeout(late, r.opts());
    r.advance(1000);
    await expect(p).rejects.toBeInstanceOf(StallError);
    release('too late');
    await expect(p).rejects.toBeInstanceOf(StallError);
  });
});
