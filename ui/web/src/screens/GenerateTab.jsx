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
import { Button, Pill, SectionLabel, Icon, MediaViewer } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import PresetLane from '../components/PresetLane.jsx';
import { isTauri, generateFunscript } from '../api/forge.js';
import { toMediaUrl } from '../lib/mediaUrl.js';
import {
  DEFAULT_RANGE, DEFAULT_PACE, RANGE_PRESETS, PACE_PRESETS, presetIdOf,
  sampleCurve, generateFromLanes, diagnose, verdictFor, topFix, deadAirNote, TARGET_DECILES,
  positionAtTime, liftStart,
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
function samplesStr(samples) {
  return samples.map((v) => Math.max(0, Math.min(1, v)).toFixed(3)).join(',');
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

function DiagnosisPanel({ diag, band, speed, applyFix, railsDone, arcDone, paceEased, calculating }) {
  if (calculating) {
    return (
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SectionLabel>What to fix</SectionLabel>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 14, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5 }}>
          Calculating the funscript… the diagnosis appears once the real result is ready.
        </div>
      </div>
    );
  }
  const verdict = verdictFor(diag.dynamics);
  const fix = topFix({ ...diag, paceEased });
  // The too-fast card escalates: ease the pace first, but once pace is already
  // gentle and it's STILL too fast, the lever is RANGE (shorter strokes). Keeps
  // the card from dead-ending on a button that can no longer help.
  const speedFix = diag.tooFast && paceEased
    ? { title: 'Shorten the range', why: 'long strokes are what’s fast now', fix: { lane: 'range', presetId: 'tease' } }
    : { title: 'Ease the pace', why: 'too fast to play', fix: { lane: 'pace', presetId: 'gentle' } };
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
            <span style={{ fontWeight: 700 }}>✓</span> Nothing flagged — looks good.
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
        <FixCard icon="gauge" title={speedFix.title} why={speedFix.why} done={!diag.tooFast} onClick={() => applyFix(speedFix.fix)} />
        <FixCard icon="maximize" title="Fill the rails" why="reach shallow → full" done={railsDone} onClick={() => applyFix({ lane: 'range', presetId: 'full' })} />
        <FixCard icon="trending-up" title="Add an arc" why="build → climax → ease" done={arcDone} onClick={() => applyFix({ lane: 'pace', presetId: 'burn' })} />
      </div>
    </div>
  );
}

