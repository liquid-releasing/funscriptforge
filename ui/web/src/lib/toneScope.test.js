import { describe, it, expect } from 'vitest';
import {
  SCOPE,
  SCOPE_DEFAULTS,
  localDepths,
  selectRegions,
  makeScopeWeight,
  scopeWeights,
} from './toneScope.js';

// ── helpers ────────────────────────────────────────────────────────────────

/** Actions at a fixed spacing, alternating between `lo` and `hi`. */
function strokes({ fromMs = 0, count, gapMs = 255, lo = 50, hi = 50 }) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ at: fromMs + i * gapMs, pos: i % 2 === 0 ? lo : hi });
  }
  return out;
}

/** A passage of `ms` milliseconds oscillating with peak-to-trough `depth`. */
function passage(fromMs, ms, depth, gapMs = 255) {
  const count = Math.max(2, Math.round(ms / gapMs));
  const lo = Math.round(50 - depth / 2);
  const hi = Math.round(50 + depth / 2);
  return strokes({ fromMs, count, gapMs, lo, hi });
}

function concat(...groups) {
  return groups.flat().sort((a, b) => a.at - b.at);
}

/** Reference implementation: the obvious O(n·k) sweep. */
function localDepthsNaive(actions, windowMs) {
  const half = windowMs / 2;
  return actions.map((a) => {
    const win = actions.filter((b) => b.at >= a.at - half && b.at <= a.at + half);
    if (!win.length) return 0;
    const ps = win.map((b) => b.pos);
    return Math.max(...ps) - Math.min(...ps);
  });
}

// ── localDepths ────────────────────────────────────────────────────────────

describe('localDepths', () => {
  it('measures peak-to-trough, not per-stroke delta', () => {
    // A rising staircase: consecutive deltas are 10, but the window spans 30.
    const acts = [
      { at: 0, pos: 10 }, { at: 100, pos: 20 },
      { at: 200, pos: 30 }, { at: 300, pos: 40 },
    ];
    expect(localDepths(acts, { windowMs: 1000 })).toEqual([30, 30, 30, 30]);
  });

  it('reports 0 for a flat passage', () => {
    const acts = strokes({ count: 10, lo: 50, hi: 50 });
    expect(localDepths(acts, { windowMs: 1000 }).every((d) => d === 0)).toBe(true);
  });

  it('reports the oscillation depth for an alternating passage', () => {
    const acts = passage(0, 5000, 54);
    const d = localDepths(acts, { windowMs: 1000 });
    // 54 split around 50 rounds to 23..77.
    expect(d.slice(2, -2).every((x) => x === 54)).toBe(true);
  });

  it('returns [] for empty input', () => {
    expect(localDepths([], {})).toEqual([]);
    expect(localDepths(null, {})).toEqual([]);
  });

  it('handles a single action', () => {
    expect(localDepths([{ at: 0, pos: 50 }], { windowMs: 1000 })).toEqual([0]);
  });

  it('matches the naive reference on a mixed signal', () => {
    // Differential test — the fast path uses monotonic deques, which are easy
    // to get subtly wrong at the window edges.
    const acts = concat(
      passage(0, 3000, 20),
      passage(3000, 3000, 88),
      passage(6000, 3000, 54),
    );
    for (const windowMs of [200, 600, 1000, 2500]) {
      expect(localDepths(acts, { windowMs })).toEqual(localDepthsNaive(acts, windowMs));
    }
  });

  it('matches the naive reference on irregular spacing', () => {
    // Uneven gaps exercise the "grow right, then shrink left" ordering.
    const acts = [0, 37, 40, 900, 905, 1600, 4000, 4001, 4002, 7000]
      .map((at, i) => ({ at, pos: (i * 37) % 101 }));
    for (const windowMs of [100, 1000, 5000]) {
      expect(localDepths(acts, { windowMs })).toEqual(localDepthsNaive(acts, windowMs));
    }
  });
});

// ── selectRegions ──────────────────────────────────────────────────────────

