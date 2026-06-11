// Analysis-state derivation — shared by App.jsx (global footer Partial/Resume
// + accept-and-chain gate) and AnalysisTab (sub-tab logic). Lifted out of
// AnalysisTab 2026-06-11 so the Partial/Resume state can live in the global
// footer (it matters on every downstream tab, not just Analysis). See D5/D5b
// in internal/beta_test_bugs.md.
//
// The tracked artifacts. `chapters` is the gate — if it's missing we treat the
// project as un-analyzed (initial-analyze effect fires), not partial. Partial =
// chapters present but at least one of peaks/spectrogram/beats/clips missing.
// `clips` = one chapter-clip file per chapter on disk (the "killed during
// chapter_clips" case that should offer Resume).
//
// Phrases are intentionally omitted: they live on the Phrases tab, not the
// overview, and aren't part of this freshness story.
export const ANALYSIS_ARTIFACTS = [
  { key: 'chapters',    label: 'chapters' },
  { key: 'peaks',       label: 'peaks' },
  { key: 'spectrogram', label: 'spectrogram' },
  { key: 'beats',       label: 'beats' },
  { key: 'clips',       label: 'chapter clips' },
];

export function deriveAnalysisState({
  hasMedia, analyzing, pipelineError,
  chapterList, trackPeaks, trackSpectrogram, trackBeats,
  chapterClipsPresent,
}) {
  // Chapter clips are "done" when one clip per chapter exists on disk.
  // chapterClipsPresent == null means not-yet-counted — treat as done so we
  // never flash a false Partial before the count returns. This is what makes
  // the "killed during chapter_clips" case (all sidecars present, clips short)
  // surface as 'partial' → Resume CTA. D5.
  //
  // Clips are OPTIONAL for a single-chapter project: a chapter that spans the
  // whole/most of the source skips clip extraction by design (the player uses
  // the source directly — see chapter-clip-blob-cap). Verified on Timeline1
  // (1 chapter → 0 clips is its COMPLETE state). So only MULTI-chapter projects
  // expect one clip per chapter and can be 'partial' on missing clips —
  // otherwise a single-chapter project would be perpetually partial and Accept
  // would resume in a loop. (Residual edge: a multi-chapter video with a
  // dominant >50%-of-source chapter that skips its own clip could false-
  // positive; the real fix is recording the expected clip count in the
  // sidecar — deferred.)
  const expectedClips = chapterList?.length ?? 0;
  const clipsDone = chapterClipsPresent == null
    ? true
    : (expectedClips <= 1 ? true : chapterClipsPresent >= expectedClips);
  const present = {
    chapters:    !!chapterList?.length,
    peaks:       !!trackPeaks?.peaks?.length,
    spectrogram: !!trackSpectrogram?.cells?.length,
    beats:       !!trackBeats?.beatsMs?.length,
    clips:       clipsDone,
  };
  const done    = ANALYSIS_ARTIFACTS.filter((a) => present[a.key]).map((a) => a.label);
  const missing = ANALYSIS_ARTIFACTS.filter((a) => !present[a.key]).map((a) => a.label);
  const summary = { done, missing };

  if (pipelineError)            return { analysisState: 'error',    analysisSummary: summary };
  if (analyzing)                return { analysisState: 'loading',  analysisSummary: summary };
  if (!hasMedia)                return { analysisState: 'empty',    analysisSummary: summary };
  if (done.length === 0)        return { analysisState: 'empty',    analysisSummary: summary };
  if (missing.length === 0)     return { analysisState: 'complete', analysisSummary: summary };
  // Chapters must be present for 'partial' — without them the auto analyze
  // effect will fire and we're really in 'loading', not 'partial'.
  if (!present.chapters)        return { analysisState: 'loading',  analysisSummary: summary };
  return { analysisState: 'partial', analysisSummary: summary };
}
