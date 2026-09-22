// FunscriptForge prototype — visualizations: funscript curve (velocity
// colormap + pan/zoom + playhead), heatmap, waveform, spectrogram, band.
// Loaded as text/babel.

const { useRef: useRefC, useState: useStateC, useEffect: useEffectC, useMemo: useMemoC, useCallback: useCbC } = React;

// velocity (0..1) → perceptual blue→cyan→green→yellow→orange→red
const VEL_STOPS = [
  [0.00, [42, 111, 219]],
  [0.25, [34, 211, 238]],
  [0.50, [62, 213, 152]],
  [0.70, [255, 225, 77]],
  [0.85, [255, 140, 66]],
  [1.00, [255, 75, 75]],
];
function velColor(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < VEL_STOPS.length; i += 1) {
    if (v <= VEL_STOPS[i][0]) {
      const [t0, c0] = VEL_STOPS[i - 1];
      const [t1, c1] = VEL_STOPS[i];
      const f = (v - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(255,75,75)';
}

function fitCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ── FunscriptChart ────────────────────────────────────────────────────────
function FunscriptChart({
  actions, totalMs, height = 240, sections = null, playheadMs = null,
  view: controlledView, onViewChange, onSeek, bare = false, monochrome = false,
}) {
  const wrapRef = useRefC(null);
  const canvasRef = useRefC(null);
  const [w, setW] = useStateC(800);
  const [internalView, setInternalView] = useStateC({ start: 0, end: totalMs });
  const isControlled = controlledView != null && typeof onViewChange === 'function';
  const view = isControlled ? controlledView : internalView;
  const setView = isControlled ? onViewChange : setInternalView;
  const dragRef = useRefC(null);
  const movedRef = useRefC(false);

  useEffectC(() => { if (!isControlled) setInternalView({ start: 0, end: totalMs }); }, [totalMs]);

  useEffectC(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxVel = useMemoC(() => {
    if (!actions || actions.length < 2) return 1;
    let m = 0;
    for (let i = 1; i < actions.length; i += 1) {
      const dt = Math.max(1, actions[i].at - actions[i - 1].at);
      const v = Math.abs(actions[i].pos - actions[i - 1].pos) / dt;
      if (v > m) m = v;
    }
    return m || 1;
  }, [actions]);

  useEffectC(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const axisH = bare ? 0 : 20;
    const chartH = height - axisH;
    const ctx = fitCanvas(canvas, w, height);
    ctx.clearRect(0, 0, w, height);
    const span = view.end - view.start || 1;
    const xOf = (at) => ((at - view.start) / span) * w;
    const yOf = (pos) => 8 + (1 - pos / 100) * (chartH - 16);

    // section band tints
    if (sections) {
      sections.forEach((s) => {
        const c = (window.FF.CHAR_BY_ID[s.characterId] || {}).color || 'var(--accent)';
        const x0 = xOf(s.beginMs); const x1 = xOf(s.endMs);
        ctx.fillStyle = hexA(c, 0.07);
        ctx.fillRect(x0, 0, x1 - x0, chartH);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, chartH); ctx.stroke();
      });
    }

    if (!actions || actions.length === 0) return;
    // visible slice (+1 each side)
    let i0 = 0; while (i0 < actions.length && actions[i0].at < view.start) i0 += 1;
    let i1 = actions.length - 1; while (i1 > 0 && actions[i1].at > view.end) i1 -= 1;
    i0 = Math.max(0, i0 - 1); i1 = Math.min(actions.length - 1, i1 + 1);

    // fill under curve
    ctx.beginPath();
    ctx.moveTo(xOf(actions[i0].at), chartH);
    for (let i = i0; i <= i1; i += 1) ctx.lineTo(xOf(actions[i].at), yOf(actions[i].pos));
    ctx.lineTo(xOf(actions[i1].at), chartH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fill();

    // colored line segments
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let i = i0 + 1; i <= i1; i += 1) {
      const a = actions[i - 1], b = actions[i];
      const dt = Math.max(1, b.at - a.at);
      const v = Math.abs(b.pos - a.pos) / dt / maxVel;
      ctx.strokeStyle = monochrome ? 'rgba(155,163,196,0.65)' : velColor(v);
      ctx.beginPath();
      ctx.moveTo(xOf(a.at), yOf(a.pos));
      ctx.lineTo(xOf(b.at), yOf(b.pos));
      ctx.stroke();
    }

    // playhead
    if (playheadMs != null && playheadMs >= view.start && playheadMs <= view.end) {
      const x = xOf(playheadMs);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, 5, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // axis
    if (!bare) {
      ctx.fillStyle = 'rgba(14,17,23,0.85)';
      ctx.fillRect(0, chartH, w, axisH);
      ctx.fillStyle = '#6b7390'; ctx.font = '10px ' + 'JetBrains Mono, monospace';
      const ticks = 6;
      for (let t = 0; t <= ticks; t += 1) {
        const at = view.start + (span * t) / ticks;
        const x = (t / ticks) * w;
        ctx.textAlign = t === 0 ? 'left' : (t === ticks ? 'right' : 'center');
        ctx.fillText(window.FF.fmtTime(at), Math.max(2, Math.min(w - 2, x)), height - 6);
      }
    }
  }, [actions, w, height, view.start, view.end, maxVel, sections, playheadMs, bare, monochrome]);

  // interactions
  const onDown = (e) => {
    dragRef.current = { x: e.clientX, view: { ...view } };
    movedRef.current = false;
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    if (Math.abs(dx) > 3) movedRef.current = true;
    const span = dragRef.current.view.end - dragRef.current.view.start;
    const dms = (dx / w) * span;
    let start = dragRef.current.view.start - dms;
    let end = dragRef.current.view.end - dms;
    if (start < 0) { end -= start; start = 0; }
    if (end > totalMs) { start -= end - totalMs; end = totalMs; }
    if (start < 0) start = 0;
    setView({ start, end });
  };
  const onUp = (e) => {
    const wasDrag = movedRef.current;
    dragRef.current = null;
    if (!wasDrag && onSeek) {
      const rect = wrapRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const span = view.end - view.start;
      onSeek(view.start + (x / w) * span);
    }
  };
  useEffectC(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const span = view.end - view.start;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = view.start + (x / w) * span;
      const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      let ns = Math.max(2000, Math.min(totalMs, span * factor));
      const lf = (t - view.start) / span;
      let start = t - lf * ns; let end = start + ns;
      if (start < 0) { end -= start; start = 0; }
      if (end > totalMs) { start -= end - totalMs; end = totalMs; }
      if (start < 0) start = 0;
      setView({ start, end });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view.start, view.end, w, totalMs]);

  return (
    <div
      ref={wrapRef}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => { dragRef.current = null; }}
      style={{ position: 'relative', width: '100%', height, background: 'var(--bg)',
               border: '1px solid var(--border)', borderRadius: 'var(--r-2)',
               cursor: dragRef.current ? 'grabbing' : (onSeek ? 'pointer' : 'grab'),
               userSelect: 'none', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(255,140,66,${a})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Energy heatmap strip ──────────────────────────────────────────────────
function Heatmap({ energy, height = 26, label }) {
  const wrapRef = useRefC(null); const cv = useRefC(null); const [w, setW] = useStateC(800);
  useEffectC(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffectC(() => {
    const ctx = fitCanvas(cv.current, w, height);
    const n = energy.length; const bw = w / n;
    for (let i = 0; i < n; i += 1) {
      ctx.fillStyle = velColor(energy[i]);
      ctx.globalAlpha = 0.35 + energy[i] * 0.65;
      ctx.fillRect(i * bw, 0, bw + 1, height);
    }
    ctx.globalAlpha = 1;
  }, [energy, w, height]);
  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', height, borderRadius: 'var(--r-1)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      <canvas ref={cv} style={{ display: 'block' }} />
      {label && <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>{label}</span>}
    </div>
  );
}

// ── Waveform (synthetic peaks from energy) ────────────────────────────────
function Waveform({ energy, height = 64, color = '#4dabf7' }) {
  const wrapRef = useRefC(null); const cv = useRefC(null); const [w, setW] = useStateC(800);
  useEffectC(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffectC(() => {
    const ctx = fitCanvas(cv.current, w, height);
    ctx.clearRect(0, 0, w, height);
    const n = Math.min(w, 600); const bw = w / n; const mid = height / 2;
    for (let i = 0; i < n; i += 1) {
      const t = i / (n - 1);
      const e = energy[Math.floor(t * (energy.length - 1))];
      const noise = 0.4 + 0.6 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
      const amp = (0.18 + e * 0.82) * noise * (height / 2 - 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.5 + e * 0.5;
      ctx.fillRect(i * bw, mid - amp, Math.max(1, bw * 0.7), amp * 2);
    }
    ctx.globalAlpha = 1;
  }, [energy, w, height, color]);
  return (
    <div ref={wrapRef} style={{ width: '100%', height, background: 'var(--surface-2)', borderRadius: 'var(--r-2)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      <canvas ref={cv} style={{ display: 'block' }} />
    </div>
  );
}

// ── Spectrogram (faux mel) ────────────────────────────────────────────────
function Spectrogram({ energy, height = 72 }) {
  const wrapRef = useRefC(null); const cv = useRefC(null); const [w, setW] = useStateC(800);
  useEffectC(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffectC(() => {
    const ctx = fitCanvas(cv.current, w, height);
    const cols = Math.min(w, 400); const rows = 40; const bw = w / cols; const bh = height / rows;
    for (let c = 0; c < cols; c += 1) {
      const t = c / (cols - 1);
      const e = energy[Math.floor(t * (energy.length - 1))];
      for (let r = 0; r < rows; r += 1) {
        const freq = 1 - r / rows; // top = high freq
        const band = Math.exp(-Math.pow((freq - (0.2 + e * 0.5)) / 0.28, 2));
        const n = Math.abs(Math.sin((c * 7.1 + r * 3.3)) * 9301 % 1);
        const mag = Math.max(0, Math.min(1, band * (0.5 + e) * (0.6 + 0.6 * n)));
        ctx.fillStyle = velColor(mag); ctx.globalAlpha = 0.15 + mag * 0.85;
        ctx.fillRect(c * bw, r * bh, bw + 1, bh + 1);
      }
    }
    ctx.globalAlpha = 1;
  }, [energy, w, height]);
  return (
    <div ref={wrapRef} style={{ width: '100%', height, background: '#070910', borderRadius: 'var(--r-2)', overflow: 'hidden', border: '1px solid var(--border)' }}>
      <canvas ref={cv} style={{ display: 'block' }} />
    </div>
  );
}

// ── Video thumbnail strip (placeholder frames) ────────────────────────────
function ThumbStrip({ count = 8, height = 64 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 3, height }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{
          backgroundColor: 'var(--surface-2)',
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0 6px, transparent 6px 12px)',
          border: '1px solid var(--border)', borderRadius: 4,
          display: 'grid', placeItems: 'center', color: 'var(--text-dim)', fontSize: 9,
          fontFamily: 'var(--font-mono)',
        }}>{window.FF.fmtTime((i / count) * window.FF.DURATION_MS)}</div>
      ))}
    </div>
  );
}

Object.assign(window, { FunscriptChart, Heatmap, Waveform, Spectrogram, ThumbStrip, velColor, hexA, fitCanvas });
