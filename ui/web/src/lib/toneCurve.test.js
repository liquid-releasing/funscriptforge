import { describe, it, expect } from 'vitest';
import { applyTone } from './toneCurve.js';
import { SCOPE, SCOPE_DEFAULTS } from './toneScope.js';

// Tones as ChaptersTab passes them — applyTone only reads `.id`.
const CLIMAX = { id: 'climax' };
const NONE = { id: 'none' };
const TAME = { id: 'tame' };

const CLIMAX_PARAMS = { impact: 1, contrast: 0.74, density: 1 };

/** A passage of `ms` oscillating with peak-to-trough `depth`, 255 ms apart. */
function passage(fromMs, ms, depth, gapMs = 255) {
  const count = Math.max(2, Math.round(ms / gapMs));
  const lo = Math.round(50 - depth / 2);
  const hi = Math.round(50 + depth / 2);
  return Array.from({ length: count }, (_, i) => ({
    at: fromMs + i * gapMs,
    pos: i % 2 === 0 ? lo : hi,
  }));
}

const concat = (...g) => g.flat().sort((a, b) => a.at - b.at);
/** Peak-to-trough of the actions in [from, to). */
const depthIn = (acts, from, to) => {
  const win = acts.filter((a) => a.at >= from && a.at < to);
  if (!win.length) return 0;
  return Math.max(...win.map((a) => a.pos)) - Math.min(...win.map((a) => a.pos));
};

describe('applyTone — behaviour that predates Tone Scope', () => {
  it('passes an untoned chapter straight through', () => {
    const acts = passage(0, 4000, 54);
    expect(applyTone(acts, 0, 4000, NONE, {})).toEqual(
      acts.map((a) => ({ at: a.at, pos: a.pos })),
    );
  });

  it('passes a tame chapter through — its real transform is the backend one', () => {
    const acts = passage(0, 4000, 54);
    expect(applyTone(acts, 0, 4000, TAME, {})).toEqual(
      acts.map((a) => ({ at: a.at, pos: a.pos })),
    );
  });

  it('returns [] for empty input or an empty slice', () => {
    expect(applyTone([], 0, 1000, CLIMAX, CLIMAX_PARAMS)).toEqual([]);
    expect(applyTone(null, 0, 1000, CLIMAX, CLIMAX_PARAMS)).toEqual([]);
    expect(applyTone(passage(0, 1000, 50), 50000, 60000, CLIMAX, CLIMAX_PARAMS)).toEqual([]);
  });

  it('clamps into the funscript position range', () => {
    const acts = passage(0, 4000, 98);
    const out = applyTone(acts, 0, 4000, CLIMAX, { impact: 1, contrast: 1, density: 1 });
    for (const a of out) {
      expect(a.pos).toBeGreaterThanOrEqual(0);
      expect(a.pos).toBeLessThanOrEqual(100);
      expect(Number.isInteger(a.pos)).toBe(true);
    }
  });

  it('leaves the timestamps alone — climax changes depth, not tempo', () => {
    // The measured file showed green, yellow and red sharing an identical
    // 255 ms spacing; the complaint was about depth. A tone that moved
    // timing would be solving a different problem.
    const acts = passage(0, 4000, 54);
    const out = applyTone(acts, 0, 4000, CLIMAX, CLIMAX_PARAMS);
    expect(out.map((a) => a.at)).toEqual(acts.map((a) => a.at));
  });

  it('impact 0 is a no-op', () => {
    const acts = passage(0, 4000, 54);
    expect(applyTone(acts, 0, 4000, CLIMAX, { ...CLIMAX_PARAMS, impact: 0 }))
      .toEqual(acts.map((a) => ({ at: a.at, pos: a.pos })));
  });

  it('★ climax at contrast 0.74 lifts the measured green median toward red', () => {
    // DESIGN_tone_scope.md §4.3: 54 * (1 + 0.74 * 0.85) ≈ 88, which is the
    // measured red median. This pins the doc's default to the real math.
    const acts = passage(0, 4000, 54);
    const out = applyTone(acts, 0, 4000, CLIMAX, CLIMAX_PARAMS);
    expect(depthIn(out, 0, 4000)).toBeGreaterThanOrEqual(86);
    expect(depthIn(out, 0, 4000)).toBeLessThanOrEqual(90);
  });
});

