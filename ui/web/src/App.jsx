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
import { isTauri, ping, loadProject } from './api/forge.js';
import LibraryScreen from './screens/LibraryScreen.jsx';
import ProjectTab from './screens/ProjectTab.jsx';
import DeviceTab from './screens/DeviceTab.jsx';
import ChaptersTab from './screens/ChaptersTab.jsx';
import TransformTab from './screens/TransformTab.jsx';

const TABS = [
  { id: 'library',   label: 'Library' },
  { id: 'project',   label: 'Project' },
  { id: 'device',    label: 'Device' },
  { id: 'chapters',  label: 'Chapters' },
  // 'transform' was 'edit' through 2026-05-16; renamed because the work
  // here is applying transforms to one or more selected phrases — the
  // verb is transform, not edit. Phrase selection happens in this tab
  // (top row = chapter scope, second row = phrase picker).
  { id: 'transform', label: 'Transform' },
  { id: 'stim',      label: 'Stim' },
  { id: 'phrases',   label: 'Phrases' },
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
  // selectedDevices is lifted here so it survives tab switches — once the
  // user picks devices in Project, downstream tabs (Device, Stim, Multi-axis)
  // see the same selection without re-prompting.
  const [selectedDevices, setSelectedDevices] = useState([]);

  useEffect(() => {
    let cancelled = false;
    ping().then((res) => { if (!cancelled) setPong(res); });
    return () => { cancelled = true; };
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

  // Single orchestrator for "user picked a funscript path". Pre-switches to
  // the Project tab, sets the wait cursor, awaits load_project, then commits
  // the result. Pulled up here so both Library and Project tab callbacks
  // route through the same loading-state pipeline.
  const handleOpenScript = async (path) => {
    if (!path) return;
    setIsLoadingProject(true);
    setTab('project');
    try {
      const project = await loadProject(path);
      handleProjectOpened(project);
    } catch (err) {
      console.error('App: load_project failed', err);
    } finally {
      setIsLoadingProject(false);
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

  // Footer state — placeholder driven from project/tab context for now.
  // Real summary + accepted state come from the per-tab working-state
  // when we wire accept-and-chain.
  const footerSummary = !project?.path
    ? 'No project loaded'
    : (tab === 'chapters'
        ? `Tones set on ${(project?.chapterList ?? []).length} chapters · pending real accept-and-chain`
        : `${TABS.find((t) => t.id === tab)?.label ?? 'Tab'} · pending accept-and-chain`);
  const chainFile = project?.path
    ? `${(project.title ?? 'project')}.${tab}.json`
    : null;

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
            isLoadingProject={isLoadingProject}
            selectedDevices={selectedDevices}
            onToggleDevice={toggleDevice}
            onContinue={() => setTab('device')}
          />
        )}
        {tab === 'device' && (
          <DeviceTab
            project={typeof openedProject === 'object' ? openedProject : null}
            selectedDevices={selectedDevices}
            onContinue={() => setTab('chapters')}
          />
        )}
        {tab === 'chapters' && (
          <ChaptersTab
            project={typeof openedProject === 'object' ? openedProject : null}
            onAttachMedia={() => console.log('TODO: pickMediaFile + attach to project')}
          />
        )}
        {tab === 'transform' && (
          <TransformTab
            project={typeof openedProject === 'object' ? openedProject : null}
          />
        )}
        {tab !== 'library' && tab !== 'project' && tab !== 'device' && tab !== 'chapters' && tab !== 'transform' && (
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
        onAccept={() => console.log(`TODO: accept-and-chain for ${tab}`)}
        onReset={() => console.log(`TODO: reset working state for ${tab}`)}
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
