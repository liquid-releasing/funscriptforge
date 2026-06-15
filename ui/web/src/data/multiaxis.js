// Multi-axis (Mechanical) position styles — UI mirror of the backend
// catalog in `forge/multiaxis_presets.py`. KEEP IN SYNC with that file:
// the style names + per-axis amplitudes here must match the Python
// presets, because the Mechanical editor only *authors* a per-chapter
// style assignment — the actual secondary-axis funscripts are generated
// by `forge.multiaxis.generate_multiaxis()` at Polish/export time from
// these same presets. (See project_channels_character_merge memory.)
//
// Engine axes: roll / pitch / twist / surge / sway, derived from the
// primary L0 stroke. Each style maps a subset of axes to an amplitude
// (0..1); the amplitude drives the axis diagram's glow intensity.

export const MULTIAXIS_STYLES = [
  {
    id: 'None',
    label: 'None',
    tag: 'No motion',
    desc: 'No secondary motion. Device stays centered. Use for stillness or transitions.',
    axes: {},
  },
  {
    id: 'Cowgirl',
    label: 'Cowgirl',
    tag: 'Rocking',
    desc: 'Pitch follows stroke. Gentle roll sway grows with speed. Subtle twist.',
    axes: { roll: 0.3, pitch: 0.6, twist: 0.15 },
  },
  {
    id: 'Missionary',
    label: 'Missionary',
    tag: 'Side-to-side',
    desc: 'Roll dominant, driven by stroke velocity. Gentle pitch sine. No twist.',
    axes: { roll: 0.7, pitch: 0.2 },
  },
  {
    id: 'Doggy',
    label: 'Doggy',
    tag: 'Forward',
    desc: 'Pitch only — strongly biased forward on every stroke. Minimal other motion.',
    axes: { pitch: 0.8 },
  },
  {
    id: 'Riding',
    label: 'Riding',
    tag: 'Circular (SR6)',
    desc: 'Full circular motion. Roll + pitch wide. Twist random walk. Surge/sway slow drift.',
    axes: { roll: 0.6, pitch: 0.6, twist: 0.4, surge: 0.3, sway: 0.3 },
  },
  {
    id: 'Random',
    label: 'Random',
    tag: 'Variety',
    desc: 'All axes get independent random walks, modulated by stroke velocity.',
    axes: { roll: 0.5, pitch: 0.5, twist: 0.3, surge: 0.2, sway: 0.2 },
  },
];

// Engine-axis → T-code identity + display. L0 (stroke) is the *input*
// (inherited from the main funscript), shown for context but never
// authored here. The five secondary axes are what styles drive.
export const AXIS_META = {
  stroke: { tcode: 'L0', label: 'Stroke', kind: 'linear', inherited: true },
  surge:  { tcode: 'L1', label: 'Surge',  kind: 'linear' },
  sway:   { tcode: 'L2', label: 'Sway',   kind: 'linear' },
  twist:  { tcode: 'R0', label: 'Twist',  kind: 'rotary' },
  roll:   { tcode: 'R1', label: 'Roll',   kind: 'rotary' },
  pitch:  { tcode: 'R2', label: 'Pitch',  kind: 'rotary' },
};

// Display order for the secondary axes (rotational first — they're the
// visually dominant motion — then the two linear translations).
export const SECONDARY_AXES = ['twist', 'roll', 'pitch', 'surge', 'sway'];

export const DEFAULT_STYLE = 'None';

// Position-aware Mechanical default arc across the chapter sequence: Cowgirl
// opens, alternates Missionary/Doggy through the middle, builds to Riding, and
// returns home to Cowgirl at the close. Mirrors the Character arc — one
// discrete style per chapter, seeded so a fresh project reads as a journey
// (fully overridable). Recorded default; see project_funscriptforge_pending.
export function mechStyleForPosition(i, n) {
  if (n <= 1) return 'Cowgirl';
  if (i === 0) return 'Cowgirl';              // open
  if (i === n - 1) return 'Cowgirl';          // close — returns home
  if (i === n - 2) return 'Riding';           // build into the finale
  return (i % 2 === 1) ? 'Missionary' : 'Doggy'; // middle alternation
}

export function styleById(id) {
  return MULTIAXIS_STYLES.find((s) => s.id === id) || MULTIAXIS_STYLES[0];
}

// Names of the axes a style actually drives (non-empty amplitude).
export function activeAxes(styleId) {
  return Object.keys(styleById(styleId).axes || {});
}

// Amplitude (0..1) a style assigns to one axis, or 0 if inactive.
export function axisAmplitude(styleId, axis) {
  return styleById(styleId).axes?.[axis] ?? 0;
}
