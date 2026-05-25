// AnalysisTab — read-only overview surface between Project and Device.
//
// Step 2 (this commit): per-section status wiring. On mount with a
// project that has no chapters yet, fire `analyzeChaptersWithVideoflow`
// and listen to `ff:progress` events. Each panel's status transitions
// from `loading` → `ready` (or `error`) as the videoflow pipeline
// emits depth-2 stage completion events.
//
// Stage → panel mapping:
//   classify     → ChapterStripPanel + EnergyHeatRibbon (chapters known)
//   audio_peaks  → ScriptOverviewRow (audio fallback) + PitchLine
//   spectrogram  → PitchLine (preferred over peaks)
//   audio_beats  → BeatStrengthBars
//   sidecar      → chapters.json written; confirms chapter data is on disk
//
// Phrases aren't part of auto_chapter today — they're written by a
// separate analyze pass. CategoryPanel's Phrases tab stays in loading
// until that wiring lands.
//
// Reuse note: the visualization primitives all live in forgemoment
// (`src/analysis/AnalysisPanels.jsx`). ForgeGen + Beatflo will compose
// the same primitives against their own orchestrators.

import { useCallback, useEffect, useState } from 'react';
import {
  ChapterStripPanel,
  ScriptOverviewRow,
  PitchLine,
  BeatStrengthBars,
  EnergyHeatRibbon,
  KpiStrip,
  CategoryPanel,
} from 'forgemoment';
import { analyzeChaptersWithVideoflow, isTauri, loadPhrasesSidecar } from '../api/forge.js';

