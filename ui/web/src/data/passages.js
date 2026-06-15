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

// Multiplier at fractional position `frac` (0..1) along a passage span.
// Mirrors forge/passages.py::shape_factor exactly.
export function shapeFactor(shape, frac, floor, ceiling) {
  const f = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
  const lo = floor;
  const hi = ceiling;
  switch ((shape || 'steady').toLowerCase()) {
    case 'steady':  return 1.0;
    case 'sustain': return hi;
    case 'build':   return lo + (hi - lo) * f;
    case 'release': return hi - (hi - lo) * f;
    case 'swell':   return lo + (hi - lo) * (1 - Math.abs(2 * f - 1));
    default:        return 1.0;
  }
}

// Sample a passage's envelope as N points in [0,1] (for sparkline previews).
export function sampleEnvelope(shape, floor, ceiling, n = 24) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const frac = n === 1 ? 0 : i / (n - 1);
    out.push(shapeFactor(shape, frac, floor, ceiling));
  }
  return out;
}

let _uid = 0;
export function newPassageId() {
  _uid += 1;
  return `p${Date.now().toString(36)}_${_uid}`;
}

// A fresh passage spanning the given chapter index range, defaulting to Build.
export function makePassage(beginIdx, endIdx, shape = 'build') {
  return { id: newPassageId(), shape, beginIdx, endIdx, floor: 0.4, ceiling: 1.0 };
}

// ── Passage PRESETS — the resolved "one shared arc, preset-selected" model ──
// A passage is the depth/density of the SECONDARY world: ONE arc set across the
// whole chapter run that gives e-stim / mechanical / body their overall
// direction (each layer performs it its own way). Beta = presets only, same UI
// as Generate's Range/Pace lanes. Each preset maps onto the EXISTING passage
// data model (a single full-span passage of one shape), so forge/passages.py is
// untouched. See DESIGN_DECISIONS.md (Passages section).
export const PASSAGE_PRESETS = [
  { id: 'hold',  label: 'Hold steady',     shape: 'steady',  floor: 1.0,  ceiling: 1.0,  hint: 'no arc — flat throughout' },
  { id: 'hum',   label: 'Warm hum',        shape: 'sustain', floor: 0.55, ceiling: 0.58, hint: 'a low, steady presence' },
  { id: 'build', label: 'Build the charge', shape: 'build',  floor: 0.3,  ceiling: 1.0,  hint: 'rises across the whole run' },
  { id: 'edge',  label: 'Edge & release',  shape: 'swell',   floor: 0.35, ceiling: 1.0,  hint: 'peak in the middle, then ease' },
];

// Build the passages array for a preset over `n` chapters. The neutral
// "Hold steady" is a no-op → no passage rows at all.
export function passagesForPreset(presetId, n) {
  const pr = PASSAGE_PRESETS.find((p) => p.id === presetId);
  if (!pr || pr.shape === 'steady' || n <= 0) return [];
  const p = makePassage(0, Math.max(0, n - 1), pr.shape);
  return [{ ...p, floor: pr.floor, ceiling: pr.ceiling }];
}

// Sample a preset's envelope (0..1) for the read-only lane preview.
export function presetSamples(presetId, count = 48) {
  const pr = PASSAGE_PRESETS.find((p) => p.id === presetId) || PASSAGE_PRESETS[0];
  return sampleEnvelope(pr.shape, pr.floor, pr.ceiling, count);
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
      return shapeFactor(p.shape, frac, p.floor, p.ceiling);
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

// Which preset (if any) does the current passages array represent? Empty = the
// neutral "Hold steady"; a single full-span passage matching a preset's shape +
// floor/ceiling = that preset; anything hand-edited = null (no pill highlighted).
export function activePassagePreset(passages) {
  if (!passages || passages.length === 0) return 'hold';
  if (passages.length !== 1) return null;
  const p = passages[0];
  const hit = PASSAGE_PRESETS.find(
    (pr) => pr.shape === p.shape
      && Math.abs(pr.floor - p.floor) < 0.001
      && Math.abs(pr.ceiling - p.ceiling) < 0.001,
  );
  return hit ? hit.id : null;
}
