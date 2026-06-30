// ChannelStack — the Viewer stage's multi-lane review chart.
//
// Purpose-built for reviewing a device's WHOLE generated output at once: an
// audio + spectro + intensity context strip on top, then every channel of the
// selected device stacked as a velocity-coloured curve, all on one shared time
// axis with a single baton. Reading down the stack ("the source is hot here but
// my channels are pale") is what surfaces inconsistencies like a soft intro.
//
// Self-contained (no forgemoment internals) so the shared TrackStack — the
// Events editing chassis — stays untouched. Audio/spectro rendering mirrors
// TrackStack's proven techniques.

import { useEffect, useMemo, useRef, useState } from 'react';

const PAD_X = 8;
const LANE_GAP = 4;
const RULER_H = 16;
const MAX_SPECTRO_COLS = 2048;

// Perceptual blue→red velocity ramp (matches the Forge family chart tokens).
const VEL_STOPS = ['#1f3a8a', '#2563eb', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444'];
const MAGMA = [
  [0.0, [0, 0, 4]], [0.15, [28, 16, 68]], [0.3, [79, 18, 123]], [0.45, [129, 37, 129]],
  [0.6, [181, 54, 122]], [0.72, [229, 80, 100]], [0.85, [251, 135, 97]],
  [0.93, [254, 194, 135]], [1.0, [252, 253, 191]],
];
function magma(t) {
  const x = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < MAGMA.length - 1 && x > MAGMA[i + 1][0]) i += 1;
  const [t0, c0] = MAGMA[i];
  const [t1, c1] = MAGMA[Math.min(i + 1, MAGMA.length - 1)];
  const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f));
}

const LANE_H = { audio: 46, spectro: 40, intensity: 38, channel: 40 };

