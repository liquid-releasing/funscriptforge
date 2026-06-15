// Passages — span-relative intensity envelopes layered over the chapter run.
//
// JS mirror of `forge/passages.py` (KEEP IN SYNC). The shape math here only
// *previews* the curve in the UI; the actual scaling is baked at generation /
// export by the Python engine (e-stim volume + multi-axis amplitude). A passage
// answers "how much" over a scene-scale span; per-chapter Character/Mechanical
// answers "what". See project_passage_arcs_cross_modality memory.

// The five envelope shapes. Steady is the identity (no-op) default.
export const PASSAGE_SHAPES = [
  { id: 'steady',  label: 'Steady',  glyph: '▄▄▄▄',  desc: 'No change — the neutral default. A Steady passage does nothing.' },
  { id: 'build',   label: 'Build',   glyph: '▁▃▅▇',  desc: 'Rises from floor to ceiling across the span.' },
  { id: 'sustain', label: 'Sustain', glyph: '▇▇▇▇',  desc: 'Holds at the ceiling for the whole span.' },
  { id: 'release', label: 'Release', glyph: '▇▅▃▁',  desc: 'Eases from ceiling down to floor — the wind-down ("afterglow").' },
  { id: 'swell',   label: 'Swell',   glyph: '▁▅▇▅▁', desc: 'Rises to a peak at the middle, then eases back.' },
];

export const SHAPE_BY_ID = Object.fromEntries(PASSAGE_SHAPES.map((s) => [s.id, s]));

// The arc is ONE eased parametric envelope; the five named shapes are presets
// of it (rise_point, fall_point). Mirrors forge/passages.py::SHAPE_POINTS.
export const SHAPE_POINTS = {
  steady:  [0.0, 1.0],
  build:   [1.0, 1.0],
  sustain: [0.0, 1.0],
  release: [0.0, 0.0],
  swell:   [0.5, 0.5],
};

function smoothstep(t) {
  const x = t < 0 ? 0 : (t > 1 ? 1 : t);
  return x * x * (3 - 2 * x);
}

// Eased multiplier at `frac`: rise floor→ceiling by `risePoint`, hold to
// `fallPoint`, ease back to floor by the end. Mirrors envelope_factor().
export function envelopeFactor(frac, floor, ceiling, risePoint, fallPoint) {
  const f = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
  const lo = floor;
  const hi = ceiling;
  let rp = risePoint < 0 ? 0 : (risePoint > 1 ? 1 : risePoint);
  let fp = fallPoint < 0 ? 0 : (fallPoint > 1 ? 1 : fallPoint);
  if (fp < rp) fp = rp;
  if (f <= rp) return rp <= 0 ? hi : lo + (hi - lo) * smoothstep(f / rp);
  if (f <= fp) return hi;
  if (fp >= 1) return hi;
  return hi - (hi - lo) * smoothstep((f - fp) / (1 - fp));
}

// Multiplier at fractional position `frac` (0..1). Explicit rise/fall win;
// else derived from the named shape. Mirrors forge/passages.py::shape_factor.
export function shapeFactor(shape, frac, floor, ceiling, risePoint, fallPoint) {
  const s = (shape || 'steady').toLowerCase();
  if (s === 'steady' && risePoint == null && fallPoint == null) return 1.0;
  const [rpDef, fpDef] = SHAPE_POINTS[s] || [1.0, 1.0];
  const rp = risePoint == null ? rpDef : risePoint;
  const fp = fallPoint == null ? fpDef : fallPoint;
  return envelopeFactor(frac, floor, ceiling, rp, fp);
}

// Effective rise/fall for a record (explicit, else the shape's preset points).
export function effectivePoints(rec) {
  const [rpDef, fpDef] = SHAPE_POINTS[(rec?.shape || 'steady').toLowerCase()] || [1.0, 1.0];
  return [rec?.risePoint ?? rpDef, rec?.fallPoint ?? fpDef];
}

// Sample a passage's envelope as N points in [0,1] (for sparkline previews).
export function sampleEnvelope(shape, floor, ceiling, n = 24, risePoint, fallPoint) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const frac = n === 1 ? 0 : i / (n - 1);
    out.push(shapeFactor(shape, frac, floor, ceiling, risePoint, fallPoint));
  }
  return out;
}

let _uid = 0;
export function newPassageId() {
  _uid += 1;
  return `p${Date.now().toString(36)}_${_uid}`;
}

// A fresh passage spanning the given chapter index range, defaulting to Build.
// Carries explicit rise/fall handles (the parametric model) seeded from the
// shape so a hand-made passage is fully defined.
export function makePassage(beginIdx, endIdx, shape = 'build') {
  const [risePoint, fallPoint] = SHAPE_POINTS[shape] || [1.0, 1.0];
  return { id: newPassageId(), shape, beginIdx, endIdx, floor: 0.4, ceiling: 1.0, risePoint, fallPoint };
}

