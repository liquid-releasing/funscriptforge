// ─── ExportTab ──────────────────────────────────────────────────────
// Last stop in the Project → Device → Tone → Phrases → Export flow.
// Layout follows docs/guide/export.md:
//   1. Export preview chart (the final funscript with all transforms applied)
//   2. Export options (blend seams, final smooth, heatmap PNG, audio WAV)
//   3. Completed transforms (every transform you accepted, with ↩ / 🗑)
//   4. Recommended transforms (auto-suggestions for un-edited phrases)
//   5. Export devices (Mechanical + 5 estim checkboxes)
//   6. Export to folder (the big Export All action + folder layout)
//
// The Forge Score / acceptance history rail on the right is our addition;
// it sits alongside the spec content.

const { useState: exState, useMemo: exMemo } = React;

// ─── Compact reusable bits ──────────────────────────────────────────
function ExCheck({ checked, onChange, label, sub, disabled }) {
  return (
    <label style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 12px", borderRadius: 6,
      background: checked ? "rgba(255,75,75,0.05)" : "transparent",
      border: `1px solid ${checked ? "rgba(255,75,75,0.25)" : "var(--border)"}`,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1, transition: "background .12s, border-color .12s",
    }}>
      <input type="checkbox" checked={!!checked} disabled={disabled}
             onChange={(e) => onChange && onChange(e.target.checked)}
             style={{ marginTop: 2, accentColor: "var(--accent)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2,
                              lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </label>
  );
}

function ExSection({ title, count, defaultOpen = false, children, accent }) {
  const [open, setOpen] = exState(defaultOpen);
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, marginBottom: 14, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "12px 16px",
        background: "transparent", border: "none", cursor: "pointer",
        fontFamily: "inherit", color: "var(--text)", textAlign: "left",
      }}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14}
              style={{ color: "var(--text-dim)" }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                       textTransform: "uppercase" }}>{title}</span>
        {typeof count === "number" && (
          <span className="mono" style={{
            padding: "2px 8px", borderRadius: 10, fontSize: 11,
            background: accent || "var(--surface-2)", color: "var(--text-dim)",
          }}>{count}</span>
        )}
        <div style={{ flex: 1 }} />
      </button>
      {open && <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--border)" }}>{children}</div>}
    </div>
  );
}

// ─── Export preview chart ───────────────────────────────────────────
// Uses ScriptChart full-width — same visualization as the rest of the app,
// so users see the actual funscript shape they're about to write to disk.
function ExportPreview() {
  const total = window.FF_TOTAL_MS || (9 * 60 + 32) * 1000;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: 14, marginBottom: 18,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Icon name="line-chart" size={14} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                       textTransform: "uppercase" }}>Export preview</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          final funscript · all accepted transforms applied
        </span>
        <div style={{ flex: 1 }} />
        <Pill tone="success" dot>fresh</Pill>
      </div>
      <ScriptChart
        actions={FF_DATA.ACTIONS}
        phrases={FF_DATA.PHRASES}
        totalMs={total}
        startMs={0} endMs={total}
        height={150}
        showPhraseTags={true}
      />
    </div>
  );
}

// ─── Completed transforms (table) ───────────────────────────────────
const FF_COMPLETED = [
  { idx:  2, atMs:  18500, dur: 25.5, transform: "Normalize Range",  src: "PE", bpm:  48, cycles: null, rejected: false },
  { idx:  4, atMs:  68000, dur: 28.0, transform: "Amplitude Scale",  src: "PE", bpm: 110, cycles: null, rejected: false },
  { idx:  9, atMs: 198000, dur: 32.0, transform: "Recenter (45)",    src: "PE", bpm: 124, cycles: null, rejected: false },
  { idx: 13, atMs: 320000, dur: 28.0, transform: "Reduce Density",   src: "PP", bpm: 168, cycles: 4,    rejected: false },
  { idx: 14, atMs: 348000, dur: 28.0, transform: "Reduce Density",   src: "PP", bpm: 174, cycles: 4,    rejected: false },
  { idx: 15, atMs: 376000, dur: 26.0, transform: "BPM Cap (200)",    src: "PE", bpm: 232, cycles: null, rejected: false },
  { idx: 16, atMs: 402000, dur: 26.0, transform: "BPM Cap (200)",    src: "PE", bpm: 245, cycles: null, rejected: true  },
  { idx: 18, atMs: 452000, dur: 20.0, transform: "Smooth (0.15)",    src: "PE", bpm: 102, cycles: null, rejected: false },
];

