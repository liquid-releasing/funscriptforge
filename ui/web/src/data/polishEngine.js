// Polish preview engine — live 3-pane trace for the Polish tab.
//
// Faithful ES-module port of forge/polish.py's tunable chain so the live
// preview matches the file Python actually writes. The authoritative
// speed/delta safety backstop lives in Python (forge.device_specs); this
// module produces the *preview* the user tunes against.
//
// Three traces per pass (all dense {at, pos}, pos 0..100):
//   character: source samples (input)
//   clamped:   what the device can do (smoothing -> slew/rate -> bpm ->
//              quiet floor -> quantize)
//   performed: what the device does (mechanical lag + latency shift) — purely
//              illustrative, never written.

// ─── TCode axis -> MultiFunPlayer sibling suffix (mirror polish.py) ──────────
export const TCODE_SUFFIX = {
  L0: '', L1: 'surge', L2: 'sway', R0: 'twist', R1: 'roll', R2: 'pitch',
};

export function siblingPath(stem, axis) {
  const suffix = TCODE_SUFFIX[axis] ?? axis.toLowerCase();
  return suffix ? `${stem}.${suffix}.funscript` : `${stem}.funscript`;
}

// ─── Transforms (verbatim parity with polish.py) ─────────────────────────────
export function lowpass(samples, strength) {
  const w = Math.min(0.85, strength);
  const n = samples.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = samples[Math.max(0, i - 1)].pos;
    const next = samples[Math.min(n - 1, i + 1)].pos;
    out.push({ at: samples[i].at, pos: samples[i].pos * (1 - w) + ((prev + next) / 2) * w });
  }
  return out;
}

export function slewLimit(samples, rateP100) {
  if (!samples.length) return [];
  const out = [{ at: samples[0].at, pos: samples[0].pos }];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at;
    const maxDelta = rateP100 * 100 * (dt / 100);
    const prev = out[i - 1].pos;
    const delta = samples[i].pos - prev;
    const limited = Math.abs(delta) <= maxDelta ? samples[i].pos : prev + Math.sign(delta) * maxDelta;
    out.push({ at: samples[i].at, pos: limited });
  }
  return out;
}

export function bpmCap(samples, maxBpm) {
  if (!samples.length) return [];
  const n = samples.length;
  const mean = samples.reduce((s, x) => s + x.pos, 0) / n;
  const window = 50;
  const out = samples.map((s) => ({ at: s.at, pos: s.pos }));
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(n - 1, i + window);
    let crossings = 0;
    for (let k = lo + 1; k <= hi; k++) {
      if ((samples[k - 1].pos - mean) * (samples[k].pos - mean) < 0) crossings++;
    }
    const localMs = (samples[hi].at - samples[lo].at) || 1;
    const localBpm = (crossings / 2) * (60000 / localMs);
    if (localBpm > maxBpm) {
      const ratio = Math.min(0.7, localBpm / maxBpm - 1);
      const prev = out[Math.max(0, i - 1)].pos;
      const next = out[Math.min(n - 1, i + 1)].pos;
      out[i].pos = out[i].pos * (1 - ratio) + ((prev + next) / 2) * ratio;
    }
  }
  return out;
}

export function firstOrderLag(samples, tauMs) {
  if (!samples.length) return [];
  const out = [{ at: samples[0].at, pos: samples[0].pos }];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].at - samples[i - 1].at;
    const alpha = 1 - Math.exp(-dt / Math.max(1, tauMs));
    const prev = out[i - 1].pos;
    out.push({ at: samples[i].at, pos: prev + alpha * (samples[i].pos - prev) });
  }
  return out;
}

export function shiftTime(samples, deltaMs) {
  return samples.map((s) => ({ at: s.at + deltaMs, pos: s.pos }));
}

// Mechanical lag time-constant per station (ms). Mirror polish.lag_for_device.
export function lagForStation(stationId) {
  return { handy: 22, tcode: 18, lovense: 35, vacuglide: 28, estim3p: 6 }[stationId] ?? 30;
}

// ─── Dense <-> sparse (mirror polish.py) ─────────────────────────────────────
export function actionsToDense(actions, srMs = 10) {
  if (!actions.length) return [];
  if (actions.length === 1) return [{ at: actions[0].at, pos: actions[0].pos }];
  const out = [];
  let j = 0;
  const t1 = actions[actions.length - 1].at;
  for (let t = actions[0].at; t <= t1; t += srMs) {
    while (j < actions.length - 2 && actions[j + 1].at <= t) j++;
    const a = actions[j], b = actions[j + 1];
    const span = b.at - a.at;
    let frac = span <= 0 ? 0 : (t - a.at) / span;
    frac = Math.max(0, Math.min(1, frac));
    out.push({ at: t, pos: a.pos + (b.pos - a.pos) * frac });
  }
  return out;
}

