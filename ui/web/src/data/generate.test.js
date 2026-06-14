import { describe, it, expect } from 'vitest';
import {
  sampleCurve,
  DEFAULT_RANGE, DEFAULT_PACE,
  RANGE_PRESETS, PACE_PRESETS, presetIdOf,
  generateFromLanes, diagnose, verdictFor, topFix, deadAirNote, TARGET_DECILES,
  SPEED_CEIL, DEAD_AIR_MS,
} from './generate.js';

const flat = (v) => [{ t: 0, v }, { t: 1, v }];

describe('sampleCurve', () => {
  it('returns endpoint values at and beyond the bounds', () => {
    const pts = [{ t: 0, v: 0.2 }, { t: 1, v: 0.8 }];
    expect(sampleCurve(pts, 0)).toBe(0.2);
    expect(sampleCurve(pts, 1)).toBe(0.8);
    expect(sampleCurve(pts, -0.5)).toBe(0.2); // clamps below
    expect(sampleCurve(pts, 1.5)).toBe(0.8); // clamps above
  });

  it('is smoothstep at the midpoint (0.5 between two points)', () => {
    // smoothstep(0.5) = 0.5, so the mid-time value is the linear midpoint
    expect(sampleCurve([{ t: 0, v: 0 }, { t: 1, v: 1 }], 0.5)).toBeCloseTo(0.5, 6);
  });

  it('holds constant for a flat curve', () => {
    expect(sampleCurve(flat(0.42), 0.3)).toBeCloseTo(0.42, 6);
    expect(sampleCurve(flat(0.42), 0.7)).toBeCloseTo(0.42, 6);
  });

  it('falls back to 0.5 for empty points', () => {
    expect(sampleCurve([], 0.5)).toBe(0.5);
  });
});

describe('presetIdOf', () => {
  it('matches a known preset by control points', () => {
    expect(presetIdOf(RANGE_PRESETS[1].pts, RANGE_PRESETS)).toBe('full');
    expect(presetIdOf(PACE_PRESETS[1].pts, PACE_PRESETS)).toBe('burn');
  });

  it('returns null for control points that match no preset', () => {
    expect(presetIdOf(DEFAULT_RANGE, RANGE_PRESETS)).toBeNull();
    expect(presetIdOf(DEFAULT_PACE, PACE_PRESETS)).toBeNull();
  });
});

describe('generateFromLanes', () => {
  it('produces actions in time order with positions in [0,100]', () => {
    const acts = generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 60000);
    expect(acts.length).toBeGreaterThan(10);
    for (let i = 0; i < acts.length; i += 1) {
      expect(acts[i].pos).toBeGreaterThanOrEqual(0);
      expect(acts[i].pos).toBeLessThanOrEqual(100);
      if (i > 0) expect(acts[i].at).toBeGreaterThan(acts[i - 1].at);
    }
    expect(acts[acts.length - 1].at).toBeLessThan(60000);
  });

  it('is deterministic — same curves yield identical output', () => {
    const a = generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 30000);
    const b = generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 30000);
    expect(b).toEqual(a);
  });

  it('higher Pace yields more strokes (busier)', () => {
    const slow = generateFromLanes(flat(0.5), flat(0.1), 60000);
    const fast = generateFromLanes(flat(0.5), flat(0.9), 60000);
    expect(fast.length).toBeGreaterThan(slow.length);
  });

  it('higher Range yields wider stroke amplitude (more reach)', () => {
    const reach = (pts) => {
      const acts = generateFromLanes(pts, flat(0.5), 30000);
      return Math.max(...acts.map((a) => a.pos)) - Math.min(...acts.map((a) => a.pos));
    };
    expect(reach(flat(0.95))).toBeGreaterThan(reach(flat(0.2)));
  });

  it('does not run away on a tiny/zero duration', () => {
    expect(generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 0).length).toBeLessThan(2);
    expect(generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 1).length).toBeLessThanOrEqual(2);
  });
});

describe('diagnose', () => {
  it('flags the weak default shape: low rails, low contrast, normalized deciles', () => {
    const d = diagnose(generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 60000));
    expect(d.rails).toBeLessThan(0.22); // mid-bunched, barely touches rails
    expect(d.dynamics).toBeLessThan(0.55);
    expect(d.deciles).toHaveLength(10);
    expect(Math.max(...d.deciles)).toBeCloseTo(1, 6); // normalized to peak
  });

  it('scores a full-range, arc-shaped script as strong', () => {
    const d = diagnose(generateFromLanes(RANGE_PRESETS[1].pts, PACE_PRESETS[1].pts, 60000));
    expect(d.rails).toBeGreaterThan(0.22);
    expect(d.dynamics).toBeGreaterThan(diagnose(generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 60000)).dynamics);
  });

  it('handles empty input without throwing', () => {
    const d = diagnose([]);
    expect(d.dynamics).toBe(0);
    expect(d.deciles).toHaveLength(10);
  });
});

describe('verdictFor', () => {
  it('maps the dynamics score to a one-word verdict', () => {
    expect(verdictFor(0.2)).toEqual({ word: 'Flat', tone: 'warn' });
    expect(verdictFor(0.5)).toEqual({ word: 'Decent', tone: 'info' });
    expect(verdictFor(0.8)).toEqual({ word: 'Dynamic', tone: 'success' });
  });

  it('uses inclusive thresholds at the boundaries', () => {
    expect(verdictFor(0.45).word).toBe('Decent');
    expect(verdictFor(0.7).word).toBe('Dynamic');
  });
});