// "Depth now" — the simulated device position at the playhead, so the user
// feels where the stroke is during playback (0 = shallow, 100 = full reach).
// A quiet companion to MediaViewer's scrolling tape; the body decides.
function DepthMeter({ pos }) {
  const v = pos == null ? null : Math.max(0, Math.min(100, pos));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 64 }}>depth now</span>
      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-3, #232735)', overflow: 'hidden' }}>
        {v != null && (
          <div style={{ width: `${v}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.08s linear' }} />
        )}
      </div>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-soft)', minWidth: 28 }}>{v == null ? '—' : Math.round(v)}</span>
    </div>
  );
}

export default function GenerateTab({
  project, onActionsPatch, persisted, onPersist, onGenerated, onBusy,
  // The last real engine result + the input signature that produced it,
  // owned by App so it survives this tab unmounting. Without this, returning
  // to Generate re-ran the full (10-minute) analyze+generate and flashed the
  // smooth stand-in meanwhile (dogfood 2026-06-14: "has to start over / all
  // blue / mismatch with Chapters"). persistedResult = { sig, payload }.
  persistedResult, onResult,
  // Audio sidecars (same ones the Chapters player uses) so the Play view's
  // Audio/Spectro modes show the real waveform + spectrogram, not the blocky
  // placeholder.
  trackPeaks, trackSpectrogram, trackBeats,
}) {
  // Seed from the session-persisted curves (App owns them) so switching tabs
  // and coming back keeps the user's picked presets instead of resetting to
  // the flat default — the "why is it Flat again?" dogfood finding.
  const [rangePts, setRangePts] = useState(persisted?.rangePts || DEFAULT_RANGE);
  const [pacePts, setPacePts] = useState(persisted?.pacePts || DEFAULT_PACE);
  // Per-lane START height (0 = preset as authored; up = begin higher, same
  // rail, gentler slope). Replaces the old "% influence" toward-the-mean blend
  // — see liftStart. Seeds tolerate the old rangeAmount key (ignored).
  const [rangeStart, setRangeStart] = useState(persisted?.rangeStart ?? 0);
  const [paceStart, setPaceStart] = useState(persisted?.paceStart ?? 0);
  // Texture/Life — bounded amplitude variation that pulls quiet beats off the
  // rails for gold's mid shoulder (and lowers speed). Default 0.2; HARD-CAPPED
  // at 0.35 because the measured sweep showed >=0.4 collapses the bimodal
  // rails backbone into the refuted centre bell. See data/generate.js.
  const [texture, setTexture] = useState(persisted?.texture ?? 0.2);
  // Real-engine result — seeded from App's persisted result so returning to
  // this tab shows the REAL funscript immediately instead of re-running the
  // multi-minute analyze+generate and flashing the mid-bunched stand-in.
  const [gen, setGen] = useState(() => persistedResult?.payload || null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [justSet, setJustSet] = useState(false);
  // Preview transport: 'overview' = the static full-shape chart (pairs with
  // the diagnosis histogram); 'play' = the MediaViewer playing the generated
  // funscript against the video so the user can FEEL it ("the body decides").
  const [viewMode, setViewMode] = useState('overview');
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Mirror curve picks + start-heights up to App so they survive this tab
  // unmounting.
  useEffect(() => {
    if (onPersist) onPersist({ rangePts, pacePts, rangeStart, paceStart, texture });
  }, [rangePts, pacePts, rangeStart, paceStart, texture, onPersist]);

  // The start-lifted sample arrays drive both the lane curves and the engine,
  // so what you see is what generates.
  const rangeSamples = useMemo(() => liftStart(curveSamples(rangePts), rangeStart), [rangePts, rangeStart]);
  const paceSamples = useMemo(() => liftStart(curveSamples(pacePts), paceStart), [pacePts, paceStart]);

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

  // A signature of everything that changes the generated output. Regeneration
  // is gated on this so it only re-runs when a SETTING actually changed — not
  // on every remount (the dogfood "10 minutes to recreate on every return").
  const sig = useMemo(
    () => `${mediaPath || ''}|${samplesStr(paceSamples)}|${samplesStr(rangeSamples)}|${texture}`,
    [mediaPath, paceSamples, rangeSamples, texture],
  );

  // Drive the real engine on SETTING change. Stale-guarded so a rapid re-pick
  // doesn't paint an older result; errors fall back silently to the stand-in.
  const runId = useRef(0);
  // The sig whose result we already hold (seeded from App on remount). When it
  // matches the current sig, the effect short-circuits — no re-run.
  const doneSigRef = useRef(persistedResult?.sig || null);
  useEffect(() => {
    if (!useRealEngine) { setGen(null); setGenerating(false); doneSigRef.current = null; return undefined; }
    // Already have the result for these exact settings → don't re-run the
    // multi-minute generate just because the tab remounted.
    if (doneSigRef.current === sig) return undefined;
    // Debounce: dragging a slider (or rapid preset picks) re-fires this on
    // every tick. Wait until the curves settle (~450ms) before generating —
    // otherwise a long file runs a multi-minute analyze per drag pixel. The
    // lane curves still update live; only generation waits.
    const timer = setTimeout(() => {
      const id = (runId.current += 1);
      setGenerating(true);
      setGenError(null);
      // Open the App footer's progress strip — the ff:progress stream then
      // fills it with the stage explanation ("Detecting beats…", "Generating
      // motion curve…"). The footer is where the recalculation is watched.
      if (onBusy) onBusy({ message: 'Generating from the beats…', steps: [] });
      generateFunscript({
        outputPath: forgeGeneratedPath(mediaPath),
        mediaPath,
        paceCurve: samplesStr(paceSamples),
        rangeCurve: samplesStr(rangeSamples),
        texture,
        source: 'percussive',
      })
        .then((payload) => {
          if (id !== runId.current) return;
          if (!payload) { setGen(null); return; }
          const result = {
            actions: payload.actions_list || [],
            band: payload.band || null,
            speed: payload.stats?.speed || null,
            fromCache: !!payload.from_cache,
            bpm: payload.bpm,
            sig,  // tag the result so the UI knows it matches the live settings
          };
          setGen(result);
          doneSigRef.current = sig;
          // Persist up to App so this survives the tab unmounting.
          if (onResult) onResult({ sig, payload: result });
        })
        .catch((e) => { if (id === runId.current) setGenError(String(e?.message || e)); })
        .finally(() => {
          if (id !== runId.current) return;
          setGenerating(false);
          if (onBusy) onBusy(null);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [useRealEngine, sig, onBusy, onResult]);

  // Do we hold the REAL engine result for the live settings? If so show it.
  // If the real engine is running (or hasn't produced this sig yet), we're
  // CALCULATING — show that, never the mid-bunched stand-in, which misrepresents
  // the real output for the 3-10 min a long generate takes (dogfood 2026-06-14:
  // "rather see calculating than an incorrect version"). The stand-in is only
  // for the no-engine browser preview.
  const haveCurrent = !!(gen && gen.sig === sig && gen.actions?.length);
  // Calculating only while a real run is pending/in-flight — NOT after an error
  // (then we fall back to the stand-in with the error note, not a forever spinner).
  const calculating = useRealEngine && !haveCurrent && !genError;
  const actions = haveCurrent ? gen.actions : ((useRealEngine && !genError) ? [] : standIn);
  const diag = useMemo(() => diagnose(actions, durationMs), [actions, durationMs]);

  // Lift the REAL preview up to App so the footer's "Continue with this
  // funscript" adopts the actual draft — never the stand-in or an empty calc.
  useEffect(() => {
    if (onGenerated && haveCurrent) onGenerated(gen.actions);
  }, [haveCurrent, gen, onGenerated]);

  const applyFix = ({ lane, presetId }) => {
    // Apply the preset as authored (start lift reset to 0). The start lever
    // never caps reach, so a fix always lands its full shape.
    if (lane === 'range') {
      const pr = RANGE_PRESETS.find((p) => p.id === presetId);
      if (pr) setRangePts(pr.pts.map((p) => ({ ...p })));
      setRangeStart(0);
    } else {
      const pr = PACE_PRESETS.find((p) => p.id === presetId);
      if (pr) setPacePts(pr.pts.map((p) => ({ ...p })));
      setPaceStart(0);
    }
  };

  const railsDone = diag.rails >= 0.22;
  const arcDone = diag.dynamics >= 0.55;
  // Pace is "already eased" once it's the gentle preset with the start NOT
  // lifted (start=0 = the authored, calmest gentle shape; raising start makes
  // it busier). At that point easing further can't help, so the too-fast fix
  // escalates to the RANGE lever instead of nagging on the pace.
  const paceEased = presetIdOf(pacePts, PACE_PRESETS) === 'gentle' && paceStart <= 0.01;

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
  const statusPill = calculating
    ? <Pill tone="info">calculating…</Pill>
    : haveCurrent
      ? <Pill tone="success">{gen.fromCache ? 'live · cached' : 'live'}</Pill>
      : <Pill tone="neutral">preview</Pill>;

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
          paceEased={paceEased} calculating={calculating}
        />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* live result */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {calculating
                  ? <span style={{ color: 'var(--info, #4dabf7)' }}>live result · calculating…</span>
                  : <>live result · {actions.length.toLocaleString()} actions{gen?.bpm ? ` · ${Math.round(gen.bpm)} BPM` : ''}</>}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Overview (full shape, pairs with diagnosis) vs Play (feel it
                    against the video). Play needs a video project. */}
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 'var(--r-pill, 999px)', overflow: 'hidden' }}>
                  {[['overview', 'Overview'], ['play', 'Play']].map(([m, label]) => {
                    const active = viewMode === m;
                    const disabled = m === 'play' && !mediaPath;
                    return (
                      <button
                        key={m}
                        onClick={() => { if (disabled) return; setViewMode(m); if (m === 'overview') setIsPlaying(false); }}
                        disabled={disabled}
                        title={disabled ? 'Open a video project to play the preview' : ''}
                        style={{
                          fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '3px 12px',
                          border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                          background: active ? 'var(--accent)' : 'transparent',
                          color: active ? '#0e1117' : (disabled ? 'var(--text-dim)' : 'var(--text-soft)'),
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {onActionsPatch && (
                  <Button
                    kind={justSet ? 'primary' : 'ghost'} size="sm"
                    icon="save"
                    disabled={generating || calculating || !actions.length}
                    onClick={() => { onActionsPatch(actions); setJustSet(true); setTimeout(() => setJustSet(false), 1600); }}
                  >
                    {justSet ? 'Set ✓' : 'Set as working funscript'}
                  </Button>
                )}
              </div>
            </div>
            {calculating ? (
              // Honest placeholder while the real engine runs (3-10 min on a
              // long file). Never paint the stand-in here — its mid-bunched
              // shape misrepresents the real bimodal output (dogfood: "rather
              // see calculating than an incorrect version").
              <div style={{ height: 200, display: 'grid', placeItems: 'center', gap: 10, color: 'var(--text-dim)' }}>
                <Icon name="activity" size={22} style={{ color: 'var(--info, #4dabf7)' }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-soft)' }}>Calculating the funscript…</div>
                <div style={{ fontSize: 11 }}>Analyzing the audio and generating strokes — watch the footer for progress.</div>
              </div>
            ) : viewMode === 'play' && mediaPath ? (
              <div>
                <MediaViewer
                  videoSrc={toMediaUrl(mediaPath)}
                  funscript={{ actions }}
                  audioWaveform={trackPeaks?.peaks?.length ? trackPeaks : null}
                  spectrogram={trackSpectrogram}
                  beats={trackBeats}
                  currentMs={currentMs}
                  totalMs={durationMs}
                  isPlaying={isPlaying}
                  onPlayPause={() => setIsPlaying((p) => !p)}
                  onSeek={(ms) => setCurrentMs(ms)}
                  onTimeChange={(ms) => setCurrentMs(ms)}
                  defaultMode="video"
                  controls={['back5', 'back1', 'play', 'forward1', 'forward5']}
                  showMark={false}
                  width="100%"
                  height={260}
                />
                <DepthMeter pos={positionAtTime(actions, currentMs)} />
              </div>
            ) : (
              <FunscriptChart actions={actions} totalMs={durationMs} height={200} railGuides />
            )}
          </div>

          {/* the two lanes — same PresetLane widget the Channels Passages lane uses */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', overflow: 'hidden' }}>
            <PresetLane
              title="RANGE" hint="how far" color="var(--accent)"
              presets={RANGE_PRESETS} activeId={presetIdOf(rangePts, RANGE_PRESETS)}
              onPick={(id) => { const pr = RANGE_PRESETS.find((p) => p.id === id); if (pr) setRangePts(pr.pts.map((p) => ({ ...p }))); }}
              samples={rangeSamples}
              startLift={rangeStart} onStartLift={setRangeStart}
            />
            <PresetLane
              title="PACE" hint="how busy" color="var(--info, #4dabf7)"
              presets={PACE_PRESETS} activeId={presetIdOf(pacePts, PACE_PRESETS)}
              onPick={(id) => { const pr = PACE_PRESETS.find((p) => p.id === id); if (pr) setPacePts(pr.pts.map((p) => ({ ...p }))); }}
              samples={paceSamples}
              startLift={paceStart} onStartLift={setPaceStart}
            />
            {/* Texture/Life — a global generation control (not per-lane): how
                much the quiet beats pull off the rails for the gold mid
                shoulder. Hard-capped at 0.35 (>=0.4 breaks the bimodal law). */}
            <div style={{ borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--warn, #ffb547)', letterSpacing: '0.04em', minWidth: 58 }}>TEXTURE</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>life — quiet beats ease off the rails</span>
              <input
                type="range" min={0} max={35} value={Math.round(texture * 100)}
                onChange={(e) => setTexture(Number(e.target.value) / 100)}
                style={{ flex: 1, maxWidth: 200, marginLeft: 'auto', accentColor: 'var(--warn, #ffb547)', cursor: 'pointer' }}
                title="bounded amplitude variation — capped at 0.35 (above that the rails collapse into a bell)"
              />
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-soft)', minWidth: 30 }}>{texture.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
