import { describe, it, expect } from 'vitest';
import {
  PASSAGE_PRESETS, passagesForPreset, presetSamples, activePassagePreset,
  shapeFactor, envelopeFactor, resolvePassageSpans, passageFactorAt, passageInfoForChapter,
  arcFromPassages, passagesFromArc,
} from './passages.js';

// Three equal 10s chapters (camelCase, the Channels shape).
const CH3 = [
  { id: 'a', atMs: 0, endMs: 10000 },
  { id: 'b', atMs: 10000, endMs: 20000 },
  { id: 'c', atMs: 20000, endMs: 30000 },
];

describe('passage presets', () => {
  it('every preset names a shape shapeFactor understands', () => {
    for (const pr of PASSAGE_PRESETS) {
      expect(typeof shapeFactor(pr.shape, 0.5, pr.floor, pr.ceiling)).toBe('number');
    }
  });

  it('Hold steady is a no-op — no passage rows', () => {
    expect(passagesForPreset('hold', 7)).toEqual([]);
  });

  it('a real preset produces one full-span passage with the preset shape/range', () => {
    const ps = passagesForPreset('build', 7);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ shape: 'build', beginIdx: 0, endIdx: 6, floor: 0.3, ceiling: 1.0 });
  });

  it('spans 0..n-1 for any chapter count, and degrades safely at n=0', () => {
    expect(passagesForPreset('edge', 3)[0]).toMatchObject({ beginIdx: 0, endIdx: 2 });
    expect(passagesForPreset('build', 0)).toEqual([]);
  });
});

describe('presetSamples', () => {
  it('returns a 0..1 curve of the requested length', () => {
    const s = presetSamples('build', 24);
    expect(s).toHaveLength(24);
    for (const v of s) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('build rises over the span; hold is flat', () => {
    const build = presetSamples('build', 24);
    expect(build[23]).toBeGreaterThan(build[0]);
    const hold = presetSamples('hold', 24);
    expect(Math.max(...hold) - Math.min(...hold)).toBeCloseTo(0, 6);
  });
});

describe('activePassagePreset — round-trips with passagesForPreset', () => {
  it('empty passages read back as Hold steady', () => {
    expect(activePassagePreset([])).toBe('hold');
  });

  it('a preset-built passages array reports its own preset id', () => {
    for (const pr of PASSAGE_PRESETS.filter((p) => p.id !== 'hold')) {
      expect(activePassagePreset(passagesForPreset(pr.id, 5))).toBe(pr.id);
    }
  });

  it('a hand-edited passage matches no preset (no pill highlighted)', () => {
    const custom = [{ id: 'x', shape: 'build', beginIdx: 1, endIdx: 3, floor: 0.5, ceiling: 0.7 }];
    expect(activePassagePreset(custom)).toBeNull();
    // multiple passages also clear the highlight
    expect(activePassagePreset([...passagesForPreset('build', 5), ...passagesForPreset('edge', 5)])).toBeNull();
  });
});

describe('eased parametric envelope (mirror of forge/passages.py)', () => {
  it('build is eased (smoothstep), not a straight ramp', () => {
    expect(shapeFactor('build', 0.25, 0, 1)).toBeLessThan(0.25);
    expect(shapeFactor('build', 0.75, 0, 1)).toBeGreaterThan(0.75);
    expect(shapeFactor('build', 0.5, 0, 1)).toBeCloseTo(0.5, 6);
    expect(shapeFactor('build', 0, 0, 1)).toBe(0);
    expect(shapeFactor('build', 1, 0, 1)).toBe(1);
  });

  it('explicit rise/fall handles override the shape default', () => {
    // Build & hold: reach the top by 0.5, hold to the end.
    expect(envelopeFactor(0.5, 0.3, 1.0, 0.5, 1.0)).toBeCloseTo(1.0, 6);
    expect(envelopeFactor(0.8, 0.3, 1.0, 0.5, 1.0)).toBeCloseTo(1.0, 6);
    expect(shapeFactor('build', 0.8, 0.3, 1.0, 0.5, 1.0)).toBeCloseTo(1.0, 6);
  });

  it('hold plateau between rise and fall', () => {
    const f = (x) => envelopeFactor(x, 0.2, 1.0, 0.3, 0.7);
    expect(f(0.5)).toBeCloseTo(1.0, 6);
    expect(f(0.3)).toBeCloseTo(1.0, 6);
    expect(f(0.7)).toBeCloseTo(1.0, 6);
    expect(f(0)).toBeCloseTo(0.2, 6);
    expect(f(1)).toBeCloseTo(0.2, 6);
  });

  it('presets round-trip through activePassagePreset with rise/fall', () => {
    for (const pr of PASSAGE_PRESETS.filter((p) => p.id !== 'hold')) {
      expect(activePassagePreset(passagesForPreset(pr.id, 5))).toBe(pr.id);
    }
  });
});

describe('arc ⇄ passages (the 4-slider editor model)', () => {
  it('empty/multi passages read back as a neutral flat-at-full arc', () => {
    expect(arcFromPassages([])).toEqual({ floor: 1.0, ceiling: 1.0, risePoint: 0.0, fallPoint: 1.0 });
  });

  it('round-trips a preset through arc and back', () => {
    const ps = passagesForPreset('edge', 5);
    const arc = arcFromPassages(ps);
    expect(arc.floor).toBeCloseTo(0.35, 6);
    expect(arc.ceiling).toBeCloseTo(1.0, 6);
    expect(arc.risePoint).toBeCloseTo(0.5, 6);
    expect(arc.fallPoint).toBeCloseTo(0.6, 6);
  });

  it('passagesFromArc builds one full-span passage, full-flat = Hold (none)', () => {
    expect(passagesFromArc({ floor: 1, ceiling: 1, risePoint: 0, fallPoint: 1 }, 5)).toEqual([]);
    const ps = passagesFromArc({ floor: 0.3, ceiling: 1.0, risePoint: 0.5, fallPoint: 1.0 }, 5);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ beginIdx: 0, endIdx: 4, floor: 0.3, ceiling: 1.0, risePoint: 0.5, fallPoint: 1.0 });
  });

  it('enforces ceiling≥floor and fallPoint≥risePoint', () => {
    const ps = passagesFromArc({ floor: 0.8, ceiling: 0.4, risePoint: 0.9, fallPoint: 0.2 }, 3);
    expect(ps[0].ceiling).toBeGreaterThanOrEqual(ps[0].floor);
    expect(ps[0].fallPoint).toBeGreaterThanOrEqual(ps[0].risePoint);
  });
});

