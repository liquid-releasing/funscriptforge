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

// Each character carries an `icon` name (lucide kebab-case from
// forgemoment's LUCIDE_MAP) that picks up the character color in the
// UI. The icon is the at-a-glance story of what you get by picking
// this character — important enough to surface alongside the label.
import { mechStyleForPosition } from './multiaxis.js';

export const CHARACTERS = [
  {
    id: 'gentle',
    label: 'Gentle',
    color: '#4dabf7',
    icon: 'clock',           // long warm-up, patient
    tagline: 'Soft, slow-building',
    desc: 'Sustained warmth with a long warm-up. Held pressure, no oscillation.',
    devices: ['estim', 'vibrator', 'bhaptics'],
    sliders: [
      { id: 'warmup',  label: 'Warm-up duration', leftHint: 'instant', rightHint: 'long ramp',
        min: 0, max: 120, step: 5, def: 60, unit: 's' },
      { id: 'softness', label: 'Pulse softness',  leftHint: 'crisp',   rightHint: 'very soft',
        min: 0, max: 1, step: 0.05, def: 0.7 },
    ],
  },
  {
    id: 'reactive',
    label: 'Reactive',
    color: '#ff5470',
    icon: 'zap',             // sharp pulse, tracks stroke
    tagline: 'Sharp, tracks every stroke',
    desc: 'Fast pulse period. Sensation tracks the funscript closely.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'],
    sliders: [
      { id: 'responsiveness', label: 'Responsiveness', leftHint: 'lagged', rightHint: 'instant',
        min: 0, max: 1, step: 0.05, def: 0.85 },
      { id: 'arc_width',      label: 'Arc width',      leftHint: 'narrow', rightHint: 'wide',
        min: 0, max: 1, step: 0.05, def: 0.8 },
    ],
  },
  {
    id: 'scene_builder',
    label: 'Scene Builder',
    color: '#3ed598',
    icon: 'layers',          // builds up gradually
    tagline: 'Builds gradually over the scene',
    desc: 'Long wave period. Slow intensity ramp — rewards patience.',
    devices: ['estim', 'vibrator', 'bhaptics'],
    sliders: [
      { id: 'build_speed', label: 'Build speed', leftHint: 'builds quickly', rightHint: 'very slow arc',
        min: 0, max: 10, step: 0.1, def: 7.5 },
      { id: 'arc_width',   label: 'Arc width',   leftHint: 'tight',          rightHint: 'broad',
        min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
  {
    id: 'unpredictable',
    label: 'Unpredictable',
    color: '#ffb547',
    icon: 'shapes',          // varies, never the same twice
    tagline: 'Random direction changes',
    desc: 'Seeded noise — every chapter gets a different flavor.',
    devices: ['estim', 'vibrator', 'bhaptics'],
    sliders: [
      { id: 'chaos', label: 'Chaos amount', leftHint: 'smooth', rightHint: 'wild',
        min: 0, max: 1, step: 0.05, def: 0.65 },
    ],
  },
  {
    id: 'balanced',
    label: 'Balanced',
    color: '#c77dff',
    icon: 'sliders',         // every dial at midpoint
    tagline: 'Middle of everything',
    desc: 'Default wave tempo. Good starting point — refine from here.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'],
    sliders: [
      { id: 'intensity', label: 'Overall intensity', leftHint: 'soft', rightHint: 'strong',
        min: 0, max: 1, step: 0.05, def: 0.5 },
    ],
  },
  {
    // Forge-level virtual character (route B): generates from Scene Builder,
    // then a descending volume envelope at export/draw time — the reverse arc.
    id: 'scene_closer',
    label: 'Scene Closer',
    color: '#ff8e72',
    icon: 'pause',           // eases off — winds the scene down to a close
    tagline: 'Winds the scene down to a close',
    desc: 'Eases off and de-escalates across the chapter — the reverse of Scene Builder. Builder opens, Closer closes.',
    devices: ['estim', 'vibrator', 'bhaptics'],
    sliders: [
      { id: 'build_speed', label: 'Ease-off speed', leftHint: 'eases quickly', rightHint: 'very slow fade',
        min: 0, max: 10, step: 0.1, def: 7.5 },
      { id: 'arc_width',   label: 'Arc width',   leftHint: 'tight',          rightHint: 'broad',
        min: 0, max: 1, step: 0.01, def: 0.25 },
    ],
  },
];

// Default slider params for a character — pulled fresh from the
// catalog defs each time. Same shape that flows through `staged.params`
// in CharactersTab and (eventually) into the chain file for the
// export-time character pipeline.
export function defaultParamsFor(characterId) {
  const c = CHARACTERS.find((x) => x.id === characterId);
  if (!c || !c.sliders) return {};
  const out = {};
  c.sliders.forEach((s) => { out[s.id] = s.def; });
  return out;
}

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

// Position-aware default arc across the chapter sequence — the "journey":
// Scene Builder opens, alternates Balanced/Unpredictable through the middle,
// builds to Reactive, and winds down with Scene Closer at the finale. One
// discrete character per chapter, seeded so a fresh project reads as an arc
// rather than a flat/uniform default (fully overridable per chapter). This is
// the recorded default (see project_funscriptforge_pending); "Afterglow" is
// the Scene Closer finale (the standalone Afterglow character was shelved —
// see project_funscriptforge_post_beta).
function characterForPosition(i, n) {
  if (n <= 1) return 'scene_builder';
  if (i === 0) return 'scene_builder';        // opener
  if (i === n - 1) return 'scene_closer';     // finale — winds down
  if (i === n - 2) return 'reactive';         // build into the finale
  return (i % 2 === 1) ? 'balanced' : 'unpredictable'; // middle alternation
}

// Seed both the per-chapter character AND its Mechanical style as a matched
// arc, so a fresh project opens with a coherent journey (not a flat default).
export function seedCharacterAssignments(chapters) {
  if (!chapters || chapters.length === 0) return {};
  const n = chapters.length;
  const out = {};
  chapters.forEach((c, i) => {
    const characterId = characterForPosition(i, n);
    out[c.id] = {
      characterId,
      params: defaultParamsFor(characterId),
      mechStyle: mechStyleForPosition(i, n),
    };
  });
  return out;
}
