// Events catalog — slim skeleton version. Devices, families, effects.
// No parameter schemas yet (the design ships per-device parameter forms;
// those land in the wiring pass alongside the .events.yml sidecar that
// becomes the source of truth on disk). For beta-readiness the UI shows
// the right *shape* — library / capture / timeline / strip — driven by
// this static catalog.

// The three axes an Edger event can drive (from event_definitions steps).
// `volume` is the UNIVERSAL intensity envelope every device renders; the
// other two are estim-only texture.
export const EVENT_AXES = {
  volume: 'intensity',
  pulse_frequency: 'pulse rate',
  pulse_width: 'pulse width',
};
export const UNIVERSAL_AXIS = 'volume';

// Device profiles (volume-as-intensity model, locked 2026-06-02). Each
// device declares which event axes it can actually render. An event is
// authored ONCE (estim-native, multi-axis); the profile transfers it:
// estim gets full texture, everyone else gets the intensity envelope.
// `gets` is the human one-liner shown in the config Devices block.
export const EVENT_DEVICES = [
  { id: 'estim',    label: 'E-stim',   axes: ['pulse_frequency', 'pulse_width', 'volume'],
    gets: 'full texture + intensity', desc: 'Electrostim — pulse rate, pulse width, volume.' },
  { id: 'vibrator', label: 'Vibrator', axes: ['volume'],
    gets: 'intensity envelope', desc: 'Single-axis vibration — the volume envelope.' },
  { id: 'bhaptics', label: 'bHaptics', axes: ['volume'],
    gets: 'per-zone intensity', desc: 'Tactile zones — the volume envelope per zone.' },
  { id: 'shaker',   label: 'Shaker',   axes: ['volume'],
    gets: 'sub-bass intensity', desc: 'Sub-bass / transducer rumble — the volume envelope.' },
];

// Which of an event's axes a device actually renders (intersection).
export function axesForDevice(deviceId, eventAxes) {
  const dev = EVENT_DEVICES.find((d) => d.id === deviceId);
  if (!dev) return [];
  return (eventAxes || []).filter((a) => dev.axes.includes(a));
}

export const EVENT_FAMILIES = {
  buzz:    { label: 'Buzz',    color: '#ff7b7b', desc: 'Intensity & pulse character' },
  stroke:  { label: 'Stroke',  color: '#4dabf7', desc: 'Motion cadence' },
  control: { label: 'Control', color: '#ffb547', desc: 'Hard shapes — cuts, holds, breathing' },
  shape:   { label: 'Shape',   color: '#c77dff', desc: 'Hits, sweeps, texture' },
};

