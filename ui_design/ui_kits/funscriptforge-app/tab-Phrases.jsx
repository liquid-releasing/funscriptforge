// PhrasesTab — selector view + editor view.
//
// Selector: full-script overview. Phrase ribbon, table of all phrases with
// behavioral tags, BPM, suggested transforms. Click a phrase → editor.
//
// Editor: single phrase open. Three columns:
//   • Left list: phrases in this chapter (or all) for quick navigation
//   • Center: ScopePlayer (video clip of just this phrase) + Original chart + Preview chart
//   • Right: TransformPanel (the screenshots show this exact layout)

const { useState: phState, useMemo: phMemo } = React;

function PhrasesTab({ scope, currentMs, isPlaying, onPlayPause, onSeek }) {
  const [view, setView] = phState("selector");        // "selector" | "editor"
  const [selectedId, setSelected] = phState("p09");

  const phrases = phMemo(() => {
    if (scope === "all") return FF_DATA.PHRASES;
    return FF_DATA.PHRASES.filter(p => p.chapterId === scope);
  }, [scope]);

  const selected = FF_DATA.PHRASES.find(p => p.id === selectedId) ?? phrases[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Sub-tab strip — Selector vs Editor */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 22px", background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
      }}>
        <Segmented value={view} onChange={setView} options={[
          { value: "selector", label: "Selector" },
          { value: "editor",   label: "Editor" },
        ]} />
        <div style={{ width: 1, height: 18, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {phrases.length} phrases · {phrases.filter(p => p.tag).length} tagged · {phrases.filter(p => !p.tag).length} well-formed
        </span>
        <div style={{ flex: 1 }} />
        {view === "editor" && (
          <>
            <Button kind="ghost" size="sm" icon="chevron-left"
                    onClick={() => {
                      const i = phrases.findIndex(p => p.id === selectedId);
                      if (i > 0) setSelected(phrases[i - 1].id);
                    }}>Prev</Button>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {phrases.findIndex(p => p.id === selectedId) + 1} / {phrases.length}
            </span>
            <Button kind="ghost" size="sm" iconRight="chevron-right"
                    onClick={() => {
                      const i = phrases.findIndex(p => p.id === selectedId);
                      if (i >= 0 && i < phrases.length - 1) setSelected(phrases[i + 1].id);
                    }}>Next</Button>
          </>
        )}
      </div>

      {view === "selector"
        ? <PhraseSelector phrases={phrases} selectedId={selectedId} onSelect={setSelected}
                          onOpenEditor={(id) => { setSelected(id); setView("editor"); }}
                          currentMs={currentMs} onSeek={onSeek} />
        : <PhraseEditor phrase={selected} phrases={phrases}
                        onSelectPhrase={setSelected}
                        currentMs={currentMs} isPlaying={isPlaying}
                        onPlayPause={onPlayPause} onSeek={onSeek} />}
    </div>
  );
}

