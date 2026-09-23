// Tone Scope — apply a tone to PART of a chapter, selected by a condition on
// the script itself rather than by authoring spans by hand.
//
// Spec: internal/DESIGN_tone_scope.md. Short version of the motivating
// report: "the music gets quiet and the stim should be reduced, but not
// totally gone. And what I learned was that green means GONE."
//
// ── Why this is a weight and not a filter ──────────────────────────────────
//
// The tone transform in ChaptersTab ends on one line:
//
//     const mixed = a.pos + (v - a.pos) * impact;
//
// Scope multiplies `impact` by a per-action weight in 0..1. Everything the
// design asks for follows from that:
//   • "Everywhere" is weight 1 — the existing behaviour, unchanged.
//   • Edge ramping is not a special case; a ramp IS a weight between 0 and 1,
//     so treated and untreated material always meet continuously. Chapter 1 of
//     the motivating file has 383 green segments interleaved with 242 red, and
//     a hard on/off at each edge would reintroduce the chapter-seam artifact
//     removed in 45d0e2c, at far higher frequency.
//   • It composes with every tone for free, because it applies after the
//     per-tone branch rather than inside it.
//
// ── Why absolute depth, not the chart's colour ─────────────────────────────
//
// The velocity colormap normalises to the track's own p98, so "green" is not
// idempotent (boosting the quiet parts moves p98, so a second pass selects a
// different set), not portable between files, and already means different
// things in Overview vs a per-chapter view. Stroke depth in position units is
// absolute: 0..100 means the same thing in every funscript. The UI can still
// say "the quiet parts".
//
// ⚠ Open question from the design doc, deliberately not settled here: depth is
// what the user edits and sees, but BETA EXCURSION is what they feel. The two
// correlate strongly in the measured file and are not identical. Depth is used
// because it is computable before generation; revisit if verification shows
// the selection missing regions the body notices.

/** Where a tone applies. */
export const SCOPE = Object.freeze({
  EVERYWHERE: 'everywhere',
  QUIET: 'quiet',
  LOUD: 'loud',
});

/**
 * Defaults, all measured from `hovixag935_-_milky_muscle_mommy_Katie_v2`
 * (see DESIGN_tone_scope.md §2) rather than picked for roundness.
 */
export const SCOPE_DEFAULTS = Object.freeze({
  // Median stroke depth measured 54 in the green bands against 88 in red.
  // 70 sits between them. Absolute position units, so this is portable.
  thresholdDepth: 70,
  // Window for the local depth measure. Green and red share an identical
  // 255 ms stroke spacing in the measured file, so ~1 s spans roughly four
  // strokes — enough to be stable, short enough to track real changes.
  windowMs: 1000,
  // "Ignore sub-second dips; they are texture, not quiet passages." The
  // interleaving is WANTED — it is what the user called the texture.
  minRegionMs: 1500,
  // Blend over each edge. Long enough to be inaudible as a switch, short
  // enough that a 1.5 s region still reaches meaningful weight.
  rampMs: 400,
});

// ---------------------------------------------------------------------------
// Local stroke depth

/**
 * Peak-to-trough position range within a centred sliding window, one value
 * per action.
 *
 * O(n) via monotonic deques — the window only ever moves forward, so each
 * action is pushed and popped at most once from each deque. `localDepthsNaive`
 * in the tests is the reference implementation this is checked against.
 */
