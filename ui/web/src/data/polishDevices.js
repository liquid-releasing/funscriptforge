// Polish station catalog — the device targets the Polish tab can forge for.
//
// v1 = hardware we own and can verify end-to-end. Each station mirrors a
// forge.polish.STATIONS entry; caps come from forge/device_specs.json (NOT
// the original mock's hardcoded knobs). Knob *schemas* (min/max/step/help)
// drive the workbench sliders; `default` seeds them.
//
// Adding a post-beta station (Vacuglide cloud, e-stim 4-phase, subwoofer) is a
// data edit here + a Station in forge/polish.py — no structural change.

// TCode axis -> sibling suffix (mirror polishEngine.siblingPath / polish.py).
export const TCODE_AXES = {
  L0: 'stroke', L1: 'surge', L2: 'sway', R0: 'twist', R1: 'roll', R2: 'pitch',
};

export const POLISH_DEVICES = [
  {
    id: 'estim3p',
    label: 'E-Stim',
    sublabel: '3-phase',
    kind: 'estim',
    deviceKeys: ['foc3phase'],
    axes: ['L0'],
    severity: 1,                          // tightest first
    ember: '#c075ff',
    glyph: 'estim',
    constraintHint: 'Rate-of-change ceiling · safety',
    outputFile: '{stem}.estim3.funscript',
    flagship: true,
    knobs: [
      { key: 'rateLimit',  label: 'Rate ceiling', min: 0.1, max: 1,    step: 0.05, unit: '/100ms', default: 0.55, help: 'Hard-clips the derivative for safety. Sharp transitions soften.' },
      { key: 'quietFloor', label: 'Quiet floor',  min: 0,   max: 0.3,  step: 0.01, unit: '',       default: 0.06, help: "Minimum signal so the channel doesn't drop into a cold gap." },
      { key: 'smoothing',  label: 'Smoothing',    min: 0,   max: 1,    step: 0.05, unit: '',       default: 0.30, help: 'Low-pass on the envelope.' },
      { key: 'latency',    label: 'Lead-time',    min: -20, max: 80,   step: 5,    unit: 'ms',     default: 20,   help: 'Sensation onset is near-instant — small compensation.' },
    ],
  },
  {
    id: 'handy',
    label: 'The Handy',
    sublabel: '1-axis stroker',
    kind: 'stroker',
    deviceKeys: ['handy'],
    axes: ['L0'],
    severity: 2,
    ember: '#ff7a3a',
    glyph: 'stroker-1ax',
    // device_specs handy: 120 BPM / 400 pos/s
    constraintHint: 'BPM ceiling 120 · carriage acceleration',
    outputFile: '{stem}.handy.funscript',
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 60,  max: 200, step: 5,    unit: 'bpm', default: 120, cap: 120, help: 'Softens cycling faster than the carriage can travel.' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.45, help: "Low-pass on the position curve. Tames jitter the motor can't track." },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 200, step: 5,    unit: 'ms',  default: 60,   help: 'Send the command this many ms early to land on the beat.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest position increment the device resolves.' },
    ],
  },
  {
    id: 'osr2',
    label: 'OSR2',
    sublabel: 'TCode multi-axis',
    kind: 'stroker-tcode',
    deviceKeys: ['osr2'],
    axes: ['L0', 'R0', 'R1', 'R2'],       // stroke + twist + roll + pitch
    severity: 3,
    ember: '#ff8e3a',
    glyph: 'stroker-multi',
    // device_specs osr2: 150 BPM / 500 pos/s
    constraintHint: 'Servo slew · writes TCode axis set',
    outputFile: '{stem}.funscript',       // L0; siblings .twist/.roll/.pitch
    tcode: true,
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 60,  max: 220, step: 5,    unit: 'bpm', default: 150, cap: 150, help: 'Servo carriage ceiling.' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.40, help: 'Low-pass per axis.' },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 200, step: 5,    unit: 'ms',  default: 50,   help: 'Servo command pre-roll.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest increment per axis.' },
    ],
  },
  {
    id: 'sr6',
    label: 'SR6',
    sublabel: 'TCode 6-axis',
    kind: 'stroker-tcode',
    deviceKeys: ['sr6'],
    axes: ['L0', 'L1', 'L2', 'R0', 'R1', 'R2'],  // full surge/sway/twist/roll/pitch + stroke
    severity: 4,
    ember: '#ffb547',
    glyph: 'stroker-multi',
    constraintHint: '6-axis servo slew · full TCode set',
    outputFile: '{stem}.funscript',       // L0; siblings .surge/.sway/.twist/.roll/.pitch
    tcode: true,
    experimental: true,
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 60,  max: 220, step: 5,    unit: 'bpm', default: 150, cap: 150, help: 'Servo carriage ceiling.' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.40, help: 'Low-pass per axis.' },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 200, step: 5,    unit: 'ms',  default: 50,   help: 'Servo command pre-roll.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest increment per axis.' },
    ],
  },
];

export const POLISH_BY_ID = Object.fromEntries(POLISH_DEVICES.map((d) => [d.id, d]));

// Resolve a station's output filenames for a given stem. Single-file for
// strokers/e-stim; the full TCode sibling set for OSR2/SR6.
export function outputFilesFor(station, stem) {
  if (!station.tcode) return [station.outputFile.replace('{stem}', stem)];
  return station.axes.map((axis) => {
    const suffix = { L0: '', L1: 'surge', L2: 'sway', R0: 'twist', R1: 'roll', R2: 'pitch' }[axis] ?? axis.toLowerCase();
    return suffix ? `${stem}.${suffix}.funscript` : `${stem}.funscript`;
  });
}