describe('selectRegions', () => {
  const opts = { thresholdDepth: 70, windowMs: 1000, minRegionMs: 1500 };

  it('selects nothing for EVERYWHERE — that scope has no boundaries', () => {
    const acts = passage(0, 5000, 20);
    expect(selectRegions(acts, { ...opts, scope: SCOPE.EVERYWHERE })).toEqual([]);
  });

  it('finds a quiet passage between loud ones', () => {
    const acts = concat(
      passage(0, 4000, 88),
      passage(4000, 4000, 30),
      passage(8000, 4000, 88),
    );
    const regions = selectRegions(acts, { ...opts, scope: SCOPE.QUIET });
    expect(regions).toHaveLength(1);
    // Boundaries are approximate — the depth window straddles the transition.
    expect(regions[0].startMs).toBeGreaterThan(3000);
    expect(regions[0].endMs).toBeLessThan(9000);
  });

  it('finds the loud passages when the scope is inverted', () => {
    const acts = concat(
      passage(0, 4000, 88),
      passage(4000, 4000, 30),
      passage(8000, 4000, 88),
    );
    const regions = selectRegions(acts, { ...opts, scope: SCOPE.LOUD });
    expect(regions).toHaveLength(2);
  });

  it('★ drops a sub-second quiet dip — that is texture, not a passage', () => {
    // The design is explicit: "the interleaving is WANTED. It is the texture."
    const acts = concat(
      passage(0, 5000, 88),
      passage(5000, 500, 30),
      passage(5500, 5000, 88),
    );
    expect(selectRegions(acts, { ...opts, scope: SCOPE.QUIET })).toEqual([]);
  });

  it('★ keeps a long quiet passage whole across a brief loud burst', () => {
    // Closing holes before removing islands is what makes this one region
    // instead of two; the reverse order splits it.
    const acts = concat(
      passage(0, 6000, 25),
      passage(6000, 400, 90),
      passage(6400, 6000, 25),
    );
    const regions = selectRegions(acts, { ...opts, scope: SCOPE.QUIET });
    expect(regions).toHaveLength(1);
    expect(regions[0].endMs - regions[0].startMs).toBeGreaterThan(11000);
  });

  it('returns one region when the whole chapter is quiet', () => {
    const acts = passage(0, 10000, 20);
    const regions = selectRegions(acts, { ...opts, scope: SCOPE.QUIET });
    expect(regions).toHaveLength(1);
  });

  it('returns nothing when the whole chapter is loud', () => {
    const acts = passage(0, 10000, 95);
    expect(selectRegions(acts, { ...opts, scope: SCOPE.QUIET })).toEqual([]);
  });

  it('handles empty and single-action input', () => {
    expect(selectRegions([], { ...opts, scope: SCOPE.QUIET })).toEqual([]);
    expect(selectRegions([{ at: 0, pos: 50 }], { ...opts, scope: SCOPE.QUIET })).toEqual([]);
  });

  it('never returns overlapping regions', () => {
    const acts = concat(
      passage(0, 3000, 20), passage(3000, 3000, 95),
      passage(6000, 3000, 20), passage(9000, 3000, 95),
      passage(12000, 3000, 20),
    );
    const regions = selectRegions(acts, { ...opts, scope: SCOPE.QUIET });
    for (let i = 1; i < regions.length; i += 1) {
      expect(regions[i].startMs).toBeGreaterThanOrEqual(regions[i - 1].endMs);
    }
  });

  it('★ selects on absolute depth, so the same passage survives a louder neighbour', () => {
    // The portability property the design doc insists on: a colour-based
    // selector would reclassify this passage when the rest of the track gets
    // louder, because the colormap normalises to the track's own p98.
    const quiet = passage(0, 4000, 30);
    const withModerate = concat(quiet, passage(4000, 4000, 70));
    const withExtreme = concat(quiet, passage(4000, 4000, 100));
    const a = selectRegions(withModerate, { ...opts, scope: SCOPE.QUIET });
    const b = selectRegions(withExtreme, { ...opts, scope: SCOPE.QUIET });
    expect(a).toEqual(b);
  });
});

// ── makeScopeWeight ────────────────────────────────────────────────────────

