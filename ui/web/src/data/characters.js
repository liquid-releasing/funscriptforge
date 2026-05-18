// Characters catalog — five personas that describe the *feel* of generated
// per-device output (the iter-10 design's "Stim characters," now positioned
// as a single design language for cross-device behavior — see memory
// `project_characters_tab.md`).
//
// Today this drives the e-stim 9-channel grid. The same vocabulary is the
// forward-compatible base for haptics zones / vibrator amplitude curves /
// multi-axis output, so we keep the catalog cross-device aware from day
// one — `devices` lists which targets each character will eventually
// generate funscripts for. Skeleton ships e-stim only; the rest is data-
// shape commitment, not implementation.

export const CHARACTERS = [
  {
    id: 'gentle',
    label: 'Gentle',
    color: '#4dabf7',
    tagline: 'Soft, slow-building',
    desc: 'Sustained warmth with a long warm-up. Held pressure, no oscillation.',
    devices: ['estim', 'vibrator', 'bhaptics'],
  },
  {
    id: 'reactive',
    label: 'Reactive',
    color: '#ff5470',
    tagline: 'Sharp, tracks every stroke',
    desc: 'Fast pulse period. Sensation tracks the funscript closely.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'],
  },
  {
    id: 'scene_builder',
    label: 'Scene Builder',
    color: '#3ed598',
    tagline: 'Builds gradually over the scene',
    desc: 'Long wave period. Slow intensity ramp — rewards patience.',
    devices: ['estim', 'vibrator', 'bhaptics'],
  },
  {
    id: 'unpredictable',
    label: 'Unpredictable',
    color: '#ffb547',
    tagline: 'Random direction changes',
    desc: 'Seeded noise — every chapter gets a different flavor.',
    devices: ['estim', 'vibrator', 'bhaptics'],
  },
  {
    id: 'balanced',
    label: 'Balanced',
    color: '#c77dff',
    tagline: 'Middle of everything',
    desc: 'Default wave tempo. Good starting point — refine from here.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'],
  },
];

export function findCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

// E-stim's 9-channel layout. Used by the preview grid below the editor.
// The 3×3 visual shape is fixed; channel meaning is e-stim specific.
// When haptics lands, parallel channel sets will live in their own catalogs
// (vest zones, hand actuators, etc.) — keep this list e-stim-scoped.
export const ESTIM_CHANNELS = [
  { id: 'alpha',  label: 'Alpha L/R',   color: '#4dabf7' },
  { id: 'beta',   label: 'Beta U/D',    color: '#a3e635' },
  { id: 'pfreq',  label: 'Pulse freq',  color: '#ffb547' },
  { id: 'freq',   label: 'Frequency',   color: '#c77dff' },
  { id: 'volume', label: 'Volume',      color: '#3ed598' },
  { id: 'prise',  label: 'Pulse rise',  color: '#ff8c47' },
  { id: 'aprost', label: 'Alpha prost.', color: '#4dabf7' },
  { id: 'bprost', label: 'Beta prost.',  color: '#a3e635' },
  { id: 'vprost', label: 'Vol. prost.',  color: '#3ed598' },
];

// Seeded per-chapter assignment so the skeleton has something to show
// against a real project. Spreads across characters so visually
// every chapter doesn't look the same. Real persistence ships with
// the wiring pass (Accept writes per-chapter overrides to chain file).
const SEED_ORDER = ['scene_builder', 'reactive', 'balanced', 'scene_builder',
                    'unpredictable', 'reactive', 'gentle'];

export function seedCharacterAssignments(chapters) {
  if (!chapters || chapters.length === 0) return {};
  const out = {};
  chapters.forEach((c, i) => {
    out[c.id] = SEED_ORDER[i % SEED_ORDER.length];
  });
  return out;
}
