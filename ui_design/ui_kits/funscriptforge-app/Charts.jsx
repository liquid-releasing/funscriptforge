// Shared visualisation primitives used across every tab.
// All components are pure SVG so they stay crisp at any zoom.
// Public components: ScriptChart, PhraseChart, PreviewChart,
// PhraseRibbon, BehaviorTagBar, ScopePlayer, MiniWave.

const { useState: chState, useRef: chRef, useEffect: chEffect, useMemo: chMemo } = React;

// Map a phrase's behavioral tag to a color. Missing tag = neutral grey.
function tagColor(tagId) {
  if (!tagId) return "#3ed598"; // well-formed = success-green
  const t = (window.FF_TAGS || []).find(x => x.id === tagId);
  return t ? t.color : "var(--text-muted)";
}
function tagLabel(tagId) {
  if (!tagId) return "well-formed";
  const t = (window.FF_TAGS || []).find(x => x.id === tagId);
  return t ? t.label : tagId;
}

// ─── PhraseRibbon ─────────────────────────────────────────────────
// Horizontal strip of phrase bands across the whole script. Used in the
// Phrases tab (selector view). Each band's color = its behavioral tag.
function PhraseRibbon({ phrases, totalMs, height = 26, selectedId, onSelect, currentMs }) {
  const wrapRef = chRef();
  const [width, setWidth] = chState(800);
  chEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const xFor = (ms) => (ms / totalMs) * width;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height }}>
      <svg width={width} height={height}>
        {phrases.map(ph => {
          const x = xFor(ph.start);
          const w = Math.max(2, xFor(ph.end) - x - 1);
          const color = tagColor(ph.tag);
          const sel = ph.id === selectedId;
          return (
            <g key={ph.id}>
              <rect x={x} y={0} width={w} height={height - 4} rx={2}
                    fill={color}
                    fillOpacity={sel ? 0.95 : ph.tag ? 0.7 : 0.45}
                    stroke={sel ? "#fff" : "transparent"} strokeWidth={1}
                    onClick={() => onSelect?.(ph.id)}
                    style={{ cursor: "pointer" }} />
              {ph.tag && w > 36 && (
                <text x={x + 4} y={height - 9} fontSize={9}
                      fill="#0e1117" fontWeight={700}
                      style={{ pointerEvents: "none" }}
                      clipPath={`inset(0 ${Math.max(0, width - x - w + 4)}px 0 ${x + 2}px)`}>
                  {tagLabel(ph.tag)}
                </text>
              )}
            </g>
          );
        })}
        {currentMs != null && (
          <line x1={xFor(currentMs)} x2={xFor(currentMs)} y1={0} y2={height - 4}
                stroke="#fff" strokeWidth={1} />
        )}
      </svg>
    </div>
  );
}

// ─── BehaviorTagBar ──────────────────────────────────────────────
// Stacked horizontal bar showing the % of script duration spent in each
// behavioral tag. Used on the Project tab and the Patterns tab.
function BehaviorTagBar({ phrases, totalMs, height = 14 }) {
  const buckets = chMemo(() => {
    const acc = {};
    for (const p of phrases) {
      const dur = p.end - p.start;
      const k = p.tag || "_clean";
      acc[k] = (acc[k] || 0) + dur;
    }
    const order = ["_clean", ...(window.FF_TAGS || []).map(t => t.id)];
    return order.filter(k => acc[k]).map(k => ({
      id: k,
      label: k === "_clean" ? "well-formed" : tagLabel(k),
      color: k === "_clean" ? "#3ed598" : tagColor(k),
      pct: (acc[k] / totalMs) * 100,
    }));
  }, [phrases, totalMs]);
  return (
    <div style={{ display: "flex", height, borderRadius: 4, overflow: "hidden",
                  background: "var(--surface-2)" }}>
      {buckets.map(b => (
        <div key={b.id} title={`${b.label} · ${b.pct.toFixed(1)}%`}
             style={{ width: `${b.pct}%`, background: b.color }} />
      ))}
    </div>
  );
}

