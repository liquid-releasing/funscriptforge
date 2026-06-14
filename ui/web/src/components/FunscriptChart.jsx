// FunscriptChart — full funscript visualization for the Project tab.
//
// What Streamlit's chart shows + the interactions Streamlit couldn't:
//   - Velocity colormap (blue → cyan → green → yellow → red) via forgemoment
//     Sparkline's colorMode='velocity'. Same algorithm as
//     forge_ui_components/funscript_chart/core.py.
//   - Drag-to-pan: hold left mouse button + drag horizontally to shift the
//     visible window. Bounds clamp to [0, totalMs].
//   - Wheel-to-zoom: scroll wheel zooms around the cursor position (1.1×
//     per tick, viewport stays within 200ms .. totalMs).
//   - Time axis ticks at the bottom (mm:ss).
//   - Stats footer mirrors the Streamlit footer (duration, actions, avg
//     speed, min/max pos).
//
// State ownership: viewStart/viewEnd are local. The chart never modifies
// the actions array; pan/zoom only change which slice is rendered.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkline, useNativeWheel } from 'forgemoment';
import { axisTickLabels, fmtTimeMs } from '../lib/axisTicks.js';

const MIN_VIEW_MS = 200;

export default function FunscriptChart({
  actions,
  totalMs,
  height = 240,
  // Pre-computed stats over the *full* action set, when the caller has them
  // (e.g., from the Rust load_project bridge). When omitted, the chart
  // computes stats locally from `actions` — fine for the generated previews
  // but wrong for real loaded projects, where `actions` is downsampled.
  totalActionCount,
  avgSpeed,
  minPos,
  maxPos,
  // Optional controlled-viewport mode. When the parent passes both `view`
  // and `onViewChange`, pan/zoom updates flow through them instead of local
  // state — letting two or more charts share one viewport (e.g. Device tab
  // original + device-aware preview always show the same time range).
  view: controlledView,
  onViewChange,
  // When the chart is purely visual (no stats footer / time axis), pass
  // `bare` to suppress them. Lets the parent stack two compact charts
  // without redundant time labels.
  bare = false,
  // Draw faint horizontal rails at pos 0 / 50 / 100 with labels, so the
  // reader can see whether strokes actually reach the rails (the Sparkline's
  // 0-100 domain is fixed: pos 100 = top, pos 0 = bottom). Off by default;
  // the Generate tab turns it on to answer "are we hitting the rails?".
  railGuides = false,
  // Added to time-axis tick LABELS only (not the curve or viewport, which
  // stay 0-based so the transform preview keeps working). Used by slice
  // previews (per-phrase before/after) so the axis reads the phrase's real
  // timeline position (e.g. 22:33) instead of 0:00.
  axisOffsetMs = 0,
}) {
  const containerRef = useRef(null);
  const [internalView, setInternalView] = useState({ start: 0, end: totalMs });
  const isControlled = controlledView != null && typeof onViewChange === 'function';
  const view = isControlled ? controlledView : internalView;
  const setView = isControlled ? onViewChange : setInternalView;
  const [drag, setDrag] = useState(null);

  // Reset viewport when the project (totalMs) changes — only meaningful in
  // uncontrolled mode; controlled parents own the reset behavior.
  useEffect(() => {
    if (!isControlled) setInternalView({ start: 0, end: totalMs });
  }, [totalMs, isControlled]);

  const localStats = useMemo(() => computeStats(actions, totalMs), [actions, totalMs]);
  // Prefer caller-supplied stats (computed on the full action set) over the
  // local stats (which are computed on the downsampled `actions` and would
  // under-report count and avg speed).
  const stats = {
    durationMs: totalMs ?? localStats.durationMs,
    count: totalActionCount ?? localStats.count,
    avgSpeed: avgSpeed != null ? Math.round(avgSpeed).toLocaleString() : localStats.avgSpeed,
    minPos: minPos ?? localStats.minPos,
    maxPos: maxPos ?? localStats.maxPos,
  };

  const visibleActions = useMemo(() => {
    if (!actions || actions.length === 0) return [];
    return actions.filter((a) => a.at >= view.start && a.at <= view.end);
  }, [actions, view.start, view.end]);

  // Absolute velocity max for the colormap denominator. Computed from
  // the FULL actions array, not visibleActions, so the velocity colormap
  // is stable across zoom — the same segment renders the same color at
  // 100% zoom and 10× zoom. Without this, Sparkline normalizes per-
  // window and identical segments shift between blue/red as you scroll.
  const maxVelocity = useMemo(() => {
    if (!actions || actions.length < 2) return 0;
    let max = 0;
    for (let i = 1; i < actions.length; i++) {
      const dt = Math.max(1, actions[i].at - actions[i - 1].at);
      const v = Math.abs(actions[i].pos - actions[i - 1].pos) / dt;
      if (v > max) max = v;
    }
    return max;
  }, [actions]);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setDrag({ startX: e.clientX, startView: view });
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (!drag) return;
    const w = containerRef.current?.clientWidth ?? 1;
    const dx = e.clientX - drag.startX;
    const span = drag.startView.end - drag.startView.start;
    const deltaMs = (dx / w) * span;
    let start = drag.startView.start - deltaMs;
    let end = drag.startView.end - deltaMs;
    if (start < 0) { end += -start; start = 0; }
    if (end > totalMs) { start -= end - totalMs; end = totalMs; }
    if (start < 0) start = 0;
    setView({ start, end });
  };

  const handleMouseUp = () => { if (drag) setDrag(null); };

  // Wheel handler: vertical scroll zooms (anchored on cursor); horizontal
  // scroll pans (trackpad two-finger swipe). Treats the dominant axis as
  // the user's intent so a mouse wheel never accidentally pans and a
  // trackpad swipe never accidentally zooms. Mouse-drag pan still works
  // via the mousedown/move handlers below — this just adds the trackpad
  // gesture for users who don't think to drag.
  //
  // Attached via useNativeWheel so e.preventDefault() actually fires
  // (React's onWheel is passive-by-default).
  const handleWheel = (e) => {
    e.preventDefault();
    const w = containerRef.current?.clientWidth ?? 1;
    const span = view.end - view.start;

    // Horizontal scroll → pan
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const deltaMs = (e.deltaX / w) * span;
      let start = view.start + deltaMs;
      let end = view.end + deltaMs;
      if (start < 0) { end += -start; start = 0; }
      if (end > totalMs) { start -= end - totalMs; end = totalMs; }
      if (start < 0) start = 0;
      setView({ start, end });
      return;
    }

    // Vertical scroll → zoom (anchored on cursor x)
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = view.start + (x / w) * span;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    let newSpan = span * factor;
    if (newSpan < MIN_VIEW_MS) newSpan = MIN_VIEW_MS;
    if (newSpan > totalMs) newSpan = totalMs;
    const leftFrac = (t - view.start) / span;
    let start = t - leftFrac * newSpan;
    let end = start + newSpan;
    if (start < 0) { end += -start; start = 0; }
    if (end > totalMs) { start -= end - totalMs; end = totalMs; }
    if (start < 0) start = 0;
    setView({ start, end });
  };

  useNativeWheel(containerRef, handleWheel);

  return (
    <div style={{ width: '100%' }}>
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: 'relative',
          width: '100%',
          height,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: drag ? 'grabbing' : 'grab',
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <Sparkline
          actions={visibleActions}
          start={view.start}
          end={view.end}
          colorMode="velocity"
          maxVelocity={maxVelocity}
          filled
          height={height - 28}
        />
        {railGuides && <RailGuides plotH={height - 28} />}
        <TimeAxis startMs={view.start} endMs={view.end} originMs={axisOffsetMs} compact={bare} />
      </div>
      {!bare && <StatsRow stats={stats} />}
    </div>
  );
}

