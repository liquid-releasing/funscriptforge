import { describe, it, expect } from 'vitest';
import {
  emptyOps, registerOp, deregisterOp, updateOp, activeOps, primaryOp,
  expireStaleOps, toBusy, completeOp,
} from './busyRegistry.js';

describe('the failures the single-slot banner could not avoid', () => {
  it('★ a tab unmounting mid-run cannot strand anyone', () => {
    // Old model: Chapters set the banner, unmounted, and its clear never ran
    // (or was refused), so the banner stayed until an app restart. Here its
    // entry is just one of several, and removing it is unconditional.
    let ops = registerOp(emptyOps(), 'chapters', { message: 'Detecting phrases…' });
    ops = registerOp(ops, 'events', { message: 'Loading events…' });
    ops = deregisterOp(ops, 'chapters');
    expect(toBusy(ops).message).toBe('Loading events…');
    ops = deregisterOp(ops, 'events');
    expect(toBusy(ops)).toBe(null);
  });

  it('★ interleaved producers both clear, in either order', () => {
    // The stranding case: Events set the banner, Chapters re-took it, Events
    // cleared and was REFUSED because it no longer owned it. There is no
    // ownership here, so order cannot matter.
    for (const order of [['a', 'b'], ['b', 'a']]) {
      let ops = registerOp(registerOp(emptyOps(), 'a', {}), 'b', {});
      ops = deregisterOp(ops, order[0]);
      ops = deregisterOp(ops, order[1]);
      expect(toBusy(ops)).toBe(null);
    }
  });

  it('★ one stuck operation cannot hide that the others finished', () => {
    // The banner stays up for the genuinely-stuck op, but the entries for
    // everything else go away on their own schedule.
    let ops = registerOp(emptyOps(), 'stuck', { message: 'Updating…', startedAt: 0 });
    ops = registerOp(ops, 'quick', { message: 'Detecting phrases…', startedAt: 1 });
    ops = deregisterOp(ops, 'quick');
    expect(activeOps(ops).map((o) => o.key)).toEqual(['stuck']);
    expect(toBusy(ops).message).toBe('Updating…');
  });

  it('a late or duplicate deregister is a no-op, not an error', () => {
    const ops = registerOp(emptyOps(), 'a', {});
    const once = deregisterOp(ops, 'a');
    expect(deregisterOp(once, 'a')).toBe(once);      // same reference
    expect(deregisterOp(emptyOps(), 'ghost')).toEqual({});
  });
});

describe('registerOp', () => {
  it('keeps the original start time when a producer relabels mid-run', () => {
    // Chapters sets "Analyzing chapters…" then "Detecting phrases…". That is
    // one operation with two labels, not two operations.
    let ops = registerOp(emptyOps(), 'chapters', { message: 'A', startedAt: 100 });
    ops = registerOp(ops, 'chapters', { message: 'B', startedAt: 500 });
    expect(activeOps(ops)).toHaveLength(1);
    expect(ops.chapters.startedAt).toBe(100);
    expect(ops.chapters.message).toBe('B');
  });

  it('ignores a missing key rather than creating a nameless entry', () => {
    const ops = emptyOps();
    expect(registerOp(ops, null, { message: 'x' })).toBe(ops);
    expect(registerOp(ops, '', { message: 'x' })).toBe(ops);
  });
});

describe('updateOp', () => {
  it('patches an entry in place', () => {
    const ops = registerOp(emptyOps(), 'a', { message: 'start' });
    expect(updateOp(ops, 'a', { message: 'later' }).a.message).toBe('later');
  });

  it('★ cannot resurrect an operation that already finished', () => {
    // A stage event arriving after completion must not put the banner back.
    const ops = emptyOps();
    expect(updateOp(ops, 'gone', { message: 'zombie' })).toBe(ops);
  });
});

