// Device — funscript-level reset.
//
// Adapted from ui_design/ui_kits/funscriptforge-app/tab-Device.jsx.
//
// Layout (per user direction 2026-05-15):
//   1. Original funscript chart            (top)
//   2. Forge Score card + compare stats    (still a design-only metric — the
//                                           backend score doesn't exist yet)
//   3. Settings (two cards: device-aware reset + groove bias)
//   4. Device-aware preview chart          (moved below settings)
//   5. Forge Score breakdown
//   6. BPM + position histograms
//
// Synced viewport: both charts (#1 and #4) share one `view` state so panning
// or zooming either one keeps the same time window in frame on both. Lets
// the user line up "before" vs "after" by eye without re-aligning.
//
// CLI wiring: slider changes locally re-derive preview actions in JS so the
// chart updates immediately. Real transforms will route through Tauri
// commands that shell out to `python cli.py transform` and friends — wired
// in once the slider/transform contracts are nailed down. JS-side preview
// stays as the instant-feedback layer; the CLI runs in the background and
// the accepted result becomes the next chain file.

import { useEffect, useMemo, useState } from 'react';
import { Pill, Card, Icon, Slider, SectionLabel } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { generatePreviewActions, parseDurationToMs } from '../lib/funscriptPreview.js';
import { listDevices } from '../api/forge.js';