export default function AnalysisTab({
  project,
  trackPeaks,
  trackSpectrogram,
  trackBeats,
  onChaptersChange,
  refreshAudioSidecars,
  setBusy,
  setAppError,
}) {
  const [activeCategoryId, setActiveCategoryId] = useState('structure');
  const [focusedChapterIdx, setFocusedChapterIdx] = useState(0);

  // Per-stage progress map. Keys are videoflow stage leaf names
  // ('extract', 'load', 'detect', 'whole_file', 'beats', 'classify',
  // 'audio_peaks', 'spectrogram', 'audio_beats', 'chapter_clips',
  // 'sidecar'). Values: 'running' | 'done'. Missing = not yet started.
  const [stages, setStages] = useState({});
  // Phrase count for the KPI cell. The auto-chapter pipeline writes a
  // phrases sidecar but doesn't surface the count through Rust today;
  // we read it directly so the KPI doesn't sit at 0 after analysis.
  const [phrasesCount, setPhrasesCount] = useState(null);
  // Pipeline-level error — when the whole analysis fails (no media,
  // CLI crash, etc.), every still-loading panel surfaces this and the
  // Retry button re-triggers the same call.
  const [pipelineError, setPipelineError] = useState(null);
  // Tracks whether we've kicked off analysis this mount. Prevents a
  // double-fire when React StrictMode double-invokes effects in dev.
  const [analyzing, setAnalyzing] = useState(false);

  const projectExists = !!project?.path;
  const isSample = String(project?.path ?? '').startsWith('sample://');
  const chapterList = project?.chapterList ?? null;
  const durationMs = project?.durationMs ?? null;
  const hasMedia = !!project?.mediaPath;

  // ── Trigger analysis when needed ─────────────────────────────────
  // Run on first mount (or when project.path changes) IF the project
  // has no chapters yet AND we're in a Tauri host AND it's not the
  // synthetic sample. The Rust command is idempotent — it shells out
  // to videoflow which checks sidecars itself — but skipping the call
  // when chapters already exist avoids a redundant round-trip.
  const triggerAnalysis = useCallback(async () => {
    if (!projectExists || isSample) return;
    if (!isTauri()) return;
    if (!hasMedia) return; // no media → audio panels stay empty
    setPipelineError(null);
    setStages({}); // clear stale stage status from a previous run
    setAnalyzing(true);
    // Drive the global busy banner — App's ff:progress listener only
    // populates `busy.steps` while `busy` is set, so without this the
    // footer stays empty while the pipeline runs.
    setBusy?.({ message: `Analyzing ${project.title ?? 'project'}…`, steps: [] });
    try {
      const newChapters = await analyzeChaptersWithVideoflow(project.path, 5.5, project.mediaPath);
      // Lift the fresh chapter list back to App so other tabs (Chapters,
      // Patterns, Phrases) see it without a project reload. And refresh
      // audio sidecars so the panels that paint real data (next pass)
      // have trackPeaks / trackSpectrogram / trackBeats populated.
      if (Array.isArray(newChapters)) onChaptersChange?.(newChapters);
      refreshAudioSidecars?.();
      // Phrases sidecar lives at .<stem>.forge/<stem>.phrases.json —
      // written during the auto-chapter pipeline but not currently
      // returned through the Rust bridge. Read it directly so the
      // KPI strip's Phrases cell fills in.
      loadPhrasesSidecar(project.path)
        .then((sidecar) => {
          if (sidecar?.slices) setPhrasesCount(sidecar.slices.length);
        })
        .catch(() => { /* sidecar absent or malformed — leave KPI null */ });
    } catch (err) {
      console.error('AnalysisTab: analyze failed', err);
      const message = err?.message ? String(err.message) : String(err);
      setPipelineError(message);
      // Surface in the global footer too so the user sees it even if
      // they switch tabs before the analysis finishes.
      setAppError?.(`Analysis failed: ${message}`);
    } finally {
      setAnalyzing(false);
      setBusy?.(null);
    }
  }, [projectExists, isSample, hasMedia, project?.path, project?.mediaPath, project?.title,
      onChaptersChange, refreshAudioSidecars, setBusy, setAppError]);

  // Subscribe to ff:progress for the lifetime of the tab — even if
  // analysis was triggered before mount (e.g. by ChaptersTab), we
  // still pick up the done events as stages complete.
  //
  // Side effect: when an audio sidecar stage completes
  // (audio_peaks / spectrogram / audio_beats), kick off a sidecar
  // refresh so the corresponding panel lights up mid-pipeline rather
  // than waiting for the whole pipeline to resolve. Progressive
  // reveal — the panels fill in as their data lands on disk.
  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten = null;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const off = await listen('ff:progress', (event) => {
        const raw = String(event?.payload ?? '');
        const stripped = raw.startsWith('progress: ')
          ? raw.slice('progress: '.length) : raw;
        const parts = stripped.split('::');
        const kind = parts[0];
        const depth = parseInt(parts[1] || '0', 10);
        const leaf = parts[2];
        // Depth 1 = outer command wrapper; depth 3+ = sub-stages.
        // Depth 2 = the stages we map to panels.
        if (!leaf || depth !== 2) return;
        if (kind === 'start') {
          setStages((prev) => ({ ...prev, [leaf]: 'running' }));
        } else if (kind === 'done') {
          setStages((prev) => ({ ...prev, [leaf]: 'done' }));
          // Audio sidecars are independent files written each stage —
          // we can refresh as soon as each lands. (refreshAudioSidecars
          // reloads all three in parallel; redundant calls are cheap
          // JSON parses on already-warm disk cache.)
          if (leaf === 'audio_peaks' || leaf === 'spectrogram' || leaf === 'audio_beats') {
            refreshAudioSidecars?.();
          }
        }
      });
      if (cancelled) off();
      else unlisten = off;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refreshAudioSidecars]);

  // Fire the analysis when the project lands without chapters. The
  // chapterList check is the cheap "is this analyzed?" probe — Rust's
  // load_project hydrates it from chapters.json if present.
  useEffect(() => {
    if (!projectExists || isSample) return;
    if (chapterList?.length) return; // already analyzed
    if (analyzing) return;
    triggerAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path]);

  // ── Empty state ─────────────────────────────────────────────────
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

  // ── Status derivation ────────────────────────────────────────────
  // Each panel's status comes from a small rule against:
  //   (a) data already in props (chapterList, trackPeaks, etc.) — the
  //       "already analyzed" path, ready immediately on remount
  //   (b) stages map — running stages = loading, done stages = ready
  //   (c) pipelineError — failed analysis surfaces per-panel error
  //   (d) hasMedia — without media, audio-derived panels are empty,
  //       not error (the user just hasn't attached media yet)

  const chaptersStatus = pickStatus({
    ready: chapterList?.length > 0 || stages.sidecar === 'done' || stages.classify === 'done',
    loading: analyzing || stages.classify === 'running' || stages.detect === 'running'
            || stages.whole_file === 'running' || stages.load === 'running'
            || stages.extract === 'running',
    error: pipelineError,
    empty: !hasMedia && !chapterList?.length,
  });

  const scriptOverviewStatus = pickStatus({
    ready: !!project?.actions?.length || !!trackPeaks?.peaks?.length
            || stages.audio_peaks === 'done',
    loading: stages.audio_peaks === 'running' || (analyzing && !trackPeaks),
    error: pipelineError && !trackPeaks,
    empty: !hasMedia && !project?.actions?.length,
  });

  const pitchStatus = pickStatus({
    ready: !!project?.actions?.length || !!trackSpectrogram?.cells?.length
            || stages.spectrogram === 'done',
    loading: stages.spectrogram === 'running' || (analyzing && !trackSpectrogram),
    error: pipelineError && !trackSpectrogram,
    empty: !hasMedia && !project?.actions?.length,
  });

  const beatsStatus = pickStatus({
    ready: !!trackBeats?.beatsMs?.length || stages.audio_beats === 'done',
    loading: stages.audio_beats === 'running' || stages.beats === 'running'
            || (analyzing && !trackBeats),
    error: pipelineError && !trackBeats,
    empty: !hasMedia,
  });

  const energyStatus = pickStatus({
    ready: chaptersStatus === 'ready' && (
      !!trackSpectrogram?.cells?.length || stages.spectrogram === 'done'
    ),
    loading: chaptersStatus === 'loading' || stages.spectrogram === 'running'
            || (analyzing && !trackSpectrogram),
    error: pipelineError,
    empty: !hasMedia,
  });

  // KPI status follows chapters/beats — most cells need them. Once
  // chapters land, the strip can show what it knows even if beats
  // are still in flight; cell-level placeholders cover the gaps.
  const kpiStatus = chaptersStatus === 'ready' ? 'ready'
                  : chaptersStatus === 'error' ? 'error'
                  : chaptersStatus === 'empty' ? 'empty'
                  : 'loading';

  // Source picks for the data-source-agnostic rows. Same priority
  // ladder as before: funscript > audio > motion. With no funscript
  // and no media, source stays null and the panel renders empty.
  const scriptSource = deriveScriptSource(project, trackPeaks);
  const pitchSource  = derivePitchSource(project, trackSpectrogram, trackPeaks);

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px' }}>
        <Header project={project} analyzing={analyzing} hasMedia={hasMedia} />

        <ChapterStripPanel
          status={chaptersStatus}
          chapters={chapterList}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <ScriptOverviewRow
          status={scriptOverviewStatus}
          source={scriptSource}
          durationMs={durationMs}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <PitchLine
          status={pitchStatus}
          source={pitchSource}
          durationMs={durationMs}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <BeatStrengthBars
          status={beatsStatus}
          beats={null}
          downbeats={trackBeats?.downbeatsMs ?? null}
          chapters={chapterList}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <EnergyHeatRibbon
          status={energyStatus}
          chapters={chapterList}
          energy={null}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <KpiStrip
          status={kpiStatus}
          kpis={buildKpis(project, trackBeats, phrasesCount)}
        />

        <CategoryPanel
          activeCategoryId={activeCategoryId}
          onChange={setActiveCategoryId}
          status={chaptersStatus}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />
      </div>
    </div>
  );
}

