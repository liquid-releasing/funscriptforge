// Time-axis tick helpers for FunscriptChart (extracted so the offset logic
// is unit-testable without rendering the React component).
//
// The chart's viewport is 0-based for slice previews (a phrase's actions are
// re-based to 0 so the transform preview shares one viewport). `originMs`
// shifts only the displayed LABELS back into the real timeline — e.g. a
// phrase at 22:33 shows 22:33/22:37/22:42 instead of 0:00/0:04/0:09 — without
// touching the curve or the viewport.

export function makeTicks(startMs, endMs, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.round(startMs + ((endMs - startMs) * i) / (n - 1)));
  }
  return out;
}

export function fmtTimeMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// Tick labels for a viewport, shifted by originMs into the real timeline.
export function axisTickLabels(startMs, endMs, n, originMs = 0) {
  return makeTicks(startMs, endMs, n).map((t) => fmtTimeMs(t + originMs));
}
