// AnalysisTab — read-only overview surface between Project and Chapters.
//
// On mount with a project that has no chapters yet, fires
// `analyzeChaptersWithVideoflow` and listens to `ff:progress` events.
// Each panel's status transitions from `loading` → `ready` (or `error`)
// as the videoflow pipeline emits depth-2 stage completion events;
// panels with real data paint live as their sidecars land.
//
// Stage → panel mapping:
//   classify     → ChapterStripPanel + EnergyHeatRibbon (chapters known)
//   audio_peaks  → ScriptOverviewRow (audio fallback) + PitchLine
//                  + BeatStrengthBars envelope
//   spectrogram  → PitchLine (preferred over peaks) + EnergyHeatRibbon
//   audio_beats  → BeatStrengthBars beat grid
//   sidecar      → chapters.json written (phrases too, but this tab
//                  doesn't claim them — Phrases tab owns that surface)
//
// Top-level rows (in order down the tab):
//   ChapterStripPanel    → chapter bands with focus state
//   ScriptOverviewRow    → velocity heatmap (funscript or audio peaks)
//   PitchLine            → spectral centroid / pitch baseline
//   TempoMap             → local BPM curve + global-BPM reference
//   BeatStrengthBars     → per-beat envelope grid, downbeats accented
//   EnergyHeatRibbon     → per-chapter energy stripe
//   KpiStrip             → headline counts (chapters, beats, BPM, actions)
//
// CategoryPanel sub-tabs (drill-down container below the headline rows):
//   structure → chapter list (per-chapter mode tally lives on Phrases tab)
//   beats     → BPM + regularity + beats/bar stats
//   energy    → chapters ranked by spectrogram energy
//   pitch     → spectrogram pitch distribution + drift (funscript fallback)
//
// FunscriptForge filters forgemoment's default Phrases sub-tab out via
// FF_ANALYSIS_CATEGORIES below — phrases have their own dedicated tab.
//
// Reuse note: every visualization primitive lives in forgemoment
// (`src/analysis/AnalysisPanels.jsx`). ForgeGen + Beatflo compose the
// same primitives against their own orchestrators.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChapterStripPanel,
  ScriptOverviewRow,
  PitchLine,
  TempoMap,
  BeatStrengthBars,
  EnergyHeatRibbon,
  KpiStrip,
  CategoryPanel,
  ANALYSIS_CATEGORIES,
} from 'forgemoment';
import {
  analyzeChaptersWithVideoflow,
  isTauri,
  loadAutoChapterPhrases,
  loadProject,
  wipeForgeDir,
} from '../api/forge.js';

