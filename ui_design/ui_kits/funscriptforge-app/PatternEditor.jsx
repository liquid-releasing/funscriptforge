// PatternEditor — batch fix all phrases sharing a behavioral tag.
//
// Layout:
//   Left rail:  list of behavioral tags with counts (10 tags)
//   Center:     overview of tag — definition, count, BPM hist, then table of all
//               phrases with this tag, each showing its before/after sparkline.
//   Right:      TransformPanel — transform applied to ALL phrases at once.

const { useState: peState, useMemo: peMemo } = React;

function PatternEditor() {
  const [tagId, setTagId] = peState("stingy");
  const tag = (window.FF_TAGS || []).find(t => t.id === tagId);
  const phrases = peMemo(
    () => FF_DATA.PHRASES.filter(p => p.tag === tagId),
    [tagId]
  );

  // Shared transform across all matched phrases
  const suggested = tag?.primary ?? "passthrough";
  const [category, setCategory] = peState(() => {
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === suggested);
    return t?.category ?? "behavior";
  });
  const [transformId, setTransformId] = peState(suggested);
  const [params, setParams] = peState(() => {
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === suggested);
    if (!t) return {};
    const out = {};
    t.params.forEach(p => { out[p.id] = p.default; });
    return out;
  });

  // Reset when tagId changes
  React.useEffect(() => {
    const sug = (window.FF_TAGS || []).find(t => t.id === tagId)?.primary ?? "passthrough";
    const t = (window.FF_TRANSFORMS || []).find(x => x.id === sug);
    if (t) {
      setCategory(t.category);
      setTransformId(t.id);
      const out = {};
      t.params.forEach(p => { out[p.id] = p.default; });
      setParams(out);
    }
  }, [tagId]);

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

  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);

  // Tag stats
  const stats = peMemo(() => {
    if (phrases.length === 0) return null;
    const bpms = phrases.map(p => p.bpm);
    const spans = phrases.map(p => p.ampSpan);
    const totalDur = phrases.reduce((s, p) => s + (p.end - p.start), 0);
    return {
      count: phrases.length,
      bpmAvg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      bpmMin: Math.min(...bpms),
      bpmMax: Math.max(...bpms),
      spanAvg: Math.round(spans.reduce((a, b) => a + b, 0) / spans.length),
      totalDur,
      pctOfScript: Math.round((totalDur / FF_DATA.TOTAL_MS) * 100),
    };
  }, [phrases]);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      {/* Left — tag list */}
      <div style={{
        width: 240, flexShrink: 0, overflow: "auto",
        background: "var(--surface)", borderRight: "1px solid var(--border)",
      }}>
        <div style={{ padding: "12px 14px", fontSize: 10, fontWeight: 700,
                      color: "var(--text-dim)", textTransform: "uppercase",
                      letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
          Behavioral tags
        </div>
        {(window.FF_TAGS || []).map(t => {
          const count = FF_DATA.PHRASES.filter(p => p.tag === t.id).length;
          const sel = t.id === tagId;
          return (
            <button key={t.id} onClick={() => setTagId(t.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "10px 14px", border: "none",
              borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
              background: sel ? "var(--surface-2)" : "transparent",
              color: "var(--text)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: sel ? 700 : 500 }}>{t.label}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 1,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.desc}
                </div>
              </div>
              <span className="mono" style={{
                fontSize: 11, fontWeight: 600,
                color: count > 0 ? "var(--text)" : "var(--text-dim)",
                background: count > 0 ? "var(--surface-2)" : "transparent",
                padding: "2px 7px", borderRadius: 4, minWidth: 24, textAlign: "center",
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Center — overview + phrase table */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>
        {/* Tag header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: tag?.color }} />
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{tag?.label}</h2>
          <Pill tone="neutral">{phrases.length} phrases</Pill>
          {stats && <Pill tone="neutral">{stats.pctOfScript}% of script</Pill>}
          <div style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" icon="search">Locate in selector</Button>
        </div>

        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5,
                    maxWidth: 720 }}>
          {tag?.fullDesc ?? tag?.desc}
        </p>

        {/* Stats grid */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10,
                        marginBottom: 22 }}>
            <StatCard label="Count" value={stats.count} hint="phrases with this tag" />
            <StatCard label="Avg BPM" value={stats.bpmAvg} hint={`range ${stats.bpmMin}–${stats.bpmMax}`} />
            <StatCard label="Avg span" value={stats.spanAvg} hint="amplitude (0–100)" />
            <StatCard label="Total duration" value={fmtTimeShort(stats.totalDur)} hint={`${stats.pctOfScript}% of script`} />
          </div>
        )}

        {/* Apply-to subset controls */}
        <div style={{
          padding: "12px 14px", marginBottom: 16,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <Icon name="layers" size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 13, color: "var(--text)" }}>
            Transform applies to <strong>all {phrases.length} phrases</strong> tagged
            {' '}<span style={{ color: tag?.color, fontWeight: 700 }}>{tag?.label}</span>.
          </span>
          <div style={{ flex: 1 }} />
          <Segmented value="all" onChange={() => {}} options={[
            { value: "all", label: "All" },
            { value: "selected", label: "Selected only" },
            { value: "filtered", label: "Filtered" },
          ]} />
        </div>

        {/* Phrase table with sparklines */}
        <SectionLabel>
          Phrases · before / after preview
        </SectionLabel>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 8, overflow: "hidden" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "44px 100px 64px 64px 1fr 1fr 32px",
            gap: 10, padding: "10px 14px",
            background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
            fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            <span>#</span><span>Time</span>
            <span style={{ textAlign: "right" }}>BPM</span>
            <span style={{ textAlign: "right" }}>Span</span>
            <span>Original</span><span>Preview</span><span></span>
          </div>

          {phrases.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
              No phrases tagged <strong>{tag?.label}</strong> in this script.
            </div>
          )}

          {phrases.map((p, i) => {
            const acts = FF_DATA.ACTIONS.filter(a => a.at >= p.start && a.at <= p.end);
            return (
              <div key={p.id} style={{
                display: "grid",
                gridTemplateColumns: "44px 100px 64px 64px 1fr 1fr 32px",
                gap: 10, padding: "10px 14px", alignItems: "center",
                borderBottom: "1px solid var(--border)", fontSize: 12,
              }}>
                <span className="mono" style={{ color: "var(--text-dim)" }}>{i + 1}</span>
                <span className="mono" style={{ color: "var(--text-muted)" }}>{fmtTimeShort(p.start)}</span>
                <span className="mono" style={{ textAlign: "right" }}>{p.bpm}</span>
                <span className="mono" style={{ textAlign: "right", color: "var(--text-muted)" }}>{p.ampSpan}</span>
                <Sparkline actions={acts} start={p.start} end={p.end}
                           color="var(--text-dim)" filled={false} height={28} />
                <Sparkline actions={transformActions(acts, transformId, params, p)}
                           start={p.start} end={p.end}
                           color={tag?.color ?? "var(--accent)"} filled={true} height={28} />
                <Button kind="ghost" size="sm" icon="external-link" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right — TransformPanel (shared) */}
      <TransformPanel
        category={category} onCategoryChange={setCategory}
        transformId={transformId} onTransformChange={handleTransformChange}
        params={params} onParamsChange={setParams}
        phraseTag={tagId}
        applyLabel={`Apply to all ${phrases.length}`}
        onApply={() => {}}
        onCancel={() => handleTransformChange("passthrough")}
      />
    </div>
  );
}

// Tiny helpers
function StatCard({ label, value, hint }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }} className="mono">{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

// Quick-and-dirty client-side preview transform — same logic as Phrase Editor,
// kept inline so this file doesn't depend on the other tab.
function transformActions(actions, transformId, params, phrase) {
  if (!actions.length) return actions;
  let acts = actions.slice();
  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);
  if (!tx || tx.id === "passthrough") return acts;

  if (tx.id === "amplitude_scale") {
    const s = params.scale ?? 2;
    return acts.map(a => ({ ...a, pos: clamp(Math.round(50 + (a.pos - 50) * s)) }));
  }
  if (tx.id === "normalize_range") {
    const lo = params.low ?? 0, hi = params.high ?? 100;
    const min = Math.min(...acts.map(a => a.pos));
    const max = Math.max(...acts.map(a => a.pos));
    const r = Math.max(1, max - min);
    return acts.map(a => ({ ...a, pos: clamp(Math.round(lo + ((a.pos - min) / r) * (hi - lo))) }));
  }
  if (tx.id === "recenter") {
    const target = params.center ?? 50;
    const cur = acts.reduce((s, a) => s + a.pos, 0) / acts.length;
    const shift = target - cur;
    return acts.map(a => ({ ...a, pos: clamp(Math.round(a.pos + shift)) }));
  }
  if (tx.id === "halve_tempo") {
    return acts.filter((_, i) => i % 2 === 0);
  }
  if (tx.id === "boost_contrast") {
    const k = (params.strength ?? 0.5) * 0.6;
    return acts.map(a => ({ ...a, pos: clamp(Math.round(50 + (a.pos - 50) * (1 + k * 1.5))) }));
  }
  if (tx.id === "shift") {
    const o = params.offset ?? 0;
    return acts.map(a => ({ ...a, pos: clamp(a.pos + o) }));
  }
  if (tx.id === "invert") {
    return acts.map(a => ({ ...a, pos: 100 - a.pos }));
  }
  if (tx.category === "structural") {
    // Synthetic clean wave
    const n = 14;
    const out = [];
    const dur = phrase.end - phrase.start;
    for (let i = 0; i < n; i++) {
      const t = phrase.start + (i / (n - 1)) * dur;
      const v = 50 + 38 * Math.sin((i / n) * Math.PI * 5 + i * 0.3);
      out.push({ at: Math.round(t), pos: clamp(Math.round(v)) });
    }
    return out;
  }
  // Generic smoothing
  return acts.map((a, i, arr) => {
    const prev = arr[Math.max(0, i - 1)];
    const next = arr[Math.min(arr.length - 1, i + 1)];
    return { ...a, pos: Math.round((prev.pos + a.pos * 2 + next.pos) / 4) };
  });
}
function clamp(v) { return Math.max(0, Math.min(100, v)); }

window.PatternEditor = PatternEditor;
