// StimTab — redesign per feedback m0117.
//
// Layout:
//   1. Incoming script ribbon at top, with chapter blocks overlaid.
//      Active chapter block is highlighted (lighter shading).
//   2. Two-column middle: per-chapter list on the left,
//      character sliders for the active chapter on the right.
//   3. 9-channel preview grid below.
//      Grid only redraws when user clicks Preview or Accept
//      (params staged separately from "applied" params).

const { useState: stState, useMemo: stMemo } = React;

const FF_STIM_CHARS = [
  { id: "gentle",       label: "Gentle",        color: "#4dabf7",
    tagline: "Soft, slow-building",
    desc: "Narrow electrode arc, soft pulse onset. Intensity builds gradually.",
    sliders: [
      { id: "warmup",  label: "Warm-up duration",   leftHint: "instant", rightHint: "long ramp",
        min: 0, max: 120, step: 5, default: 60, unit: "s" },
      { id: "softness", label: "Pulse softness",    leftHint: "crisp",   rightHint: "very soft",
        min: 0, max: 1, step: 0.05, default: 0.7 },
    ],
    diagram: "arc-narrow",
  },
  { id: "reactive",     label: "Reactive",      color: "#ff5470",
    tagline: "Sharp, tracks every stroke",
    desc: "Wide electrode arc, instant response. Sensation tracks the funscript closely.",
    sliders: [
      { id: "responsiveness", label: "Responsiveness", leftHint: "lagged", rightHint: "instant",
        min: 0, max: 1, step: 0.05, default: 0.85 },
      { id: "arc_width",      label: "Arc width",      leftHint: "narrow", rightHint: "wide",
        min: 0, max: 1, step: 0.05, default: 0.8 },
    ],
    diagram: "arc-wide",
  },
  { id: "scene_builder", label: "Scene Builder", color: "#3ed598",
    tagline: "Builds gradually over the scene",
    desc: "Circular electrode path, slow intensity ramp. Rewards patience.",
    sliders: [
      { id: "build_speed", label: "Build speed",    leftHint: "builds quickly", rightHint: "very slow arc",
        min: 0, max: 10, step: 0.1, default: 7.66 },
      { id: "arc_width",   label: "Arc width",      leftHint: "tight",          rightHint: "broad",
        min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
    diagram: "circle",
  },
  { id: "unpredictable", label: "Unpredictable", color: "#ffb547",
    tagline: "Random direction changes",
    desc: "Zigzag electrode path, varied character. Keeps you guessing.",
    sliders: [
      { id: "chaos",     label: "Chaos amount",     leftHint: "smooth",  rightHint: "wild",
        min: 0, max: 1, step: 0.05, default: 0.65 },
    ],
    diagram: "zigzag",
  },
  { id: "balanced",     label: "Balanced",      color: "#c77dff",
    tagline: "Middle of everything",
    desc: "Circular electrode path, moderate settings. Good starting point.",
    sliders: [
      { id: "intensity", label: "Overall intensity", leftHint: "soft",  rightHint: "strong",
        min: 0, max: 1, step: 0.05, default: 0.5 },
    ],
    diagram: "circle-full",
  },
];

const FF_STIM_CHANNELS = [
  { id: "alpha",     label: "Alpha L/R",   color: "#4dabf7" },
  { id: "beta",      label: "Beta U/D",    color: "#a3e635" },
  { id: "pfreq",     label: "Pulse freq",  color: "#ffb547" },
  { id: "freq",      label: "Frequency",   color: "#c77dff" },
  { id: "volume",    label: "Volume",      color: "#3ed598" },
  { id: "prise",     label: "Pulse rise",  color: "#ff8c47" },
  { id: "aprost",    label: "Alpha prost.", color: "#4dabf7" },
  { id: "bprost",    label: "Beta prost.",  color: "#a3e635" },
  { id: "vprost",    label: "Vol. prost.",  color: "#3ed598" },
];

// Default state per chapter: which character + slider params.
function defaultsFor(charId) {
  const c = FF_STIM_CHARS.find(x => x.id === charId);
  const out = {};
  c.sliders.forEach(s => { out[s.id] = s.default; });
  return out;
}

function StimTab() {
  // Per-chapter applied state (the version the 9 channels reflect).
  const [applied, setApplied] = stState(() => {
    const out = {};
    FF_DATA.CHAPTERS.forEach((ch, i) => {
      // Spread defaults: a small variety so chapters don't all look the same.
      const seedChar = ["scene_builder", "reactive", "balanced", "scene_builder",
                        "unpredictable", "reactive", "scene_builder"][i % 7] || "balanced";
      out[ch.id] = { charId: seedChar, params: defaultsFor(seedChar) };
    });
    return out;
  });

  // Currently-selected chapter (the one being edited).
  const [activeChapter, setActiveChapter] = stState(FF_DATA.CHAPTERS[0].id);
  // Staged (unapplied) params for the active chapter — what the sliders read/write.
  const [staged, setStaged] = stState(() => ({
    charId: applied[FF_DATA.CHAPTERS[0].id].charId,
    params: { ...applied[FF_DATA.CHAPTERS[0].id].params },
  }));
  // Has staged diverged from applied? Only then is Accept enabled.
  const [previewKey, setPreviewKey] = stState(0); // bump to force preview-grid redraw

  const stagedChar = FF_STIM_CHARS.find(c => c.id === staged.charId);
  const appliedForActive = applied[activeChapter];
  const dirty = (() => {
    if (staged.charId !== appliedForActive.charId) return true;
    for (const k of Object.keys(staged.params)) {
      if (staged.params[k] !== appliedForActive.params[k]) return true;
    }
    return false;
  })();

  const selectChapter = (id) => {
    setActiveChapter(id);
    setStaged({ charId: applied[id].charId, params: { ...applied[id].params } });
  };
  const setStagedChar = (id) => {
    setStaged({ charId: id, params: defaultsFor(id) });
  };
  const setParam = (k, v) => {
    setStaged(s => ({ ...s, params: { ...s.params, [k]: v } }));
  };
  const acceptChange = () => {
    setApplied(a => ({ ...a, [activeChapter]: { charId: staged.charId, params: { ...staged.params } } }));
    setPreviewKey(k => k + 1);
  };
  const previewChange = () => {
    setPreviewKey(k => k + 1); // redraw with staged values; doesn't commit
  };
  const resetStaged = () => {
    setStaged({ charId: appliedForActive.charId, params: { ...appliedForActive.params } });
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", background: "var(--bg)" }}>

      <TabHeader eyebrow="Stim · electrostim companion track"
        title="Per-chapter character"
        subtitle="Each chapter gets its own sensation character. Click a chapter to edit, adjust sliders, then Accept to redraw the 9-channel preview." />

      {/* ─── INCOMING SCRIPT RIBBON with CHAPTER BLOCKS ─── */}
      <ScriptWithChapters
        actions={FF_DATA.ACTIONS}
        chapters={FF_DATA.CHAPTERS}
        applied={applied}
        totalMs={FF_DATA.TOTAL_MS}
        activeChapter={activeChapter}
        onSelectChapter={selectChapter}
      />

      {/* ─── EDITOR ROW: chapters left, sliders right ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1fr) minmax(420px, 1.1fr)",
                    gap: 16, marginTop: 18, marginBottom: 22 }}>

        {/* LEFT: per-chapter list */}
        <div>
          <SectionLabel>Chapters</SectionLabel>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: 8, overflow: "hidden" }}>
            {FF_DATA.CHAPTERS.map((c, i) => {
              const a = applied[c.id];
              const ch = FF_STIM_CHARS.find(x => x.id === a.charId);
              const isActive = c.id === activeChapter;
              return (
                <button key={c.id} onClick={() => selectChapter(c.id)} style={{
                  display: "grid",
                  gridTemplateColumns: "8px 1fr 130px",
                  gap: 12, padding: "12px 14px", alignItems: "center",
                  width: "100%", textAlign: "left", cursor: "pointer",
                  fontFamily: "inherit",
                  background: isActive ? "var(--surface-2)" : "transparent",
                  border: "none",
                  borderLeft: isActive ? `3px solid ${ch.color}` : "3px solid transparent",
                  borderBottom: i < FF_DATA.CHAPTERS.length - 1 ? "1px solid var(--border)" : "none",
                  color: "var(--text)",
                }}>
                  <span style={{ width: 4, height: 32, borderRadius: 2, background: c.color }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? "var(--text)" : "var(--text-soft)" }}>
                      {c.title}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
                      {fmtTimeShort(c.start)}–{fmtTimeShort(c.end)}
                    </div>
                  </div>
                  <Pill tone="neutral"
                        style={{ background: ch.color + "22", color: ch.color,
                                 borderColor: ch.color + "55", justifySelf: "end" }}>
                    {ch.label}
                  </Pill>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT: character + sliders for active chapter */}
        <div>
          <SectionLabel right={
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              editing · <span style={{ color: "var(--text-soft)" }}>
                {FF_DATA.CHAPTERS.find(c => c.id === activeChapter)?.title}
              </span>
            </span>
          }>
            Character & sliders
          </SectionLabel>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                        borderRadius: 10, padding: 16 }}>

            {/* 5 character chips */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)",
                          gap: 8, marginBottom: 14 }}>
              {FF_STIM_CHARS.map(c => {
                const sel = c.id === staged.charId;
                return (
                  <button key={c.id} onClick={() => setStagedChar(c.id)} style={{
                    display: "flex", flexDirection: "column", padding: 8, gap: 6,
                    borderRadius: 8,
                    background: sel ? c.color + "20" : "var(--surface-2)",
                    border: `1.5px solid ${sel ? c.color : "var(--border)"}`,
                    color: "var(--text)", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700,
                                   color: sel ? c.color : "var(--text-soft)" }}>
                      {c.label}
                    </span>
                    <ElectrodeDiagram kind={c.diagram} color={c.color} active={sel} compact />
                  </button>
                );
              })}
            </div>

            {/* desc */}
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.55,
                          marginBottom: 14, paddingBottom: 14,
                          borderBottom: "1px solid var(--border)" }}>
              {stagedChar.desc}
            </div>

            {/* sliders */}
            {stagedChar.sliders.map(s => (
              <div key={s.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                              fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                  <span>← {s.leftHint}</span><span>{s.rightHint} →</span>
                </div>
                <Slider label={s.label}
                        valueLabel={`${typeof staged.params[s.id] === "number"
                          ? staged.params[s.id].toFixed(s.step < 1 ? 2 : 0)
                          : staged.params[s.id]}${s.unit || ""}`}
                        value={staged.params[s.id]}
                        min={s.min} max={s.max} step={s.step}
                        onChange={(v) => setParam(s.id, v)} />
              </div>
            ))}

            {/* action row */}
            <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
              <Button kind="secondary" size="sm" icon="play" onClick={previewChange}>
                Preview
              </Button>
              <Button kind="primary" size="sm" icon="check"
                      onClick={acceptChange} disabled={!dirty}>
                Accept
              </Button>
              {dirty && (
                <Button kind="ghost" size="sm" onClick={resetStaged}>Reset</Button>
              )}
              <span style={{ flex: 1 }} />
              {dirty && (
                <span style={{ fontSize: 10.5, color: "var(--accent)" }}>
                  unsaved changes
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── 9-CHANNEL PREVIEW GRID ─── */}
      <SectionLabel right={<Pill tone="info" style={{ fontSize: 10 }}>
        per-chapter calc · ~{Math.round(FF_DATA.CHAPTERS.length * 12)}s estimated
      </Pill>}>
        Channel previews · what the per-chapter character produces
      </SectionLabel>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {FF_STIM_CHANNELS.map(ch => (
          <div key={ch.id} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: ch.color }} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{ch.label}</span>
            </div>
            <ChannelMultiSparkline
              key={`${ch.id}_${previewKey}`}
              channelId={ch.id}
              chapters={FF_DATA.CHAPTERS}
              applied={applied}
              activeChapter={activeChapter}
              staged={staged}
              totalMs={FF_DATA.TOTAL_MS}
              color={ch.color}
              height={84} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, padding: 12,
                    background: "var(--surface-2)", borderRadius: 6, fontSize: 11,
                    color: "var(--text-dim)", lineHeight: 1.5 }}>
        <Icon name="info" size={11} style={{ verticalAlign: "-1px", marginRight: 5 }} />
        Channels are generated by <span className="mono" style={{ color: "var(--text)" }}>funscript-tools</span> at
        export time. Per-chapter character keeps long-script calculation under control —
        a 30-minute script that took ~20 minutes globally now runs ~5 minutes.
        Prostate channels are written only if the source funscript includes prostate data.
      </div>
    </div>
  );
}

