// Generate tab — the curve→funscript model.
//
// Two macro curves shape the MAIN funscript: RANGE (how far each stroke goes —
// "depth", renamed because "deep" read as down/bass) and PACE (how busy — the
// old "density"). Their product is perceived INTENSITY, which the user watches
// (the chart / heatmap) rather than sets. See
// ui_design/generate_ui/design_handoff_generate_tab/DESIGN_DECISIONS.md.
//
// BETA SCOPE: presets only. The curves are authored by picking a named preset
// pill; they are NOT draggable yet (movable handles are post-beta).
//
// ENGINE SEAM: `generateFromLanes` is a believable STAND-IN today — the real
// generator (videoflow `--density-arc` / `--center-trajectory`) is not yet
// exposed through FunscriptForge's cli.py/bridge. When the generation merge
// lands (project_generator_into_funscriptforge), swap the body of
// `generateFromLanes` for a bridge call; nothing else in the tab changes.

// ── curve sampling — piecewise smoothstep through control points ───────────
// Shared with the (stand-in) generator so the rendered curve and the produced
// strokes agree. Soft, no overshoot.
export function sampleCurve(points, t) {
  const p = points;
  if (!p.length) return 0.5;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let i = 0;
  while (i < p.length - 1 && p[i + 1].t < t) i += 1;
  const a = p[i];
  const b = p[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const s = f * f * (3 - 2 * f); // smoothstep
  return a.v + (b.v - a.v) * s;
}

// Defaults are intentionally WEAK — a flat, mid-range shape — so a fresh tab
// opens with the diagnosis flagging "Flat / hugs the middle" and the fix
// buttons visibly improving it. The author's first move is to pick a preset.
export const DEFAULT_RANGE = [{ t: 0, v: 0.42 }, { t: 1, v: 0.42 }];
export const DEFAULT_PACE = [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }];

// Preset pills. Each replaces the lane's control points wholesale (beta:
// no hand-tuning). `pts` are normalized {t:0..1, v:0..1}. The vocabulary IS
// the teaching — a user learns "this is what a slow burn looks like."
export const RANGE_PRESETS = [
  { id: 'tease', label: 'Shallow tease', pts: [{ t: 0, v: 0.22 }, { t: 0.55, v: 0.4 }, { t: 0.85, v: 0.92 }, { t: 1, v: 0.7 }] },
  { id: 'full', label: 'Full range', pts: [{ t: 0, v: 0.7 }, { t: 0.5, v: 0.85 }, { t: 1, v: 0.95 }] },
  { id: 'grow', label: 'Grow to rails', pts: [{ t: 0, v: 0.35 }, { t: 0.5, v: 0.62 }, { t: 1, v: 0.96 }] },
];
export const PACE_PRESETS = [
  { id: 'gentle', label: 'Gentle build', pts: [{ t: 0, v: 0.3 }, { t: 0.6, v: 0.55 }, { t: 1, v: 0.75 }] },
  { id: 'burn', label: 'Slow burn', pts: [{ t: 0, v: 0.22 }, { t: 0.5, v: 0.45 }, { t: 0.85, v: 0.95 }, { t: 1, v: 0.45 }] },
  { id: 'edge', label: 'Edge & release', pts: [{ t: 0, v: 0.35 }, { t: 0.4, v: 0.85 }, { t: 0.55, v: 0.4 }, { t: 0.8, v: 0.97 }, { t: 1, v: 0.5 }] },
];

// Match a control-point array back to a preset id (for pill highlighting).
// Cheap structural compare — presets are small and distinct.
export function presetIdOf(pts, presets) {
  const key = (a) => a.map((p) => `${p.t.toFixed(3)}:${p.v.toFixed(3)}`).join('|');
  const k = key(pts);
  const hit = presets.find((pr) => key(pr.pts) === k);
  return hit ? hit.id : null;
}