// Effect catalog — each effect lists which devices support it. Device-
// specific parameter sets live in the wiring pass; for skeleton-mode the
// UI just needs to know "edge supports estim+vibrator, not bhaptics".
// `preview` = the haptic OUTPUT shape, normalized y in [0,1] (0 bottom,
// 1 top), drawn as a filled ShapeGlyph in the library row (decision #6).
// Detect↔synthesize share pictures: a "Swell" you detect and a "Surge"
// you synthesize read alike.
export const EVENT_EFFECTS = [
  // Buzz
  { id: 'surge',   label: 'Surge',   family: 'buzz',
    desc: 'Release crescendo — slow throb, wide pulse sweep.',
    preview: [0.2, 0.45, 0.72, 0.9, 0.96, 0.85, 0.6, 0.32, 0.2],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'edge',    label: 'Edge',    family: 'buzz',
    desc: 'Tension build — pulse ramp with volume buzz.',
    preview: [0.25, 0.32, 0.42, 0.5, 0.62, 0.7, 0.82, 0.9, 0.96],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'hold',    label: 'Hold',    family: 'buzz',
    desc: 'Locked high pulse with subtle hum.',
    preview: [0.82, 0.86, 0.83, 0.86, 0.84, 0.86, 0.83, 0.85, 0.84],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Stroke
  { id: 'slow',    label: 'Slow',    family: 'stroke',
    desc: 'Pull back — quarter-speed motion.',
    preview: [0.35, 0.55, 0.62, 0.5, 0.32, 0.42, 0.58, 0.5, 0.36],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'steady',  label: 'Steady',  family: 'stroke',
    desc: 'Neutral — moderate motion, no intensity change.',
    preview: [0.4, 0.62, 0.4, 0.62, 0.4, 0.62, 0.4, 0.62, 0.4],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'fast',    label: 'Fast',    family: 'stroke',
    desc: 'Speed up — fast motion with intensity push.',
    preview: [0.3, 0.75, 0.35, 0.8, 0.4, 0.85, 0.45, 0.9, 0.5, 0.95, 0.55],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Control
  { id: 'cut',     label: 'Cut',     family: 'control',
    desc: 'Kill — intensity to zero, slow recovery.',
    preview: [0.85, 0.6, 0.12, 0.05, 0.05, 0.05, 0.18, 0.32, 0.45],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'breathe', label: 'Breathe', family: 'control',
    desc: 'Gentle breathing oscillation — calm, rhythmic.',
    preview: [0.35, 0.55, 0.74, 0.6, 0.36, 0.55, 0.74, 0.58, 0.36],
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Shape
  { id: 'pulse',   label: 'Pulse',   family: 'shape',
    desc: 'Sharp blip — single tap or short burst.',
    preview: [0.14, 0.14, 0.16, 0.95, 0.18, 0.14, 0.14, 0.14, 0.14],
    devices: ['vibrator', 'bhaptics', 'shaker'] },
  { id: 'sweep',   label: 'Sweep',   family: 'shape',
    desc: 'Frequency or zone sweep across the device.',
    preview: [0.16, 0.3, 0.44, 0.58, 0.7, 0.8, 0.88, 0.94, 0.9],
    devices: ['estim', 'bhaptics'] },
];

// "Normal" — the pre-armed baseline / opt-out (locked decision #5). Not a
// real enhancement and NOT exported: it's the eraser/coverage primitive so
// back-to-back chained captures keep continuous coverage with no gaps. Lives
// pinned at the top of the library, above the family groups. compose:'replace'
// so it overwrites rather than layers.
export const NORMAL_COLOR = '#8a8a93';
export const NORMAL_EFFECT = {
  id: 'normal', label: 'Normal', family: null, baseline: true,
  compose: 'replace', exported: false,
  desc: 'Baseline — no enhancement. Chain captures to cover ground fast.',
  preview: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  devices: EVENT_DEVICES.map((d) => d.id),
};

export function findEffect(id) {
  if (id === NORMAL_EFFECT.id) return NORMAL_EFFECT;
  return EVENT_EFFECTS.find((e) => e.id === id) || null;
}

// Resolve an effect's family swatch. Normal (baseline) has no family, so it
// reports a neutral grey "Baseline" pseudo-family — keeps the timeline/strip
// from dropping baseline spans on their `if (!fam) return null` guards.
export function familyOf(eff) {
  if (!eff) return null;
  if (eff.baseline) return { label: 'Baseline', color: NORMAL_COLOR };
  return EVENT_FAMILIES[eff.family] || null;
}

// Per-effect tunables (step ③ effect config). Skeleton schemas — the real
// per-device parameter sets arrive with the .feel.yml wiring pass; for now
// these give the config pane the right *shape* (sliders + units + defaults).
export const EFFECT_PARAMS = {
  surge:   [{ key: 'throb', label: 'Throb', min: 0.5, max: 4, step: 0.1, def: 1.2, unit: 'Hz' },
            { key: 'width', label: 'Width', min: 0, max: 1, step: 0.05, def: 0.6 },
            { key: 'tail',  label: 'Tail',  min: 0, max: 1500, step: 50, def: 600, unit: 'ms' }],
  edge:    [{ key: 'tremor', label: 'Tremor', min: 4, max: 16, step: 0.5, def: 10, unit: 'Hz' },
            { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.05, def: 0.30 },
            { key: 'ramp',   label: 'Ramp up', min: 0, max: 1000, step: 50, def: 250, unit: 'ms' }],
  hold:    [{ key: 'hum',   label: 'Hum',   min: 0.5, max: 6, step: 0.5, def: 2, unit: 'Hz' },
            { key: 'floor', label: 'Floor', min: 0, max: 1, step: 0.05, def: 0.7 }],
  slow:    [{ key: 'rate',  label: 'Rate',  min: 0.1, max: 1, step: 0.05, def: 0.25, unit: '×' },
            { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.05, def: 0.5 }],
  steady:  [{ key: 'rate',  label: 'Rate',  min: 0.5, max: 2, step: 0.1, def: 1, unit: '×' }],
  fast:    [{ key: 'rate',  label: 'Rate',  min: 1, max: 4, step: 0.1, def: 2, unit: '×' },
            { key: 'push',  label: 'Push',  min: 0, max: 1, step: 0.05, def: 0.4 }],
  cut:     [{ key: 'recover', label: 'Recover', min: 0, max: 2000, step: 50, def: 800, unit: 'ms' }],
  breathe: [{ key: 'period', label: 'Period', min: 1, max: 8, step: 0.5, def: 4, unit: 's' },
            { key: 'depth',  label: 'Depth',  min: 0, max: 1, step: 0.05, def: 0.4 }],
  pulse:   [{ key: 'width', label: 'Width', min: 50, max: 500, step: 10, def: 150, unit: 'ms' }],
  sweep:   [{ key: 'span', label: 'Span', min: 0, max: 1, step: 0.05, def: 0.8 },
            { key: 'time', label: 'Time', min: 100, max: 1500, step: 50, def: 600, unit: 'ms' }],
};

export function paramsFor(eff) {
  if (!eff) return [];
  return EFFECT_PARAMS[eff.id] || [];
}

// Sample events used while the .events.yml sidecar pipeline isn't wired.
// Generated per-project: drops 2–3 events into each chapter so the
// timeline and density ribbon have content. Spread across families so
// the color legend reads.
const SAMPLE_RECIPE = [
  { effectId: 'edge',    devices: ['estim', 'vibrator'], intensity: 0.65, lengthMs: 12000 },
  { effectId: 'hold',    devices: ['estim'],             intensity: 0.55, lengthMs: 18000 },
  { effectId: 'breathe', devices: ['vibrator'],          intensity: 0.40, lengthMs: 8000 },
  { effectId: 'surge',   devices: ['estim', 'shaker'],   intensity: 0.80, lengthMs: 9000 },
  { effectId: 'pulse',   devices: ['bhaptics'],          intensity: 0.50, lengthMs: 1500 },
  { effectId: 'cut',     devices: ['estim'],             intensity: 0.0,  lengthMs: 4000 },
];

export function sampleEventsForProject(chapters) {
  if (!chapters || chapters.length === 0) return [];
  const out = [];
  chapters.forEach((ch, ci) => {
    const span = Math.max(0, (ch.endMs ?? 0) - (ch.atMs ?? 0));
    if (span < 4000) return;
    const slots = span >= 60000 ? 3 : span >= 20000 ? 2 : 1;
    for (let i = 0; i < slots; i++) {
      const recipe = SAMPLE_RECIPE[(ci * 3 + i) % SAMPLE_RECIPE.length];
      const slot = (i + 1) / (slots + 1);
      const begin = Math.floor((ch.atMs ?? 0) + span * slot - recipe.lengthMs / 2);
      const end = Math.min(begin + recipe.lengthMs, ch.endMs ?? begin + recipe.lengthMs);
      out.push({
        id: `e-${ci}-${i}`,
        beginMs: Math.max(ch.atMs ?? 0, begin),
        endMs: end,
        effectId: recipe.effectId,
        devices: [...recipe.devices],
        intensity: recipe.intensity,
      });
    }
  });
  return out.sort((a, b) => a.beginMs - b.beginMs);
}
