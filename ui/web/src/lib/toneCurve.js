// The tone curve — the transform behind the Chapters tab's before/after.
//
// Moved out of ChaptersTab.jsx when Tone Scope landed. It is pure (actions in,
// actions out) and it is the single most consequential piece of math in the
// app — it rewrites the shared motion funscript that the Handy, OSSM and
// FOC-Stim all play — and it had no tests while it lived inside a screen
// component.
//
// ⚠ The header comment below still describes this as a "JS preview" whose
// canonical form will move to `python cli.py tone`. That subcommand does NOT
// exist — cli.py has only `suggest-tone` — so as of 2026-09-23 this IS the
// canonical transform, for both the preview and the baked result.

import { SCOPE, scopeWeights } from './toneScope.js';

// Apply a tone to a chapter's slice of actions. JS preview only — the
// canonical transform will move to `python cli.py tone`. Curve shapes mirror
// the prototype (ui_design/.../tab-Chapters.jsx::applyToneCurve) so the
// before/after preview reads the same here.
export function applyTone(actions, chapterStart, chapterEnd, tone, params) {
  if (!actions || actions.length === 0) return [];
  const slice = actions.filter((a) => a.at >= chapterStart && a.at <= chapterEnd);
  if (slice.length === 0) return [];
  // 'none' / Untoned — passthrough, no transform. Lets the user Accept
  // a chapter without committing to a tone.
  if (tone.id === 'none') return slice.map((a) => ({ at: a.at, pos: a.pos }));
  // 'tame' is applied via the backend transform on Accept (cycle-drop +
  // humanize); its real before/after comes from useTransformPreview, not
  // this JS path. Passthrough here so any merge that happens to encounter
  // a tame'd chapter doesn't throw — it just leaves the slice untouched.
  if (tone.id === 'tame') return slice.map((a) => ({ at: a.at, pos: a.pos }));
  const dur = Math.max(1, chapterEnd - chapterStart);
  const impact = params.impact ?? 1;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  // Tone Scope — a per-action weight on impact, so the tone can apply to only
  // the quiet (or only the loud) parts of the chapter. EVERYWHERE returns all
  // 1s, leaving the arithmetic below exactly as it was. The weight ramps
  // across each region edge rather than switching, which is what keeps 383
  // interleaved regions from becoming 383 discontinuities.
  // See lib/toneScope.js and internal/DESIGN_tone_scope.md.
  //
  // ⚠ Pass the tuning fields through explicitly. An earlier version forwarded
  // only `scope`, so thresholdDepth / windowMs / minRegionMs / rampMs were all
  // silently ignored and every value produced identical output — including
  // rampMs, i.e. the ramping the feature exists for. `undefined` here is
  // correct: it lets each default parameter in scopeWeights apply.
  const weights = scopeWeights(slice, {
    scope: params.scope ?? SCOPE.EVERYWHERE,
    thresholdDepth: params.thresholdDepth,
    windowMs: params.windowMs,
    minRegionMs: params.minRegionMs,
    rampMs: params.rampMs,
  });

  return slice.map((a, i, arr) => {
    const t = (a.at - chapterStart) / dur; // 0..1 progress through chapter
    let v = a.pos;
    if (tone.id === 'tender') {
      const prev = arr[Math.max(0, i - 2)].pos;
      const next = arr[Math.min(arr.length - 1, i + 2)].pos;
      const smoothed = (prev + v * 2 + next) / 4;
      const ceilingPull = (params.ceiling - 110) / 70;
      v = smoothed - (smoothed - 50) * (0.25 - ceilingPull * 0.1);
      v = v - (v - 50) * params.softness * 0.35;
    } else if (tone.id === 'build') {
      const ramp = t ** (1 - params.ramp * 0.7 + 0.3);
      const cap = 100 - params.headroom;
      v = 50 + (v - 50) * (0.4 + ramp * 0.85);
      if (v > cap) v = cap;
    } else if (tone.id === 'tease') {
      const before = t < params.release;
      v = before
        ? 50 + (v - 50) * (1 - params.withhold * 0.7)
        : 50 + (v - 50) * (1 + params.withhold * 0.5);
    } else if (tone.id === 'edge') {
      const inHold = t < params.drop;
      v = inHold
        ? 70 + (v - 50) * (1 - params.hold * 0.55)
        : v - (v - 50) * 0.35;
    } else if (tone.id === 'climax') {
      v = 50 + (v - 50) * (1 + params.contrast * 0.85);
      const sgn = v >= 50 ? 1 : -1;
      v += sgn * (params.density - 1) * 8;
    } else if (tone.id === 'dominant') {
      v = v - (v - 50) * params.recenter * 0.5;
      const beat = Math.sin(t * Math.PI * 18) * params.rhythm * 14;
      v = 50 + (v - 50) * (1 + params.rhythm * 0.3) + beat * 0.4;
    }
    // Mix toned curve toward original by impact (0 = original, 1 = full tone),
    // scaled by this action's scope weight (1 = in scope, 0 = untouched).
    const mixed = a.pos + (v - a.pos) * impact * weights[i];
    return { at: a.at, pos: Math.round(clamp(mixed)) };
  });
}
