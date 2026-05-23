// DeviceTab — funscript-level reset.
//
// Absorbs what used to be the separate "Tone" tab: a global tone bias for the
// whole script, plus device-aware adjustments (BPM cap, latency, stroke
// resolution) and groove changes (rhythm density, beat alignment).
//
// Heavy on stats — the analytical user wants to see how close their reset
// gets to "Forge Perfection" (a synthetic ideal we score against). The score
// drives a meter at the top of the tab and a per-metric breakdown.

const { useState: dvState, useMemo: dvMemo } = React;

// ─── Forge Score model ────────────────────────────────────────────
// Each metric: a value in [0, 1] where 1.0 is "perfect" against our ideal.
// We aggregate as a weighted mean → 0..100 score with a letter band.
function computeForgeScore({ bpmCap, latency, smoothing, density, recenter, contrast, tone }) {
  // Synthetic — would be derived from real funscript analysis.
  const bpmFit       = clamp01(1 - Math.abs(bpmCap - 180) / 220);   // ideal cap ≈ 180
  const latencyFit   = clamp01(1 - latency / 220);                  // less is better
  const smoothFit    = bell(smoothing, 0.55, 0.35);                 // sweet spot 0.55
  const densityFit   = bell(density, 0.62, 0.4);                    // sweet spot 0.62
  const recenterFit  = bell(recenter / 100, 0.5, 0.4);              // ideal mean pos 50
  const contrastFit  = bell(contrast, 0.5, 0.45);                   // sweet spot 0.5
  const toneFit      = tone === "tender" ? 0.78
                     : tone === "build"   ? 0.84
                     : tone === "tease"   ? 0.91
                     : tone === "edge"    ? 0.86
                     : tone === "climax"  ? 0.74
                     : tone === "dominant"? 0.81
                     : 0.7;

  const weights = [
    ["BPM ceiling vs device",  bpmFit,      0.18, "bpm-cap"],
    ["Latency budget",         latencyFit,  0.10, "latency"],
    ["Stroke smoothing",       smoothFit,   0.14, "smooth"],
    ["Beat density / groove",  densityFit,  0.16, "density"],
    ["Mean position recenter", recenterFit, 0.10, "recenter"],
    ["Amplitude contrast",     contrastFit, 0.16, "contrast"],
    ["Tone alignment",         toneFit,     0.16, "tone"],
  ];
  const totalW = weights.reduce((s, w) => s + w[2], 0);
  const score = weights.reduce((s, w) => s + w[1] * w[2], 0) / totalW;
  const score100 = Math.round(score * 100);
  const band =
    score100 >= 92 ? { letter: "S", label: "Forge-perfect", color: "#3ed598" } :
    score100 >= 82 ? { letter: "A", label: "Strong",        color: "#a3e635" } :
    score100 >= 70 ? { letter: "B", label: "Solid",         color: "#ffb547" } :
    score100 >= 58 ? { letter: "C", label: "Workable",      color: "#ff8c47" } :
                     { letter: "D", label: "Needs work",    color: "#ff5470" };
  return { score: score100, band, breakdown: weights };
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function bell(x, mid, w) { return clamp01(1 - Math.abs(x - mid) / w); }

// ─── Synthetic before/after stats ─────────────────────────────────
function computeScriptStats(actions, params) {
  const n = actions.length;
  const bpms = [];
  for (let i = 1; i < n; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    if (dt > 0) bpms.push(60000 / (2 * dt));
  }
  const meanPos = actions.reduce((s, a) => s + a.pos, 0) / n;
  const min = Math.min(...actions.map(a => a.pos));
  const max = Math.max(...actions.map(a => a.pos));
  // Simulate device clamp
  const bpmCap = params?.bpmCap ?? 999;
  const clampedActions = applyClamp(actions, bpmCap, params?.smoothing ?? 0);
  const cBpms = [];
  for (let i = 1; i < clampedActions.length; i++) {
    const dt = clampedActions[i].at - clampedActions[i - 1].at;
    if (dt > 0) cBpms.push(60000 / (2 * dt));
  }
  return {
    actions: n,
    actionsAfter: clampedActions.length,
    avgBpm: avg(bpms),
    avgBpmAfter: avg(cBpms),
    maxBpm: Math.max(...bpms, 0),
    maxBpmAfter: Math.max(...cBpms, 0),
    p95Bpm: pct(bpms, 0.95),
    p95BpmAfter: pct(cBpms, 0.95),
    meanPos: Math.round(meanPos),
    spanRange: max - min,
    droppedActions: n - clampedActions.length,
  };
}
function applyClamp(actions, bpmCap, smoothing) {
  if (!bpmCap || bpmCap >= 999) return actions;
  const minDt = 60000 / (2 * bpmCap);
  const out = [actions[0]];
  for (let i = 1; i < actions.length; i++) {
    if (actions[i].at - out[out.length - 1].at >= minDt) out.push(actions[i]);
  }
  return out;
}
function avg(xs) { return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0; }
function pct(xs, p) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length * p)]);
}