// ── Passage PRESETS — the resolved "one shared arc, preset-selected" model ──
// A passage is the depth/density of the SECONDARY world: ONE arc set across the
// whole chapter run that gives e-stim / mechanical / body their overall
// direction (each layer performs it its own way). Beta = presets only, same UI
// as Generate's Range/Pace lanes. Each preset maps onto the EXISTING passage
// data model (a single full-span passage of one shape), so forge/passages.py is
// untouched. See DESIGN_DECISIONS.md (Passages section).
// Each preset is a tuple of the four envelope params (start/floor, peak/ceiling,
// risePoint, fallPoint) over one full-span passage — "our own set", same spirit
// as Generate's Range/Pace presets. The sliders fine-tune any of them.
export const PASSAGE_PRESETS = [
  { id: 'hold',      label: 'Hold steady',     shape: 'steady',  floor: 1.0,  ceiling: 1.0,  risePoint: 0.0,  fallPoint: 1.0,  hint: 'no arc — flat throughout' },
  { id: 'hum',       label: 'Warm hum',        shape: 'sustain', floor: 0.55, ceiling: 0.58, risePoint: 0.0,  fallPoint: 1.0,  hint: 'a low, steady presence' },
  { id: 'build',     label: 'Build the charge', shape: 'build',  floor: 0.3,  ceiling: 1.0,  risePoint: 1.0,  fallPoint: 1.0,  hint: 'rises across the whole run' },
  { id: 'hold-high', label: 'Build & hold',    shape: 'build',   floor: 0.35, ceiling: 1.0,  risePoint: 0.55, fallPoint: 1.0,  hint: 'climbs, then holds at the top' },
  { id: 'edge',      label: 'Edge & release',  shape: 'swell',   floor: 0.35, ceiling: 1.0,  risePoint: 0.5,  fallPoint: 0.6,  hint: 'peak in the middle, then ease' },
  { id: 'release',   label: 'Long release',    shape: 'release', floor: 0.25, ceiling: 0.95, risePoint: 0.0,  fallPoint: 0.15, hint: 'starts high, eases down' },
];

// Build the passages array for a preset over `n` chapters. The neutral
// "Hold steady" is a no-op → no passage rows at all.
export function passagesForPreset(presetId, n) {
  const pr = PASSAGE_PRESETS.find((p) => p.id === presetId);
  if (!pr || pr.shape === 'steady' || n <= 0) return [];
  const p = makePassage(0, Math.max(0, n - 1), pr.shape);
  return [{ ...p, floor: pr.floor, ceiling: pr.ceiling, risePoint: pr.risePoint, fallPoint: pr.fallPoint }];
}

// Sample a preset's envelope (0..1) for the read-only lane preview.
export function presetSamples(presetId, count = 48) {
  const pr = PASSAGE_PRESETS.find((p) => p.id === presetId) || PASSAGE_PRESETS[0];
  return sampleEnvelope(pr.shape, pr.floor, pr.ceiling, count, pr.risePoint, pr.fallPoint);
}

// ── Resolve + sample at absolute time (mirrors forge/passages.py) ──
// These let the UI show the SAME multiplier the Python engine bakes, so the
// provenance badge / per-channel tag numbers match the rendered output.

// Resolve authored passage records to absolute-time spans against the chapter
// list. `chapters` carry atMs/endMs (camelCase) or at_ms/end_ms. Steady and
// degenerate spans are dropped (no-ops). Mirrors resolve_passages().
export function resolvePassageSpans(passages, chapters) {
  const n = chapters?.length || 0;
  if (!n) return [];
  const out = [];
  for (const rec of passages || []) {
    const shape = (rec.shape || 'steady').toLowerCase();
    if (shape === 'steady') continue;
    let bi = Number(rec.beginIdx ?? 0);
    let ei = Number(rec.endIdx ?? n - 1);
    if (Number.isNaN(bi) || Number.isNaN(ei)) continue;
    bi = Math.max(0, Math.min(bi, n - 1));
    ei = Math.max(0, Math.min(ei, n - 1));
    if (ei < bi) { const t = bi; bi = ei; ei = t; }
    const begin = chapters[bi];
    const end = chapters[ei];
    const lo = begin.atMs ?? begin.at_ms ?? begin.start_ms;
    const hi = end.endMs ?? end.end_ms;
    if (lo == null || hi == null || hi <= lo) continue;
    out.push({
      lo, hi, shape, beginIdx: bi, endIdx: ei,
      floor: Number(rec.floor ?? 0.2), ceiling: Number(rec.ceiling ?? 1.0),
      risePoint: rec.risePoint != null ? Number(rec.risePoint) : undefined,
      fallPoint: rec.fallPoint != null ? Number(rec.fallPoint) : undefined,
    });
  }
  return out;
}

