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
    // OSR2 and SR6 share one station — always writes the full 6-axis TCode set.
    // OSR2 owners play the 4 axes their 2-servo build supports; SR6 owners play
    // all 6. Same files, the player picks. OSR2/SR6 caps are identical (150/500).
    id: 'tcode',
    label: 'OSR2 / SR6',
    sublabel: 'TCode multi-axis',
    kind: 'stroker-tcode',
    deviceKeys: ['sr6'],
    axes: ['L0', 'L1', 'L2', 'R0', 'R1', 'R2'],  // full stroke + surge/sway/twist/roll/pitch
    severity: 3,
    ember: '#ff8e3a',
    glyph: 'stroker-multi',
    constraintHint: 'Servo slew · full 6-axis TCode set',
    outputFile: '{stem}.funscript',       // L0; siblings .surge/.sway/.twist/.roll/.pitch
    tcode: true,
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 60,  max: 220, step: 5,    unit: 'bpm', default: 150, cap: 150, help: 'Servo carriage ceiling.' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.40, help: 'Low-pass per axis.' },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 200, step: 5,    unit: 'ms',  default: 50,   help: 'Servo command pre-roll.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest increment per axis.' },
    ],
  },
  {
    id: 'lovense',
    label: 'Lovense',
    sublabel: 'Bluetooth 1-axis',
    kind: 'stroker',
    deviceKeys: ['generic'],              // conservative BT fallback: 100 BPM / 300 pos/s
    axes: ['L0'],
    severity: 4,
    ember: '#ff5fa2',
    glyph: 'stroker-1ax',
    constraintHint: 'Bluetooth range · gentle slew',
    outputFile: '{stem}.lovense.funscript',
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 40,  max: 160, step: 5,    unit: 'bpm', default: 100, cap: 100, help: 'Bluetooth devices cycle slower than wired strokers.' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.45, help: 'Low-pass on the position curve.' },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 300, step: 5,    unit: 'ms',  default: 80,   help: 'BT command latency is high — send early to land on the beat.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest position increment the device resolves.' },
    ],
  },
  {
    id: 'vacuglide',
    label: 'Vacuglide 2',
    sublabel: 'Autoblow cloud · 1-axis',
    kind: 'stroker',
    deviceKeys: ['vacuglide'],            // Handy-class caps pending vendor data: 120 BPM / 450 pos/s
    axes: ['L0'],
    severity: 5,
    ember: '#3fd0c9',
    glyph: 'stroker-1ax',
    constraintHint: 'Cloud stroker · uploads funscript',
    outputFile: '{stem}.vacuglide.funscript',
    knobs: [
      { key: 'maxBpm',    label: 'Max BPM',     min: 60,  max: 180, step: 5,    unit: 'bpm', default: 120, cap: 120, help: 'Autoblow carriage ceiling (mirrors Handy pending vendor data).' },
      { key: 'smoothing', label: 'Smoothing',   min: 0,   max: 1,   step: 0.05, unit: '',    default: 0.40, help: 'Low-pass on the position curve.' },
      { key: 'latency',   label: 'Lead-time',   min: -20, max: 200, step: 5,    unit: 'ms',  default: 0,    help: 'Cloud playback is pre-synced from the uploaded script — little local lead-time needed.' },
      { key: 'quantize',  label: 'Position step', min: 1, max: 10,  step: 1,    unit: '%',   default: 1,    help: 'Smallest position increment the device resolves.' },
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