describe('makeScopeWeight', () => {
  const regions = [{ startMs: 1000, endMs: 5000 }];
  const w = (rampMs = 400) => makeScopeWeight(regions, { scope: SCOPE.QUIET, rampMs });

  it('is 1 everywhere for EVERYWHERE', () => {
    const f = makeScopeWeight([], { scope: SCOPE.EVERYWHERE });
    expect(f(0)).toBe(1);
    expect(f(999999)).toBe(1);
  });

  it('is 0 outside the region', () => {
    expect(w()(500)).toBe(0);
    expect(w()(6000)).toBe(0);
  });

  it('is 0 exactly at each edge — no step discontinuity', () => {
    expect(w()(1000)).toBe(0);
    expect(w()(5000)).toBe(0);
  });

  it('reaches full strength in the interior', () => {
    expect(w()(3000)).toBe(1);
  });

  it('ramps linearly in and out', () => {
    expect(w()(1200)).toBeCloseTo(0.5, 6);
    expect(w()(1400)).toBeCloseTo(1, 6);
    expect(w()(4800)).toBeCloseTo(0.5, 6);
  });

  it('★ is continuous — no jump larger than the ramp allows', () => {
    // This is the whole reason scope is a weight. A hard switch here would
    // reintroduce the chapter-seam artifact at every region edge, and chapter
    // 1 of the motivating file has 383 of them.
    const f = w();
    let prev = f(0);
    for (let t = 0; t <= 6000; t += 10) {
      const cur = f(t);
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual(10 / 400 + 1e-9);
      prev = cur;
    }
  });

  it('★ a region shorter than two ramps peaks below 1, and still never jumps', () => {
    const f = makeScopeWeight([{ startMs: 0, endMs: 400 }], { scope: SCOPE.QUIET, rampMs: 400 });
    expect(f(0)).toBe(0);
    expect(f(400)).toBe(0);
    expect(f(200)).toBeCloseTo(0.5, 6);   // length / (2 * ramp)
    expect(f(200)).toBeLessThan(1);
  });

  it('treats rampMs 0 as a hard switch, if someone really asks for one', () => {
    const f = w(0);
    expect(f(1000)).toBe(1);
    expect(f(3000)).toBe(1);
    expect(f(5001)).toBe(0);
  });

  it('is 0 everywhere when nothing was selected', () => {
    const f = makeScopeWeight([], { scope: SCOPE.QUIET });
    expect(f(0)).toBe(0);
    expect(f(5000)).toBe(0);
  });

  it('handles several regions independently', () => {
    const f = makeScopeWeight(
      [{ startMs: 0, endMs: 2000 }, { startMs: 5000, endMs: 7000 }],
      { scope: SCOPE.QUIET, rampMs: 400 },
    );
    expect(f(1000)).toBe(1);
    expect(f(3500)).toBe(0);
    expect(f(6000)).toBe(1);
  });

  it('does not depend on the order regions are passed in', () => {
    const asc = makeScopeWeight(
      [{ startMs: 0, endMs: 2000 }, { startMs: 5000, endMs: 7000 }],
      { scope: SCOPE.QUIET },
    );
    const desc = makeScopeWeight(
      [{ startMs: 5000, endMs: 7000 }, { startMs: 0, endMs: 2000 }],
      { scope: SCOPE.QUIET },
    );
    for (const t of [0, 1000, 3000, 6000, 8000]) expect(desc(t)).toBe(asc(t));
  });
});

// ── scopeWeights (what the tone transform consumes) ────────────────────────

