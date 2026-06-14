// PresetLane — a labeled, preset-driven lane: a row of preset pills above a
// read-only smooth curve. The single shared widget behind BOTH the Generate
// tab's Range/Pace lanes (curve = the main funscript's shape) and the Channels
// Passages lane (curve = the secondary-dimension arc). "One widget, two homes,
// two targets" — a user who learns it on Generate already knows it on Channels.
// See DESIGN_DECISIONS.md.
//
// BETA SCOPE: presets only — the curve is read-only here (no drag handles).
// The lane takes a pre-sampled `samples` array (N values in 0..1) so it stays
// agnostic to whatever curve math the caller uses (smoothstep control points
// on Generate, passage shape-factor on Channels).

import { useMemo } from 'react';

function smoothPath(px) {
  if (px.length < 2) return '';
  let d = `M${px[0].x.toFixed(1)},${px[0].y.toFixed(1)}`;
  for (let i = 0; i < px.length - 1; i += 1) {
    const p0 = px[i - 1] || px[i];
    const p1 = px[i];
    const p2 = px[i + 1];
    const p3 = px[i + 2] || px[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// Read-only curve rendered from a samples array (0..1, evenly spaced in time).
function Curve({ title, hint, color, samples, height }) {
  const W = 720;
  const padL = 58;
  const padR = 10;
  const padT = 12;
  const padB = 12;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const px = useMemo(() => {
    const n = samples.length;
    return samples.map((v, i) => ({
      x: padL + (n <= 1 ? 0 : i / (n - 1)) * plotW,
      y: padT + (1 - Math.max(0, Math.min(1, v))) * plotH,
    }));
  }, [samples, plotW, plotH]);
  const yOf = (v) => padT + (1 - v) * plotH;
  const curveD = smoothPath(px);
  const areaD = curveD
    ? `${curveD} L${(padL + plotW).toFixed(1)},${yOf(0).toFixed(1)} L${padL.toFixed(1)},${yOf(0).toFixed(1)} Z`
    : '';
  const gid = `lg-${String(title).replace(/\s+/g, '')}`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <text x={8} y={padT + 11} fill={color} fontSize={11} fontWeight={800} style={{ letterSpacing: '0.04em' }}>{title}</text>
      {hint && <text x={8} y={padT + 25} fill="var(--text-dim)" fontSize={9}>{hint}</text>}
      {[0.5, 1].map((g) => (
        <line key={g} x1={padL} x2={W - padR} y1={yOf(g)} y2={yOf(g)} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 5" opacity={0.55} />
      ))}
      <path d={areaD} fill={`url(#${gid})`} />
      <path d={curveD} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function PresetLane({
  title, hint, color, presets, activeId, onPick, samples, height = 84,
  // Optional START-height lever. When onStartLift is provided, a slider lifts
  // the curve's beginning toward its own peak (the rail) — "same rail, start
  // higher", which with the top pinned is the same as flattening the slope.
  // startLift is 0..1 (0 = preset as authored). The readout shows the RESULTING
  // start height (samples[0]) — what the user actually cares about — not the
  // lift fraction. Same widget on Generate's Range/Pace and Channels Passages.
  startLift, onStartLift,
}) {
  const liftPct = Math.round((startLift ?? 0) * 100);
  // Resulting start height = the (already-lifted) curve's first sample.
  const startPct = samples && samples.length ? Math.round(Math.max(0, Math.min(1, samples[0])) * 100) : 0;
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 4px', flexWrap: 'wrap' }}>
        {onStartLift ? (
          // Compact START-height lever inline with the pills — one row, no
          // separate strip competing with the curve below.
          <span title="raise where the arc begins — same rail, higher start (gentler slope)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>start</span>
            <input
              type="range" min={0} max={100} value={liftPct}
              onChange={(e) => onStartLift(Number(e.target.value) / 100)}
              style={{ width: 84, accentColor: color, cursor: 'pointer' }}
            />
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-soft)', minWidth: 32 }}>{startPct}%</span>
          </span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 'auto' }}>presets</span>
        )}
        {presets.map((pr) => {
          const active = pr.id === activeId;
          return (
            <button
              key={pr.id}
              onClick={() => onPick(pr.id)}
              style={{
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '3px 10px',
                borderRadius: 'var(--r-pill, 999px)', cursor: 'pointer',
                background: active ? color : 'var(--surface-2)',
                border: `1px solid ${color}`,
                color: active ? '#0e1117' : color,
              }}
            >
              {pr.label}
            </button>
          );
        })}
      </div>
      <Curve title={title} hint={hint} color={color} samples={samples} height={height} />
    </div>
  );
}