function fmtMs(ms) {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CompletedTable() {
  const [rows, setRows] = exState(FF_COMPLETED);
  const toggle = (i) => setRows(rs => rs.map((r, j) => j === i ? { ...r, rejected: !r.rejected } : r));
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 64px 60px 1fr 60px 60px 60px 36px",
        gap: 8, padding: "6px 0",
        fontSize: 10.5, fontWeight: 700, color: "var(--text-dim)",
        textTransform: "uppercase", letterSpacing: "0.05em",
        borderBottom: "1px solid var(--border)",
      }}>
        <div>#</div><div>Time</div><div>Dur</div><div>Transform</div>
        <div>Source</div><div>BPM</div><div>Cycles</div><div></div>
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "grid",
          gridTemplateColumns: "44px 64px 60px 1fr 60px 60px 60px 36px",
          gap: 8, padding: "9px 0",
          alignItems: "center", fontSize: 12,
          borderBottom: "1px solid var(--border)",
          opacity: r.rejected ? 0.45 : 1,
          textDecoration: r.rejected ? "line-through" : "none",
        }}>
          <span className="mono" style={{ color: "var(--text-dim)" }}>P{r.idx}</span>
          <span className="mono">{fmtMs(r.atMs)}</span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.dur}s</span>
          <span style={{ fontWeight: 600 }}>{r.transform}</span>
          <Pill tone={r.src === "PE" ? "info" : "warn"}>{r.src}</Pill>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.bpm}</span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.cycles ?? "—"}</span>
          <button onClick={() => toggle(i)} title={r.rejected ? "Restore to export" : "Reject from export"}
            style={{
              display: "grid", placeItems: "center", width: 26, height: 26,
              borderRadius: 4, background: "transparent",
              border: "1px solid var(--border)", cursor: "pointer", color: "var(--text-dim)",
            }}>
            <Icon name={r.rejected ? "rotate-ccw" : "trash-2"} size={12} />
          </button>
        </div>
      ))}
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
        Rejecting a completed transform excludes it from this export only —
        your editing work is preserved.
      </div>
    </div>
  );
}

// ─── Recommended transforms (auto-suggested) ────────────────────────
// Suggestion logic per spec:
//   pattern label contains "transition" → Smooth
//   bpm < threshold (120 default)        → Passthrough
//   bpm >= threshold AND ampSpan < 40    → Normalize Range
//   bpm >= threshold otherwise           → Amplitude Scale
function suggestTransform(p, bpmThreshold) {
  const pat = (FF_DATA.PATTERNS || []).find(x => x.id === p.patternId);
  if (pat && /transition|drift|taper/.test(pat.id)) return "Smooth";
  if (p.bpm < bpmThreshold) return "Passthrough";
  if (p.ampSpan < 40) return "Normalize Range";
  return "Amplitude Scale";
}