// ─── ScriptChart ─────────────────────────────────────────────────
// Funscript curve over a window. Phrases drawn as faint colored bands.
function ScriptChart({
  actions, phrases = [], totalMs,
  startMs = 0, endMs,
  currentMs, onSeek,
  height = 180, showPhraseTags = true, selectedPhraseId, onSelectPhrase,
  showActions = "auto", // 'auto' | 'always' | 'never'
}) {
  const wrapRef = chRef();
  const [width, setWidth] = chState(900);
  chEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const vpStart = startMs;
  const vpEnd = endMs ?? totalMs;
  const vpDur = vpEnd - vpStart;
  const padTop = showPhraseTags ? 22 : 6;
  const padBottom = 18;
  const plotH = height - padTop - padBottom;

  const xFor = (ms) => ((ms - vpStart) / vpDur) * width;
  const yFor = (pos) => padTop + (1 - pos / 100) * plotH;
  const msFromX = (x) => vpStart + (x / width) * vpDur;

  const visible = chMemo(() => {
    const out = [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.at < vpStart - 50) {
        if (i + 1 < actions.length && actions[i + 1].at >= vpStart - 50) out.push(a);
        continue;
      }
      if (a.at > vpEnd + 50) { out.push(a); break; }
      out.push(a);
    }
    return out;
  }, [actions, vpStart, vpEnd]);

  const pathD = visible.length === 0 ? "" : visible.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${xFor(p.at).toFixed(1)} ${yFor(p.pos).toFixed(1)}`
  ).join(" ");
  const fillD = visible.length === 0 ? "" :
    `${pathD} L ${xFor(visible[visible.length-1].at).toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${xFor(visible[0].at).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  // Time ticks
  const ticks = chMemo(() => {
    const niceSteps = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    const step = niceSteps.find(s => vpDur / s < 12) ?? 600000;
    const first = Math.ceil(vpStart / step) * step;
    const out = [];
    for (let t = first; t <= vpEnd; t += step) out.push(t);
    return out;
  }, [vpStart, vpEnd]);

  const drawPts = showActions === "always"
    ? true
    : showActions === "never" ? false : vpDur < 60000 && visible.length < 200;

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek?.(msFromX(e.clientX - rect.left));
  };

  return (
    <div ref={wrapRef} style={{ width: "100%", height,
                                background: "var(--bg)",
                                border: "1px solid var(--border)",
                                borderRadius: 6, overflow: "hidden" }}>
      <svg width={width} height={height} onClick={handleClick}
           style={{ cursor: onSeek ? "pointer" : "default", display: "block" }}>
        <defs>
          <linearGradient id="ffFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff4b4b" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#ff4b4b" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* horizontal grid */}
        {[0, 25, 50, 75, 100].map(p => (
          <line key={p} x1={0} x2={width} y1={yFor(p)} y2={yFor(p)}
                stroke="var(--border)"
                strokeOpacity={p === 50 ? 0.6 : 0.25}
                strokeDasharray={p === 50 ? "" : "2 4"} />
        ))}

        {/* phrase tag bands */}
        {showPhraseTags && phrases.map(ph => {
          if (ph.end < vpStart || ph.start > vpEnd) return null;
          const x = Math.max(0, xFor(ph.start));
          const w = Math.min(width, xFor(ph.end)) - x;
          const sel = ph.id === selectedPhraseId;
          const color = tagColor(ph.tag);
          return (
            <g key={ph.id} onClick={(e) => { e.stopPropagation(); onSelectPhrase?.(ph.id); }}
               style={{ cursor: "pointer" }}>
              <rect x={x} y={0} width={Math.max(2, w - 1)} height={padTop - 4}
                    fill={color}
                    fillOpacity={sel ? 0.85 : ph.tag ? 0.55 : 0.30}
                    stroke={sel ? "#fff" : "transparent"} strokeWidth={1}
                    rx={2} />
              {ph.tag && w > 32 && (
                <text x={x + 4} y={padTop - 8} fontSize={9} fontWeight={700}
                      fill="#0e1117" style={{ pointerEvents: "none" }}
                      clipPath={`inset(0 ${Math.max(0, width - x - w + 4)}px 0 ${x + 2}px)`}>
                  {tagLabel(ph.tag)}
                </text>
              )}
            </g>
          );
        })}

        {/* time ticks */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={xFor(t)} x2={xFor(t)} y1={padTop} y2={padTop + plotH}
                  stroke="var(--border)" strokeOpacity={0.2} />
            <text x={xFor(t) + 3} y={height - 5} fontSize={9}
                  fontFamily="var(--font-mono)" fill="var(--text-dim)">
              {fmtTimeShort(t)}
            </text>
          </g>
        ))}

        {fillD && <path d={fillD} fill="url(#ffFill)" />}
        {pathD && <path d={pathD} fill="none" stroke="#ff7b7b"
                        strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}

        {drawPts && visible.map((p, i) => (
          <circle key={i} cx={xFor(p.at)} cy={yFor(p.pos)} r={2.2}
                  fill="#ff4b4b" stroke="#fff" strokeWidth={0.5} />
        ))}

        {currentMs != null && currentMs >= vpStart && currentMs <= vpEnd && (
          <>
            <line x1={xFor(currentMs)} x2={xFor(currentMs)} y1={0} y2={height}
                  stroke="#fff" strokeWidth={1} strokeOpacity={0.9} />
            <polygon points={`${xFor(currentMs)-4},${padTop} ${xFor(currentMs)+4},${padTop} ${xFor(currentMs)},${padTop+5}`} fill="#fff" />
          </>
        )}
      </svg>
    </div>
  );
}