describe('topFix', () => {
  it('prioritizes filling the rails when reach is poor', () => {
    expect(topFix({ rails: 0.05, dynamics: 0.2 })).toMatchObject({ lane: 'range', presetId: 'full' });
  });

  it('suggests an arc when rails are okay but contrast is low', () => {
    expect(topFix({ rails: 0.5, dynamics: 0.3 })).toMatchObject({ lane: 'pace', presetId: 'burn' });
  });

  it('offers no fix once the script is healthy', () => {
    expect(topFix({ rails: 0.5, dynamics: 0.8 })).toBeNull();
  });

  it('every fix names a preset that actually exists', () => {
    const railsFix = topFix({ rails: 0.05, dynamics: 0.2 });
    const arcFix = topFix({ rails: 0.5, dynamics: 0.3 });
    expect(RANGE_PRESETS.some((p) => p.id === railsFix.presetId)).toBe(true);
    expect(PACE_PRESETS.some((p) => p.id === arcFix.presetId)).toBe(true);
  });

  it('eases the pace FIRST when the script is too fast (device safety)', () => {
    // tooFast outranks a rails problem — a brutal script must not read green.
    expect(topFix({ rails: 0.05, dynamics: 0.9, tooFast: true }))
      .toMatchObject({ lane: 'pace', presetId: 'gentle' });
    expect(PACE_PRESETS.some((p) => p.id === 'gentle')).toBe(true);
  });

  it('escalates to SHORTEN THE RANGE when pace is already eased but still too fast', () => {
    // The dead-end fix: easing the pace can't pull a near-full-range track
    // under the speed ceiling — the remaining lever is shorter strokes.
    const fix = topFix({ rails: 0.5, dynamics: 0.9, tooFast: true, paceEased: true });
    expect(fix).toMatchObject({ lane: 'range', presetId: 'tease' });
    expect(RANGE_PRESETS.some((p) => p.id === fix.presetId)).toBe(true);
  });

  it('still eases the pace first when pace is NOT yet eased', () => {
    expect(topFix({ rails: 0.5, dynamics: 0.9, tooFast: true, paceEased: false }))
      .toMatchObject({ lane: 'pace', presetId: 'gentle' });
  });
});

describe('diagnose — speed + coverage honesty', () => {
  // rail-to-rail strokes 50ms apart => ~2000 units/sec => flash => too fast
  const fast = Array.from({ length: 40 }, (_, i) => ({ at: i * 50, pos: i % 2 ? 0 : 100 }));
  // gentle 40<->60 strokes a second apart => ~20 units/sec => safe
  const gentle = Array.from({ length: 40 }, (_, i) => ({ at: i * 1000, pos: i % 2 ? 40 : 60 }));

  it('flags a brutally fast script as tooFast', () => {
    const d = diagnose(fast);
    expect(d.avgSpeed).toBeGreaterThan(SPEED_CEIL);
    expect(d.flashPct).toBeGreaterThan(0.5);
    expect(d.tooFast).toBe(true);
  });

  it('does not flag a gentle script', () => {
    const d = diagnose(gentle);
    expect(d.avgSpeed).toBeLessThan(SPEED_CEIL);
    expect(d.tooFast).toBe(false);
  });

  it('measures dead air from the lead-in gap when durationMs is known', () => {
    // first stroke at 30s of a 60s track => 30s of dead air at the top
    const late = [{ at: 30000, pos: 0 }, { at: 30500, pos: 100 }, { at: 31000, pos: 0 }];
    const d = diagnose(late, 60000);
    expect(d.deadAirMs).toBeGreaterThanOrEqual(30000);
    expect(deadAirNote(d)).toMatch(/no beats/);
  });

  it('reports no dead air for a well-covered script', () => {
    expect(deadAirNote(diagnose(gentle, 40000))).toBeNull();
    expect(DEAD_AIR_MS).toBeGreaterThan(0);
  });
});

describe('the diagnosis ↔ fix loop closes', () => {
  it('applying the suggested fixes raises the verdict from Flat toward Dynamic', () => {
    const before = diagnose(generateFromLanes(DEFAULT_RANGE, DEFAULT_PACE, 60000));
    expect(verdictFor(before.dynamics).word).toBe('Flat');
    // apply both canonical fixes (full rails + slow-burn arc)
    const after = diagnose(generateFromLanes(RANGE_PRESETS[1].pts, PACE_PRESETS[1].pts, 60000));
    expect(after.dynamics).toBeGreaterThan(before.dynamics);
    expect(verdictFor(after.dynamics).word).not.toBe('Flat');
  });
});

describe('TARGET_DECILES', () => {
  it('is a 10-bin spread weighted toward the rails (a rough U)', () => {
    expect(TARGET_DECILES).toHaveLength(10);
    expect(TARGET_DECILES[0]).toBeGreaterThan(TARGET_DECILES[4]); // bottom rail > middle
    expect(TARGET_DECILES[9]).toBeGreaterThan(TARGET_DECILES[5]); // top rail > middle
  });
});