function RecommendedTable({ onAcceptAll }) {
  const [bpmThreshold, setBpmThreshold] = exState(120);
  const completedIdxs = new Set(FF_COMPLETED.map(r => r.idx));
  const recs = exMemo(() => {
    return FF_DATA.PHRASES
      .map((p, i) => ({ p, i: i + 1 }))
      .filter(({ i, p }) => !completedIdxs.has(i) && p.tag !== null) // un-edited & not "well-formed"
      .map(({ p, i }) => ({
        idx: i, atMs: p.start, dur: ((p.end - p.start) / 1000).toFixed(1),
        bpm: p.bpm, ampSpan: p.ampSpan,
        suggestion: suggestTransform(p, bpmThreshold),
      }));
  }, [bpmThreshold]);

  return (
    <div style={{ marginTop: 4 }}>
      {/* BPM threshold control */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", marginBottom: 10,
        background: "var(--surface-2)", borderRadius: 6,
        border: "1px solid var(--border)",
      }}>
        <Icon name="sliders-horizontal" size={13} style={{ color: "var(--text-dim)" }} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>BPM threshold</span>
        <input type="range" min={60} max={200} value={bpmThreshold}
               onChange={(e) => setBpmThreshold(+e.target.value)}
               style={{ flex: 1, accentColor: "var(--accent)" }} />
        <span className="mono" style={{ fontSize: 12, fontWeight: 700,
                                        color: "var(--accent)", minWidth: 32 }}>
          {bpmThreshold}
        </span>
        <div style={{ flex: 0 }} />
        <Button kind="secondary" size="sm" icon="check-check" onClick={onAcceptAll}>
          Accept all
        </Button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "44px 64px 60px 1fr 70px 80px 70px",
        gap: 8, padding: "6px 0",
        fontSize: 10.5, fontWeight: 700, color: "var(--text-dim)",
        textTransform: "uppercase", letterSpacing: "0.05em",
        borderBottom: "1px solid var(--border)",
      }}>
        <div>#</div><div>Time</div><div>Dur</div><div>Suggested</div>
        <div>BPM</div><div>Amp span</div><div></div>
      </div>
      {recs.map((r) => (
        <div key={r.idx} style={{
          display: "grid",
          gridTemplateColumns: "44px 64px 60px 1fr 70px 80px 70px",
          gap: 8, padding: "9px 0",
          alignItems: "center", fontSize: 12,
          borderBottom: "1px solid var(--border)",
        }}>
          <span className="mono" style={{ color: "var(--text-dim)" }}>P{r.idx}</span>
          <span className="mono">{fmtMs(r.atMs)}</span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.dur}s</span>
          <span style={{ fontWeight: 600, color: r.suggestion === "Passthrough"
            ? "var(--text-dim)" : "var(--text)" }}>{r.suggestion}</span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.bpm}</span>
          <span className="mono" style={{ color: "var(--text-dim)" }}>{r.ampSpan}</span>
          <button title="Edit in Phrase Editor" style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "4px 8px", borderRadius: 4,
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-dim)", cursor: "pointer", fontSize: 11,
          }}>
            <Icon name="pencil" size={11} /> Edit
          </button>
        </div>
      ))}
      {recs.length === 0 && (
        <div style={{ padding: "20px 0", textAlign: "center", fontSize: 12,
                      color: "var(--text-dim)" }}>
          Every phrase has been reviewed. Nothing to recommend.
        </div>
      )}
    </div>
  );
}

// ─── Export devices (Mechanical + 5 estim) ──────────────────────────
const ESTIM_DEVICES = [
  { id: "legacy",     label: "Audio 3-phase — continuous (legacy 2b/312)",
    sub: "Continuous sine carrier · stereo WAV",                          audio: true,  default: false },
  { id: "stereostim", label: "Audio 3-phase — pulse (Tingler/EstimHero/ZC95)",
    sub: "Pulse train with cosine envelope · stereo WAV · default",       audio: true,  default: true  },
  { id: "foc3",       label: "FOC-Stim — 3-phase",
    sub: "Protocol device · channel funscripts · restim required",        audio: false, default: false },
  { id: "foc4",       label: "FOC-Stim — 4-phase",
    sub: "Protocol device · experimental four-phase mode",                audio: false, default: false },
  { id: "neostim",    label: "NeoStim — 3-phase",
    sub: "Protocol device · NeoStim three-phase mode",                    audio: false, default: false },
];

function ExportDevicesPanel({ mech, setMech, estim, setEstim }) {
  const anyAudio = ESTIM_DEVICES.some(d => d.audio && estim[d.id]);
  return (
    <div>
      <SectionLabel right={
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          channel funscripts in <code className="mono">estim/</code> are
          identical regardless of which estim device is checked
        </span>
      }>Export devices</SectionLabel>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Mechanical */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        marginBottom: 8 }}>
            Mechanical
          </div>
          <ExCheck checked={mech} onChange={setMech}
            label="Mechanical (Handy / OSR2 / Intiface)"
            sub="One 1D funscript covering Handy, OSR2, and Bluetooth devices like Lovense / Kiiroo. Velocity limit comes from The Handy (most restrictive)." />
        </div>

        {/* Estim */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.05em",
                        marginBottom: 8 }}>
            Estim
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ESTIM_DEVICES.map(d => (
              <ExCheck key={d.id} checked={!!estim[d.id]}
                onChange={(v) => setEstim({ ...estim, [d.id]: v })}
                label={d.label} sub={d.sub} />
            ))}
          </div>
        </div>
      </div>

      {anyAudio && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: "rgba(77,171,247,0.08)", border: "1px solid rgba(77,171,247,0.3)",
          borderRadius: 6, fontSize: 11.5, color: "var(--text-muted)",
          display: "flex", gap: 10, alignItems: "flex-start", lineHeight: 1.5,
        }}>
          <Icon name="volume-2" size={13} style={{ color: "#4dabf7", marginTop: 1 }} />
          <div>
            Audio-capable devices selected — stereo <code className="mono">.wav</code> files
            will be rendered alongside the channel funscripts. Connect your estim device to
            audio output, hit play, no restim required.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Folder layout preview ──────────────────────────────────────────
