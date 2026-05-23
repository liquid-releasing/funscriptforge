// TransformPanel — the right-side panel from the Phrase Editor screenshot.
// Shared by: Phrase Editor, Pattern Editor (batch), Catalog Sandbox.
//
// Three category radios (Tone / Behavior / Structural) → transform select →
// dynamic parameter sliders → Apply / Cancel buttons.

const { useState: tpState, useMemo: tpMemo } = React;

function TransformPanel({
  // Active selection
  category, onCategoryChange,
  transformId, onTransformChange,
  params, onParamsChange,
  // Context
  phraseTag,                    // for "Suggested" hint
  applyLabel = "Apply",
  cancelLabel = "Cancel",
  onApply, onCancel,
  // Layout
  width = 360,
  hideHeader = false,
}) {
  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === transformId);
  const visibleTransforms = (window.FF_TRANSFORMS || []).filter(t => t.category === category);
  const suggestedId = phraseTag
    ? (window.FF_TAGS || []).find(t => t.id === phraseTag)?.primary
    : null;

  return (
    <aside style={{
      width, flexShrink: 0, display: "flex", flexDirection: "column",
      background: "var(--surface)", borderLeft: "1px solid var(--border)",
      overflow: "hidden",
    }}>
      {!hideHeader && (
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.08em" }}>Transform</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
            {tx ? tx.label : "Select a transform"}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        {/* Category radios */}
        <div style={{ marginBottom: 18 }}>
          <SectionLabel>Category</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[
              { id: "tone",       label: "Tone",     hint: "6 options" },
              { id: "behavior",   label: "Behavior", hint: "17 options" },
              { id: "structural", label: "Structural", hint: "6 options" },
            ].map(c => {
              const sel = c.id === category;
              return (
                <button key={c.id} onClick={() => onCategoryChange(c.id)} style={{
                  padding: "10px 8px", borderRadius: 6,
                  background: sel ? "rgba(255,75,75,0.10)" : "var(--surface-2)",
                  border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                  color: sel ? "#ff7b7b" : "var(--text-muted)",
                  cursor: "pointer", fontFamily: "inherit",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{c.label}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{c.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Transform select — compact dropdown so params stay above the fold */}
        <div style={{ marginBottom: 18 }}>
          <SectionLabel right={
            suggestedId && phraseTag && transformId !== suggestedId
              ? <button onClick={() => onTransformChange(suggestedId)}
                  style={{ background: "none", border: "none", color: "var(--accent-light, #ff7b7b)",
                           fontSize: 10, fontWeight: 600, cursor: "pointer",
                           textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Use suggested
                </button>
              : null
          }>Transform</SectionLabel>
          <select value={transformId}
                  onChange={(e) => onTransformChange(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 5,
                    background: "var(--surface-2)", color: "var(--text)",
                    border: "1px solid var(--border)", fontFamily: "inherit",
                    fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  }}>
            {visibleTransforms.map(t => {
              const isSuggested = t.id === suggestedId;
              const isFor = phraseTag && t.bestFor.includes(phraseTag);
              const tag = isSuggested ? " ★ suggested" : isFor ? " · fits" : "";
              return <option key={t.id} value={t.id}>{t.label}{tag}</option>;
            })}
          </select>
          {tx && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6,
                          lineHeight: 1.45 }}>{tx.summary}</div>
          )}
        </div>

        {/* Params */}
        {tx && tx.params.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel right={
              <button onClick={() => {
                const defs = {};
                tx.params.forEach(p => { defs[p.id] = p.default; });
                onParamsChange(defs);
              }} style={{ background: "none", border: "none", color: "var(--text-dim)",
                          fontSize: 10, fontWeight: 600, cursor: "pointer",
                          textTransform: "uppercase", letterSpacing: "0.06em" }}>Reset</button>
            }>Parameters</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {tx.params.map(p => (
                <ParamRow key={p.id} param={p}
                          value={params?.[p.id] ?? p.default}
                          onChange={(v) => onParamsChange({ ...params, [p.id]: v })} />
              ))}
            </div>
          </div>
        )}

        {tx && tx.params.length === 0 && (
          <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 6,
                        fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
            <Icon name="info" size={12} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            <strong style={{ color: "var(--text)" }}>{tx.label}</strong> has no parameters — apply as-is.
          </div>
        )}

        {/* Description card */}
        {tx && (
          <div style={{ padding: 14, background: "var(--surface-2)",
                        border: "1px solid var(--border)", borderRadius: 6,
                        fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
            {tx.description}
          </div>
        )}
      </div>

      {/* Apply bar */}
      <div style={{
        display: "flex", gap: 8, padding: "12px 16px",
        background: "var(--surface)", borderTop: "1px solid var(--border)",
      }}>
        <Button kind="ghost" size="sm" onClick={onCancel} style={{ flex: 1 }}>{cancelLabel}</Button>
        <Button kind="primary" size="sm" icon="play" onClick={onApply} style={{ flex: 2 }}>{applyLabel}</Button>
      </div>
    </aside>
  );
}

function ParamRow({ param, value, onChange }) {
  const isInt = (param.step ?? 1) >= 1;
  const display = param.unit
    ? `${value}${param.unit}`
    : (isInt ? value : Number(value).toFixed(2));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{param.label}</span>
        <span className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{display}</span>
      </div>
      <input type="range"
             min={param.min} max={param.max} step={param.step}
             value={value}
             onChange={(e) => onChange(Number(e.target.value))}
             style={{ width: "100%", accentColor: "var(--accent)" }} />
      <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
        <span className="mono">{param.min}</span>
        <span className="mono">{param.max}</span>
      </div>
    </div>
  );
}

window.TransformPanel = TransformPanel;
