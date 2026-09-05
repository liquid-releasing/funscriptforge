import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCoalescedWriter } from './coalescedWriter.js';

describe('createCoalescedWriter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('collapses a burst into a single write', () => {
    // The whole point: authoring a run of chained events used to spawn one
    // CLI process per event.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    w.schedule(['a', 'b']);
    w.schedule(['a', 'b', 'c']);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('writes the LAST payload, not the first', () => {
    // Callers pass the whole collection, so an earlier payload is a strictly
    // staler version of the same thing. Writing it would lose edits.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    w.schedule(['a', 'b', 'c']);
    vi.advanceTimersByTime(600);
    expect(write).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('flush writes immediately without waiting out the delay', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    await w.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(['a']);
  });

  it('flush resolves so a caller can await it before reading the file back', async () => {
    // Export / Preview / Import read the sidecar from disk. If flush did not
    // settle, they could read a file a whole burst out of date.
    let settled = false;
    const write = vi.fn(() => new Promise((res) => {
      setTimeout(() => { settled = true; res(); }, 50);
    }));
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    const p = w.flush();
    vi.advanceTimersByTime(50);
    await p;
    expect(settled).toBe(true);
  });

  it('does not write twice when a flush follows a fired timer', () => {
    // The debounced write already landed; flush must not re-send it.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    vi.advanceTimersByTime(600);
    w.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing queued is a no-op', async () => {
    // flush() is called defensively before every read, where "nothing owed"
    // is the normal case — it must not manufacture a write.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    await w.flush();
    expect(write).not.toHaveBeenCalled();
  });

  it('the timer does not resurrect an already-flushed payload', () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    w.flush();
    vi.advanceTimersByTime(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps working after a flush', () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule(['a']);
    w.flush();
    w.schedule(['a', 'b']);
    vi.advanceTimersByTime(600);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(['a', 'b']);
  });

  it('reports whether a write is still owed', () => {
    // Unmount uses this shape: anything owed must be written, or leaving the
    // tab mid-burst drops the user's last edits.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    expect(w.hasPending()).toBe(false);
    w.schedule(['a']);
    expect(w.hasPending()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(w.hasPending()).toBe(false);
  });

  it('writes a falsy payload rather than mistaking it for nothing queued', () => {
    // An empty list is a real state — the user deleted their last event, and
    // that has to reach disk. Tracking "is anything queued" separately from
    // the payload is what makes this work.
    const write = vi.fn().mockResolvedValue(undefined);
    const w = createCoalescedWriter(write, 600);
    w.schedule([]);
    vi.advanceTimersByTime(600);
    expect(write).toHaveBeenCalledWith([]);
  });
});