function colorFor(name) {
  if (name.endsWith("/")) return "#4dabf7";
  if (/\.wav$/.test(name)) return "#ffb547";
  if (/\.png$/.test(name)) return "#c77dff";
  if (/\.funscript$/.test(name)) return "#3ed598";
  return "var(--text)";
}

function FileLine({ depth, name, comment, bold }) {
  return (
    <div style={{ display: "flex", whiteSpace: "pre" }}>
      <span>{"  ".repeat(depth)}</span>
      <span style={{ color: colorFor(name), fontWeight: bold ? 600 : 400 }}>{name}</span>
      {comment && (
        <>
          <span style={{ flex: 1 }} />
          <span style={{ color: "var(--text-dim)", fontStyle: "italic", marginLeft: 16 }}>
            ← {comment}
          </span>
        </>
      )}
    </div>
  );
}

function FolderLayoutPreview({ mech, estim, projName = "myscript" }) {
  const anyEstim = Object.values(estim).some(Boolean);
  const legacy = !!estim.legacy;
  const stereo = !!estim.stereostim;

  // Estim funscripts that go in 2 columns (no comments — names are self-evident).
  const estimChannels = [
    `${projName}.funscript`,
    `${projName}.alpha.funscript`,
    `${projName}.beta.funscript`,
    `${projName}.frequency.funscript`,
    `${projName}.volume.funscript`,
    `${projName}.pulse_frequency.funscript`,
    `${projName}.pulse_rise.funscript`,
    `${projName}.alpha_prostate.funscript`,
    `${projName}.beta_prostate.funscript`,
    `${projName}.volume_prostate.funscript`,
  ];

  return (
    <div style={{
      background: "#0c0d0e", border: "1px solid var(--border)",
      borderRadius: 6, padding: 14, marginTop: 12,
      fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.6,
      color: "var(--text-muted)", overflow: "auto",
    }}>
      <FileLine depth={0} name="{output_folder}/" bold />
      <FileLine depth={1} name={`${projName}.funscript`}   comment="top-level base funscript" />
      <FileLine depth={1} name={`${projName}.heatmap.png`} comment="color-coded velocity heatmap" />
      <FileLine depth={1} name={`${projName}.mp4`}         comment="copied media + audio + captions" />
      <FileLine depth={1} name={`${projName}.forgetmpl`}   comment="reusable workflow template" />

      {mech && (
        <>
          <FileLine depth={1} name="mechanical/" />
          <FileLine depth={2} name={`${projName}.funscript`}
            comment="1D funscript for Handy / OSR / Intiface" />
        </>
      )}

      {anyEstim && (
        <>
          <FileLine depth={1} name="estim/" />
          {/* 2-column grid for the channel funscripts */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            columnGap: 24, paddingLeft: "4ch",
          }}>
            {estimChannels.map((n, i) => (
              <span key={i} style={{ color: colorFor(n) }}>{n}</span>
            ))}
          </div>
          {/* WAV files, single-column with comments */}
          {legacy && (
            <FileLine depth={2} name={`${projName}.legacy.wav`}
              comment="stereo audio for 2b/312" />
          )}
          {stereo && (
            <FileLine depth={2} name={`${projName}.stereostim.wav`}
              comment="stereo audio for Tingler/ZC95" />
          )}
          {legacy && (
            <FileLine depth={2} name={`${projName}.prostate.legacy.wav`}
              comment="prostate audio" />
          )}
          {stereo && (
            <FileLine depth={2} name={`${projName}.prostate.stereostim.wav`}
              comment="prostate audio" />
          )}
        </>
      )}

      {!mech && !anyEstim && (
        <div style={{ color: "var(--warning)", fontStyle: "italic", marginTop: 8 }}>
          No devices selected — Export All disabled.
        </div>
      )}
    </div>
  );
}