// ─── PreviewChart ─────────────────────────────────────────────────
// Two charts stacked: original phrase on top, transformed preview below.
// Used by the Phrase Editor.
function PreviewChart({ original, preview, label = "Preview" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between",
                      fontSize: 11, color: "var(--text-dim)", marginBottom: 4,
                      textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          <span>Original</span>
          <span className="mono">{original.actions.length} actions · {original.bpm} BPM</span>
        </div>
        <ScriptChart actions={original.actions} totalMs={original.end - original.start}
                     startMs={original.start} endMs={original.end}
                     phrases={[]} showPhraseTags={false} height={120}
                     showActions="always" />
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between",
                      fontSize: 11, color: "var(--accent-light, #ff7b7b)",
                      marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          <span>{label}</span>
          <span className="mono">{preview.actions.length} actions · {preview.bpm} BPM</span>
        </div>
        <ScriptChart actions={preview.actions} totalMs={preview.end - preview.start}
                     startMs={preview.start} endMs={preview.end}
                     phrases={[]} showPhraseTags={false} height={120}
                     showActions="always" />
      </div>
    </div>
  );
}

// ─── ScopePlayer ──────────────────────────────────────────────────
// The new contextual player. Shows the video for the current scope —
// chapter, phrase, pattern, or the whole script — with a chart underneath.
//
// scope = { kind: "script"|"chapter"|"phrase"|"pattern", label, start, end, ... }
function ScopePlayer({ scope, actions, phrases, currentMs, isPlaying, onPlayPause, onSeek, height = 280, compact = false }) {
  const dur = scope.end - scope.start;
  const localMs = Math.max(scope.start, Math.min(scope.end, currentMs ?? scope.start));

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
    }}>
      {/* Video frame */}
      <div style={{
        position: "relative", aspectRatio: compact ? "auto" : "16 / 9",
        height: compact ? height : "auto",
        background: "linear-gradient(135deg, #1a1d2c, #0e1117)",
        display: "grid", placeItems: "center", borderBottom: "1px solid var(--border)",
      }}>
        {/* Frame placeholder */}
        <svg viewBox="0 0 200 112" style={{ width: "100%", height: "100%", opacity: 0.5 }} preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="filmGrain" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2d3148" />
              <stop offset="50%" stopColor="#1a1d2c" />
              <stop offset="100%" stopColor="#3a3f5c" />
            </linearGradient>
          </defs>
          <rect width="200" height="112" fill="url(#filmGrain)" />
          <circle cx="100" cy="56" r="22" fill="rgba(0,0,0,0.4)" />
          <polygon points="94,46 94,66 112,56" fill="rgba(255,255,255,0.7)" />
        </svg>

        {/* Scope chip — top-left */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", background: "rgba(0,0,0,0.6)", borderRadius: 999,
          fontSize: 11, color: "#fff", fontWeight: 600, backdropFilter: "blur(8px)",
        }}>
          <Icon name={
            scope.kind === "script"   ? "film" :
            scope.kind === "chapter"  ? "bookmark" :
            scope.kind === "phrase"   ? "scan-line" :
            scope.kind === "pattern"  ? "shapes" : "film"
          } size={11} />
          <span>{scope.label}</span>
          <span className="mono" style={{ opacity: 0.6 }}>·</span>
          <span className="mono" style={{ opacity: 0.7 }}>{fmtTimeShort(scope.start)}–{fmtTimeShort(scope.end)}</span>
        </div>

        {/* Center play button */}
        <button onClick={onPlayPause} style={{
          position: "absolute", inset: 0, background: "transparent", border: "none",
          cursor: "pointer", display: "grid", placeItems: "center",
        }}>
          <span style={{
            width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.18)",
            backdropFilter: "blur(8px)", display: "grid", placeItems: "center",
            border: "1px solid rgba(255,255,255,0.3)",
          }}>
            <Icon name={isPlaying ? "pause" : "play"} size={22} stroke={2} style={{ color: "#fff" }} />
          </span>
        </button>
      </div>

      {/* Chart strip under video */}
      <div style={{ padding: "10px 12px 14px" }}>
        <ScriptChart actions={actions} phrases={phrases ?? []}
                     totalMs={scope.end - scope.start}
                     startMs={scope.start} endMs={scope.end}
                     currentMs={localMs} onSeek={onSeek}
                     height={92} showPhraseTags={!compact}
                     showActions={scope.kind === "phrase" ? "always" : "auto"} />
        {/* Transport */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          <Button kind="ghost" size="icon" title="Skip back"><Icon name="skip-back" size={14} /></Button>
          <Button kind="primary" size="icon" onClick={onPlayPause}>
            <Icon name={isPlaying ? "pause" : "play"} size={14} />
          </Button>
          <Button kind="ghost" size="icon" title="Skip forward"><Icon name="skip-forward" size={14} /></Button>
          <span className="mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ color: "var(--text)" }}>{fmtTime(localMs - scope.start)}</span>
            <span style={{ opacity: 0.4 }}> / {fmtTime(dur)}</span>
          </span>
          <div style={{ flex: 1 }} />
          <Pill tone="neutral">scope: {scope.kind}</Pill>
        </div>
      </div>
    </div>
  );
}

