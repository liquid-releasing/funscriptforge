// FunscriptForge — top-level app shell.
//
// Tabs and screen content are ported incrementally from
// ../../../ui_design/ui_kits/funscriptforge-app/. The current state shows:
//   - Library screen (ported, using forgemoment primitives)
//   - Other tabs: placeholder
//   - Env badge: Tauri vs browser
//   - Bridge ping: confirms the platform adapter is wired

import { useEffect, useState } from 'react';
import {
  TopBar, ScopePicker, AcceptBar, StatusBar,
  Button, Pill,
} from 'forgemoment';
import { isTauri, ping, loadProject, attachMedia, pickMediaFile } from './api/forge.js';
import LibraryScreen from './screens/LibraryScreen.jsx';
import ProjectTab from './screens/ProjectTab.jsx';
import DeviceTab from './screens/DeviceTab.jsx';
import ChaptersTab from './screens/ChaptersTab.jsx';
import PatternsTab from './screens/PatternsTab.jsx';
import PhrasesTab from './screens/PhrasesTab.jsx';

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
  { id: 'stim',      label: 'Stim' },
  { id: 'export',    label: 'Export' },
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
  // selectedDevices is lifted here so it survives tab switches — once the
  // user picks devices in Project, downstream tabs (Device, Stim, Multi-axis)
  // see the same selection without re-prompting.
  const [selectedDevices, setSelectedDevices] = useState([]);

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

  const handleProjectOpened = (project) => {
    setOpenedProject(project);
    if (project && typeof project === 'object' && project.id) {
      setLoadedProjects((prev) => {
        const rest = prev.filter((p) => p.id !== project.id);
        return [project, ...rest];
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

  // Single orchestrator for "user picked a funscript path". Pre-switches to
  // the Project tab, sets the wait cursor, awaits load_project, then commits
  // the result. Pulled up here so both Library and Project tab callbacks
  // route through the same loading-state pipeline.
  const handleOpenScript = async (path) => {
    if (!path) return;
    setIsLoadingProject(true);
    setAppError(null);
    setBusy({ message: `Loading ${path.split(/[\\/]/).pop() || 'project'}…` });
    setTab('project');
    try {
      const project = await loadProject(path);
      handleProjectOpened(project);
    } catch (err) {
      console.error('App: load_project failed', err);
      setAppError(err?.message ? `Failed to open script: ${err.message}` : 'Failed to open script.');
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
    phrases:  'stim',
    stim:     'export',
  };
  const tabGate = (id) => {
    // Suppress "open a funscript" while a load is in flight — the busy
    // banner is already saying "Loading <file>…", so a parallel gate
    // saying "Open a funscript before continuing" is contradictory.
    if (id === 'project') {
      if (!project?.path && !isLoadingProject) return 'Open a funscript before continuing.';
    }
    if (['device', 'chapters', 'patterns', 'phrases', 'stim'].includes(id)
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
    // TODO: each tab will register its own reset; for now log.
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
          </>
        )}
      />

      <nav className="ff-tabstrip">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`ff-tabbutton ${t.id === tab ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="ff-main">
        {tab === 'library' && <LibraryScreen onOpen={handleOpenScript} />}
        {tab === 'project' && (
          <ProjectTab
            openedProject={openedProject}
            loadedProjects={loadedProjects}
            onOpenScript={handleOpenScript}
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
            setBusy={setBusy}
            setAppError={setAppError}
          />
        )}
        {tab === 'patterns' && (
          <PatternsTab
            project={typeof openedProject === 'object' ? openedProject : null}
          />
        )}
        {tab === 'phrases' && (
          <PhrasesTab
            project={typeof openedProject === 'object' ? openedProject : null}
            setBusy={setBusy}
            setAppError={setAppError}
          />
        )}
        {tab !== 'library' && tab !== 'project' && tab !== 'device' && tab !== 'chapters' && tab !== 'patterns' && tab !== 'phrases' && (
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
          working-state + accept semantics. */}
      <AcceptBar
        summary={footerSummary}
        chainFile={chainFile}
        accepted={false}
        primaryLabel={nextTab
          ? `Accept and chain to ${TABS.find((t) => t.id === nextTab)?.label ?? nextTab}`
          : 'Accept and chain'}
        onAccept={handleAccept}
        onReset={handleReset}
        error={appError}
        onClearError={() => setAppError(null)}
        busy={busy}
        gate={gateMsg}
        ready={!gateMsg && !appError && !busy && Boolean(nextTab)}
      />
      <StatusBar
        synced
        scope={scopeId === 'all' ? 'all chapters' : (scopes.find((s) => s.id === scopeId)?.title ?? scopeId)}
        chainFile={chainFile ?? undefined}
        version="alpha 0.0.1"
      />
    </div>
  );
}