// ─── ExportTab ──────────────────────────────────────────────────────
function ExportTab({ selectedDevices }) {
  // Spec defaults: blend seams + final smooth + heatmap on, audio WAV on if applicable.
  const [blendSeams, setBlendSeams] = exState(true);
  const [finalSmooth, setFinalSmooth] = exState(true);
  const [heatmap, setHeatmap] = exState(true);
  const [includeAudio, setIncludeAudio] = exState(true);

  // Devices: default to mechanical on (since Handy is in selectedDevices),
  // and stereostim on (the spec default).
  const [mech, setMech] = exState(true);
  const [estim, setEstim] = exState({
    legacy: false, stereostim: true,
    foc3: false, foc4: false, neostim: false,
  });

  const anyAudioDevice = ESTIM_DEVICES.some(d => d.audio && estim[d.id]);
  const anyDevice = mech || Object.values(estim).some(Boolean);
  const projName = "aftermath";

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", background: "var(--bg)" }}>
      <TabHeader eyebrow="Final step" title="Export"
        subtitle="Write the final funscript and any estim channel files into your output folder, organized into subfolders by device class. The forge log travels with the file." />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 22 }}>
        {/* ─── LEFT: spec content ─────────────────────────────────── */}
        <div>
          {/* 1. Export preview chart */}
          <ExportPreview />

          {/* 2. Export options */}
          <ExSection title="Export options" defaultOpen>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <ExCheck checked={blendSeams} onChange={setBlendSeams}
                label="Blend seams"
                sub="Detects high-velocity jumps at phrase boundaries and applies targeted smoothing only at those seams." />
              <ExCheck checked={finalSmooth} onChange={setFinalSmooth}
                label="Final smooth"
                sub="Light global low-pass pass that removes residual sharp edges." />
              <ExCheck checked={heatmap} onChange={setHeatmap}
                label="Include color heatmap PNG"
                sub="Writes a velocity-colored heatmap of the main funscript next to the export." />
              <ExCheck checked={includeAudio && anyAudioDevice} onChange={setIncludeAudio}
                disabled={!anyAudioDevice}
                label="Include estim audio files (WAV)"
                sub={anyAudioDevice
                  ? "Renders stereo WAV from the alpha/beta channel funscripts. Play directly on your estim device."
                  : "Select an audio-capable estim device (legacy or stereostim) to enable."} />
            </div>
          </ExSection>

          {/* 3. Completed transforms */}
          <ExSection title="Completed transforms"
            count={FF_COMPLETED.filter(r => !r.rejected).length}
            accent="rgba(77,171,247,0.18)">
            <CompletedTable />
          </ExSection>

          {/* 4. Recommended transforms */}
          <ExSection title="Recommended transforms" count={9}
            accent="rgba(255,181,71,0.18)">
            <RecommendedTable onAcceptAll={() => {}} />
          </ExSection>

          {/* 5. Export devices */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: 16, marginBottom: 14,
          }}>
            <ExportDevicesPanel mech={mech} setMech={setMech}
                                estim={estim} setEstim={setEstim} />
          </div>

          {/* 6. Export to folder — the action */}
          <div style={{
            background: "linear-gradient(135deg, rgba(255,75,75,0.08), rgba(255,123,123,0.04))",
            border: "1px solid rgba(255,75,75,0.3)",
            borderRadius: 8, padding: 18, marginBottom: 20,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                              textTransform: "uppercase", color: "var(--text-dim)" }}>
                  Export to folder
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                  ~/Desktop/aftermath_forged/
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 4 }}>
                  {anyDevice
                    ? `Writing ${(mech ? 1 : 0) + (Object.values(estim).filter(Boolean).length > 0 ? 1 : 0)} subfolder${mech && Object.values(estim).some(Boolean) ? "s" : ""} · forge log embedded · .forgetmpl alongside`
                    : "Pick at least one device to enable Export All."}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <Button kind="secondary" size="md" icon="folder-open">Open folder</Button>
              <Button kind="primary" size="md" icon="download" disabled={!anyDevice}>
                Export All
              </Button>
            </div>
            <FolderLayoutPreview mech={mech} estim={estim} projName={projName} />
          </div>

          {/* The forge log (mentioned in spec) */}
          <ExSection title="Forge log preview" accent="rgba(62,213,152,0.18)">
            <div style={{
              marginTop: 10, padding: 14, borderRadius: 6,
              background: "#0c0d0e", border: "1px solid var(--border)",
              fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55,
              color: "var(--text-muted)", whiteSpace: "pre", overflow: "auto",
            }}>{`"_forge_log": {
  "version": "0.1.0",
  "exported_at": "2026-04-11T10:23:45",
  "source": "aftermath.funscript",
  "transforms": [
    { "phrase_index": 4,  "transform": "amplitude_scale", "params": {"scale": 1.4} },
    { "phrase_index": 13, "transform": "reduce_density",  "params": {"keep": 0.5} },
    { "phrase_index": 15, "transform": "bpm_cap",         "params": {"max": 200} }
  ],
  "blend_seams": ${blendSeams},
  "final_smooth": ${finalSmooth},
  "clamp_count": 0
}`}</div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--text-dim)",
                          lineHeight: 1.5 }}>
              The forge log is embedded in the main funscript's JSON metadata.
              It records the version, every transform applied, and the export
              options — so you can always trace what was done to a file.
            </div>
          </ExSection>
        </div>

        {/* ─── RIGHT: Forge Score + acceptance history ───────────── */}
        <div>
          <Card padding={20} style={{
            background: "linear-gradient(135deg, rgba(62,213,152,0.08), rgba(255,75,75,0.04))",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                          textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Final Forge Score
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
              <span className="mono" style={{ fontSize: 48, fontWeight: 700,
                                              color: "#3ed598", lineHeight: 1 }}>87</span>
              <span style={{ fontSize: 13, color: "var(--text-dim)" }}>/ 100</span>
              <div style={{ flex: 1 }} />
              <div style={{
                display: "inline-grid", placeItems: "center",
                width: 36, height: 36, borderRadius: 8,
                background: "rgba(62,213,152,0.18)", color: "#3ed598",
                fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800,
              }}>A</div>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)",
                          marginTop: 10, overflow: "hidden" }}>
              <div style={{ width: "87%", height: "100%", background: "#3ed598" }} />
            </div>
            <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)",
                          lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text)" }}>+12</strong> from when you
              imported. Strong on tone alignment and beat density. Slight room on
              amplitude contrast and BPM ceiling vs device.
            </div>
            <div style={{ marginTop: 14, padding: 10, background: "var(--surface-2)",
                          borderRadius: 6, fontSize: 11, color: "var(--text-dim)",
                          lineHeight: 1.45 }}>
              <Icon name="info" size={11} style={{ verticalAlign: "-1px", marginRight: 5 }} />
              Score travels with the export inside <code className="mono">_forge_log</code>.
              Reopens as the "imported" baseline next time.
            </div>
          </Card>

          <div style={{ height: 14 }} />

          <Card padding={16}>
            <SectionLabel>Acceptance history</SectionLabel>
            {[
              { tab: "Project",    when: "12:14 today", ok: true  },
              { tab: "Device",     when: "12:21 today", ok: true  },
              { tab: "Tone",       when: "12:34 today", ok: true  },
              { tab: "Phrases",    when: "12:48 today", ok: true  },
              { tab: "Patterns",   when: "12:52 today", ok: true  },
              { tab: "Stim",       when: "—",           ok: false },
              { tab: "Multi-axis", when: "—",           ok: false },
            ].map(r => (
              <div key={r.tab} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 0", borderBottom: "1px solid var(--border)",
                fontSize: 12,
              }}>
                <Icon name={r.ok ? "check-circle-2" : "circle"} size={13}
                      style={{ color: r.ok ? "var(--success)" : "var(--text-dim)" }} />
                <span style={{ flex: 1, fontWeight: r.ok ? 600 : 400,
                               color: r.ok ? "var(--text)" : "var(--text-dim)" }}>{r.tab}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.when}</span>
              </div>
            ))}
          </Card>

          <div style={{ height: 14 }} />

          {/* Workflow template */}
          <Card padding={16}>
            <SectionLabel>Workflow template</SectionLabel>
            <div style={{
              padding: 12, marginTop: 6, borderRadius: 6,
              background: "var(--surface-2)", border: "1px solid var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon name="file-cog" size={14} style={{ color: "var(--accent)" }} />
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                  aftermath.forgetmpl
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                A reusable record of the <em>decisions</em> you made — tone
                settings, output targets, device strategies. No paths, no
                timestamps. Drop it into a new project to start with the same
                workflow.
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

window.ExportTab = ExportTab;
