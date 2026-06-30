// forgeStats — funscript statistics for the Viewer stage.
//
// Ported from forgeviewer's pure stats.js (architecture/funscript-quality-
// characteristics.md vocabulary). Trimmed to the single-script metrics the
// Viewer needs — the comparison features (divergence, per-chapter dynamics
// vs. a baseline) are intentionally dropped. Adds `analyzeChannels` to roll a
// device's channels into one whole-device summary.
//
// All velocity figures are pos-units/second (0–100 scale). Pure + testable.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function quantile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedAsc[base + 1] !== undefined) {
    return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
  }
  return sortedAsc[base];
}

export function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

// ── Core stats over an action array ─────────────────────────────────
export function computeStats(actions, durationMs) {
  const n = actions.length;
  const empty = {
    count: n, durationMs, actionsPerSec: 0,
    p25: 0, p50: 0, p75: 0, iqr: 0, rangeLo: 0, rangeHi: 0, usableRange: 0,
    midBandPct: 0, avgStroke: 0, maxStroke: 0,
    avgVelocity: 0, p90Velocity: 0, maxVelocity: 0, avgGapMs: 0,
  };
  if (n < 2) return empty;

  const positions = actions.map((a) => a.pos);
  const sortedPos = [...positions].sort((a, b) => a - b);
  const p25 = quantile(sortedPos, 0.25);
  const p50 = quantile(sortedPos, 0.5);
  const p75 = quantile(sortedPos, 0.75);
  const rangeLo = quantile(sortedPos, 0.05);
  const rangeHi = quantile(sortedPos, 0.95);
  const midBand = positions.filter((p) => p >= 40 && p <= 60).length / n;

  const strokes = [];
  const velocities = [];
  const gaps = [];
  for (let i = 1; i < n; i += 1) {
    const dp = Math.abs(actions[i].pos - actions[i - 1].pos);
    const dt = Math.max(1, actions[i].at - actions[i - 1].at);
    strokes.push(dp);
    velocities.push((dp / dt) * 1000);
    gaps.push(dt);
  }
  const sortedVel = [...velocities].sort((a, b) => a - b);

  return {
    count: n,
    durationMs,
    actionsPerSec: n / (durationMs / 1000),
    p25, p50, p75,
    iqr: p75 - p25,
    rangeLo, rangeHi,
    usableRange: rangeHi - rangeLo,
    midBandPct: midBand * 100,
    avgStroke: mean(strokes),
    maxStroke: Math.max(...strokes),
    avgVelocity: mean(velocities),
    p90Velocity: quantile(sortedVel, 0.9),
    maxVelocity: Math.max(...velocities),
    avgGapMs: mean(gaps),
  };
}

// ── Liveliness — single 0–100 headline ──────────────────────────────
// velocity 40% · stroke 25% · usable range 20% · density 15% (tuned on BBB).
export function livelinessScore(s) {
  const vel = clamp(s.avgVelocity / 260, 0, 1);
  const strk = clamp(s.avgStroke / 55, 0, 1);
  const rng = clamp(s.usableRange / 90, 0, 1);
  const dens = clamp(s.actionsPerSec / 3.2, 0, 1);
  return Math.round((vel * 0.4 + strk * 0.25 + rng * 0.2 + dens * 0.15) * 100);
}

// Position at time ms (linear interp) — for the intensity arc + hover readout.
export function posAt(actions, ms) {
  if (!actions.length) return 50;
  if (ms <= actions[0].at) return actions[0].pos;
  if (ms >= actions[actions.length - 1].at) return actions[actions.length - 1].pos;
  let lo = 0;
  let hi = actions.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].at <= ms) lo = mid;
    else hi = mid;
  }
  const a = actions[lo];
  const b = actions[hi];
  const t = (ms - a.at) / Math.max(1, b.at - a.at);
  return a.pos + t * (b.pos - a.pos);
}

// ── Whole-device summary ────────────────────────────────────────────
// Roll a device's channels ([{ name, actions }]) into one headline summary:
// channel count, total actions, and the mean of each metric across channels
// (so a 9-channel e-stim device reads as one "how lively is this output").
export function analyzeChannels(channels, durationMs) {
  const per = channels
    .filter((c) => c.actions && c.actions.length >= 2)
    .map((c) => {
      const s = computeStats(c.actions, durationMs);
      return { name: c.name, ...s, liveliness: livelinessScore(s) };
    });
  if (!per.length) {
    return { channelCount: channels.length, totalActions: 0, perChannel: [],
             liveliness: 0, actionsPerSec: 0, usableRange: 0, avgVelocity: 0,
             avgStroke: 0 };
  }
  const avg = (k) => mean(per.map((p) => p[k]));
  return {
    channelCount: channels.length,
    totalActions: per.reduce((s, p) => s + p.count, 0),
    perChannel: per,
    liveliness: Math.round(avg('liveliness')),
    actionsPerSec: avg('actionsPerSec'),
    usableRange: avg('usableRange'),
    avgVelocity: avg('avgVelocity'),
    avgStroke: avg('avgStroke'),
  };
}
