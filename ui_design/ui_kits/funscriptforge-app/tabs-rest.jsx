// Remaining tabs in one file: Stim, Multi-axis, Export, Catalog.
// Each is a thin "stub-but-real-looking" screen — enough to convey the
// product, not exhaustively interactive.

const { useState: misc, useMemo: miscMemo } = React;

// ─── StimTab (legacy, replaced by tab-Stim.jsx) ───────────────────
function _UnusedStimTab() {
  const [preset, setPreset] = misc("classic");
  const [intensity, setIntensity] = misc(0.6);
  const [warmup, setWarmup] = misc(30);
  const [crescendo, setCrescendo] = misc(true);

  const presets = [
    { id: "off",     label: "Off",          desc: "No stim track exported.",                    color: "#94a3b8" },
    { id: "classic", label: "Classic",      desc: "Even pulses scaled by phrase intensity.",    color: "#4dabf7" },
    { id: "ramp",    label: "Build & Ramp", desc: "Gentle floor that rises with the script.",   color: "#ffb547" },
    { id: "edge",    label: "Edge",         desc: "Sharp pulses at phrase boundaries only.",    color: "#ff5470" },
    { id: "tease",   label: "Tease",        desc: "Stim drops out during plateau / drone tags.", color: "#c77dff" },
  ];

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", background: "var(--bg)" }}>
      <TabHeader eyebrow="Stim track" title="Electrostim companion track"
        subtitle="Generate a parallel stim funscript shaped by your phrase tags. Stim presets are global; per-phrase exceptions live in the Phrases tab." />

      <SectionLabel>Preset</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 10, marginBottom: 22 }}>
        {presets.map(p => {
          const sel = p.id === preset;
          return (
            <button key={p.id} onClick={() => setPreset(p.id)} style={{
              textAlign: "left", padding: 14, borderRadius: 8,
              background: sel ? "rgba(255,75,75,0.08)" : "var(--surface)",
              border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`,
              color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color }} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>{p.label}</span>
                <div style={{ flex: 1 }} />
                {sel && <Icon name="check" size={14} style={{ color: "var(--accent)" }} />}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45 }}>
                {p.desc}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Card padding={20}>
          <SectionLabel>Parameters</SectionLabel>
          <Slider label="Intensity floor" valueLabel={intensity.toFixed(2)} value={intensity}
                  min={0} max={1} step={0.05} onChange={setIntensity} />
          <div style={{ height: 14 }} />
          <Slider label="Warm-up duration (sec)" valueLabel={`${warmup}s`} value={warmup}
                  min={0} max={120} step={5} onChange={setWarmup} />
          <div style={{ height: 14 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                          fontSize: 13 }}>
            <input type="checkbox" checked={crescendo}
                   onChange={(e) => setCrescendo(e.target.checked)} />
            <span>Crescendo across script</span>
          </label>
        </Card>
        <Card padding={20}>
          <SectionLabel>Preview · stim curve over script</SectionLabel>
          <StimPreviewChart preset={preset} intensity={intensity}
                            warmup={warmup} crescendo={crescendo} />
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)",
                        lineHeight: 1.45 }}>
            Synthetic preview. The final stim track is generated at export time
            from the live phrase tags after all transforms have been applied.
          </div>
        </Card>
      </div>

      <div style={{ height: 22 }} />
      <SectionLabel>Per-tag stim modifiers</SectionLabel>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 8, overflow: "hidden" }}>
        {(window.FF_TAGS || []).slice(0, 6).map((t, i, arr) => (
          <div key={t.id} style={{
            display: "grid", gridTemplateColumns: "180px 1fr 80px 80px",
            gap: 14, padding: "10px 16px", alignItems: "center",
            borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t.label}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "var(--surface-2)",
                          overflow: "hidden" }}>
              <div style={{ width: `${30 + i * 12}%`, height: "100%",
                            background: t.color, opacity: 0.7 }} />
            </div>
            <Pill tone="neutral" style={{ fontSize: 10 }}>×{(0.4 + i * 0.15).toFixed(2)}</Pill>
            <Button kind="ghost" size="sm" icon="settings-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function StimPreviewChart({ preset, intensity, warmup, crescendo }) {
  const N = 80;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const warm = Math.min(1, (t * 600) / Math.max(1, warmup));
    const base = preset === "off" ? 0
                : preset === "classic" ? 0.5 + 0.3 * Math.sin(t * 18)
                : preset === "ramp" ? t
                : preset === "edge" ? (Math.abs(((t * 6) % 1) - 0.5) > 0.45 ? 1 : 0.05)
                : 0.6 - 0.4 * Math.sin(t * 8);
    let v = intensity + base * 0.5;
    if (crescendo) v *= 0.5 + t * 0.6;
    v *= warm;
    v = Math.max(0, Math.min(1, v));
    pts.push([t * 100, 100 - v * 100]);
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
         style={{ width: "100%", height: 120, background: "var(--bg)",
                  borderRadius: 6, border: "1px solid var(--border)" }}>
      <path d={`${d} L 100 100 L 0 100 Z`} fill="rgba(255,75,75,0.18)" />
      <path d={d} fill="none" stroke="var(--accent-light, #ff7b7b)"
            strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// StimTab is exported by tab-Stim.jsx now

// ─── MultiAxisTab ─────────────────────────────────────────────────
// Generates secondary-axis funscripts (roll / pitch / twist / surge / sway)
// from the primary stroke (L0) by assigning a *position style* per phrase.
//
// Position styles (per docs/guide/multiaxis.md):
//   None · Cowgirl · Missionary · Doggy · Riding · Random
//
// Layout mirrors Edit:
//   Row 1  Chapter ribbon
//   Row 2  Phrase ribbon (colored by tag, dim = None style)
//   Row 3  Body — left rail (jump to phrase) | center (5 derived axes
//          stacked) | right (style picker panel)
function MultiAxisTab({ project, activeChapterId, setActiveChapterId,
                       selectedDevices }) {
  const chapters = project?.chapters || FF_DATA.CHAPTERS || [];
  const phrases  = project?.phrases  || FF_DATA.PHRASES  || [];
  const fmt = window.fmtTimeShort || ((s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`);

  const activeChap = chapters.find(c => c.id === activeChapterId) || chapters[0];
  const inScope = phrases.filter(p =>
    activeChap ? (p.chapterId === activeChap.id ||
                  (p.start >= activeChap.start && p.end <= activeChap.end))
               : true);

  const supportsTranslation = (selectedDevices || []).some(d => d === "sr6" || d === "osr2-plus") || true;

  const styles = [
    { id: "none",       label: "None",       short: "—",
      hint: "No secondary motion. Device stays centered. Use for stillness or transitions.",
      axes: { roll: 0, pitch: 0, twist: 0, surge: 0, sway: 0 } },
    { id: "cowgirl",    label: "Cowgirl",    short: "Rocking",
      hint: "Pitch follows stroke. Gentle roll sway grows with speed. Subtle twist.",
      axes: { roll: .35, pitch: .8, twist: .25, surge: 0, sway: 0 } },
    { id: "missionary", label: "Missionary", short: "Side-to-side",
      hint: "Roll dominant, driven by stroke velocity. Gentle pitch sine. No twist.",
      axes: { roll: .9, pitch: .4, twist: 0, surge: 0, sway: 0 } },
    { id: "doggy",      label: "Doggy",      short: "Forward",
      hint: "Pitch only — strongly biased forward on every stroke. Minimal other motion.",
      axes: { roll: 0, pitch: 1, twist: 0, surge: 0, sway: 0 } },
    { id: "riding",     label: "Riding",     short: "Circular (SR6)",
      hint: "Full circular motion. Roll + pitch wide. Twist random walk. Surge/sway slow drift.",
      axes: { roll: .85, pitch: .85, twist: .5, surge: .3, sway: .3 } },
    { id: "random",     label: "Random",     short: "Variety",
      hint: "All axes get independent random walks, modulated by stroke velocity.",
      axes: { roll: .55, pitch: .55, twist: .55, surge: .35, sway: .35 } },
  ];

  const axisDefs = [
    { id: "roll",  label: "Roll",  code: "R1", color: "#c77dff", trans: false },
    { id: "pitch", label: "Pitch", code: "R2", color: "#ff5470", trans: false },
    { id: "twist", label: "Twist", code: "R0", color: "#4dabf7", trans: false },
    { id: "surge", label: "Surge", code: "L1", color: "#ffb547", trans: true  },
    { id: "sway",  label: "Sway",  code: "L2", color: "#a3e635", trans: true  },
  ];

  const initialAssignments = {};
  phrases.forEach((p, i) => {
    const tagToStyle = {
      stingy:"cowgirl", drone:"missionary", crescendo:"riding",
      plateau:"doggy", stutter:"random", giggle:"cowgirl",
    };
    initialAssignments[p.id] = tagToStyle[p.tag || p.tagId] ||
      ["cowgirl","missionary","doggy","riding","none","random"][i % 6];
  });
  const [assignments, setAssignments] = misc(initialAssignments);
  const [activePhraseId, setActivePhraseId] = misc(inScope[0]?.id);

  React.useEffect(() => {
    if (!inScope.find(p => p.id === activePhraseId)) {
      setActivePhraseId(inScope[0]?.id);
    }
  }, [activeChap?.id]);

  const activePhrase = inScope.find(p => p.id === activePhraseId) || inScope[0];
  const activeStyleId = activePhrase ? (assignments[activePhrase.id] || "none") : "none";
  const activeStyle = styles.find(s => s.id === activeStyleId) || styles[0];

  const tagLabelFor = (p) => {
    const tag = (window.FF_TAGS || []).find(t => t.id === (p.tag || p.tagId));
    return tag?.label || "Untagged";
  };
  const tagColorFor = (p) => {
    const tag = (window.FF_TAGS || []).find(t => t.id === (p.tag || p.tagId));
    return tag?.color || "var(--text-dim)";
  };

  const totalMs = FF_DATA.TOTAL_MS;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>

      {/* Row 1 — Chapter ribbon */}
      <div style={{ background: "var(--surface)", padding: "10px 22px",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                         textTransform: "uppercase", letterSpacing: "0.08em",
                         width: 64, flexShrink: 0 }}>Chapters</span>
          <div style={{ flex: 1, display: "flex", height: 22, gap: 2 }}>
            {chapters.map(c => {
              const w = ((c.end - c.start) / totalMs) * 100;
              const active = c.id === activeChap?.id;
              return (
                <button key={c.id}
                        onClick={() => setActiveChapterId(c.id)}
                        title={c.title || c.name}
                        style={{
                          flex: `0 0 ${w}%`, height: "100%",
                          background: c.color || "#666",
                          opacity: active ? 1 : 0.32,
                          border: "none", borderRadius: 3, cursor: "pointer",
                          boxShadow: active ? "0 0 0 1.5px #fff inset" : "none",
                          display: "flex", alignItems: "center", padding: "0 6px",
                          fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                          color: active ? "#fff" : "rgba(255,255,255,0.7)",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{c.title || c.name}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 2 — Chapter funscript view (the big P1..PN view, like Edit) */}
      {activeChap && window.ChapterFunscriptView && (
        <div style={{ background: "var(--surface)", padding: "12px 22px 14px",
                      borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChap.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                {activeChap.title || activeChap.name}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
                {fmt(activeChap.start)}–{fmt(activeChap.end)} · {inScope.length} phrases
              </span>
            </div>
          </div>
          <window.ChapterFunscriptView
            chapter={activeChap}
            phrases={inScope}
            targetIds={new Set(activePhraseId ? [activePhraseId] : [])}
            focusPhraseId={activePhraseId}
            currentMs={null}
            onSeek={() => {}}
            onSelectPhrase={(pid) => setActivePhraseId(pid)}
          />
        </div>
      )}

      {/* Row 3 — Phrase ribbon (compact strip of phrase chips, colored by tag) */}
      <div style={{ background: "var(--surface)", padding: "10px 22px",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                         textTransform: "uppercase", letterSpacing: "0.08em",
                         width: 64, flexShrink: 0 }}>Phrases</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {inScope.length} in {activeChap?.title || activeChap?.name} · pick a position style per phrase
          </span>
          <div style={{ flex: 1 }} />
          <Button kind="ghost" size="sm" icon="wand-2"
            onClick={() => {
              const tagToStyle = {
                stingy:"cowgirl", drone:"missionary", crescendo:"riding",
                plateau:"doggy", stutter:"random", giggle:"cowgirl",
              };
              const next = { ...assignments };
              inScope.forEach(p => { next[p.id] = tagToStyle[p.tag || p.tagId] || "cowgirl"; });
              setAssignments(next);
            }}>Auto-assign by tag</Button>
          <Button kind="ghost" size="sm" icon="copy-plus"
            onClick={() => {
              const next = { ...assignments };
              inScope.forEach(p => { next[p.id] = activeStyleId; });
              setAssignments(next);
            }}>Apply {activeStyle.label} to all</Button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 64, flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", height: 16, gap: 1 }}>
            {inScope.map(ph => {
              const w = ((ph.end - ph.start) / Math.max(1, activeChap.end - activeChap.start)) * 100;
              const isFocus = ph.id === activePhraseId;
              const styleId = assignments[ph.id] || "none";
              const dim = styleId === "none";
              return (
                <button key={ph.id}
                        onClick={() => setActivePhraseId(ph.id)}
                        title={`${tagLabelFor(ph)} · ${styles.find(s=>s.id===styleId)?.label}`}
                        style={{
                          flex: `0 0 ${w}%`, height: "100%",
                          background: tagColorFor(ph),
                          opacity: dim ? 0.3 : (isFocus ? 1 : 0.7),
                          border: "none", borderRadius: 2, cursor: "pointer",
                          boxShadow: isFocus ? "0 0 0 1.5px #fff inset" : "none",
                        }} />
              );
            })}
          </div>
        </div>
      </div>

      {/* Body — rail | center | style panel */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

        {/* Left rail — jump to phrase */}
        <div style={{ width: 240, flexShrink: 0, overflow: "auto",
                      background: "var(--surface)", borderRight: "1px solid var(--border)" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                          textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Jump to phrase
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.4 }}>
              {inScope.length} phrases · style shown below tag
            </div>
          </div>
          {inScope.map((p, i) => {
            const sel = p.id === activePhraseId;
            const styleId = assignments[p.id] || "none";
            const sty = styles.find(s => s.id === styleId);
            return (
              <button key={p.id} onClick={() => setActivePhraseId(p.id)} style={{
                display: "grid", gridTemplateColumns: "22px 8px 1fr",
                alignItems: "center", gap: 8, width: "100%",
                padding: "9px 14px", border: "none",
                borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
                borderBottom: "1px solid var(--border)",
                background: sel ? "var(--surface-2)" : "transparent",
                color: "var(--text)", cursor: "pointer", textAlign: "left",
                fontFamily: "inherit",
              }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{String(i+1).padStart(2, "0")}</span>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: tagColorFor(p) }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: sel ? 700 : 500,
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {tagLabelFor(p)}
                  </div>
                  <div style={{ fontSize: 10.5, color: styleId === "none" ? "var(--text-dim)" : "var(--accent-light, #ff7b7b)",
                                fontWeight: 600 }}>
                    {sty?.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Center — current phrase + 5 derived axes */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>
          {activePhrase && (() => {
            const idx = inScope.findIndex(x => x.id === activePhrase.id);
            const prev = idx > 0 ? inScope[idx - 1] : null;
            const nxt  = idx < inScope.length - 1 ? inScope[idx + 1] : null;
            return (
              <>
                {/* Phrase header — mirrors Edit single-phrase header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    phrase {idx + 1} of {inScope.length}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>·</span>
                  <Pill tone="neutral">
                    <span style={{ width: 8, height: 8, borderRadius: 2,
                                   background: tagColorFor(activePhrase), marginRight: 6 }} />
                    {tagLabelFor(activePhrase)}
                  </Pill>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {fmt(activePhrase.start)} · {(activePhrase.end - activePhrase.start).toFixed(1)}s
                    {activePhrase.bpm ? ` · ${activePhrase.bpm} BPM` : ""}
                  </span>
                  <div style={{ flex: 1 }} />
                  <Pill tone="accent">
                    <Icon name="axis-3d" size={11} style={{ marginRight: 4 }} />
                    {activeStyle.label}
                  </Pill>
                </div>

                <SectionLabel right={<span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  derived from L0 stroke
                </span>}>
                  Generated axes · {activeStyle.label}
                </SectionLabel>

                <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                  {axisDefs.map(ax => {
                    const amount = activeStyle.axes[ax.id];
                    const greyed = ax.trans && !supportsTranslation;
                    const off = amount === 0;
                    return (
                      <div key={ax.id} style={{
                        display: "grid", gridTemplateColumns: "120px 1fr 60px",
                        alignItems: "center", gap: 12,
                        padding: "10px 14px",
                        background: "var(--surface)",
                        border: "1px solid var(--border)", borderRadius: 8,
                        opacity: greyed ? 0.4 : (off ? 0.55 : 1),
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: ax.color }} />
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ax.label}</div>
                            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                              {ax.code}{ax.trans ? " · SR6 only" : ""}
                            </div>
                          </div>
                        </div>
                        <DerivedAxisChart color={ax.color} amount={greyed ? 0 : amount}
                                          axisId={ax.id} phraseId={activePhrase.id}
                                          styleId={activeStyle.id} />
                        <span className="mono" style={{ fontSize: 11,
                                                         color: off ? "var(--text-dim)" : "var(--text)",
                                                         textAlign: "right" }}>
                          {off ? "—" : `${Math.round(amount * 100)}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {prev && <Button kind="ghost" size="sm" icon="chevron-left"
                          onClick={() => setActivePhraseId(prev.id)}>Prev phrase</Button>}
                  <div style={{ flex: 1 }} />
                  {nxt && <Button kind="ghost" size="sm" icon="chevron-right" iconRight
                          onClick={() => setActivePhraseId(nxt.id)}>Next phrase</Button>}
                </div>
              </>
            );
          })()}
        </div>

        {/* Right — style picker panel */}
        <div style={{ width: 320, flexShrink: 0, overflow: "auto",
                      background: "var(--surface)", borderLeft: "1px solid var(--border)",
                      padding: "16px 18px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.08em",
                        marginBottom: 4 }}>
            Position style
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.4 }}>
            Applied to phrase {(inScope.findIndex(x => x.id === activePhraseId)) + 1}.
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {styles.map(s => {
              const sel = s.id === activeStyleId;
              return (
                <button key={s.id}
                  onClick={() => setAssignments({ ...assignments, [activePhraseId]: s.id })}
                  style={{
                    textAlign: "left", padding: "10px 12px", borderRadius: 6,
                    background: sel ? "rgba(255,75,75,0.08)" : "var(--bg)",
                    border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                    color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
                  }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{s.label}</span>
                    <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{s.short}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                    {s.hint}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: "10px 12px",
                        background: "var(--bg)", border: "1px solid var(--border)",
                        borderRadius: 6, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Icon name="info" size={13} style={{ color: "var(--text-dim)", marginTop: 2 }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
              All five axes are derived algorithmically from the L0 stroke at export.
              Surge &amp; sway only export to SR6-class devices.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
window.MultiAxisTab = MultiAxisTab;


// Single axis preview — shape varies by axis to suggest its character.
function DerivedAxisChart({ color, amount, axisId, phraseId, styleId }) {
  if (amount === 0) {
    return (
      <svg viewBox="0 0 100 30" preserveAspectRatio="none"
           style={{ width: "100%", height: 36, background: "var(--bg)", borderRadius: 4 }}>
        <line x1="0" y1="15" x2="100" y2="15" stroke="var(--border)"
              strokeDasharray="3 3" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  // Deterministic shape per (axis, phrase, style)
  const seed = `${axisId}-${phraseId}-${styleId}`;
  let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffff) / 65535; };
  const N = 60, pts = [];
  // Different axis "characters":
  //  pitch — biased one way (DC offset)
  //  roll  — symmetric oscillation
  //  twist — random walk
  //  surge/sway — slow drift
  const character = {
    pitch:  { freq: 6,  jitter: 0.1, drift: 0.6 },
    roll:   { freq: 8,  jitter: 0.15, drift: 0   },
    twist:  { freq: 3,  jitter: 0.45, drift: 0   },
    surge:  { freq: 1.5,jitter: 0.05, drift: 0   },
    sway:   { freq: 1.2,jitter: 0.05, drift: 0   },
  }[axisId] || { freq: 5, jitter: 0.2, drift: 0 };

  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let v = Math.sin(t * character.freq * Math.PI * 2 + rand() * 0.5);
    v += (rand() - 0.5) * character.jitter * 2;
    v += character.drift * (t - 0.5);
    v *= amount;          // scale by style amount
    pts.push([t * 100, 15 - v * 12]);
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none"
         style={{ width: "100%", height: 36, background: "var(--bg)", borderRadius: 4 }}>
      <line x1="0" y1="15" x2="100" y2="15" stroke="var(--border)"
            strokeDasharray="3 3" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.4}
            vectorEffect="non-scaling-stroke" />
    </svg>
  );
}


// ─── CatalogTab ───────────────────────────────────────────────────
// Two-pane reference: left = transform list grouped by category, right =
// long-form documentation + sandbox where you can test parameters on a
// canned signal.
function CatalogTab() {
  const [selected, setSelected] = misc("amplitude_scale");
  const [search, setSearch] = misc("");
  const [category, setCategory] = misc("all"); // all | tone | behavior | structural
  const tx = (window.FF_TRANSFORMS || []).find(t => t.id === selected);

  // Counts per category (for the top cards)
  const counts = miscMemo(() => {
    const all = window.FF_TRANSFORMS || [];
    return {
      all:        all.length,
      tone:       all.filter(t => t.category === "tone").length,
      behavior:   all.filter(t => t.category === "behavior").length,
      structural: all.filter(t => t.category === "structural").length,
    };
  }, []);

  const categoryCards = [
    { id: "all",        label: "All transforms", color: "#94a3b8",
      desc: "Browse the entire catalog of " + counts.all + " transforms.",
      icon: "library" },
    { id: "tone",       label: "Tones",          color: "#ff5470",
      desc: "Set chapter mood. Soft / Build / Tease / Edge / Climax / Dominant.",
      icon: "flame" },
    { id: "behavior",   label: "Behaviors",      color: "#4dabf7",
      desc: "Non-destructive shape edits. Beat-preserving — safe to chain.",
      icon: "wand-2" },
    { id: "structural", label: "Structurals",    color: "#ffb547",
      desc: "Destructive structure rewrites. Replace the beat. Use sparingly.",
      icon: "construction" },
  ];

  const groups = miscMemo(() => {
    const all = window.FF_TRANSFORMS || [];
    const byCat = {};
    all.forEach(t => {
      if (category !== "all" && t.category !== category) return;
      if (search && !t.label.toLowerCase().includes(search.toLowerCase())) return;
      (byCat[t.category] = byCat[t.category] || []).push(t);
    });
    return [
      { id: "tone",       label: "Tones",                  items: byCat.tone       || [] },
      { id: "behavior",   label: "Behavioral transforms",  items: byCat.behavior   || [] },
      { id: "structural", label: "Structural transforms",  items: byCat.structural || [] },
    ];
  }, [search, category]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Category cards */}
      <div style={{ padding: "18px 24px 14px", background: "var(--bg)",
                    borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      marginBottom: 10 }}>
          Catalog · {counts.all} transforms
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {categoryCards.map(c => {
            const sel = c.id === category;
            const n = counts[c.id];
            return (
              <button key={c.id} onClick={() => setCategory(c.id)} style={{
                display: "flex", flexDirection: "column", gap: 6,
                padding: "12px 14px", borderRadius: 8,
                background: sel ? c.color + "1c" : "var(--surface)",
                border: `1.5px solid ${sel ? c.color : "var(--border)"}`,
                color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
                textAlign: "left",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name={c.icon} size={14} style={{ color: c.color }} />
                  <span style={{ fontSize: 13, fontWeight: 700,
                                 color: sel ? c.color : "var(--text)" }}>{c.label}</span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 11, fontWeight: 600,
                                                  color: "var(--text-dim)" }}>{n}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>
                  {c.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Left pane */}
      <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column",
                    background: "var(--surface)", borderRight: "1px solid var(--border)" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <TextInput value={search} onChange={setSearch}
                     placeholder="Search transforms…" />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {groups.map(g => (
            <div key={g.id}>
              <div style={{ padding: "12px 16px 6px",
                            fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                            textTransform: "uppercase", letterSpacing: "0.08em",
                            background: "var(--bg)" }}>
                {g.label} <span style={{ color: "var(--text-dim)" }}>· {g.items.length}</span>
              </div>
              {g.items.map(t => {
                const sel = t.id === selected;
                return (
                  <button key={t.id} onClick={() => setSelected(t.id)} style={{
                    display: "flex", flexDirection: "column", gap: 2, width: "100%",
                    padding: "9px 16px", border: "none",
                    borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
                    background: sel ? "var(--surface-2)" : "transparent",
                    color: "var(--text)", cursor: "pointer", textAlign: "left",
                    fontFamily: "inherit",
                  }}>
                    <span style={{ fontSize: 12.5, fontWeight: sel ? 700 : 500 }}>{t.label}</span>
                    <span style={{ fontSize: 10.5, color: "var(--text-dim)",
                                   overflow: "hidden", textOverflow: "ellipsis",
                                   whiteSpace: "nowrap" }}>{t.summary}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <div style={{ padding: "16px", borderTop: "1px solid var(--border)" }}>
            <Button kind="ghost" size="sm" icon="plus">New transform…</Button>
          </div>
        </div>
      </div>

      {/* Right pane */}
      <div style={{ flex: 1, overflow: "auto", padding: "26px 32px", background: "var(--bg)" }}>
        {tx && (
          <>
            <Pill tone="info" style={{ marginBottom: 10 }}>{tx.category}</Pill>
            <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 700,
                         letterSpacing: "-0.01em" }}>{tx.label}</h1>
            <p style={{ margin: "0 0 22px", fontSize: 14, color: "var(--text-muted)",
                        lineHeight: 1.55, maxWidth: 720 }}>{tx.description}</p>

            {tx.bestFor && tx.bestFor.length > 0 && (
              <>
                <SectionLabel>Best for</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
                  {tx.bestFor.map(tagId => {
                    const tg = (window.FF_TAGS || []).find(t => t.id === tagId);
                    return (
                      <Pill key={tagId} tone="neutral">
                        <span style={{ width: 8, height: 8, borderRadius: 2,
                                       background: tg?.color, marginRight: 6 }} />
                        {tg?.label || tagId}
                      </Pill>
                    );
                  })}
                </div>
              </>
            )}

            {tx.params.length > 0 && (
              <>
                <SectionLabel>Parameters</SectionLabel>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                              borderRadius: 8, overflow: "hidden", marginBottom: 22 }}>
                  {tx.params.map((p, i) => (
                    <div key={p.id} style={{
                      display: "grid", gridTemplateColumns: "180px 80px 80px 1fr",
                      gap: 14, padding: "10px 16px", alignItems: "baseline",
                      borderBottom: i === tx.params.length - 1 ? "none" : "1px solid var(--border)",
                      fontSize: 12,
                    }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{p.label}</span>
                      <span className="mono" style={{ color: "var(--text-dim)" }}>
                        {p.min}–{p.max}
                      </span>
                      <span className="mono" style={{ color: "var(--text-dim)" }}>
                        default {p.default}{p.unit || ""}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>{p.hint || "—"}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <SectionLabel>Sandbox · try it on a canned phrase</SectionLabel>
            <CatalogSandbox transform={tx} />
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function CatalogSandbox({ transform }) {
  const [params, setParams] = misc(() => {
    const out = {};
    transform.params.forEach(p => { out[p.id] = p.default; });
    return out;
  });
  // Reset on transform switch
  React.useEffect(() => {
    const out = {};
    transform.params.forEach(p => { out[p.id] = p.default; });
    setParams(out);
  }, [transform.id]);

  // Canned phrase
  const phrase = { id: "sandbox", start: 0, end: 8000, bpm: 90, tag: null };
  const original = miscMemo(() => {
    const out = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 23) * phrase.end;
      const v = 50 + 28 * Math.sin(i * 0.85) + (i % 4 === 0 ? -8 : 0);
      out.push({ at: Math.round(t), pos: Math.round(Math.max(5, Math.min(95, v))) });
    }
    return out;
  }, []);
  const preview = miscMemo(
    () => (window.transformActions || ((a) => a))(original, transform.id, params, phrase),
    [original, transform.id, params]
  );

  return (
    <Card padding={16}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        marginBottom: 6 }}>Original</div>
          <Sparkline actions={original} start={phrase.start} end={phrase.end}
                     color="var(--text-dim)" filled height={60} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        marginTop: 12, marginBottom: 6 }}>
            After {transform.label}
          </div>
          <Sparkline actions={preview} start={phrase.start} end={phrase.end}
                     color="var(--accent-light, #ff7b7b)" filled height={60} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {transform.params.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
              No parameters — this transform applies as-is.
            </div>
          )}
          {transform.params.map(p => (
            <Slider key={p.id} label={p.label}
                    valueLabel={`${params[p.id]}${p.unit || ""}`}
                    value={params[p.id]} min={p.min} max={p.max} step={p.step}
                    onChange={(v) => setParams(s => ({ ...s, [p.id]: v }))} />
          ))}
        </div>
      </div>
    </Card>
  );
}
window.CatalogTab = CatalogTab;