// ─── DeviceTab ────────────────────────────────────────────────────
function DeviceTab({ selectedDevices }) {
  const [bpmCap, setBpmCap] = dvState(180);
  const [latency, setLatency] = dvState(60);
  const [smoothing, setSmoothing] = dvState(0.55);
  const [density, setDensity] = dvState(0.62);
  const [recenter, setRecenter] = dvState(50);
  const [contrast, setContrast] = dvState(0.5);

  const params = { bpmCap, latency, smoothing, density, recenter, contrast, tone: "tease" };
  const score = dvMemo(() => computeForgeScore(params),
                       [bpmCap, latency, smoothing, density, recenter, contrast]);
  const stats = dvMemo(() => computeScriptStats(FF_DATA.ACTIONS, params),
                       [bpmCap, smoothing]);

  // Build a "preview" funscript that reflects the device-aware reset
  const previewActions = dvMemo(() => {
    let acts = applyClamp(FF_DATA.ACTIONS, bpmCap, smoothing);
    // Recenter
    if (recenter !== 50) {
      const cur = acts.reduce((s, a) => s + a.pos, 0) / acts.length;
      const shift = recenter - cur;
      acts = acts.map(a => ({ ...a, pos: Math.max(0, Math.min(100, Math.round(a.pos + shift))) }));
    }
    // Contrast
    if (contrast !== 0.5) {
      const k = (contrast - 0.5) * 1.4;
      acts = acts.map(a => ({ ...a, pos: Math.max(0, Math.min(100, Math.round(50 + (a.pos - 50) * (1 + k)))) }));
    }
    // Smoothing — gentle 3-tap
    if (smoothing > 0.2) {
      const w = smoothing;
      acts = acts.map((a, i, arr) => {
        const p = arr[Math.max(0, i - 1)].pos;
        const n = arr[Math.min(arr.length - 1, i + 1)].pos;
        return { ...a, pos: Math.round(a.pos * (1 - w) + ((p + n) / 2) * w) };
      });
    }
    return acts;
  }, [bpmCap, smoothing, recenter, contrast]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px", background: "var(--bg)" }}>

        {/* Original → Preview funscript chart */}
        <SectionLabel right={<span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {FF_DATA.ACTIONS.length} actions → {previewActions.length}
          {FF_DATA.ACTIONS.length !== previewActions.length
            ? ` · -${FF_DATA.ACTIONS.length - previewActions.length} clamped`
            : ""}
        </span>}>
          Funscript · before / after device reset
        </SectionLabel>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 8, padding: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        marginBottom: 4 }}>Original</div>
          <ScriptChart actions={FF_DATA.ACTIONS} phrases={FF_DATA.PHRASES}
                       totalMs={FF_DATA.TOTAL_MS} startMs={0} endMs={FF_DATA.TOTAL_MS}
                       height={120} showPhraseTags={false} showActions="auto" />
          <div style={{ height: 8 }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-light, #ff7b7b)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        marginBottom: 4 }}>Preview · device-aware reset</div>
          <ScriptChart actions={previewActions} phrases={FF_DATA.PHRASES}
                       totalMs={FF_DATA.TOTAL_MS} startMs={0} endMs={FF_DATA.TOTAL_MS}
                       height={120} showPhraseTags={false} showActions="auto" />
        </div>

        {/* Score header */}
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr",
          gap: 18, marginBottom: 22,
        }}>
          <ForgeScoreCard score={score} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <CompareStat label="Actions" before={stats.actions} after={stats.actionsAfter}
                         delta={stats.droppedActions ? `-${stats.droppedActions} dropped` : "no drops"}
                         negative={stats.droppedActions > 0} />
            <CompareStat label="Avg BPM" before={stats.avgBpm} after={stats.avgBpmAfter}
                         delta={stats.avgBpm - stats.avgBpmAfter > 0 ? `-${stats.avgBpm - stats.avgBpmAfter}` : "—"} />
            <CompareStat label="Peak BPM" before={stats.maxBpm} after={stats.maxBpmAfter}
                         delta={stats.maxBpm - stats.maxBpmAfter > 0 ? `clamped` : "—"} />
            <CompareStat label="p95 BPM" before={stats.p95Bpm} after={stats.p95BpmAfter}
                         delta={stats.p95Bpm - stats.p95BpmAfter > 0 ? `${stats.p95Bpm - stats.p95BpmAfter} below` : "—"} />
          </div>
        </div>

        {/* Two-column controls */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
          {/* Device-aware reset */}
          <Card padding={20}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Icon name="cpu" size={16} style={{ color: "var(--accent)" }} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Device-aware reset</h3>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {selectedDevices?.join(" + ") || "no device selected"}
              </span>
            </div>

            <Slider label="BPM ceiling" valueLabel={`${bpmCap}`} value={bpmCap}
                    min={60} max={400} step={5} onChange={setBpmCap} />
            <div style={{ height: 14 }} />
            <Slider label="Latency budget (ms)" valueLabel={`${latency} ms`} value={latency}
                    min={0} max={250} step={5} onChange={setLatency} />
            <div style={{ height: 14 }} />
            <Slider label="Stroke smoothing" valueLabel={smoothing.toFixed(2)} value={smoothing}
                    min={0} max={1} step={0.05} onChange={setSmoothing} />

            <div style={{ marginTop: 16, padding: 12, background: "var(--surface-2)",
                          borderRadius: 6, fontSize: 11, color: "var(--text-dim)",
                          lineHeight: 1.5 }}>
              <Icon name="info" size={11} style={{ verticalAlign: "-1px", marginRight: 5 }} />
              Adjusts the funscript so it can actually be performed by the
              selected device — clamping BPM, smoothing transitions that exceed
              the device's stroke resolution.
            </div>
          </Card>

          {/* Groove */}
          <Card padding={20}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Icon name="wand-2" size={16} style={{ color: "var(--accent)" }} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Groove bias</h3>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                whole-script · tone is set per chapter
              </span>
            </div>

            <Slider label="Beat density" valueLabel={density.toFixed(2)} value={density}
                    min={0} max={1} step={0.05} onChange={setDensity} />
            <div style={{ height: 14 }} />
            <Slider label="Recenter mean position" valueLabel={`${recenter}`} value={recenter}
                    min={0} max={100} step={1} onChange={setRecenter} />
            <div style={{ height: 14 }} />
            <Slider label="Amplitude contrast" valueLabel={contrast.toFixed(2)} value={contrast}
                    min={0} max={1} step={0.05} onChange={setContrast} />
          </Card>
        </div>

        <div style={{ height: 22 }} />

        {/* Score breakdown */}
        <SectionLabel>Forge Score breakdown · how each axis is doing vs ideal</SectionLabel>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 8, overflow: "hidden" }}>
          {score.breakdown.map((row, i) => (
            <BreakdownRow key={row[3]} label={row[0]} value={row[1]} weight={row[2]}
                          last={i === score.breakdown.length - 1} />
          ))}
        </div>

        <div style={{ height: 22 }} />

        {/* Distribution stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Card padding={18}>
            <SectionLabel>BPM histogram</SectionLabel>
            <Histogram values={bpmList(FF_DATA.ACTIONS)} cap={bpmCap}
                       binSize={20} max={400} color="var(--accent)" />
            <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 11,
                          color: "var(--text-dim)" }}>
              <span>min {Math.round(stats.avgBpm * 0.3)}</span>
              <span>·</span>
              <span>median {stats.avgBpm}</span>
              <span>·</span>
              <span>p95 {stats.p95Bpm}</span>
              <span>·</span>
              <span>max {stats.maxBpm}</span>
              <div style={{ flex: 1 }} />
              <span style={{ color: "var(--accent-light, #ff7b7b)" }}>
                cap {bpmCap} → drops {stats.droppedActions}
              </span>
            </div>
          </Card>
          <Card padding={18}>
            <SectionLabel>Position distribution</SectionLabel>
            <Histogram values={FF_DATA.ACTIONS.map(a => a.pos)} mid={recenter}
                       binSize={5} max={100} color="#c77dff" />
            <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 11,
                          color: "var(--text-dim)" }}>
              <span>min 0</span>
              <span>·</span>
              <span>mean {stats.meanPos}</span>
              <span>·</span>
              <span>span {stats.spanRange}</span>
              <span>·</span>
              <span>max 100</span>
              <div style={{ flex: 1 }} />
              <span style={{ color: "#c77dff" }}>
                target mean {recenter}
              </span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── ForgeScoreCard ───────────────────────────────────────────────
function ForgeScoreCard({ score }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(255,75,75,0.08), rgba(199,125,255,0.04))",
      border: "1px solid var(--border)", borderRadius: 12, padding: 20,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                       textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Forge Score
        </span>
        <Pill tone="info" style={{ fontSize: 10 }}>vs Forge Perfection</Pill>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span className="mono" style={{ fontSize: 56, fontWeight: 700,
                                        color: score.band.color, lineHeight: 1,
                                        letterSpacing: "-0.02em" }}>
          {score.score}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-dim)" }}>/ 100</span>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div style={{
            display: "inline-grid", placeItems: "center",
            width: 38, height: 38, borderRadius: 8,
            background: score.band.color + "22",
            color: score.band.color,
            fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800,
          }}>{score.band.letter}</div>
          <div style={{ fontSize: 11, color: score.band.color, fontWeight: 600,
                        marginTop: 4 }}>{score.band.label}</div>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)",
                    overflow: "hidden", marginTop: 4 }}>
        <div style={{ width: `${score.score}%`, height: "100%",
                      background: score.band.color, transition: "all 200ms" }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>
        Score is computed from {score.breakdown.length} weighted axes — BPM ceiling,
        latency, smoothing, beat density, recenter, contrast, and tone alignment —
        compared against a corpus-derived "perfect" reset.
      </div>
    </div>
  );
}

function CompareStat({ label, before, after, delta, negative }) {
  return (
    <div style={{ padding: 14, background: "var(--surface)",
                  border: "1px solid var(--border)", borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)",
                                        textDecoration: "line-through" }}>{before}</span>
        <Icon name="arrow-right" size={11} style={{ color: "var(--text-dim)" }} />
        <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{after}</span>
      </div>
      <div style={{ fontSize: 11, marginTop: 4,
                    color: negative ? "var(--warning)" : "var(--text-muted)" }}>
        {delta}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, weight, last }) {
  const color = value >= 0.85 ? "#3ed598" :
                value >= 0.7 ? "#a3e635" :
                value >= 0.55 ? "#ffb547" :
                value >= 0.4 ? "#ff8c47" : "#ff5470";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "180px 1fr 60px 56px",
      gap: 14, padding: "12px 16px", alignItems: "center",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)",
                    overflow: "hidden" }}>
        <div style={{ width: `${value * 100}%`, height: "100%",
                      background: color, transition: "all 200ms" }} />
      </div>
      <span className="mono" style={{ fontSize: 12, color: color, fontWeight: 700,
                                      textAlign: "right" }}>
        {Math.round(value * 100)}
      </span>
      <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)",
                                      textAlign: "right" }}>
        ×{weight.toFixed(2)}
      </span>
    </div>
  );
}

function bpmList(actions) {
  const out = [];
  for (let i = 1; i < actions.length; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    if (dt > 0) out.push(60000 / (2 * dt));
  }
  return out;
}

function Histogram({ values, max = 400, binSize = 20, cap, mid, color = "var(--accent)" }) {
  const bins = [];
  const nBins = Math.ceil(max / binSize);
  for (let i = 0; i < nBins; i++) bins.push(0);
  values.forEach(v => {
    const i = Math.min(nBins - 1, Math.floor(v / binSize));
    if (i >= 0) bins[i]++;
  });
  const peak = Math.max(...bins, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80,
                  position: "relative" }}>
      {bins.map((b, i) => {
        const lo = i * binSize, hi = lo + binSize;
        const past = cap !== undefined && lo >= cap;
        return (
          <div key={i} style={{
            flex: 1, height: `${(b / peak) * 100}%`, minHeight: b > 0 ? 2 : 0,
            background: past ? "var(--text-dim)" : color, borderRadius: "2px 2px 0 0",
            opacity: past ? 0.4 : 1,
          }} title={`${lo}–${hi}: ${b}`} />
        );
      })}
      {cap !== undefined && (
        <div style={{ position: "absolute", top: 0, bottom: 0,
                      left: `${(cap / max) * 100}%`,
                      borderLeft: "2px dashed var(--accent-light, #ff7b7b)",
                      pointerEvents: "none" }} />
      )}
      {mid !== undefined && (
        <div style={{ position: "absolute", top: 0, bottom: 0,
                      left: `${(mid / max) * 100}%`,
                      borderLeft: "2px dashed #c77dff", pointerEvents: "none" }} />
      )}
    </div>
  );
}

window.DeviceTab = DeviceTab;
window.computeForgeScore = computeForgeScore;