describe('resolve + factor-at (mirror of forge/passages.py)', () => {
  it('resolves a full-span Build to absolute time, dropping Steady', () => {
    const spans = resolvePassageSpans(passagesForPreset('build', 3), CH3);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ lo: 0, hi: 30000, shape: 'build', beginIdx: 0, endIdx: 2 });
    expect(resolvePassageSpans(passagesForPreset('hold', 3), CH3)).toEqual([]);
  });

  it('Build factor climbs floor→ceiling continuously across the whole span', () => {
    const spans = resolvePassageSpans(passagesForPreset('build', 3), CH3);
    const f0 = passageFactorAt(spans, 0);       // start
    const fMid = passageFactorAt(spans, 15000);  // middle
    const fEnd = passageFactorAt(spans, 30000);  // end
    expect(f0).toBeCloseTo(0.3, 6);   // preset floor
    expect(fEnd).toBeCloseTo(1.0, 6); // preset ceiling
    expect(fMid).toBeGreaterThan(f0);
    expect(fMid).toBeLessThan(fEnd);
    // continuous, not per-chapter reset: ch2-start > ch1-start
    expect(passageFactorAt(spans, 10000)).toBeGreaterThan(f0);
  });

  it('no covering passage → 1.0 (untouched)', () => {
    expect(passageFactorAt([], 5000)).toBe(1.0);
  });

  it('passageInfoForChapter reports the per-chapter multiplier + trajectory', () => {
    const ps = passagesForPreset('build', 3);
    const ch0 = passageInfoForChapter(ps, CH3, 0);
    const ch2 = passageInfoForChapter(ps, CH3, 2);
    expect(ch0.shape).toBe('build');
    expect(ch2.factor).toBeGreaterThan(ch0.factor);   // later chapter sits higher
    expect(ch0.endIdx).toBe(2);
    // Hold steady covers nothing → null
    expect(passageInfoForChapter(passagesForPreset('hold', 3), CH3, 1)).toBeNull();
  });
});
