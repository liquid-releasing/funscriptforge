// FunscriptForge prototype — the two-lane axis-changer.
// Two stacked lanes (DEPTH = how deep, DENSITY = how busy), each a draggable
// curve sharing ONE timeline with chapter ticks. Handles: drag a dot up/down
// to change the value; drag an interior dot sideways to move it in time;
// double-click empty space to add a handle; click ✕ to remove one.
// Loaded as text/babel.

const { useRef: useRefL, useState: useStateL, useEffect: useEffectL, useMemo: useMemoL } = React;

// ── curve sampling: monotone-ish catmull interpolation through control pts ──
function sampleCurve(points, t) {
  const p = points;
  if (!p.length) return 0.5;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let i = 0; while (i < p.length - 1 && p[i + 1].t < t) i += 1;
  const a = p[i], b = p[i + 1];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const s = f * f * (3 - 2 * f); // smoothstep — soft, no overshoot
  return a.v + (b.v - a.v) * s;
}
// smooth SVG path through points in pixel space
function smoothPath(px) {
  if (px.length < 2) return '';
  let d = `M${px[0].x.toFixed(1)},${px[0].y.toFixed(1)}`;
  for (let i = 0; i < px.length - 1; i += 1) {
    const p0 = px[i - 1] || px[i], p1 = px[i], p2 = px[i + 1], p3 = px[i + 2] || px[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// preset curve generators (return control points)
const LANE_PRESETS = {
  depth: [
    { id: 'tease',  label: 'Shallow tease', pts: [{ t: 0, v: 0.22 }, { t: 0.55, v: 0.4 }, { t: 0.85, v: 0.92 }, { t: 1, v: 0.7 }] },
    { id: 'full',   label: 'Full depth',    pts: [{ t: 0, v: 0.7 }, { t: 0.5, v: 0.85 }, { t: 1, v: 0.95 }] },
    { id: 'grow',   label: 'Grow to rails', pts: [{ t: 0, v: 0.35 }, { t: 0.5, v: 0.62 }, { t: 1, v: 0.96 }] },
  ],
  density: [
    { id: 'gentle', label: 'Gentle build',   pts: [{ t: 0, v: 0.3 }, { t: 0.6, v: 0.55 }, { t: 1, v: 0.75 }] },
    { id: 'burn',   label: 'Slow burn',      pts: [{ t: 0, v: 0.22 }, { t: 0.5, v: 0.45 }, { t: 0.85, v: 0.95 }, { t: 1, v: 0.45 }] },
    { id: 'edge',   label: 'Edge & release', pts: [{ t: 0, v: 0.35 }, { t: 0.4, v: 0.85 }, { t: 0.55, v: 0.4 }, { t: 0.8, v: 0.97 }, { t: 1, v: 0.5 }] },
  ],
};

function LaneEditor({ laneKey, title, hint, color, points, onChange, sections, duration,
                      playheadMs, height = 96 }) {
  const wrapRef = useRefL(null);
  const [w, setW] = useStateL(720);
  const dragRef = useRefL(null);
  const padL = 56, padR = 10, padT = 12, padB = 14;
  const plotW = () => w - padL - padR;
  const plotH = height - padT - padB;

  useEffectL(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const xOf = (t) => padL + t * plotW();
  const yOf = (v) => padT + (1 - Math.max(0, Math.min(1, v))) * plotH;
  const tOf = (px) => Math.max(0, Math.min(1, (px - padL) / plotW()));
  const vOf = (py) => Math.max(0, Math.min(1, 1 - (py - padT) / plotH));

  const px = useMemoL(() => points.map((p) => ({ x: xOf(p.t), y: yOf(p.v) })), [points, w]);
  const curveD = smoothPath(px);
  const areaD = curveD ? `${curveD} L${xOf(1).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z` : '';

  const setPoint = (idx, t, v) => {
    const next = points.map((p) => ({ ...p }));
    if (idx === 0) next[idx] = { t: 0, v };
    else if (idx === points.length - 1) next[idx] = { t: 1, v };
    else {
      const lo = next[idx - 1].t + 0.01, hi = next[idx + 1].t - 0.01;
      next[idx] = { t: Math.max(lo, Math.min(hi, t)), v };
    }
    onChange(next);
  };
  const onDownHandle = (e, idx) => {
    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    dragRef.current = idx;
  };
  const onMove = (e) => {
    if (dragRef.current == null) return;
    const r = wrapRef.current.getBoundingClientRect();
    setPoint(dragRef.current, tOf(e.clientX - r.left), vOf(e.clientY - r.top));
  };
  const endDrag = () => { dragRef.current = null; };
  const onDbl = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const t = tOf(e.clientX - r.left), v = vOf(e.clientY - r.top);
    if (t <= 0 || t >= 1) return;
    let i = 0; while (i < points.length - 1 && points[i + 1].t < t) i += 1;
    const next = [...points.slice(0, i + 1), { t, v }, ...points.slice(i + 1)];
    onChange(next);
  };
  const removePoint = (idx) => {
    if (idx === 0 || idx === points.length - 1 || points.length <= 2) return;
    onChange(points.filter((_, i) => i !== idx));
  };

  return (
    <div ref={wrapRef} onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag}
         onDoubleClick={onDbl}
         style={{ position: 'relative', width: '100%', height, touchAction: 'none', userSelect: 'none' }}>
      <svg width={w} height={height} style={{ display: 'block', position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`lg-${laneKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* lane label */}
        <text x={8} y={padT + 11} fill={color} fontSize={11} fontWeight={800}
              style={{ letterSpacing: '0.04em' }}>{title}</text>
        <text x={8} y={padT + 25} fill="var(--text-dim)" fontSize={9}>{hint}</text>

        {/* gridlines */}
        {[0.5, 1].map((g) => (
          <line key={g} x1={padL} x2={w - padR} y1={yOf(g)} y2={yOf(g)}
                stroke="var(--border)" strokeWidth={1} strokeDasharray="2 5" opacity={0.55} />
        ))}

        {/* chapter ticks */}
        {sections && sections.map((s, i) => i === 0 ? null : (
          <line key={s.id} x1={xOf(s.beginMs / duration)} x2={xOf(s.beginMs / duration)}
                y1={padT} y2={padT + plotH} stroke="var(--border-strong)" strokeWidth={1} opacity={0.5} />
        ))}

        {/* curve */}
        <path d={areaD} fill={`url(#lg-${laneKey})`} />
        <path d={curveD} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />

        {/* playhead */}
        {playheadMs != null && (
          <line x1={xOf(playheadMs / duration)} x2={xOf(playheadMs / duration)} y1={padT} y2={padT + plotH}
                stroke="#fff" strokeWidth={1.3} opacity={0.7} />
        )}
      </svg>

      {/* handles */}
      {points.map((p, idx) => (
        <div key={idx}
             onPointerDown={(e) => onDownHandle(e, idx)}
             onDoubleClick={(e) => { e.stopPropagation(); removePoint(idx); }}
             title={`${Math.round(p.v * 100)}%  ·  ${window.FF.fmtTime(p.t * duration)}  (double-click to remove)`}
             style={{ position: 'absolute', left: xOf(p.t) - 8, top: yOf(p.v) - 8, width: 16, height: 16,
               borderRadius: '50%', background: color, border: '2px solid var(--bg)',
               boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
               cursor: (idx === 0 || idx === points.length - 1) ? 'ns-resize' : 'move', zIndex: 3 }} />
      ))}
    </div>
  );
}

// ── AxisChanger — the docked two-lane widget ──────────────────────────────
function AxisChanger({ depth, setDepth, density, setDensity, sections, duration, playheadMs }) {
  const Lane = ({ laneKey, title, hint, color, value, setValue }) => (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 0', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginRight: 'auto' }}>presets</span>
        {LANE_PRESETS[laneKey].map((pr) => (
          <button key={pr.id} onClick={() => setValue(pr.pts.map((p) => ({ ...p })))}
            style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '3px 9px',
              borderRadius: 'var(--r-pill)', cursor: 'pointer', background: 'var(--surface-2)',
              border: `1px solid ${color}`, color }}>{pr.label}</button>
        ))}
      </div>
      <LaneEditor laneKey={laneKey} title={title} hint={hint} color={color}
                  points={value} onChange={setValue} sections={sections} duration={duration}
                  playheadMs={playheadMs} />
    </div>
  );
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', overflow: 'hidden' }}>
      <Lane laneKey="depth" title="DEPTH" hint="how deep" color="var(--accent)"
            value={depth} setValue={setDepth} />
      <Lane laneKey="density" title="DENSITY" hint="how busy" color="#4dabf7"
            value={density} setValue={setDensity} />
      {/* shared timeline footer */}
      <div style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
        padding: '6px 12px 8px', paddingLeft: 56 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <span key={i} className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {window.FF.fmtTime(f * duration)}
          </span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { LaneEditor, AxisChanger, sampleCurve, LANE_PRESETS });
