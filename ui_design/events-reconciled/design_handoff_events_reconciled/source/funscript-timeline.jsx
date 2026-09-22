// Events tab (reconciled) — full-width Funscript timeline + IO bar.
// Shows every event across all four acts as colored bands (by category),
// the funscript-position line, an act-lane row (click to scope), and a color
// band underneath. Mirrors the screenshot the user liked (image 5/6).

const { useState: ftState, useEffect: ftEffect, useRef: ftRef, useMemo: ftMemo } = React;

function RxFunTimeline({ events, currentMs, scopeId, selectedId, onScope, onSeek, onSelect }) {
  const ref = ftRef(null);
  const [w, setW] = ftState(1200);
  ftEffect(() => {
    const u = () => ref.current && setW(ref.current.clientWidth);
    u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u);
  }, []);

  const total = window.RX_PROJECT.duration_ms;
  const msToX = ms => (ms / total) * w;
  const H = 150;

  // funscript position line (deterministic).
  const linePts = ftMemo(() => {
    let s = 21; const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const N = Math.floor(w / 3), pts = [];
    for (let i = 0; i < N; i++) {
      const env = 0.5 + 0.42 * Math.sin((i / N) * Math.PI * 9) + (rand() - 0.5) * 0.18;
      pts.push([(i / N) * w, 18 + (1 - Math.max(0, Math.min(1, env))) * (H - 60)]);
    }
    return pts;
  }, [w]);

  const { events: laneEvents, lanes } = ftMemo(() => {
    const sorted = [...events].sort((a, b) => a.begin_ms - b.begin_ms);
    const ends = [];
    const out = sorted.map(ev => {
      let li = ends.findIndex(e => e <= ev.begin_ms);
      if (li === -1) { ends.push(ev.end_ms); li = ends.length - 1; } else ends[li] = ev.end_ms;
      return { ...ev, lane: li };
    });
    return { events: out, lanes: Math.max(1, ends.length) };
  }, [events.map(e => e.id + e.begin_ms).join()]);

  const laneH = Math.min(16, (H - 64) / lanes);

  return (
    <div className="rx-panel rx-fun">
      <div className="rx-fun__head">
        <span className="rx-fun__title">Funscript timeline</span>
        <span className="rx-fun__hint">whole script · all events overlaid · click to seek · click a band to select</span>
        <span className="rx-fun__meta">{window.RX_PROJECT.actions.toLocaleString()} actions · {events.length} events</span>
      </div>

      <div className="rx-fun__canvas" ref={ref} style={{ height: H }}
           onClick={(e) => { const r = ref.current.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * total); }}>
        <svg width="100%" height={H} style={{ display: "block" }}>
          {/* act region tints (read-only orientation — scoped act a touch brighter) */}
          {window.RX_CHAPTERS.map(c => {
            const x = msToX(c.start), cw = msToX(c.end) - x;
            return <rect key={c.id} x={x} y={0} width={cw} height={H} fill={c.color + (c.id === scopeId ? "1c" : "0c")} />;
          })}
          {window.RX_CHAPTERS.slice(1).map(c => <line key={c.id} x1={msToX(c.start)} x2={msToX(c.start)} y1={0} y2={H} stroke="#0e1117" strokeWidth="2" />)}

          {/* act labels (non-interactive) */}
          {window.RX_CHAPTERS.map(c => (
            <text key={c.id} x={msToX(c.start) + 6} y={14} fontSize="10" fontWeight="700"
                  fill={c.color} opacity={c.id === scopeId ? 1 : 0.7} style={{ pointerEvents: "none", letterSpacing: "0.04em" }}>
              {c.short} <tspan fill="#6b7390" fontWeight="400">{events.filter(e => e.chapter === c.id).length}</tspan>
            </text>
          ))}

          {/* funscript position line — the whole script */}
          <path d={"M " + linePts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ")} fill="none" stroke="#fafafa" strokeWidth="1.2" opacity="0.7" pointerEvents="none" />

          {/* every event overlaid as a colored band */}
          {laneEvents.map(ev => {
            const x1 = msToX(ev.begin_ms), bw = Math.max(2, msToX(ev.end_ms) - x1);
            const r = window.RX_recipeById(ev.recipe), cat = window.RX_catById(r?.cat);
            const sel = ev.id === selectedId, base = r?.isBaseline;
            const yy = 22 + ev.lane * laneH;
            return <rect key={ev.id} x={x1} y={yy} width={bw} height={Math.max(4, laneH - 2)} rx={2}
                         fill={base ? "transparent" : cat?.accent} fillOpacity={base ? 0 : (sel ? 0.9 : 0.5)}
                         stroke={sel ? "#fafafa" : cat?.accent} strokeWidth={sel ? 1.5 : 0.5} strokeDasharray={base ? "3 2" : ""}
                         style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelect(ev.id); }} />;
          })}

          {/* playhead */}
          <line x1={msToX(currentMs)} x2={msToX(currentMs)} y1={0} y2={H} stroke="#ff4b4b" strokeWidth="2" pointerEvents="none" />
          <polygon points={`${msToX(currentMs)-5},0 ${msToX(currentMs)+5},0 ${msToX(currentMs)},7`} fill="#ff4b4b" pointerEvents="none" />
        </svg>
      </div>

      {/* legend */}
      <div className="rx-fun__legend">
        {Object.values(window.RX_CATS).map(c => (
          <span key={c.id} className="rx-fun__leg"><span className="rx-fun__legdot" style={{ background: c.accent }} />{c.label}</span>
        ))}
        <span className="rx-fun__legpos"><span className="rx-fun__legline" /> funscript position</span>
      </div>
    </div>
  );
}

// ─── IO bar ─────────────────────────────────────────────────────────
function RxIOBar({ events, scopeId }) {
  const scope = window.RX_chapterById(scopeId);
  return (
    <div className="rx-io">
      <button className="rx-io__btn">📦 Starter packs</button>
      <button className="rx-io__btn rx-io__btn--ghost">⤴ Load YAML…</button>
      <button className="rx-io__btn rx-io__btn--ghost">⟨/⟩ Preview events.yml</button>
      <div className="rx-io__spacer" />
      <span className="rx-io__meta"><b>{events.length}</b> events · scope: <b>{scope ? scope.label : "All chapters"}</b></span>
    </div>
  );
}

Object.assign(window, { RxFunTimeline, RxIOBar });
