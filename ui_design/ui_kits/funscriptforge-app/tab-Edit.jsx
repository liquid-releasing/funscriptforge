// EditTab — chapter-centric editor with persistent context strip.
//
// Layout (top → bottom):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ CHAPTER RIBBON — pick which chapter you're editing         │
//   │   Active chapter brighter, others dim.                     │
//   ├────────────────────────────────────────────────────────────┤
//   │ CHAPTER FUNSCRIPT VIEW — chapter expanded full-width.      │
//   │   Phrases shown as colored bands w/ action density.        │
//   │   Edited phrases = full opacity + white border.            │
//   │   Other phrases dim. Baton tracks playhead.                │
//   ├────────────────────────────────────────────────────────────┤
//   │ PHRASE RIBBON — click any phrase chip to drop into single  │
//   ├────────────────────────────────────────────────────────────┤
//   │ MODE BAR  [Pattern | Behavior tag | Single phrase]         │
//   ├──────────┬──────────────────────────────────┬──────────────┤
//   │ rail     │ MAIN BODY (varies by mode)       │ Transform    │
//   └──────────┴──────────────────────────────────┴──────────────┘

const { useState: edState, useMemo: edMemo, useEffect: edEffect } = React;

function EditTab({ scope, currentMs, onSeek, isPlaying, onPlayPause }) {
  const [mode, setMode] = edState("pattern");
  const [patternId, setPatternId] = edState("pat_steady");
  const [tagId, setTagId] = edState("stingy");
  const [phraseId, setPhraseId] = edState("p09");
  const [activeChapterId, setActiveChapter] = edState(
    scope !== "all" ? scope : (FF_DATA.CHAPTERS[0]?.id || null));

  const inScope = edMemo(() =>
    FF_DATA.PHRASES.filter(p => p.chapterId === activeChapterId)
  , [activeChapterId]);

  const targets = edMemo(() => {
    if (mode === "pattern") return inScope.filter(p => p.patternId === patternId);
    if (mode === "tag")     return inScope.filter(p => p.tag === tagId);
    if (mode === "single")  return inScope.filter(p => p.id === phraseId);
    return [];
  }, [inScope, mode, patternId, tagId, phraseId]);

  const suggested = edMemo(() => {
    if (mode === "tag") return (window.FF_TAGS || []).find(t => t.id === tagId)?.primary;
    if (mode === "single") {
      const p = FF_DATA.PHRASES.find(x => x.id === phraseId);
      return p?.tag ? (window.FF_TAGS || []).find(t => t.id === p.tag)?.primary : "passthrough";
    }
    return "amplitude_scale";
  }, [mode, tagId, phraseId]);

  const [category, setCategory] = edState("behavior");
  const [transformId, setTransformId] = edState("amplitude_scale");
  const [params, setParams] = edState({});

  edEffect(() => {
    if (!suggested) return;
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === suggested);
    if (!t) return;
    setCategory(t.category);
    setTransformId(t.id);
    const out = {}; t.params.forEach(p => { out[p.id] = p.default; });
    setParams(out);
  }, [suggested]);

  const handleTransformChange = (id) => {
    setTransformId(id);
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === id);
    if (t) {
      setCategory(t.category);
      const out = {}; t.params.forEach(p => { out[p.id] = p.default; });
      setParams(out);
    }
  };

  const focusLabel =
    mode === "pattern" ? FF_DATA.PATTERNS.find(p => p.id === patternId)?.label
    : mode === "tag" ? (window.FF_TAGS || []).find(t => t.id === tagId)?.label
    : `Phrase ${FF_DATA.PHRASES.findIndex(x => x.id === phraseId) + 1}`;

  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);
  const targetIds = new Set(targets.map(p => p.id));
  const activeChap = FF_DATA.CHAPTERS.find(c => c.id === activeChapterId) || FF_DATA.CHAPTERS[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* Row 1 — chapter ribbon */}
      <div style={{ background: "var(--surface)", padding: "10px 22px",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                         textTransform: "uppercase", letterSpacing: "0.08em",
                         width: 64, flexShrink: 0 }}>Chapters</span>
          <div style={{ flex: 1, display: "flex", height: 22, gap: 2, position: "relative" }}>
            {FF_DATA.CHAPTERS.map(c => {
              const w = ((c.end - c.start) / FF_DATA.TOTAL_MS) * 100;
              const active = c.id === activeChap.id;
              return (
                <button key={c.id}
                        onClick={() => { setActiveChapter(c.id); onSeek?.(c.start); }}
                        title={c.title}
                        style={{
                          flex: `0 0 ${w}%`, height: "100%",
                          background: c.color,
                          opacity: active ? 1 : 0.32,
                          border: "none", borderRadius: 3, cursor: "pointer",
                          boxShadow: active ? `0 0 0 1.5px #fff inset` : "none",
                          display: "flex", alignItems: "center", padding: "0 6px",
                          fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                          color: active ? "#fff" : "rgba(255,255,255,0.7)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{c.title}</button>
              );
            })}
            {currentMs != null && (
              <div style={{ position: "absolute", top: -3, bottom: -3,
                left: `${(currentMs / FF_DATA.TOTAL_MS) * 100}%`,
                width: 1.5, background: "#fff", pointerEvents: "none" }} />
            )}
          </div>
        </div>
      </div>

      {/* Row 2 — Chapter funscript view (the big P1..PN view) */}
      <div style={{ background: "var(--surface)", padding: "12px 22px 14px",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChap.color }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {activeChap.title}
            </span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
              {fmtTimeShort(activeChap.start)}–{fmtTimeShort(activeChap.end)} ·
              {" "}{inScope.length} phrases
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={onPlayPause}
                    style={{ width: 30, height: 30, borderRadius: 15,
                      background: "var(--accent)", border: "none",
                      color: "#fff", cursor: "pointer",
                      display: "grid", placeItems: "center" }}>
              <Icon name={isPlaying ? "pause" : "play"} size={12} />
            </button>
            <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {fmtTimeShort(currentMs ?? activeChap.start)} / {fmtTimeShort(activeChap.end)}
            </span>
          </div>
        </div>
        <ChapterFunscriptView
          chapter={activeChap}
          phrases={inScope}
          targetIds={targetIds}
          focusPhraseId={mode === "single" ? phraseId : null}
          currentMs={currentMs}
          onSeek={onSeek}
          onSelectPhrase={(pid) => { setMode("single"); setPhraseId(pid); }}
        />
      </div>

      {/* Row 3 — Phrase ribbon (compact chip strip) */}
      <div style={{ background: "var(--surface)", padding: "8px 22px 10px",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                         textTransform: "uppercase", letterSpacing: "0.08em",
                         width: 64, flexShrink: 0 }}>Phrases</span>
          <div style={{ flex: 1, display: "flex", height: 16, gap: 1, position: "relative" }}>
            {inScope.map(ph => {
              const w = ((ph.end - ph.start) / (activeChap.end - activeChap.start)) * 100;
              const isTarget = targetIds.has(ph.id);
              const isFocus = mode === "single" && ph.id === phraseId;
              const color = tagColor(ph.tag);
              return (
                <button key={ph.id}
                        onClick={() => { setMode("single"); setPhraseId(ph.id); onSeek?.(ph.start); }}
                        title={`${tagLabel(ph.tag)} · ${fmtTimeShort(ph.start)}`}
                        style={{
                          flex: `0 0 ${w}%`, height: "100%",
                          background: color,
                          opacity: isTarget ? 1 : 0.5,
                          border: "none", borderRadius: 2, cursor: "pointer",
                          boxShadow: isFocus ? `0 0 0 1.5px #fff inset` : "none",
                        }} />
              );
            })}
            {currentMs != null && currentMs >= activeChap.start && currentMs <= activeChap.end && (
              <div style={{ position: "absolute", top: -2, bottom: -2,
                left: `${((currentMs - activeChap.start) / (activeChap.end - activeChap.start)) * 100}%`,
                width: 1, background: "#fff", pointerEvents: "none" }} />
            )}
          </div>
        </div>
      </div>

      {/* Row 4 — Mode bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 22px", background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                       textTransform: "uppercase", letterSpacing: "0.08em" }}>Edit by</span>
        <Segmented value={mode} onChange={setMode} options={[
          { value: "pattern", label: "Pattern" },
          { value: "tag",     label: "Behavior tag" },
          { value: "single",  label: "Single phrase" },
        ]} />
        <div style={{ width: 1, height: 18, background: "var(--border)" }} />
        {mode === "pattern" && (
          <FocusPicker label="Pattern" value={patternId} onChange={setPatternId}
            options={FF_DATA.PATTERNS.map(p => ({
              id: p.id, label: p.label, desc: p.desc,
              count: inScope.filter(x => x.patternId === p.id).length,
              color: "#c77dff",
            }))} />
        )}
        {mode === "tag" && (
          <FocusPicker label="Behavior tag" value={tagId} onChange={setTagId}
            options={(window.FF_TAGS || []).map(t => ({
              id: t.id, label: t.label, desc: t.desc,
              count: inScope.filter(x => x.tag === t.id).length,
              color: t.color,
            }))} />
        )}
        {mode === "single" && (
          <FocusPicker label="Phrase" value={phraseId} onChange={setPhraseId}
            options={inScope.map((p, i) => ({
              id: p.id, label: `Phrase ${i + 1}`,
              desc: tagLabel(p.tag) + " · " + fmtTimeShort(p.start),
              color: tagColor(p.tag),
            }))} />
        )}
        <div style={{ flex: 1 }} />
        <Pill tone="accent">
          <Icon name="target" size={11} style={{ marginRight: 4 }} />
          {targets.length} affected · {tx?.label || "—"}
        </Pill>
      </div>

      {/* Body — rail + main + transform */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* Left rail */}
        <div style={{ width: 240, flexShrink: 0, overflow: "auto",
                      background: "var(--surface)", borderRight: "1px solid var(--border)" }}>
          {mode === "pattern" && (
            <RailList title="Structural patterns"
              items={FF_DATA.PATTERNS.map(p => ({
                id: p.id, label: p.label, desc: p.desc,
                count: inScope.filter(x => x.patternId === p.id).length,
                swatch: "#c77dff",
              }))}
              activeId={patternId} onSelect={setPatternId} />
          )}
          {mode === "tag" && (
            <RailList title="Behavioral tags"
              items={(window.FF_TAGS || []).map(t => ({
                id: t.id, label: t.label, desc: t.desc,
                count: inScope.filter(x => x.tag === t.id).length,
                swatch: t.color,
              }))}
              activeId={tagId} onSelect={setTagId} />
          )}
          {mode === "single" && (
            <RailList title="Jump to phrase"
              items={inScope.map((p, i) => ({
                id: p.id, label: `${String(i + 1).padStart(2, "0")} · ${tagLabel(p.tag)}`,
                desc: `${fmtTimeShort(p.start)} · ${p.bpm} BPM`,
                swatch: tagColor(p.tag),
              }))}
              activeId={phraseId} onSelect={setPhraseId} />
          )}
        </div>

        {/* Center */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>

          {mode !== "single" && targets.length > 0 && (
            <>
              <SectionLabel right={<span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {targets.length} phrase{targets.length === 1 ? "" : "s"}
              </span>}>
                Per-phrase preview · before / after {tx?.label}
              </SectionLabel>
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                            borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "44px 110px 64px 1fr 1fr 32px",
                  gap: 10, padding: "10px 14px",
                  background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
                  fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>
                  <span>#</span><span>Time</span>
                  <span style={{ textAlign: "right" }}>BPM</span>
                  <span>Original</span><span>Preview</span><span></span>
                </div>
                {targets.map(p => {
                  const i = FF_DATA.PHRASES.findIndex(x => x.id === p.id);
                  const acts = FF_DATA.ACTIONS.filter(a => a.at >= p.start && a.at <= p.end);
                  return (
                    <div key={p.id}
                         onClick={() => onSeek?.(p.start)}
                         onDoubleClick={() => { setMode("single"); setPhraseId(p.id); }}
                         style={{
                      display: "grid",
                      gridTemplateColumns: "44px 110px 64px 1fr 1fr 32px",
                      gap: 10, padding: "10px 14px", alignItems: "center",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer", fontSize: 12,
                    }}>
                      <span className="mono" style={{ color: "var(--text-dim)" }}>{String(i + 1).padStart(2, "0")}</span>
                      <span className="mono" style={{ color: "var(--text-muted)" }}>
                        {fmtTimeShort(p.start)}–{fmtTimeShort(p.end)}
                      </span>
                      <span className="mono" style={{ textAlign: "right" }}>{p.bpm}</span>
                      <Sparkline actions={acts} start={p.start} end={p.end}
                                 color="var(--text-dim)" filled={false} height={28} />
                      <Sparkline actions={(window.transformActions ?? ((a) => a))(acts, transformId, params, p)}
                                 start={p.start} end={p.end}
                                 color="var(--accent-light, #ff7b7b)" filled={true} height={28} />
                      <Button kind="ghost" size="sm" icon="external-link"
                              onClick={(e) => { e.stopPropagation(); setMode("single"); setPhraseId(p.id); }} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {mode === "single" && (() => {
            const p = FF_DATA.PHRASES.find(x => x.id === phraseId);
            if (!p) return null;
            const idx = FF_DATA.PHRASES.findIndex(x => x.id === phraseId);
            const prev = idx > 0 ? FF_DATA.PHRASES[idx - 1] : null;
            const next = idx < FF_DATA.PHRASES.length - 1 ? FF_DATA.PHRASES[idx + 1] : null;
            const acts = FF_DATA.ACTIONS.filter(a => a.at >= p.start && a.at <= p.end);
            const previewActs = (window.transformActions ?? ((a) => a))(acts, transformId, params, p);
            return (
              <>
                <SectionLabel>Phrase detail · before / after {tx?.label}</SectionLabel>
                <PreviewChart
                  original={{ actions: acts, start: p.start, end: p.end, bpm: p.bpm }}
                  preview={{ actions: previewActs, start: p.start, end: p.end, bpm: p.bpm }}
                  label={tx ? `Preview · ${tx.label}` : "Preview"} />
                <div style={{ height: 14 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  {prev && <Button kind="ghost" size="sm" icon="chevron-left"
                          onClick={() => setPhraseId(prev.id)}>Prev phrase</Button>}
                  <div style={{ flex: 1 }} />
                  {next && <Button kind="ghost" size="sm" icon="chevron-right" iconRight
                          onClick={() => setPhraseId(next.id)}>Next phrase</Button>}
                </div>
              </>
            );
          })()}

          {targets.length === 0 && (
            <div style={{
              padding: 32, textAlign: "center", background: "var(--surface)",
              border: "1px dashed var(--border)", borderRadius: 8,
              color: "var(--text-dim)", fontSize: 13,
            }}>
              No phrases match this {mode === "tag" ? "tag" : mode === "pattern" ? "pattern" : "selection"} in this chapter.
            </div>
          )}
        </div>

        {/* Right TransformPanel */}
        <TransformPanel
          category={category} onCategoryChange={setCategory}
          transformId={transformId} onTransformChange={handleTransformChange}
          params={params} onParamsChange={setParams}
          phraseTag={mode === "tag" ? tagId : (mode === "single" ? FF_DATA.PHRASES.find(x => x.id === phraseId)?.tag : null)}
          applyLabel={`Apply to ${targets.length}`}
          onApply={() => {}}
          onCancel={() => handleTransformChange("passthrough")}
        />
      </div>
    </div>
  );
}

// ─── ChapterFunscriptView ───────────────────────────────────────────
// The big P1..PN view: chapter expanded full-width, phrases as colored
// bands with action density inside. Edit targets are bright + bordered;
// non-targets are dimmed.
function ChapterFunscriptView({ chapter, phrases, targetIds, focusPhraseId,
                                currentMs, onSeek, onSelectPhrase }) {
  const wrapRef = React.useRef(null);
  const [width, setWidth] = React.useState(900);
  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const height = 108;
  const padTop = 20;
  const padBottom = 14;
  const plotH = height - padTop - padBottom;
  const dur = chapter.end - chapter.start;
  const xFor = (ms) => ((ms - chapter.start) / dur) * width;
  const yFor = (pos) => padTop + (1 - pos / 100) * plotH;
  const msFromX = (x) => chapter.start + (x / width) * dur;

  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek?.(msFromX(e.clientX - rect.left));
  };

  // ticks
  const ticks = React.useMemo(() => {
    const niceSteps = [10000, 20000, 30000, 60000, 120000, 300000];
    const step = niceSteps.find(s => dur / s < 10) ?? 60000;
    const first = Math.ceil(chapter.start / step) * step;
    const out = [];
    for (let t = first; t <= chapter.end; t += step) out.push(t);
    return out;
  }, [chapter.start, chapter.end, dur]);

  return (
    <div ref={wrapRef} style={{
      width: "100%", height, background: "var(--bg)",
      border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
      position: "relative",
    }}>
      <svg width={width} height={height} onClick={handleClick}
           style={{ cursor: "pointer", display: "block" }}>
        <defs>
          {phrases.map(ph => (
            <linearGradient key={`g-${ph.id}`} id={`fill-${ph.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={tagColor(ph.tag)} stopOpacity="0.85" />
              <stop offset="100%" stopColor={tagColor(ph.tag)} stopOpacity="0.55" />
            </linearGradient>
          ))}
        </defs>

        {/* horizontal grid */}
        {[0, 25, 50, 75, 100].map(p => (
          <line key={p} x1={0} x2={width} y1={yFor(p)} y2={yFor(p)}
                stroke="var(--border)"
                strokeOpacity={p === 50 ? 0.4 : 0.18}
                strokeDasharray={p === 50 ? "" : "2 4"} />
        ))}

        {/* y-axis labels */}
        {[0, 50, 100].map(p => (
          <text key={p} x={4} y={yFor(p) + 3} fontSize={9}
                fontFamily="var(--font-mono)" fill="var(--text-dim)">{p}</text>
        ))}

        {/* phrase bands w/ action density */}
        {phrases.map((ph, i) => {
          const x = xFor(ph.start);
          const w = Math.max(2, xFor(ph.end) - x - 1);
          const isTarget = targetIds.has(ph.id);
          const isFocus = focusPhraseId === ph.id;
          const color = tagColor(ph.tag);
          const acts = FF_DATA.ACTIONS.filter(a => a.at >= ph.start && a.at <= ph.end);
          const opacity = isTarget ? 1 : 0.5;

          return (
            <g key={ph.id}
               onClick={(e) => { e.stopPropagation(); onSelectPhrase?.(ph.id); }}
               style={{ cursor: "pointer", opacity }}>
              {/* phrase rect background */}
              <rect x={x} y={padTop - 18} width={w} height={padTop + plotH - (padTop - 18)}
                    fill={color} fillOpacity={isTarget ? 0.18 : 0.08}
                    stroke={isFocus ? "#fff" : (isTarget ? color : "transparent")}
                    strokeWidth={isFocus ? 1.5 : 1} rx={2} />
              {/* P-label */}
              {w > 24 && (
                <>
                  <rect x={x + 3} y={2} width={Math.min(28, w - 6)} height={16}
                        fill={isTarget ? color : "rgba(0,0,0,0.4)"}
                        stroke={isFocus ? "#fff" : "transparent"} strokeWidth={1}
                        rx={2} />
                  <text x={x + 7} y={14} fontSize={10} fontWeight={700}
                        fill={isTarget ? "#0e1117" : "rgba(255,255,255,0.6)"}
                        style={{ pointerEvents: "none" }}>
                    P{i + 1}
                  </text>
                </>
              )}
              {/* action density — vertical sticks */}
              {acts.map((a, idx) => {
                const ax = xFor(a.at);
                const ay = yFor(a.pos);
                const baseY = padTop + plotH;
                return (
                  <line key={idx} x1={ax} x2={ax} y1={ay} y2={baseY}
                        stroke={color} strokeOpacity={isTarget ? 0.85 : 0.4}
                        strokeWidth={1} />
                );
              })}
            </g>
          );
        })}

        {/* time ticks */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={xFor(t)} x2={xFor(t)} y1={padTop} y2={padTop + plotH}
                  stroke="var(--border)" strokeOpacity={0.18} />
            <text x={xFor(t) + 3} y={height - 4} fontSize={9}
                  fontFamily="var(--font-mono)" fill="var(--text-dim)">
              {fmtTimeShort(t)}
            </text>
          </g>
        ))}

        {/* baton (playhead) */}
        {currentMs != null && currentMs >= chapter.start && currentMs <= chapter.end && (
          <>
            <line x1={xFor(currentMs)} x2={xFor(currentMs)} y1={0} y2={height}
                  stroke="#fff" strokeWidth={1.2} strokeOpacity={0.95} />
            <polygon points={`${xFor(currentMs)-5},0 ${xFor(currentMs)+5},0 ${xFor(currentMs)},6`}
                     fill="#fff" />
          </>
        )}
      </svg>
    </div>
  );
}

// ─── Inline focus picker (mode bar) ───────────────────────────────
function FocusPicker({ label, value, onChange, options }) {
  const opt = options.find(o => o.id === value) ?? options[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: opt?.color || "#888" }} />
      <select value={value} onChange={(e) => onChange(e.target.value)}
              style={{
                padding: "5px 8px", borderRadius: 5,
                background: "var(--surface-2)", color: "var(--text)",
                border: "1px solid var(--border)", fontFamily: "inherit",
                fontSize: 12.5, fontWeight: 600, cursor: "pointer", maxWidth: 240,
              }}>
        {options.map(o => (
          <option key={o.id} value={o.id}>
            {o.label}{o.count != null ? ` (${o.count})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Generic rail list ────────────────────────────────────────────
function RailList({ title, items, activeId, onSelect }) {
  return (
    <>
      <div style={{ padding: "12px 14px", fontSize: 10, fontWeight: 700,
                    color: "var(--text-dim)", textTransform: "uppercase",
                    letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
        {title}
      </div>
      {items.map(it => {
        const sel = it.id === activeId;
        return (
          <button key={it.id} onClick={() => onSelect(it.id)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "10px 14px", border: "none",
            borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
            background: sel ? "var(--surface-2)" : "transparent",
            color: "var(--text)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: it.swatch, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {it.label}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 1,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {it.desc}
              </div>
            </div>
            {it.count != null && (
              <span className="mono" style={{
                fontSize: 11, fontWeight: 600,
                color: it.count > 0 ? "var(--text)" : "var(--text-dim)",
                background: it.count > 0 ? "var(--surface-2)" : "transparent",
                padding: "2px 7px", borderRadius: 4, minWidth: 24, textAlign: "center",
              }}>{it.count}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

window.EditTab = EditTab;
window.ChapterFunscriptView = ChapterFunscriptView;
