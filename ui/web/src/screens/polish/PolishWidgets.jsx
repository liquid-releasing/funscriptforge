// Polish — shared UI atoms, ported from the v3 design handoff
// (forge-ui-design/.../polish-shared.jsx). Converted from window.* globals to
// ES-module exports + props. Visuals match the mock 1:1 (hi-fi target).

import React from 'react';

// ─── Color helper — lighten/darken a #rrggbb hex by `pct` (−100..100). ───────
export function shade(hex, pct) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const f = pct / 100;
  const ch = (shift) => {
    const c = (n >> shift) & 0xff;
    const v = Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f);
    return Math.max(0, Math.min(255, v));
  };
  return `#${((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`;
}

export function fmtKnobValue(v, knob) {
  if (knob.unit === 'bpm') return `${Math.round(v)} bpm`;
  if (knob.unit === 'ms') return `${v > 0 ? '+' : ''}${Math.round(v)} ms`;
  if (knob.unit === 'lvl') return `${Math.round(v)} levels`;
  if (knob.unit === '%') return `${v}%`;
  if (knob.unit === '/100ms') return `${Number(v).toFixed(2)}/100ms`;
  return Number(v).toFixed(2);
}

// ─── Three-pane trace preview (character / device-envelope / as-performed) ───
export function TracePane({ traces, phrases, totalMs, height = 240, ember = '#ff7a3a', compact = false, fill = false }) {
  const W = 1000;
  const H = height;
  const padX = 24;
  const padY = 8;
  const innerW = W - padX * 2;
  const xOf = (ms) => padX + (ms / totalMs) * innerW;
  const yOf = (pos, rowTop, rowH) => rowTop + (1 - pos / 100) * rowH;

  const rows = 3;
  const ribbonH = compact ? 10 : 14;
  const rowGap = compact ? 6 : 10;
  const usableH = H - ribbonH - rowGap * 2 - padY * 2;
  const rowH = (usableH - rowGap * (rows - 1)) / rows;
  const ribbonTop = padY;

  function path(samples, rowTop) {
    if (!samples || !samples.length) return '';
    let d = `M ${xOf(samples[0].at)} ${yOf(samples[0].pos, rowTop, rowH)}`;
    const step = Math.max(1, Math.floor(samples.length / 600));
    for (let i = step; i < samples.length; i += step) {
      d += ` L ${xOf(samples[i].at)} ${yOf(samples[i].pos, rowTop, rowH)}`;
    }
    return d;
  }
  function area(samples, rowTop) {
    if (!samples || !samples.length) return '';
    let d = `M ${xOf(samples[0].at)} ${rowTop + rowH}`;
    const step = Math.max(1, Math.floor(samples.length / 600));
    for (let i = 0; i < samples.length; i += step) {
      d += ` L ${xOf(samples[i].at)} ${yOf(samples[i].pos, rowTop, rowH)}`;
    }
    d += ` L ${xOf(samples[samples.length - 1].at)} ${rowTop + rowH} Z`;
    return d;
  }

  const labelStyle = {
    fontFamily: 'var(--font-mono)', fontSize: compact ? 8 : 9.5, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  };
  const gradId = `ember-grad-${ember.slice(1)}`;
  const r1 = ribbonTop + ribbonH + rowGap;
  const r2 = r1 + rowH + rowGap;
  const r3 = r2 + rowH + rowGap;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: fill ? '100%' : H, display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={ember} stopOpacity={0.55} />
          <stop offset="100%" stopColor={ember} stopOpacity={0.05} />
        </linearGradient>
        <linearGradient id="char-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#9ba3c4" stopOpacity={0.32} />
          <stop offset="100%" stopColor="#9ba3c4" stopOpacity={0.04} />
        </linearGradient>
      </defs>

      {(phrases || []).map((p) => (
        <g key={p.id}>
          <rect x={xOf(p.start)} y={ribbonTop} width={Math.max(0, xOf(p.end) - xOf(p.start))} height={ribbonH}
            fill={p.color} opacity={0.18} rx={2} />
          <rect x={xOf(p.start)} y={ribbonTop} width={3} height={ribbonH} fill={p.color} opacity={0.9} />
          {!compact && (
            <text x={xOf(p.start) + 8} y={ribbonTop + ribbonH - 3.5}
              fontFamily="var(--font-mono)" fontSize={8.5} fontWeight={700}
              fill={p.color} letterSpacing="0.08em" style={{ textTransform: 'uppercase' }}>
              {p.label}
            </text>
          )}
        </g>
      ))}

      <rect x={padX} y={r1} width={innerW} height={rowH} fill="rgba(255,255,255,0.015)" rx={3} />
      <path d={area(traces.character, r1)} fill="url(#char-grad)" />
      <path d={path(traces.character, r1)} stroke="#9ba3c4" strokeWidth={1} fill="none" />
      <text x={padX + 4} y={r1 + 11} style={labelStyle} fill="#6b7390">CHANNELS OUTPUT</text>

      <rect x={padX} y={r2} width={innerW} height={rowH} fill="rgba(255,255,255,0.02)" rx={3} stroke={ember} strokeOpacity={0.18} strokeDasharray="3 3" />
      <path d={area(traces.clamped, r2)} fill={`url(#${gradId})`} opacity={0.6} />
      <path d={path(traces.clamped, r2)} stroke={ember} strokeWidth={1.1} fill="none" strokeDasharray="3 2" />
      <text x={padX + 4} y={r2 + 11} style={labelStyle} fill={ember}>DEVICE ENVELOPE</text>

      <rect x={padX} y={r3} width={innerW} height={rowH} fill="rgba(255,255,255,0.025)" rx={3} />
      <path d={area(traces.performed, r3)} fill={`url(#${gradId})`} />
      <path d={path(traces.performed, r3)} stroke={ember} strokeWidth={1.5} fill="none" />
      <text x={padX + 4} y={r3 + 11} style={labelStyle} fill={ember}>AS PERFORMED · WITH MECHANICAL LAG</text>
    </svg>
  );
}