export default function DeviceTab({ project, selectedDevices }) {
  // Settings — TODO: hydrate from project.ffmeta when sidecar loading lands.
  const [bpmCap, setBpmCap] = useState(180);
  const [latency, setLatency] = useState(60);
  const [smoothing, setSmoothing] = useState(0.55);
  const [density, setDensity] = useState(0.62);
  const [recenter, setRecenter] = useState(50);
  const [contrast, setContrast] = useState(0.5);

  // Full device catalog — used to look up maxBpm/icon/summary for the
  // devices the user selected on the Project tab.
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    let cancelled = false;
    listDevices().then((d) => { if (!cancelled) setDevices(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Resolve selected device IDs to full device records and find the
  // limiting one — the lowest maxBpm > 0 across the selection. Pure
  // vibration devices (maxBpm = 0) don't constrain stroke rate, so they
  // can't be the limiter.
  const selectedDeviceRecords = useMemo(() => {
    if (!selectedDevices?.length || !devices.length) return [];
    return selectedDevices
      .map((id) => devices.find((d) => d.id === id))
      .filter(Boolean);
  }, [selectedDevices, devices]);

  const limitingDevice = useMemo(() => {
    const candidates = selectedDeviceRecords.filter((d) => d.maxBpm > 0);
    if (!candidates.length) return null;
    return candidates.reduce((lo, d) => (d.maxBpm < lo.maxBpm ? d : lo));
  }, [selectedDeviceRecords]);

  // Project shape: from App.jsx openedProject. If null (user landed on this
  // tab without a project), show an empty state and bail.
  const baseActions = useMemo(() => {
    if (Array.isArray(project?.actions) && project.actions.length > 0) return project.actions;
    if (project) return generatePreviewActions(project, 1200);
    return [];
  }, [project]);
  const totalMs =
    project?.durationMs || parseDurationToMs(project?.duration) || 60000;

  // Shared viewport for the two charts. When either chart pans/zooms, both
  // re-render in lockstep. Reset to full extent when the project changes.
  const [view, setView] = useState({ start: 0, end: totalMs });
  useEffect(() => {
    setView({ start: 0, end: totalMs });
  }, [project?.id, totalMs]);

  const previewActions = useMemo(
    () => applyDeviceReset(baseActions, { bpmCap, smoothing, recenter, contrast }),
    [baseActions, bpmCap, smoothing, recenter, contrast],
  );

  const stats = useMemo(
    () => computeCompareStats(baseActions, previewActions),
    [baseActions, previewActions],
  );

  // Forge Score lives in the UI-only design space for now. The CLI doesn't
  // expose a score endpoint yet — wire to `python cli.py forge-score` (or
  // equivalent) once that ships. Until then, this is illustrative only.
  const score = useMemo(
    () => computeForgeScore({ bpmCap, latency, smoothing, density, recenter, contrast, tone: project?.toneSuggestion?.toLowerCase() ?? 'tease' }),
    [bpmCap, latency, smoothing, density, recenter, contrast, project?.toneSuggestion],
  );

  if (!project) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-dim)' }}>
        Pick a project on the Library or Project tab first.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px', background: 'var(--bg)' }}>
      {/* 1 — Original funscript */}
      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {baseActions.length.toLocaleString()} actions · drag both charts to scrub
          </span>
        }
      >
        Original funscript
      </SectionLabel>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 10,
          marginBottom: 22,
        }}
      >
        <FunscriptChart
          actions={baseActions}
          totalMs={totalMs}
          height={140}
          view={view}
          onViewChange={setView}
          bare
        />
      </div>

      {/* 2 — Forge Score + Devices in play + compare stats (three columns
              of equal row height; CSS grid stretches them to match). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) minmax(260px, 340px) 1fr',
          gap: 18,
          marginBottom: 22,
          alignItems: 'stretch',
        }}
      >
        <ForgeScoreCard score={score} />
        <DevicePanel
          devices={selectedDeviceRecords}
          limiting={limitingDevice}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <CompareStat
            label="Actions"
            before={stats.actions}
            after={stats.actionsAfter}
            delta={stats.droppedActions > 0 ? `-${stats.droppedActions} dropped` : 'no drops'}
            negative={stats.droppedActions > 0}
          />
          <CompareStat
            label="Avg BPM"
            before={stats.avgBpm}
            after={stats.avgBpmAfter}
            delta={stats.avgBpm - stats.avgBpmAfter > 0 ? `−${stats.avgBpm - stats.avgBpmAfter}` : '—'}
          />
          <CompareStat
            label="Peak BPM"
            before={stats.maxBpm}
            after={stats.maxBpmAfter}
            delta={stats.maxBpm - stats.maxBpmAfter > 0 ? 'clamped' : '—'}
          />
          <CompareStat
            label="p95 BPM"
            before={stats.p95Bpm}
            after={stats.p95BpmAfter}
            delta={stats.p95Bpm - stats.p95BpmAfter > 0 ? `${stats.p95Bpm - stats.p95BpmAfter} below` : '—'}
          />
        </div>
      </div>

      {/* 3 — Device-aware preview (moved above settings so the user can see
              original vs preview together without scrolling the controls
              out of view). Synced viewport with the original chart. */}
      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {previewActions.length.toLocaleString()} actions
            {stats.droppedActions > 0 ? ` · ${stats.droppedActions} clamped` : ''}
          </span>
        }
      >
        Device-aware preview · synced with original
      </SectionLabel>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          borderRadius: 8,
          padding: 10,
          marginBottom: 22,
          boxShadow: '0 0 0 1px rgba(255,75,75,0.10) inset',
        }}
      >
        <FunscriptChart
          actions={previewActions}
          totalMs={totalMs}
          height={140}
          view={view}
          onViewChange={setView}
          bare
        />
      </div>

      {/* 4 — Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Icon name="cpu" size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Device-aware reset</h3>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {selectedDevices?.length ? selectedDevices.join(' + ') : 'no device selected'}
            </span>
          </div>

          <Slider
            label="BPM ceiling"
            valueLabel={`${bpmCap}`}
            value={bpmCap}
            min={60}
            max={400}
            step={5}
            onChange={setBpmCap}
          />
          <div style={{ height: 14 }} />
          <Slider
            label="Latency budget (ms)"
            valueLabel={`${latency} ms`}
            value={latency}
            min={0}
            max={250}
            step={5}
            onChange={setLatency}
          />
          <div style={{ height: 14 }} />
          <Slider
            label="Stroke smoothing"
            valueLabel={smoothing.toFixed(2)}
            value={smoothing}
            min={0}
            max={1}
            step={0.05}
            onChange={setSmoothing}
          />

          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: 'var(--surface-2)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            <Icon name="info" size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />
            Adjusts the funscript so it can actually be performed by the selected
            device — clamping BPM, smoothing transitions beyond the device's stroke
            resolution.
          </div>
        </Card>

        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Icon name="sliders" size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Groove bias</h3>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
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

      {/* 5 — Score breakdown */}
      <SectionLabel>Forge Score breakdown · placeholder until CLI scoring lands</SectionLabel>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 22,
        }}
      >
        {score.breakdown.map((row, i) => (
          <BreakdownRow
            key={row[3]}
            label={row[0]}
            value={row[1]}
            weight={row[2]}
            last={i === score.breakdown.length - 1}
          />
        ))}
      </div>

      {/* 6 — Histograms */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card padding={18}>
          <SectionLabel>BPM histogram</SectionLabel>
          <Histogram
            values={bpmList(baseActions)}
            cap={bpmCap}
            binSize={20}
            max={400}
            color="var(--accent)"
          />
          <HistFooter
            tokens={[
              ['min', Math.round(stats.avgBpm * 0.3)],
              ['median', stats.avgBpm],
              ['p95', stats.p95Bpm],
              ['max', stats.maxBpm],
            ]}
            right={
              <span style={{ color: '#ff7b7b' }}>
                cap {bpmCap} → drops {stats.droppedActions}
              </span>
            }
          />
        </Card>
        <Card padding={18}>
          <SectionLabel>Position distribution</SectionLabel>
          <Histogram
            values={baseActions.map((a) => a.pos)}
            mid={recenter}
            binSize={5}
            max={100}
            color="#c77dff"
          />
          <HistFooter
            tokens={[
              ['min', 0],
              ['mean', stats.meanPos],
              ['span', stats.spanRange],
              ['max', 100],
            ]}
            right={<span style={{ color: '#c77dff' }}>target mean {recenter}</span>}
          />
        </Card>
      </div>
    </div>
  );
}