export function denseToActions(samples) {
  if (!samples.length) return [];
  if (samples.length <= 2) return samples.map((s) => ({ at: Math.round(s.at), pos: Math.round(s.pos) }));
  const out = [{ at: Math.round(samples[0].at), pos: Math.round(samples[0].pos) }];
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1].pos, b = samples[i].pos, c = samples[i + 1].pos;
    if ((b > a && b >= c) || (b < a && b <= c)) out.push({ at: Math.round(samples[i].at), pos: Math.round(b) });
  }
  const last = samples[samples.length - 1];
  out.push({ at: Math.round(last.at), pos: Math.round(last.pos) });
  return out;
}

// ─── The pass ────────────────────────────────────────────────────────────────
// Exported so the e-stim channel preview can clamp each generated channel with
// the live knobs (mirrors per-channel polish.apply_pass) without re-running the
// full previewPass + stats per channel.
export function engineClamp(samples, kind, knobs) {
  let clamped = samples.map((s) => ({ at: s.at, pos: s.pos }));
  if (knobs.smoothing != null && knobs.smoothing > 0) clamped = lowpass(clamped, knobs.smoothing);
  if (knobs.slewRate != null) clamped = slewLimit(clamped, knobs.slewRate);
  if (knobs.rateLimit != null) clamped = slewLimit(clamped, knobs.rateLimit);
  if (knobs.maxBpm != null) clamped = bpmCap(clamped, knobs.maxBpm);
  if (knobs.quietFloor != null && knobs.quietFloor > 0) {
    const floor = knobs.quietFloor * 100;
    clamped = clamped.map((s) => ({ at: s.at, pos: Math.max(s.pos, floor) }));
  }
  if (knobs.quantize != null && (kind === 'stroker' || kind === 'stroker-tcode') && knobs.quantize > 0) {
    const step = knobs.quantize;
    clamped = clamped.map((s) => ({ at: s.at, pos: Math.round(s.pos / step) * step }));
  }
  return clamped;
}

function bpmList(samples) {
  if (!samples.length) return [];
  const mean = samples.reduce((s, x) => s + x.pos, 0) / samples.length;
  const crossings = [];
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1].pos - mean) * (samples[i].pos - mean) < 0) crossings.push(samples[i].at);
  }
  const bpms = [];
  for (let i = 1; i < crossings.length; i++) {
    const dt = crossings[i] - crossings[i - 1];
    if (dt > 0) bpms.push(60000 / (2 * dt));
  }
  return bpms;
}

export function computeStats(src, clamped, stationId) {
  const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x.pos * x.pos, 0) / a.length) : 0);
  const peakDelta = (a, b) => {
    let m = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i].pos - b[i].pos));
    return m;
  };
  return {
    srcMaxBpm: Math.round(Math.max(0, ...bpmList(src))),
    clampMaxBpm: Math.round(Math.max(0, ...bpmList(clamped))),
    srcRms: +rms(src).toFixed(1),
    clampRms: +rms(clamped).toFixed(1),
    peakDelta: +peakDelta(src, clamped).toFixed(1),
    mechLagMs: lagForStation(stationId),
  };
}

// Resolve user knob overrides onto a station's defaults.
export function resolveKnobs(station, overrides) {
  const knobs = {};
  for (const k of station.knobs || []) knobs[k.key] = k.default;
  if (overrides) for (const [k, v] of Object.entries(overrides)) if (v != null) knobs[k] = v;
  return knobs;
}

// Produce the 3-pane preview for a station. `station` is a polishDevices entry.
export function previewPass(actions, station, overrides) {
  const knobs = resolveKnobs(station, overrides);
  const samples = actionsToDense(actions);
  const clamped = samples.length >= 2 ? engineClamp(samples, station.kind, knobs) : samples;

  let performed = clamped.length ? firstOrderLag(clamped, lagForStation(station.id)) : [];
  if (knobs.latency) performed = shiftTime(performed, -knobs.latency);

  return {
    character: samples,
    clamped,
    performed,
    stats: samples.length >= 2 ? computeStats(samples, clamped, station.id) : {},
  };
}
