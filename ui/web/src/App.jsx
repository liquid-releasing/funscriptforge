// FunscriptForge — top-level app shell.
//
// Tabs and screen content are ported incrementally from
// ../../../ui_design/ui_kits/funscriptforge-app/. The current state shows:
//   - Library screen (ported, using forgemoment primitives)
//   - Other tabs: placeholder
//   - Env badge: Tauri vs browser
//   - Bridge ping: confirms the platform adapter is wired

import { useEffect, useState } from 'react';
import { isTauri, ping, loadProject } from './api/forge.js';
import LibraryScreen from './screens/LibraryScreen.jsx';
import ProjectTab from './screens/ProjectTab.jsx';

const TABS = [
  { id: 'library',  label: 'Library' },
  { id: 'project',  label: 'Project' },
  { id: 'device',   label: 'Device' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'edit',     label: 'Edit' },
  { id: 'stim',     label: 'Stim' },
  { id: 'phrases',  label: 'Phrases' },
  { id: 'export',   label: 'Export' },
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

  return (
    <div className="ff-app">
      <header className="ff-topbar">
        <h1 className="ff-title">FunscriptForge</h1>
        <span className="ff-version">scaffold v0.0.1</span>
        <span
          className="ff-env"
          data-env={inTauri ? 'tauri' : 'browser'}
          title={
            inTauri
              ? 'Tauri runtime — bridge calls reach the Rust backend'
              : 'Browser mode — bridge calls return mock data'
          }
        >
          {inTauri ? 'Tauri' : 'browser'}
        </span>
      </header>

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
        {tab !== 'library' && tab !== 'project' && (
          <section className="ff-placeholder">
            <h2>{TABS.find((t) => t.id === tab).label}</h2>
            <p>Screen not ported yet.</p>
            {openedProject && (
              <p className="ff-meta">
                Opened: <code>{String(openedProject)}</code>
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
    </div>
  );
}
