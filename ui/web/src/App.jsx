// FunscriptForge — top-level app shell.
//
// Tabs and screen content are ported incrementally from
// ../../../ui_design/ui_kits/funscriptforge-app/. The current state shows:
//   - Library screen (ported, using forgemoment primitives)
//   - Other tabs: placeholder
//   - Env badge: Tauri vs browser
//   - Bridge ping: confirms the platform adapter is wired

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TopBar, AcceptBar, StatusBar,
  Button, Pill,
} from 'forgemoment';
import { APP_VERSION } from './appVersion.js';
import {
  isTauri, ping, loadProject, loadSampleProject, attachMedia,
  pickMediaFile, pickProjectFile, classifyProjectFile,
  probeMedia, promoteGeneratedFunscript,
  importForgeBundle, getLaunchBundle,
  loadAudioPeaks, loadAudioSpectrogram, loadAudioBeats,
  revertWorkingFunscript, saveWorkingFunscript,
  countChapterClips, analyzeChaptersWithVideoflow,
  analyzerVersionStale,
} from './api/forge.js';
import { deriveAnalysisState } from './lib/analysisState.js';
import { probeMediaCached } from './hooks/useChapterClip.js';
import LibraryScreen from './screens/LibraryScreen.jsx';
import ProjectTab from './screens/ProjectTab.jsx';
import GenerateTab from './screens/GenerateTab.jsx';
import AnalysisTab from './screens/AnalysisTab.jsx';
import PolishTab from './screens/PolishTab.jsx';
import ViewerTab from './screens/ViewerTab.jsx';
import ChaptersTab from './screens/ChaptersTab.jsx';
import PhrasesTab from './screens/PhrasesTab.jsx';
import StanzasTab from './screens/StanzasTab.jsx';
import EventsTab from './screens/EventsTab.jsx';
import CharactersTab from './screens/CharactersTab.jsx';
import ExportTab from './screens/ExportTab.jsx';
import CatalogTab from './screens/CatalogTab.jsx';
import AboutDialog from './components/AboutDialog.jsx';
import OpenProjectDialog from './components/OpenProjectDialog.jsx';
import { loadSession, saveSession } from './lib/sessionStore.js';