// ── the generator (STAND-IN — see ENGINE SEAM above) ───────────────────────
// RANGE drives stroke amplitude (shallow tease → full rail-to-rail); PACE
// drives tempo (sparse → packed). Deterministic (seeded) so the same curves
// always yield the same script — no flicker between renders.
export function generateFromLanes(rangePts, pacePts, durationMs) {
  const actions = [];
  let t = 0;
  let up = true;
  let seed = 24681;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const dur = Math.max(1, durationMs || 0);
  // Safety cap so a tiny duration or bad input can't spin forever.
  while (t < dur && actions.length < 200000) {
    const td = t / dur;
    const range = sampleCurve(rangePts, td); // 0..1 how far
    const pace = sampleCurve(pacePts, td); // 0..1 how busy
    const bpm = 30 + pace * 168; // 30 → ~198
    const half = 60000 / bpm / 2;
    const amp = 14 + range * 84; // shallow → full rail-to-rail
    const center = 50 + (rnd() - 0.5) * 5 * (1 - range);
    const pos = up ? center + amp / 2 : center - amp / 2;
    actions.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(pos))) });
    t += half * (1 + (rnd() - 0.5) * 0.14);
    up = !up;
  }
  return actions;
}

// ── diagnosis — the quality oracle ─────────────────────────────────────────
// Returns the measured shape of a generated script: where strokes land
// (deciles), how much contrast it has over time (dynamics), rail usage, and
// coverage. This is the implementable half of the "What to fix" panel and is
// designed to run against REAL engine output unchanged.
// Device-safety / coverage thresholds. CALIBRATED AGAINST GOLD (2026-06-14):
// measured avg velocity of hand-made gold spans 350-386 (gentle: VO, ch8,
// rob) up to 591-664 (hot: sinful, RoD). The old 450 line false-flagged VO's
// 467 AND two beloved gold scripts; the old flash% > 0.45 clause flagged
// sinful gold (50% flash). So the ceiling is set just above the hot-gold
// cluster (only genuinely beyond-gold output, e.g. the 686 ch8 wall, trips
// it) and the flash clause is dropped (high flash is a genre, not a defect).
// Dead-air = a long beatless stretch (the audio engine's blind spot — fill
// with events, not fake motion). Tunable.
export const SPEED_CEIL = 600;        // pos-units/sec — above the hot-gold cluster
export const DEAD_AIR_MS = 20000;     // a gap this long reads as dead air

export function diagnose(actions, durationMs) {
  const deciles = new Array(10).fill(0);
  let lo = 100;
  let hi = 0;
  let sumDepth = 0;
  let sumSpeed = 0;
  let flash = 0;
  let n = 0;
  let maxGap = 0;
  for (let i = 0; i < actions.length; i += 1) {
    const p = actions[i].pos;
    deciles[Math.max(0, Math.min(9, Math.floor(p / 10)))] += 1;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
    if (i > 0) {
      const dms = Math.max(1, actions[i].at - actions[i - 1].at);
      sumDepth += Math.abs(p - actions[i - 1].pos);
      const v = (Math.abs(p - actions[i - 1].pos) / dms) * 1000; // units/sec
      sumSpeed += v;
      if (v > 600) flash += 1;
      if (dms > maxGap) maxGap = dms;
      n += 1;
    }
  }
  const max = Math.max(1, ...deciles);
  const norm = deciles.map((d) => d / max);
  const total = actions.length || 1;
  const rails = (deciles[0] + deciles[9]) / total; // mass in bottom+top deciles
  const avgDepth = n ? sumDepth / n : 0; // 0..100
  const avgSpeed = n ? sumSpeed / n : 0; // units/sec
  const flashPct = n ? flash / n : 0;
  const coverage = (hi - lo) / 100;
  const dynamics = Math.max(0, Math.min(1, 0.45 * coverage + 0.30 * (avgDepth / 70) + 0.25 * rails * 2.2));
  // Dead-air: the biggest beatless gap, incl. the lead-in (silence before the
  // first stroke) and the tail. Needs durationMs to see the lead/tail gaps.
  const leadGap = actions.length ? actions[0].at : 0;
  const tailGap = durationMs && actions.length ? Math.max(0, durationMs - actions[actions.length - 1].at) : 0;
  const deadAirMs = Math.max(maxGap, leadGap, tailGap);
  // Drop the old `|| flashPct > 0.45` clause — gold scripts hit 50-58% flash
  // (sinful, RoD), so high flash is a genre signal, not a device-safety defect.
  const tooFast = avgSpeed > SPEED_CEIL;
  return { deciles: norm, dynamics, rails, coverage, avgDepth, avgSpeed, flashPct, deadAirMs, tooFast };
}

