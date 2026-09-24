import { describe, it, expect } from 'vitest';
import {
  hasChanged,
  changedChapters,
  rebuildWorkingActions,
  nextBakeRecord,
  buildSelection,
} from './toneBake.js';
import { applyTone } from './toneCurve.js';

const CHAPTERS = [
  { id: 'c1', atMs: 0, endMs: 9999 },
  { id: 'c2', atMs: 10000, endMs: 19999 },
  { id: 'c3', atMs: 20000, endMs: 29999 },
];

/** Oscillating actions across a span, 255 ms apart. */
function actionsFor(fromMs, toMs, depth, gap = 255) {
  const out = [];
  const lo = Math.round(50 - depth / 2);
  const hi = Math.round(50 + depth / 2);
  for (let i = 0, at = fromMs; at <= toMs; i += 1, at = fromMs + i * gap) {
    out.push({ at, pos: i % 2 === 0 ? lo : hi });
  }
  return out;
}

const SOURCE = actionsFor(0, 29999, 54);
const CLIMAX = { tone: 'climax', params: { impact: 1, contrast: 0.74, density: 1 } };

const depthIn = (acts, from, to) => {
  const w = acts.filter((a) => a.at >= from && a.at <= to);
  return w.length ? Math.max(...w.map((a) => a.pos)) - Math.min(...w.map((a) => a.pos)) : 0;
};

// The adapter the tab supplies: toneBake is told how to tone, it does not know.
const apply = (acts, s, e, toneId, params) => applyTone(acts, s, e, { id: toneId }, params);

const rebuild = (workActions, selection, baked) => rebuildWorkingActions({
  workActions, sourceActions: SOURCE, chapters: CHAPTERS, selection, baked, applyTone: apply,
});

describe('hasChanged', () => {
  it('sees a tone appearing where nothing was baked', () => {
    expect(hasChanged('c1', { c1: CLIMAX }, {})).toBe(true);
  });

  it('sees nothing when the selection matches the bake', () => {
    expect(hasChanged('c1', { c1: CLIMAX }, { c1: CLIMAX })).toBe(false);
  });

  it('★ sees a params-only change', () => {
    // "I set it to 0.2 and it came back 0.5" — the params must count.
    const weaker = { tone: 'climax', params: { ...CLIMAX.params, impact: 0.2 } };
    expect(hasChanged('c1', { c1: weaker }, { c1: CLIMAX })).toBe(true);
  });

  it('★ sees a scope-only change', () => {
    const scoped = { tone: 'climax', params: { ...CLIMAX.params, scope: 'quiet' } };
    expect(hasChanged('c1', { c1: scoped }, { c1: CLIMAX })).toBe(true);
  });

  it('★ sees a tone being removed — that is the undo', () => {
    expect(hasChanged('c1', { c1: { tone: 'none' } }, { c1: CLIMAX })).toBe(true);
  });

  it('ignores key order, so a round-tripped record is not a spurious change', () => {
    // Otherwise every reopen would re-bake everything, which is the bug.
    const a = { tone: 'climax', params: { impact: 1, contrast: 0.74, density: 1 } };
    const b = { tone: 'climax', params: { density: 1, contrast: 0.74, impact: 1 } };
    expect(hasChanged('c1', { c1: a }, { c1: b })).toBe(false);
  });

  it('treats absent and untoned as the same thing', () => {
    expect(hasChanged('c1', {}, { c1: { tone: 'none', params: {} } })).toBe(false);
    expect(hasChanged('c1', { c1: { tone: 'none' } }, {})).toBe(false);
  });

  it('ignores params on an untoned chapter', () => {
    // A passthrough is a passthrough whatever the sliders happen to say.
    expect(hasChanged('c1', { c1: { tone: 'none', params: { impact: 0.9 } } }, {})).toBe(false);
  });
});

describe('changedChapters', () => {
  it('lists only what actually differs', () => {
    expect(changedChapters(CHAPTERS, { c1: CLIMAX, c2: CLIMAX }, { c2: CLIMAX }))
      .toEqual(['c1']);
  });

  it('is empty when nothing changed', () => {
    expect(changedChapters(CHAPTERS, { c2: CLIMAX }, { c2: CLIMAX })).toEqual([]);
  });
});

