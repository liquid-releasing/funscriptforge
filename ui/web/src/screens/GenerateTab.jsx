// Generate — author the MAIN funscript by shaping two macro curves:
// RANGE (how far each stroke goes) and PACE (how busy). Beta: presets only,
// no draggable handles. The live result renders in the FunscriptChart above
// the lanes; the "What to fix" diagnosis panel on the left grades it and hands
// the user one-click fixes. See DESIGN_DECISIONS.md.
//
// ENGINE: when the project has media and we're in the desktop app, the REAL
// videoflow engine runs (Pace→density arc, Range→amplitude-gain arc) via
// forge.generateFunscript — graded against the proven band + speed histogram.
// With no backend/media (browser dev, sample) we fall back to the believable
// STAND-IN (data/generate.js) so the verified UI never breaks. The diagnosis
// oracle (diagnose) runs on whichever actions we have, unchanged.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Pill, SectionLabel, Icon } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import PresetLane from '../components/PresetLane.jsx';
import { isTauri, generateFunscript } from '../api/forge.js';
import {
  DEFAULT_RANGE, DEFAULT_PACE, RANGE_PRESETS, PACE_PRESETS, presetIdOf,
  sampleCurve, generateFromLanes, diagnose, verdictFor, topFix, deadAirNote, TARGET_DECILES,
} from '../data/generate.js';

// The live-preview funscript is a CACHE — it belongs in the hidden .forge dir
// (overwritten each regenerate), NOT next to the source where it clutters and
// shadows the original. Permanent, versioned output is the Export tab's job.
// Mirrors videoflow.sidecar.forge_dir: <dir>/.<stem>.forge/<stem>.generated.funscript
function forgeGeneratedPath(mediaPath) {
  const bs = mediaPath.lastIndexOf('\\');
  const fs = mediaPath.lastIndexOf('/');
  const i = Math.max(bs, fs);
  const sep = bs > fs ? '\\' : '/';
  const dir = i >= 0 ? mediaPath.slice(0, i) : '.';
  const base = i >= 0 ? mediaPath.slice(i + 1) : mediaPath;
  const stem = base.replace(/\.[^.]+$/, '');
  return `${dir}${sep}.${stem}.forge${sep}${stem}.generated.funscript`;
}

// Sample a control-point curve into N evenly-spaced values for PresetLane and
// for the CLI curve strings (the engine resamples per-beat from these).
const LANE_SAMPLES = 64;
function curveSamples(pts) {
  const out = [];
  for (let i = 0; i < LANE_SAMPLES; i += 1) out.push(sampleCurve(pts, i / (LANE_SAMPLES - 1)));
  return out;
}
function curveStr(pts) {
  return curveSamples(pts).map((v) => v.toFixed(3)).join(',');
}

// Speed-band palette: cool (slow) → hot (flash). Mirrors the heatmap users know.
const SPEED_COLORS = ['#3ed598', '#7ed957', '#ffd23f', '#ffb547', '#ff8c42', '#ff5d5d', '#e83e8c'];
const SPEED_SHORT = ['v.slow', 'slow', 'med', 'fast', 'v.fast', 'ultra', 'flash'];