// ─── Transforms (JS-side preview) ─────────────────────────────────────────
// Mirror the shape of what cli.py transform does, but cheap enough to run
// on every slider tick. The CLI is the source of truth at Accept time; this
// is just instant feedback so the user can see slider changes live.

function applyDeviceReset(actions, params) {
  if (!actions || actions.length === 0) return [];
  let acts = applyBpmClamp(actions, params.bpmCap);
  if (params.recenter !== 50) acts = applyRecenter(acts, params.recenter);
  if (params.contrast !== 0.5) acts = applyContrast(acts, params.contrast);
  if (params.smoothing > 0.2) acts = applySmoothing(acts, params.smoothing);
  return acts;
}

function applyBpmClamp(actions, bpmCap) {
  if (!bpmCap || bpmCap >= 999) return actions;
  const minDt = 60000 / (2 * bpmCap);
  const out = [actions[0]];
  for (let i = 1; i < actions.length; i++) {
    if (actions[i].at - out[out.length - 1].at >= minDt) out.push(actions[i]);
  }
  return out;
}

function applyRecenter(actions, target) {
  if (actions.length === 0) return actions;
  const cur = actions.reduce((s, a) => s + a.pos, 0) / actions.length;
  const shift = target - cur;
  return actions.map((a) => ({
    ...a,
    pos: clampPos(Math.round(a.pos + shift)),
  }));
}

function applyContrast(actions, contrast) {
  const k = (contrast - 0.5) * 1.4;
  return actions.map((a) => ({
    ...a,
    pos: clampPos(Math.round(50 + (a.pos - 50) * (1 + k))),
  }));
}

function applySmoothing(actions, w) {
  if (actions.length < 3) return actions;
  return actions.map((a, i, arr) => {
    const p = arr[Math.max(0, i - 1)].pos;
    const n = arr[Math.min(arr.length - 1, i + 1)].pos;
    return { ...a, pos: Math.round(a.pos * (1 - w) + ((p + n) / 2) * w) };
  });
}

function clampPos(n) { return Math.max(0, Math.min(100, n)); }

// ─── Stats ───────────────────────────────────────────────────────────────

function computeCompareStats(original, preview) {
  const oBpm = bpmList(original);
  const pBpm = bpmList(preview);
  const meanPos = original.length
    ? Math.round(original.reduce((s, a) => s + a.pos, 0) / original.length)
    : 0;
  const min = original.length ? Math.min(...original.map((a) => a.pos)) : 0;
  const max = original.length ? Math.max(...original.map((a) => a.pos)) : 0;
  return {
    actions: original.length,
    actionsAfter: preview.length,
    droppedActions: Math.max(0, original.length - preview.length),
    avgBpm: avg(oBpm),
    avgBpmAfter: avg(pBpm),
    maxBpm: Math.round(Math.max(0, ...oBpm)),
    maxBpmAfter: Math.round(Math.max(0, ...pBpm)),
    p95Bpm: pct(oBpm, 0.95),
    p95BpmAfter: pct(pBpm, 0.95),
    meanPos,
    spanRange: max - min,
  };
}