// ─── MiniWave ─────────────────────────────────────────────────────
// Tiny inline waveform from a seed. Cards / list rows.
function MiniWave({ seed, color = "#ff7b7b", height = 24 }) {
  let s = 0; for (let i = 0; i < (seed || "").length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffff) / 65535; };
  const N = 40;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const v = 50 + 30 * Math.sin(t * 8 + rand() * 2) + (rand() - 0.5) * 22;
    pts.push([t * 100, Math.max(8, Math.min(92, v))]);
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }}>
      <path d={`${d} L 100 100 L 0 100 Z`} fill={color} fillOpacity={0.18} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────
// Tiny actions chart for table rows / phrase lists.
function Sparkline({ actions, start, end, color = "var(--accent)", filled = false, height = 30 }) {
  if (!actions || actions.length === 0) {
    return <div style={{ height, background: "var(--surface-2)", borderRadius: 3 }} />;
  }
  const dur = Math.max(1, end - start);
  const pts = actions.map(a => [
    ((a.at - start) / dur) * 100,
    100 - a.pos,
  ]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
         style={{ width: "100%", height, background: "var(--bg)", borderRadius: 3 }}>
      {filled && <path d={`${d} L 100 100 L 0 100 Z`} fill={color} fillOpacity={0.22} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

Object.assign(window, {
  ScriptChart, PreviewChart, PhraseRibbon, BehaviorTagBar, ScopePlayer, MiniWave,
  Sparkline, tagColor, tagLabel,
});
