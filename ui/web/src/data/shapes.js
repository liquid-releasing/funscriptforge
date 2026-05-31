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
// `id` is the raw shape_label value on disk; `label` is the display name.
// Colors are tuned for the dark bg and disjoint from the chapter tone
// palette so the Shape rail reads as its own context.
export const SHAPE_TYPES = [
  { id: 'steady',    label: 'Steady', color: '#a78bfa',
    desc: 'Regular up-down strokes, even spacing.' },
  { id: 'swell',     label: 'Swell',  color: '#4ade80',
    desc: 'Amplitude grows across the run.' },
  { id: 'taper',     label: 'Taper',  color: '#f472b6',
    desc: 'Amplitude shrinks across the run.' },
  { id: 'pulse',     label: 'Pulse',  color: '#22d3ee',
    desc: 'Motion broken by rest periods.' },
  { id: 'burst',     label: 'Burst',  color: '#fb923c',
    desc: 'Short bursts of high-velocity motion.' },
  { id: 'three_one', label: 'Gallop', color: '#facc15',
    desc: 'Three strokes then a hold, repeating — a galloping gait.' },
  { id: 'tide',      label: 'Tide',   color: '#2dd4bf',
    desc: 'Fast strokes riding a slow oscillation.' },
  { id: 'drift',     label: 'Drift',  color: '#94a3b8',
    desc: 'Motion in the wrong zone — needs recentering.' },
];

export const findShape = (id) => SHAPE_TYPES.find((s) => s.id === id) ?? SHAPE_TYPES[0];
