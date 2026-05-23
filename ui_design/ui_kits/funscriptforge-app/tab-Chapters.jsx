// ChaptersTab — pick a chapter, set its tone.
//
// Tone is a chapter-scoped bias. The user sets the emotional arc of each
// chapter here BEFORE going to the Edit tab. Each chapter gets exactly one
// tone (Tender, Build, Tease, Edge, Climax, Dominant) which biases the
// per-phrase suggestions downstream.
//
// Layout:
//   Top:    full-script chart with chapter bands
//   Left:   chapter list (rail)
//   Right:  selected chapter detail — name, time, phrase count, tone picker
//           with 6 cards, and a phrase preview ribbon scoped to chapter.

const { useState: chTState, useMemo: chTMemo } = React;

// Each tone has 1–2 tone-specific parameters identified by data analysis as
// the highest-impact knobs for that emotional shape. Plus a universal Impact
// slider (0..1) that mixes the toned curve toward the original.
const FF_TONES = [
  { id: "tender",   label: "Tender",    color: "#8b9bff",
    desc: "Soft, slow, intimate. Low BPM ceiling, gentle contrast.",
    params: [
      { id: "ceiling", label: "Speed ceiling", min: 60, max: 180, step: 5, def: 110,
        fmt: (v) => `${v}/s`, tip: "Caps action speed. Lower = gentler, slower." },
      { id: "softness", label: "Edge softness", min: 0, max: 1, step: 0.05, def: 0.55,
        fmt: (v) => v.toFixed(2), tip: "Smooths transitions between actions." },
    ],
  },
  { id: "build",    label: "Build",     color: "#4dabf7",
    desc: "Gradual escalation. Amplitude grows phrase over phrase.",
    params: [
      { id: "ramp", label: "Ramp curve", min: 0, max: 1, step: 0.05, def: 0.65,
        fmt: (v) => v.toFixed(2), tip: "0 = linear, 1 = steep late ramp." },
      { id: "headroom", label: "End headroom", min: 0, max: 30, step: 1, def: 12,
        fmt: (v) => `${v}%`, tip: "Reserves amplitude so Climax has room." },
    ],
  },
  { id: "tease",    label: "Tease",     color: "#c77dff",
    desc: "Patient, withholding. Holds back contrast for later release.",
    params: [
      { id: "withhold", label: "Withhold strength", min: 0, max: 1, step: 0.05, def: 0.7,
        fmt: (v) => v.toFixed(2), tip: "How aggressively to suppress peaks." },
      { id: "release", label: "Release point", min: 0.4, max: 0.95, step: 0.05, def: 0.8,
        fmt: (v) => v.toFixed(2), tip: "When in chapter to allow release (0..1)." },
    ],
  },
  { id: "edge",     label: "Edge",      color: "#ffb547",
    desc: "Sustained intensity at the threshold. High variance, no payoff.",
    params: [
      { id: "hold", label: "Hold intensity", min: 0, max: 1, step: 0.05, def: 0.7,
        fmt: (v) => v.toFixed(2), tip: "How tight the threshold band stays." },
      { id: "drop", label: "Drop point", min: 0.5, max: 1, step: 0.05, def: 0.85,
        fmt: (v) => v.toFixed(2), tip: "Position to relax — no payoff before this." },
    ],
  },
  { id: "climax",   label: "Climax",    color: "#ff5470",
    desc: "Peak BPM and contrast. Short, dense, uncompromising.",
    params: [
      { id: "density", label: "Action density", min: 0.5, max: 2, step: 0.05, def: 1.4,
        fmt: (v) => `${v.toFixed(2)}×`, tip: "Multiplier on action count vs. source." },
      { id: "contrast", label: "Contrast boost", min: 0, max: 1, step: 0.05, def: 0.75,
        fmt: (v) => v.toFixed(2), tip: "Pushes peaks/valleys further apart." },
    ],
  },
  { id: "dominant", label: "Dominant",  color: "#ff8c47",
    desc: "Demanding rhythm, hard contrast, strong recenter pressure.",
    params: [
      { id: "recenter", label: "Recenter pressure", min: 0, max: 1, step: 0.05, def: 0.6,
        fmt: (v) => v.toFixed(2), tip: "Pulls actions toward forced midpoint." },
      { id: "rhythm", label: "Rhythm rigidity", min: 0, max: 1, step: 0.05, def: 0.55,
        fmt: (v) => v.toFixed(2), tip: "How locked-in the cadence becomes." },
    ],
  },
];

