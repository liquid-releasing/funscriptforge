// Generate — author the MAIN funscript by shaping two macro curves:
// RANGE (how far each stroke goes) and PACE (how busy). Beta: presets only,
// no draggable handles. The live result renders in the FunscriptChart above
// the lanes; the "What to fix" diagnosis panel on the left grades it and hands
// the user one-click fixes. See DESIGN_DECISIONS.md.
//
// The generator is a believable STAND-IN (data/generate.js ENGINE SEAM) until
// videoflow's --density-arc / --center-trajectory are exposed through the
// bridge. Swapping it in changes one function, not this screen.

import { useMemo, useState } from 'react';
import { Button, Pill, SectionLabel, Icon } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import PresetLane from '../components/PresetLane.jsx';
import {
  DEFAULT_RANGE, DEFAULT_PACE, RANGE_PRESETS, PACE_PRESETS, presetIdOf,
  sampleCurve, generateFromLanes, diagnose, verdictFor, topFix, TARGET_DECILES,
} from '../data/generate.js';

// Sample a control-point curve into N evenly-spaced values for PresetLane.
const LANE_SAMPLES = 64;
function curveSamples(pts) {
  const out = [];
  for (let i = 0; i < LANE_SAMPLES; i += 1) out.push(sampleCurve(pts, i / (LANE_SAMPLES - 1)));
  return out;
}

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
        <Icon name={done ? 'check' : icon} size={15} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>{done ? 'looks good' : why}</span>
      </span>
      {!done && <Icon name="arrow-right" size={15} style={{ color: 'var(--text-dim)' }} />}
    </button>
  );
}

function DiagnosisPanel({ diag, applyFix, railsDone, arcDone }) {
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
          <Button kind="primary" size="sm" icon="wand-2" onClick={() => applyFix(fix)} style={{ width: '100%' }}>
            Biggest win: {fix.label}
          </Button>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check-circle" size={14} /> Nothing flagged — hit play.
          </div>
        )}
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

      {/* explicit fixes — always paired with their action */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FixCard icon="maximize-2" title="Fill the rails" why="reach shallow → full" done={railsDone} onClick={() => applyFix({ lane: 'range', presetId: 'full' })} />
        <FixCard icon="trending-up" title="Add an arc" why="build → climax → ease" done={arcDone} onClick={() => applyFix({ lane: 'pace', presetId: 'burn' })} />
      </div>
    </div>
  );
}

export default function GenerateTab({ project, onActionsPatch }) {
  const [rangePts, setRangePts] = useState(DEFAULT_RANGE);
  const [pacePts, setPacePts] = useState(DEFAULT_PACE);

  const durationMs = project?.durationMs || 595000;

  const actions = useMemo(
    () => generateFromLanes(rangePts, pacePts, durationMs),
    [rangePts, pacePts, durationMs],
  );
  const diag = useMemo(() => diagnose(actions), [actions]);

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

  return (
    <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', height: '100%' }}>
      <div>
        <SectionLabel>Generate</SectionLabel>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: '2px 0 2px' }}>Author the funscript</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
          Shape two curves — <strong style={{ color: 'var(--accent)' }}>Range</strong> (how far) and{' '}
          <strong style={{ color: 'var(--info, #4dabf7)' }}>Pace</strong> (how busy). Intensity is what you watch.
          <Pill tone="neutral" style={{ marginLeft: 8 }}>stand-in generator</Pill>
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <DiagnosisPanel diag={diag} applyFix={applyFix} railsDone={railsDone} arcDone={arcDone} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* live result */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-3, 8px)', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>live result · {actions.length.toLocaleString()} actions</span>
              {onActionsPatch && (
                <Button kind="ghost" size="sm" icon="check" onClick={() => onActionsPatch(actions)}>
                  Set as working funscript
                </Button>
              )}
            </div>
            <FunscriptChart actions={actions} totalMs={durationMs} height={200} />
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
