// FunscriptForge prototype — app root. Free-roam navigation (no gate),
// sample preloaded, lifted Generate state, play loop, accept-chain footer.
// Loaded as text/babel.

const { useState: useStateM, useEffect: useEffectM, useMemo: useMemoM, useRef: useRefM, useCallback: useCbM } = React;

const APP_VERSION = '0.1.0-alpha';

const TABS = [
  { id: 'library',  label: 'Library' },
  { id: 'project',  label: 'Project', needsProject: true },
  { id: 'generate', label: 'Generate', needsProject: true, isNew: true },
  { id: 'analysis', label: 'Analysis', needsProject: true },
  { id: 'chapters', label: 'Chapters', needsProject: true },
  { id: 'phrases',  label: 'Phrases', needsProject: true },
  { id: 'stanzas',  label: 'Stanzas', needsProject: true },
  { id: 'events',   label: 'Events', needsProject: true },
  { id: 'channels', label: 'Channels', needsProject: true },
  { id: 'polish',   label: 'Polish', needsProject: true },
  { id: 'export',   label: 'Export', needsProject: true },
  { id: 'catalog',  label: 'Catalog', utility: true },
];
const TAB_CHAIN = {
  project: 'generate', generate: 'analysis', analysis: 'chapters', chapters: 'phrases',
  phrases: 'stanzas', stanzas: 'events', events: 'channels', channels: 'polish', polish: 'export',
};
const PHRASE_VOCAB = ['Approach', 'Build', 'Crest', 'Ebb', 'Surge', 'Hold', 'Release'];
const STANZA_VOCAB = ['tease', 'steady', 'edging', 'rise', 'plateau', 'peak', 'comedown'];

// scale the sample's section fractions onto an arbitrary duration
function projectFromEntry(entry) {
  const D = entry.durationMs;
  if (!entry.hasFunscript) {
    return { ...entry, durationMs: D, actions: [], actionCount: 0, sections: seedSections(D), hasFunscript: false };
  }
  if (entry.id === 'bbb') {
    return { ...window.FF.SAMPLE_PROJECT, sections: window.normalizeSections(window.FF.SAMPLE_PROJECT.sections) };
  }
  const sections = seedSections(D);
  return { ...entry, durationMs: D, sections, hasFunscript: true, color: entry.color, mediaKind: entry.mediaKind };
}
function seedSections(D) {
  const frac = [[0, .1, 'build', 'scene_builder', 'Open'], [.1, .3, 'sustain', 'gentle', 'Settle'],
    [.3, .52, 'build', 'balanced', 'Rise'], [.52, .7, 'swell', 'reactive', 'Swell'],
    [.7, .88, 'build', 'reactive', 'Climb'], [.88, .95, 'sustain', 'reactive', 'Peak'],
    [.95, 1, 'release', 'scene_closer', 'Afterglow']];
  return window.normalizeSections(frac.map((f, i) =>
    window.FF.mkSection('s' + i, Math.round(f[0] * D), Math.round(f[1] * D), f[2], f[3], f[4])));
}

