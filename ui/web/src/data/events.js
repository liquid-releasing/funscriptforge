// Events catalog — slim skeleton version. Devices, families, effects.
// No parameter schemas yet (the design ships per-device parameter forms;
// those land in the wiring pass alongside the .events.yml sidecar that
// becomes the source of truth on disk). For beta-readiness the UI shows
// the right *shape* — library / capture / timeline / strip — driven by
// this static catalog.

export const EVENT_DEVICES = [
  { id: 'estim',    label: 'E-stim',   desc: 'Electrostim — alpha/beta/volume/pulse.' },
  { id: 'vibrator', label: 'Vibrator', desc: 'Single-axis vibration intensity.' },
  { id: 'bhaptics', label: 'bHaptics', desc: 'Tactile zones across vest/arms/hands.' },
  { id: 'shaker',   label: 'Shaker',   desc: 'Sub-bass / transducer rumble.' },
];

export const EVENT_FAMILIES = {
  buzz:    { label: 'Buzz',    color: '#ff7b7b', desc: 'Intensity & pulse character' },
  stroke:  { label: 'Stroke',  color: '#4dabf7', desc: 'Motion cadence' },
  control: { label: 'Control', color: '#ffb547', desc: 'Hard shapes — cuts, holds, breathing' },
  shape:   { label: 'Shape',   color: '#c77dff', desc: 'Hits, sweeps, texture' },
};

// Effect catalog — each effect lists which devices support it. Device-
// specific parameter sets live in the wiring pass; for skeleton-mode the
// UI just needs to know "edge supports estim+vibrator, not bhaptics".
export const EVENT_EFFECTS = [
  // Buzz
  { id: 'surge',   label: 'Surge',   family: 'buzz',
    desc: 'Release crescendo — slow throb, wide pulse sweep.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'edge',    label: 'Edge',    family: 'buzz',
    desc: 'Tension build — pulse ramp with volume buzz.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'hold',    label: 'Hold',    family: 'buzz',
    desc: 'Locked high pulse with subtle hum.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Stroke
  { id: 'slow',    label: 'Slow',    family: 'stroke',
    desc: 'Pull back — quarter-speed motion.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'steady',  label: 'Steady',  family: 'stroke',
    desc: 'Neutral — moderate motion, no intensity change.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'fast',    label: 'Fast',    family: 'stroke',
    desc: 'Speed up — fast motion with intensity push.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Control
  { id: 'cut',     label: 'Cut',     family: 'control',
    desc: 'Kill — intensity to zero, slow recovery.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  { id: 'breathe', label: 'Breathe', family: 'control',
    desc: 'Gentle breathing oscillation — calm, rhythmic.',
    devices: ['estim', 'vibrator', 'bhaptics', 'shaker'] },
  // Shape
  { id: 'pulse',   label: 'Pulse',   family: 'shape',
    desc: 'Sharp blip — single tap or short burst.',
    devices: ['vibrator', 'bhaptics', 'shaker'] },
  { id: 'sweep',   label: 'Sweep',   family: 'shape',
    desc: 'Frequency or zone sweep across the device.',
    devices: ['estim', 'bhaptics'] },
];

export function findEffect(id) {
  return EVENT_EFFECTS.find((e) => e.id === id) || null;
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
