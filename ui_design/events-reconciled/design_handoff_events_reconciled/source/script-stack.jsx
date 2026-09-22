// Events tab (reconciled) — Chapter-aware script chart (ROW A, hero).
// Mirrors image 1: a tall stanza spectrum (S-labelled columns over a colorful
// energy spectrum, 0–100 axis) as the hero, plus optional stacked tracks
// (funscript / audio / spectro / thumbs) and an event-lane band for capture
// context. Scoped to the selected chapter. Click a stanza to focus; click to
// seek; the capture ghost bracket draws here.

const { useState: cState, useEffect: cEffect, useRef: cRef, useMemo: cMemo } = React;

function rxNoise(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function rxPack(events) {
  const sorted = [...events].sort((a, b) => a.begin_ms - b.begin_ms);
  const ends = [];
  const out = sorted.map(ev => {
    let li = ends.findIndex(e => e <= ev.begin_ms);
    if (li === -1) { ends.push(ev.end_ms); li = ends.length - 1; } else ends[li] = ev.end_ms;
    return { ...ev, lane: li };
  });
  return { events: out, lanes: Math.max(1, ends.length) };
}

function RxScriptStack({ scope, events, currentMs, beginMs, endMs, selectedId, tracks, onTracks, onSeek, onSelect, selStanza, onSelStanza }) {
  const ref = cRef(null);
  const [w, setW] = cState(900);
  cEffect(() => {
    const u = () => ref.current && setW(ref.current.clientWidth);
    u(); window.addEventListener("resize", u); return () => window.removeEventListener("resize", u);
  }, []);

  const start = scope.start, end = scope.end, range = end - start;
  const AXIS = 30;                       // left gutter for 0/50/100 axis
  const plotW = Math.max(10, w - AXIS);
  const msToX = ms => AXIS + ((ms - start) / range) * plotW;
  const xToMs = x => start + ((x - AXIS) / plotW) * range;

  const stanzas = window.RX_STANZAS.filter(s => s.chapter === scope.id);
  const chEvents = events.filter(e => e.end_ms > start && e.begin_ms < end);
  const { events: laneEvents, lanes } = cMemo(() => rxPack(chEvents), [chEvents.map(e => e.id + e.begin_ms).join()]);

  // Geometry (top → bottom)
  const LBL = 20, SPEC = 134, EVH = 18, EVGAP = 3;
  const evBandH = lanes * (EVH + EVGAP) + 4;
  const TRACK_DEFS = [
    { id: "funscript", label: "Funscript", h: 30 },
    { id: "audio",     label: "Audio",     h: 24 },
    { id: "spectro",   label: "Spectro",   h: 24 },
    { id: "thumbs",    label: "Thumbs",    h: 28 },
  ];
  const activeTracks = TRACK_DEFS.filter(t => tracks[t.id]);
  const specTop = LBL, specBot = LBL + SPEC;
  let y = specBot + 6;
  const evY = y; y += evBandH + 4;
  const trackYs = activeTracks.map(t => { const ty = y; y += t.h + 3; return { ...t, y: ty }; });
  const RULER = 16, rulerY = y, H = rulerY + RULER;

  const onCanvasClick = (e) => {
    if (e.target.dataset.stanza) return;
    const rect = ref.current.getBoundingClientRect();
    onSeek(xToMs(e.clientX - rect.left));
  };

  return (
    <div className="rx-panel rx-script">
      <div className="rx-script__head">
        <span className="rx-script__title">CHAPTER-AWARE SCRIPT</span>
        <span className="rx-script__hint">click to seek · click a stanza to focus</span>
        <span className="rx-script__tracks">
          {TRACK_DEFS.map(t => (
            <button key={t.id} className={"rx-track-toggle" + (tracks[t.id] ? " rx-track-toggle--on" : "")}
                    onClick={() => onTracks({ ...tracks, [t.id]: !tracks[t.id] })}>{t.label}</button>
          ))}
        </span>
      </div>

      <div className="rx-script__canvas" ref={ref} style={{ height: H }} onClick={onCanvasClick}>
        <svg width="100%" height={H} style={{ display: "block" }}>
          {/* y-axis 0 / 50 / 100 */}
          {[0, 50, 100].map(v => {
            const yy = specBot - (v / 100) * SPEC;
            return (
              <g key={v}>
                <line x1={AXIS} x2={w} y1={yy} y2={yy} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <text x={AXIS - 6} y={yy + 3} fontSize="9" fill="#6b7390" textAnchor="end" style={{ fontFamily: "var(--font-mono)" }}>{v}</text>
              </g>
            );
          })}

          {/* stanza spectrum — per-stanza cluster of colored bars */}
          {stanzas.map(s => {
            const x0 = msToX(s.start), x1 = msToX(s.end), sw = x1 - x0;
            const sel = s.id === selStanza;
            const nb = Math.max(2, Math.floor(sw / 4));
            const bw = sw / nb;
            const rand = rxNoise(Math.floor(s.start) + s.idx * 7);
            const bars = [];
            for (let i = 0; i < nb; i++) {
              const local = 0.55 + 0.45 * Math.sin((i / nb) * Math.PI);  // arch within stanza
              const e = Math.max(0.05, Math.min(1, s.energy * local * (0.6 + rand() * 0.7)));
              const bh = e * SPEC;
              bars.push(<rect key={i} x={x0 + i * bw + 0.3} y={specBot - bh} width={Math.max(0.6, bw - 0.6)} height={bh}
                              fill={s.quiet ? "#3a4a64" : window.rxEnergyColor(e)} opacity={s.quiet ? 0.5 : 0.92} />);
            }
            return (
              <g key={s.id}>
                {/* selection highlight box */}
                {sel && <rect x={x0} y={specTop} width={sw} height={SPEC} fill="rgba(255,255,255,0.05)" stroke="#fafafa" strokeWidth="1.5" />}
                {bars}
                {/* clickable column */}
                <rect x={x0} y={specTop} width={sw} height={SPEC} fill="transparent" data-stanza={s.id}
                      style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelStanza(sel ? null : s.id); }} />
              </g>
            );
          })}

          {/* stanza label chips */}
          {stanzas.map((s, i) => {
            const x0 = msToX(s.start), sw = msToX(s.end) - x0;
            if (sw < 16 && i % 2) return null;
            const sel = s.id === selStanza;
            return (
              <g key={s.id + "l"} data-stanza={s.id} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelStanza(sel ? null : s.id); }}>
                <rect x={x0 + 1.5} y={2} width={Math.max(14, Math.min(sw - 3, 26))} height={15} rx={3}
                      fill={sel ? "#fafafa" : "rgba(20,24,32,0.7)"} stroke={sel ? "#fafafa" : "rgba(255,255,255,0.12)"} strokeWidth="1" />
                <text x={x0 + 5} y={13} fontSize="9" fontWeight={700} fill={sel ? "#12151e" : "#9ba3c4"} style={{ fontFamily: "var(--font-mono)", pointerEvents: "none" }}>S{s.idx}</text>
              </g>
            );
          })}

          {/* event-lane band (capture context) */}
          {laneEvents.map(ev => {
            const x1 = msToX(ev.begin_ms), x2 = msToX(ev.end_ms), bw = Math.max(2, x2 - x1);
            const yy = evY + ev.lane * (EVH + EVGAP);
            const r = window.RX_recipeById(ev.recipe), cat = window.RX_catById(r?.cat);
            const accent = cat?.accent || "#9ba3c4", sel = ev.id === selectedId, base = r?.isBaseline;
            return (
              <g key={ev.id} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelect(ev.id); }}>
                <rect x={x1} y={yy} width={bw} height={EVH} rx={3}
                      fill={base ? "transparent" : accent} fillOpacity={base ? 0 : (sel ? 0.6 : 0.32)}
                      stroke={accent} strokeWidth={sel ? 2 : 1} strokeDasharray={base ? "4 3" : ""} />
                {bw > 30 && <text x={x1 + 5} y={yy + 13} fontSize="10" fontWeight={sel ? 700 : 500}
                                  fill={base ? "#9ba3c4" : "#fafafa"} style={{ pointerEvents: "none" }}>{r?.label}</text>}
              </g>
            );
          })}

          {/* stacked tracks */}
          {trackYs.map(t => (
            <g key={t.id}>
              <rect x={AXIS} y={t.y} width={plotW} height={t.h} fill="rgba(0,0,0,0.18)" />
              <text x={AXIS + 4} y={t.y + 9} fontSize="8" fill="#6b7390" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{t.label.toUpperCase()}{t.id === "funscript" ? " · muted" : ""}</text>
              <RxTrackArt kind={t.id} x={AXIS} w={plotW} y={t.y} h={t.h} seed={scope.start} />
            </g>
          ))}

          {/* capture ghost bracket */}
          {beginMs != null && beginMs >= start && beginMs <= end && (
            <g pointerEvents="none">
              <line x1={msToX(beginMs)} x2={msToX(beginMs)} y1={specTop} y2={rulerY} stroke="#ff8c42" strokeWidth="2" strokeDasharray="3 3" />
              <text x={msToX(beginMs) + 4} y={specTop + 11} fontSize="9" fontWeight={700} fill="#ff8c42">BEGIN</text>
              {endMs != null && (
                <>
                  <rect x={msToX(beginMs)} y={evY} width={Math.max(2, msToX(endMs) - msToX(beginMs))} height={Math.max(evBandH - 4, 10)} rx={3}
                        fill="#ff8c42" fillOpacity="0.14" stroke="#ff8c42" strokeWidth="1.5" strokeDasharray="4 3" />
                  <line x1={msToX(endMs)} x2={msToX(endMs)} y1={specTop} y2={rulerY} stroke="#ff8c42" strokeWidth="2" strokeDasharray="3 3" />
                  <text x={msToX(endMs) - 22} y={specTop + 11} fontSize="9" fontWeight={700} fill="#ff8c42">END</text>
                </>
              )}
            </g>
          )}

          {/* playhead */}
          {currentMs >= start && currentMs <= end && (
            <g pointerEvents="none">
              <line x1={msToX(currentMs)} x2={msToX(currentMs)} y1={specTop - 2} y2={H} stroke="#ff4b4b" strokeWidth="2" />
              <polygon points={`${msToX(currentMs)-5},${specTop-2} ${msToX(currentMs)+5},${specTop-2} ${msToX(currentMs)},${specTop+5}`} fill="#ff4b4b" />
            </g>
          )}

          {/* ruler */}
          <g transform={`translate(0,${rulerY})`}>
            <rect x={AXIS} y={0} width={plotW} height={RULER} fill="#0e1117" />
            {(() => {
              const out = [], step = range > 120000 ? 30000 : (range > 60000 ? 15000 : 10000);
              for (let t = Math.ceil(start / step) * step; t <= end; t += step) {
                const x = msToX(t);
                out.push(<g key={t} transform={`translate(${x},0)`}>
                  <line x1={0} x2={0} y1={0} y2={4} stroke="#3a3f5c" />
                  <text x={3} y={12} fontSize="9" fill="#9ba3c4" style={{ fontFamily: "var(--font-mono)" }}>{window.RX_fmtTime(t)}</text>
                </g>);
              }
              return out;
            })()}
          </g>
        </svg>
      </div>
    </div>
  );
}