// FunscriptForge's Analysis tab uses the full default category list.
// The Phrases sub-tab IS surfaced here — it renders the at-a-glance
// "velocity waveform + chronological phrase strip + mode percentages"
// overview. Deep per-phrase editing still happens on the dedicated
// PhrasesTab; the sub-tab here is read-only orientation.
const FF_ANALYSIS_CATEGORIES = ANALYSIS_CATEGORIES;

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
  // Inline confirm state for the Re-analyze button. window.confirm is
  // intercepted by Tauri's dialog plugin and rejected without explicit
  // permission, plus a native modal looks jarring in the dark theme.
  // Two-button inline confirm fits the existing aesthetic and works
  // without any permission grant.
  const [confirmingReanalyze, setConfirmingReanalyze] = useState(false);

  // Per-stage progress map. Keys are videoflow stage leaf names
  // ('extract', 'load', 'detect', 'whole_file', 'beats', 'classify',
  // 'audio_peaks', 'spectrogram', 'audio_beats', 'chapter_clips',
  // 'sidecar'). Values: 'running' | 'done'. Missing = not yet started.
  const [stages, setStages] = useState({});
  // Phrase count for the KPI strip. The Phrases sub-tab + per-chapter
  // mode tally are intentionally NOT surfaced here — phrases own that
  // story on the Phrases tab. But the count is a useful "what did
  // analysis find?" headline number alongside chapters + beats + BPM.
  const [phrases, setPhrases] = useState(null);
  const phrasesCount = phrases?.length ?? null;
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
      // Pull phrases from videoflow's merged chapters sidecar. Powers
      // both the KPI count cell and the Phrases sub-tab's chronological
      // strip. Modes: tease / steady / edging / break / fast / slow.
      if (project.mediaPath) {
        loadAutoChapterPhrases(project.mediaPath)
          .then((arr) => { if (Array.isArray(arr)) setPhrases(arr); })
          .catch(() => { /* sidecar absent — render empty state */ });
      }
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
          // Chapter list lift happens on TWO stages:
          //   chapters_sidecar — fires immediately after `detect`. The
          //     chapter list (without phrases/energy) is on disk; the
          //     chapter strip + Structure sub-tab fill in seconds after
          //     analyze starts, even on long sources where beats +
          //     audio sidecars take minutes.
          //   sidecar — fires near the end of the pipeline. Energy is
          //     merged into the chapter records at this stage; the
          //     reload picks up the updated chapter shapes.
          //
          // Both reload via the same loadProject call — idempotent and
          // cheap.
          if ((leaf === 'chapters_sidecar' || leaf === 'sidecar') && project?.path) {
            loadProject(project.path)
              .then((p) => {
                if (Array.isArray(p?.chapterList)) onChaptersChange?.(p.chapterList);
              })
              .catch((err) => {
                console.warn('AnalysisTab: chapter-sidecar reload failed', err);
              });
          }
          // Phrases land on disk at the `sidecar` stage — that's the
          // final merge where videoflow writes phrases + energy INTO
          // the chapters sidecar. Earlier stages (beats/classify) only
          // have phrases in memory. Triggering on `sidecar` done means
          // the KPI count + Phrases sub-tab populate as soon as the
          // file is on disk, before chapter_clips finishes.
          if (leaf === 'sidecar' && project?.mediaPath) {
            loadAutoChapterPhrases(project.mediaPath)
              .then((arr) => { if (Array.isArray(arr)) setPhrases(arr); })
              .catch(() => { /* sidecar absent — leave phrases null */ });
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
  }, [refreshAudioSidecars, project?.path, onChaptersChange]);

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

  // Re-analyze flow. Step 1 (Re-analyze button) flips confirmingReanalyze
  // on — Header swaps in a two-button inline confirm. Step 2 (Confirm
  // button) wipes .forge/ then calls triggerAnalysis. Either side can
  // cancel by clicking the Cancel button or simply leaving the tab.
  const handleReanalyzeRequest = useCallback(() => {
    if (!projectExists || isSample) return;
    if (!isTauri()) return;
    if (analyzing) return;
    setConfirmingReanalyze(true);
  }, [projectExists, isSample, analyzing]);

  const handleReanalyzeCancel = useCallback(() => {
    setConfirmingReanalyze(false);
  }, []);

  const handleReanalyzeConfirm = useCallback(async () => {
    setConfirmingReanalyze(false);
    if (!projectExists || isSample) return;
    if (!isTauri()) return;
    if (analyzing) return;
    try {
      if (project?.mediaPath) {
        await wipeForgeDir(project.mediaPath);
      }
    } catch (err) {
      console.warn('AnalysisTab: wipe forge dir failed', err);
      setAppError?.(`Could not wipe cache: ${err?.message ?? err}`);
      // Don't abort — triggerAnalysis still runs and will overwrite
      // whatever sidecars it can.
    }
    onChaptersChange?.([]);
    setPhrases(null);
    triggerAnalysis();
  }, [
    projectExists, isSample, analyzing, project?.mediaPath,
    onChaptersChange, setAppError, triggerAnalysis,
  ]);

  // Pull phrases from videoflow's chapters sidecar when a project
  // changes. The KPI count + Phrases sub-tab need to populate even
  // when the trigger effect skips reanalysis (project already has
  // chapters on disk). Phrases live merged inside chapters.json, so
  // we key off mediaPath (not funscript path).
  useEffect(() => {
    if (!projectExists || isSample) return;
    if (!isTauri()) { setPhrases(null); return; }
    setPhrases(null);
    if (!project?.mediaPath) return;
    loadAutoChapterPhrases(project.mediaPath)
      .then((arr) => { if (Array.isArray(arr)) setPhrases(arr); })
      .catch(() => { /* sidecar absent — empty state on the sub-tab */ });
  }, [project?.path, project?.mediaPath, projectExists, isSample]);

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
            Analysis surfaces structure (chapters, beats) and energy.
            Pick a project from Library or the Project tab.
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
    ready: chapterList?.length > 0
            || stages.chapters_sidecar === 'done'
            || stages.sidecar === 'done'
            || stages.classify === 'done',
    loading: analyzing || stages.classify === 'running' || stages.detect === 'running'
            || stages.whole_file === 'running' || stages.load === 'running'
            || stages.extract === 'running' || stages.chapters_sidecar === 'running',
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

  // Cross-sidecar completeness check. The four tracked artifacts:
  //   chapters, peaks, spectrogram, beats
  // Each tracked prop is null when its sidecar is absent on disk
  // (App's _doLoadAudioSidecars sets null on a missing/empty read),
  // so prop presence is the honest "is this on disk?" signal.
  // Phrases live downstream on the Phrases tab and don't surface here.
  //
  // We only surface the banner on 'partial' — everything else is
  // already covered: 'loading' by the Header subtitle, 'error' by
  // pipelineError on each panel, 'empty' by the Header no-media
  // subtitle, 'complete' is the quiet success state.
  const { analysisState, analysisSummary } = useMemo(
    () => deriveAnalysisState({
      hasMedia, analyzing, pipelineError,
      chapterList, trackPeaks, trackSpectrogram, trackBeats,
    }),
    [hasMedia, analyzing, pipelineError,
     chapterList, trackPeaks, trackSpectrogram, trackBeats],
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 28px' }}>
        <Header
          project={project}
          analyzing={analyzing}
          hasMedia={hasMedia}
          confirming={confirmingReanalyze}
          onReanalyzeRequest={handleReanalyzeRequest}
          onReanalyzeConfirm={handleReanalyzeConfirm}
          onReanalyzeCancel={handleReanalyzeCancel}
        />

        <AnalysisStateBanner
          state={analysisState}
          summary={analysisSummary}
          analyzing={analyzing}
          hasMedia={hasMedia}
          onReanalyze={handleReanalyzeRequest}
        />

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

        <TempoMap
          status={beatsStatus}
          beats={trackBeats?.beatsMs ?? null}
          globalBpm={trackBeats?.bpm ?? null}
          durationMs={durationMs}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <BeatStrengthBars
          status={beatsStatus}
          beats={trackBeats?.beatsMs ?? null}
          downbeats={trackBeats?.downbeatsMs ?? null}
          chapters={chapterList}
          peaks={trackPeaks?.peaks ?? null}
          peaksHopMs={trackPeaks?.hopMs ?? null}
          durationMs={durationMs}
          focusedIdx={focusedChapterIdx}
          onFocus={setFocusedChapterIdx}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />

        <EnergyHeatRibbon
          status={energyStatus}
          chapters={chapterList}
          spectrogram={trackSpectrogram}
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
          categories={FF_ANALYSIS_CATEGORIES}
          data={{
            chapters: chapterList,
            phrases,
            actions: project?.actions,
            trackBeats,
            trackPeaks,
            trackSpectrogram,
            durationMs,
            focusedIdx: focusedChapterIdx,
            onFocus: setFocusedChapterIdx,
          }}
          error={pipelineError}
          onRetry={triggerAnalysis}
        />
      </div>
    </div>
  );
}