function App() {
  const [tab, setTab] = useStateM('project');
  const [project, setProject] = useStateM(() => projectFromEntry(window.FF.LIBRARY[0]));
  const [sections, setSections] = useStateM(() => project.sections);
  const [source, setSource] = useStateM('audio');
  const [depth, setDepth] = useStateM(() => window.FF.DEFAULT_DEPTH.map((p) => ({ ...p })));
  const [density, setDensity] = useStateM(() => window.FF.DEFAULT_DENSITY.map((p) => ({ ...p })));
  const [shaker, setShaker] = useStateM(false);
  const [playing, setPlaying] = useStateM(false);
  const [playheadMs, setPlayheadMs] = useStateM(() => {
    try { return parseFloat(localStorage.getItem('ff_playhead')) || 0; } catch (e) { return 0; }
  });
  const [navMode, setNavMode] = useStateM(() => {
    try { return localStorage.getItem('ff_navmode') || 'freeroam'; } catch (e) { return 'freeroam'; }
  });
  const [settingsOpen, setSettingsOpen] = useStateM(false);
  const [aboutOpen, setAboutOpen] = useStateM(false);

  const duration = project.durationMs;
  const liveActions = useMemoM(
    () => window.buildFromLanes(depth, density, duration),
    [depth, density, duration]);

  // persist
  useEffectM(() => { try { localStorage.setItem('ff_playhead', String(playheadMs)); } catch (e) {} }, [playheadMs]);
  useEffectM(() => { try { localStorage.setItem('ff_navmode', navMode); } catch (e) {} }, [navMode]);

  // play loop
  const rafRef = useRefM(null);
  useEffectM(() => {
    if (!playing) return undefined;
    let last = performance.now();
    const tick = (now) => {
      const dt = now - last; last = now;
      setPlayheadMs((p) => { const n = (p || 0) + dt; return n >= duration ? 0 : n; });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration]);

  const openEntry = (entry) => {
    const p = projectFromEntry(entry);
    setProject(p); setSections(p.sections); setPlayheadMs(0); setPlaying(false);
    setDepth(window.FF.DEFAULT_DEPTH.map((q) => ({ ...q })));
    setDensity(window.FF.DEFAULT_DENSITY.map((q) => ({ ...q })));
    setShaker(false);
    setTab('project');
  };
  const loadSample = () => openEntry(window.FF.LIBRARY[0]);

  // project as seen by views (inject live actions when it has a script)
  const projForView = useMemoM(() => (project.hasFunscript
    ? { ...project, actions: liveActions, actionCount: liveActions.length }
    : { ...project, actions: [], actionCount: 0 }), [project, liveActions]);

  const nextTab = TAB_CHAIN[tab];
  const nextLabel = nextTab ? TABS.find((t) => t.id === nextTab)?.label : null;
  const onAccept = () => { if (nextTab) setTab(nextTab); };
  const tabLabel = TABS.find((t) => t.id === tab)?.label || '';
  const summary = tab === 'export'
    ? 'Everything chained — ready to write the .forge pack.'
    : `${tabLabel} · ready to chain to ${nextLabel || '—'}`;
  const chainFile = nextTab ? `${project.title}.${tab}.json` : null;

  const sharedTabProps = { project: projForView, sections, actions: liveActions };

  return (
    <div className="ff-app">
      <TopBar project={projForView} version={APP_VERSION}
        onOpen={() => setTab('library')} onExport={() => setTab('export')}
        onHelp={() => setAboutOpen(true)} onSettings={() => setSettingsOpen((s) => !s)} navMode={navMode} />
      <TabStrip tabs={TABS} active={tab} onSelect={setTab} hasProject={!!project} navMode={navMode} />

      <main className="ff-main">
        {tab === 'library' && <LibraryScreen onOpen={openEntry} />}
        {tab === 'project' && <ProjectTab project={projForView} onGenerate={() => setTab('generate')}
          onGoLibrary={() => setTab('library')} onLoadSample={loadSample} />}
        {tab === 'generate' && <GenerateTab sections={sections} onSections={setSections}
          depth={depth} setDepth={setDepth} density={density} setDensity={setDensity}
          playheadMs={playheadMs} setPlayheadMs={setPlayheadMs} playing={playing} setPlaying={setPlaying}
          duration={duration} source={source} setSource={setSource}
          shaker={shaker} setShaker={setShaker} />}
        {tab === 'analysis' && <AnalysisTab {...sharedTabProps} />}
        {tab === 'chapters' && <ChaptersTab {...sharedTabProps} />}
        {tab === 'phrases' && <LensTab {...sharedTabProps} unit="Phrases" eyebrow="Phrases · lens" vocab={PHRASE_VOCAB} />}
        {tab === 'stanzas' && <LensTab {...sharedTabProps} unit="Stanzas" eyebrow="Stanzas · audio-derived lens" vocab={STANZA_VOCAB} />}
        {tab === 'events' && <EventsTab {...sharedTabProps} />}
        {tab === 'channels' && <ChannelsTab {...sharedTabProps} />}
        {tab === 'polish' && <PolishTab project={projForView} />}
        {tab === 'export' && <ExportTab project={projForView} sections={sections} />}
        {tab === 'catalog' && <CatalogTab />}
      </main>

      {tab !== 'library' && tab !== 'catalog' && (
        <AcceptBar summary={summary} nextLabel={nextLabel} onAccept={onAccept}
          chainFile={chainFile} isExport={tab === 'export'} />
      )}
      <StatusBar scope="all sections" chainFile={chainFile} version={APP_VERSION} />

      {settingsOpen && <SettingsPanel navMode={navMode} setNavMode={setNavMode} onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} version={APP_VERSION} />}
    </div>
  );
}

function SettingsPanel({ navMode, setNavMode, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'fixed', top: 56, right: 14, width: 340, zIndex: 50,
        background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-4)',
        boxShadow: 'var(--elev-3)', padding: 16 }} className="fade-in">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Tweaks</span>
          <Button kind="ghost" size="iconsm" icon="x" onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>
        <div className="eyebrow" style={{ marginBottom: 8, fontSize: 10 }}>Navigation</div>
        <Segmented size="sm" value={navMode} onChange={setNavMode}
          options={[{ value: 'freeroam', label: 'Free roam' }, { value: 'softgate', label: 'Soft gate' }]} />
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 10, marginBottom: 0 }}>
          {navMode === 'freeroam'
            ? 'Every tab is always clickable — nothing blocks you from page to page, even with no project open.'
            : 'Tabs that need a project show a subtle lock hint when none is open — but they stay clickable. Never a hard block.'}
        </p>
      </div>
    </>
  );
}

function AboutDialog({ onClose, version }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.65)',
      display: 'grid', placeItems: 'center' }} className="fade-in">
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', background: 'var(--surface)',
        border: '1px solid var(--border-strong)', borderRadius: 'var(--r-5)', boxShadow: 'var(--elev-3)', padding: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--accent)',
            display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="flame" size={18} /></span>
          <strong style={{ fontSize: 17 }}>FunscriptForge</strong>
          <Pill tone="neutral">v{version}</Pill>
          <Button kind="ghost" size="iconsm" icon="x" onClick={onClose} style={{ marginLeft: 'auto' }} />
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          Structure-aware funscript post-processor by Liquid Releasing. This is a clickable
          UI prototype — a fresh, fully-navigable shell of the React/Tauri app with the new
          <b style={{ color: 'var(--accent-warm)' }}> Generate</b> tab. Runs entirely in your browser; no data leaves this page.
        </p>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)' }}>
          Pipeline: Library → Project → Generate → Analysis → Chapters → Phrases → Stanzas → Events → Channels → Polish → Export
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