// ── "What to fix" diagnosis — verdict → evidence → one-click fix ────────────
function Histogram({ deciles }) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3, height: 64, padding: '0 2px' }}>
      {deciles.map((d, i) => (
        <div key={i} style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
          {/* target ghost — what a good spread looks like */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${TARGET_DECILES[i] * 100}%`, border: '1px dashed var(--border-strong)', borderBottom: 'none', borderRadius: '2px 2px 0 0', opacity: 0.6 }} />
          <div style={{ width: '100%', height: `${d * 100}%`, background: 'var(--accent)', borderRadius: '2px 2px 0 0', opacity: 0.85 }} />
        </div>
      ))}
    </div>
  );
}

// F.A.P.S-style movement-speed histogram — a stacked bar across the 7 bands.
function SpeedBar({ speed }) {
  const pct = speed.pct || [];
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Movement speed</div>
      <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-3, #232735)' }}>
        {pct.map((p, i) => (
          p > 0 ? <div key={i} title={`${SPEED_SHORT[i]} ${p}%`} style={{ width: `${p}%`, background: SPEED_COLORS[i] }} /> : null
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8 }}>
        {pct.map((p, i) => (
          p >= 3 ? (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-dim)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SPEED_COLORS[i] }} />
              {SPEED_SHORT[i]} {Math.round(p)}%
            </span>
          ) : null
        ))}
      </div>
    </div>
  );
}

// Two band ticks — "measured against the proven band" (the authoritative grade
// when the real engine ran). rate=pace dynamics, velocity=intensity dynamics.
function BandChips({ band }) {
  const chip = (ok, label) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '2px 7px', borderRadius: 999, background: ok ? 'rgba(62,213,152,0.12)' : 'var(--surface-3, #232735)', color: ok ? 'var(--success)' : 'var(--text-dim)', border: `1px solid ${ok ? 'var(--success)' : 'var(--border)'}` }}>
      <span style={{ fontWeight: 700 }}>{ok ? '✓' : '–'}</span> {label}
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {chip(band.rate_cov_in_band, 'pace in band')}
      {chip(band.velocity_cov_in_band, 'intensity in band')}
    </div>
  );
}

function FixCard({ icon, title, why, done, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={done}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '10px 12px', borderRadius: 'var(--r-3, 8px)', cursor: done ? 'default' : 'pointer',
        background: done ? 'rgba(62,213,152,0.08)' : 'var(--surface-2)',
        border: `1px solid ${done ? 'var(--success)' : 'var(--border)'}`,
        color: 'var(--text)', fontFamily: 'inherit',
      }}
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: done ? 'var(--success)' : 'var(--surface-3, #232735)', color: done ? '#0e1117' : 'var(--text-soft)' }}>
        {done ? <span style={{ fontSize: 15, fontWeight: 800 }}>✓</span> : <Icon name={icon} size={15} />}
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>{done ? 'looks good' : why}</span>
      </span>
      {!done && <Icon name="arrow-right" size={15} style={{ color: 'var(--text-dim)' }} />}
    </button>
  );
}

function DiagnosisPanel({ diag, band, speed, applyFix, railsDone, arcDone }) {
  const verdict = verdictFor(diag.dynamics);
  const fix = topFix(diag);
  const toneColor = { success: 'var(--success)', info: 'var(--info, #4dabf7)', warn: 'var(--warn, #ffb547)' }[verdict.tone];
  return (
    <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionLabel>What to fix</SectionLabel>

      {/* headline verdict + the single highest-impact fix */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: toneColor }}>{verdict.word}</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>contrast {Math.round(diag.dynamics * 100)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3, #232735)', overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ width: `${Math.round(diag.dynamics * 100)}%`, height: '100%', background: toneColor }} />
        </div>
        {fix ? (
          <Button kind="primary" size="sm" icon="zap" onClick={() => applyFix(fix)} style={{ width: '100%' }}>
            Biggest win: {fix.label}
          </Button>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700 }}>✓</span> Nothing flagged — hit play.
          </div>
        )}
        {band && <BandChips band={band} />}
      </div>

      {/* where the strokes land */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Where the strokes land</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
          {diag.rails < 0.22 ? 'Bunched mid-range — barely touching the rails.' : 'Spread across the range — good reach.'}
          <span style={{ opacity: 0.6 }}> (dashed = target)</span>
        </div>
        <Histogram deciles={diag.deciles} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
          <span>shallow</span><span>full</span>
        </div>
      </div>

      {speed && speed.n > 0 && <SpeedBar speed={speed} />}

      {/* dead air — a beatless stretch the audio engine can't fill; point the
          user at events rather than inventing motion. */}
      {deadAirNote(diag) && (
        <div style={{ fontSize: 11, color: 'var(--warn, #ffb547)', background: 'rgba(255,181,71,0.08)', border: '1px solid var(--warn, #ffb547)', borderRadius: 'var(--r-3, 8px)', padding: '8px 10px', display: 'flex', gap: 6 }}>
          <span>⚠</span><span>{deadAirNote(diag)}</span>
        </div>
      )}

      {/* explicit fixes — always paired with their action */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FixCard icon="gauge" title="Ease the pace" why="too fast to play" done={!diag.tooFast} onClick={() => applyFix({ lane: 'pace', presetId: 'gentle' })} />
        <FixCard icon="maximize" title="Fill the rails" why="reach shallow → full" done={railsDone} onClick={() => applyFix({ lane: 'range', presetId: 'full' })} />
        <FixCard icon="trending-up" title="Add an arc" why="build → climax → ease" done={arcDone} onClick={() => applyFix({ lane: 'pace', presetId: 'burn' })} />
      </div>
    </div>
  );
}

export default function GenerateTab({ project, onActionsPatch, persisted, onPersist, onBusy }) {
  // Seed from the session-persisted curves (App owns them) so switching tabs
  // and coming back keeps the user's picked presets instead of resetting to
  // the flat default — the "why is it Flat again?" dogfood finding.
  const [rangePts, setRangePts] = useState(persisted?.rangePts || DEFAULT_RANGE);
  const [pacePts, setPacePts] = useState(persisted?.pacePts || DEFAULT_PACE);
  // Real-engine result (null until/unless the videoflow path runs).
  const [gen, setGen] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [justSet, setJustSet] = useState(false);

  // Mirror curve picks up to App so they survive this tab unmounting.
  useEffect(() => {
    if (onPersist) onPersist({ rangePts, pacePts });
  }, [rangePts, pacePts, onPersist]);

  const durationMs = project?.durationMs || 595000;
  const mediaPath = project?.mediaPath || null;
  // The real engine needs the desktop bridge AND a media file to analyze.
  const useRealEngine = isTauri() && !!mediaPath;

  // Stand-in is always computed (instant): the fallback when there's no
  // backend, and the immediate preview before the first real result lands.
  const standIn = useMemo(
    () => generateFromLanes(rangePts, pacePts, durationMs),
    [rangePts, pacePts, durationMs],
  );

  // Drive the real engine on curve change. Stale-guarded so a rapid re-pick
  // doesn't paint an older result; errors fall back silently to the stand-in.
  const runId = useRef(0);
  useEffect(() => {
    if (!useRealEngine) { setGen(null); setGenerating(false); return undefined; }
    const id = (runId.current += 1);
    setGenerating(true);
    setGenError(null);
    // Open the App footer's progress strip — the ff:progress stream then fills
    // it with the stage explanation ("Detecting beats…", "Generating motion
    // curve…"). The footer is where the user watches the recalculation happen.
    if (onBusy) onBusy({ message: 'Generating from the beats…', steps: [] });
    generateFunscript({
      outputPath: forgeGeneratedPath(mediaPath),
      mediaPath,
      paceCurve: curveStr(pacePts),
      rangeCurve: curveStr(rangePts),
      source: 'percussive',
    })
      .then((payload) => {
        if (id !== runId.current) return;
        if (!payload) { setGen(null); return; }
        setGen({
          actions: payload.actions_list || [],
          band: payload.band || null,
          speed: payload.stats?.speed || null,
          fromCache: !!payload.from_cache,
          bpm: payload.bpm,
        });
      })
      .catch((e) => { if (id === runId.current) setGenError(String(e?.message || e)); })
      .finally(() => {
        if (id !== runId.current) return;
        setGenerating(false);
        if (onBusy) onBusy(null);
      });
    return undefined;
  }, [useRealEngine, mediaPath, rangePts, pacePts, project?.path, onBusy]);

  const actions = gen?.actions?.length ? gen.actions : standIn;
  const diag = useMemo(() => diagnose(actions, durationMs), [actions, durationMs]);

  const applyFix = ({ lane, presetId }) => {
    if (lane === 'range') {
      const pr = RANGE_PRESETS.find((p) => p.id === presetId);
      if (pr) setRangePts(pr.pts.map((p) => ({ ...p })));
    } else {
      const pr = PACE_PRESETS.find((p) => p.id === presetId);
      if (pr) setPacePts(pr.pts.map((p) => ({ ...p })));
    }
  };

  const railsDone = diag.rails >= 0.22;
  const arcDone = diag.dynamics >= 0.55;

  if (!project?.path) {
    return (
      <div className="ff-placeholder" style={{ padding: 40 }}>
        <h2>Generate</h2>
        <p>Open a project to author its funscript.</p>
      </div>
    );
  }

  // Engine status pill: live (real engine result), generating, or preview
  // (stand-in — no media / browser dev).
  const statusPill = generating
    ? <Pill tone="info">generating…</Pill>
    : gen
      ? <Pill tone="success">{gen.fromCache ? 'live · cached' : 'live'}</Pill>
      : <Pill tone="neutral">{useRealEngine ? 'stand-in' : 'preview'}</Pill>;

  return (
    <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', height: '100%' }}>
      <div>
        <SectionLabel>Generate</SectionLabel>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '2px 0 2px' }}>Author the funscript</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
          Shape two curves — <strong style={{ color: 'var(--accent)' }}>Range</strong> (how far) and{' '}
          <strong style={{ color: 'var(--info, #4dabf7)' }}>Pace</strong> (how busy). Intensity is what you watch.
          <span style={{ marginLeft: 8 }}>{statusPill}</span>
        </p>
        {genError && (
          <p style={{ color: 'var(--warn, #ffb547)', margin: '6px 0 0', fontSize: 12 }}>
            Engine: {genError} — showing the stand-in preview.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <DiagnosisPanel
          diag={diag} band={gen?.band} speed={gen?.speed}
          applyFix={applyFix} railsDone={railsDone} arcDone={arcDone}
        />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* live result */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
                live result · {actions.length.toLocaleString()} actions
                {gen?.bpm ? ` · ${Math.round(gen.bpm)} BPM` : ''}
                {generating && <span style={{ color: 'var(--info, #4dabf7)' }}>· recalculating…</span>}
              </span>
              {onActionsPatch && (
                <Button
                  kind={justSet ? 'primary' : 'ghost'} size="sm"
                  icon="save"
                  disabled={generating}
                  onClick={() => { onActionsPatch(actions); setJustSet(true); setTimeout(() => setJustSet(false), 1600); }}
                >
                  {justSet ? 'Set ✓' : 'Set as working funscript'}
                </Button>
              )}
            </div>
            <div style={{ cursor: generating ? 'progress' : 'default', opacity: generating ? 0.6 : 1, transition: 'opacity 0.15s' }}>
              <FunscriptChart actions={actions} totalMs={durationMs} height={200} railGuides />
            </div>
          </div>

          {/* the two lanes — same PresetLane widget the Channels Passages lane uses */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', overflow: 'hidden' }}>
            <PresetLane
              title="RANGE" hint="how far" color="var(--accent)"
              presets={RANGE_PRESETS} activeId={presetIdOf(rangePts, RANGE_PRESETS)}
              onPick={(id) => { const pr = RANGE_PRESETS.find((p) => p.id === id); if (pr) setRangePts(pr.pts.map((p) => ({ ...p }))); }}
              samples={curveSamples(rangePts)}
            />
            <PresetLane
              title="PACE" hint="how busy" color="var(--info, #4dabf7)"
              presets={PACE_PRESETS} activeId={presetIdOf(pacePts, PACE_PRESETS)}
              onPick={(id) => { const pr = PACE_PRESETS.find((p) => p.id === id); if (pr) setPacePts(pr.pts.map((p) => ({ ...p }))); }}
              samples={curveSamples(pacePts)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