function bpmList(actions) {
  if (!actions) return [];
  const out = [];
  for (let i = 1; i < actions.length; i++) {
    const dt = actions[i].at - actions[i - 1].at;
    if (dt > 0) out.push(60000 / (2 * dt));
  }
  return out;
}

function avg(xs) {
  return xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
}

function pct(xs, p) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length * p)]);
}

// ─── Forge Score (UI-only placeholder until CLI ships scoring) ───────────

function computeForgeScore({ bpmCap, latency, smoothing, density, recenter, contrast, tone }) {
  const bpmFit       = clamp01(1 - Math.abs(bpmCap - 180) / 220);
  const latencyFit   = clamp01(1 - latency / 220);
  const smoothFit    = bell(smoothing, 0.55, 0.35);
  const densityFit   = bell(density, 0.62, 0.4);
  const recenterFit  = bell(recenter / 100, 0.5, 0.4);
  const contrastFit  = bell(contrast, 0.5, 0.45);
  const toneFit =
    tone === 'tender'   ? 0.78 :
    tone === 'build'    ? 0.84 :
    tone === 'tease'    ? 0.91 :
    tone === 'edge'     ? 0.86 :
    tone === 'climax'   ? 0.74 :
    tone === 'dominant' ? 0.81 : 0.7;
  const weights = [
    ['BPM ceiling vs device',  bpmFit,      0.18, 'bpm-cap'],
    ['Latency budget',         latencyFit,  0.10, 'latency'],
    ['Stroke smoothing',       smoothFit,   0.14, 'smooth'],
    ['Beat density / groove',  densityFit,  0.16, 'density'],
    ['Mean position recenter', recenterFit, 0.10, 'recenter'],
    ['Amplitude contrast',     contrastFit, 0.16, 'contrast'],
    ['Tone alignment',         toneFit,     0.16, 'tone'],
  ];
  const totalW = weights.reduce((s, w) => s + w[2], 0);
  const score100 = Math.round(
    (weights.reduce((s, w) => s + w[1] * w[2], 0) / totalW) * 100,
  );
  const band =
    score100 >= 92 ? { letter: 'S', label: 'Forge-perfect', color: '#3ed598' } :
    score100 >= 82 ? { letter: 'A', label: 'Strong',        color: '#a3e635' } :
    score100 >= 70 ? { letter: 'B', label: 'Solid',         color: '#ffb547' } :
    score100 >= 58 ? { letter: 'C', label: 'Workable',      color: '#ff8c47' } :
                     { letter: 'D', label: 'Needs work',    color: '#ff5470' };
  return { score: score100, band, breakdown: weights };
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function bell(x, mid, w) { return clamp01(1 - Math.abs(x - mid) / w); }

// ─── Sub-components ──────────────────────────────────────────────────────

function ForgeScoreCard({ score }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(255,75,75,0.08), rgba(199,125,255,0.04))',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        // Sit at the top of the row rather than stretching to match the
        // (taller) DevicePanel — keeps the score card visually compact.
        alignSelf: 'start',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Forge Score
        </span>
        <Pill tone="info" style={{ fontSize: 10 }}>placeholder</Pill>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 56, fontWeight: 700, color: score.band.color, lineHeight: 1, letterSpacing: '-0.02em', fontFamily: 'var(--font-mono)' }}>
          {score.score}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>/ 100</span>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 38,
              height: 38,
              borderRadius: 8,
              background: score.band.color + '22',
              color: score.band.color,
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {score.band.letter}
          </div>
          <div style={{ fontSize: 11, color: score.band.color, fontWeight: 600, marginTop: 4 }}>
            {score.band.label}
          </div>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 4 }}>
        <div style={{ width: `${score.score}%`, height: '100%', background: score.band.color, transition: 'all 200ms' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        Synthesised in JS while the real CLI scoring endpoint is built. Wire to{' '}
        <code style={{ background: 'var(--surface-2)', padding: '0 4px', borderRadius: 2 }}>
          python cli.py forge-score
        </code>{' '}
        once it ships.
      </div>
    </div>
  );
}