describe('applyTone — Tone Scope', () => {
  // A chapter that is quiet for its first half and loud for its second.
  const CHAPTER_END = 24000;
  const acts = concat(passage(0, 12000, 30), passage(12000, 12000, 95));
  const scoped = (scope) =>
    applyTone(acts, 0, CHAPTER_END, CLIMAX, { ...CLIMAX_PARAMS, scope, ...SCOPE_DEFAULTS });

  it('★ EVERYWHERE is byte-identical to omitting scope entirely', () => {
    // The regression that matters most: existing projects must not change.
    const before = applyTone(acts, 0, CHAPTER_END, CLIMAX, CLIMAX_PARAMS);
    const after = applyTone(acts, 0, CHAPTER_END, CLIMAX,
      { ...CLIMAX_PARAMS, scope: SCOPE.EVERYWHERE });
    expect(after).toEqual(before);
  });

  it('★ QUIET lifts the quiet half and leaves the loud half untouched', () => {
    const out = scoped(SCOPE.QUIET);
    const src = new Map(acts.map((a) => [a.at, a.pos]));
    // Quiet half: lifted.
    expect(depthIn(out, 2000, 9000)).toBeGreaterThan(depthIn(acts, 2000, 9000));
    // Loud half: every action exactly as it was.
    for (const a of out.filter((x) => x.at > 14000)) {
      expect(a.pos).toBe(src.get(a.at));
    }
  });

  it('★ LOUD is the mirror image — the user\'s "tone down the loud parts"', () => {
    const out = scoped(SCOPE.LOUD);
    const src = new Map(acts.map((a) => [a.at, a.pos]));
    for (const a of out.filter((x) => x.at < 10000)) {
      expect(a.pos).toBe(src.get(a.at));
    }
    expect(depthIn(out, 14000, 22000)).not.toBe(depthIn(acts, 14000, 22000));
  });

  // How abruptly the treatment switches on: the largest change, between two
  // consecutive actions, in how far each one moved from its source. A smooth
  // blend keeps this small; a hard switch spikes it.
  const worstStep = (rampMs) => {
    const out = applyTone(acts, 0, CHAPTER_END, CLIMAX,
      { ...CLIMAX_PARAMS, scope: SCOPE.QUIET, ...SCOPE_DEFAULTS, rampMs });
    const src = new Map(acts.map((a) => [a.at, a.pos]));
    const deltas = out.map((a) => Math.abs(a.pos - src.get(a.at)));
    let worst = 0;
    for (let i = 1; i < deltas.length; i += 1) {
      worst = Math.max(worst, Math.abs(deltas[i] - deltas[i - 1]));
    }
    return worst;
  };

  it('★ a longer ramp gives a smoother edge — monotonically', () => {
    // Stated as a comparison rather than an absolute bound, because the
    // absolute numbers depend on how loud the in-scope material is. Measured
    // at the real file's 255 ms stroke spacing: 9 / 5 / 4 / 3 units.
    const at255 = worstStep(255);
    const at500 = worstStep(500);
    const at600 = worstStep(600);
    const at1000 = worstStep(1000);
    expect(at500).toBeLessThan(at255);
    expect(at600).toBeLessThanOrEqual(at500);
    expect(at1000).toBeLessThan(at600);
  });

  it('★ the ramp parameter reaches the transform at all', () => {
    // The regression this caught for real: applyTone forwarded only `scope`
    // to scopeWeights, so rampMs (and every other tuning field) was dropped
    // and all ramp lengths produced byte-identical output. Nothing else in
    // the suite would have noticed.
    expect(worstStep(1000)).not.toBe(worstStep(255));
  });

  it('★ a ramp shorter than the stroke spacing is worse than none', () => {
    // Aliasing: the ramp is only ever sampled at action timestamps, so below
    // ~2 stroke intervals it cannot be represented. This is why the default
    // is set from the spacing rather than picked for feel.
    expect(worstStep(255)).toBeGreaterThan(worstStep(0));
  });

  it('★ scope composes with impact rather than replacing it', () => {
    // Scope says WHERE, impact says HOW MUCH. Halving impact must halve the
    // change inside the scope, not move the scope.
    const full = scoped(SCOPE.QUIET);
    const half = applyTone(acts, 0, CHAPTER_END, CLIMAX,
      { ...CLIMAX_PARAMS, impact: 0.5, scope: SCOPE.QUIET, ...SCOPE_DEFAULTS });
    const src = new Map(acts.map((a) => [a.at, a.pos]));
    const changed = (o) => o.filter((a) => a.pos !== src.get(a.at)).map((a) => a.at);
    // Same footprint (modulo actions whose half-change rounds away)...
    expect(new Set(changed(half)).size).toBeGreaterThan(0);
    expect(Math.min(...changed(half))).toBeGreaterThanOrEqual(Math.min(...changed(full)));
    // ...but a smaller change inside it.
    const amp = (o) => depthIn(o, 2000, 9000);
    expect(amp(half)).toBeLessThan(amp(full));
    expect(amp(half)).toBeGreaterThan(depthIn(acts, 2000, 9000));
  });

  it('★ scope applies to every tone, not just climax', () => {
    // It sits after the per-tone branch, so this should hold for free. If a
    // future tone is added inside the wrong scope this catches it.
    for (const id of ['tender', 'build', 'tease', 'edge', 'dominant']) {
      const params = {
        impact: 1, scope: SCOPE.QUIET, ...SCOPE_DEFAULTS,
        ceiling: 100, softness: 0.5, ramp: 0.5, headroom: 10,
        release: 0.5, withhold: 0.5, drop: 0.5, hold: 0.5,
        recenter: 0.5, rhythm: 0.5, contrast: 0.74, density: 1,
      };
      const out = applyTone(acts, 0, CHAPTER_END, { id }, params);
      const src = new Map(acts.map((a) => [a.at, a.pos]));
      // The loud half is out of scope for every one of them.
      const loudChanged = out.filter((a) => a.at > 14000 && a.pos !== src.get(a.at));
      expect(loudChanged).toEqual([]);
    }
  });

  it('falls back to EVERYWHERE when scope is absent or unrecognised', () => {
    const base = applyTone(acts, 0, CHAPTER_END, CLIMAX, CLIMAX_PARAMS);
    expect(applyTone(acts, 0, CHAPTER_END, CLIMAX, { ...CLIMAX_PARAMS, scope: undefined }))
      .toEqual(base);
  });

  it('still passes an untoned chapter through whatever the scope', () => {
    expect(applyTone(acts, 0, CHAPTER_END, NONE, { scope: SCOPE.QUIET }))
      .toEqual(acts.map((a) => ({ at: a.at, pos: a.pos })));
  });
});
