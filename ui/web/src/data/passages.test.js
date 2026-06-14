import { describe, it, expect } from 'vitest';
import {
  PASSAGE_PRESETS, passagesForPreset, presetSamples, activePassagePreset,
  shapeFactor,
} from './passages.js';

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
