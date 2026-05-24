// AnalysisTab — read-only overview surface between Project and Device.
//
// First commit (skeleton): renders the row stack with every panel in
// `status='loading'` so the layout is visible end-to-end. The analyze
// trigger + ff:progress wiring lands next; per-panel renderers land
// alongside (forgemoment's primitives ship the skeleton + error +
// empty paths; FF's job here is composition + state).
//
// Reuse note: the visualization primitives all live in forgemoment
// (`src/analysis/AnalysisPanels.jsx`). ForgeGen will write its own
// orchestrator screen against the same panels; Beatflo will lift the
// chapter-discrete subset for its overview. Everything project-shape-
// specific stays inside this file.

import { useState } from 'react';
import {
  ChapterStripPanel,
  ScriptOverviewRow,
  PitchLine,
  BeatStrengthBars,
  EnergyHeatRibbon,
  KpiStrip,
  CategoryPanel,
} from 'forgemoment';

export default function AnalysisTab({
  project,
  trackPeaks,
  trackSpectrogram,
  trackBeats,
}) {
  const [activeCategoryId, setActiveCategoryId] = useState('structure');
  const [focusedChapterIdx, setFocusedChapterIdx] = useState(0);

  const projectExists = !!project?.path;
  const chapterList = project?.chapterList ?? null;
  const durationMs = project?.durationMs ?? null;

  // Source flag for the data-source-agnostic rows. Priority: funscript
  // (when project has actions) > audio (when peaks sidecar exists) >
  // motion (future). Falls through to empty when nothing's loaded yet.
  const scriptSource = projectExists ? deriveScriptSource(project, trackPeaks) : null;
  const pitchSource  = projectExists ? derivePitchSource(project, trackSpectrogram, trackPeaks) : null;

  // v1 skeleton: every panel reports 'loading' so the page renders
  // its full layout with placeholders. Real status driven by sidecar
  // presence + ff:progress events in the next pass.
  const status = projectExists ? 'loading' : 'empty';

  if (!projectExists) {
    return (
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        background: 'var(--bg)', color: 'var(--text-muted)',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <h2 style={{ fontSize: 18, margin: '0 0 6px', color: 'var(--text)' }}>
            Open a project to analyze
          </h2>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>
            Analysis surfaces structure (chapters, beats, phrases) and
            energy. Pick a project from Library or the Project tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px' }}>
        <Header project={project} />

        <ChapterStripPanel
          status={chapterList?.length ? 'ready' : status}
          chapters={chapterList}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
        />

        <ScriptOverviewRow
          status={status}
          source={scriptSource}
          durationMs={durationMs}
        />

        <PitchLine
          status={status}
          source={pitchSource}
          durationMs={durationMs}
        />

        <BeatStrengthBars
          status={trackBeats?.beatsMs?.length ? 'loading' : status}
          beats={null}
          downbeats={trackBeats?.downbeatsMs ?? null}
          chapters={chapterList}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
        />

        <EnergyHeatRibbon
          status={status}
          chapters={chapterList}
          energy={null}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
        />

        <KpiStrip
          status={status}
          kpis={buildKpis(project, trackBeats)}
        />

        <CategoryPanel
          activeCategoryId={activeCategoryId}
          onChange={setActiveCategoryId}
          status={status}
        />
      </div>
    </div>
  );
}

function Header({ project }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 4,
      }}>
        Stage · Analysis
      </div>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
        {project?.title ? `Reviewing ${project.title}` : 'Review the structure'}
      </h2>
      <p style={{
        margin: 0, fontSize: 13, color: 'var(--text-muted)', maxWidth: 720, lineHeight: 1.5,
      }}>
        Chapters, beat grid, energy, and pitch — auto-detected from the
        media and funscript. Click a chapter band to focus the
        deep-dive panel below.
      </p>
    </div>
  );
}

// ─── Data-source pickers (kept thin) ─────────────────────────────
// `source` objects feed the data-source-agnostic rows. The shape
// matches what the forgemoment panels will eventually paint when the
// renderer code lands. For the skeleton commit we just decide WHICH
// source is available; the actual signal arrays are passed through
// untouched.

function deriveScriptSource(project, trackPeaks) {
  if (project?.actions?.length) {
    return { kind: 'funscript', actions: project.actions, durationMs: project.durationMs };
  }
  if (trackPeaks?.peaks?.length) {
    return { kind: 'audio', peaks: trackPeaks.peaks, hopMs: trackPeaks.hopMs };
  }
  return null;
}

function derivePitchSource(project, trackSpectrogram, trackPeaks) {
  if (project?.actions?.length) {
    return { kind: 'funscript', actions: project.actions, durationMs: project.durationMs };
  }
  if (trackSpectrogram?.cells?.length) {
    return { kind: 'audio', cells: trackSpectrogram.cells, nMels: trackSpectrogram.nMels };
  }
  if (trackPeaks?.peaks?.length) {
    return { kind: 'audio', peaks: trackPeaks.peaks, hopMs: trackPeaks.hopMs };
  }
  return null;
}

function buildKpis(project, trackBeats) {
  // Cells render with their value (or placeholder when value is null).
  const beatsCount = trackBeats?.beatsMs?.length ?? null;
  const downbeatsCount = trackBeats?.downbeatsMs?.length ?? null;
  return [
    {
      label: 'Chapters', icon: 'layers',
      value: project?.chapters ?? null,
      subtitle: project?.durationMs
        ? `${(project.durationMs / 60_000).toFixed(1)} min`
        : 'duration',
    },
    {
      label: 'Phrases', icon: 'list',
      value: project?.phrases ?? null,
      subtitle: 'across all chapters',
    },
    {
      label: 'Beats', icon: 'activity',
      value: beatsCount,
      subtitle: downbeatsCount != null ? `${downbeatsCount} downbeats` : '',
    },
    {
      label: 'BPM', icon: 'activity',
      value: trackBeats?.bpm ?? null,
      subtitle: 'tempo',
    },
    {
      label: 'Actions', icon: 'hash',
      value: project?.actionCount ?? null,
      subtitle: 'in the funscript',
    },
  ];
}