describe('scopeWeights', () => {
  it('is all 1 for EVERYWHERE — the existing behaviour, untouched', () => {
    const acts = passage(0, 5000, 40);
    const ws = scopeWeights(acts, { scope: SCOPE.EVERYWHERE });
    expect(ws).toHaveLength(acts.length);
    expect(ws.every((x) => x === 1)).toBe(true);
  });

  it('aligns index-for-index with the actions', () => {
    const acts = concat(passage(0, 5000, 25), passage(5000, 5000, 95));
    expect(scopeWeights(acts, { scope: SCOPE.QUIET })).toHaveLength(acts.length);
  });

  it('★ weights the quiet stretch and leaves the loud one alone', () => {
    const acts = concat(passage(0, 6000, 25), passage(6000, 6000, 95));
    const ws = scopeWeights(acts, { scope: SCOPE.QUIET, ...SCOPE_DEFAULTS });
    const quiet = acts.map((a, i) => (a.at < 4000 ? ws[i] : null)).filter((x) => x !== null);
    const loud = acts.map((a, i) => (a.at > 8000 ? ws[i] : null)).filter((x) => x !== null);
    expect(Math.max(...quiet)).toBe(1);
    expect(Math.max(...loud)).toBe(0);
  });

  it('★ QUIET and LOUD select disjoint material', () => {
    // Not exact complements — the ramps overlap the boundary from both sides,
    // which is the point. But nowhere should both be at full strength.
    const acts = concat(
      passage(0, 6000, 25), passage(6000, 6000, 95), passage(12000, 6000, 25),
    );
    const q = scopeWeights(acts, { scope: SCOPE.QUIET, ...SCOPE_DEFAULTS });
    const l = scopeWeights(acts, { scope: SCOPE.LOUD, ...SCOPE_DEFAULTS });
    acts.forEach((_, i) => expect(Math.min(q[i], l[i])).toBeLessThan(1));
  });

  it('returns [] for empty input', () => {
    expect(scopeWeights([], { scope: SCOPE.QUIET })).toEqual([]);
    expect(scopeWeights(null, { scope: SCOPE.QUIET })).toEqual([]);
  });

  it('★ stays selected after the quiet parts have been boosted once', () => {
    // The idempotence property from the design doc: "boosting the quiet parts
    // moves p98, so a second pass selects a different set." That is true of a
    // colour-based selector because its threshold is relative to the track.
    // An absolute one keeps selecting the same passage, as long as the boost
    // has not carried it past the threshold.
    //
    // Modelled the way the feature actually works — boost ONLY the selected
    // (quiet) material, leave the loud material alone — rather than by
    // scaling every position, which would push them outside the funscript's
    // 0..100 range and stop being a funscript at all.
    const opts = { scope: SCOPE.QUIET, ...SCOPE_DEFAULTS };
    const before = concat(passage(0, 6000, 30), passage(6000, 6000, 95));
    const after = concat(passage(0, 6000, 52), passage(6000, 6000, 95));

    const rBefore = selectRegions(before, opts);
    const rAfter = selectRegions(after, opts);
    expect(rAfter).toHaveLength(rBefore.length);
    expect(rBefore).toHaveLength(1);
    // The boundary may shift by up to a stroke or two, because the windowed
    // depth crosses the threshold at a slightly different place once the
    // quiet material is louder. The REGION is the same region.
    expect(Math.abs(rAfter[0].startMs - rBefore[0].startMs)).toBeLessThan(600);
    expect(Math.abs(rAfter[0].endMs - rBefore[0].endMs)).toBeLessThan(600);
  });

  it('★ drops out of scope once a boost carries it past the threshold', () => {
    // The other half of the same property, and the reason the feature needs
    // auditioning rather than repeated application: enough boost and the
    // material is no longer quiet, by the same absolute rule. A user running
    // the scope twice must not keep compounding it forever.
    const opts = { scope: SCOPE.QUIET, ...SCOPE_DEFAULTS };
    expect(selectRegions(concat(passage(0, 6000, 88), passage(6000, 6000, 95)), opts))
      .toEqual([]);
  });
});

// ── the defaults are the measured ones ─────────────────────────────────────

describe('SCOPE_DEFAULTS', () => {
  it('sits the threshold between the measured green and red medians', () => {
    // DESIGN_tone_scope.md §2.2: green 54, red 88.
    expect(SCOPE_DEFAULTS.thresholdDepth).toBeGreaterThan(54);
    expect(SCOPE_DEFAULTS.thresholdDepth).toBeLessThan(88);
  });

  it('keeps the minimum region above the sub-second dips it must ignore', () => {
    expect(SCOPE_DEFAULTS.minRegionMs).toBeGreaterThan(1000);
  });

  it('leaves a shortest-allowed region able to reach full strength', () => {
    // If 2 * ramp exceeded minRegionMs, the shortest region the selector can
    // produce could never reach weight 1 — a silent, confusing cap.
    expect(2 * SCOPE_DEFAULTS.rampMs).toBeLessThanOrEqual(SCOPE_DEFAULTS.minRegionMs);
  });
});