// ─── PhraseSelector ───────────────────────────────────────────────
function PhraseSelector({ phrases, selectedId, onSelect, onOpenEditor, currentMs, onSeek }) {
  const totalMs = FF_DATA.TOTAL_MS;
  const startMs = phrases[0]?.start ?? 0;
  const endMs = phrases[phrases.length - 1]?.end ?? totalMs;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column",
                  overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>
      {/* Full-script ribbon */}
      <SectionLabel>Phrase ribbon — colored by behavioral tag</SectionLabel>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <ScriptChart actions={FF_DATA.ACTIONS} phrases={phrases} totalMs={totalMs}
                     startMs={startMs} endMs={endMs}
                     currentMs={currentMs} onSeek={onSeek}
                     selectedPhraseId={selectedId} onSelectPhrase={onSelect}
                     height={180} showActions="auto" />
        <div style={{ height: 8 }} />
        <PhraseRibbon phrases={phrases} totalMs={totalMs}
                      selectedId={selectedId} onSelect={onSelect}
                      currentMs={currentMs} />
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8,
                      fontSize: 11, color: "var(--text-dim)" }}>
          {(window.FF_TAGS || []).map(t => (
            <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color }} />
              {t.label}
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: "#3ed598" }} />
            well-formed
          </span>
        </div>
      </div>

      {/* Phrase table */}
      <SectionLabel right={<Button kind="ghost" size="sm" icon="filter">Filter…</Button>}>
        Phrases · {phrases.length}
      </SectionLabel>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 8, overflow: "hidden" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "44px 92px 80px 1fr 110px 80px 60px 140px 96px",
          gap: 8, padding: "10px 14px",
          background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
          fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <span>#</span><span>Time</span><span>Dur.</span>
          <span>Behavioral tag</span><span>Pattern</span>
          <span style={{ textAlign: "right" }}>BPM</span>
          <span style={{ textAlign: "right" }}>Span</span>
          <span>Suggested transform</span>
          <span></span>
        </div>
        {phrases.map((p, i) => {
          const tag = (window.FF_TAGS || []).find(t => t.id === p.tag);
          const tx = tag ? (window.FF_TRANSFORMS || []).find(t => t.id === tag.primary) : null;
          const pat = (FF_DATA.PATTERNS || []).find(x => x.id === p.patternId);
          const sel = p.id === selectedId;
          return (
            <div key={p.id} onClick={() => onSelect(p.id)}
                 onDoubleClick={() => onOpenEditor(p.id)}
                 style={{
                   display: "grid",
                   gridTemplateColumns: "44px 92px 80px 1fr 110px 80px 60px 140px 96px",
                   gap: 8, padding: "10px 14px", alignItems: "center",
                   borderBottom: "1px solid var(--border)",
                   background: sel ? "rgba(255,75,75,0.06)" : "transparent",
                   borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
                   cursor: "pointer", fontSize: 12,
                 }}>
              <span className="mono" style={{ color: "var(--text-dim)" }}>{i + 1}</span>
              <span className="mono" style={{ color: "var(--text-muted)" }}>{fmtTimeShort(p.start)}</span>
              <span className="mono" style={{ color: "var(--text-dim)" }}>{fmtTimeShort(p.end - p.start)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2,
                               background: tagColor(p.tag) }} />
                <span style={{ fontWeight: 600, color: tag ? "var(--text)" : "var(--text-muted)" }}>
                  {tagLabel(p.tag)}
                </span>
              </span>
              <span style={{ color: "var(--text-muted)" }}>{pat?.label ?? "—"}</span>
              <span className="mono" style={{ textAlign: "right",
                                              color: p.bpm > 200 ? "var(--danger)"
                                                   : p.bpm < 30 ? "var(--text-dim)"
                                                   : "var(--text)" }}>
                {p.bpm}
              </span>
              <span className="mono" style={{ textAlign: "right", color: "var(--text-muted)" }}>{p.ampSpan}</span>
              <span style={{ fontSize: 11, color: "var(--accent-light, #ff7b7b)" }}>
                {tx?.label ?? "Passthrough"}
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button kind="ghost" size="sm" iconRight="chevron-right"
                        onClick={(e) => { e.stopPropagation(); onOpenEditor(p.id); }}>Open</Button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PhraseEditor ─────────────────────────────────────────────────
function PhraseEditor({ phrase, phrases, onSelectPhrase, currentMs, isPlaying, onPlayPause, onSeek }) {
  // Initial transform suggestion based on tag
  const suggestedTx = phrase.tag
    ? (window.FF_TAGS || []).find(t => t.id === phrase.tag)?.primary
    : "passthrough";

  const [category, setCategory] = phState(() => {
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === suggestedTx);
    return t?.category ?? "behavior";
  });
  const [transformId, setTransformId] = phState(suggestedTx);
  const [params, setParams] = phState(() => {
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === suggestedTx);
    if (!t) return {};
    const out = {};
    t.params.forEach(p => { out[p.id] = p.default; });
    return out;
  });

  // When user picks a different transform, reset its params
  const handleTransformChange = (id) => {
    setTransformId(id);
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === id);
    if (t) {
      setCategory(t.category);
      const out = {};
      t.params.forEach(p => { out[p.id] = p.default; });
      setParams(out);
    }
  };

  // Action subset for original + preview (synthetic — preview is the original
  // with a slight transformation applied).
  const original = phMemo(() => {
    const acts = FF_DATA.ACTIONS.filter(a => a.at >= phrase.start && a.at <= phrase.end);
    return { actions: acts, start: phrase.start, end: phrase.end, bpm: phrase.bpm };
  }, [phrase]);

  const preview = phMemo(() => {
    const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);
    let acts = original.actions;
    let bpm = phrase.bpm;
    // Synthetic preview transforms — visually convey what's going to happen.
    if (tx?.id === "amplitude_scale") {
      const s = params.scale ?? 2;
      acts = acts.map(a => ({ ...a, pos: Math.max(0, Math.min(100, Math.round(50 + (a.pos - 50) * s))) }));
    } else if (tx?.id === "normalize_range") {
      const lo = params.low ?? 0, hi = params.high ?? 100;
      const min = Math.min(...acts.map(a => a.pos));
      const max = Math.max(...acts.map(a => a.pos));
      const range = Math.max(1, max - min);
      acts = acts.map(a => ({ ...a, pos: Math.round(lo + ((a.pos - min) / range) * (hi - lo)) }));
    } else if (tx?.id === "recenter") {
      const target = params.center ?? 50;
      const cur = acts.reduce((s, a) => s + a.pos, 0) / acts.length;
      const shift = target - cur;
      acts = acts.map(a => ({ ...a, pos: Math.max(0, Math.min(100, Math.round(a.pos + shift))) }));
    } else if (tx?.id === "halve_tempo") {
      acts = acts.filter((_, i) => i % 2 === 0);
      bpm = Math.round(bpm / 2);
    } else if (tx?.id === "boost_contrast") {
      const k = (params.strength ?? 0.5) * 0.6;
      acts = acts.map(a => {
        const d = a.pos - 50;
        return { ...a, pos: Math.max(0, Math.min(100, Math.round(50 + d * (1 + k * 1.5)))) };
      });
    } else if (tx?.id === "shift") {
      const o = params.offset ?? 0;
      acts = acts.map(a => ({ ...a, pos: Math.max(0, Math.min(100, a.pos + o)) }));
    } else if (tx?.id === "invert") {
      acts = acts.map(a => ({ ...a, pos: 100 - a.pos }));
    } else if (tx?.id === "passthrough") {
      // no-op
    } else if (tx?.id === "stroke" || tx?.id === "drift" || tx?.id === "tide" || tx?.id === "waiting") {
      // Replace with synthetic — generate a clean wave
      const n = 16;
      acts = [];
      const dur = phrase.end - phrase.start;
      for (let i = 0; i < n; i++) {
        const t = phrase.start + (i / (n - 1)) * dur;
        const v = 50 + 40 * Math.sin((i / n) * Math.PI * 6);
        acts.push({ at: Math.round(t), pos: Math.round(Math.max(0, Math.min(100, v))) });
      }
    } else {
      // Generic visual change — slight smoothing
      acts = acts.map((a, i, arr) => {
        const prev = arr[Math.max(0, i - 1)];
        const next = arr[Math.min(arr.length - 1, i + 1)];
        return { ...a, pos: Math.round((prev.pos + a.pos * 2 + next.pos) / 4) };
      });
    }
    return { actions: acts, start: phrase.start, end: phrase.end, bpm };
  }, [phrase, transformId, params, original.actions]);

  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      {/* Left rail — phrase list */}
      <div style={{
        width: 220, flexShrink: 0, overflow: "auto",
        background: "var(--surface)", borderRight: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, fontWeight: 700,
                        color: "var(--text-dim)", textTransform: "uppercase",
                        letterSpacing: "0.08em" }}>
            Jump to phrase
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 }}>
            Click any phrase to load it into the editor on the right.
          </div>
        </div>
        {phrases.map((p, i) => {
          const sel = p.id === phrase.id;
          return (
            <button key={p.id} onClick={() => onSelectPhrase(p.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "9px 14px", border: "none",
              borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
              background: sel ? "var(--surface-2)" : "transparent",
              color: "var(--text)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
            }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)", minWidth: 22 }}>{i + 1}</span>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: tagColor(p.tag), flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: sel ? 700 : 500,
                              color: p.tag ? "var(--text)" : "var(--text-muted)" }}>
                  {tagLabel(p.tag)}
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--text-dim)" }}>
                  {fmtTimeShort(p.start)} · {p.bpm} BPM
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Center — player + charts */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            phrase {phrases.findIndex(x => x.id === phrase.id) + 1} of {phrases.length}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>·</span>
          <Pill tone="neutral">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: tagColor(phrase.tag), marginRight: 6 }} />
            {tagLabel(phrase.tag)}
          </Pill>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {phrase.bpm} BPM · span {phrase.ampSpan} · mean pos {phrase.meanPos}
          </span>
          <div style={{ flex: 1 }} />
          {phrase.tag && (
            <Pill tone="info">
              <Icon name="lightbulb" size={11} style={{ marginRight: 4 }} />
              {(window.FF_TAGS || []).find(t => t.id === phrase.tag)?.desc}
            </Pill>
          )}
        </div>

        <ScopePlayer
          scope={{ kind: "phrase", label: `Phrase ${phrases.findIndex(x => x.id === phrase.id) + 1} (${tagLabel(phrase.tag)})`,
                   start: phrase.start, end: phrase.end }}
          actions={original.actions}
          currentMs={currentMs}
          isPlaying={isPlaying} onPlayPause={onPlayPause} onSeek={onSeek}
        />

        <div style={{ height: 18 }} />

        <PreviewChart original={original} preview={preview}
                      label={tx ? `Preview · ${tx.label}` : "Preview"} />

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Pill tone="neutral">
            <Icon name="hash" size={11} style={{ marginRight: 4 }} />
            {original.actions.length} actions
          </Pill>
          <span style={{ color: "var(--text-dim)" }}>→</span>
          <Pill tone={preview.actions.length === original.actions.length ? "neutral" : "warn"}>
            <Icon name="hash" size={11} style={{ marginRight: 4 }} />
            {preview.actions.length} actions {preview.actions.length !== original.actions.length && tx?.category === "structural" ? "(structural)" : ""}
          </Pill>
          <Pill tone="neutral">
            <Icon name="activity" size={11} style={{ marginRight: 4 }} />
            {preview.bpm} BPM
          </Pill>
          <div style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" icon="undo-2">Undo</Button>
          <Button kind="ghost" size="sm" icon="check">Mark phrase reviewed</Button>
        </div>
      </div>

      {/* Right — TransformPanel */}
      <TransformPanel
        category={category} onCategoryChange={setCategory}
        transformId={transformId} onTransformChange={handleTransformChange}
        params={params} onParamsChange={setParams}
        phraseTag={phrase.tag}
        onApply={() => {}}
        onCancel={() => {
          setTransformId("passthrough");
          setParams({});
        }}
      />
    </div>
  );
}