export function localDepths(actions, { windowMs = SCOPE_DEFAULTS.windowMs } = {}) {
  const n = actions?.length ?? 0;
  if (!n) return [];
  const half = Math.max(0, windowMs) / 2;
  const at = (i) => actions[i].at;
  const pos = (i) => actions[i].pos;

  const out = new Array(n);
  // Indices, positions monotonically decreasing (maxQ) / increasing (minQ).
  const maxQ = [];
  const minQ = [];
  let lo = 0;  // first index inside the window
  let hi = 0;  // first index NOT yet added

  for (let i = 0; i < n; i += 1) {
    const from = at(i) - half;
    const to = at(i) + half;
    // Grow the right edge.
    while (hi < n && at(hi) <= to) {
      while (maxQ.length && pos(maxQ[maxQ.length - 1]) <= pos(hi)) maxQ.pop();
      maxQ.push(hi);
      while (minQ.length && pos(minQ[minQ.length - 1]) >= pos(hi)) minQ.pop();
      minQ.push(hi);
      hi += 1;
    }
    // Shrink the left edge.
    while (lo < hi && at(lo) < from) {
      if (maxQ[0] === lo) maxQ.shift();
      if (minQ[0] === lo) minQ.shift();
      lo += 1;
    }
    out[i] = maxQ.length && minQ.length
      ? pos(maxQ[0]) - pos(minQ[0])
      : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Region selection

/**
 * Collapse a per-action boolean into [start, end) runs in milliseconds.
 *
 * A run ends at the timestamp of the first action that is not in it, so runs
 * tile the timeline with no gaps and no overlap. The final run is extended to
 * the last action's timestamp.
 */
function runsFromFlags(actions, flags) {
  const runs = [];
  let i = 0;
  while (i < flags.length) {
    const value = flags[i];
    const startIdx = i;
    while (i < flags.length && flags[i] === value) i += 1;
    runs.push({
      value,
      startMs: actions[startIdx].at,
      endMs: i < flags.length ? actions[i].at : actions[flags.length - 1].at,
    });
  }
  return runs;
}

/**
 * Morphological cleanup, in this order and for this reason:
 *
 *   1. CLOSE holes — a brief loud burst inside a long quiet passage should
 *      not split it in two. Merging first keeps the passage whole.
 *   2. REMOVE islands — a brief quiet dip inside loud material is texture,
 *      not a quiet passage, and the design is explicit that the interleaving
 *      is wanted rather than something to iron out.
 *
 * Reversing the order would let step 1 resurrect islands that step 2 had
 * just removed.
 */
function cleanRuns(runs, minRegionMs) {
  if (!runs.length || minRegionMs <= 0) return runs;
  const span = (r) => r.endMs - r.startMs;

  const closed = [];
  for (const run of runs) {
    const prev = closed[closed.length - 1];
    // A short UNSELECTED run with selected material on both sides is a hole.
    const isInteriorHole =
      !run.value && prev?.value && span(run) < minRegionMs;
    if (isInteriorHole) {
      // Absorb it into the preceding selected run; the next selected run
      // will merge into the same one below.
      prev.endMs = run.endMs;
      continue;
    }
    if (prev && prev.value === run.value) prev.endMs = run.endMs;
    else closed.push({ ...run });
  }

  const opened = [];
  for (const run of closed) {
    const prev = opened[opened.length - 1];
    if (run.value && span(run) < minRegionMs) {
      // Too short to be a passage — hand it back to the surrounding material.
      if (prev && !prev.value) prev.endMs = run.endMs;
      else opened.push({ ...run, value: false });
      continue;
    }
    if (prev && prev.value === run.value) prev.endMs = run.endMs;
    else opened.push({ ...run });
  }
  return opened;
}

/**
 * The time spans a scope selects, as `[{ startMs, endMs }]`.
 *
 * Returns [] for EVERYWHERE — that scope has no regions because it has no
 * boundaries; `makeScopeWeight` handles it as a constant instead.
 */
export function selectRegions(actions, {
  scope = SCOPE.EVERYWHERE,
  thresholdDepth = SCOPE_DEFAULTS.thresholdDepth,
  windowMs = SCOPE_DEFAULTS.windowMs,
  minRegionMs = SCOPE_DEFAULTS.minRegionMs,
} = {}) {
  if (scope === SCOPE.EVERYWHERE) return [];
  const n = actions?.length ?? 0;
  if (n < 2) return [];

  const depths = localDepths(actions, { windowMs });
  const wantQuiet = scope === SCOPE.QUIET;
  const flags = depths.map((d) => (wantQuiet ? d < thresholdDepth : d >= thresholdDepth));

  return cleanRuns(runsFromFlags(actions, flags), minRegionMs)
    .filter((r) => r.value && r.endMs > r.startMs)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }));
}

// ---------------------------------------------------------------------------
// Weight envelope

/**
 * Build `(atMs) => weight in 0..1` from selected regions.
 *
 * Inside a region the weight ramps 0 → 1 over `rampMs` at each edge:
 *
 *     min((t - start) / ramp, (end - t) / ramp, 1)
 *
 * A region shorter than 2·ramp never reaches 1 — it peaks at length/(2·ramp)
 * in the middle. That is deliberate and needs no special case: a barely
 * qualifying region gets a correspondingly gentle treatment instead of a
 * full-strength stab.
 *
 * Regions touching the chapter edge ramp too. The neighbouring material
 * belongs to another chapter which may carry a different tone, so meeting it
 * continuously is the same property we want everywhere else.
 */
export function makeScopeWeight(regions, {
  scope = SCOPE.EVERYWHERE,
  rampMs = SCOPE_DEFAULTS.rampMs,
} = {}) {
  if (scope === SCOPE.EVERYWHERE) return () => 1;
  const sorted = [...(regions ?? [])].sort((a, b) => a.startMs - b.startMs);
  if (!sorted.length) return () => 0;
  const ramp = Math.max(0, rampMs);

  return (atMs) => {
    // Regions never overlap, so the last one starting at or before `atMs` is
    // the only candidate. Linear scan is fine for chapter-sized inputs; swap
    // for a binary search if this ever runs over a whole track.
    let found = null;
    for (const r of sorted) {
      if (r.startMs > atMs) break;
      found = r;
    }
    if (!found || atMs > found.endMs) return 0;
    if (ramp === 0) return 1;
    const rise = (atMs - found.startMs) / ramp;
    const fall = (found.endMs - atMs) / ramp;
    return Math.max(0, Math.min(1, rise, fall));
  };
}

/**
 * Convenience: the weight for each action, aligned index-for-index.
 *
 * This is what the tone transform multiplies `impact` by.
 */
export function scopeWeights(actions, options = {}) {
  const scope = options.scope ?? SCOPE.EVERYWHERE;
  const n = actions?.length ?? 0;
  if (!n) return [];
  if (scope === SCOPE.EVERYWHERE) return new Array(n).fill(1);
  const regions = selectRegions(actions, options);
  const weightAt = makeScopeWeight(regions, { scope, rampMs: options.rampMs });
  return actions.map((a) => weightAt(a.at));
}