// Default tone params per chapter
function defaultToneParams() {
  const out = {};
  FF_TONES.forEach(t => {
    out[t.id] = { impact: 1.0 };
    t.params.forEach(p => { out[t.id][p.id] = p.def; });
  });
  return out;
}

// Synthesize a "before" curve scoped to a chapter from FF_DATA actions
function buildBeforeCurve(chapter, points = 240) {
  const acts = FF_DATA.ACTIONS.filter(a => a.at >= chapter.start && a.at <= chapter.end);
  if (acts.length < 2) return [];
  const out = [];
  for (let i = 0; i < points; i++) {
    const t = chapter.start + (i / (points - 1)) * (chapter.end - chapter.start);
    // nearest neighbor with light interp
    let prev = acts[0], next = acts[acts.length - 1];
    for (let j = 0; j < acts.length - 1; j++) {
      if (acts[j].at <= t && acts[j + 1].at >= t) { prev = acts[j]; next = acts[j + 1]; break; }
    }
    const span = Math.max(1, next.at - prev.at);
    const f = (t - prev.at) / span;
    out.push({ t: i / (points - 1), v: prev.pos + (next.pos - prev.pos) * f });
  }
  return out;
}

// Apply a tone with its params to the before curve. Returns [{t,v}].
function applyToneCurve(before, tone, params) {
  if (!before.length) return before;
  const impact = params.impact ?? 1;
  const C = (v) => Math.max(0, Math.min(100, v));
  const out = before.map((pt, i, arr) => {
    let v = pt.v;
    if (tone.id === "tender") {
      // soften peaks toward 50, low-pass via neighbor avg
      const prev = arr[Math.max(0, i - 2)].v, next = arr[Math.min(arr.length - 1, i + 2)].v;
      const smoothed = (prev + v * 2 + next) / 4;
      const ceilingPull = (params.ceiling - 110) / 70; // ~-0.7..1
      v = smoothed - (smoothed - 50) * (0.25 - ceilingPull * 0.1);
      v = v - (v - 50) * params.softness * 0.35;
    } else if (tone.id === "build") {
      const ramp = pt.t ** (1 - params.ramp * 0.7 + 0.3);
      const cap = 100 - params.headroom;
      v = 50 + (v - 50) * (0.4 + ramp * 0.85);
      if (v > cap) v = cap;
    } else if (tone.id === "tease") {
      const before = pt.t < params.release;
      if (before) v = 50 + (v - 50) * (1 - params.withhold * 0.7);
      else v = 50 + (v - 50) * (1 + params.withhold * 0.5);
    } else if (tone.id === "edge") {
      const hold = params.hold;
      const inHold = pt.t < params.drop;
      if (inHold) {
        // compress around 70 with high-frequency tremor preserved
        v = 70 + (v - 50) * (1 - hold * 0.55);
      } else {
        v = v - (v - 50) * 0.35;
      }
    } else if (tone.id === "climax") {
      v = 50 + (v - 50) * (1 + params.contrast * 0.85);
      // density visualization: bias toward extremes
      const sgn = v >= 50 ? 1 : -1;
      v += sgn * (params.density - 1) * 8;
    } else if (tone.id === "dominant") {
      v = v - (v - 50) * params.recenter * 0.5;
      const beat = Math.sin(pt.t * Math.PI * 18) * params.rhythm * 14;
      v = 50 + (v - 50) * (1 + params.rhythm * 0.3) + beat * 0.4;
    }
    // mix toward original by impact
    v = pt.v + (v - pt.v) * impact;
    return { t: pt.t, v: C(v) };
  });
  return out;
}

