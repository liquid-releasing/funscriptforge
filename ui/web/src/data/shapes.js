// SHAPE_TYPES — the 8 structural shape labels produced by
// assessment/shape_labeler.py (`shape_label`). The Shape lens in the
// Phrases tab groups phrases by these. Names LOCKED 2026-05-31:
// `three_one` displays as "Gallop"; the other 7 keep their labeler names.
//
// 7 are reusable motion primitives (Steady/Swell/Taper/Pulse/Burst/Gallop/
// Tide) that double as transform/haptic vocabulary; Drift is a diagnostic
// (detect-to-recenter, also a Behavior tag). See memory
// project_patterns_reusable_vocabulary + project_patterns_phrases_one_segmentation.
//
// Each shape carries a `preview` — a normalized motion curve (y ∈ [0,1],
// x evenly spaced) that forgemoment's <ShapeGlyph> renders as the shape's
// icon. The SAME curve vocabulary is reused by the Events recipe library
// (recipe.preview[]) so a shape you DETECT (phrase) and one you
// SYNTHESIZE (event) read as the same picture — see memory
// project_patterns_reusable_vocabulary. Curves are representative
// silhouettes, not data: deterministic, tuned for a ~26×16 glyph.
const _N = 24;
const _TAU = Math.PI * 2;
function _curve(fn) {
  const out = [];
  for (let i = 0; i < _N; i += 1) {
    const x = i / (_N - 1);
    out.push(Math.max(0, Math.min(1, fn(x))));
  }
  return out;
}
// Per-shape silhouettes. Mid-line is 0.5; amplitude/envelope/center encode
// the shape's character.
const _PREVIEWS = {
  // Even strokes, constant amplitude.
  steady: _curve((x) => 0.5 + 0.34 * Math.sin(_TAU * 4 * x)),
  // Amplitude grows across the run.
  swell: _curve((x) => 0.5 + (0.08 + 0.40 * x) * Math.sin(_TAU * 4 * x)),
  // Amplitude shrinks across the run.
  taper: _curve((x) => 0.5 + (0.48 - 0.40 * x) * Math.sin(_TAU * 4 * x)),
  // Motion in two windows separated by a rest at mid-line.
  pulse: _curve((x) => {
    const active = (x > 0.04 && x < 0.34) || (x > 0.6 && x < 0.92);
    return 0.5 + (active ? 0.34 : 0) * Math.sin(_TAU * 9 * x);
  }),
  // Flat, then one short dense high-velocity cluster, then flat.
  burst: _curve((x) => {
    const inBurst = x > 0.4 && x < 0.62;
    return 0.5 + (inBurst ? 0.46 : 0) * Math.sin(_TAU * 13 * x);
  }),
  // Three strokes then a hold, twice — a galloping gait. (three_one)
  three_one: _curve((x) => {
    const local = (x * 2) % 1; // two repeats
    return local < 0.7 ? 0.5 + 0.34 * Math.sin(_TAU * 3 * (local / 0.7)) : 0.5;
  }),
  // Fast strokes riding a slow oscillation (center moves).
  tide: _curve((x) => 0.5 + 0.20 * Math.sin(_TAU * x) + 0.17 * Math.sin(_TAU * 7 * x)),
  // Even motion sitting in the wrong (high) zone, drifting up.
  drift: _curve((x) => (0.62 + 0.10 * x) + 0.11 * Math.sin(_TAU * 4 * x)),
};

// `id` is the raw shape_label value on disk; `label` is the display name.
// Colors are tuned for the dark bg and disjoint from the chapter tone
// palette so the Shape rail reads as its own context.
export const SHAPE_TYPES = [
  { id: 'steady',    label: 'Steady', color: '#a78bfa', preview: _PREVIEWS.steady,
    desc: 'Regular up-down strokes, even spacing.' },
  { id: 'swell',     label: 'Swell',  color: '#4ade80', preview: _PREVIEWS.swell,
    desc: 'Amplitude grows across the run.' },
  { id: 'taper',     label: 'Taper',  color: '#f472b6', preview: _PREVIEWS.taper,
    desc: 'Amplitude shrinks across the run.' },
  { id: 'pulse',     label: 'Pulse',  color: '#22d3ee', preview: _PREVIEWS.pulse,
    desc: 'Motion broken by rest periods.' },
  { id: 'burst',     label: 'Burst',  color: '#fb923c', preview: _PREVIEWS.burst,
    desc: 'Short bursts of high-velocity motion.' },
  { id: 'three_one', label: 'Gallop', color: '#facc15', preview: _PREVIEWS.three_one,
    desc: 'Three strokes then a hold, repeating — a galloping gait.' },
  { id: 'tide',      label: 'Tide',   color: '#2dd4bf', preview: _PREVIEWS.tide,
    desc: 'Fast strokes riding a slow oscillation.' },
  { id: 'drift',     label: 'Drift',  color: '#94a3b8', preview: _PREVIEWS.drift,
    desc: 'Motion in the wrong zone — needs recentering.' },
];

export const findShape = (id) => SHAPE_TYPES.find((s) => s.id === id) ?? SHAPE_TYPES[0];