describe('rebuildWorkingActions', () => {
  it('applies a tone to the changed chapter only', () => {
    const { actions, rebuiltIds } = rebuild(SOURCE, { c2: CLIMAX }, {});
    expect(rebuiltIds).toEqual(['c2']);
    expect(depthIn(actions, 10000, 19999)).toBeGreaterThan(depthIn(SOURCE, 10000, 19999));
    expect(depthIn(actions, 0, 9999)).toBe(depthIn(SOURCE, 0, 9999));
    expect(depthIn(actions, 20000, 29999)).toBe(depthIn(SOURCE, 20000, 29999));
  });

  it('★ does not re-bake a chapter whose selection matches the record', () => {
    // The compounding bug, in one assertion. Second call is a no-op.
    const first = rebuild(SOURCE, { c2: CLIMAX }, {});
    const record = nextBakeRecord({}, { c2: CLIMAX }, first.rebuiltIds);
    const second = rebuild(first.actions, { c2: CLIMAX }, record);
    expect(second.rebuiltIds).toEqual([]);
    expect(second.actions).toEqual(first.actions);
  });

  it('★ stays stable over many reopen-and-accept cycles', () => {
    // Previously: 54 -> 70 -> 92 -> 100 (railed). Now it must not move.
    let work = SOURCE;
    let record = {};
    let firstDepth = null;
    for (let i = 0; i < 5; i += 1) {
      const r = rebuildWorkingActions({
        workActions: work, sourceActions: SOURCE, chapters: CHAPTERS,
        selection: { c2: CLIMAX }, baked: record, applyTone: apply,
      });
      work = r.actions;
      record = nextBakeRecord(record, { c2: CLIMAX }, r.rebuiltIds);
      const d = depthIn(work, 10000, 19999);
      if (firstDepth === null) firstDepth = d;
      expect(d).toBe(firstDepth);
    }
  });

  it('★ re-tones from the ORIGINAL when the params change, not from the bake', () => {
    // Without this, lowering impact would still deepen the script, because it
    // would be applied on top of the previous bake.
    const first = rebuild(SOURCE, { c2: CLIMAX }, {});
    const record = nextBakeRecord({}, { c2: CLIMAX }, first.rebuiltIds);
    const weaker = { tone: 'climax', params: { ...CLIMAX.params, impact: 0.25 } };
    const second = rebuild(first.actions, { c2: weaker }, record);
    expect(second.rebuiltIds).toEqual(['c2']);
    const d0 = depthIn(SOURCE, 10000, 19999);
    const dFull = depthIn(first.actions, 10000, 19999);
    const dWeak = depthIn(second.actions, 10000, 19999);
    expect(dWeak).toBeLessThan(dFull);      // turning it down turns it DOWN
    expect(dWeak).toBeGreaterThanOrEqual(d0); // but still toned
  });

  it('★ setting a chapter to Untoned restores the original exactly — the undo', () => {
    const first = rebuild(SOURCE, { c2: CLIMAX }, {});
    const record = nextBakeRecord({}, { c2: CLIMAX }, first.rebuiltIds);
    expect(depthIn(first.actions, 10000, 19999)).not.toBe(depthIn(SOURCE, 10000, 19999));

    const undone = rebuild(first.actions, { c2: { tone: 'none' } }, record);
    expect(undone.rebuiltIds).toEqual(['c2']);
    const inRange = (a) => a.filter((x) => x.at >= 10000 && x.at <= 19999);
    expect(inRange(undone.actions)).toEqual(
      inRange(SOURCE).map((a) => ({ at: a.at, pos: a.pos })),
    );
  });

  it('★ preserves another tab\'s edits inside an UNCHANGED chapter', () => {
    // The reason unchanged chapters are left alone rather than rebuilt from
    // source: phrase and stanza edits live in the work file too.
    const edited = SOURCE.map((a) => (a.at >= 0 && a.at < 9999 ? { at: a.at, pos: 7 } : a));
    const { actions } = rebuild(edited, { c2: CLIMAX }, {});
    const c1 = actions.filter((a) => a.at < 9999);
    expect(c1.every((a) => a.pos === 7)).toBe(true);
  });

  it('★ a changed chapter DOES discard in-range edits — the documented trade', () => {
    // Stated as a test so the behaviour is deliberate and visible, not a
    // surprise discovered in dogfood.
    const edited = SOURCE.map((a) => (a.at >= 10000 && a.at <= 19999 ? { at: a.at, pos: 7 } : a));
    const { actions } = rebuild(edited, { c2: { tone: 'none' } }, { c2: CLIMAX });
    const c2 = actions.filter((a) => a.at >= 10000 && a.at <= 19999);
    expect(c2.some((a) => a.pos === 7)).toBe(false);
  });

  it('leaves material outside every chapter untouched', () => {
    const work = [{ at: 30500, pos: 3 }, ...SOURCE].sort((a, b) => a.at - b.at);
    const { actions } = rebuild(work, { c1: CLIMAX }, {});
    expect(actions.find((a) => a.at === 30500)).toEqual({ at: 30500, pos: 3 });
  });

  it('handles empty inputs without throwing', () => {
    expect(rebuild([], { c1: CLIMAX }, {}).actions).toEqual([]);
    expect(rebuildWorkingActions({
      workActions: SOURCE, sourceActions: SOURCE, chapters: [],
      selection: {}, baked: {}, applyTone: apply,
    }).actions).toEqual(SOURCE);
  });

  it('keeps actions in time order', () => {
    const { actions } = rebuild(SOURCE, { c1: CLIMAX, c3: CLIMAX }, {});
    for (let i = 1; i < actions.length; i += 1) {
      expect(actions[i].at).toBeGreaterThanOrEqual(actions[i - 1].at);
    }
  });
});