// Combined multiplier at absolute time `t` (ms) over resolved spans. First
// covering span wins; no cover → 1.0. Mirrors factor_at().
export function passageFactorAt(spans, t) {
  for (const p of spans || []) {
    if (p.lo == null || p.hi == null || p.hi <= p.lo) continue;
    if (t >= p.lo && t <= p.hi) {
      const frac = (t - p.lo) / Math.max(1, p.hi - p.lo);
      return shapeFactor(p.shape, frac, p.floor, p.ceiling, p.risePoint, p.fallPoint);
    }
  }
  return 1.0;
}

// What passage (if any) shapes chapter `idx`, and by how much? Returns the
// covering span plus the multiplier at the chapter's MIDPOINT (representative)
// and at its start/end (the trajectory through the chapter), or null when no
// live passage covers it.
export function passageInfoForChapter(passages, chapters, idx) {
  const n = chapters?.length || 0;
  if (idx < 0 || idx >= n) return null;
  const spans = resolvePassageSpans(passages, chapters);
  if (!spans.length) return null;
  const ch = chapters[idx];
  const lo = ch.atMs ?? ch.at_ms ?? ch.start_ms;
  const hi = ch.endMs ?? ch.end_ms;
  if (lo == null || hi == null) return null;
  const mid = (lo + hi) / 2;
  const span = spans.find((s) => mid >= s.lo && mid <= s.hi);
  if (!span) return null;
  return {
    shape: span.shape,
    beginIdx: span.beginIdx, endIdx: span.endIdx,
    floor: span.floor, ceiling: span.ceiling,
    factor: passageFactorAt([span], mid),
    factorStart: passageFactorAt([span], lo),
    factorEnd: passageFactorAt([span], hi),
  };
}

// ── Single full-span "arc" ⇄ passages — the slider editor's model ──
// The arc lane edits ONE full-span passage via four params (start depth /
// peak / rise point / fall point). These convert to/from the passages array
// so presets and sliders share one representation.
const _ARC_EPS = 0.001;
const _clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

function _inferArcShape(floor, ceiling, rp, fp) {
  if (ceiling <= floor + _ARC_EPS) return 'sustain';       // flat line
  if (fp < 1 - _ARC_EPS) return rp > _ARC_EPS ? 'swell' : 'release';
  return rp < _ARC_EPS ? 'sustain' : 'build';
}

// Current arc params from the passages array (a single full-span passage), or
// a neutral flat-at-full arc when empty/multi-span.
export function arcFromPassages(passages) {
  if (passages && passages.length === 1) {
    const p = passages[0];
    const [rp, fp] = effectivePoints(p);
    return { floor: p.floor ?? 0.3, ceiling: p.ceiling ?? 1.0, risePoint: rp, fallPoint: fp };
  }
  return { floor: 1.0, ceiling: 1.0, risePoint: 0.0, fallPoint: 1.0 };
}

// Build a one-passage array from arc params over `n` chapters. A flat arc at
// full (ceiling≈floor≈1) is the neutral Hold → no passage. Enforces
// ceiling≥floor and fallPoint≥risePoint.
export function passagesFromArc(arc, n) {
  if (n <= 0) return [];
  const floor = _clamp01(arc.floor);
  const ceiling = Math.max(floor, _clamp01(arc.ceiling));
  if (ceiling >= 0.999 && floor >= 0.999) return [];
  const rp = _clamp01(arc.risePoint);
  const fp = Math.max(rp, _clamp01(arc.fallPoint));
  const shape = _inferArcShape(floor, ceiling, rp, fp);
  const p = makePassage(0, Math.max(0, n - 1), shape);
  return [{ ...p, floor, ceiling, risePoint: rp, fallPoint: fp }];
}

// The shape a passage reads as, inferred from its arc params (so the per-span
// editor can show a glyph without a shape dropdown).
export function arcShapeId(rec) {
  const floor = _clamp01(rec?.floor ?? 0.2);
  const ceiling = Math.max(floor, _clamp01(rec?.ceiling ?? 1.0));
  const [rp, fp] = effectivePoints(rec);
  if (ceiling >= 0.999 && floor >= 0.999) return 'steady';
  return _inferArcShape(floor, ceiling, _clamp01(rp), Math.max(_clamp01(rp), _clamp01(fp)));
}

// Which preset (if any) does the current passages array represent? Empty = the
// neutral "Hold steady"; a single full-span passage matching a preset's shape +
// floor/ceiling = that preset; anything hand-edited = null (no pill highlighted).
export function activePassagePreset(passages) {
  if (!passages || passages.length === 0) return 'hold';
  if (passages.length !== 1) return null;
  const p = passages[0];
  const [prp, pfp] = effectivePoints(p);
  const hit = PASSAGE_PRESETS.find((pr) => {
    const [rp, fp] = effectivePoints(pr);
    return pr.shape === p.shape
      && Math.abs(pr.floor - p.floor) < 0.001
      && Math.abs(pr.ceiling - p.ceiling) < 0.001
      && Math.abs(rp - prp) < 0.001
      && Math.abs(fp - pfp) < 0.001;
  });
  return hit ? hit.id : null;
}