function DevicePanel({ devices, limiting }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 8,
        }}
      >
        Devices in play
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {devices.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '6px 0' }}>
            No devices selected — pick at least one on the Project tab.
          </div>
        ) : (
          devices.map((d) => {
            const isLimit = limiting && d.id === limiting.id;
            const role = isLimit
              ? 'limits BPM'
              : d.maxBpm === 0
                ? 'vibration · no BPM cap'
                : 'headroom';
            return <DeviceRow key={d.id} device={d} role={role} isLimit={isLimit} />;
          })
        )}
      </div>
      {limiting && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'rgba(255,75,75,0.07)',
            border: '1px solid rgba(255,75,75,0.2)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.45,
          }}
        >
          <Icon name="info" size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />
          <strong style={{ color: 'var(--text)' }}>{limiting.label}</strong>{' '}
          caps the chain at <strong style={{ color: '#ff7b7b' }}>{limiting.maxBpm} BPM</strong>.
          Set the BPM ceiling at or below this number — anything higher gets clamped on send.
        </div>
      )}
    </div>
  );
}

function DeviceRow({ device, role, isLimit }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        background: isLimit ? 'rgba(255,75,75,0.10)' : 'var(--surface-2)',
        border: `1px solid ${isLimit ? 'rgba(255,75,75,0.35)' : 'transparent'}`,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 5,
          display: 'grid',
          placeItems: 'center',
          background: isLimit ? 'var(--accent)' : 'var(--surface)',
          color: isLimit ? '#fff' : 'var(--text-muted)',
        }}
      >
        <Icon name={device.icon || 'cpu'} size={12} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{device.label}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{role}</div>
      </div>
      {device.maxBpm > 0 && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: isLimit ? '#ff7b7b' : 'var(--text)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {device.maxBpm}
        </span>
      )}
      {isLimit && (
        <Pill tone="danger" style={{ fontSize: 9 }}>
          limit
        </Pill>
      )}
    </div>
  );
}

function CompareStat({ label, before, after, delta, negative }) {
  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', textDecoration: 'line-through', fontFamily: 'var(--font-mono)' }}>
          {before}
        </span>
        <Icon name="arrow-right" size={11} style={{ color: 'var(--text-dim)' }} />
        <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{after}</span>
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: negative ? '#ffb547' : 'var(--text-muted)' }}>
        {delta}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, weight, last }) {
  const color =
    value >= 0.85 ? '#3ed598' :
    value >= 0.7  ? '#a3e635' :
    value >= 0.55 ? '#ffb547' :
    value >= 0.4  ? '#ff8c47' : '#ff5470';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 60px 56px',
        gap: 14,
        padding: '12px 16px',
        alignItems: 'center',
        borderBottom: last ? 'none' : '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: color, transition: 'all 200ms' }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 700, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        {Math.round(value * 100)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
        ×{weight.toFixed(2)}
      </span>
    </div>
  );
}

function Histogram({ values, max = 400, binSize = 20, cap, mid, color = 'var(--accent)' }) {
  const bins = [];
  const nBins = Math.ceil(max / binSize);
  for (let i = 0; i < nBins; i++) bins.push(0);
  values.forEach((v) => {
    const i = Math.min(nBins - 1, Math.floor(v / binSize));
    if (i >= 0) bins[i]++;
  });
  const peak = Math.max(...bins, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, position: 'relative' }}>
      {bins.map((b, i) => {
        const lo = i * binSize;
        const hi = lo + binSize;
        const past = cap !== undefined && lo >= cap;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${(b / peak) * 100}%`,
              minHeight: b > 0 ? 2 : 0,
              background: past ? 'var(--text-dim)' : color,
              borderRadius: '2px 2px 0 0',
              opacity: past ? 0.4 : 1,
            }}
            title={`${lo}–${hi}: ${b}`}
          />
        );
      })}
      {cap !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(cap / max) * 100}%`,
            borderLeft: '2px dashed #ff7b7b',
            pointerEvents: 'none',
          }}
        />
      )}
      {mid !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(mid / max) * 100}%`,
            borderLeft: '2px dashed #c77dff',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

function HistFooter({ tokens, right }) {
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-dim)' }}>
      {tokens.map((t, i) => (
        <span key={t[0]}>
          {i > 0 && <span style={{ marginRight: 10 }}>·</span>}
          {t[0]} {t[1]}
        </span>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
