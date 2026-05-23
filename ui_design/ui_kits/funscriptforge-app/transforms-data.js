// Inventory of all 29 transforms in FunscriptForge.
// Categories: tone (6), behavior / non-structural (17), structural (6).
// Each transform: id, label, category, summary (one-line), description (paragraph),
// bestFor (behavioral-tag ids), params (schema), suggested (default for new picks).
// Mirror of docs/guide/transforms.md and docs/guide/tone.md.

const FF_TRANSFORMS = [
  // ──────────────────────────────────────────────────────────────────
  // TONE — 6 (applied globally, but also pickable per-phrase)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "tone_tender",   label: "Tender",   category: "tone", color: "#8b9bff",
    summary: "Slow and close — soft, slow, shallow strokes.",
    description: "Soft, slow, shallow strokes. Intimate and present. Beat influence stays low so rhythm fades into the background. For quiet moments and slow scenes.",
    bestFor: ["lazy", "ambient"],
    params: [
      { id: "softness",     label: "Softness",     min: 0, max: 1,   step: 0.01, default: 0.6 },
      { id: "pulse_onset",  label: "Pulse onset",  min: 0, max: 1,   step: 0.01, default: 0.7 },
    ],
  },
  {
    id: "tone_build",    label: "Build",    category: "tone", color: "#3ed598",
    summary: "Tension grows — intensity climbs phrase by phrase.",
    description: "Intensity starts low and climbs phrase by phrase. Beat influence grows with it — early sections barely pulse, later sections drive hard. For scenes that escalate.",
    bestFor: ["ramp"],
    params: [
      { id: "build_rate",   label: "Build rate",        min: 0,   max: 1,   step: 0.01, default: 0.55 },
      { id: "start_int",    label: "Starting intensity",min: 0,   max: 1,   step: 0.01, default: 0.20 },
      { id: "arc_width",    label: "Arc width",         min: 0,   max: 1,   step: 0.01, default: 0.70 },
    ],
  },
  {
    id: "tone_tease",    label: "Tease",    category: "tone", color: "#ffb547",
    summary: "Pull back at the peak — intensity rises, then retreats.",
    description: "Intensity rises toward a peak, then retreats before the payoff. Beat influence oscillates — you feel the rhythm arrive and disappear. For edging and denial content.",
    bestFor: [],
    params: [
      { id: "retreat_depth",label: "Retreat depth",     min: 0, max: 1, step: 0.01, default: 0.45 },
      { id: "osc_speed",    label: "Oscillation speed", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "pulse_variety",label: "Pulse variety",     min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
  },
  {
    id: "tone_edge",     label: "Edge",     category: "tone", color: "#c77dff",
    summary: "Hold there — sustained pressure, no retreat.",
    description: "Intensity locks at a high level and holds. No ramp, no retreat — sustained pressure. Beat influence stays strong until the end of each phrase. For sustained tension.",
    bestFor: [],
    params: [
      { id: "hold_int",     label: "Hold intensity",    min: 0, max: 1, step: 0.01, default: 0.85 },
      { id: "drop_point",   label: "Drop point",        min: 0, max: 1, step: 0.01, default: 0.90 },
    ],
  },
  {
    id: "tone_climax",   label: "Climax",   category: "tone", color: "#ff4b4b",
    summary: "Everything, now — full power, urgent pacing.",
    description: "Full power, full stroke range, urgent pacing. Every beat hits hard. For peak moments, finales, and scenes where restraint is wrong.",
    bestFor: ["stingy"],
    params: [
      { id: "peak_int",     label: "Peak intensity",    min: 0, max: 1, step: 0.01, default: 1.0 },
      { id: "urgency",      label: "Urgency",           min: 0, max: 1, step: 0.01, default: 0.9 },
      { id: "pulse_sharp",  label: "Pulse sharpness",   min: 0, max: 1, step: 0.01, default: 0.85 },
      { id: "freq_push",    label: "Frequency push",    min: 0, max: 1, step: 0.01, default: 0.7 },
    ],
  },
  {
    id: "tone_dominant", label: "Dominant", category: "tone", color: "#ff5470",
    summary: "Driving, relentless — fast, wide, assertive.",
    description: "Fast, wide, assertive. The device leads and the user follows. Relentless rhythm, no breaks. For content where the scene is in control.",
    bestFor: ["drone"],
    params: [
      { id: "drive",        label: "Drive",             min: 0, max: 1, step: 0.01, default: 0.85 },
      { id: "sweep_width",  label: "Sweep width",       min: 0, max: 1, step: 0.01, default: 0.9 },
      { id: "relentless",   label: "Relentlessness",    min: 0, max: 1, step: 0.01, default: 0.8 },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // BEHAVIOR (non-structural) — 17
  // ──────────────────────────────────────────────────────────────────
  {
    id: "passthrough", label: "Passthrough", category: "behavior",
    summary: "No change — mark this phrase as reviewed.",
    description: "Makes no changes. Returns positions exactly as they are. Use it to mark a well-formed phrase as reviewed; phrases accepted with Passthrough appear in the Completed transforms table at export time.",
    bestFor: ["lazy", "ambient"],
    params: [],
  },
  {
    id: "amplitude_scale", label: "Amplitude Scale", category: "behavior",
    summary: "Stretch or compress stroke depth around the midpoint.",
    description: "Stretches or compresses stroke depth around position 50. Scale above 1.0 makes strokes larger; below 1.0 makes them smaller.",
    bestFor: ["plateau", "stingy", "lazy"],
    params: [
      { id: "scale", label: "Scale", min: 0.1, max: 5.0, step: 0.05, default: 2.0, unit: "×" },
    ],
  },
  {
    id: "normalize_range", label: "Normalize Range", category: "behavior",
    summary: "Expand the phrase's positions to fill a target range.",
    description: "Expands positions to fill a target range using the actual min/max of the phrase — pulls floor to target floor and ceiling to target ceiling, regardless of where the motion is centered.",
    bestFor: ["giggle", "lazy"],
    params: [
      { id: "low",  label: "Target low",  min: 0,  max: 49,  step: 1, default: 0 },
      { id: "high", label: "Target high", min: 51, max: 100, step: 1, default: 100 },
    ],
  },
  {
    id: "smooth", label: "Smooth", category: "behavior",
    summary: "Low-pass filter — removes jitter without changing shape.",
    description: "Applies a low-pass filter that reduces micro-movements and jitter without changing the overall shape.",
    bestFor: [],
    params: [
      { id: "strength", label: "Strength", min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
    ],
  },
  {
    id: "clamp_upper_half", label: "Clamp Upper Half", category: "behavior",
    summary: "Remap into 50–100. Keeps motion shape; locks high.",
    description: "Remaps all positions into the upper half of the range (50–100). The phrase's full motion is preserved but scaled into the top half.",
    bestFor: [],
    params: [],
  },
  {
    id: "clamp_lower_half", label: "Clamp Lower Half", category: "behavior",
    summary: "Remap into 0–50. Keeps motion shape; locks low.",
    description: "Remaps all positions into the lower half of the range (0–50).",
    bestFor: [],
    params: [],
  },
  {
    id: "invert", label: "Invert", category: "behavior",
    summary: "Flip positions around midpoint — 70 becomes 30.",
    description: "Flips all positions around the midpoint. Position 70 becomes 30; position 20 becomes 80. Useful when motion is phase-inverted, or for counterpoint between overlapping phrases.",
    bestFor: [],
    params: [],
  },
  {
    id: "boost_contrast", label: "Boost Contrast", category: "behavior",
    summary: "Push positions toward extremes; less time in middle.",
    description: "Pushes positions toward the extremes (0 and 100) and away from the midpoint. The result is more pronounced peaks and troughs with less time in the middle range. Often effective on drone phrases.",
    bestFor: ["drone"],
    params: [
      { id: "strength", label: "Strength", min: 0.0, max: 1.0, step: 0.05, default: 0.5 },
    ],
  },
  {
    id: "shift", label: "Shift", category: "behavior",
    summary: "Add a fixed offset to every position.",
    description: "Adds a fixed offset to every position, clamped to [0, 100]. Useful to nudge a phrase up or down without changing its shape.",
    bestFor: [],
    params: [
      { id: "offset", label: "Offset", min: -50, max: 50, step: 1, default: 0 },
    ],
  },
  {
    id: "recenter", label: "Recenter", category: "behavior",
    summary: "Move motion to a target center; preserves amplitude.",
    description: "Shifts all positions so the phrase's midpoint lands at the target value. Preserves amplitude and shape — just moves it. Primary fix for drift and half_stroke.",
    bestFor: ["drift", "half_stroke"],
    params: [
      { id: "center", label: "Target center", min: 0, max: 100, step: 1, default: 50 },
    ],
  },
  {
    id: "break", label: "Break", category: "behavior",
    summary: "Reduce amplitude and soften — quieter motion.",
    description: "Reduces amplitude by a fraction and applies light LPF smoothing. The result is quieter, softer motion — like a rest or recovery section.",
    bestFor: [],
    params: [
      { id: "amp_reduce", label: "Amplitude reduce", min: 0.0, max: 1.0, step: 0.05, default: 0.40 },
      { id: "lpf",        label: "LPF strength",     min: 0.0, max: 0.5, step: 0.01, default: 0.30 },
    ],
  },
  {
    id: "performance", label: "Performance", category: "behavior",
    summary: "Composite high-BPM shaper — caps velocity, softens reversals.",
    description: "A composite transform for high-BPM phrases. Applies velocity capping, softened reversals, range compression, and LPF smoothing — shaped to feel intentional rather than mechanical.",
    bestFor: ["stingy"],
    params: [
      { id: "max_vel",    label: "Max velocity",      min: 0.05, max: 1.0, step: 0.01, default: 0.32 },
      { id: "rev_soft",   label: "Reversal soften",   min: 0.0,  max: 1.0, step: 0.01, default: 0.62 },
      { id: "h_blend",    label: "Height blend",      min: 0.0,  max: 1.0, step: 0.01, default: 0.75 },
      { id: "range_low",  label: "Range low",         min: 0,    max: 40,  step: 1,    default: 15 },
      { id: "range_high", label: "Range high",        min: 60,   max: 100, step: 1,    default: 92 },
      { id: "lpf",        label: "LPF strength",      min: 0.0,  max: 0.5, step: 0.01, default: 0.16 },
    ],
  },
  {
    id: "three_one_pulse", label: "Three-One Pulse", category: "behavior",
    summary: "Three strokes, one rest beat — a 3+1 breathing rhythm.",
    description: "Groups strokes into a 3+1 rhythm — three full strokes followed by one flat hold beat, repeating across the phrase. Gives fast phrases a breathing pattern.",
    bestFor: ["stingy"],
    params: [
      { id: "amp_scale",  label: "Amplitude scale",   min: 0.1, max: 3.0, step: 0.05, default: 1.0 },
      { id: "range_low",  label: "Range low",         min: 0,   max: 49,  step: 1,    default: 0 },
      { id: "range_high", label: "Range high",        min: 51,  max: 100, step: 1,    default: 100 },
    ],
  },
  {
    id: "beat_accent", label: "Beat Accent", category: "behavior",
    summary: "Emphasize every Nth stroke — pulse without changing tempo.",
    description: "Boosts positions away from the center at every Nth stroke reversal. On accented reversals, the position is pushed further toward the extreme — creating a pulsed emphasis. Adds dynamics to drone phrases without changing tempo.",
    bestFor: ["drone"],
    params: [
      { id: "every_n",    label: "Every Nth beat",    min: 1, max: 16,  step: 1, default: 1 },
      { id: "accent",     label: "Accent amount",     min: 1, max: 30,  step: 1, default: 4 },
      { id: "radius_ms",  label: "Radius (ms)",       min: 5, max: 200, step: 1, default: 40 },
      { id: "start_ms",   label: "Start at (ms)",     min: 0, max: 60000, step: 100, default: 0 },
      { id: "max_acc",    label: "Max accents (0=∞)", min: 0, max: 200, step: 1, default: 0 },
    ],
  },
  {
    id: "blend_seams", label: "Blend Seams", category: "behavior",
    summary: "Smooth high-velocity jumps at phrase boundaries.",
    description: "Detects high-velocity jumps at the boundaries between transforms and applies bilateral LPF smoothing only at those seams. Interior of each phrase is untouched. Also available as a global option at export.",
    bestFor: [],
    params: [
      { id: "max_vel",  label: "Max velocity (pos/ms)", min: 0.05, max: 2.0, step: 0.05, default: 0.50 },
      { id: "max_str",  label: "Max blend strength",    min: 0.0,  max: 1.0, step: 0.05, default: 0.70 },
    ],
  },
  {
    id: "final_smooth", label: "Final Smooth", category: "behavior",
    summary: "Light LPF finishing pass — removes residual sharp edges.",
    description: "A light global LPF finishing pass applied across the entire phrase. Keep strength low to avoid dulling. Also available as a global option at export — you rarely need it per-phrase.",
    bestFor: [],
    params: [
      { id: "strength", label: "Strength", min: 0.01, max: 0.5, step: 0.01, default: 0.10 },
    ],
  },
  {
    id: "funnel", label: "Funnel", category: "behavior",
    summary: "Progressively shift center and amplitude across the phrase.",
    description: "Progressively shifts the center and scales the amplitude from start to end. Define starting and ending states and the transform interpolates between them. Best for phrases that ramp or taper.",
    bestFor: ["ramp"],
    params: [
      { id: "start_ctr",  label: "Start center",        min: 0,   max: 100, step: 1,    default: 30 },
      { id: "end_ctr",    label: "End center",          min: 0,   max: 100, step: 1,    default: 70 },
      { id: "start_amp",  label: "Start amplitude",     min: 0.0, max: 2.0, step: 0.05, default: 0.2 },
      { id: "end_amp",    label: "End amplitude",       min: 0.0, max: 2.0, step: 0.05, default: 1.0 },
    ],
  },

  // ──────────────────────────────────────────────────────────────────
  // STRUCTURAL — 6 (change action count / timestamps)
  // ──────────────────────────────────────────────────────────────────
  {
    id: "halve_tempo", label: "Halve Tempo", category: "structural",
    summary: "Keep every other cycle; retime evenly. Halves BPM.",
    description: "Keeps every other stroke cycle and retimes the remainder evenly across the original duration. Result: half the BPM, same start/end/amplitude. Primary fix for frantic phrases.",
    bestFor: ["frantic"],
    params: [
      { id: "amp_scale", label: "Amplitude scale", min: 0.1, max: 3.0, step: 0.05, default: 1.0 },
    ],
  },
  {
    id: "nudge", label: "Nudge", category: "structural",
    summary: "Shift the phrase forward or backward in time.",
    description: "Shifts the phrase forward or backward in time by a specified number of milliseconds. The gap created at the leading edge is filled with a short transition from the preceding position. Useful when a phrase is slightly out of sync with a beat drop.",
    bestFor: [],
    params: [
      { id: "ms",         label: "Nudge (ms)",       min: -2000, max: 2000, step: 10, default: 0 },
      { id: "trans_ms",   label: "Transition (ms)",  min: 0,    max: 500,  step: 10, default: 100 },
    ],
  },
  {
    id: "stroke", label: "Stroke", category: "structural",
    summary: "Replace with a clean synthetic 0–100 oscillation.",
    description: "Replaces the phrase with a regular synthetic 0–100 oscillation at the phrase's current BPM. Use when motion is so irregular that corrective transforms cannot fix it.",
    bestFor: [],
    params: [
      { id: "bpm", label: "BPM", min: 10, max: 300, step: 1, default: 90 },
    ],
  },
  {
    id: "waiting", label: "Waiting", category: "structural",
    summary: "Very slow oscillation — placeholder for near-still sections.",
    description: "Replaces the phrase with a very slow oscillating stroke. Creates a placeholder for static or near-still sections — keeps the device warm without interrupting the scene. Set Original influence > 0 to blend some of the original motion back in.",
    bestFor: ["ambient"],
    params: [
      { id: "start_pos",   label: "Start position",      min: 0,   max: 100, step: 1,    default: 100 },
      { id: "end_pos",     label: "End position",        min: 0,   max: 100, step: 1,    default: 0 },
      { id: "bpm",         label: "BPM",                 min: 0.0, max: 5.0, step: 0.1,  default: 1.0 },
      { id: "orig_pct",    label: "Original influence", min: 0,   max: 100, step: 1,    default: 0,  unit: "%" },
    ],
  },
  {
    id: "tide", label: "Tide", category: "structural",
    summary: "Fast oscillations riding on a slow sine center.",
    description: "Generates fast oscillations riding on a slow sine-wave center. The center ebbs and flows over the phrase duration while the fast oscillations continue throughout. Gives long phrases a breathing quality.",
    bestFor: [],
    params: [
      { id: "ctr_high",   label: "Center high",   min: 20, max: 90,  step: 1, default: 70 },
      { id: "ctr_low",    label: "Center low",    min: 0,  max: 80,  step: 1, default: 41 },
      { id: "stroke_span",label: "Stroke span",   min: 5,  max: 60,  step: 1, default: 30 },
      { id: "bpm",        label: "BPM",           min: 10, max: 300, step: 1, default: 252 },
      { id: "wave_s",     label: "Wave period (s)",min: 10, max: 600, step: 1, default: 135 },
    ],
  },
  {
    id: "drift", label: "Drift", category: "structural",
    summary: "High plateau with small wobble and a slow dip.",
    description: "Generates a high plateau with small oscillations and one slow dip. Replicates the feeling of the drift behavioral pattern but with intentional shape — distinct from the drift tag the classifier flags.",
    bestFor: [],
    params: [
      { id: "plat_pos",  label: "Plateau position", min: 50,  max: 100, step: 1,    default: 85 },
      { id: "wobble_d",  label: "Wobble depth",     min: 0,   max: 30,  step: 1,    default: 10 },
      { id: "wobble_b",  label: "Wobble BPM",       min: 20,  max: 150, step: 1,    default: 80 },
      { id: "dip_bot",   label: "Dip bottom",       min: 0,   max: 70,  step: 1,    default: 30 },
      { id: "dip_t",     label: "Dip timing",       min: 0.0, max: 0.9, step: 0.01, default: 0.2 },
      { id: "dip_dur",   label: "Dip duration (s)", min: 0.5, max: 15,  step: 0.1,  default: 4.0 },
    ],
  },
];

// Behavioral tags — the 10 from the classifier (docs/reference/behavioral-tags.md).
const FF_TAGS = [
  { id: "stingy",      label: "Stingy",      color: "#ff5470", desc: "High-BPM, full-range hammering. No dynamics.",                primary: "amplitude_scale" },
  { id: "giggle",      label: "Giggle",      color: "#ffb547", desc: "Tiny oscillations near midpoint. Trembling, not stroking.",   primary: "normalize_range" },
  { id: "plateau",     label: "Plateau",     color: "#4dabf7", desc: "Shallow strokes centered. Half-committing.",                  primary: "amplitude_scale" },
  { id: "drift",       label: "Drift",       color: "#c77dff", desc: "Motion confined to top or bottom third. Half the range wasted.", primary: "recenter" },
  { id: "half_stroke", label: "Half-stroke", color: "#a78bfa", desc: "Decent depth, but sitting in one half of the range.",         primary: "recenter" },
  { id: "drone",       label: "Drone",       color: "#94a3b8", desc: "Long, uniform, machine-like. Structurally fine, no dynamics.", primary: "beat_accent" },
  { id: "lazy",        label: "Lazy",        color: "#8b9bff", desc: "Low BPM and shallow. Either intentionally quiet or needs energy.", primary: "amplitude_scale" },
  { id: "frantic",     label: "Frantic",     color: "#ff4b4b", desc: "BPM > 200. Exceeds mechanical limits — device skips.",        primary: "halve_tempo" },
  { id: "ramp",        label: "Ramp",        color: "#3ed598", desc: "Center of gravity shifts across the phrase. Builds or tapers.", primary: "funnel" },
  { id: "ambient",     label: "Ambient",     color: "#64748b", desc: "Very low BPM and amplitude. Filler / breathing room.",         primary: "waiting" },
];

// Stim character presets (Stim tab).
const FF_STIM_CHARACTERS = [
  { id: "gentle",      label: "Gentle",         tagline: "Soft, slow-building",
    desc: "Narrow electrode arc, soft pulse onset. Intensity builds gradually. Good for intimate or slow content.",
    sliders: [{ id: "onset",  label: "Pulse onset",    min: 0, max: 1, step: 0.01, default: 0.7 }] },
  { id: "reactive",    label: "Reactive",       tagline: "Sharp, tracks every stroke",
    desc: "Wide electrode arc, instant response. Sensation tracks the funscript action closely. Good for fast, intense content.",
    sliders: [{ id: "react",  label: "Reactivity",     min: 0, max: 1, step: 0.01, default: 0.85 }] },
  { id: "scene_build", label: "Scene Builder",  tagline: "Builds gradually over the scene",
    desc: "Circular electrode path, slow intensity ramp. Rewards patience — sensation develops over the full scene.",
    sliders: [
      { id: "ramp",    label: "Ramp duration",   min: 0, max: 1, step: 0.01, default: 0.6 },
      { id: "patience",label: "Patience",        min: 0, max: 1, step: 0.01, default: 0.7 },
    ] },
  { id: "unpredict",   label: "Unpredictable",  tagline: "Random direction changes",
    desc: "Zigzag electrode path, varied character. Keeps you guessing — sensation changes direction without warning.",
    sliders: [{ id: "chaos",  label: "Chaos",         min: 0, max: 1, step: 0.01, default: 0.55 }] },
  { id: "balanced",    label: "Balanced",       tagline: "Middle of everything",
    desc: "Circular electrode path, moderate settings. A good starting point for any content.",
    sliders: [{ id: "weight", label: "Weight",        min: 0, max: 1, step: 0.01, default: 0.5 }] },
];

// Multi-axis position styles.
const FF_AXIS_STYLES = [
  { id: "none",       label: "None",       desc: "No secondary motion — device stays centered on all non-stroke axes.",
    axes: { R0: false, R1: false, R2: false, L1: false, L2: false } },
  { id: "cowgirl",    label: "Cowgirl",    desc: "Rocking motion. Pitch follows stroke; gentle roll sway.",
    axes: { R0: "subtle", R1: "gentle", R2: "follow", L1: false, L2: false } },
  { id: "missionary", label: "Missionary", desc: "Side-to-side emphasis. Roll dominant, driven by stroke velocity.",
    axes: { R0: false, R1: "dominant", R2: "gentle", L1: false, L2: false } },
  { id: "doggy",      label: "Doggy",      desc: "Forward-thrust emphasis. Pitch only, biased forward.",
    axes: { R0: false, R1: false, R2: "dominant", L1: false, L2: false } },
  { id: "riding",     label: "Riding",     desc: "Full circular motion. All five secondary axes active.",
    axes: { R0: "walk", R1: "wide", R2: "wide", L1: "drift", L2: "drift" } },
  { id: "random",     label: "Random",     desc: "All axes get independent random walks — “surprise me”.",
    axes: { R0: "walk", R1: "walk", R2: "walk", L1: "walk", L2: "walk" } },
];

// Devices (Device tab) — mechanical column + estim column.
const FF_DEVICES_MECH = [
  { id: "handy",      name: "The Handy",            speed: 400, note: "Linear stroker. Industry standard." },
  { id: "osr_sr6",    name: "OSR2 / SR6",           speed: 500, note: "Multi-axis servo. Depends on build." },
  { id: "intiface",   name: "Intiface (generic)",   speed: 300, note: "Conservative limit for Bluetooth (Lovense, Kiiroo)." },
];
const FF_DEVICES_ESTIM = [
  { id: "legacy",     name: "Legacy 2b / 312",          speed: 500, note: "Continuous waveform audio device.",        audio: true },
  { id: "stereostim", name: "Stereostim (pulse)",       speed: 600, note: "Tingler / EstimHero / ZC95.",              audio: true },
  { id: "foc3",       name: "FOC-Stim 3-phase",         speed: 700, note: "Direct current protocol device.",          audio: false },
  { id: "foc4",       name: "FOC-Stim 4-phase",         speed: 700, note: "Experimental. Same hardware as 3-phase.",  audio: false },
  { id: "neo3",       name: "NeoStim 3-phase",          speed: 550, note: "Protocol device. Limited docs — estimate only.", audio: false },
];

window.FF_TRANSFORMS = FF_TRANSFORMS;
window.FF_TAGS = FF_TAGS;
window.FF_STIM_CHARACTERS = FF_STIM_CHARACTERS;
window.FF_AXIS_STYLES = FF_AXIS_STYLES;
window.FF_DEVICES_MECH = FF_DEVICES_MECH;
window.FF_DEVICES_ESTIM = FF_DEVICES_ESTIM;
