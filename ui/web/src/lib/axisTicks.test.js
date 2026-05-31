import { describe, it, expect } from 'vitest';
import { makeTicks, fmtTimeMs, axisTickLabels } from './axisTicks.js';

describe('makeTicks', () => {
  it('returns n evenly-spaced ticks inclusive of both ends', () => {
    expect(makeTicks(0, 9000, 3)).toEqual([0, 4500, 9000]);
    expect(makeTicks(0, 8000, 3)).toEqual([0, 4000, 8000]);
  });
});

describe('fmtTimeMs', () => {
  it('formats mm:ss, flooring to the second, clamping negatives to 0:00', () => {
    expect(fmtTimeMs(0)).toBe('0:00');
    expect(fmtTimeMs(9000)).toBe('0:09');
    expect(fmtTimeMs(1353000)).toBe('22:33');
    expect(fmtTimeMs(-500)).toBe('0:00');
  });
});

describe('axisTickLabels — the slice-preview offset (regression guard)', () => {
  it('labels a 0-based viewport at the real timeline position', () => {
    // Phrase #127 lived at 22:33–22:42 but the chart viewport is 0..9000ms.
    // Without the originMs offset the axis read 0:00/0:04/0:09 — the bug.
    const at_ms = 22 * 60_000 + 33_000; // 1_353_000
    expect(axisTickLabels(0, 9000, 3, at_ms)).toEqual(['22:33', '22:37', '22:42']);
  });

  it('is a no-op when originMs is omitted (full-track charts)', () => {
    expect(axisTickLabels(0, 8000, 3)).toEqual(['0:00', '0:04', '0:08']);
  });
});