describe('nextBakeRecord', () => {
  it('records what was applied', () => {
    expect(nextBakeRecord({}, { c1: CLIMAX }, ['c1'])).toEqual({ c1: CLIMAX });
  });

  it('★ removes an untoned chapter rather than storing tone:none', () => {
    // One spelling for "nothing baked", so hasChanged can't see a difference
    // where there is none.
    expect(nextBakeRecord({ c1: CLIMAX }, { c1: { tone: 'none' } }, ['c1'])).toEqual({});
  });

  it('leaves chapters that were not rebuilt alone', () => {
    const before = { c1: CLIMAX };
    expect(nextBakeRecord(before, { c1: CLIMAX, c2: CLIMAX }, [])).toEqual(before);
  });

  it('copies params rather than aliasing the selection', () => {
    // A record that shares a reference with live UI state would silently
    // track later edits and then report "nothing changed".
    const selection = { c1: { tone: 'climax', params: { impact: 1 } } };
    const rec = nextBakeRecord({}, selection, ['c1']);
    selection.c1.params.impact = 0.1;
    expect(rec.c1.params.impact).toBe(1);
    expect(hasChanged('c1', selection, rec)).toBe(true);
  });
});

describe('buildSelection', () => {
  const tones = { c1: 'climax', c2: 'climax', c3: 'edge' };
  const params = {
    c1: { climax: { impact: 1 } },
    c2: { climax: { impact: 0.5 } },
    c3: { edge: { impact: 0.5 } },
  };

  it('takes the current choice for accepted chapters', () => {
    const sel = buildSelection({
      chapters: CHAPTERS, acceptedIds: new Set(['c1']), tones, params, baked: {},
    });
    expect(sel).toEqual({ c1: { tone: 'climax', params: { impact: 1 } } });
  });

  it('★ never bakes a tone the user is only auditioning', () => {
    // c3 has a tone picked but was never accepted -- accepting c1 must not
    // commit it.
    const sel = buildSelection({
      chapters: CHAPTERS, acceptedIds: new Set(['c1']), tones, params, baked: {},
    });
    expect(sel.c3).toBeUndefined();
    expect(hasChanged('c3', sel, {})).toBe(false);
  });

  it('★ never UNDOES a baked chapter just because it is not in this walk', () => {
    // The dangerous direction: reporting an un-accepted chapter as untoned
    // would rebuild its range from source and silently wipe its tone.
    const baked = { c2: { tone: 'climax', params: { impact: 0.5 } } };
    const sel = buildSelection({
      chapters: CHAPTERS, acceptedIds: new Set(['c1']), tones, params, baked,
    });
    expect(hasChanged('c2', sel, baked)).toBe(false);
  });

  it('lets an accepted chapter be set back to Untoned', () => {
    const baked = { c1: { tone: 'climax', params: { impact: 1 } } };
    const sel = buildSelection({
      chapters: CHAPTERS, acceptedIds: new Set(['c1']),
      tones: { c1: 'none' }, params, baked,
    });
    expect(hasChanged('c1', sel, baked)).toBe(true);
  });

  it('accepts a plain array of ids as well as a Set', () => {
    const sel = buildSelection({
      chapters: CHAPTERS, acceptedIds: ['c1'], tones, params, baked: {},
    });
    expect(sel.c1).toBeDefined();
  });
});
