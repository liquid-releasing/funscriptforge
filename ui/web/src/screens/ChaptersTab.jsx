// ChaptersTab — pick a chapter, set its tone.
//
// Chapters were originally a way to make long funscripts manageable. On this
// tab, each chapter gets one tone (Tender/Build/Tease/Edge/Climax/Dominant)
// which biases the per-phrase suggestions on later tabs. The tone math
// running here is a JS-side preview — the canonical transform will move to
// `python cli.py tone <funscript> --chapter <id> --tone <name> --impact <v>`
// once the analyzer ships that endpoint (tracked in
// project-funscriptforge-pending). Same JS-preview / CLI-canonical split as
// the Device tab sliders.
//
// Layout:
//   Top:    full-script FunscriptChart with chapter bands beneath
//   Left:   chapter rail (300px)
//   Right:  active chapter detail — header, MediaViewer (chapter-scoped),
//           tone picker (6 cards), tone params, before/after, stats,
//           split/join affordances (UI only — logic deferred).
//
// Library tone pre-seed: if the project arrived with `project.libraryTone`,
// chapters default to that. Otherwise each chapter's initial tone is derived
// from `chapter.intent` when it matches a known tone, else falls back to
// `project.toneSuggestion`, else 'build'.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Icon, MediaViewer, Slider, ChapterRibbon } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import {
  createChaptersSidecar,
  analyzeChaptersWithVideoflow,
  prewarmMediaRange,
  analyzePhrases,
  writeChaptersSidecar,
  extractChapterClip,
  transformApplyActions,
  saveWorkingFunscript,
} from '../api/forge.js';
import { useTransformPreview } from '../api/useTransformPreview.js';
import { toMediaUrl } from '../lib/mediaUrl.js';
import { chapterDisplayLabel, splitAt, joinAt } from '../lib/chapterOps.js';
import { useChapterClip } from '../hooks/useChapterClip.js';

// Apply a remap (Map<newId, oldId>) to the per-chapter tone / params /
// accepted maps. All three are keyed by chapter.id, but IDs renumber
// whenever the list mutates, so we copy state across by old-id lookup.
// Split: both halves inherit the parent's tone. Join: the earlier
// chapter's state wins; the later chapter's state is dropped.
function applyRemap(remap, { tones, params, accepted }) {
  const newTones = {};
  const newParams = {};
  const newAccepted = new Set();
  remap.forEach((oldId, newId) => {
    if (oldId == null) {
      newTones[newId] = 'none';  // brand-new half → Untoned (defaults off)
      newParams[newId] = defaultToneParams();
      return;
    }
    newTones[newId] = tones[oldId] ?? 'none';
    newParams[newId] = params[oldId]
      ? JSON.parse(JSON.stringify(params[oldId]))
      : defaultToneParams();
    if (accepted.has(oldId)) newAccepted.add(newId);
  });
  return { newTones, newParams, newAccepted };
}

// Stamp each chapter record with its chosen tone id so the sidecar write
// persists the user's tone choices. `tones` is the tonesByChapter map; a
// chapter with no entry falls back to 'none'/Untoned — the same pass-through
// default seedTones reads back, now that auto-seeding is off (2026-06-15).
// Every sidecar write goes through this so tones survive split / join /
// accept and round-trip on reopen (Rust write_chapters_sidecar serializes
// the `tone` field; videoflow Chapter.from_dict reads it back).
function attachTones(chapterList, tones) {
  return chapterList.map((c) => ({ ...c, tone: tones?.[c.id] ?? 'none' }));
}