// `compact` mode (used by per-row edit-table charts) renders 3 ticks:
// left / center / right. Six ticks at row-chart widths overlap and read
// as noise; three give the user enough "where am I" without crowding.
function TimeAxis({ startMs, endMs, originMs = 0, compact = false }) {
  const tickCount = compact ? 3 : 6;
  // originMs shifts the displayed time into the real timeline (slice previews
  // pass the phrase's at_ms) while ticks are computed on the 0-based viewport.
  const ticks = useMemo(
    () => axisTickLabels(startMs, endMs, tickCount, originMs),
    [startMs, endMs, tickCount, originMs],
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: compact ? 14 : 22,
        display: 'flex',
        justifyContent: 'space-between',
        padding: compact ? '0 4px' : '0 8px',
        fontSize: compact ? 9 : 10,
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        pointerEvents: 'none',
        background: 'linear-gradient(to top, rgba(14,17,22,0.9), transparent)',
        alignItems: 'flex-end',
      }}
    >
      {ticks.map((t, i) => (
        <span key={i}>{t}</span>
      ))}
    </div>
  );
}

// Faint rails at pos 100 (top) / 50 (mid) / 0 (bottom). The Sparkline maps
// pos linearly to its full height (viewBox 0-100, no padding), so these align
// exactly with where strokes land. Top/bottom solid = the rails; mid dashed.
function RailGuides({ plotH }) {
  const rail = (label, topPct, dashed) => (
    <div style={{ position: 'absolute', left: 0, right: 0, top: `${topPct}%`, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', opacity: 0.7, width: 22, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, borderTop: `1px ${dashed ? 'dashed' : 'solid'} var(--border-strong, #2a3142)`, opacity: dashed ? 0.5 : 0.8 }} />
    </div>
  );
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: plotH, pointerEvents: 'none' }}>
      {rail('100', 0, false)}
      {rail('50', 50, true)}
      {rail('0', 100, false)}
    </div>
  );
}

function StatsRow({ stats }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 12,
        marginTop: 14,
        padding: '10px 4px 0',
      }}
    >
      <Stat label="Duration" value={fmtTimeMs(stats.durationMs)} />
      <Stat label="Actions"  value={stats.count.toLocaleString()} />
      <Stat label="Avg speed" value={stats.avgSpeed} />
      <Stat label="Min pos"  value={stats.minPos} />
      <Stat label="Max pos"  value={stats.maxPos} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  );
}

function computeStats(actions, totalMs) {
  if (!actions || actions.length === 0) {
    return { durationMs: totalMs ?? 0, count: 0, avgSpeed: '0', minPos: 0, maxPos: 0 };
  }
  let minPos = 100;
  let maxPos = 0;
  let totalVel = 0;
  let velCount = 0;
  for (let i = 0; i < actions.length; i++) {
    const p = actions[i].pos;
    if (p < minPos) minPos = p;
    if (p > maxPos) maxPos = p;
    if (i > 0) {
      const dt = Math.max(1, actions[i].at - actions[i - 1].at);
      totalVel += (Math.abs(p - actions[i - 1].pos) / dt) * 1000;
      velCount += 1;
    }
  }
  const avgVel = velCount > 0 ? totalVel / velCount : 0;
  return {
    durationMs: totalMs ?? actions[actions.length - 1].at,
    count: actions.length,
    avgSpeed: Math.round(avgVel).toLocaleString(),
    minPos,
    maxPos,
  };
}

