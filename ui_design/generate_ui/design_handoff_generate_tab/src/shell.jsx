// FunscriptForge prototype — app chrome: TopBar, TabStrip, AcceptBar, StatusBar.
// Loaded as text/babel.

const { useState: useStateS } = React;

function TopBar({ project, version, onOpen, onExport, onHelp, onSettings, navMode }) {
  return (
    <div className="ff-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--accent)',
                       display: 'grid', placeItems: 'center', color: '#fff' }}>
          <Icon name="flame" size={14} />
        </span>
        <strong style={{ fontSize: 14, letterSpacing: '-0.01em' }}>FunscriptForge</strong>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>v{version}</span>
      </div>

      {project && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 14,
                      marginLeft: 4, borderLeft: '1px solid var(--border)' }}>
          <Icon name={project.mediaKind === 'video' ? 'film' : 'music'} size={14} style={{ color: 'var(--text-dim)' }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{project.title}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {project.duration} · {project.actionCount ? project.actionCount.toLocaleString() + ' acts' : 'no script'}
          </span>
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill tone="warn" dot>browser</Pill>
        <Button kind="ghost" size="sm" icon="folder-open" onClick={onOpen}>Open</Button>
        <Button kind="primary" size="sm" icon="download" onClick={onExport}>Export</Button>
        <Button kind="ghost" size="icon" icon="sliders-horizontal" title="Settings" onClick={onSettings} />
        <Button kind="ghost" size="icon" icon="help-circle" title="About FunscriptForge" onClick={onHelp} />
      </div>
    </div>
  );
}

function TabStrip({ tabs, active, onSelect, hasProject, navMode }) {
  return (
    <nav className="ff-tabstrip">
      {tabs.map((t, i) => {
        const prev = tabs[i - 1];
        const sep = t.utility && (!prev || !prev.utility);
        const gated = navMode === 'softgate' && t.needsProject && !hasProject;
        return (
          <React.Fragment key={t.id}>
            {sep && <span className="ff-tab-sep" />}
            <button
              className={`ff-tab ${t.id === active ? 'active' : ''} ${t.isNew ? 'is-new' : ''}`}
              onClick={() => onSelect(t.id)}
              style={gated ? { opacity: 0.5 } : null}
              title={gated ? 'Open a funscript to work here (still clickable)' : undefined}
            >
              {t.isNew && <span className="tab-dot" />}
              {t.label}
              {gated && <Icon name="lock" size={11} style={{ opacity: 0.7 }} />}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function AcceptBar({ summary, nextLabel, onAccept, chainFile, isExport }) {
  return (
    <div className="ff-acceptbar">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{summary}</div>
        {chainFile && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }}>
            writes <span style={{ color: 'var(--text-soft)' }}>{chainFile}</span>
          </div>
        )}
      </div>
      <Button kind="ghost" size="sm" icon="rotate-ccw">Reset</Button>
      <Button kind={isExport ? 'warm' : 'primary'} size="md"
              icon={isExport ? 'package' : 'check'} iconRight={isExport ? undefined : 'arrow-right'}
              onClick={onAccept}>
        {isExport ? 'Write outputs' : (nextLabel ? `Accept · chain to ${nextLabel}` : 'Accept')}
      </Button>
    </div>
  );
}

function StatusBar({ scope, chainFile, version }) {
  return (
    <div className="ff-statusbar">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
        synced
      </span>
      <span>scope: {scope}</span>
      {chainFile && <span style={{ color: 'var(--text-soft)' }}>{chainFile}</span>}
      <span style={{ marginLeft: 'auto' }}>FunscriptForge v{version} · prototype</span>
    </div>
  );
}

Object.assign(window, { TopBar, TabStrip, AcceptBar, StatusBar });