// The six canonical tones + one UI-only 'none' opt-out sentinel.
// Source of truth for the six: forge/tabs/tone_tab.py::_TONES in the
// Python side — the IDs MUST match (tender/build/tease/edge/climax/
// dominant) or chapter-tone records won't round-trip when the CLI lands.
// 'none' is FF-only (no Python counterpart) and sits at index 0 so the
// picker reads "Untoned (opt out) → six tones" left-to-right — the
// canonical opt-out card pattern (grey card, no icon, leftmost).
const TONES = [
  // 'none' (2026-05-17, repositioned to leftmost 2026-05-25) — explicit
  // "no tone" so the user isn't forced to pick one before Accept.
  // Selecting it returns the funscript unchanged through `applyTone`.
  // Sits at the start of the picker grid as the opt-out option.
  { id: 'none',     label: 'Untoned',  color: '#64748b',
    desc: 'No tone applied — chapter passes through unchanged.',
    params: [] },
  { id: 'tender',   label: 'Tender',   color: '#8b9bff',
    desc: 'Soft, slow, intimate. Low BPM ceiling, gentle contrast.',
    params: [
      { id: 'ceiling',  label: 'Speed ceiling', min: 60, max: 180, step: 5,    def: 110, fmt: (v) => `${v}/s` },
      { id: 'softness', label: 'Edge softness', min: 0,  max: 1,   step: 0.05, def: 0.55, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'build',    label: 'Build',    color: '#4dabf7',
    desc: 'Gradual escalation. Amplitude grows phrase over phrase.',
    params: [
      { id: 'ramp',     label: 'Ramp curve',    min: 0,  max: 1,   step: 0.05, def: 0.65, fmt: (v) => v.toFixed(2) },
      { id: 'headroom', label: 'End headroom',  min: 0,  max: 30,  step: 1,    def: 12,   fmt: (v) => `${v}%` },
    ] },
  { id: 'tease',    label: 'Tease',    color: '#c77dff',
    desc: 'Patient, withholding. Holds back contrast for later release.',
    params: [
      { id: 'withhold', label: 'Withhold',      min: 0,   max: 1,   step: 0.05, def: 0.7,  fmt: (v) => v.toFixed(2) },
      { id: 'release',  label: 'Release point', min: 0.4, max: 0.95, step: 0.05, def: 0.8,  fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'edge',     label: 'Edge',     color: '#ffb547',
    desc: 'Sustained intensity at the threshold. High variance, no payoff.',
    params: [
      { id: 'hold', label: 'Hold intensity', min: 0,   max: 1, step: 0.05, def: 0.7,  fmt: (v) => v.toFixed(2) },
      { id: 'drop', label: 'Drop point',     min: 0.5, max: 1, step: 0.05, def: 0.85, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'climax',   label: 'Climax',   color: '#ff5470',
    desc: 'Peak BPM and contrast. Short, dense, uncompromising.',
    params: [
      { id: 'density',  label: 'Density',  min: 0.5, max: 2, step: 0.05, def: 1.4,  fmt: (v) => `${v.toFixed(2)}×` },
      { id: 'contrast', label: 'Contrast', min: 0,   max: 1, step: 0.05, def: 0.75, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'dominant', label: 'Dominant', color: '#ff8c47',
    desc: 'Demanding rhythm, hard contrast, strong recenter pressure.',
    params: [
      { id: 'recenter', label: 'Recenter', min: 0, max: 1, step: 0.05, def: 0.6,  fmt: (v) => v.toFixed(2) },
      { id: 'rhythm',   label: 'Rhythm',   min: 0, max: 1, step: 0.05, def: 0.55, fmt: (v) => v.toFixed(2) },
    ] },
  // Tame (2026-06-01) — the one *corrective* tone: device-aware softening.
  // Unlike the six expressive tones above (synchronous JS preview math in
  // applyTone), Tame runs the REAL backend `tame` transform (humanize /
  // groove) over the chapter span: its before/after comes from
  // useTransformPreview and Accept rolls the result through
  // transform_apply_actions + the working funscript — the same path
  // Phrases/Stanzas Apply uses. One param (groove), id matching the backend
  // key. It softens a wall of fast strokes WITHOUT dropping a beat — there
  // is no stroke-rate cap (the Max-BPM cycle-drop was removed: dropping
  // strokes kills the beat; center amplitude to lower intensity instead).
  // See [[project tame]].
  { id: 'tame', label: 'Tame', color: '#2dd4bf',
    desc: 'Device-aware softening. Humanizes a relentless wall of fast strokes so it feels less mechanical — every beat kept, amplitude untouched. To lower intensity, center amplitude with the Recenter / Amplitude transforms instead.',
    params: [
      { id: 'groove', label: 'Groove', min: 0, max: 1, step: 0.05, def: 0.2, fmt: (v) => v.toFixed(2) },
    ] },
];

// Fallback to 'build' (not by index) when an unknown tone id arrives —
// 'build' is the analyzer's most-common seeded tone, so an unrecognized
// id reads as "default tone, not opt-out" by intent. Lookup-by-id is
// index-stable across TONES array reorderings.
function findTone(id) {
  return TONES.find((t) => t.id === id)
    ?? TONES.find((t) => t.id === 'build')
    ?? TONES[0];
}

// Map a free-text intent or tone-suggestion to a known tone id. Unknown →
// null so the caller can fall back. Case-insensitive; matches the label.
function intentToToneId(intent) {
  if (!intent) return null;
  const k = String(intent).trim().toLowerCase();
  const hit = TONES.find((t) => t.id === k || t.label.toLowerCase() === k);
  return hit?.id ?? null;
}

function defaultToneParams() {
  const out = {};
  TONES.forEach((t) => {
    // Impact defaults to 50% so a freshly-picked tone preview reads
    // as "tone-flavored toward source" rather than "tone fully applied."
    // Users escalate by dragging up; the half-mix matches how most
    // pickers land in practice (start moderate, push if you like it).
    out[t.id] = { impact: 0.5 };
    t.params.forEach((p) => { out[t.id][p.id] = p.def; });
  });
  return out;
}

// Per-chapter initial tone map. Reads the persisted per-chapter `tone` (a user
// choice written to the sidecar on Accept — incl. the 'none'/Untoned and
// 'tame' sentinels); a chapter with no persisted tone starts UNTONED ('none',
// pass-through).
//
// Default tones are OFF (user decision 2026-06-15): we do NOT auto-seed a tone
// from the analyzer intent / project suggestion. Auto-seeding made every
// chapter show e.g. "Climax" (the project toneSuggestion), which read as a
// committed choice the user never made. The user picks a tone deliberately;
// persisted tones still win so accepted tones survive reopen.
function seedTones(chapters) {
  const out = {};
  chapters.forEach((c) => {
    out[c.id] = intentToToneId(c.tone) ?? 'none';
  });
  return out;
}

// Per-chapter initial params map (fresh defaults for every tone, every
// chapter). Cheap to compute; we don't try to migrate prior params onto
// new chapters because chapter boundaries change.
function seedParams(chapters) {
  const out = {};
  chapters.forEach((c) => { out[c.id] = defaultToneParams(); });
  return out;
}

// Apply a tone to a chapter's slice of actions. JS preview only — the
// canonical transform will move to `python cli.py tone`. Curve shapes mirror
// the prototype (ui_design/.../tab-Chapters.jsx::applyToneCurve) so the
// before/after preview reads the same here.
function applyTone(actions, chapterStart, chapterEnd, tone, params) {
  if (!actions || actions.length === 0) return [];
  const slice = actions.filter((a) => a.at >= chapterStart && a.at <= chapterEnd);
  if (slice.length === 0) return [];
  // 'none' / Untoned — passthrough, no transform. Lets the user Accept
  // a chapter without committing to a tone.
  if (tone.id === 'none') return slice.map((a) => ({ at: a.at, pos: a.pos }));
  // 'tame' is applied via the backend transform on Accept (cycle-drop +
  // humanize); its real before/after comes from useTransformPreview, not
  // this JS path. Passthrough here so any merge that happens to encounter
  // a tame'd chapter doesn't throw — it just leaves the slice untouched.
  if (tone.id === 'tame') return slice.map((a) => ({ at: a.at, pos: a.pos }));
  const dur = Math.max(1, chapterEnd - chapterStart);
  const impact = params.impact ?? 1;
  const clamp = (v) => Math.max(0, Math.min(100, v));

  return slice.map((a, i, arr) => {
    const t = (a.at - chapterStart) / dur; // 0..1 progress through chapter
    let v = a.pos;
    if (tone.id === 'tender') {
      const prev = arr[Math.max(0, i - 2)].pos;
      const next = arr[Math.min(arr.length - 1, i + 2)].pos;
      const smoothed = (prev + v * 2 + next) / 4;
      const ceilingPull = (params.ceiling - 110) / 70;
      v = smoothed - (smoothed - 50) * (0.25 - ceilingPull * 0.1);
      v = v - (v - 50) * params.softness * 0.35;
    } else if (tone.id === 'build') {
      const ramp = t ** (1 - params.ramp * 0.7 + 0.3);
      const cap = 100 - params.headroom;
      v = 50 + (v - 50) * (0.4 + ramp * 0.85);
      if (v > cap) v = cap;
    } else if (tone.id === 'tease') {
      const before = t < params.release;
      v = before
        ? 50 + (v - 50) * (1 - params.withhold * 0.7)
        : 50 + (v - 50) * (1 + params.withhold * 0.5);
    } else if (tone.id === 'edge') {
      const inHold = t < params.drop;
      v = inHold
        ? 70 + (v - 50) * (1 - params.hold * 0.55)
        : v - (v - 50) * 0.35;
    } else if (tone.id === 'climax') {
      v = 50 + (v - 50) * (1 + params.contrast * 0.85);
      const sgn = v >= 50 ? 1 : -1;
      v += sgn * (params.density - 1) * 8;
    } else if (tone.id === 'dominant') {
      v = v - (v - 50) * params.recenter * 0.5;
      const beat = Math.sin(t * Math.PI * 18) * params.rhythm * 14;
      v = 50 + (v - 50) * (1 + params.rhythm * 0.3) + beat * 0.4;
    }
    // Mix toned curve toward original by impact (0 = original, 1 = full tone)
    const mixed = a.pos + (v - a.pos) * impact;
    return { at: a.at, pos: Math.round(clamp(mixed)) };
  });
}

function fmtTimeShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// Rebuild the working actions array by walking chapters in time order
// and splicing each accepted chapter's freshly-toned slice in over the
// original snapshot. Chapters that haven't been accepted pass through
// as raw. Trailing actions past the last chapter (and gaps between
// chapters) come straight from `originalActions`.
//
// Pure function: takes the original snapshot + the chapter/tone/param
// state at the time of the accept and returns a new array. Re-running
// with the same inputs returns equivalent output, so accept is
// idempotent — re-accepting a chapter after tweaking its tone re-tones
// from the original, never from previously-toned data.
function mergeWorkingActions({ originalActions, chapters, acceptedIds, tones, params }) {
  if (!Array.isArray(originalActions) || originalActions.length === 0) return [];
  if (!Array.isArray(chapters) || chapters.length === 0) return originalActions;
  const sorted = [...chapters].sort((a, b) => a.atMs - b.atMs);
  const out = [];
  let i = 0;
  for (const ch of sorted) {
    while (i < originalActions.length && originalActions[i].at < ch.atMs) {
      out.push(originalActions[i]); i += 1;
    }
    const inRangeStart = i;
    let j = inRangeStart;
    while (j < originalActions.length && originalActions[j].at <= ch.endMs) j += 1;
    if (acceptedIds.has(ch.id)) {
      const toneObj = findTone(tones[ch.id]);
      const toneParamsObj = params[ch.id]?.[toneObj.id] ?? {};
      out.push(...applyTone(originalActions, ch.atMs, ch.endMs, toneObj, toneParamsObj));
    } else {
      for (let k = inRangeStart; k < j; k += 1) out.push(originalActions[k]);
    }
    i = j;
  }
  while (i < originalActions.length) { out.push(originalActions[i]); i += 1; }
  return out;
}

// Sentinel used when chapters is empty so the useMemo deps stay stable
// across the empty → populated transition. Without this the hook deps
// would shift between renders and we'd hit React's "rendered different
// number of hooks" guard.
const EMPTY_CHAPTER = { id: '__empty__', atMs: 0, endMs: 0, name: '', color: '#888' };

export default function ChaptersTab({ project, onAttachMedia, onChaptersChange, onActionsPatch, setBusy, setAppError, trackPeaks, trackSpectrogram, trackBeats, refreshAudioSidecars, setPhrasesByPath }) {
  const totalMs = project?.durationMs ?? 0;
  const actions = Array.isArray(project?.actions) ? project.actions : [];

  // Snapshot of project.actions taken when the project first loads.
  // Tone previews + accept always tone *against the original snapshot*,
  // never against an already-toned slice — otherwise re-accepting a
  // chapter (after the user tweaks its tone) would compound the
  // transform on top of itself. The `actions` reference above stays as
  // the displayed working set (gets patched on accept); `originalActions`
  // is the cold reference we tone from.
  const [originalActions, setOriginalActions] = useState(() =>
    Array.isArray(project?.actions) ? project.actions : []
  );
  useEffect(() => {
    setOriginalActions(Array.isArray(project?.actions) ? project.actions : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.path]);

  // Local chapter state — initialised from project.chapterList (parsed from
  // the sidecar by the Rust bridge) and replaced when the user kicks off
  // chapter creation in the empty state. Syncs when a different project
  // loads.
  const [chapters, setChapters] = useState(() =>
    Array.isArray(project?.chapterList) ? project.chapterList : [],
  );
  const [activeId, setActiveId] = useState(chapters[0]?.id ?? null);
  // tonesByChapter: { ch1: 'build', ch2: 'edge', ... }
  const [tonesByChapter, setTonesByChapter] = useState(() =>
    seedTones(chapters),
  );
  // paramsByChapter: { ch1: { tender: {...}, build: {...}, ... }, ... }
  const [paramsByChapter, setParamsByChapter] = useState(() =>
    seedParams(chapters),
  );

  // Per-chapter acceptance — which chapters the user has explicitly
  // signed off on. Distinct from tonesByChapter (which is seeded for
  // every chapter from defaults / project tone). A chapter is "accepted"
  // when the user clicks "Accept tone · next chapter" — at that point we
  // also bake the toned slice into the project's working actions so the
  // viewer (and downstream tabs) reflect the toned shape immediately,
  // not just at chain time. Local Set; lives only for the session — the
  // tab-level chain step is still where persistence happens.
  const [acceptedChapterIds, setAcceptedChapterIds] = useState(() => new Set());

  // When the user opens a different project, reset the local chapter list
  // and the per-chapter maps. Keying off project.path covers the case
  // where Rust populates chapterList for the new project.
  useEffect(() => {
    const next = Array.isArray(project?.chapterList) ? project.chapterList : [];
    setChapters(next);
    setActiveId(next[0]?.id ?? null);
    setTonesByChapter(seedTones(next));
    setParamsByChapter(seedParams(next));
    setAcceptedChapterIds(new Set());
  }, [project?.path]);

  // Auto-split + sidecar write. The Rust bridge persists the file; the
  // returned record list refreshes local state so the rest of the tab
  // populates immediately without a project reload.
  const [splitN, setSplitN] = useState(4);
  const [creating, setCreating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  // Playback clock for the chapter-scoped edit loop. The MediaViewer
  // owns the <video> element and emits `onTimeChange` on every
  // timeupdate; we mirror that into `currentMs`. Seeks (manual scrub,
  // chapter-end loop, click-on-band) go the other direction — set
  // `currentMs` and MediaViewer's seek-sync effect moves the video.
  // The rAF clock below covers the no-video case (audio-only or
  // browser mock without mediaPath); when a video is loaded, timeupdate
  // events win — the rAF tick just re-asserts the same currentMs the
  // video already reported.
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // MediaViewer mode is uncontrolled (defaults to video, user toggles
  // freely via the chip strip). Audio sidecars (peaks + spectrogram)
  // are App-level shared state, both built upstream during the chapter-
  // analysis pass via `videoflow.structural.auto_chapter`. App reads
  // them off disk on project open; no lazy build is triggered here.
  // If a sidecar is absent (chapter analysis hasn't run yet) the
  // viewer renders an empty state for that mode.

  // The ChapterRibbon baton renders in all viewer modes — earlier shape
  // hid it in video mode but that conflated two batons. The MediaViewer's
  // internal *overlay* baton (over the media surface) stays hidden in
  // video mode (correct: the frame IS the playhead, overlay would be
  // redundant chrome). The ChapterRibbon baton (overhead "where am I in
  // the project" view) is always useful — that's project-scope context,
  // not an overlay on the playing frame.
  const hydrateFromChapterList = (created) => {
    setChapters(created);
    setActiveId(created[0]?.id ?? null);
    setTonesByChapter(seedTones(created));
    setParamsByChapter(seedParams(created));
    // Lift the new chapter list back to App.jsx so downstream tabs
    // (Patterns, Phrases) see the same chapters. Without this push, they
    // would still see the original (often empty) chapterList from
    // load_project.
    onChaptersChange?.(created);
  };
  const handleCreateChapters = async () => {
    if (!project?.path || creating) return;
    setCreating(true);
    try {
      const created = await createChaptersSidecar(project.path, splitN);
      hydrateFromChapterList(created);
    } catch (err) {
      console.error('ChaptersTab: create_chapters_sidecar failed', err);
    } finally {
      setCreating(false);
    }
  };

  // Content-aware detection via videoflow.structural — requires adjacent
  // media. The Rust command errors out cleanly when no media is attached;
  // surface that to the user so they know to attach a file. Drives the
  // global footer busy state so the live ProgressReporter events from
  // videoflow appear in the AcceptBar; the consumer can Cancel mid-run
  // and we discard the in-flight result.
  const analyzeCancelledRef = useRef(false);
  const handleAnalyzeWithVideoflow = async () => {
    if (!project?.path || analyzing) return;
    setAnalyzeError(null);
    setAnalyzing(true);
    analyzeCancelledRef.current = false;
    setBusy?.({
      message: 'Analyzing chapters…',
      onCancel: () => {
        analyzeCancelledRef.current = true;
        setAnalyzing(false);
        setBusy?.(null);
      },
    });
    try {
      const detected = await analyzeChaptersWithVideoflow(project.path, null, project.mediaPath || null);
      if (analyzeCancelledRef.current) return;
      hydrateFromChapterList(detected);
      // auto_chapter writes peaks + spectrogram sidecars in the same
      // pass — pull them in now so the viewer's Audio / Spectrogram
      // modes light up without a project re-open.
      refreshAudioSidecars?.();
      // Bundle phrase analysis into the same pass so downstream tabs
      // (Phrases / Patterns) find the sidecar already cached. Failures
      // here are non-fatal — PhrasesTab still has its lazy hydrate path
      // so a transient error here doesn't break the editor; user can
      // re-enter Phrases tab to retry.
      if (setPhrasesByPath) {
        try {
          setBusy?.({
            message: 'Detecting phrases…',
            onCancel: () => { analyzeCancelledRef.current = true; },
          });
          const phraseRows = await analyzePhrases(project.path);
          if (analyzeCancelledRef.current) return;
          setPhrasesByPath((prev) => ({
            ...prev,
            [project.path]: {
              phrases: Array.isArray(phraseRows) ? phraseRows : [],
              loaded: true,
            },
          }));
        } catch (err) {
          console.warn('ChaptersTab: bundled analyzePhrases failed (non-fatal)', err);
        }
      }
    } catch (err) {
      if (analyzeCancelledRef.current) return;
      console.error('ChaptersTab: analyze_chapters_with_videoflow failed', err);
      setAnalyzeError(String(err?.message ?? err));
      setAppError?.(`Auto-chapter failed: ${err?.message ?? err}`);
    } finally {
      if (!analyzeCancelledRef.current) {
        setAnalyzing(false);
        setBusy?.(null);
      }
    }
  };

  // ── Hooks must run unconditionally — empty-state early return goes AFTER.
  // active falls back to a zero-length sentinel so the useMemo deps stay
  // stable when chapters is empty.
  const active = chapters.find((c) => c.id === activeId) ?? chapters[0] ?? EMPTY_CHAPTER;
  const toneId = tonesByChapter[active.id] ?? 'none';
  const tone = findTone(toneId);
  const toneParams = paramsByChapter[active.id]?.[tone.id] ?? {};

  // Full-track peaks pass through directly to MediaViewer — same model
  // as spectrogram. WaveformCanvas (post-2026-05-21) does its own
  // absolute 12s window slicing on the GPU-friendly canvas2D path, so
  // there's no need to chapter-scope or bucket-downsample here. The
  // earlier TARGET_BARS=200 dance existed to keep React reconciliation
  // happy when WaveformCanvas was SVG-per-bar; once it moved to
  // imperative canvas paint that workaround went away.
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

  const beforeSlice = useMemo(
    () => originalActions.filter((a) => a.at >= active.atMs && a.at <= active.endMs),
    [originalActions, active.atMs, active.endMs],
  );

  // Tame is the one tone whose preview comes from the backend (the real
  // cycle-drop + humanize), not applyTone. Hook runs unconditionally
  // (transformId null → it no-ops) to keep hook order stable; it only
  // fires a python preview when Tame is the active chapter's tone.
  const tameActive = tone.id === 'tame' && active !== EMPTY_CHAPTER;
  const tameSpans = useMemo(
    () => (tameActive ? [{ start_ms: active.atMs, end_ms: active.endMs }] : []),
    [tameActive, active.atMs, active.endMs],
  );
  const { previewBySpanStart: tamePreview, previewLoading: tameLoading } = useTransformPreview({
    funscriptPath: project?.path,
    transformId: tameActive ? 'tame' : null,
    params: tameActive ? { groove: toneParams.groove ?? 0.2 } : {},
    spans: tameSpans,
  });

  const afterSlice = useMemo(() => {
    if (tone.id === 'tame') {
      // Backend preview returns ABSOLUTE-time actions keyed by span start;
      // fall back to the source slice while the debounced request is in
      // flight so the After chart never blanks.
      const abs = tamePreview.get(active.atMs);
      return Array.isArray(abs) ? abs : beforeSlice;
    }
    return applyTone(originalActions, active.atMs, active.endMs, tone, toneParams);
  }, [tone, toneParams, originalActions, active.atMs, active.endMs, tamePreview, beforeSlice]);

  // Shared viewport for the Before/After preview charts. Pan or zoom one
  // and the other follows, so "compare what changed" reads the same time
  // window on both sides. Same pattern DeviceTab uses for its original
  // vs device-aware preview pair. Both charts use chapter-local time
  // (action.at - active.atMs), so the viewport is [0, chapterDurationMs].
  const chapterDurationMs = active.endMs - active.atMs;
  const [beforeAfterView, setBeforeAfterView] = useState({ start: 0, end: chapterDurationMs });

  // When the active chapter changes, jump the playhead to the chapter start
  // and pause. Click-to-select shouldn't leave the user with the playhead in
  // the middle of an unrelated chapter. Also reset the Before/After viewport
  // to full-chapter — a zoomed view from the previous chapter would point
  // at a time range that may not exist in the new one.
  useEffect(() => {
    if (active === EMPTY_CHAPTER) return;
    setCurrentMs(active.atMs);
    setIsPlaying(false);
    setBeforeAfterView({ start: 0, end: active.endMs - active.atMs });
  }, [active.id]);

  // Chapter clip extraction. The hook stream-copies the active chapter
  // via ffmpeg into a small temp file, fetches it into a blob: URL for
  // smooth seeks (capped at 150 MB — bigger clips fall back to the
  // asset URL to avoid WebView2 OOM), and revokes the previous blob
  // on swap. While extracting, `clip` is null so the player shows the
  // "Loading chapter…" overlay rather than the previous content.
  //
  // Same lifecycle PatternsTab uses (and Phrases/Stanzas/Events will).
  // See [[project-slice-viewer-pattern]] for the extraction rationale.
  const { clip: chapterClip, loading: chapterLoading } = useChapterClip(
    project?.mediaPath,
    active === EMPTY_CHAPTER ? null : active,
  );

  // rAF clock: advance currentMs while playing; loop back at chapter end.
  // The boundary is hard — we never let the playhead leave the active
  // chapter while playing (per "stay constrained in the thing we are
  // editing"). To leave the chapter the user clicks another band.
  //
  // Skipped when a video is attached. The video element is the master
  // clock then — MediaViewer emits onTimeChange on every video frame,
  // and we'd otherwise be writing currentMs from two sources (rAF
  // estimate + real video time). Drift between the two triggered the
  // seek-sync effect in MediaViewer to snap the video back, producing
  // perceptible jerk. With the rAF gate, the video clock wins
  // unopposed when present; rAF remains the fallback for the no-media
  // case (audio-only, browser mock, missing mediaPath).
  const hasVideoClock = !!project?.mediaPath;
  useEffect(() => {
    if (!isPlaying || active === EMPTY_CHAPTER) return undefined;
    if (hasVideoClock) return undefined;
    let rafId;
    let last = performance.now();
    const tick = (t) => {
      const dt = t - last;
      last = t;
      setCurrentMs((prev) => {
        const next = prev + dt;
        if (next >= active.endMs) return active.atMs;  // loop
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, hasVideoClock, active.atMs, active.endMs]);

  // Keyboard shortcuts. Brackets for chapter nav, Space for play/pause,
  // Home jumps to chapter start, , and . step one frame (~33ms ≈ 30fps).
  // Skip when focus is in an input/textarea so typing isn't hijacked.
  useEffect(() => {
    const onKey = (e) => {
      const tgt = e.target;
      if (tgt && tgt.matches && tgt.matches('input, textarea, [contenteditable="true"]')) return;
      const i = chapters.findIndex((c) => c.id === active.id);
      if (e.key === '[' && i > 0) {
        setActiveId(chapters[i - 1].id); e.preventDefault();
      } else if (e.key === ']' && i >= 0 && i < chapters.length - 1) {
        setActiveId(chapters[i + 1].id); e.preventDefault();
      } else if (e.key === ' ' || e.code === 'Space') {
        setIsPlaying((p) => !p); e.preventDefault();
      } else if (e.key === 'Home') {
        setCurrentMs(active.atMs); e.preventDefault();
      } else if (e.key === ',') {
        setCurrentMs((ms) => Math.max(active.atMs, ms - 33)); e.preventDefault();
      } else if (e.key === '.') {
        setCurrentMs((ms) => Math.min(active.endMs, ms + 33)); e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chapters, active.id, active.atMs, active.endMs]);

  // Empty-state early return AFTER all hooks have run.
  if (chapters.length === 0) {
    return (
      <ChaptersEmptyState
        canCreate={!!project?.path}
        n={splitN}
        onChangeN={setSplitN}
        onCreate={handleCreateChapters}
        creating={creating}
        hasMedia={!!project?.mediaPath}
        onAttachMedia={onAttachMedia}
        onAnalyze={handleAnalyzeWithVideoflow}
        analyzing={analyzing}
        analyzeError={analyzeError}
      />
    );
  }

  const setParam = (key, val) => {
    setParamsByChapter((s) => ({
      ...s,
      [active.id]: {
        ...s[active.id],
        [tone.id]: { ...s[active.id][tone.id], [key]: val },
      },
    }));
  };

  // Accept the active chapter's tone, bake the toned slice into the
  // project's working actions, and advance to the next chapter. Discrete
  // from the tab-level "Accept and chain to Device" — that one writes
  // the chain file and moves tabs; this one stays on the Chapters tab
  // so the user can work through chapters at their own pace.
  //
  // Merge strategy: rebuild the working actions from the original
  // snapshot, splicing every accepted chapter's toned slice into its
  // range. This makes accept idempotent — if the user tweaks chapter 1's
  // tone and re-accepts, chapter 1's slice is re-toned from the original
  // (not from the previously-toned data), so transforms never compound.
  const handleAcceptTone = async () => {
    if (active === EMPTY_CHAPTER) return;
    const i = chapters.findIndex((c) => c.id === active.id);
    const advance = () => {
      if (i < 0 || i >= chapters.length - 1) return;
      const nextId = chapters[i + 1].id;
      // Carry the just-accepted tone (and its tuned params) forward to the
      // next chapter, so applying one tone down the timeline is fast — pick
      // it once, Accept-Accept-Accept. The user overrides per chapter as
      // needed. We don't clobber a chapter the user already accepted (it's
      // signed off), but an un-accepted next chapter inherits regardless of
      // its analyzer seed — that's the point of carry-forward.
      const carriedToneId = tonesByChapter[active.id] ?? tone.id;
      const carriedParams = paramsByChapter[active.id]?.[carriedToneId];
      if (!acceptedChapterIds.has(nextId)) {
        setTonesByChapter((s) => ({ ...s, [nextId]: carriedToneId }));
        if (carriedParams) {
          setParamsByChapter((s) => ({
            ...s,
            [nextId]: { ...(s[nextId] ?? {}), [carriedToneId]: { ...carriedParams } },
          }));
        }
      }
      setActiveId(nextId);
    };

    // Persist the per-chapter tone choices to the sidecar so they survive
    // close/reopen instead of resetting to the analyzer suggestion. Writes
    // the whole tones map (cheap) with the just-accepted chapter's tone
    // guaranteed present. Best-effort — a write failure never blocks the
    // in-session edit. The sourcePath mirrors the split/join writer.
    const persistTones = () => {
      const sourcePath = project?.mediaPath ?? project?.path;
      if (!sourcePath) return;
      const tones = { ...tonesByChapter, [active.id]: tone.id };
      writeChaptersSidecar(sourcePath, attachTones(chapters, tones))
        .catch((err) => console.warn('ChaptersTab: tone persist failed', err));
    };

    // Tame runs the REAL backend transform over the chapter span and rolls
    // the merged result into the working funscript (same path as the
    // Phrases/Stanzas Apply), so the device-aware groove + cycle-drop are
    // faithful and survive close/reopen. The six expressive tones still use
    // the synchronous JS merge below.
    if (tone.id === 'tame') {
      if (!project?.path) return;
      setBusy?.({ message: `Applying Tame to ${active.name || 'chapter'}…` });
      try {
        const spans = [{ start_ms: active.atMs, end_ms: active.endMs }];
        const res = await transformApplyActions(
          project.path, 'tame',
          { max_bpm: toneParams.max_bpm ?? 360, groove: toneParams.groove ?? 0.2 },
          spans,
        );
        if (res && Array.isArray(res.actions)) {
          onActionsPatch?.(res.actions);
          await saveWorkingFunscript(project.path, res.actions);
        }
      } catch (e) {
        setAppError?.(`Could not apply Tame: ${e?.message ?? e}`);
      } finally {
        setBusy?.(null);
      }
      setAcceptedChapterIds((prev) => new Set(prev).add(active.id));
      persistTones();
      advance();
      return;
    }

    const nextAccepted = new Set(acceptedChapterIds);
    nextAccepted.add(active.id);
    setAcceptedChapterIds(nextAccepted);
    const merged = mergeWorkingActions({
      originalActions,
      chapters,
      acceptedIds: nextAccepted,
      tones: tonesByChapter,
      params: paramsByChapter,
    });
    onActionsPatch?.(merged);
    persistTones();
    advance();
  };

  // Persist a mutated chapter list and re-extract the affected clips with
  // footer progress. Sidecar write + clip extraction are kicked off after
  // local state has been swapped, so the UI reflects the new chapter
  // layout immediately; the new active chapter's clip extract dedups with
  // useChapterClip's own fetch (see useChapterClip.js __pendingExtracts).
  const persistAndExtract = async (newChapters, affectedChapters, tones = tonesByChapter) => {
    const sourcePath = project?.mediaPath ?? project?.path;
    if (sourcePath) {
      try {
        await writeChaptersSidecar(sourcePath, attachTones(newChapters, tones));
      } catch (err) {
        console.warn('ChaptersTab: writeChaptersSidecar failed', err);
        setAppError?.(`Could not write chapters sidecar: ${err?.message ?? err}`);
      }
    }
    if (project?.mediaPath && affectedChapters.length > 0) {
      const total = affectedChapters.length;
      for (let i = 0; i < total; i += 1) {
        const c = affectedChapters[i];
        setBusy?.({ message: `Extracting new chapter clip ${i + 1}/${total}…` });
        try {
          await extractChapterClip(project.mediaPath, c.atMs, c.endMs);
        } catch (err) {
          console.warn('ChaptersTab: extractChapterClip failed', c.id, err);
        }
      }
      setBusy?.(null);
    }
  };

  // Re-derive phrases after a chapter boundary change (split / join). Step 1
  // is chapter-scoped, so moving a boundary invalidates the phrase spans —
  // their chapter_ids now point at the wrong slot. This re-runs the quick
  // (seconds) phrase pass and refreshes the per-path cache so PhrasesTab /
  // AnalysisTab see fresh data without a manual reload.
  //
  // It SHOWS a busy indicator: analyzePhrases is a real backend call with no
  // pipeline progress of its own, so without a label the recompute reads as a
  // frozen app — the "phantom analyze that looked stuck / not the usual
  // analysis" from the 2026-06-15 dogfood. The label names what's happening.
  const recomputePhrasesAfterChapterChange = (reason) => {
    if (!setPhrasesByPath || !project?.path) return;
    // `title` is the persistent frame (the ff:progress stream from `assess`
    // overwrites `message`/`steps` as its stages roll, but never `title`), so
    // the user always sees WHY this is running. `steps: []` lets the assess
    // sub-stages populate the checklist beneath the title.
    setBusy?.({ title: 'Recomputing phrases — chapters changed', message: '', steps: [] });
    analyzePhrases(project.path)
      .then((phraseRows) => {
        if (!Array.isArray(phraseRows)) return;
        setPhrasesByPath((prev) => ({
          ...prev,
          [project.path]: { phrases: phraseRows, loaded: true },
        }));
      })
      .catch((err) => console.warn(`ChaptersTab: phrase re-run after ${reason} failed`, err))
      .finally(() => setBusy?.(null));
  };

  // Split the band's chapter at the playhead. The pure transform (and the
  // ≥500ms clearance check) lives in chapterOps.splitAt; this handler is
  // the orchestrator that lifts state, persists, and re-extracts clips
  // for both halves.
  const handleSplitAtPlayhead = async (band) => {
    const result = splitAt(chapters, band.id, currentMs);
    if (!result.ok) {
      if (result.reason === 'no-clearance') {
        setAppError?.('Playhead too close to chapter boundary — move at least 500ms from each edge before splitting.');
      }
      return;
    }
    const { chapters: newChapters, remap, newActiveIdx } = result;
    const { newTones, newParams, newAccepted } = applyRemap(remap, {
      tones: tonesByChapter, params: paramsByChapter, accepted: acceptedChapterIds,
    });
    setChapters(newChapters);
    setTonesByChapter(newTones);
    setParamsByChapter(newParams);
    setAcceptedChapterIds(newAccepted);
    setActiveId(newChapters[newActiveIdx].id);
    onChaptersChange?.(newChapters);
    await persistAndExtract(
      newChapters,
      [newChapters[newActiveIdx - 1], newChapters[newActiveIdx]],
      newTones,
    );
    // Chapters changed → phrase boundaries are stale; re-derive (with a
    // visible "Recomputing phrases…" indicator).
    recomputePhrasesAfterChapterChange('split');
  };

  // Join the band's chapter with its previous / next neighbour. Pure
  // transform lives in chapterOps.joinAt; this handler lifts state,
  // persists, and re-extracts the merged clip.
  //
  // Note on the explicit setCurrentMs: when the user was already on the
  // earlier of the two chapters, the renumber gives the merged chapter
  // the same id, so the [active.id] useEffect that normally snaps the
  // playhead to atMs doesn't fire. Setting currentMs here means the
  // cursor always lands at the start of the joined chapter regardless
  // of which neighbour absorbed which — review the new chapter from
  // the top.
  const handleJoin = async (band, direction) => {
    const result = joinAt(chapters, band.id, direction);
    if (!result.ok) return;
    const { chapters: newChapters, remap, newActiveIdx } = result;
    const { newTones, newParams, newAccepted } = applyRemap(remap, {
      tones: tonesByChapter, params: paramsByChapter, accepted: acceptedChapterIds,
    });
    setChapters(newChapters);
    setTonesByChapter(newTones);
    setParamsByChapter(newParams);
    setAcceptedChapterIds(newAccepted);
    setActiveId(newChapters[newActiveIdx].id);
    setCurrentMs(newChapters[newActiveIdx].atMs);
    setIsPlaying(false);
    onChaptersChange?.(newChapters);
    await persistAndExtract(newChapters, [newChapters[newActiveIdx]], newTones);
    // Chapters changed → phrase boundaries stale; re-derive (with indicator).
    recomputePhrasesAfterChapterChange('join');
  };

  return (
    <section style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Page header */}
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>
          Chapters · tone
        </div>
        <h2 style={{ margin: '4px 0 6px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Set the emotional arc
        </h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 780, lineHeight: 1.5 }}>
          Each chapter gets one tone. Tone is a script-wide bias that shapes
          the phrase-level suggestions on the Edit tab — set the stage here,
          refine per-phrase next. <em>Preview only;</em> tone CLI lands later.
        </div>
      </div>

      {/* Top row: ChapterRibbon (left) + chapter-scoped MediaViewer (right).
          The ribbon's active band carries the funscript waveform for that
          chapter, so the older separate FunscriptChart at the top is gone —
          the waveform is now content *inside* the ribbon, not a sibling.
          Same height left/right (default-200 ribbon ≈ default-200 viewer).

          Click a band's title or frame to select that chapter (chapter
          becomes the new edit scope). The 3-dot per-band menu offers
          Split-at-playhead / Join-with-prev / Join-with-next — all stubbed
          for now (handlers log TODO). The redundant Split/Join in the
          ActiveChapterHeader below has been dropped. */}
      {/* Viewer column widened to 360px 2026-05-21 — the 240px column
          was too narrow for the AudioDashboard text, causing labels
          like "broadband · moderate" + "ƒ: 480Hz [380–520]" to wrap
          and shift the entire viewer's vertical alignment frame to
          frame. Wider viewer = labels fit on one line, no jump.
          The 16:9 thumbnail letterboxes against the black background
          when source aspect differs (already does so via objectFit:
          contain). Ribbon still has 1fr — narrower per-band slots
          but the band waveforms hold up; user has explicitly preferred
          a roomier viewer over a roomier ribbon. */}
      {/* Ribbon + viewer wrapped in ONE bordered box so they read as a
          single unit (paint mock 2026-05-23). Column 320px matches
          Phrases / Patterns; right edges and visual rhythm align across
          all three editing tabs. */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 12,
      }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'stretch' }}>
          <ChapterRibbon
            bands={chapters.map((c, i) => ({
              id: c.id,
              at_ms: c.atMs,
              end_ms: c.endMs,
              // Display label is index + style eyebrow (`01 · DRIVING`).
              // chapter.name is intentionally dropped (2026-05-25) —
              // names rot across split/join; the index always identifies
              // the chapter's position and content_type identifies what
              // it is. See project-split-join-in-flight memory.
              name: chapterDisplayLabel(c, i),
              color: c.color,
              toneColor: findTone(tonesByChapter[c.id])?.color,
              // Surface per-chapter acceptance to the ribbon so the
              // upper-left corner of each band can render a checkmark
              // for chapters the user has signed off on. The ribbon's
              // Band component reads this flag.
              accepted: acceptedChapterIds.has(c.id),
            }))}
            actions={actions}
            selectedId={active.id}
            onSelect={(band) => setActiveId(band.id)}
            // Click inside the currently-active chapter → scrub to that
            // ms. Different band → onSelect handles the chapter switch.
            // The clamp keeps a click at the very edge from spilling
            // past the chapter bounds (which would re-clamp through
            // the onSeek handler on MediaViewer anyway).
            onSeek={(ms) => setCurrentMs(Math.max(active.atMs, Math.min(active.endMs, ms)))}
            currentMs={currentMs}
            menu={[
              {
                id: 'split',
                label: 'Split at playhead',
                icon: 'scissors',
                onClick: handleSplitAtPlayhead,
              },
              {
                id: 'join-prev',
                label: 'Join with previous',
                icon: 'corner-up-left',
                onClick: (band) => handleJoin(band, 'prev'),
                disabled: (_b, i) => i <= 0,
              },
              {
                id: 'join-next',
                label: 'Join with next',
                icon: 'corner-up-right',
                onClick: (band) => handleJoin(band, 'next'),
                disabled: (_b, i) => i >= chapters.length - 1,
              },
            ]}
            // Bumped 200 → 220 (2026-05-20) so the ribbon's height
            // roughly matches the aspect-sized viewer's height on the
            // right side of the grid. Extra room also gives the per-
            // band velocity waveforms more vertical detail.
            height={220}
          />
          <MediaViewer
            // Prefer the per-chapter temp clip when available — small
            // standalone file, no range-request overhead, smooth play
            // even on 18GB sources. While the extract is in flight
            // videoSrc is undefined so the player shows the loading
            // overlay instead of the previous chapter's content.
            videoSrc={
              chapterClip && chapterClip.chapterId === active.id
                ? chapterClip.url
                : (chapterLoading ? undefined : toMediaUrl(project?.mediaPath))
            }
            videoSrcOffsetMs={
              chapterClip && chapterClip.chapterId === active.id
                ? chapterClip.offsetMs
                : 0
            }
            media={{ kind: project?.mediaKind ?? 'video', title: chapterDisplayLabel(active, chapters.indexOf(active)) }}
            loadingLabel={chapterLoading ? 'Loading chapter…' : null}
            audioWaveform={audioWaveform}
            // Spectrogram is full-track: SpectrogramCanvas does its own
            // absolute-time windowing from currentMs (mirrors how
            // FunscriptBeatWindow handles its 12s scroll). No chapter-
            // scope slicing needed here, unlike the peaks waveform.
            spectrogram={trackSpectrogram}
            // Beats sidecar — used by WaveformCanvas to overlay tick
            // marks at exact beat positions, and by AudioDashboard
            // to surface the music BPM. Full-track; the canvas
            // filters to the visible window internally.
            beats={trackBeats}
            chapter={{
              id: active.id,
              title: chapterDisplayLabel(active, chapters.indexOf(active)),
              color: active.color,
              start: active.atMs,
              end: active.endMs,
            }}
            // Funscript shown in the viewer = the active chapter's toned
            // slice. The viewer's funscript-mode scrolling tape windows
            // by chapter bounds anyway, so passing the chapter slice (vs
            // full project actions) gives the user "see the funscript
            // updated for that chapter in the viewer" without leaving
            // the tab — pick a tone, the tape reflects it immediately.
            // 'Untoned' is a passthrough so chapters without a chosen
            // tone read the same as raw.
            funscript={{ actions: afterSlice }}
            currentMs={currentMs}
            totalMs={totalMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            // Manual seek clamps to chapter bounds — you can't leave the
            // chapter via scrubbing, only via clicking another band.
            onSeek={(ms) => setCurrentMs(Math.max(active.atMs, Math.min(active.endMs, ms)))}
            // Video-driven timeupdate. Loop back to chapter.atMs when
            // playback crosses chapter.endMs, matching the rAF clock's
            // semantics for the no-video case. The seek-sync effect in
            // MediaViewer will rewind the actual <video> element when
            // currentMs jumps backwards. Otherwise clamp to chapter
            // bounds so the playhead doesn't leave the active chapter
            // via the video's own clock.
            onTimeChange={(ms) => {
              if (ms >= active.endMs) setCurrentMs(active.atMs);
              else if (ms < active.atMs) setCurrentMs(active.atMs);
              else setCurrentMs(ms);
            }}
            controls={['chapter-start', 'back1', 'frame-back', 'play', 'frame-forward', 'forward1', 'chapter-end']}
            modeToggleAlign="start"
            modeToggleSize="sm"
            showModeLabel={false}
            showMark={false}
            onPrev={() => {
              // Spotify / iTunes convention: when mid-chapter (more
              // than 3s past the start), restart the current chapter
              // instead of jumping to the previous one. The user has
              // to press twice — once to restart, once to go back —
              // which matches how every other media player handles the
              // "back" button. Reaching the previous chapter when
              // already at the start (or within 3s of it) is the
              // direct path.
              const PREV_RESTART_THRESHOLD_MS = 3000;
              const i = chapters.indexOf(active);
              const intoChapter = (currentMs || 0) - active.atMs;
              if (intoChapter > PREV_RESTART_THRESHOLD_MS) {
                setCurrentMs(active.atMs);
              } else if (i > 0) {
                setActiveId(chapters[i - 1].id);
              } else {
                setCurrentMs(active.atMs);
              }
            }}
            onNext={() => {
              // Next button always advances chapter — no smart "skip
              // to end of current" behaviour (asymmetric with prev,
              // matching media-player convention).
              const i = chapters.indexOf(active);
              if (i < chapters.length - 1) setActiveId(chapters[i + 1].id);
              else setCurrentMs(Math.max(active.atMs, active.endMs - 1));
            }}
            width="100%"
            // 16:7 thumbnail (2026-05-21) — was 16:9 but the viewer
            // chrome (chip strip + AudioDashboard + timecode + transport)
            // made the overall card feel too tall, and the audio
            // waveform / spectrogram surface doesn't need 16:9 the way
            // a video frame does. 16:7 shrinks the surface ~28% so the
            // card reads more compact while keeping the audio bands
            // legible. Video frames letterbox with side bars (objectFit:
            // contain) — user explicitly preferred letterbox over a
            // taller card.
            thumbnailAspect="16/7"
          />
      </div>
      </div>

      {/* Rail + detail row. Rail is a scannable vertical list of all chapters;
          the bands above are the horizontal time-aware selector. Both drive
          the same activeId — the rail is what you read, the bands are what
          you click when you need positional context. */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18 }}>
        <ChapterRail
          chapters={chapters}
          tones={tonesByChapter}
          activeId={active.id}
          acceptedIds={acceptedChapterIds}
          onSelect={setActiveId}
        />

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ActiveChapterHeader
            chapter={active}
            displayLabel={chapterDisplayLabel(active, chapters.indexOf(active))}
            tone={tone}
            mediaPath={project?.mediaPath}
            onAttachMedia={onAttachMedia}
          />

          {/* Tone picker — full width in the detail column */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <SectionLabel>Tone · {tone.label}</SectionLabel>
            <TonePicker
              tones={TONES}
              value={tone.id}
              onChange={(id) => setTonesByChapter((s) => ({ ...s, [active.id]: id }))}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {tone.desc}
            </div>
          </div>

          {/* Tone params + before/after preview */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16,
          }}>
            {/* Hide Impact + tone-specific params when the user picked
                Untoned — there's nothing to apply, so the controls would
                read as no-ops. The Before/After charts still render so
                you can still scrub through the chapter to confirm what
                you're "not touching." */}
            {tone.id !== 'none' && (
              <>
                {/* Impact is an expressive-tone concept (how much of the
                    mood to blend in). Tame is corrective, not a blend —
                    its strength lives entirely in Max BPM + Groove — so it
                    skips Impact and shows just its two backend params. */}
                {tone.id !== 'tame' && (
                  <Slider
                    label="Impact — how much of this tone to apply"
                    value={toneParams.impact ?? 0.5}
                    min={0} max={1} step={0.01}
                    valueLabel={(toneParams.impact ?? 0.5).toFixed(2)}
                    onChange={(v) => setParam('impact', v)}
                  />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
                  {tone.params.map((p) => {
                    const v = toneParams[p.id] ?? p.def;
                    return (
                      <Slider
                        key={p.id}
                        label={p.label}
                        value={v}
                        min={p.min} max={p.max} step={p.step}
                        valueLabel={p.fmt(v)}
                        onChange={(nv) => setParam(p.id, nv)}
                      />
                    );
                  })}
                </div>

                <div style={{ height: 1, background: 'var(--border)', margin: '16px 0 14px' }} />
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <BeforeAfterCol title="Untoned" subtitle="source · chapter slice">
                <FunscriptChart
                  actions={beforeSlice.map((a) => ({ at: a.at - active.atMs, pos: a.pos }))}
                  totalMs={active.endMs - active.atMs}
                  height={120}
                  view={beforeAfterView}
                  onViewChange={setBeforeAfterView}
                  bare
                />
              </BeforeAfterCol>
              <BeforeAfterCol
                title="After"
                subtitle={
                  tone.id === 'none'
                    ? 'passthrough — no transform applied'
                    : tone.id === 'tame'
                      ? `Tame · Max BPM ${toneParams.max_bpm ?? 360}${tameLoading ? ' · updating…' : ''}`
                      : `${tone.label} · impact ${Math.round((toneParams.impact ?? 0.5) * 100)}%`
                }
                accent={tone.color}
              >
                <FunscriptChart
                  actions={afterSlice.map((a) => ({ at: a.at - active.atMs, pos: a.pos }))}
                  totalMs={active.endMs - active.atMs}
                  height={120}
                  view={beforeAfterView}
                  onViewChange={setBeforeAfterView}
                  bare
                />
              </BeforeAfterCol>
            </div>
          </div>

          {/* Per-chapter accept row — discrete from the tab-level
              "Accept and chain to Patterns" in the AcceptBar below. This
              one keeps the user on the Chapters tab, bakes the active
              chapter's toned slice into the project's working actions,
              and advances to the next chapter. The count next to it is
              the progress through the chapter list. */}
          {(() => {
            const idx = chapters.findIndex((c) => c.id === active.id);
            const isLast = idx >= chapters.length - 1;
            const isAccepted = acceptedChapterIds.has(active.id);
            const acceptedCount = acceptedChapterIds.size;
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '12px 14px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 8,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 0 }}>
                  {acceptedCount} of {chapters.length} chapters confirmed
                  {isAccepted && (
                    <span style={{ marginLeft: 10, color: tone.color, fontWeight: 700 }}>
                      ✓ This chapter is set
                    </span>
                  )}
                </div>
                <button
                  onClick={handleAcceptTone}
                  title={isLast
                    ? 'Bake this chapter’s tone into the working funscript'
                    : 'Bake this chapter’s tone and move to the next chapter'}
                  style={{
                    padding: '8px 14px', fontSize: 12.5, fontWeight: 700,
                    background: tone.color, color: '#fff',
                    border: 'none', borderRadius: 6,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Icon name="check" size={13} />
                  {isLast ? 'Accept tone (last chapter)' : 'Accept tone · next chapter'}
                </button>
              </div>
            );
          })()}

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <ChStat label="Tone" value={tone.label} hint="chapter bias" color={tone.color} />
            <ChStat label="Duration" value={fmtTimeShort(active.endMs - active.atMs)}
                     hint={`${Math.round(((active.endMs - active.atMs) / Math.max(1, totalMs)) * 100)}% of script`} />
            <ChStat label="Content" value={active.content_type || '—'} hint="from sidecar" />
            <ChStat label="Confidence" value={
              active.confidence ? `${Math.round(active.confidence * 100)}%` : '—'
            } hint="analyzer score" />
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{children}</div>
  );
}

function BeforeAfterCol({ title, subtitle, accent, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: accent || 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>— {subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function ChapterRail({ chapters, tones, activeId, acceptedIds, onSelect }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden', alignSelf: 'start',
    }}>
      <div style={{
        padding: '12px 14px', fontSize: 10, fontWeight: 700,
        color: 'var(--text-dim)', textTransform: 'uppercase',
        letterSpacing: '0.08em', borderBottom: '1px solid var(--border)',
      }}>
        Chapters · {chapters.length}
      </div>
      {chapters.map((c, i) => {
        const sel = c.id === activeId;
        const t = findTone(tones[c.id]);
        const accepted = acceptedIds?.has(c.id) ?? false;
        return (
          <button
            key={c.id}
            onClick={() => onSelect?.(c.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '12px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? 'var(--accent)' : 'transparent'}`,
              borderBottom: i < chapters.length - 1 ? '1px solid var(--border)' : 'none',
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            {/* Accept indicator — a checkmark when the chapter's tone
                has been confirmed via the per-chapter accept action.
                Pinned to the same horizontal slot regardless of state
                so the row layout doesn't reflow when a chapter flips
                from pending to accepted. */}
            <span style={{
              width: 14, height: 14, borderRadius: 7,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: accepted ? (t.color + '33') : 'transparent',
              border: `1px solid ${accepted ? t.color : 'var(--border)'}`,
              color: accepted ? t.color : 'var(--text-dim)',
              opacity: accepted ? 1 : 0.45,
            }}>
              {accepted && <Icon name="check" size={9} />}
            </span>
            <span style={{ width: 4, height: 36, borderRadius: 2, background: c.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: sel ? 700 : 600 }}>
                {chapterDisplayLabel(c, i)}
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)',
                marginTop: 2, fontFamily: 'var(--font-mono)',
              }}>
                {fmtTimeShort(c.atMs)}–{fmtTimeShort(c.endMs)}
              </div>
            </div>
            <Pill tone="neutral" style={{ background: t.color + '22', color: t.color, borderColor: t.color + '55' }}>
              {t.label}
            </Pill>
          </button>
        );
      })}
    </div>
  );
}

function ActiveChapterHeader({ chapter, displayLabel, tone, mediaPath, onAttachMedia }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: chapter.color }} />
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
        {displayLabel ?? chapter.id}
      </h3>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
        {fmtTimeShort(chapter.atMs)}–{fmtTimeShort(chapter.endMs)}
      </span>
      <Pill tone="neutral" style={{ background: tone.color + '22', color: tone.color, borderColor: tone.color + '55' }}>
        Tone: {tone.label}
      </Pill>
      <div style={{ flex: 1 }} />
      {/* Split/Join moved into the per-band 3-dot menu on the ChapterRibbon
          above — same actions, but adjacent to the band they operate on. */}
      {!mediaPath && (
        <ChapterActionButton onClick={onAttachMedia} title="Attach video / audio">
          <Icon name="upload-cloud" size={12} style={{ marginRight: 4 }} />
          Attach media
        </ChapterActionButton>
      )}
    </div>
  );
}

function ChapterActionButton({ children, disabled, ...rest }) {
  return (
    <button
      disabled={disabled}
      style={{
        padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        color: disabled ? 'var(--text-dim)' : 'var(--text)',
        borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function TonePicker({ tones, value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tones.length}, 1fr)`, gap: 6 }}>
      {tones.map((t) => {
        const sel = t.id === value;
        // The 'none' opt-out card follows the opt-out pattern (see
        // feedback-opt-out-card-pattern memory): grey surface, no
        // colored dot, neutral selected state — visually distinct
        // from the 6 tone cards so users read it as "choose to skip"
        // rather than "tone number 0."
        const isOptOut = t.id === 'none';
        return (
          <button
            key={t.id}
            onClick={() => onChange?.(t.id)}
            title={t.desc}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 10px', borderRadius: 6,
              background: sel
                ? (isOptOut ? 'var(--surface-2)' : t.color + '22')
                : 'var(--surface)',
              border: `1.5px solid ${
                sel
                  ? (isOptOut ? 'var(--text-dim)' : t.color)
                  : 'var(--border)'
              }`,
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {!isOptOut && (
              <span style={{
                width: 8, height: 8, borderRadius: 2,
                background: t.color, flexShrink: 0,
              }} />
            )}
            <span style={{
              fontSize: 12.5, fontWeight: 700,
              color: sel
                ? (isOptOut ? 'var(--text)' : t.color)
                : (isOptOut ? 'var(--text-muted)' : 'var(--text)'),
            }}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Empty state — shown when project.chapterList is empty and no chapters
// have been created yet in-session. Two creation paths:
//   1. Manual equal-split (always available) — N-slider writes evenly-spaced
//      chapters into <stem>.chapters.json.
//   2. Analyze with videoflow (requires adjacent media) — content-aware
//      boundaries via videoflow.structural.auto_chapter, which inspects the
//      audio (RMS / spectral flux / recurrence clustering) and writes the
//      same sidecar shape, tagged so we can tell hand-split from analyzer.
function ChaptersEmptyState({
  canCreate, n, onChangeN, onCreate, creating,
  hasMedia, onAttachMedia, onAnalyze, analyzing, analyzeError,
}) {
  const busy = creating || analyzing;
  return (
    <section style={{ padding: '32px 24px', maxWidth: 720 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-dim)',
      }}>
        Chapters · empty
      </div>
      <h2 style={{ margin: '4px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>
        No chapters yet
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 560 }}>
        Chapters break a long funscript into manageable arcs. Pick a starting
        point — content-aware detection from the adjacent media, or an
        equal-split you can fine-tune later. Either way writes to{' '}
        <code>&lt;stem&gt;.chapters.json</code> next to the funscript.
      </p>

      {/* Card 1: Analyze with videoflow — content-aware, requires media */}
      <div style={{
        marginTop: 22, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Analyze with videoflow
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Recommended when media is attached
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Inspects the adjacent video/audio (RMS, spectral flux, recurrence
          clustering) and writes content-aware chapter boundaries. Slower than
          equal-split but the cuts land on real transitions.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onAnalyze}
            disabled={!canCreate || !hasMedia || busy}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: 700,
              background: canCreate && hasMedia && !busy ? 'var(--accent)' : 'var(--surface-2)',
              color: canCreate && hasMedia && !busy ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: canCreate && hasMedia && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {analyzing ? 'Analyzing…' : 'Analyze with videoflow'}
          </button>
          {!hasMedia && canCreate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={onAttachMedia}
                disabled={busy}
                style={{
                  padding: '7px 12px', fontSize: 12, fontWeight: 600,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Icon name="upload-cloud" size={12} />
                Attach media…
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                Videoflow needs a video or audio file to inspect.
              </span>
            </div>
          )}
        </div>
        {analyzeError && (
          <div style={{ fontSize: 11.5, color: '#e74c3c' }}>
            {analyzeError}
          </div>
        )}
      </div>

      {/* Card 2: Equal-split — always available */}
      <div style={{
        marginTop: 14, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Equal-split
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 1 }}>
            <Slider
              label={`Number of chapters: ${n}`}
              value={n}
              min={2}
              max={12}
              step={1}
              valueLabel={`${n}`}
              onChange={onChangeN}
            />
          </div>
          <button
            onClick={onCreate}
            disabled={!canCreate || busy}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: 700,
              background: canCreate && !busy ? 'var(--accent)' : 'var(--surface-2)',
              color: canCreate && !busy ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: canCreate && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {creating ? 'Creating…' : `Create ${n} chapters`}
          </button>
        </div>
        {!canCreate && (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            Open a funscript on the Library tab first.
          </div>
        )}
      </div>
    </section>
  );
}

function ChStat({ label, value, hint, color }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 8,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: color || 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
    </div>
  );
}