function Header({ project, analyzing, hasMedia }) {
  const subtitle = !hasMedia
    ? "No media attached — attach a video or audio file on the Project tab to analyze structure, beats, and energy."
    : analyzing
      ? 'Detecting chapters, beats, and energy from the media. Panels light up as each stage completes.'
      : 'Chapters, beat grid, energy, and pitch — auto-detected from the media and funscript. Click a chapter band to focus the deep-dive panel below.';
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
        {subtitle}
      </p>
    </div>
  );
}

// ─── Status picker ──────────────────────────────────────────────
// Resolves four-way status from boolean rules. Order matters: error
// trumps ready (so a retry button shows even if some panels managed
// to load); ready trumps loading; empty is the fallback when no
// signal is available at all. Keeps each panel call site declarative.
function pickStatus({ ready, loading, error, empty }) {
  if (error)   return 'error';
  if (ready)   return 'ready';
  if (loading) return 'loading';
  if (empty)   return 'empty';
  return 'loading';
}

// ─── Data-source pickers ─────────────────────────────────────────

function deriveScriptSource(project, trackPeaks) {
  if (project?.actions?.length) {
    return { kind: 'funscript', actions: project.actions, durationMs: project.durationMs };
  }
  if (trackPeaks?.peaks?.length) {
    return { kind: 'audio', peaks: trackPeaks.peaks, hopMs: trackPeaks.hopMs };
  }
  return null;
}

// PitchLine prefers AUDIO over funscript — opposite priority from
// ScriptOverviewRow. The two rows then carry complementary signals:
// heatmap above = "what the script is doing," pitch below = "what the
// music is doing" (spectral centroid / envelope). Falling back to the
// funscript baseline keeps the row populated for audio-less projects.
function derivePitchSource(project, trackSpectrogram, trackPeaks) {
  if (trackSpectrogram?.cells?.length) {
    return { kind: 'audio', cells: trackSpectrogram.cells, nMels: trackSpectrogram.nMels };
  }
  if (trackPeaks?.peaks?.length) {
    return { kind: 'audio', peaks: trackPeaks.peaks, hopMs: trackPeaks.hopMs };
  }
  if (project?.actions?.length) {
    return { kind: 'funscript', actions: project.actions, durationMs: project.durationMs };
  }
  return null;
}

function buildKpis(project, trackBeats, phrasesCount) {
  const beatsCount = trackBeats?.beatsMs?.length ?? null;
  const downbeatsCount = trackBeats?.downbeatsMs?.length ?? null;
  // BPM comes back from librosa as a float (e.g. 117.11346). Round to
  // one decimal so the cell reads as music tempo, not a raw analysis
  // output. `null` stays as null so the cell renders its placeholder.
  const bpm = trackBeats?.bpm != null ? Math.round(trackBeats.bpm * 10) / 10 : null;
  // Prefer the freshly-read phrases sidecar count; fall back to whatever
  // the project record carried at load time (rarely set today).
  const phrases = phrasesCount ?? project?.phrases ?? null;
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
      value: phrases,
      subtitle: 'across all chapters',
    },
    {
      label: 'Beats', icon: 'activity',
      value: beatsCount,
      subtitle: downbeatsCount != null ? `${downbeatsCount} downbeats` : '',
    },
    {
      label: 'BPM', icon: 'activity',
      value: bpm,
      subtitle: 'tempo',
    },
    {
      label: 'Actions', icon: 'hash',
      value: project?.actionCount ?? null,
      subtitle: 'in the funscript',
    },
  ];
}