// Headline verdict — one word the user reads in half a second. Drives the
// primary-fix suggestion: never show a problem without the button that fixes
// it. `dynamics` is 0..1 from diagnose().
export function verdictFor(dynamics) {
  if (dynamics >= 0.7) return { word: 'Dynamic', tone: 'success' };
  if (dynamics >= 0.45) return { word: 'Decent', tone: 'info' };
  return { word: 'Flat', tone: 'warn' };
}

// The single highest-impact fix for the current diagnosis. Returns the lane +
// preset to apply, plus the human label. Coupling the metric to its fix is the
// whole point — the panel hands the user the button, it doesn't just grade.
export function topFix({ rails, dynamics, tooFast, paceEased }) {
  // Device safety first: a too-fast script reads "Dynamic" on contrast alone
  // but is brutal to play. Speed is how-far x how-often — so ease the PACE
  // (fewer strokes) first. But once the pace is already gentle and it is STILL
  // too fast, the strokes themselves are too long: the only lever left is
  // RANGE — shorter strokes cover less distance per unit time, so avg speed
  // drops. Without this escalation the loop dead-ends (you ease the pace, it
  // doesn't clear, and there is no next button). See dogfood 2026-06-14.
  if (tooFast) {
    if (paceEased) {
      return { lane: 'range', presetId: 'tease', label: 'Shorten the range', why: 'pace is already gentle — long strokes are what is fast now' };
    }
    return { lane: 'pace', presetId: 'gentle', label: 'Ease the pace', why: 'too fast for most devices' };
  }
  if (rails < 0.22) {
    return { lane: 'range', presetId: 'full', label: 'Fill the rails', why: 'strokes hug the middle' };
  }
  if (dynamics < 0.55) {
    return { lane: 'pace', presetId: 'burn', label: 'Add an arc', why: 'it runs at one level' };
  }
  return null;
}

// Human-readable dead-air note (or null). A long beatless stretch is the audio
// engine's blind spot — surface it so the user fills it with events while
// watching, rather than the engine inventing motion the audio doesn't justify.
export function deadAirNote(diag) {
  if (!diag || !diag.deadAirMs || diag.deadAirMs < DEAD_AIR_MS) return null;
  const s = Math.round(diag.deadAirMs / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss} with no beats — author events here while watching.`;
}

// Device position at a given playback time — linear interpolation between the
// two bracketing actions, so a "depth now" meter can track the generated
// funscript while it plays (the body decides, not just the deciles). Returns
// 0..100, or null when there are no actions. Binary search so it stays cheap
// at ~10Hz over 20k+ actions, and correct under arbitrary seeks (not just
// monotonic playback). Clamps to the endpoints before/after the script.
export function positionAtTime(actions, ms) {
  const n = actions ? actions.length : 0;
  if (!n) return null;
  const at = (a) => (a.at ?? a.t ?? 0);
  const pos = (a) => (a.pos ?? a.v ?? 0);
  if (ms <= at(actions[0])) return pos(actions[0]);
  if (ms >= at(actions[n - 1])) return pos(actions[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(actions[mid]) <= ms) lo = mid; else hi = mid;
  }
  const a = actions[lo];
  const b = actions[hi];
  const span = at(b) - at(a);
  if (span <= 0) return pos(a);
  const frac = (ms - at(a)) / span;
  return pos(a) + (pos(b) - pos(a)) * frac;
}

// The target spread for the "where strokes land" histogram — a ghost overlay
// so "good" is visible behind the user's bars. A healthy script spreads across
// the full range with weight toward the rails (rough U), not a mid-range spike.
export const TARGET_DECILES = [0.85, 0.55, 0.4, 0.45, 0.5, 0.5, 0.45, 0.4, 0.55, 0.85];