// Helper used by Edit tab — synthetic preview transform
function _ffTransformActions(actions, transformId, params, phrase) {
  if (!actions || actions.length === 0) return actions;
  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);
  if (!tx || tx.id === "passthrough") return actions;
  const C = (v) => Math.max(0, Math.min(100, v));
  if (tx.id === "amplitude_scale") {
    const s = params.scale ?? 2;
    return actions.map(a => ({ ...a, pos: C(Math.round(50 + (a.pos - 50) * s)) }));
  }
  if (tx.id === "normalize_range") {
    const lo = params.low ?? 0, hi = params.high ?? 100;
    const min = Math.min(...actions.map(a => a.pos));
    const max = Math.max(...actions.map(a => a.pos));
    const r = Math.max(1, max - min);
    return actions.map(a => ({ ...a, pos: C(Math.round(lo + ((a.pos - min) / r) * (hi - lo))) }));
  }
  if (tx.id === "recenter") {
    const target = params.center ?? 50;
    const cur = actions.reduce((s, a) => s + a.pos, 0) / actions.length;
    const shift = target - cur;
    return actions.map(a => ({ ...a, pos: C(Math.round(a.pos + shift)) }));
  }
  if (tx.id === "halve_tempo") return actions.filter((_, i) => i % 2 === 0);
  if (tx.id === "boost_contrast") {
    const k = (params.strength ?? 0.5) * 0.6;
    return actions.map(a => ({ ...a, pos: C(Math.round(50 + (a.pos - 50) * (1 + k * 1.5))) }));
  }
  if (tx.id === "shift") {
    const o = params.offset ?? 0;
    return actions.map(a => ({ ...a, pos: C(a.pos + o) }));
  }
  if (tx.id === "invert") return actions.map(a => ({ ...a, pos: 100 - a.pos }));
  if (tx.category === "structural") {
    const n = 14, out = [];
    const dur = phrase.end - phrase.start;
    for (let i = 0; i < n; i++) {
      const t = phrase.start + (i / (n - 1)) * dur;
      const v = 50 + 38 * Math.sin((i / n) * Math.PI * 5 + i * 0.3);
      out.push({ at: Math.round(t), pos: C(Math.round(v)) });
    }
    return out;
  }
  return actions.map((a, i, arr) => {
    const prev = arr[Math.max(0, i - 1)];
    const next = arr[Math.min(arr.length - 1, i + 1)];
    return { ...a, pos: Math.round((prev.pos + a.pos * 2 + next.pos) / 4) };
  });
}
window.transformActions = _ffTransformActions;
window.PhrasesTab = PhrasesTab;