export default function ChannelStack({
  channels = [],            // [{ name, actions:[{at,pos}] }]
  waveform = null,          // { peaks:[0..1], hopMs }
  spectrogram = null,       // { cells, nMels, nFrames, hopMs }
  intensity = null,         // [{ at, v:0..1 }]
  chapters = null,          // [{ atMs, endMs, color }]
  screechRegions = [],      // [{ start_s, end_s }]
  durationMs = 1,
  currentMs = null,
  getLiveMs = null,
  onSeek,
  selectedChannel = null,
  onSelectChannel,
}) {
  const wrapRef = useRef(null);
  const batonRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [hoverMs, setHoverMs] = useState(null);

  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const start = 0;
  const end = Math.max(1, durationMs);
  const dur = end - start;
  const plotW = Math.max(1, width - PAD_X * 2);
  const xFor = (ms) => PAD_X + ((ms - start) / dur) * plotW;
  const xToMs = (x) => start + ((x - PAD_X) / plotW) * dur;

  // Vertical layout: audio, spectro, intensity (if present), then channels.
  const layout = useMemo(() => {
    const rows = [];
    let y = 0;
    const push = (kind, name, h) => { rows.push({ kind, name, y, h }); y += h + LANE_GAP; };
    if (waveform?.peaks?.length) push('audio', 'audio', LANE_H.audio);
    if (spectrogram?.cells?.length && spectrogram?.nFrames) push('spectro', 'spectro', LANE_H.spectro);
    if (intensity?.length) push('intensity', 'intensity', LANE_H.intensity);
    channels.forEach((c) => push('channel', c.name, LANE_H.channel));
    return { rows, rulerY: y, total: Math.max(1, y + RULER_H) };
  }, [waveform, spectrogram, intensity, channels]);

  const rowFor = (name) => layout.rows.find((r) => r.name === name);

  // Smooth baton driven by the live clock (zero re-renders), TrackStack-style.
  useEffect(() => {
    if (typeof getLiveMs !== 'function') return undefined;
    let raf = 0;
    const tick = () => {
      const el = batonRef.current;
      if (el) {
        const ms = getLiveMs();
        if (ms != null && ms >= start && ms <= end) {
          const x = xFor(ms);
          el.setAttribute('x1', x); el.setAttribute('x2', x);
          el.style.display = '';
        } else { el.style.display = 'none'; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLiveMs, start, end, dur, plotW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Channel polylines, velocity-coloured into a few buckets (cheap SVG).
  const channelPaths = useMemo(() => channels.map((c) => {
    const row = rowFor(c.name);
    if (!row || c.actions.length < 2) return { name: c.name, buckets: [] };
    const yOf = (pos) => row.y + (1 - pos / 100) * row.h;
    const a = c.actions;
    let maxV = 0;
    const v = new Array(a.length).fill(0);
    for (let i = 1; i < a.length; i += 1) {
      const dt = Math.max(1, a[i].at - a[i - 1].at);
      v[i] = Math.abs(a[i].pos - a[i - 1].pos) / dt;
      if (v[i] > maxV) maxV = v[i];
    }
    if (maxV === 0) maxV = 1;
    const NB = VEL_STOPS.length;
    const buckets = new Array(NB).fill('');
    for (let i = 1; i < a.length; i += 1) {
      const bi = Math.min(NB - 1, Math.floor((v[i] / maxV) * NB));
      buckets[bi] += `M${xFor(a[i - 1].at).toFixed(1)},${yOf(a[i - 1].pos).toFixed(1)}L${xFor(a[i].at).toFixed(1)},${yOf(a[i].pos).toFixed(1)}`;
    }
    return { name: c.name, buckets: buckets.map((d, bi) => (d ? { d, color: VEL_STOPS[bi] } : null)).filter(Boolean) };
  }), [channels, layout, plotW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audio waveform path.
  const audioPath = useMemo(() => {
    const row = rowFor('audio');
    if (!row || !waveform?.peaks?.length) return null;
    const peaks = waveform.peaks;
    const hopMs = waveform.hopMs || 10;
    const f1 = Math.min(peaks.length, Math.ceil(end / hopMs));
    const cols = Math.max(2, Math.min(Math.floor(plotW), f1));
    const cy = row.y + row.h / 2;
    const half = row.h / 2 - 2;
    let maxA = 0;
    const amp = new Array(cols).fill(0);
    for (let c = 0; c < cols; c += 1) {
      const lo = Math.floor((c / cols) * f1);
      const hi = Math.max(lo + 1, Math.floor(((c + 1) / cols) * f1));
      let m = 0;
      for (let i = lo; i < hi; i += 1) { const x = Math.abs(peaks[i] ?? 0); if (x > m) m = x; }
      amp[c] = m; if (m > maxA) maxA = m;
    }
    if (maxA <= 0) maxA = 1;
    const top = []; const bot = [];
    for (let c = 0; c < cols; c += 1) {
      const x = PAD_X + (c / (cols - 1)) * plotW;
      const h = (amp[c] / maxA) * half;
      top.push(`${x.toFixed(1)},${(cy - h).toFixed(1)}`);
      bot.push(`${x.toFixed(1)},${(cy + h).toFixed(1)}`);
    }
    return `M${top.join('L')}L${bot.reverse().join('L')}Z`;
  }, [waveform, end, plotW, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spectro magma image.
  const spectroUrl = useMemo(() => {
    const row = rowFor('spectro');
    if (!row || !spectrogram?.cells?.length || typeof document === 'undefined') return null;
    const { cells, nMels, nFrames } = spectrogram;
    if (!nMels || !nFrames) return null;
    const vw = Math.min(nFrames, MAX_SPECTRO_COLS);
    const canvas = document.createElement('canvas');
    canvas.width = vw; canvas.height = nMels;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(vw, nMels);
    for (let t = 0; t < vw; t += 1) {
      const a = Math.floor((t / vw) * nFrames);
      const b = Math.max(a + 1, Math.floor(((t + 1) / vw) * nFrames));
      for (let bin = 0; bin < nMels; bin += 1) {
        let m = 0;
        for (let fr = a; fr < b; fr += 1) { const v = cells[fr * nMels + bin] ?? 0; if (v > m) m = v; }
        const [r, g, bl] = magma(m / 255);
        const px = ((nMels - 1 - bin) * vw + t) * 4;
        img.data[px] = r; img.data[px + 1] = g; img.data[px + 2] = bl; img.data[px + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    return url && url.length > 16 ? url : null;
  }, [spectrogram, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intensity arc (filled area).
  const intensityPath = useMemo(() => {
    const row = rowFor('intensity');
    if (!row || !intensity?.length) return null;
    const yOf = (v) => row.y + (1 - Math.max(0, Math.min(1, v))) * row.h;
    const pts = intensity.map((p) => `${xFor(p.at).toFixed(1)},${yOf(p.v).toFixed(1)}`);
    return `M${PAD_X},${row.y + row.h}L${pts.join('L')}L${(PAD_X + plotW).toFixed(1)},${row.y + row.h}Z`;
  }, [intensity, layout, plotW]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = useMemo(() => Array.from({ length: 7 }, (_, i) => start + (dur * i) / 6), [dur]);
  const fmt = (ms) => {
    const s = Math.max(0, ms / 1000);
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = Math.floor(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
  };

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <svg
        width={width} height={layout.total}
        style={{ display: 'block', background: 'var(--bg, #0e1117)', borderRadius: 8, cursor: 'pointer' }}
        onClick={(e) => {
          if (!onSeek) return;
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(Math.max(start, Math.min(end, xToMs(e.clientX - r.left))));
        }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverMs(xToMs(e.clientX - r.left));
        }}
        onMouseLeave={() => setHoverMs(null)}
      >
        {/* chapter tint bands across all lanes */}
        {chapters && chapters.map((ch, i) => {
          const x = xFor(ch.atMs); const w = xFor(ch.endMs) - x;
          return <rect key={i} x={x} y={0} width={Math.max(0, w)} height={layout.rulerY}
                       fill={ch.color || '#888'} opacity={0.06} />;
        })}

        {/* lane backgrounds */}
        {layout.rows.map((row) => (
          <rect key={`bg-${row.name}`} x={PAD_X} y={row.y} width={plotW} height={row.h}
                fill="rgba(255,255,255,0.025)" rx={4}
                stroke={row.name === selectedChannel ? 'var(--accent, #ff4b4b)' : 'transparent'}
                strokeWidth={1}
                onClick={(e) => { if (onSelectChannel && row.kind === 'channel') { e.stopPropagation(); onSelectChannel(row.name); } }}
                style={{ cursor: row.kind === 'channel' ? 'pointer' : 'inherit' }} />
        ))}

        {spectroUrl && (() => { const r = rowFor('spectro'); return (
          <image href={spectroUrl} x={PAD_X} y={r.y} width={plotW} height={r.h}
                 preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />
        ); })()}

        {audioPath && <path d={audioPath} fill="rgba(120,180,255,0.4)" stroke="rgba(160,205,255,0.8)" strokeWidth={0.6} style={{ pointerEvents: 'none' }} />}

        {intensityPath && <path d={intensityPath} fill="rgba(255,140,66,0.35)" stroke="rgba(255,140,66,0.85)" strokeWidth={1} style={{ pointerEvents: 'none' }} />}

        {/* channel curves */}
        {channelPaths.map((c) => (
          <g key={c.name} style={{ pointerEvents: 'none' }}>
            {c.buckets.map((bk, i) => (
              <path key={i} d={bk.d} stroke={bk.color} strokeWidth={c.name === selectedChannel ? 1.5 : 1.1}
                    fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        ))}

        {/* lane labels (drawn over content) */}
        {layout.rows.map((row) => (
          <text key={`lbl-${row.name}`} x={PAD_X + 6} y={row.y + 11} fontSize={9} fontWeight={700}
                fill={row.kind === 'spectro' ? 'rgba(255,255,255,0.66)' : 'rgba(255,255,255,0.4)'}
                style={{ pointerEvents: 'none', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {row.name}
          </text>
        ))}

        {/* screech note ticks on the ruler */}
        {(screechRegions || []).map((s, i) => {
          const x = xFor((s.start_s || 0) * 1000);
          return <g key={`sc-${i}`} style={{ pointerEvents: 'none' }}>
            <line x1={x} x2={x} y1={0} y2={layout.rulerY} stroke="var(--warn, #ffb547)" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
            <text x={x + 3} y={layout.rulerY + 11} fontSize={9} fill="var(--warn, #ffb547)">⚠</text>
          </g>;
        })}

        {/* ruler */}
        {ticks.map((ms, i) => (
          <text key={`tk-${i}`} x={Math.min(plotW + PAD_X - 2, Math.max(PAD_X, xFor(ms)))} y={layout.rulerY + 11}
                fontSize={9} fill="var(--text-dim, #6b7390)"
                textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
                style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono, monospace)' }}>
            {fmt(ms)}
          </text>
        ))}

        {/* hover crosshair */}
        {hoverMs != null && (
          <line x1={xFor(hoverMs)} x2={xFor(hoverMs)} y1={0} y2={layout.rulerY}
                stroke="var(--text-dim, #6b7390)" strokeWidth={1} opacity={0.5} style={{ pointerEvents: 'none' }} />
        )}

        {/* baton — big shared playhead */}
        {getLiveMs ? (
          <line ref={batonRef} x1={0} x2={0} y1={0} y2={layout.rulerY}
                stroke="var(--accent, #ff4b4b)" strokeWidth={2}
                style={{ pointerEvents: 'none', display: 'none' }} />
        ) : (currentMs != null && currentMs >= start && currentMs <= end && (
          <line x1={xFor(currentMs)} x2={xFor(currentMs)} y1={0} y2={layout.rulerY}
                stroke="var(--accent, #ff4b4b)" strokeWidth={2} style={{ pointerEvents: 'none' }} />
        ))}
      </svg>
    </div>
  );
}
