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
  TopBar, ScopePicker, AcceptBar, StatusBar,
  Button, Pill,
} from 'forgemoment';
import {
  isTauri, ping, loadProject, attachMedia, pickMediaFile,
  loadAudioPeaks, loadAudioSpectrogram, loadAudioBeats,
} from './api/forge.js';
import LibraryScreen from './screens/LibraryScreen.jsx';
import ProjectTab from './screens/ProjectTab.jsx';
import DeviceTab from './screens/DeviceTab.jsx';
import ChaptersTab from './screens/ChaptersTab.jsx';
import PatternsTab from './screens/PatternsTab.jsx';
import PhrasesTab from './screens/PhrasesTab.jsx';
import StanzasTab from './screens/StanzasTab.jsx';
import EventsTab from './screens/EventsTab.jsx';
import CharactersTab from './screens/CharactersTab.jsx';
import ExportTab from './screens/ExportTab.jsx';
import CatalogTab from './screens/CatalogTab.jsx';
import AboutDialog from './components/AboutDialog.jsx';

const TABS = [
  { id: 'library',   label: 'Library' },
  { id: 'project',   label: 'Project' },
  { id: 'device',    label: 'Device' },
  { id: 'chapters',  label: 'Chapters' },
  // 'patterns' (2026-05-16) sits between Chapters and Phrases. Pattern
  // recognition is FF-local for now (no second consumer yet; move to
  // videoflow when forgegen/forgeplayer need it). Detection is stubbed
  // until `cli.py classify-patterns` lands.
  { id: 'patterns',  label: 'Patterns' },
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
  // 'stim' (label: 'Characters', 2026-05-18) — first tab that *generates*
  // multiple output funscripts (one per e-stim channel, 9 today). Label
  // catches up to the design's internal vocabulary (character cards).
  // Tab id stays 'stim' so TAB_CHAIN / chain filenames / tabGate keep
  // working without churn. See memory `project_characters_tab.md`.
  { id: 'stim',      label: 'Characters' },
  { id: 'export',    label: 'Export' },
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
  // Every project that's been loaded via pickFunscriptFile in this session.
  // Held here (not in ProjectTab) so the list survives tab unmounts —
  // otherwise switching Library → Project drops the prior loaded project.
  const [loadedProjects, setLoadedProjects] = useState([]);
  // True while load_project is in flight. Drives the wait-cursor on the
  // whole UI plus the spinner overlay on the Project tab.
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
          // In-stage message: bubble to the headline + attach as the
          // running step's detail line. Don't touch step status.
          if (kind === 'msg' && message) {
            return { ...prev, message };
          }
          // Sub-stage start/done events: only update message, don't
          // disturb the depth-2 step list.
          if (depth >= 3) {
            return kind === 'start' ? { ...prev, message: leaf } : prev;
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
            return { ...prev, steps };
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
  // — no reload, no loading flash. Otherwise (mock fixture or recent we've
  // never opened) we route through handleOpenScript for the full load
  // pipeline. Earlier bug: ProjectTab maintained its own `activeProjectId`
  // state and the picker only updated that — App's openedProject (and
  // therefore the TopBar header) stayed pinned to whichever project was
  // open before the switch.
  const handleSelectProject = (project) => {
    if (!project) return;
    const cached =
      project.id && loadedProjects.find((p) => p.id === project.id);
    if (cached) {
      setOpenedProject(cached);
      return;
    }
    if (project.path) {
      handleOpenScript(project.path);
    }
    // Mock recents with no path: nothing to load. Silently no-op.
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
    setOpenedProject((prev) => {
      if (!prev || typeof prev !== 'object') return prev;
      return { ...prev, actions: nextActions };
    });
  };

  // Single orchestrator for "user picked a funscript path". Pre-switches to
  // the Project tab, sets the wait cursor, awaits load_project, then commits
  // the result. Pulled up here so both Library and Project tab callbacks
  // route through the same loading-state pipeline.
  const handleOpenScript = async (path) => {
    if (!path) return;
    // Seed a pending placeholder *before* the async load so the Project
    // tab arrives with the new project's name already in the title block —
    // no stale-previous-project flash, no empty header. The chart area
    // checks `_pending` to render the shaded skeleton instead of the
    // (yet-unloaded) funscript. handleProjectOpened replaces the
    // placeholder with the full record when load_project resolves.
    const filename = path.split(/[\\/]/).pop() || 'project';
    const placeholderTitle = filename.replace(/\.funscript$/i, '');
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
    setTab('project');
    try {
      const project = await loadProject(path);
      handleProjectOpened(project);
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

  // Attach a media file to the currently-open project. Used by the Project
  // tab's "Add or replace…" picker when the user picks audio/video; the
  // picker routes by extension. Updates BOTH openedProject and the
  // matching entry in loadedProjects — ProjectTab reads the displayed
  // project from the loadedProjects/recents merge, so missing the second
  // update lets the UI keep showing the stale (no-media) shape.
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

  // Scope picker shown in the TopBar — "All chapters" + each chapter the
  // active project has. Lifted from the per-tab state because the scope
  // filter is global (cross-tab) chrome. For now it's only display; the
  // tabs don't yet read this scope. When they do, this state becomes the
  // single source of truth for "what subset of the work is in focus".
  const [scopeId, setScopeId] = useState('all');
  const scopes = [
    { id: 'all', title: 'All chapters' },
    ...(project?.chapterList ?? []).map((c, i) => ({
      id: c.id,
      title: c.name || `Chapter ${i + 1}`,
      color: c.color,
      start: c.atMs,
      end: c.endMs,
    })),
  ];

  // Workflow chain: each tab knows the next tab to advance to on "Accept
  // and chain." Tabs without an entry have no advance action (Library is
  // the entry point; Export is the terminus). Per-tab gates validate
  // before advancing — Project just needs a funscript; Device gates on
  // ≥1 selected target (moved here from Project 2026-05-17 along with
  // the device picker itself).
  const TAB_CHAIN = {
    project:  'device',
    device:   'chapters',
    chapters: 'patterns',
    patterns: 'phrases',
    phrases:  'stanzas',
    stanzas:  'events',
    events:   'stim',
    stim:     'export',
  };
  const tabGate = (id) => {
    // Suppress "open a funscript" while a load is in flight — the busy
    // banner is already saying "Loading <file>…", so a parallel gate
    // saying "Open a funscript before continuing" is contradictory.
    if (id === 'project') {
      if (!project?.path && !isLoadingProject) return 'Open a funscript before continuing.';
    }
    if (['device', 'chapters', 'patterns', 'phrases', 'stanzas', 'events', 'stim', 'export'].includes(id)
        && !project?.path && !isLoadingProject) {
      return 'Open a funscript before continuing.';
    }
    if (id === 'device' && project?.path && selectedDevices.length === 0) {
      return 'Pick at least one target device to continue.';
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
  let footerSummary;
  if (!project?.path) {
    footerSummary = 'Open a funscript from the Library tab to begin.';
  } else if (nextTab) {
    const nextLabel = TABS.find((t) => t.id === nextTab)?.label ?? nextTab;
    footerSummary = `${TABS.find((t) => t.id === tab)?.label ?? 'Tab'} · ready to chain to ${nextLabel}`;
  } else {
    footerSummary = `${TABS.find((t) => t.id === tab)?.label ?? 'Tab'} · no downstream tab`;
  }
  const chainFile = project?.path && nextTab
    ? `${(project.title ?? 'project')}.${tab}.json`
    : null;

  const handleAccept = () => {
    if (gateMsg) {
      // Gate blocks; nothing to advance. The summary already shows why.
      // Could escalate to a toast if visibility becomes an issue.
      return;
    }
    if (!nextTab) return;
    // TODO: write chain file with the active tab's working state.
    // For now we just advance; each tab's state persists in its own
    // state (no chain file produced yet — accept-and-chain workingActions
    // is the next big wiring task).
    console.log(`accept-and-chain: ${tab} → ${nextTab}`);
    setTab(nextTab);
  };
  const handleReset = () => {
    // Reset semantics are still undecided — see project_funscriptforge_pending
    // → "AcceptBar reset behavior." Candidates: (a) restore working state
    // from last-accepted chain file; (b) clear per-tab edits since last
    // Accept; (c) two-level: reset this tab vs reset chain-from-here-down.
    // For now this is a no-op log so the button doesn't pretend to work.
    // eslint-disable-next-line no-console
    console.log(`reset working state for ${tab}`);
  };

  return (
    <div className="ff-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar
        logo={(
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 14, letterSpacing: '-0.01em' }}>FunscriptForge</strong>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>scaffold v0.0.1</span>
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
        scope={project ? (
          <ScopePicker
            scopes={scopes}
            value={scopeId}
            onChange={setScopeId}
            label="Filter"
          />
        ) : null}
        rightActions={(
          <>
            <Button kind="ghost" size="sm" icon="folder-open"
                    onClick={() => setTab('library')}>
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
        {tab === 'library' && <LibraryScreen onOpen={handleOpenScript} />}
        {tab === 'project' && (
          <ProjectTab
            openedProject={openedProject}
            loadedProjects={loadedProjects}
            onOpenScript={handleOpenScript}
            onSelectProject={handleSelectProject}
            onAttachMedia={handleAttachMedia}
            onAppError={setAppError}
            isLoadingProject={isLoadingProject}
          />
        )}
        {tab === 'device' && (
          <DeviceTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
            onToggleDevice={toggleDevice}
          />
        )}
        {tab === 'chapters' && (
          <ChaptersTab
            project={typeof openedProject === 'object' ? openedProject : null}
            onAttachMedia={async () => {
              const p = await pickMediaFile();
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
          />
        )}
        {tab === 'patterns' && (
          <PatternsTab
            project={typeof openedProject === 'object' ? openedProject : null}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
          />
        )}
        {tab === 'phrases' && (
          <PhrasesTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setBusy={setBusy}
            setAppError={setAppError}
            phrasesByPath={phrasesByPath}
            setPhrasesByPath={setPhrasesByPath}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
          />
        )}
        {tab === 'stanzas' && (
          <StanzasTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setBusy={setBusy}
            setAppError={setAppError}
            stanzasByPath={stanzasByPath}
            setStanzasByPath={setStanzasByPath}
            trackPeaks={trackPeaks}
            trackSpectrogram={trackSpectrogram}
            trackBeats={trackBeats}
          />
        )}
        {tab === 'events' && (
          <EventsTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
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
          />
        )}
        {tab === 'export' && (
          <ExportTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
          />
        )}
        {tab === 'catalog' && <CatalogTab />}
        {tab !== 'library' && tab !== 'project' && tab !== 'device' && tab !== 'chapters' && tab !== 'patterns' && tab !== 'phrases' && tab !== 'stanzas' && tab !== 'events' && tab !== 'stim' && tab !== 'export' && tab !== 'catalog' && (
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
          primaryLabel={nextTab
            ? `Accept and chain to ${TABS.find((t) => t.id === nextTab)?.label ?? nextTab}`
            : (tab === 'export' ? 'Write outputs' : 'Accept')}
          onAccept={handleAccept}
          onReset={handleReset}
          error={appError}
          onClearError={() => setAppError(null)}
          busy={busy}
          gate={gateMsg}
          ready={!gateMsg && !appError && !busy && (Boolean(nextTab) || tab === 'export')}
        />
      )}
      <StatusBar
        synced
        scope={scopeId === 'all' ? 'all chapters' : (scopes.find((s) => s.id === scopeId)?.title ?? scopeId)}
        chainFile={chainFile ?? undefined}
        version="alpha 0.0.1"
      />
      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        inTauri={inTauri}
      />
    </div>
  );
}