function Header({
  project, analyzing, hasMedia, confirming,
  onReanalyzeRequest, onReanalyzeConfirm, onReanalyzeCancel,
}) {
  const subtitle = !hasMedia
    ? "No media attached — attach a video or audio file on the Project tab to analyze structure, beats, and energy."
    : analyzing
      ? 'Detecting chapters, beats, and energy from the media. Panels light up as each stage completes.'
      : 'Chapters, beat grid, energy, and pitch — auto-detected from the media and funscript. Click a chapter band to focus the deep-dive panel below.';
  // Re-analyze is only useful once media is attached. While a pipeline
  // is already running we hide it (re-triggering mid-run would just
  // queue a second analyze and confuse the progress footer).
  const canReanalyze = hasMedia && !analyzing && onReanalyzeRequest;
  return (
    <div style={{
      marginBottom: 22,
      display: 'flex', alignItems: 'flex-start', gap: 16,
      justifyContent: 'space-between',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
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
      {canReanalyze && !confirming && (
        <button
          onClick={onReanalyzeRequest}
          title="Wipe cached sidecars + clips and run the pipeline from scratch"
          style={reanalyzeButtonStyle}
        >
          Re-analyze
        </button>
      )}
      {canReanalyze && confirming && (
        <div style={{
          flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 8px 6px 12px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Wipe cache and re-run?
          </span>
          <button
            onClick={onReanalyzeConfirm}
            title="Delete cached sidecars + clips and re-run the pipeline"
            style={{
              ...reanalyzeButtonStyle,
              background: 'var(--accent, #c45a3a)',
              borderColor: 'var(--accent, #c45a3a)',
              color: '#fff',
            }}
          >
            Re-analyze
          </button>
          <button
            onClick={onReanalyzeCancel}
            style={{
              ...reanalyzeButtonStyle,
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--text-muted)',
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

const reanalyzeButtonStyle = {
  flexShrink: 0,
  padding: '8px 14px',
  fontSize: 12, fontWeight: 600,
  borderRadius: 6,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

// ─── AnalysisStateBanner ─────────────────────────────────────────
// Renders only when state === 'partial'. Tells the user which
// sidecars exist vs missing and offers Re-analyze as the (currently
// only) recovery CTA. Resume slots in here as the default CTA once
// videoflow gains per-stage skip-if-exists support.
function AnalysisStateBanner({ state, summary, analyzing, hasMedia, onReanalyze }) {
  if (state !== 'partial') return null;
  if (analyzing) return null; // pipeline is running — banner would lie within seconds
  if (!hasMedia) return null;
  const done = summary?.done ?? [];
  const missing = summary?.missing ?? [];
  return (
    <div style={{
      marginBottom: 18,
      padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 16,
      justifyContent: 'space-between',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--warn, #c89c3a)',
      borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text)' }}>
          Partial analysis — {done.length} of {done.length + missing.length} stages on disk
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          {done.length > 0 && <>Have: {done.join(', ')}. </>}
          Missing: {missing.join(', ')}. Re-analyze rebuilds the missing pieces (and overwrites what's there).
        </div>
      </div>
      {onReanalyze && (
        <button
          onClick={onReanalyze}
          style={reanalyzeButtonStyle}
          title="Wipe cached sidecars + clips and run the pipeline from scratch"
        >
          Re-analyze
        </button>
      )}
    </div>
  );
}

// ─── Analysis-state derivation ───────────────────────────────────
// The four sidecar artifacts we track here. `chapters` is the gate
// — if it's missing we treat the project as un-analyzed (initial-
// analyze effect will fire), not partial. Partial = chapters present
// but at least one of the audio sidecars is missing.
//
// Phrases are intentionally omitted: they live on the Phrases tab,
// not the overview. The videoflow pipeline still produces them as
// part of auto_chapter; this tab just doesn't claim ownership of
// the phrases sidecar's freshness story.
const ANALYSIS_ARTIFACTS = [
  { key: 'chapters',    label: 'chapters' },
  { key: 'peaks',       label: 'peaks' },
  { key: 'spectrogram', label: 'spectrogram' },
  { key: 'beats',       label: 'beats' },
];

function deriveAnalysisState({
  hasMedia, analyzing, pipelineError,
  chapterList, trackPeaks, trackSpectrogram, trackBeats,
}) {
  const present = {
    chapters:    !!chapterList?.length,
    peaks:       !!trackPeaks?.peaks?.length,
    spectrogram: !!trackSpectrogram?.cells?.length,
    beats:       !!trackBeats?.beatsMs?.length,
  };
  const done    = ANALYSIS_ARTIFACTS.filter((a) => present[a.key]).map((a) => a.label);
  const missing = ANALYSIS_ARTIFACTS.filter((a) => !present[a.key]).map((a) => a.label);
  const summary = { done, missing };

  if (pipelineError)            return { analysisState: 'error',    analysisSummary: summary };
  if (analyzing)                return { analysisState: 'loading',  analysisSummary: summary };
  if (!hasMedia)                return { analysisState: 'empty',    analysisSummary: summary };
  if (done.length === 0)        return { analysisState: 'empty',    analysisSummary: summary };
  if (missing.length === 0)     return { analysisState: 'complete', analysisSummary: summary };
  // Chapters must be present for 'partial' — without them the auto
  // analyze effect will fire and we're really in 'loading', not
  // 'partial'. (Belt-and-suspenders: triggerAnalysis bails if
  // chapterList.length, so we won't oscillate.)
  if (!present.chapters)        return { analysisState: 'loading',  analysisSummary: summary };
  return { analysisState: 'partial', analysisSummary: summary };
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
  // Phrases count comes from the freshly-loaded phrases sidecar; fall
  // back to project.phrases (rarely set today). The Phrases SUB-TAB is
  // intentionally filtered out via FF_ANALYSIS_CATEGORIES — this cell
  // is informational only.
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