describe('primaryOp', () => {
  it('describes the most recently started operation', () => {
    // The newest is what the user just did. A long background job keeps the
    // banner alive but does not speak over the thing in front of them.
    let ops = registerOp(emptyOps(), 'slow', { message: 'Updating…', startedAt: 1 });
    ops = registerOp(ops, 'fast', { message: 'Detecting phrases…', startedAt: 2 });
    expect(primaryOp(ops).key).toBe('fast');
  });

  it('is null when nothing is running', () => {
    expect(primaryOp(emptyOps())).toBe(null);
    expect(primaryOp(null)).toBe(null);
  });
});

describe('expireStaleOps', () => {
  it('★ expires only the silent operation, not the whole banner', () => {
    // The narrowing that matters: a lost reply used to release the shared
    // banner, taking live progress with it.
    let ops = registerOp(emptyOps(), 'lost', { startedAt: 0, progressAt: 0 });
    ops = registerOp(ops, 'live', { startedAt: 0, progressAt: 9000 });
    const next = expireStaleOps(ops, { now: 10000, stallMs: 5000 });
    expect(Object.keys(next)).toEqual(['live']);
  });

  it('measures silence from the last progress, falling back to start', () => {
    const ops = registerOp(emptyOps(), 'a', { startedAt: 0 });
    expect(expireStaleOps(ops, { now: 4999, stallMs: 5000 })).toBe(ops);
    expect(expireStaleOps(ops, { now: 5000, stallMs: 5000 })).toEqual({});
  });

  it('returns the same reference when nothing expires', () => {
    const ops = registerOp(emptyOps(), 'a', { startedAt: 0, progressAt: 100 });
    expect(expireStaleOps(ops, { now: 200, stallMs: 5000 })).toBe(ops);
    expect(expireStaleOps(ops, { now: null, stallMs: 5000 })).toBe(ops);
  });
});

describe('toBusy', () => {
  it('keeps the shape the shell and every tab already read', () => {
    const ops = registerOp(emptyOps(), 'a', {
      message: 'Working…', steps: [{ label: 's', status: 'running' }],
    });
    expect(toBusy(ops)).toMatchObject({
      message: 'Working…', steps: [{ label: 's', status: 'running' }], key: 'a',
    });
  });

  it('reports how many operations are in flight', () => {
    let ops = registerOp(emptyOps(), 'a', { startedAt: 1 });
    ops = registerOp(ops, 'b', { startedAt: 2 });
    expect(toBusy(ops).count).toBe(2);
  });

  it('is null when nothing is registered — the banner hides itself', () => {
    expect(toBusy(emptyOps())).toBe(null);
  });
});

describe('completeOp', () => {
  it('★ releases the tab entry that was waiting on the operation', () => {
    // A tab shows "Analyzing chapters…" while the backend shows the stages.
    // When the op ends, leaving the tab entry up keeps the banner describing
    // finished work — and the tab's own clear runs in a `finally`, which is
    // exactly what a lost invoke reply prevents.
    let ops = registerOp(emptyOps(), 'chapters', {
      message: 'Analyzing chapters…', waitingFor: 'analyze',
    });
    ops = registerOp(ops, 'op:analyze', { message: 'Detecting phases…' });
    expect(toBusy(completeOp(ops, 'analyze'))).toBe(null);
  });

  it('leaves unrelated work alone', () => {
    let ops = registerOp(emptyOps(), 'op:analyze', {});
    ops = registerOp(ops, 'app#1', { message: 'Loading project…' });
    ops = registerOp(ops, 'chapters', { waitingFor: 'phrases' });
    const next = completeOp(ops, 'analyze');
    expect(Object.keys(next).sort()).toEqual(['app#1', 'chapters']);
  });

  it('returns the same reference when nothing matches', () => {
    const ops = registerOp(emptyOps(), 'app#1', {});
    expect(completeOp(ops, 'analyze')).toBe(ops);
    expect(completeOp(emptyOps(), 'analyze')).toEqual({});
  });
});