// Format a millisecond duration as a `m:ss` (or `h:mm:ss`) clock for the
// Project header pill. Used for video-only projects whose duration comes
// from an ffprobe rather than a funscript's last action.
function msToClock(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const TABS = [
  { id: 'library',   label: 'Library' },
  { id: 'project',   label: 'Project' },
  // 'generate' (2026-06-14) sits between Project and Analysis — the front
  // door for CREATING the main funscript by shaping two macro curves: Range
  // (how far each stroke goes) and Pace (how busy). Beta = presets only. The
  // generator is a stand-in (data/generate.js ENGINE SEAM) until videoflow's
  // --density-arc / --center-trajectory are exposed through the bridge. See
  // DESIGN_DECISIONS.md + memory project_generator_into_funscriptforge.
  { id: 'generate',  label: 'Generate' },
  // 'analysis' (2026-05-24) sits between Project and Chapters. Read-only
  // overview surface — chapter strip, script overview, pitch line, beat
  // strength bars, energy heatmap, KPI strip, category drill-down. Runs
  // the auto-chapter pipeline on mount when sidecars are missing; per-
  // section progressive reveal as each stage's sidecar lands. The
  // visualization primitives live in forgemoment/src/analysis/ so
  // ForgeGen + Beatflo can reuse them.
  { id: 'analysis', label: 'Analysis' },
  { id: 'chapters',  label: 'Chapters' },
  // Motifs + Behaviors live INSIDE the Phrases tab as left-sidebar lenses
  // (2026-05-31) — they're groupings of the same phrases, not separate
  // analyses. The short-lived top-level Patterns / Adv.Patterns tabs were
  // retired here. See memory project_patterns_phrases_one_segmentation.
  // 'phrases' lineage: edit → transform → phrases (2026-05-16 PM). Both
  // patterns and phrases apply transforms, so the tab name follows the
  // unit you're operating on, not the verb. Pattern mode in the mode
  // bar is gone (Patterns has its own tab one step earlier).
  { id: 'phrases',   label: 'Phrases' },
  // 'stanzas' (2026-05-18) sits between Phrases and Stim. Sibling lens
  // to Phrases — same chassis, but the unit is videoflow's audio-derived
  // phrases (forgegen intent vocabulary: tease/steady/edging/...). See
  // project_stanzas_tab memory for rationale.
  { id: 'stanzas',   label: 'Stanzas' },
  // 'events' (2026-05-18) sits between Stanzas and Stim. Point-in-time
  // effects (edge/zap/tease) layered on top of the funscript — saved
  // to <stem>.events.yml on Accept. Skeleton landed 2026-05-18; the
  // wiring pass (Begin/End capture, parameter forms, YAML persistence)
  // is queued for before FF beta.
  { id: 'events',    label: 'Events' },
  // 'stim' (label: 'Channels', 2026-06-03 — was 'Characters') — first tab
  // that *generates* output. Now a multi-editor channels tab: Character
  // (the e-stim sensation gestalt, 9 channels) + Mechanical (multi-axis
  // position style, roll/pitch/twist/surge/sway) + Body (haptic regions,
  // coming soon), all sharing one chapter scope. Tab id stays 'stim' so
  // TAB_CHAIN / chain filenames / tabGate keep working without churn. See
  // memory `project_channels_character_merge.md`.
  { id: 'stim',      label: 'Channels' },
  // 'polish' (2026-06-04 — replaced the 'device' tab) is the last step
  // before Export: it shapes the device-agnostic Channels output into
  // device-ready files via per-station forge passes (clamp + smoothing +
  // lag), Stamping one output (or TCode set / e-stim channel set) per
  // station under <forge>/polish/<station>/. Targeting + clamping belong
  // at the end of the editing journey (the *where* + *how it plays*),
  // after chapters/phrases/stanzas/events/channels define the *what*.
  // See memory project_polish_tab.md.
  { id: 'polish',    label: 'Polish' },
  { id: 'export',    label: 'Export' },
  // Viewer sits AFTER Export — there's nothing to review until export has
  // produced the device channel funscripts (<stem>.output / .forge).
  { id: 'viewer',    label: 'Viewer' },
  // 'catalog' (2026-05-18) sits past Export with a visual separator —
  // utility tab, not part of the Project → Export pipeline. Source-of-
  // truth reference for every transform (tones / behaviors / structurals).
  // No funscript-required gate; safe to open without a project loaded.
  { id: 'catalog',   label: 'Catalog', utility: true },
];

export default function App() {
  const [tab, setTab] = useState('library');
  const [pong, setPong] = useState(null);
  const [openedProject, setOpenedProject] = useState(null);
  // Generate-tab curve picks (Range/Pace presets). Held here so they survive
  // the tab unmounting — without this, returning to Generate reset to the flat
  // default and re-generated a "Flat" script (dogfood 2026-06-14).
  const [genCurves, setGenCurves] = useState(null);
  // The Generate tab's CURRENT preview actions, lifted here so the footer's
  // "Continue with this funscript" can roll the draft into the working script
  // without the user first clicking "Set as working funscript" in-tab.
  const [genActions, setGenActions] = useState(null);
  // The Generate tab's last real engine result + the settings signature that
  // produced it — held here so returning to the tab restores it instead of
  // re-running the multi-minute generate (dogfood: "10 minutes to recreate").
  const [genResult, setGenResult] = useState(null);
  // Every project loaded this session — drives the Project tab's left
  // rail "Recent projects" list. Held at the App level so it survives
  // tab unmounts. In-memory only; cross-session persistence is the
  // Library tab's job (it scans configured roots on every open).
  const [loadedProjects, setLoadedProjects] = useState([]);
  // True while load_project is in flight. Used by tabGate to suppress
  // the "open a funscript" message while the load is mid-flight.
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  // App-level error surfaced in the footer (AcceptBar.error). Anything
  // the user needs to see but didn't trigger directly — a failed load,
  // a CLI shellout, a sidecar write — lands here. Footer is the one
  // surface that's always visible, so we don't have to hunt for the
  // right tab to attach an inline error to.
  const [appError, setAppError] = useState(null);
  // App-level busy indicator surfaced in the footer (AcceptBar.busy).
  // Shape: { message, fraction? } — fraction omitted = indeterminate.
  // Long-running ops (load_project, classify-patterns, transform apply,
  // export) drive this; a single surface beats N per-tab spinners.
  const [busy, setBusy] = useState(null);
  // App-level audio sidecars for the MediaViewer Audio + Spectrogram
  // modes. Both are pure sidecar reads off disk — the build happens
  // upstream during `videoflow.structural.auto_chapter` so they share
  // one decode with chapter / beat / phrase analysis. There is NO lazy
  // build path here anymore (it caused multi-session sidecar rebuilds
  // and burped video playback on first mode toggle — see
  // [[project-spectrogram-in-flight]]).
  //
  // trackPeaks shape:        { peaks: number[], durationMs, hopMs, mediaPath }
  // trackSpectrogram shape:  { cells: Uint8Array, nMels, nFrames, hopMs,
  //                            durationMs, dbFloor, dbCeiling, fmax, mediaPath }
  //
  // The `mediaPath` field guards against stale data when the user
  // switches projects between async reads — consumers check identity
  // before use.
  const [trackPeaks, setTrackPeaks] = useState(null);
  const [trackSpectrogram, setTrackSpectrogram] = useState(null);
  // trackBeats shape: { bpm, beatsMs: number[], downbeatsMs: number[],
  //                     durationMs, mediaPath }
  // Rendered as a tick overlay on the Audio waveform; the BPM also
  // surfaces in the AudioDashboard's headline row.
  const [trackBeats, setTrackBeats] = useState(null);
  // Count of finished chapter-clip files on disk (null = not-yet-counted).
  // Feeds the global analysis-state derivation so the footer can surface a
  // Partial/Resume strip when an analyze was interrupted DURING chapter_clips
  // (all sidecars present, clips short of chapters.length) — visible on every
  // downstream tab, not just Analysis. D5/D5b.
  const [chapterClipsPresent, setChapterClipsPresent] = useState(null);
  // `direct_playable` probe verdict for the open source. A direct-play source
  // skips clip extraction entirely (0 clips BY DESIGN), so the analysis state
  // must not false-flag it 'partial' on "missing" clips. null = unknown
  // (pending/failed) — deriveAnalysisState only suppresses the clip
  // requirement on an explicit true. D5c.
  const [mediaDirectPlay, setMediaDirectPlay] = useState(null);
  // selectedDevices is lifted here so it survives tab switches — once the
  // user picks devices in Project, downstream tabs (Device, Stim, Multi-axis)
  // see the same selection without re-prompting.
  const [selectedDevices, setSelectedDevices] = useState([]);
  // Phrases cache, keyed by funscript path. Lifted here (rather than
  // owned by PhrasesTab) so that leaving + returning to the tab doesn't
  // re-fire cli.py assess — the tab unmounts on switch. Shape per entry:
  // { phrases: PhraseRecord[], loaded: boolean }. Entries persist for
  // the session only; cross-restart persistence comes later via the
  // .ffmeta sidecar (see project-funscriptforge-pending).
  const [phrasesByPath, setPhrasesByPath] = useState({});
  // Per-chapter tone / param / accept edits, lifted here so they survive the
  // Chapters tab UNMOUNTING on a tab switch (D15: picking a tone was
  // component-local state and silently reverted to Untoned on return). Keyed by
  // project path; shape per entry: { tones, params, accepted: string[] }. The
  // on-Accept sidecar write still handles cross-restart persistence.
  const [chapterEditsByPath, setChapterEditsByPath] = useState({});
  // Stanzas cache — parallel structure to phrasesByPath. Survives tab
  // switches so `readStanzas` (sidecar read) only fires once per project
  // per session. Shape per entry: { stanzas: StanzaRecord[], loaded: boolean }.
  const [stanzasByPath, setStanzasByPath] = useState({});
  // Characters tab state — per-chapter character assignments, keyed by
  // funscript path. Unlike phrases/stanzas (which are cached fetch
  // results), this is *editing* state: which character the user picked
  // for each chapter. Lifted here so tab switches preserve assignments
  // before they're committed to a chain file. Shape per entry:
  // { [chapterId]: characterId }. Real persistence via .characters.json
  // chain file lands with the wiring pass.
  const [charactersByPath, setCharactersByPath] = useState({});
  // Help / About modal — opens from the TopBar help button. App-level
  // state (not TopBar-internal) so future keyboard shortcuts (F1, ?)
  // can also open it without prop-drilling.
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ping().then((res) => { if (!cancelled) setPong(res); });
    return () => { cancelled = true; };
  }, []);

  // Auto-clear "open a funscript" style errors once a project actually
  // loads. Other errors (load failure, attach failure, etc.) keep their
  // dismissible behavior — the user explicitly closes them. Only the
  // gate-style "you need a precondition" message clears on satisfaction.
  useEffect(() => {
    if (openedProject && typeof openedProject === 'object' && openedProject.path) {
      setAppError((prev) => {
        if (typeof prev === 'string' && /open a funscript/i.test(prev)) return null;
        return prev;
      });
    }
  }, [openedProject]);

  // Subscribe to "ff:progress" events emitted by long-running Tauri
  // commands (analyze_chapters_with_videoflow today, more later). Each
  // event payload is one of:
  //   `progress: start::<depth>::<leaf>` — stage opened
  //   `progress: done::<depth>::<leaf>`  — stage closed
  // We maintain `busy.steps` as an ordered list with done/running
  // status; the busy banner renders it as a step checklist.
  // Listener stays armed for the life of the app; the busy state is
  // owned by whoever triggered the operation (they clear on completion).
  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlistenFn = null;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen('ff:progress', (event) => {
        const raw = String(event?.payload ?? '');
        const stripped = raw.startsWith('progress: ') ? raw.slice('progress: '.length) : raw;
        if (!stripped) return;
        const parts = stripped.split('::');
        const kind = parts[0];
        const depth = parseInt(parts[1] || '0', 10);
        const leaf = parts[2] || (parts.length === 1 ? parts[0] : '');
        // For `msg::<depth>::<leaf>::<message>` everything after parts[2]
        // is the message body (it may contain `::` that the Python side
        // already sanitised — re-join just in case).
        const message = kind === 'msg' ? parts.slice(3).join('::') : null;
        if (!leaf) return;
        // Depth 1 = the outer command wrapper (e.g. `structural.auto_chapter`)
        //          — duplicates what the consumer already shows; skip.
        // Depth 2 = top-level pipeline stages — persistent steps list.
        // Depth 3+ = sub-stages — bubble to the message line so the user
        //            sees "what's happening *now*" inside the running step.
        if (depth <= 1) return;
        setBusy((prev) => {
          if (!prev) return prev;
          const steps = Array.isArray(prev.steps) ? prev.steps.slice() : [];
          // In-stage message: bubble to the headline.
          if (kind === 'msg' && message) {
            return { ...prev, message };
          }
          // Sub-stage events (depth>=3) — don't disturb the depth-2 step list.
          // On start: prefix with parent depth-2 stage so the user can tell
          // "audio_beats > extract" apart from the outer `extract` stage.
          // On done: clear message so the rolling header doesn't keep showing
          // a stale sub-stage label after the sub-stage has completed.
          if (depth >= 3) {
            if (kind === 'start') {
              const parent = steps.find((s) => s.status === 'running')?.label;
              const prefixed = parent ? `${parent} › ${leaf}` : leaf;
              return { ...prev, message: prefixed };
            }
            return { ...prev, message: '' };
          }
          // Top-level (depth 2) start/done events drive the step list.
          const idx = steps.findIndex((s) => s.label === leaf);
          if (kind === 'start') {
            for (let i = 0; i < steps.length; i += 1) {
              if (steps[i].status === 'running') steps[i] = { ...steps[i], status: 'done' };
            }
            if (idx === -1) steps.push({ label: leaf, status: 'running' });
            else steps[idx] = { ...steps[idx], status: 'running' };
            return { ...prev, steps, message: leaf };
          }
          if (kind === 'done' && idx >= 0) {
            // `done::<depth>::<leaf>[::<summary>]` — summary is the
            // "what was done" line (e.g. "13 chapters detected") that
            // we want to surface next to the green check.
            const summary = parts.slice(3).join('::') || undefined;
            steps[idx] = { ...steps[idx], status: 'done', summary };
            // Clear the message — no stage is actively emitting now, so
            // don't leave stale "Classifying chapter X/N" text in the
            // header. The next start::2 will repaint to the new stage name;
            // until then the consumer renders the neutral "Working…" fallback.
            return { ...prev, steps, message: '' };
          }
          return prev;
        });
      });
      if (cancelled) unlisten();
      else unlistenFn = unlisten;
    })();
    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Audio sidecar load — pure read off disk, no decode, no compute.
  // Both sidecars (.audio.json, .spectrogram.json) are written upstream
  // by `videoflow.structural.auto_chapter` as part of the chapter pass.
  // On project open, we attempt to read both; if either is absent, the
  // viewer renders an empty state pointing at "Analyze with videoflow."
  //
  // `refreshAudioSidecars` is called after the chapter analysis flow
  // completes so the freshly-written sidecars get loaded without
  // requiring a project re-open.
  const openedMediaPath = (typeof openedProject === 'object' && openedProject?.mediaPath) || null;

  const _doLoadAudioSidecars = useCallback((mediaPath) => {
    if (!mediaPath) return;
    Promise.all([
      loadAudioPeaks(mediaPath).catch((err) => {
        console.warn('App: loadAudioPeaks failed', err);
        return null;
      }),
      loadAudioSpectrogram(mediaPath).catch((err) => {
        console.warn('App: loadAudioSpectrogram failed', err);
        return null;
      }),
      loadAudioBeats(mediaPath).catch((err) => {
        console.warn('App: loadAudioBeats failed', err);
        return null;
      }),
    ]).then(([peaks, spec, beats]) => {
      // Identity guard — user may have switched projects while the
      // async reads were in flight. Only commit results matching the
      // mediaPath we started the read for.
      if (peaks && peaks.peaks?.length) {
        setTrackPeaks((prev) => {
          if (prev && prev.mediaPath !== mediaPath && openedMediaPath !== mediaPath) {
            return prev;
          }
          return { ...peaks, mediaPath };
        });
      } else if (openedMediaPath === mediaPath) {
        setTrackPeaks(null);
      }
      if (spec && spec.cells?.length) {
        setTrackSpectrogram((prev) => {
          if (prev && prev.mediaPath !== mediaPath && openedMediaPath !== mediaPath) {
            return prev;
          }
          return { ...spec, mediaPath };
        });
      } else if (openedMediaPath === mediaPath) {
        setTrackSpectrogram(null);
      }
      if (beats && beats.beatsMs?.length) {
        setTrackBeats((prev) => {
          if (prev && prev.mediaPath !== mediaPath && openedMediaPath !== mediaPath) {
            return prev;
          }
          return { ...beats, mediaPath };
        });
      } else if (openedMediaPath === mediaPath) {
        setTrackBeats(null);
      }
    });
  }, [openedMediaPath]);

  // Auto-load on project change. Clear stale state first so consumers
  // don't briefly see another project's data.
  useEffect(() => {
    if (!openedMediaPath) {
      setTrackPeaks(null);
      setTrackSpectrogram(null);
      setTrackBeats(null);
      return undefined;
    }
    setTrackPeaks((prev) =>
      prev && prev.mediaPath !== openedMediaPath ? null : prev,
    );
    setTrackSpectrogram((prev) =>
      prev && prev.mediaPath !== openedMediaPath ? null : prev,
    );
    setTrackBeats((prev) =>
      prev && prev.mediaPath !== openedMediaPath ? null : prev,
    );
    _doLoadAudioSidecars(openedMediaPath);
    return undefined;
  }, [openedMediaPath, _doLoadAudioSidecars]);

  // Callback for ChaptersTab to invoke after chapter analysis completes
  // (auto_chapter writes both sidecars as part of its pipeline). Could
  // also be invoked manually if we ever expose a "rebuild sidecars"
  // affordance — but the chapter-analysis path is the canonical trigger.
  const refreshAudioSidecars = useCallback(() => {
    _doLoadAudioSidecars(openedMediaPath);
  }, [_doLoadAudioSidecars, openedMediaPath]);

  // Count chapter clips on disk for the global analysis-state strip. Recount
  // when the media changes OR when a busy operation (analyze/Resume) finishes
  // (busy → null), so the footer Partial/Resume strip appears on reopen and
  // clears once the last clip lands. Skipped mid-operation. D5/D5b.
  useEffect(() => {
    if (!isTauri() || !openedMediaPath) { setChapterClipsPresent(null); return undefined; }
    if (busy) return undefined; // don't count mid-op; re-count when busy clears
    let cancelled = false;
    countChapterClips(openedMediaPath)
      .then((n) => { if (!cancelled && typeof n === 'number') setChapterClipsPresent(n); })
      .catch(() => { if (!cancelled) setChapterClipsPresent(null); });
    return () => { cancelled = true; };
  }, [openedMediaPath, busy]);

  // Probe the source's direct-playable verdict (cached, one probe per path,
  // shared with useChapterClip). Feeds deriveAnalysisState so a direct-play
  // source (0 clips by design) isn't perpetually 'partial' on missing clips.
  useEffect(() => {
    if (!isTauri() || !openedMediaPath) { setMediaDirectPlay(null); return undefined; }
    let cancelled = false;
    probeMediaCached(openedMediaPath)
      .then((p) => { if (!cancelled) setMediaDirectPlay(p?.direct_playable ?? null); })
      .catch(() => { if (!cancelled) setMediaDirectPlay(null); });
    return () => { cancelled = true; };
  }, [openedMediaPath]);

  const handleProjectOpened = (project) => {
    setOpenedProject(project);
    if (project && typeof project === 'object' && project.id) {
      setLoadedProjects((prev) => {
        const rest = prev.filter((p) => p.id !== project.id);
        return [project, ...rest];
      });
    }
  };

  // Switch the active project from a ProjectTab recents row click. If the
  // project is already cached in `loadedProjects` we just swap openedProject
  // — no reload, no loading flash. Otherwise (a recent we've never opened)
  // we route through handleOpenScript for the full load pipeline.
  const handleSelectProject = (project) => {
    if (!project) return;
    const cached =
      project.id && loadedProjects.find((p) => p.id === project.id);
    if (cached) {
      setOpenedProject(cached);
      return;
    }
    if (project.path) {
      // Carry the recents row's known media/title so a reopen resolves chapters
      // against the media-keyed sidecar (a generated funscript's stem differs
      // from the media stem — without this the reopen loses its chapters; D25).
      handleOpenScript(project.path, {
        title: project.title,
        mediaPath: project.mediaPath,
        mediaKind: project.mediaKind,
      });
    }
  };

  // ChaptersTab can mutate the chapter list (auto-split sidecar, videoflow
  // analyze). Lift that back to openedProject so downstream tabs (Patterns,
  // Phrases) see the same chapters. Without this, ChaptersTab held the new
  // chapters in *local state only* and Patterns saw an empty chapterList.
  const handleChaptersChange = (newChapterList) => {
    setOpenedProject((prev) => {
      if (!prev || typeof prev !== 'object') return prev;
      return { ...prev, chapterList: newChapterList, chapters: newChapterList.length };
    });
  };

  // Per-chapter "Accept tone" (ChaptersTab) bakes that chapter's toned
  // slice into the project's working actions so downstream tabs see the
  // toned shape *immediately* — no waiting on the tab-level chain step.
  // Caller passes the full replacement actions array; we splice it into
  // openedProject. The chain step still owns sidecar persistence; this
  // is purely an in-memory roll-forward of the working funscript.
  const handleActionsPatch = (nextActions) => {
    if (!Array.isArray(nextActions)) return;
    const activeId =
      typeof openedProject === 'object' ? openedProject?.id : null;
    const patch = (prev) => {
      if (!prev || typeof prev !== 'object') return prev;
      // Roll the edited actions forward AND flag the project dirty.
      // hasWorkingEdits drives the Project tab's "Edited — working copy"
      // pill + Revert-to-original button. Patching loadedProjects too is
      // load-bearing: ProjectTab renders the *loadedProjects* entry, not
      // openedProject — without this, the Project funscript chart shows
      // the pre-edit shape after the user navigates back to it (the edit
      // was visible in Chapters/Stanzas, which read openedProject, but
      // not in Project).
      return { ...prev, actions: nextActions, hasWorkingEdits: true };
    };
    setOpenedProject(patch);
    if (activeId != null) {
      setLoadedProjects((prev) =>
        prev.map((p) => (p.id === activeId ? patch(p) : p)),
      );
    }
  };

  // Adopt a freshly GENERATED funscript as the project's working script. Unlike
  // the in-memory `handleActionsPatch` (Chapters/Phrases call that AND persist
  // separately), generation is the one place that authors a wholly NEW funscript
  // — so adopting it must (1) roll it forward in memory, (2) persist it to disk
  // (save_working_funscript also deletes the now-stale <stem>.phrases.json), and
  // (3) drop the App-level phrase/stanza caches so the Phrases/Analysis tabs
  // rebuild against the new shape instead of the prior funscript's analysis
  // (dogfood 2026-06-14: "analyze didn't redo after we built the new funscript /
  // phrases showed old data"). Best-effort persistence — the in-memory adopt
  // always lands so the user is never blocked by a disk error.
  const adoptGeneratedFunscript = async (nextActions) => {
    if (!Array.isArray(nextActions) || !nextActions.length) return;
    handleActionsPatch(nextActions);
    const current = typeof openedProject === 'object' ? openedProject : null;
    const path = current?.path || null;
    // Video-only project (item D): there's no funscript path to save against.
    // PROMOTE the generated draft (<forge>/<stem>.generated.funscript) to a
    // real sibling <stem>.funscript next to the media, then reopen the project
    // off that path — it now loads as a normal funscript project and every
    // downstream tab (Analysis, Chapters, Phrases, …) works.
    if (!path) {
      const mediaPath = current?.mediaPath || null;
      if (!mediaPath) return; // nothing to promote against
      try {
        const res = await promoteGeneratedFunscript(mediaPath);
        if (res?.ok && res.path) {
          await handleOpenScript(res.path, {
            title: current?.title,
            mediaPath,
            mediaKind: current?.mediaKind,
            landTab: 'analysis', // adopt → straight to Analysis, no Project bounce
          });
          // The project just changed identity (video-only → funscript). Drop
          // the now-stale `media:` recents entry so it isn't a duplicate of
          // the funscript project that replaced it.
          if (current?.id) {
            setLoadedProjects((prev) => prev.filter((p) => p.id !== current.id));
          }
        } else {
          setAppError('Could not adopt the generated funscript — no draft was found to promote.');
        }
      } catch (err) {
        console.error('App: promote_generated_funscript failed', err);
        setAppError(err?.message ? `Could not adopt the generated funscript: ${err.message}` : 'Could not adopt the generated funscript.');
      }
      return;
    }
    try {
      await saveWorkingFunscript(path, nextActions);
    } catch (err) {
      console.error('App: saveWorkingFunscript (adopt generated) failed', err);
    }
    // Invalidate the funscript-derived analysis caches so a return to Phrases
    // /Analysis re-runs assess against the new actions (the on-disk
    // phrases.json was just deleted by save_working_funscript).
    setPhrasesByPath((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev }; delete next[path]; return next;
    });
    setStanzasByPath((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev }; delete next[path]; return next;
    });
  };

  // Open a BARE video/audio file as a project — before any funscript
  // exists. The front door for "generate a funscript from this video":
  // probe the media for duration/kind, seed a video-only project (no
  // funscript path), and land on the Project tab where the "Generate a
  // funscript" CTA picks up. Generation writes the draft; "Continue with
  // this funscript" promotes it to a real sibling .funscript (item D).
  const handleOpenMedia = async (mediaPath) => {
    if (!mediaPath) return;
    const filename = mediaPath.split(/[\\/]/).pop() || 'media';
    const stem = filename.replace(/\.[^.]+$/, '');
    setAppError(null);
    setBusy({ message: `Opening ${filename}…` });
    setTab('project');
    try {
      const info = await probeMedia(mediaPath);
      const durationMs = info?.duration_ms || 0;
      const project = {
        id: `media:${mediaPath}`,
        path: null,                       // video-only — no funscript yet
        mediaPath,
        mediaKind: info?.kind === 'audio' ? 'audio' : 'video',
        title: stem,
        durationMs,
        duration: msToClock(durationMs),
        actionCount: 0,
        _videoOnly: true,
      };
      handleProjectOpened(project);
    } catch (err) {
      console.error('App: handleOpenMedia failed', err);
      setAppError(err?.message ? `Could not open media: ${err.message}` : 'Could not open media.');
      setOpenedProject(null);
    } finally {
      setBusy(null);
    }
  };

  // Route an opened path by file kind: media → video-only project, funscript
  // → standard load. (.forge bundles import via ProjectTab's own picker.)
  const handleOpenPath = (path) => {
    if (!path) return;
    if (classifyProjectFile(path) === 'media') handleOpenMedia(path);
    else handleOpenScript(path);
  };

  // Pop the OS file picker and open the chosen file. Used by TopBar "Open"
  // and Project tab's empty state — the entry point for "open from
  // anywhere," outside the configured library roots. Accepts a funscript OR
  // a bare video/audio file (the video-only / generate-first path).
  const handlePickAndOpen = async () => {
    const path = await pickProjectFile();
    handleOpenPath(path);
  };

  // Load the synthetic "Big Buck Bunny" sample. Skips load_project
  // (which would parse a nonexistent file) and seeds openedProject
  // directly. Used by the Project tab empty state.
  const handleLoadSample = async () => {
    setAppError(null);
    setBusy({ message: 'Loading sample…' });
    setTab('project');
    try {
      const project = await loadSampleProject();
      handleProjectOpened(project);
    } catch (err) {
      console.error('App: loadSampleProject failed', err);
      setAppError(err?.message ? `Failed to load sample: ${err.message}` : 'Failed to load sample.');
    } finally {
      setBusy(null);
    }
  };

  // Single orchestrator for "user picked a funscript path". Pre-switches to
  // the Project tab, sets the wait cursor, awaits load_project, then commits
  // the result. Pulled up here so both Library and Project tab callbacks
  // route through the same loading-state pipeline.
  //
  // `meta` is an optional override carried in from callers that have
  // richer context than the funscript path alone. Library passes
  // `{ title }` so the loaded project's title matches the Library card
  // (media stem) instead of being derived from the funscript stem —
  // matters when prefix-with-boundary matching pairs a funscript with
  // a media file whose stem has extra qualifiers (IPZZ-125 case).
  const handleOpenScript = async (path, meta = {}) => {
    if (!path) return;
    // Seed a pending placeholder *before* the async load so the Project
    // tab arrives with the new project's name already in the title block —
    // no stale-previous-project flash, no empty header. The chart area
    // checks `_pending` to render the shaded skeleton instead of the
    // (yet-unloaded) funscript. handleProjectOpened replaces the
    // placeholder with the full record when load_project resolves.
    const filename = path.split(/[\\/]/).pop() || 'project';
    const fallbackTitle = filename.replace(/\.funscript$/i, '');
    const placeholderTitle = meta.title || fallbackTitle;
    setOpenedProject({
      id: `pending:${path}`,
      path,
      title: placeholderTitle,
      duration: '—',
      _pending: true,
    });
    setIsLoadingProject(true);
    setAppError(null);
    setBusy({ message: `Loading ${filename}…` });
    // Default landing is the Project tab, but a caller mid-flow can pin a
    // different destination (e.g. adopt-then-Analysis) so the reopen doesn't
    // bounce the user through Project. The placeholder already carries `path`,
    // so editing tabs pass their gate immediately.
    setTab(meta.landTab || 'project');
    try {
      const project = await loadProject(path, meta.mediaPath || null);
      // Apply caller hints over Rust defaults. Library is the main
      // source of these — it knows the media-stem title AND the
      // prefix-with-boundary matched mediaPath, both of which the
      // Rust strict-stem `find_adjacent_media` would miss.
      const finalProject = { ...project };
      if (meta.title) finalProject.title = meta.title;
      if (meta.mediaPath && !finalProject.mediaPath) {
        finalProject.mediaPath = meta.mediaPath;
        if (meta.mediaKind) finalProject.mediaKind = meta.mediaKind;
      }
      handleProjectOpened(finalProject);
    } catch (err) {
      console.error('App: load_project failed', err);
      setAppError(err?.message ? `Failed to open script: ${err.message}` : 'Failed to open script.');
      // Clear the placeholder so the tab doesn't strand the user on a
      // skeleton of a project that didn't actually load.
      setOpenedProject(null);
    } finally {
      setIsLoadingProject(false);
      setBusy(null);
    }
  };

  // Unpack a `.forge` bundle into a re-editable project on disk and open the
  // funscript it produces. The App-level twin of ProjectTab's importBundleAndOpen
  // — used by the launch-arg handler below so the Windows "Edit in
  // FunscriptForge" verb lands on a real project no matter which tab is active.
  const importBundleAndOpen = async (path) => {
    const name = path.split(/[\\/]/).pop() || 'bundle';
    setAppError(null);
    setBusy({ message: `Importing ${name}…` });
    setTab('project');
    try {
      const res = await importForgeBundle(path);
      if (!res?.funscriptPath) {
        setAppError(`Couldn't import bundle: ${name}`);
        return;
      }
      await handleOpenScript(res.funscriptPath);
      if (!res.media) {
        const want = res.mediaExpected ? `“${res.mediaExpected}”` : 'a video';
        setAppError(`Imported ${name} — attach ${want} with “Add or replace…” to see it in the editor.`);
      }
    } catch (err) {
      console.error('App: importBundleAndOpen failed', err);
      setAppError(`Import failed: ${String(err?.message || err)}`);
    } finally {
      setBusy(null);
    }
  };

  // File-association onboarding (Windows): when FSF is launched with a path
  // argument — right-click "Edit in FunscriptForge" on a `.forge`, or "Open
  // with" on a funscript/media — drain it once on mount and route by kind.
  // One-shot (the Rust side returns the path only on the first call), and
  // ref-guarded so a StrictMode double-mount can't double-import.
  const launchHandledRef = useRef(false);
  useEffect(() => {
    if (launchHandledRef.current) return;
    launchHandledRef.current = true;
    (async () => {
      const path = await getLaunchBundle();
      if (!path) return;
      const kind = classifyProjectFile(path);
      if (kind === 'bundle') await importBundleAndOpen(path);
      else if (kind === 'media') handleOpenMedia(path);
      else handleOpenScript(path);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach a media file to the currently-open project. Used by the Project
  // tab's "Add or replace…" picker when the user picks audio/video; the
  // picker routes by extension.
  const handleAttachMedia = async (mediaPath) => {
    if (!mediaPath) return;
    const current = typeof openedProject === 'object' ? openedProject : null;
    if (!current?.path) {
      setAppError('Open a funscript before attaching media.');
      return;
    }
    setAppError(null);
    setBusy({ message: `Attaching ${mediaPath.split(/[\\/]/).pop() || 'media'}…` });
    try {
      const res = await attachMedia(current.path, mediaPath);
      const patch = (prev) => {
        if (!prev || typeof prev !== 'object') return prev;
        return { ...prev, mediaPath: res.mediaPath, mediaKind: res.mediaKind };
      };
      setOpenedProject(patch);
      setLoadedProjects((prev) =>
        prev.map((p) => (p.id === current.id ? patch(p) : p))
      );
    } catch (err) {
      console.error('App: attach_media failed', err);
      setAppError(err?.message ? `Attach failed: ${err.message}` : 'Attach failed.');
    } finally {
      setBusy(null);
    }
  };

  const toggleDevice = (id) => {
    setSelectedDevices((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const inTauri = isTauri();
  const project = typeof openedProject === 'object' ? openedProject : null;

  // Global analysis-state — same derivation AnalysisTab uses, computed here so
  // the footer surfaces a Partial/Resume strip on every downstream tab and
  // accept-and-chain gates on true completion (sidecars + clips). `analyzing`
  // = any busy op (analyze sets busy; during busy the footer already shows
  // progress, so deriveAnalysisState returns 'loading' and the strip hides).
  // chapters arrive as `chapterList` (after a tab edits them) or `chapters`
  // (fresh from loadProject) — read whichever is the array. D5/D5b.
  const chapterArr = Array.isArray(project?.chapterList)
    ? project.chapterList
    : (Array.isArray(project?.chapters) ? project.chapters : null);

  // ── Resume / open-project dialog ────────────────────────────────────
  // After a project opens, surface a ONE-TIME prompt only when there's a real
  // decision: the on-disk analysis is from an older analyzer version (offer to
  // recalculate) OR there's a saved place to resume to. Nothing to decide →
  // no dialog (we don't nag). The trigger effect is declared BEFORE the
  // session-write effect so it reads the PRIOR session before the open's own
  // landing-tab set overwrites it. Session is localStorage today; the portable
  // <stem>.forge/session.json is the immediate follow-up (lib/sessionStore).
  const [openDialog, setOpenDialog] = useState(null);
  const promptedProjectRef = useRef(null);
  useEffect(() => {
    if (!project?.id || !project?.path) { promptedProjectRef.current = null; return; }
    if (promptedProjectRef.current === project.id) return;  // prompt once per open
    promptedProjectRef.current = project.id;
    const versionStale = analyzerVersionStale(project?.analyzerVersion);
    const session = loadSession(project.path);
    const resumeTab = (session?.tab && session.tab !== 'library' && session.tab !== tab)
      ? session.tab : null;
    if (versionStale || resumeTab) {
      const t = TABS.find((x) => x.id === resumeTab);
      setOpenDialog({ title: project.title, versionStale, resumeTab, resumeTabLabel: t?.label || null });
    }
  }, [project?.id, project?.path, project?.analyzerVersion]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Write-through the active tab as this project's "where you left off." Only
  // after the open prompt has been considered for this project (promptedRef
  // set), so the trigger above always reads the prior session first.
  useEffect(() => {
    if (!project?.path || promptedProjectRef.current !== project?.id) return;
    saveSession(project.path, { tab, at: Date.now() });
  }, [tab, project?.path, project?.id]);

  // Active chapter SHARED across the chapter-scoped tabs (Chapters, Channels),
  // so switching tabs — or returning after an Accept advanced you — keeps your
  // place instead of snapping back to the first chapter (dogfood 2026-06-16:
  // "I click back to the previous tab, it takes me to the first chapter").
  // Tabs unmount on switch, so they SEED from this on mount and REPORT changes
  // back; null = "not chosen yet" → a tab defaults to its first chapter. Reset
  // per project so a fresh open starts at the top.
  const [activeChapterId, setActiveChapterId] = useState(null);
  useEffect(() => { setActiveChapterId(null); }, [project?.id]);
  // Per-chapter accept handler registered by the active chapter tab (Chapters /
  // Channels) so the ALWAYS-VISIBLE footer can host "Accept and next chapter"
  // instead of an in-body button that scrolls out of view (dogfood 2026-06-16).
  // { hasNext, run } | null; cleared by the tab's unmount, so non-chapter tabs
  // never read a stale value (and the footer also gates on the tab id).
  const [chapterNav, setChapterNav] = useState(null);
  const { analysisState: globalAnalysisState } = deriveAnalysisState({
    hasMedia: !!project?.mediaPath,
    analyzing: !!busy,
    pipelineError: false,
    chapterList: chapterArr,
    trackPeaks, trackSpectrogram, trackBeats,
    chapterClipsPresent,
    directPlay: mediaDirectPlay,
  });
  const analysisPartial = globalAnalysisState === 'partial';

  // Finish an interrupted analyze — re-run with --resume so videoflow skips
  // every stage already on disk and only builds the missing chapter clips.
  // Invoked by Accept (no separate button); the busy footer shows progress.
  // Returns true on success so the caller knows whether to chain. The
  // clip-count effect re-runs when busy clears and flips the state to
  // complete. D5b.
  const handleAnalysisResume = useCallback(async () => {
    if (!project?.path) return false;
    setBusy({ message: `Finishing analysis for ${project.title ?? 'project'}…`, steps: [] });
    try {
      await analyzeChaptersWithVideoflow(project.path, 5.5, project.mediaPath, true);
      return true;
    } catch (err) {
      setAppError(`Resume failed: ${err?.message ?? err}`);
      return false;
    } finally {
      setBusy(null);
    }
  }, [project?.path, project?.mediaPath, project?.title]);

  // Scope picker shown in the TopBar — "All chapters" + each chapter the
  // active project has. Lifted from the per-tab state because the scope
  // filter is global (cross-tab) chrome. For now it's only display; the
  // tabs don't yet read this scope. When they do, this state becomes the
  // single source of truth for "what subset of the work is in focus".

  // Workflow chain: each tab knows the next tab to advance to on "Accept
  // and chain." Tabs without an entry have no advance action (Library is
  // the entry point; Export is the terminus). Per-tab gates validate
  // before advancing — Project just needs a funscript; Device gates on
  // ≥1 selected target (moved here from Project 2026-05-17 along with
  // the device picker itself).
  const TAB_CHAIN = {
    project:  'generate',
    generate: 'analysis',
    analysis: 'chapters',
    chapters: 'phrases',
    phrases:  'stanzas',
    stanzas:  'events',
    events:   'stim',
    stim:     'polish',
    polish:   'export',
    export:   'viewer',
  };
  // Tabs that CONSUME the analysis sidecars (chapters/phrases/channels/etc).
  // Analysis itself is deliberately excluded — it's where the work happens.
  // NB: 'viewer' is deliberately NOT here — it reviews the EXPORTED output
  // (<stem>.output / .forge), which is independent of the analysis sidecars, so
  // it stays reachable for a completed/media-only project. Its own empty state
  // handles "no output yet".
  const ANALYSIS_CONSUMER_TABS = ['chapters', 'phrases', 'stanzas', 'events', 'stim', 'polish', 'export'];
  // "Genuinely un-analyzed" = no chapters in memory, or the on-disk analysis
  // was produced by a stale analyzer version (a re-analyze is queued). This is
  // the gate signal — deliberately independent of `busy`, so a channel-preview
  // recompute on a fully-analyzed project never reads as "Analyzing…".
  const analysisUnready =
    !chapterArr?.length || analyzerVersionStale(project?.analyzerVersion);
  const tabGate = (id) => {
    // Suppress "open a funscript" while a load is in flight — the busy
    // banner is already saying "Loading <file>…", so a parallel gate
    // saying "Open a funscript before continuing" is contradictory.
    if (isLoadingProject) return null;
    const hasFunscript = !!project?.path;
    const hasMedia = !!project?.mediaPath;
    // Project + Generate are reachable for a VIDEO-ONLY project (media, no
    // funscript yet) — Generate is the door that CREATES the funscript.
    if (id === 'project') {
      if (!hasFunscript && !hasMedia) return 'Open a funscript or a video to begin.';
      return null;
    }
    if (id === 'generate') {
      if (!hasFunscript && !hasMedia) return 'Open a funscript or a video to begin.';
      if (!hasMedia) return 'Generate needs a video or audio source. Attach media to this project first.';
      return null;
    }
    // Editing tabs need an actual funscript — a video-only project must
    // generate (or open) one before they unlock.
    if (['analysis', 'polish', 'chapters', 'phrases', 'stanzas', 'events', 'stim', 'export'].includes(id)
        && !hasFunscript) {
      return 'Generate or open a funscript before continuing.';
    }
    // Analysis is REQUIRED before any consuming tab is meaningful — chapters,
    // phrases, channels, events, polish + export all read sidecars the analyze
    // pass produces. Gate those tabs ONLY when the project is genuinely
    // un-analyzed: CHAPTERS missing (chapters are the gate artifact — they
    // arrive in-memory via load_project), or the analyzer version is stale (we
    // shipped a better algorithm → a re-analyze is queued). Once chapters
    // exist the consuming tabs have what they need and seed their defaults, so
    // a transient busy op on the tab itself (e.g. the 9-channel preview calc)
    // must NOT trip this gate. Peaks/spectrogram/beats/clips load lazily and
    // are display niceties — they intentionally do NOT gate. The Analysis tab
    // is never gated here (its footer doubles as Resume when partial). Only
    // matters when there's media (a funscript-only project stays editable).
    if (ANALYSIS_CONSUMER_TABS.includes(id) && hasMedia && analysisUnready) {
      return busy
        ? 'Analyzing… finish on the Analysis tab before continuing.'
        : 'Finish analyzing on the Analysis tab before this is ready.';
    }
    return null;
  };
  const gateMsg = tabGate(tab);
  const nextTab = TAB_CHAIN[tab];

  // Footer summary describes the current tab's chain status. Gate
  // messages no longer live here — they're surfaced via the AcceptBar
  // `gate` prop (amber warning banner) so the chain-status line below
  // can keep all of its informational chrome (`writes …`, downstream
  // hint) visible at all times.
  //
  // When `busy` is set, defer to the in-progress story: the busy
  // panel above is already announcing what's happening, but its
  // sibling summary line was still declaring "ready to chain" —
  // contradictory and confusing mid-pipeline.
  const currentTabLabel = TABS.find((t) => t.id === tab)?.label ?? 'Tab';
  const isVideoOnly = !project?.path && !!project?.mediaPath;
  let footerSummary;
  if (!project?.path && !isVideoOnly) {
    footerSummary = 'Open a funscript from the Library tab to begin.';
  } else if (isVideoOnly && tab === 'project') {
    footerSummary = 'No funscript yet — generate one from this media to begin editing.';
  } else if (busy) {
    footerSummary = `${currentTabLabel} · in progress — chain can advance when complete`;
  } else if (nextTab) {
    const nextLabel = TABS.find((t) => t.id === nextTab)?.label ?? nextTab;
    footerSummary = `${currentTabLabel} · ready to chain to ${nextLabel}`;
  } else {
    footerSummary = `${currentTabLabel} · no downstream tab`;
  }
  const chainFile = project?.path && nextTab
    ? `${(project.title ?? 'project')}.${tab}.json`
    : null;

  // Per-tab footer fork. Most tabs are a single accept-and-chain; two tabs
  // offer a CHOICE the footer surfaces as primary (default, highlighted) +
  // secondary (quiet, left):
  //   • Project  — "Generate new funscript" vs "Edit this funscript" (skip
  //                generation, go straight to editing). The skip path still
  //                runs analysis (the next chain step) — much of it is already
  //                cached from a prior generate. The secondary is hidden when
  //                there's no funscript to edit (video-only → generate is the
  //                only door).
  //   • Generate — "Continue with this funscript" (adopt the draft as the
  //                working script) vs "Keep the original".
  let footerPrimaryLabel = nextTab
    ? `${analysisPartial ? 'Finish analysis & chain' : 'Accept and chain'} to ${TABS.find((t) => t.id === nextTab)?.label ?? nextTab}`
    : (tab === 'export' ? 'Write outputs' : 'Accept');
  let footerOnPrimary = null; // null → use handleAccept
  let footerSecondary = null; // { label, onClick }
  if (tab === 'project' && !gateMsg && !busy) {
    footerPrimaryLabel = 'Generate new funscript';
    footerOnPrimary = () => setTab('generate');
    if (project?.path) {
      footerSecondary = { label: 'Edit this funscript', onClick: () => setTab('analysis') };
      footerSummary = 'Generate a new funscript from the media — or skip and edit this one.';
    } else {
      footerSummary = 'Generate a funscript from the media.';
    }
  } else if (tab === 'generate' && !gateMsg && !busy) {
    footerPrimaryLabel = 'Continue with this funscript';
    footerOnPrimary = async () => {
      const hasDraft = Array.isArray(genActions) && genActions.length;
      // Adopt is awaited because a video-only project PROMOTES the draft to
      // a real sibling funscript and reopens (landing on Project) — only
      // after that resolves do we advance to Analysis, or the reopen's
      // tab-switch would clobber the navigation. A funscript project just
      // saves the working copy (no reopen) and advances the same way.
      if (hasDraft) await adoptGeneratedFunscript(genActions);
      // Don't strand a video-only project on Analysis with no funscript —
      // if there was no draft to adopt, stay put (the gate explains why).
      if (hasDraft || project?.path) setTab('analysis');
    };
    // "Keep the original" only makes sense when there IS an original to keep
    // (a funscript project regenerating). For a video-only project the draft
    // is the only funscript, so the secondary door is hidden.
    if (project?.path) {
      footerSecondary = { label: 'Keep the original', onClick: () => setTab('analysis') };
      footerSummary = 'Continue with the generated funscript, or keep the original.';
    } else {
      footerSummary = 'Continue with the generated funscript to start editing.';
    }
  } else if (tab === 'export' && !gateMsg && !busy) {
    // Export writes via its own "Export All" button; the footer's job is to
    // jump to the Viewer to review what was produced. Plain red "View".
    footerPrimaryLabel = 'View';
    footerOnPrimary = () => setTab('viewer');
    footerSummary = 'Review the exported output in the Viewer.';
  }

  // Chapter-scoped tabs host their per-chapter accept on the footer as the
  // SECONDARY (the primary stays "Accept and chain to <next tab>"). The tab
  // registers { hasNext, label, run }: not-last → "Accept and next chapter"
  // (commit + advance). Chapters/Channels also register a last-chapter "Accept
  // chapter" (commit, no advance); Phrases/Stanzas have no per-chapter commit
  // so they register null on the last chapter (the primary "chain to <next>" is
  // the action there).
  const CHAPTER_NAV_TABS = ['chapters', 'stim', 'events', 'phrases', 'stanzas'];
  if (CHAPTER_NAV_TABS.includes(tab) && chapterNav?.label && !gateMsg && !busy) {
    footerSecondary = { label: chapterNav.label, onClick: chapterNav.run };
  }
  // Completion gate — chapter-scoped tabs that REPORT `complete` (Phrases/
  // Stanzas today) keep the primary LOCKED and reading "Chain to <next>"
  // until every chapter has been considered (user: "do no chain until all
  // chapters have been considered"). Tabs that don't report `complete`
  // (Chapters/Channels/Events) leave it undefined → no gate → unchanged.
  const chapterGateActive = CHAPTER_NAV_TABS.includes(tab)
    && chapterNav && typeof chapterNav.complete === 'boolean';
  const chapterIncomplete = chapterGateActive && !chapterNav.complete;
  if (chapterIncomplete && !gateMsg && !busy) {
    // Not every chapter considered yet → the RED primary IS the next action
    // (accept THIS chapter / walk), never a chain (user: "no chain until all
    // chapters considered" + "make the next action easy, not the skip").
    // Chaining only appears once complete. The tab's own "Accept all as-is"
    // button is the one-click alternative to walking each chapter.
    const nextLabel = nextTab ? (TABS.find((t) => t.id === nextTab)?.label ?? nextTab) : '';
    footerPrimaryLabel = chapterNav.label;   // "Accept and next chapter" / last
    footerOnPrimary = chapterNav.run;        // accept this chapter + advance
    footerSecondary = null;                  // primary already hosts the walk
    footerSummary = `${chapterNav.considered ?? 0} of ${chapterNav.total ?? 0} chapters considered · accept each (or “Accept all as-is”) to unlock chaining${nextLabel ? ` to ${nextLabel}` : ''}`;
  }

  const handleAccept = async () => {
    if (gateMsg) {
      // Gate blocks; nothing to advance. The summary already shows why.
      return;
    }
    // Completion gate — a chapter-scoped tab that hasn't considered every
    // chapter can't chain yet (belt-and-suspenders; the button is also
    // disabled via `ready`).
    if (chapterIncomplete) return;
    if (!nextTab) return;
    // If analysis was interrupted during chapter_clips (sidecars on disk,
    // clips short), Accept finishes it first — no separate Resume button
    // (user, 2026-06-11: "why do I need a button?"). The busy footer shows
    // the resume progress; only chain once it succeeds. D5b.
    if (analysisPartial && project?.path) {
      const ok = await handleAnalysisResume();
      if (!ok) return; // resume failed — error shown, stay put
    }
    // Commit the active chapter-scoped tab's pending work before leaving, so
    // the primary "Accept and chain" actually ACCEPTS (user: "Accept and next
    // chapter SHOULD accept the tones!"). Only the Chapters tab registers a
    // `commit` (apply + persist ALL selected tones); other tabs auto-save.
    if (chapterNav?.commit) {
      try { await chapterNav.commit(); }
      catch (e) { console.warn('accept-and-chain commit failed', e); }
    }
    // TODO: write chain file with the active tab's working state.
    console.log(`accept-and-chain: ${tab} → ${nextTab}`);
    setTab(nextTab);
  };
  // Revert to original — global, destructive: delete the accumulated
  // working funscript so the effective path falls back to the pristine
  // original, then reload the project to re-seed actions from it. Distinct
  // from the (stubbed, per-tab) footer Reset: this throws away ALL edits
  // across every tab and is the only thing that clears persisted Apply/
  // Tone edits today. The original .funscript on disk is never touched —
  // we only remove the side-car work copy. See
  // project_working_funscript_persistence.
  const handleRevertToOriginal = async () => {
    const current = typeof openedProject === 'object' ? openedProject : null;
    if (!current?.path) return;
    setBusy({ message: 'Reverting to original…' });
    try {
      await revertWorkingFunscript(current.path);
      // Reload from the now-pristine effective path (work copy gone), which
      // re-seeds project.actions from the original and resets hasWorkingEdits.
      await handleOpenScript(current.path, {
        title: current.title,
        mediaPath: current.mediaPath,
        mediaKind: current.mediaKind,
      });
    } catch (err) {
      setAppError(`Could not revert: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ff-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar
        logo={(
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 14, letterSpacing: '-0.01em' }}>FunscriptForge</strong>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>v{APP_VERSION}</span>
          </div>
        )}
        file={project ? {
          title: project.title,
          durationMs: project.durationMs,
          actionCount: project.actionCount,
        } : null}
        badge={(
          <Pill tone="neutral" dot>
            {inTauri ? 'Tauri' : 'browser'}
          </Pill>
        )}
        rightActions={(
          <>
            <Button kind="ghost" size="sm" icon="folder-open"
                    onClick={handlePickAndOpen}>
              Open
            </Button>
            <Button kind="primary" size="sm" icon="download"
                    onClick={() => { setTab('export'); }}>
              Export
            </Button>
            <Button kind="ghost" size="icon" icon="help-circle"
                    title="About FunscriptForge"
                    onClick={() => setAboutOpen(true)} />
          </>
        )}
      />

      <nav className="ff-tabstrip">
        {TABS.map((t, i) => {
          // Utility tabs (Catalog, future Plugins / Settings) sit past
          // a visual separator so they read as "reference" rather than
          // "next pipeline step." Insert the divider before the first
          // utility tab encountered.
          const prev = TABS[i - 1];
          const showSeparator = t.utility && (!prev || !prev.utility);
          return (
            <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {showSeparator && (
                <span style={{
                  width: 1, height: 22, background: 'var(--border)',
                  margin: '0 10px', flexShrink: 0,
                }} />
              )}
              <button
                onClick={() => setTab(t.id)}
                className={`ff-tabbutton ${t.id === tab ? 'active' : ''}`}
              >
                {t.label}
              </button>
            </span>
          );
        })}
      </nav>

      <main className="ff-main">
        {tab === 'library' && <LibraryScreen onOpen={handleOpenScript} onOpenMedia={handleOpenMedia} onAppError={setAppError} />}
        {tab === 'project' && (
          <ProjectTab
            openedProject={openedProject}
            loadedProjects={loadedProjects}
            onOpenScript={handleOpenScript}
            onOpenMedia={handleOpenMedia}
            onSelectProject={handleSelectProject}
            onPickAndOpen={handlePickAndOpen}
            onLoadSample={handleLoadSample}
            onGoToLibrary={() => setTab('library')}
            onAttachMedia={handleAttachMedia}
            onGenerate={() => setTab('generate')}
            onAppError={setAppError}
            onRevertToOriginal={handleRevertToOriginal}
            isLoadingProject={isLoadingProject}
          />
        )}
        {tab === 'generate' && (
          <GenerateTab
            project={typeof openedProject === 'object' ? openedProject : null}
            onActionsPatch={adoptGeneratedFunscript}
            persisted={genCurves}
            onPersist={setGenCurves}
            onGenerated={setGenActions}
            persistedResult={genResult}
            onResult={setGenResult}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            onBusy={setBusy}
          />
        )}
        {tab === 'analysis' && (
          <AnalysisTab
            project={typeof openedProject === 'object' ? openedProject : null}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            onChaptersChange={handleChaptersChange}
            refreshAudioSidecars={refreshAudioSidecars}
            setBusy={setBusy}
            setAppError={setAppError}
          />
        )}
        {tab === 'polish' && (
          <PolishTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setAppError={setAppError}
            setBusy={setBusy}
          />
        )}
        {tab === 'viewer' && (
          <ViewerTab
            project={typeof openedProject === 'object' ? openedProject : null}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
          />
        )}
        {tab === 'chapters' && (
          <ChaptersTab
            project={typeof openedProject === 'object' ? openedProject : null}
            onAttachMedia={async () => {
              // Start the picker in the project's own folder — the
              // user is almost always looking for media that lives
              // next to the funscript.
              const projectDir = project?.path
                ? project.path.slice(0, Math.max(project.path.lastIndexOf('\\'), project.path.lastIndexOf('/')))
                : undefined;
              const p = await pickMediaFile(projectDir || undefined);
              if (p) await handleAttachMedia(p);
            }}
            onChaptersChange={handleChaptersChange}
            onActionsPatch={handleActionsPatch}
            setBusy={setBusy}
            setAppError={setAppError}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            refreshAudioSidecars={refreshAudioSidecars}
            // Bundled phrase analysis — ChaptersTab runs analyzePhrases
            // alongside auto-chapter so downstream tabs (Phrases /
            // Patterns / future Stanzas) find the sidecar already in
            // cache when the user navigates over (user direction
            // 2026-05-23: "it's actually pretty fast, should be in the
            // analysis page").
            setPhrasesByPath={setPhrasesByPath}
            initialChapterId={activeChapterId}
            onActiveChapterChange={setActiveChapterId}
            onRegisterChapterNav={setChapterNav}
            chapterEdits={project?.path ? chapterEditsByPath[project.path] : null}
            onChapterEditsChange={(edits) => {
              if (project?.path) setChapterEditsByPath((prev) => ({ ...prev, [project.path]: edits }));
            }}
          />
        )}
        {tab === 'phrases' && (
          <PhrasesTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setBusy={setBusy}
            setAppError={setAppError}
            phrasesByPath={phrasesByPath}
            setPhrasesByPath={setPhrasesByPath}
            onActionsPatch={handleActionsPatch}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            onRegisterChapterNav={setChapterNav}
          />
        )}
        {tab === 'stanzas' && (
          <StanzasTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setBusy={setBusy}
            setAppError={setAppError}
            stanzasByPath={stanzasByPath}
            setStanzasByPath={setStanzasByPath}
            onActionsPatch={handleActionsPatch}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            onRegisterChapterNav={setChapterNav}
          />
        )}
        {tab === 'events' && (
          <EventsTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            initialChapterId={activeChapterId}
            onActiveChapterChange={setActiveChapterId}
            onRegisterChapterNav={setChapterNav}
          />
        )}
        {tab === 'stim' && (
          <CharactersTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
            charactersByPath={charactersByPath}
            setCharactersByPath={setCharactersByPath}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
            onBusy={setBusy}
            initialChapterId={activeChapterId}
            onActiveChapterChange={setActiveChapterId}
            onRegisterChapterNav={setChapterNav}
          />
        )}
        {tab === 'export' && (
          <ExportTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            setBusy={setBusy}
            setAppError={setAppError}
          />
        )}
        {tab === 'catalog' && <CatalogTab />}
        {tab !== 'library' && tab !== 'project' && tab !== 'generate' && tab !== 'analysis' && tab !== 'polish' && tab !== 'viewer' && tab !== 'chapters' && tab !== 'phrases' && tab !== 'stanzas' && tab !== 'events' && tab !== 'stim' && tab !== 'export' && tab !== 'catalog' && (
          <section className="ff-placeholder">
            <h2>{TABS.find((t) => t.id === tab).label}</h2>
            <p>Screen not ported yet.</p>
            {openedProject && (
              <p className="ff-meta">
                Opened: <code>{typeof openedProject === 'string' ? openedProject : openedProject?.title}</code>
              </p>
            )}
            {selectedDevices.length > 0 && (
              <p className="ff-meta">
                Devices: <code>{selectedDevices.join(', ')}</code>
              </p>
            )}
            <p className="ff-meta">
              Bridge ping: {pong === null ? '…' : <code>{JSON.stringify(pong)}</code>}
            </p>
          </section>
        )}
      </main>

      {/* Footer chrome — global Accept and chain + status row. The
          AcceptBar is the canonical commit action for whichever tab is
          active; downstream tabs read the chain file the active tab
          writes. Handlers stubbed until each tab wires its
          working-state + accept semantics.
          Hidden on entry/utility tabs (Library, Catalog) — those don't
          participate in the chain. Export is the terminus, so its
          primary action reads "Accept" rather than "Accept and chain."
       */}
      {tab !== 'library' && tab !== 'catalog' && (
        <AcceptBar
          summary={footerSummary}
          chainFile={chainFile}
          accepted={false}
          primaryLabel={footerPrimaryLabel}
          onAccept={footerOnPrimary || handleAccept}
          secondaryLabel={footerSecondary?.label}
          onSecondary={footerSecondary?.onClick}
          error={appError}
          onClearError={() => setAppError(null)}
          busy={busy}
          gate={gateMsg}
          ready={!gateMsg && !appError && !busy && (Boolean(nextTab) || tab === 'export')}
          // Export owns its own write button in-tab; the footer's generic
          // accept is a no-op there (no downstream tab), so hide the dead
          // Reset/Write buttons but keep the bar for the progress banner.
          hideActions={tab === 'export'}
        />
      )}
      <StatusBar
        synced
        scope="all chapters"
        chainFile={chainFile ?? undefined}
        version={APP_VERSION}
      />
      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        inTauri={inTauri}
      />
      <OpenProjectDialog
        open={!!openDialog}
        title={openDialog?.title}
        versionStale={!!openDialog?.versionStale}
        resumeTab={openDialog?.resumeTab}
        resumeTabLabel={openDialog?.resumeTabLabel}
        onResume={(t) => { if (t) setTab(t); setOpenDialog(null); }}
        onRecalculate={() => { setTab('analysis'); setOpenDialog(null); }}
        onDismiss={() => setOpenDialog(null)}
      />
    </div>
  );
}