function ChaptersTab({ scope, onScopeChange, currentMs, onSeek }) {
  const chapters = FF_DATA.CHAPTERS;
  const [activeId, setActiveId] = chTState(scope !== "all" ? scope : chapters[0].id);
  const [tones, setTones] = chTState(() => ({
    ch1: "tender", ch2: "build", ch3: "edge", ch4: "tender",
  }));
  // Per-chapter tone params: { ch1: { tender: {impact:1,ceiling:110,...}, build:{...}, ... }, ... }
  const [paramsByChapter, setParamsByChapter] = chTState(() => {
    const out = {};
    chapters.forEach(c => { out[c.id] = defaultToneParams(); });
    return out;
  });

  const active = chapters.find(c => c.id === activeId) ?? chapters[0];
  const phrasesIn = chTMemo(
    () => FF_DATA.PHRASES.filter(p => p.chapterId === active.id),
    [active.id]
  );
  const tone = FF_TONES.find(t => t.id === tones[active.id]) ?? FF_TONES[0];
  const toneParams = paramsByChapter[active.id]?.[tone.id] ?? {};

  const setParam = (key, val) => {
    setParamsByChapter(s => ({
      ...s,
      [active.id]: {
        ...s[active.id],
        [tone.id]: { ...s[active.id][tone.id], [key]: val },
      },
    }));
  };

  const before = chTMemo(() => buildBeforeCurve(active), [active.id]);
  const after = chTMemo(() => applyToneCurve(before, tone, toneParams),
                        [before, tone.id, JSON.stringify(toneParams)]);

  // Stat changes
  const stats = chTMemo(() => {
    if (!before.length) return null;
    const avg = (arr) => arr.reduce((s, p) => s + p.v, 0) / arr.length;
    const speed = (arr) => {
      let s = 0;
      for (let i = 1; i < arr.length; i++) s += Math.abs(arr[i].v - arr[i - 1].v);
      return Math.round(s);
    };
    const range = (arr) => {
      const lo = Math.min(...arr.map(p => p.v)), hi = Math.max(...arr.map(p => p.v));
      return [Math.round(lo), Math.round(hi)];
    };
    const cv = (arr) => {
      const m = avg(arr);
      const variance = arr.reduce((s, p) => s + (p.v - m) ** 2, 0) / arr.length;
      return Math.sqrt(variance) / Math.max(1, m);
    };
    return {
      bSpeed: speed(before), aSpeed: speed(after),
      bRange: range(before), aRange: range(after),
      bCV: cv(before), aCV: cv(after),
    };
  }, [before, after]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: "var(--bg)" }}>

        <TabHeader eyebrow="Chapters & tone" title="Set the emotional arc"
          subtitle="Each chapter gets one tone. Tone is a script-wide bias that shapes the phrase-level suggestions on the Edit tab — set the stage here, refine per-phrase next." />

        {/* Full script with chapter bands */}
        <SectionLabel>Script overview · click a chapter to focus</SectionLabel>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <ScriptChart actions={FF_DATA.ACTIONS} phrases={FF_DATA.PHRASES}
                       totalMs={FF_DATA.TOTAL_MS} startMs={0} endMs={FF_DATA.TOTAL_MS}
                       currentMs={currentMs} onSeek={onSeek}
                       height={140} showPhraseTags={false} showActions="auto" />
          <div style={{ height: 6 }} />
          <ChapterBands chapters={chapters} totalMs={FF_DATA.TOTAL_MS}
                        tones={tones} activeId={activeId}
                        onSelect={setActiveId} onSeek={onSeek} />
        </div>

        {/* Two-column: left rail (chapter list) + right detail (tone picker) */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 18 }}>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: 8, overflow: "hidden", alignSelf: "start" }}>
            <div style={{ padding: "12px 14px", fontSize: 10, fontWeight: 700,
                          color: "var(--text-dim)", textTransform: "uppercase",
                          letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
              Chapters · {chapters.length}
            </div>
            {chapters.map((c, i) => {
              const sel = c.id === activeId;
              const t = FF_TONES.find(x => x.id === tones[c.id]);
              const count = FF_DATA.PHRASES.filter(p => p.chapterId === c.id).length;
              return (
                <button key={c.id} onClick={() => setActiveId(c.id)} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "12px 14px", border: "none",
                  borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
                  borderBottom: i < chapters.length - 1 ? "1px solid var(--border)" : "none",
                  background: sel ? "var(--surface-2)" : "transparent",
                  color: "var(--text)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                }}>
                  <span style={{ width: 4, height: 36, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: sel ? 700 : 600 }}>{c.title}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>
                      {fmtTimeShort(c.start)}–{fmtTimeShort(c.end)} · {count} phrases
                    </div>
                  </div>
                  {t && (
                    <Pill tone="neutral" style={{ background: t.color + "22", color: t.color, borderColor: t.color + "55" }}>
                      {t.label}
                    </Pill>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right detail */}
          <div>
            {/* Active chapter header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: active.color }} />
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{active.title}</h2>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {fmtTimeShort(active.start)}–{fmtTimeShort(active.end)} · {phrasesIn.length} phrases
              </span>
              <div style={{ flex: 1 }} />
              <Button kind="ghost" size="sm" icon="play"
                      onClick={() => onSeek?.(active.start)}>Play chapter</Button>
              <Button kind="secondary" size="sm" icon="arrow-right"
                      onClick={() => onScopeChange?.(active.id)}>
                Edit phrases →
              </Button>
            </div>

            {/* Tone picker — 6 cards (compact one-row strip) */}
            <SectionLabel>Tone · {tone.label}</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
                          gap: 6, marginBottom: 16 }}>
              {FF_TONES.map(t => {
                const sel = t.id === tone.id;
                return (
                  <button key={t.id}
                          onClick={() => setTones(s => ({ ...s, [active.id]: t.id }))}
                          title={t.desc}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "8px 10px", borderRadius: 6,
                            background: sel ? t.color + "22" : "var(--surface)",
                            border: `1.5px solid ${sel ? t.color : "var(--border)"}`,
                            color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
                          }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 700,
                                   color: sel ? t.color : "var(--text)" }}>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tone params + before/after preview */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 8, padding: 16, marginBottom: 18,
            }}>
              {/* Top row: Impact slider full width */}
              <ToneSlider
                label="Impact — how much of this tone to apply"
                value={toneParams.impact ?? 1}
                min={0} max={1} step={0.01}
                fmt={(v) => v.toFixed(2)} accent={tone.color}
                onChange={(v) => setParam("impact", v)}
                tip="Mixes the toned curve toward the original. 0 = no change, 1 = full tone."
              />

              {/* Tone-specific sliders — two-up grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
                            gap: 18, marginTop: 12 }}>
                {tone.params.map(p => (
                  <ToneSlider key={p.id}
                    label={p.label}
                    value={toneParams[p.id] ?? p.def}
                    min={p.min} max={p.max} step={p.step}
                    fmt={p.fmt} accent={tone.color} tip={p.tip}
                    onChange={(v) => setParam(p.id, v)}
                  />
                ))}
              </div>

              <div style={{ height: 1, background: "var(--border)", margin: "16px 0 14px" }} />

              {/* Before / After charts on the same line */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <TonePreviewChart title="Before" subtitle="device-aware"
                              points={before} color="#5a8eff" />
                <TonePreviewChart title="After"
                              subtitle={`${tone.label} (impact ${Math.round((toneParams.impact ?? 1) * 100)}%) · device aware`}
                              points={after} color={tone.color} />
              </div>

              {/* Stat deltas */}
              {stats && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
                              gap: 10, marginTop: 14 }}>
                  <DeltaStat label="Avg speed" before={stats.bSpeed} after={stats.aSpeed} />
                  <DeltaStat label="Range"
                             before={`${stats.bRange[0]}–${stats.bRange[1]}`}
                             after={`${stats.aRange[0]}–${stats.aRange[1]}`} />
                  <DeltaStat label="CV" before={stats.bCV.toFixed(2)} after={stats.aCV.toFixed(2)} />
                  <DeltaStat label="Actions" before={`${phrasesIn.reduce((s, p) => s + (p.actionCount || 0), 0) || 2211}`} />
                  <DeltaStat label="Tone" before={`${tone.label} @ ${Math.round((toneParams.impact ?? 1) * 100)}%`} accent={tone.color} />
                </div>
              )}
            </div>

            {/* Chapter ribbon (phrases inside this chapter) */}
            <SectionLabel>Phrases inside {active.title}</SectionLabel>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                          borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <PhraseRibbon phrases={phrasesIn} totalMs={FF_DATA.TOTAL_MS}
                            currentMs={currentMs} />
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-dim)",
                            lineHeight: 1.5 }}>
                <Icon name="info" size={11} style={{ verticalAlign: "-1px", marginRight: 5 }} />
                Setting tone <strong style={{ color: tone.color }}>{tone.label}</strong> biases the
                suggested transforms for these {phrasesIn.length} phrases when you open them in Edit.
                It does <em>not</em> change the funscript directly — phrase-level changes happen on the next tab.
              </div>
            </div>

            {/* Quick stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <ChStat label="Tone" value={tone.label} hint="chapter bias" color={tone.color} />
              <ChStat label="Phrases" value={phrasesIn.length}
                       hint={`${phrasesIn.filter(p => p.tag).length} tagged`} />
              <ChStat label="Avg BPM" value={
                phrasesIn.length ? Math.round(phrasesIn.reduce((s, p) => s + p.bpm, 0) / phrasesIn.length) : "—"
              } hint="across phrases" />
              <ChStat label="Duration" value={fmtTimeShort(active.end - active.start)}
                       hint={`${Math.round(((active.end - active.start) / FF_DATA.TOTAL_MS) * 100)}% of script`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chapter band strip with tone color overlay
function ChapterBands({ chapters, totalMs, tones, activeId, onSelect, onSeek }) {
  return (
    <div style={{ display: "flex", height: 32, gap: 2, position: "relative" }}>
      {chapters.map(c => {
        const t = FF_TONES.find(x => x.id === tones[c.id]);
        const sel = c.id === activeId;
        const w = ((c.end - c.start) / totalMs) * 100;
        return (
          <button key={c.id}
                  onClick={() => { onSelect?.(c.id); onSeek?.(c.start); }}
                  style={{
                    flex: `0 0 ${w}%`, height: "100%",
                    background: t ? t.color + (sel ? "" : "aa") : c.color,
                    border: sel ? "2px solid #fff" : "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 4, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0 8px", fontFamily: "inherit", color: "#0e1117",
                    fontSize: 10.5, fontWeight: 700, overflow: "hidden",
                  }}>
            <span style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
              {c.title}
            </span>
            {t && <span style={{ fontSize: 9, opacity: 0.7 }}>{t.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Tone-tinted slider with label, value badge, and tip icon
function ToneSlider({ label, value, min, max, step, fmt, accent, tip, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>
          {label}
        </div>
        {tip && (
          <span title={tip} style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 14, height: 14, borderRadius: "50%",
            border: "1px solid var(--border-strong)", color: "var(--text-dim)",
            fontSize: 9, fontWeight: 700, cursor: "help",
          }}>?</span>
        )}
      </div>
      <div style={{ position: "relative", height: 22 }}>
        <div style={{
          position: "absolute", top: 9, left: 0, right: 0, height: 4,
          background: "var(--surface-2)", borderRadius: 2,
        }} />
        <div style={{
          position: "absolute", top: 9, left: 0, width: `${pct}%`, height: 4,
          background: accent, borderRadius: 2,
        }} />
        <input type="range" min={min} max={max} step={step} value={value}
               onChange={(e) => onChange(parseFloat(e.target.value))}
               style={{
                 position: "absolute", inset: 0, width: "100%", height: "100%",
                 opacity: 0, cursor: "pointer", margin: 0,
               }} />
        <div style={{
          position: "absolute", top: 3, left: `calc(${pct}% - 8px)`,
          width: 16, height: 16, borderRadius: "50%", background: accent,
          boxShadow: "0 1px 4px rgba(0,0,0,0.4)", pointerEvents: "none",
        }} />
        <div className="mono" style={{
          position: "absolute", top: -2, right: 0,
          fontSize: 11, fontWeight: 700, color: accent,
        }}>{fmt(value)}</div>
      </div>
    </div>
  );
}

// Compact before/after curve chart (local — do NOT rename to PreviewChart
// because that's a global from Charts.jsx and Babel top-level functions clobber.)
function TonePreviewChart({ title, subtitle, points, color }) {
  const W = 340, H = 110, P = 22;
  const path = points.length ? points.map((p, i) => {
    const x = P + (p.t) * (W - P * 2);
    const y = P + (1 - p.v / 100) * (H - P * 2);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") : "";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>— {subtitle}</div>
      </div>
      <div style={{ background: "var(--surface-2)", borderRadius: 6,
                    border: "1px solid var(--border)", padding: 4 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
          {[0, 25, 50, 75, 100].map(y => (
            <line key={y} x1={P} x2={W - P}
                  y1={P + (1 - y / 100) * (H - P * 2)}
                  y2={P + (1 - y / 100) * (H - P * 2)}
                  stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2,3" />
          ))}
          {[0, 50, 100].map(y => (
            <text key={y} x={4}
                  y={P + (1 - y / 100) * (H - P * 2) + 3}
                  fontSize={8} fill="var(--text-dim)" fontFamily="ui-monospace, monospace">{y}</text>
          ))}
          <path d={path} fill="none" stroke={color} strokeWidth={1.5}
                strokeLinejoin="round" strokeLinecap="round" />
          <path d={`${path} L ${W - P} ${H - P} L ${P} ${H - P} Z`}
                fill={color} fillOpacity={0.15} />
        </svg>
      </div>
    </div>
  );
}

function DeltaStat({ label, before, after, accent }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 4,
                                     color: accent || "var(--text)",
                                     whiteSpace: "nowrap", overflow: "hidden",
                                     textOverflow: "ellipsis" }}>
        {after !== undefined ? <>{before} <span style={{ color: "var(--text-dim)" }}>→</span> {after}</> : before}
      </div>
    </div>
  );
}

function ChStat({ label, value, hint, color }) {
  return (
    <div style={{ padding: "12px 14px", background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

window.ChaptersTab = ChaptersTab;
window.FF_TONES = FF_TONES;
