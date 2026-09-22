// FunscriptForge prototype — ArcEditor.
// A timeline where the user (1) splits into sections by begin/end time,
// (2) sets each section's type + character, (3) drags the intensity LINE
// directly. No chapters required — sections authored here ARE the substrate.
// Loaded as text/babel.

const { useRef: useRefA, useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

// curvature between two anchor values, per section shape
function bend(shape, f, v0, v1) {
  f = Math.max(0, Math.min(1, f));
  const chord = v0 + (v1 - v0) * f;
  switch ((shape || 'build').toLowerCase()) {
    case 'steady':  return (v0 + v1) / 2;
    case 'sustain': return f < 0.12 ? v0 + (v1 - v0) * (f / 0.12) : v1;
    case 'build':   return v0 + (v1 - v0) * Math.pow(f, 1.7);          // ease-in
    case 'release': return v0 + (v1 - v0) * (1 - Math.pow(1 - f, 1.7)); // ease-out
    case 'swell': {
      const peak = (1 - Math.abs(2 * f - 1));
      return Math.min(1, chord + peak * 0.28);
    }
    default: return chord;
  }
}

// sample whole arc to N points {t, v} — reused by funscript overlay + bands
function sampleArc(sections, duration, n = 240) {
  const out = [];
  if (!sections || !sections.length) return out;
  for (let i = 0; i <= n; i += 1) {
    const t = (i / n) * duration;
    const s = sections.find((x) => t >= x.beginMs && t <= x.endMs) || sections[sections.length - 1];
    const frac = (t - s.beginMs) / Math.max(1, s.endMs - s.beginMs);
    out.push({ t, v: bend(s.shape, frac, s.startVal, s.endVal) });
  }
  return out;
}

// ensure shared boundary values + startVal/endVal exist (seeded from arcAt)
function normalizeSections(sections) {
  return sections.map((s) => ({
    ...s,
    startVal: s.startVal != null ? s.startVal : window.FF.arcAt(s.beginMs / window.FF.DURATION_MS),
    endVal:   s.endVal   != null ? s.endVal   : window.FF.arcAt(s.endMs   / window.FF.DURATION_MS),
  }));
}

function ArcEditor({ sections, duration, onChange, selectedId, onSelect, playheadMs }) {
  const wrapRef = useRefA(null);
  const [w, setW] = useStateA(900);
  const dragRef = useRefA(null);
  const H = 210;
  const padT = 16, padB = 30, padL = 4, padR = 4;
  const plotH = H - padT - padB;
  const plotW = () => w - padL - padR;

  useEffectA(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const secs = useMemoA(() => normalizeSections(sections), [sections]);
  const xOf = (t) => padL + (t / duration) * plotW();
  const yOf = (v) => padT + (1 - Math.max(0, Math.min(1, v))) * plotH;
  const tOf = (px) => Math.max(0, Math.min(duration, ((px - padL) / plotW()) * duration));
  const vOf = (py) => Math.max(0, Math.min(1, 1 - (py - padT) / plotH));

  // anchors: one per boundary (N+1)
  const anchors = useMemoA(() => {
    const a = [{ tMs: secs[0]?.beginMs ?? 0, value: secs[0]?.startVal ?? 0.5, kind: 'end' }];
    secs.forEach((s) => a.push({ tMs: s.endMs, value: s.endVal }));
    return a;
  }, [secs]);

  const writeAnchor = (idx, tMs, value) => {
    const next = secs.map((s) => ({ ...s }));
    // value applies to left section's endVal + right section's startVal
    if (idx > 0) { next[idx - 1].endVal = value; next[idx - 1].endMs = tMs; }
    if (idx < next.length) { next[idx].startVal = value; next[idx].beginMs = tMs; }
    onChange(next);
  };

  const onPointerDownAnchor = (e, idx) => {
    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    const isEnd = idx === 0 || idx === anchors.length - 1;
    dragRef.current = { idx, isEnd };
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const { idx, isEnd } = dragRef.current;
    let tMs = anchors[idx].tMs;
    if (!isEnd) {
      const lo = anchors[idx - 1].tMs + 1000;
      const hi = anchors[idx + 1].tMs - 1000;
      tMs = Math.max(lo, Math.min(hi, tOf(px)));
    }
    writeAnchor(idx, tMs, vOf(py));
  };
  const endDrag = () => { dragRef.current = null; };

  // double-click to add a boundary (split section)
  const onDblClick = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const t = tOf(e.clientX - rect.left);
    const idx = secs.findIndex((s) => t > s.beginMs + 1500 && t < s.endMs - 1500);
    if (idx < 0) return;
    const s = secs[idx];
    const frac = (t - s.beginMs) / (s.endMs - s.beginMs);
    const midVal = bend(s.shape, frac, s.startVal, s.endVal);
    const left = { ...s, endMs: Math.round(t), endVal: midVal };
    const right = { ...s, id: 's' + Date.now(), beginMs: Math.round(t), startVal: midVal, label: 'New' };
    const next = [...secs.slice(0, idx), left, right, ...secs.slice(idx + 1)];
    onChange(next);
    onSelect?.(right.id);
  };

  const removeBoundary = (idx) => {
    // merge section idx-1 and idx (boundary between them disappears)
    if (idx <= 0 || idx >= anchors.length - 1) return;
    const merged = { ...secs[idx - 1], endMs: secs[idx].endMs, endVal: secs[idx].endVal };
    const next = [...secs.slice(0, idx - 1), merged, ...secs.slice(idx + 1)];
    onChange(next);
  };

  // arc path
  const pts = useMemoA(() => sampleArc(secs, duration, Math.max(80, Math.min(300, Math.round(plotW() / 4)))), [secs, duration, w]);
  const pathD = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${xOf(duration).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} Z`;

  const ticks = 6;

  return (
    <div>
      <div
        ref={wrapRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={onDblClick}
        style={{ position: 'relative', width: '100%', height: H, background: 'var(--bg)',
                 border: '1px solid var(--border)', borderRadius: 'var(--r-3)', overflow: 'hidden',
                 userSelect: 'none', touchAction: 'none' }}
      >
        <svg width={w} height={H} style={{ display: 'block', position: 'absolute', inset: 0 }}>
          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={padL} x2={w - padR} y1={yOf(g)} y2={yOf(g)}
                  stroke="var(--border)" strokeWidth={1} strokeDasharray="2 5" opacity={0.6} />
          ))}
          <line x1={padL} x2={w - padR} y1={yOf(1)} y2={yOf(1)} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 5" />

          {/* section tints + labels */}
          {secs.map((s, i) => {
            const c = (window.FF.CHAR_BY_ID[s.characterId] || {}).color || '#ff8c42';
            const x0 = xOf(s.beginMs), x1 = xOf(s.endMs);
            const sel = s.id === selectedId;
            return (
              <g key={s.id} onPointerDown={() => onSelect?.(s.id)} style={{ cursor: 'pointer' }}>
                <rect x={x0} y={padT} width={Math.max(0, x1 - x0)} height={plotH}
                      fill={window.hexA(c, sel ? 0.16 : 0.07)} />
                {sel && <rect x={x0} y={padT} width={Math.max(0, x1 - x0)} height={plotH}
                      fill="none" stroke={c} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8} />}
                <text x={(x0 + x1) / 2} y={padT + 13} textAnchor="middle" fill={c}
                      fontSize={10.5} fontWeight={700} style={{ pointerEvents: 'none' }}>
                  {s.label}
                </text>
              </g>
            );
          })}

          {/* arc */}
          <path d={areaD} fill="rgba(255,140,66,0.12)" />
          <path d={pathD} fill="none" stroke="var(--accent-warm)" strokeWidth={2.5}
                strokeLinejoin="round" strokeLinecap="round" />

          {/* boundary verticals */}
          {anchors.map((a, i) => (
            <line key={'b' + i} x1={xOf(a.tMs)} x2={xOf(a.tMs)} y1={padT} y2={padT + plotH}
                  stroke="var(--border-strong)" strokeWidth={1} opacity={0.7} />
          ))}

          {/* playhead */}
          {playheadMs != null && (
            <line x1={xOf(playheadMs)} x2={xOf(playheadMs)} y1={0} y2={padT + plotH}
                  stroke="#fff" strokeWidth={1.5} opacity={0.85} />
          )}

          {/* time axis */}
          {Array.from({ length: ticks + 1 }, (_, t) => {
            const at = (duration * t) / ticks;
            const x = xOf(at);
            return (
              <text key={'t' + t} x={Math.max(14, Math.min(w - 14, x))} y={H - 9}
                    textAnchor={t === 0 ? 'start' : (t === ticks ? 'end' : 'middle')}
                    fill="var(--text-dim)" fontSize={10} fontFamily="var(--font-mono)">
                {window.FF.fmtTime(at)}
              </text>
            );
          })}
        </svg>

        {/* draggable anchor handles (DOM for crisp hit targets) */}
        {anchors.map((a, i) => {
          const isEnd = i === 0 || i === anchors.length - 1;
          return (
            <div key={'a' + i}
                 onPointerDown={(e) => onPointerDownAnchor(e, i)}
                 title={`${Math.round(a.value * 100)}%  ·  ${window.FF.fmtTime(a.tMs)}`}
                 style={{ position: 'absolute', left: xOf(a.tMs) - 9, top: yOf(a.value) - 9,
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'var(--accent-warm)', border: '2px solid var(--bg)',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
                          cursor: isEnd ? 'ns-resize' : 'move', zIndex: 3 }} />
          );
        })}

        {/* boundary remove buttons (interior only) */}
        {anchors.map((a, i) => {
          if (i === 0 || i === anchors.length - 1) return null;
          return (
            <button key={'x' + i} onClick={() => removeBoundary(i)} title="Remove this boundary (merge sections)"
                    style={{ position: 'absolute', left: xOf(a.tMs) - 8, top: padT + plotH + 4,
                             width: 16, height: 16, borderRadius: 4, border: '1px solid var(--border)',
                             background: 'var(--surface-2)', color: 'var(--text-dim)', cursor: 'pointer',
                             display: 'grid', placeItems: 'center', padding: 0, zIndex: 3 }}>
              <Icon name="x" size={10} />
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6,
                    fontSize: 11, color: 'var(--text-dim)' }}>
        <span>Drag a dot to shape intensity · drag a boundary sideways to move it · double-click to split</span>
        <span className="mono">intensity 0–100%</span>
      </div>
    </div>
  );
}

Object.assign(window, { ArcEditor, sampleArc, bendShape: bend, normalizeSections });