// ─── Incoming-script ribbon with chapter blocks ────────────────────
//
// Chapters render as overlaid blocks; the ACTIVE one is lighter (alpha 0.42),
// inactives are dim (alpha 0.18). All clickable.
function ScriptWithChapters({ actions, chapters, applied, totalMs, activeChapter, onSelectChapter }) {
  const wrapRef = React.useRef();
  const [width, setWidth] = stState(900);
  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const H = 96;
  const xFor = (ms) => (ms / totalMs) * width;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline",
                    justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>Incoming script</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {actions.length} actions · {fmtTimeShort(totalMs)}
        </span>
      </div>

      <div ref={wrapRef} style={{ position: "relative", width: "100%", height: H + 22,
                                    background: "var(--bg)", borderRadius: 6,
                                    border: "1px solid var(--border)" }}>
        {/* chapter blocks (under the bars) */}
        {chapters.map(c => {
          const x = xFor(c.start);
          const w = xFor(c.end) - x;
          const isActive = c.id === activeChapter;
          const charId = applied[c.id]?.charId;
          const stimChar = FF_STIM_CHARS.find(x => x.id === charId);
          return (
            <button key={c.id} onClick={() => onSelectChapter(c.id)} style={{
              position: "absolute",
              left: x, top: 0, width: w, height: H,
              background: isActive ? "transparent" : c.color + "44",
              border: isActive
                ? `2px solid ${c.color}`
                : `1px solid ${c.color}55`,
              borderRadius: 4,
              cursor: "pointer", padding: 0,
              transition: "background 120ms",
            }} title={`${c.title} · ${stimChar?.label}`}>
              <span style={{
                position: "absolute", top: 4, left: 6, right: 6,
                fontSize: 10.5, fontWeight: isActive ? 700 : 600,
                color: isActive ? "var(--text)" : "var(--text-soft)",
                textAlign: "left", whiteSpace: "nowrap", overflow: "hidden",
                textOverflow: "ellipsis", pointerEvents: "none",
              }}>
                {c.title}
              </span>
              <span style={{
                position: "absolute", bottom: 4, left: 6,
                fontSize: 9.5, color: stimChar?.color || c.color,
                fontWeight: 700, pointerEvents: "none",
              }}>
                {stimChar?.label}
              </span>
            </button>
          );
        })}

        {/* funscript bars (over the chapter blocks) */}
        <svg width={width} height={H} style={{ position: "absolute", top: 0, left: 0,
                                                pointerEvents: "none" }}>
          {[0, 50, 100].map(p => (
            <line key={p} x1={0} x2={width}
                  y1={(1 - p / 100) * H} y2={(1 - p / 100) * H}
                  stroke="var(--text)" strokeOpacity={p === 50 ? 0.18 : 0.08} />
          ))}
          {actions.map((a, i) => {
            const x = xFor(a.at);
            const top = (1 - a.pos / 100) * H;
            return <line key={i} x1={x} x2={x} y1={top} y2={H}
                         stroke="#e9ecef" strokeWidth={1} opacity={0.55} />;
          })}
        </svg>

        {/* time ticks */}
        <div style={{ position: "absolute", left: 0, right: 0, top: H,
                      height: 22, pointerEvents: "none" }}>
          {(() => {
            const niceSteps = [60000, 100000, 200000];
            const step = niceSteps.find(s => totalMs / s < 8) ?? 200000;
            const out = [];
            for (let t = 0; t <= totalMs; t += step) {
              out.push(
                <span key={t} className="mono" style={{
                  position: "absolute", left: xFor(t) + 3, top: 4,
                  fontSize: 9, color: "var(--text-dim)",
                }}>{fmtTimeShort(t)}</span>
              );
            }
            return out;
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Per-chapter channel preview ─────────────────────────────────
//
// Renders a sparkline that segments per-chapter, using each chapter's
// applied character/params. The active chapter, if dirty, renders with
// the staged params (so Preview / Accept produce visible change).
function ChannelMultiSparkline({ channelId, chapters, applied, activeChapter, staged,
                                  totalMs, color, height = 84 }) {
  const N = 240;
  // For each x sample, decide which chapter it falls in,
  // and seed RNG from (channelId, charId, summary of params).
  const segs = chapters.map(ch => {
    const isActive = ch.id === activeChapter;
    const eff = isActive ? staged : applied[ch.id];
    const seed = `${channelId}_${ch.id}_${eff.charId}_${
      Object.values(eff.params).map(v => Math.round(v * 100)).join("_")
    }`;
    return { ch, eff, seed };
  });

  function rngFor(seedStr) {
    let s = 0; for (const c of seedStr) s = (s * 31 + c.charCodeAt(0)) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffff) / 65535; };
  }

  // Pre-roll per-chapter randoms.
  const segRand = segs.map(s => rngFor(s.seed));

  const bars = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * totalMs;
    const segIdx = segs.findIndex(s => t >= s.ch.start && t <= s.ch.end);
    const seg = segs[Math.max(0, segIdx)];
    const rand = segRand[Math.max(0, segIdx)];
    const charId = seg.eff.charId;
    // Different characters → different shapes.
    let v;
    const lt = (t - seg.ch.start) / Math.max(1, seg.ch.end - seg.ch.start);
    if (charId === "scene_builder") {
      v = 0.15 + 0.7 * lt + Math.sin(lt * 22) * 0.08 + (rand() - 0.5) * 0.1;
    } else if (charId === "reactive") {
      v = 0.4 + Math.sin(lt * 38) * 0.4 + (rand() - 0.5) * 0.2;
    } else if (charId === "gentle") {
      v = 0.3 + Math.sin(lt * 9) * 0.18 + (rand() - 0.5) * 0.06;
    } else if (charId === "unpredictable") {
      v = 0.5 + (rand() - 0.5) * 0.85;
    } else {
      v = 0.5 + Math.sin(lt * 16) * 0.25 + (rand() - 0.5) * 0.12;
    }
    v = Math.max(0.04, Math.min(1, v));
    bars.push(v);
  }

  return (
    <svg viewBox={`0 0 100 100`} preserveAspectRatio="none"
         style={{ width: "100%", height, background: "var(--bg)", borderRadius: 4 }}>
      {[0, 25, 50, 75, 100].map(p => (
        <line key={p} x1={0} x2={100} y1={p} y2={p}
              stroke="var(--border)" strokeOpacity={p === 50 ? 0.4 : 0.15}
              vectorEffect="non-scaling-stroke" />
      ))}
      {/* faint chapter markers */}
      {chapters.slice(1).map(c => {
        const x = (c.start / totalMs) * 100;
        return <line key={c.id} x1={x} x2={x} y1={0} y2={100}
                     stroke={c.color} strokeOpacity={0.35} strokeDasharray="2 2"
                     vectorEffect="non-scaling-stroke" />;
      })}
      {bars.map((v, i) => (
        <line key={i} x1={(i / (N - 1)) * 100} x2={(i / (N - 1)) * 100}
              y1={(1 - v) * 100} y2={100}
              stroke={color} strokeWidth={1} opacity={0.8}
              vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

// ─── Electrode path diagrams ──────────────────────────────────────
function ElectrodeDiagram({ kind, color, active, compact = false }) {
  const op = active ? 1 : 0.55;
  const h = compact ? 42 : 84;
  return (
    <svg viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet"
         style={{ width: "100%", height: h,
                  background: "var(--bg)", borderRadius: 4 }}>
      {kind === "arc-narrow" && (
        <>
          <path d="M 25 60 Q 50 20 75 60" fill="none" stroke={color} strokeWidth="2.4"
                strokeLinecap="round" opacity={op} />
          <circle cx="25" cy="60" r="3.5" fill={color} />
          <circle cx="75" cy="60" r="3.5" fill={color} />
        </>
      )}
      {kind === "arc-wide" && (
        <>
          <path d="M 18 65 A 32 28 0 1 1 82 65" fill="none" stroke={color} strokeWidth="2.4"
                strokeLinecap="round" opacity={op} />
          <circle cx="18" cy="65" r="3.5" fill={color} />
          <circle cx="82" cy="65" r="3.5" fill={color} />
        </>
      )}
      {kind === "circle" && (
        <>
          <circle cx="50" cy="42" r="22" fill="none" stroke={color} strokeWidth="2.4" opacity={op} />
          <circle cx="72" cy="42" r="3.5" fill={color} />
        </>
      )}
      {kind === "circle-full" && (
        <>
          <circle cx="50" cy="42" r="22" fill="none" stroke={color} strokeWidth="2.4" opacity={op} />
          <circle cx="72" cy="42" r="3.5" fill={color} />
          <circle cx="28" cy="42" r="3.5" fill={color} />
        </>
      )}
      {kind === "zigzag" && (
        <>
          <path d="M 14 60 L 26 26 L 38 60 L 50 26 L 62 60 L 74 26 L 86 60"
                fill="none" stroke={color} strokeWidth="2.4"
                strokeLinejoin="round" strokeLinecap="round" opacity={op} />
          <circle cx="14" cy="60" r="3.5" fill={color} />
          <circle cx="86" cy="60" r="3.5" fill={color} />
        </>
      )}
    </svg>
  );
}

window.StimTab = StimTab;