function RxTrackArt({ kind, x, w, y, h, seed }) {
  const rand = rxNoise(seed + kind.length * 31);
  if (kind === "funscript") {
    const N = Math.floor(w / 5), pts = [];
    for (let i = 0; i < N; i++) {
      const env = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 6);
      const yy = y + h / 2 + (env + (rand() - 0.5) * 0.3) * (h / 2 - 3) * (i % 2 ? 1 : -1);
      pts.push([x + (i / N) * w, yy]);
    }
    const grad = ["#1f3a8a","#2563eb","#06b6d4","#22c55e","#eab308","#f97316","#ef4444"];
    return <g pointerEvents="none">{pts.map((p, i) => {
      if (i === 0) return null;
      const v = Math.abs(p[1] - pts[i-1][1]) / (h / 2);
      return <circle key={i} cx={p[0]} cy={p[1]} r="1.2" fill={grad[Math.min(6, Math.floor(v * 7))]} opacity="0.65" />;
    })}</g>;
  }
  if (kind === "audio") {
    const N = Math.floor(w / 3), bars = [];
    for (let i = 0; i < N; i++) {
      const env = 0.3 + 0.7 * Math.abs(Math.sin((i / N) * Math.PI * 4));
      const bh = env * (h - 6) * (0.4 + rand() * 0.6);
      bars.push(<rect key={i} x={x + (i / N) * w} y={y + (h - bh) / 2} width={1.3} height={bh} fill="#ff8c42" opacity="0.5" />);
    }
    return <g pointerEvents="none">{bars}</g>;
  }
  if (kind === "spectro") {
    const cols = Math.floor(w / 4), rows = 5, cw = w / cols, ch = h / rows, cells = [];
    const cs = ["#0a1430","#1b3a6b","#2563eb","#06b6d4","#eab308","#f97316"];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const inten = Math.min(1, (1 - r / rows) * 0.6 + rand() * 0.55);
      cells.push(<rect key={c+"-"+r} x={x + c*cw} y={y + r*ch} width={cw} height={ch} fill={cs[Math.min(5, Math.floor(inten*6))]} opacity={inten*0.55} />);
    }
    return <g pointerEvents="none">{cells}</g>;
  }
  if (kind === "thumbs") {
    const n = Math.max(3, Math.floor(w / 70)), tw = w / n, pals = [["#1a2235","#3b4a6e"],["#1f2031","#5b3954"],["#1b2c2e","#3c6a72"],["#2a1f1a","#7a4a32"],["#221a26","#5e3a6e"],["#1a2630","#3a6080"]];
    return <g pointerEvents="none">{Array.from({ length: n }).map((_, i) => {
      const p = pals[i % pals.length];
      return <g key={i}>
        <rect x={x + i*tw+1} y={y+1} width={tw-2} height={h-2} fill={p[0]} />
        <circle cx={x + i*tw+tw*0.45} cy={y+h*0.5} r={h*0.22} fill={p[1]} opacity="0.6" />
      </g>;
    })}</g>;
  }
  return null;
}

Object.assign(window, { RxScriptStack });