// ─── E-stim channel lanes — the ACTUAL generated channels ────────────────────
// For e-stim the device plays 9 modulation channels, not position, so the
// position-motion TracePane shows the wrong signal. Each lane here is ONE real
// generated channel: its RAW curve (ghost, dashed) under the knob-CLAMPED curve
// (solid ember = what the device gets). Lanes are different channels, not
// processing stages — so there's no "as performed" lag row.
export function ChannelLanes({ lanes, phrases, totalMs, height = 240, ember = '#c075ff', fill = false }) {
  const W = 1000;
  const H = height;
  const padX = 24;
  const padY = 8;
  const innerW = W - padX * 2;
  const safeTotal = Math.max(1, totalMs);
  const xOf = (ms) => padX + (ms / safeTotal) * innerW;
  const yOf = (pos, rowTop, rowH) => rowTop + (1 - pos / 100) * rowH;
  const n = Math.max(1, lanes.length);
  const ribbonH = 14;
  const rowGap = 8;
  const usableH = H - ribbonH - rowGap - padY * 2;
  const rowH = (usableH - rowGap * (n - 1)) / n;
  const ribbonTop = padY;

  function path(samples, rowTop) {
    if (!samples || !samples.length) return '';
    let d = `M ${xOf(samples[0].at)} ${yOf(samples[0].pos, rowTop, rowH)}`;
    const step = Math.max(1, Math.floor(samples.length / 600));
    for (let i = step; i < samples.length; i += step) {
      d += ` L ${xOf(samples[i].at)} ${yOf(samples[i].pos, rowTop, rowH)}`;
    }
    return d;
  }
  function area(samples, rowTop) {
    if (!samples || !samples.length) return '';
    let d = `M ${xOf(samples[0].at)} ${rowTop + rowH}`;
    const step = Math.max(1, Math.floor(samples.length / 600));
    for (let i = 0; i < samples.length; i += step) {
      d += ` L ${xOf(samples[i].at)} ${yOf(samples[i].pos, rowTop, rowH)}`;
    }
    d += ` L ${xOf(samples[samples.length - 1].at)} ${rowTop + rowH} Z`;
    return d;
  }
  // Filled band BETWEEN the raw (input) and clamped (output) curves — they share
  // timestamps, so this polygon is exactly "what the knobs changed". Where the
  // curves coincide the band vanishes; where the device reshapes the signal it
  // widens, so the slider effect reads at a glance without staring.
  function deltaBand(rawS, clampedS, rowTop) {
    if (!rawS?.length || !clampedS?.length) return '';
    const step = Math.max(1, Math.floor(clampedS.length / 600));
    let d = '';
    for (let i = 0; i < clampedS.length; i += step) {
      d += `${i === 0 ? 'M' : 'L'} ${xOf(clampedS[i].at)} ${yOf(clampedS[i].pos, rowTop, rowH)} `;
    }
    for (let i = rawS.length - 1; i >= 0; i -= step) {
      d += `L ${xOf(rawS[i].at)} ${yOf(rawS[i].pos, rowTop, rowH)} `;
    }
    return `${d}Z`;
  }

  const labelStyle = {
    fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
  };
  const gradId = `chan-grad-${ember.slice(1)}`;
  const RAW_COLOR = '#7fd6ff';   // input (cool) — contrasts with the ember output
  const DELTA_COLOR = '#ffb547'; // the knob effect (warm) — pops against both

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: fill ? '100%' : H, display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={ember} stopOpacity={0.5} />
          <stop offset="100%" stopColor={ember} stopOpacity={0.04} />
        </linearGradient>
      </defs>

      {(phrases || []).map((p) => (
        <g key={p.id}>
          <rect x={xOf(p.start)} y={ribbonTop} width={Math.max(0, xOf(p.end) - xOf(p.start))} height={ribbonH}
            fill={p.color} opacity={0.18} rx={2} />
          <rect x={xOf(p.start)} y={ribbonTop} width={3} height={ribbonH} fill={p.color} opacity={0.9} />
          <text x={xOf(p.start) + 8} y={ribbonTop + ribbonH - 3.5}
            fontFamily="var(--font-mono)" fontSize={8.5} fontWeight={700}
            fill={p.color} letterSpacing="0.08em" style={{ textTransform: 'uppercase' }}>
            {p.label}
          </text>
        </g>
      ))}

      {lanes.map((lane, i) => {
        const rowTop = ribbonTop + ribbonH + rowGap + i * (rowH + rowGap);
        return (
          <g key={lane.key}>
            <rect x={padX} y={rowTop} width={innerW} height={rowH} fill="rgba(255,255,255,0.02)" rx={3} />
            {/* the knob effect: filled band between input and output */}
            <path d={deltaBand(lane.raw, lane.clamped, rowTop)} fill={DELTA_COLOR} opacity={0.28} />
            {/* raw generated channel — input (cool, dashed) */}
            <path d={path(lane.raw, rowTop)} stroke={RAW_COLOR} strokeOpacity={0.8} strokeWidth={1} fill="none" strokeDasharray="3 2" />
            {/* knob-clamped — solid ember (what the device actually gets) */}
            <path d={path(lane.clamped, rowTop)} stroke={ember} strokeWidth={1.5} fill="none" />
            <text x={padX + 4} y={rowTop + 11} style={labelStyle} fill={ember}>{lane.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Mini trace for a station card ───────────────────────────────────────────
export function MiniTrace({ samples, totalMs, ember }) {
  const W = 200;
  const H = 30;
  if (!samples?.length || !totalMs) return null;
  const step = Math.max(1, Math.floor(samples.length / 80));
  let d = `M 0 ${H - (samples[0].pos / 100) * H}`;
  for (let i = step; i < samples.length; i += step) {
    d += ` L ${(samples[i].at / totalMs) * W} ${H - (samples[i].pos / 100) * H}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
      <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill={ember} opacity={0.18} />
      <path d={d} stroke={ember} strokeWidth={1} fill="none" />
    </svg>
  );
}

// ─── Device glyph ────────────────────────────────────────────────────────────
export function DeviceGlyph({ kind, size = 28, ember = '#ff7a3a', glow = false }) {
  const filter = glow ? `drop-shadow(0 0 6px ${ember})` : 'none';
  const stroke = ember;
  const props = { width: size, height: size, viewBox: '0 0 32 32', style: { filter } };
  switch (kind) {
    case 'stroker-1ax':
      return (
        <svg {...props}>
          <rect x={5} y={11} width={22} height={10} rx={2} stroke={stroke} fill="none" strokeWidth={1.5} />
          <line x1={10} y1={16} x2={22} y2={16} stroke={stroke} strokeWidth={1.5} />
          <line x1={2} y1={16} x2={5} y2={16} stroke={stroke} strokeWidth={1.5} />
          <line x1={27} y1={16} x2={30} y2={16} stroke={stroke} strokeWidth={1.5} />
          <circle cx={22} cy={16} r={2} fill={stroke} />
        </svg>
      );
    case 'stroker-multi':
      return (
        <svg {...props}>
          <rect x={6} y={12} width={20} height={8} rx={2} stroke={stroke} fill="none" strokeWidth={1.5} />
          <line x1={2} y1={16} x2={6} y2={16} stroke={stroke} strokeWidth={1.5} />
          <line x1={26} y1={16} x2={30} y2={16} stroke={stroke} strokeWidth={1.5} />
          {/* extra axes — twist/roll/pitch ticks */}
          <path d="M 11 8 Q 16 4 21 8" stroke={stroke} fill="none" strokeWidth={1.2} />
          <path d="M 11 24 Q 16 28 21 24" stroke={stroke} fill="none" strokeWidth={1.2} />
          <circle cx={16} cy={16} r={1.6} fill={stroke} />
        </svg>
      );
    case 'estim':
      return (
        <svg {...props}>
          <path d="M 5 16 L 11 8 L 11 14 L 17 6 L 17 18 L 23 10 L 23 22 L 27 16"
            stroke={stroke} fill="none" strokeWidth={1.5} strokeLinejoin="round" />
          <circle cx={5} cy={16} r={1.5} fill={stroke} />
          <circle cx={27} cy={16} r={1.5} fill={stroke} />
        </svg>
      );
    default:
      return <svg {...props}><circle cx={16} cy={16} r={6} stroke={stroke} fill="none" strokeWidth={1.5} /></svg>;
  }
}

// ─── Anvil silhouette (forge metaphor anchor) ────────────────────────────────
export function AnvilGlyph({ size = 36, hot = false, ember = '#ff7a3a' }) {
  const filter = hot ? `drop-shadow(0 0 8px ${ember})` : 'none';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ filter }}>
      {hot && (
        <ellipse cx={24} cy={18} rx={11} ry={3} fill={ember} opacity={0.45}>
          <animate attributeName="opacity" values="0.25;0.55;0.25" dur="1.6s" repeatCount="indefinite" />
        </ellipse>
      )}
      <path d="M 6 17 L 42 17 L 38 23 L 26 23 L 26 29 L 32 29 L 32 33 L 16 33 L 16 29 L 22 29 L 22 23 L 10 23 Z"
        fill={hot ? ember : '#3a3f5c'} stroke={hot ? ember : '#5a6080'} strokeWidth={1.5}
        strokeLinejoin="round" opacity={hot ? 0.85 : 0.65} />
      <line x1={14} y1={36} x2={34} y2={36} stroke="#3a3f5c" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
    </svg>
  );
}

// ─── Heat meter — how much of the source got reshaped ────────────────────────
export function HeatMeter({ value, ember = '#ff7a3a', label, height = 6 }) {
  return (
    <div>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6b7390', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontWeight: 700 }}>
          <span>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', color: ember }}>{Math.round(value * 100)}%</span>
        </div>
      )}
      <div style={{ height, borderRadius: height / 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: `linear-gradient(90deg, ${ember}55, ${ember})`, boxShadow: `0 0 6px ${ember}aa inset`, transition: 'width 200ms' }} />
      </div>
    </div>
  );
}

// ─── Knob row — labelled slider + numeric readout ────────────────────────────
export function KnobRow({ knob, value, onChange, ember = '#ff7a3a', dense = false }) {
  const v = value ?? knob.default;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: dense ? 3 : 5, marginBottom: dense ? 8 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: dense ? 11 : 12, color: '#9ba3c4', fontWeight: 500 }}>{knob.label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: dense ? 11 : 12, color: '#fafafa', fontWeight: 600 }}>
          {fmtKnobValue(v, knob)}
        </span>
      </div>
      <input type="range" min={knob.min} max={knob.max} step={knob.step} value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: ember, height: dense ? 14 : 18 }} />
      {knob.help && (
        <div style={{ fontSize: 10, color: '#6b7390', lineHeight: 1.3 }}>{knob.help}</div>
      )}
    </div>
  );
}

// ─── Stat triplet (before → after) ───────────────────────────────────────────
export function StatTriplet({ label, src, polished, unit = '', accent = '#ff7a3a' }) {
  const same = `${src}` === `${polished}`;
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid #2d3148', borderRadius: 6 }}>
      <div style={{ fontSize: 9.5, color: '#6b7390', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--font-mono)' }}>
        <span style={{ fontSize: 11, color: '#6b7390', textDecoration: same ? 'none' : 'line-through' }}>{src}{unit}</span>
        {!same && <span style={{ color: '#6b7390' }}>→</span>}
        {!same && <span style={{ fontSize: 15, fontWeight: 700, color: accent }}>{polished}{unit}</span>}
      </div>
    </div>
  );
}

// ─── State badge — pending / active / accepted / stale ───────────────────────
export function StateBadge({ state, ember = '#ff7a3a' }) {
  const styles = {
    pending: { bg: 'transparent', col: '#6b7390', lbl: 'pending', border: '1px dashed #3a3f5c' },
    active: { bg: `${ember}22`, col: ember, lbl: 'in forge', border: `1px solid ${ember}` },
    accepted: { bg: 'rgba(62,213,152,0.12)', col: '#3ed598', lbl: 'stamped', border: '1px solid rgba(62,213,152,0.4)' },
    stale: { bg: 'rgba(255,181,71,0.12)', col: '#ffb547', lbl: 'stale', border: '1px solid rgba(255,181,71,0.4)' },
  };
  const s = styles[state] || styles.pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 3, background: s.bg, color: s.col, border: s.border }}>
      {state === 'accepted' && <span style={{ fontSize: 10 }}>✓</span>}
      {state === 'active' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: ember, boxShadow: `0 0 4px ${ember}` }} />}
      {s.lbl}
    </span>
  );
}

// ─── Sparks — decorative forge particles ─────────────────────────────────────
export function Sparks({ ember = '#ff7a3a', count = 6 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', opacity: 0.55 }}>
      {Array.from({ length: count }).map((_, i) => {
        const left = (i * 73) % 100;
        const delay = (i * 0.37) % 2.5;
        const duration = 2 + (i % 4) * 0.4;
        return (
          <span key={i} style={{ position: 'absolute', left: `${left}%`, bottom: -6, width: 2, height: 2, borderRadius: '50%', background: ember, boxShadow: `0 0 4px ${ember}`, animation: `forgeSpark ${duration}s ease-out ${delay}s infinite` }} />
        );
      })}
      <style>{`
        @keyframes forgeSpark {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-120px) scale(0.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
