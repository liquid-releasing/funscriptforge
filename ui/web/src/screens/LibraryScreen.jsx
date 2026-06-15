// LibraryScreen — Library Phase A/C inline panel.
//
// Multi-root + project grid + status filter + sort. The data layer
// lives in forgemoment/src/library/* (scanRoot + config helpers);
// this screen builds the UI inline (Ladder A). Once the visual rhythm
// is settled we extract the grid + cards into a `LibraryView`
// component in forgemoment with a `renderCard` slot.
//
// Click a project card → onOpen(path). We prefer the funscript path
// when one exists alongside the media (so the existing handleOpenScript
// pipeline picks it up); fall back to the media path for raw projects.

import { useEffect, useMemo, useState } from 'react';
import { Pill, Icon, Button } from 'forgemoment';
import {
  getConfigPath,
  loadConfig,
  saveConfig,
  scanRoot,
  pickFolder,
  revealInExplorer,
  addRoot,
  removeRoot,
  tauriFs,
} from '../api/library.js';

const STATUS_OPTIONS = [
  { id: 'all',       label: 'All' },
  { id: 'raw',       label: 'Raw' },
  { id: 'active',    label: 'Active' },
  { id: 'completed', label: 'Completed' },
];

const SORT_OPTIONS = [
  { id: 'lastEdited', label: 'Last edited' },
  { id: 'title',      label: 'Title' },
  { id: 'duration',   label: 'Duration' },
];

export default function LibraryScreen({ onOpen, onOpenMedia, onAppError }) {
  const [config, setConfig] = useState(null);
  // Map<rootPath, ScanResult>
  const [scans, setScans] = useState(new Map());
  // Set<rootPath> currently scanning
  const [scanning, setScanning] = useState(new Set());
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('lastEdited');
  // Active root in the rail; null = show all roots merged.
  const [activeRootPath, setActiveRootPath] = useState(null);

  // ── Load config on mount ───────────────────────────────────────────
  // Reusable so the error state below can offer a Retry (a stuck config
  // load — e.g. the library_config_path / fs invoke starved behind heavy
  // ffmpeg clip extraction, or the WebView IPC orphaned by an HMR reload —
  // would otherwise strand the user on "Loading library…" forever, with
  // the error invisible because config===null gates out the Header).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadConfig()
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch((e) => {
        if (cancelled) return;
        console.error('LibraryScreen: loadConfig failed', e);
        setError(String(e?.message ?? e));
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // ── Scan each configured root when the config changes ──────────────
  useEffect(() => {
    if (!config) return undefined;
    let cancelled = false;
    (async () => {
      // Mark all roots as scanning so the UI shows progress.
      setScanning(new Set(config.roots.map((r) => r.path)));
      for (const root of config.roots) {
        try {
          const result = await scanRoot(root);
          if (cancelled) return;
          setScans((prev) => {
            const next = new Map(prev);
            next.set(root.path, result);
            return next;
          });
        } catch (e) {
          if (cancelled) return;
          console.error('LibraryScreen: scan failed', root.path, e);
          setScans((prev) => {
            const next = new Map(prev);
            next.set(root.path, { root, projects: [], errors: [String(e)], scannedAt: Date.now() });
            return next;
          });
        } finally {
          if (!cancelled) {
            setScanning((prev) => {
              const next = new Set(prev);
              next.delete(root.path);
              return next;
            });
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [config]);

  // Clear scans for roots that no longer exist in config.
  useEffect(() => {
    if (!config) return;
    setScans((prev) => {
      const configured = new Set(config.roots.map((r) => r.path));
      const next = new Map();
      for (const [k, v] of prev) {
        if (configured.has(k)) next.set(k, v);
      }
      return next;
    });
  }, [config]);

  // ── Handlers ───────────────────────────────────────────────────────
  const handleAddRoot = async () => {
    const path = await pickFolder();
    if (!path) return;
    const next = addRoot(config, path);
    await saveConfig(next);
    setConfig(next);
  };

  const handleRemoveRoot = async (rootPath) => {
    const next = removeRoot(config, rootPath);
    await saveConfig(next);
    setConfig(next);
    if (activeRootPath === rootPath) setActiveRootPath(null);
  };

  const handleReveal = async (path) => {
    try { await revealInExplorer(path); }
    catch (e) { console.error('reveal failed', e); }
  };

  const handleRescan = async (rootPath) => {
    const root = config.roots.find((r) => r.path === rootPath);
    if (!root) return;
    setScanning((prev) => new Set(prev).add(rootPath));
    try {
      const result = await scanRoot(root);
      setScans((prev) => new Map(prev).set(rootPath, result));
    } finally {
      setScanning((prev) => { const n = new Set(prev); n.delete(rootPath); return n; });
    }
  };

  const handleCardClick = (project) => {
    // Raw projects (video/audio only, no .funscript) open as a VIDEO-ONLY
    // project — the generate-first path (item D). load_project can't parse a
    // media file as a funscript, so route to onOpenMedia, which probes the
    // media and seeds a project whose Generate tab creates the funscript.
    if (!project.pills.funscript) {
      if (project.mediaPath) {
        onOpenMedia?.(project.mediaPath);
      } else {
        onAppError?.(`${project.title} has no media file to open.`);
      }
      return;
    }
    // Prefer the matched filename (handles prefix-with-boundary cases —
    // funscript stem may differ from media stem). Fall back to the
    // strict `<stem>.funscript` for older scan results.
    const funscriptName = project.funscriptName ?? `${project.stem}.funscript`;
    const funscriptPath = tauriFs.join(project.dirPath, funscriptName);
    // Pass the Library card's title + media as hints — when the
    // funscript stem differs from the media stem (IPZZ-125 case), the
    // loaded project should still read as the media-stem-titled
    // project the user clicked, AND it should pick up the media file
    // Library already matched (Rust's find_adjacent_media uses strict-
    // stem matching, which misses the prefix-with-boundary pairing).
    onOpen?.(funscriptPath, {
      title: project.title,
      mediaPath: project.mediaPath,
      mediaKind: project.kind, // 'video' | 'audio' from scan
    });
  };

  // ── Derive the project list to display ─────────────────────────────
  // Each project gets a `_locationLabel` computed at render time: the
  // path from the root down to the parent folder, slash-normalized for
  // display. Empty when the project sits directly in the root. Helps
  // disambiguate same-stem projects in different folders (#2 nit).
  const filteredProjects = useMemo(() => {
    if (!config) return [];
    const rootsToInclude = activeRootPath
      ? config.roots.filter((r) => r.path === activeRootPath)
      : config.roots;
    let projects = [];
    for (const r of rootsToInclude) {
      const result = scans.get(r.path);
      if (!result) continue;
      for (const p of result.projects) {
        projects.push({
          ...p,
          _locationLabel: computeLocationLabel(p.dirPath, r.path, r.label),
        });
      }
    }
    if (statusFilter !== 'all') {
      projects = projects.filter((p) => p.status === statusFilter);
    }
    return sortProjects(projects, sortKey);
  }, [config, scans, activeRootPath, statusFilter, sortKey]);

  // ── Render ─────────────────────────────────────────────────────────
  if (config === null) {
    if (error) {
      return (
        <CenteredMessage>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            textAlign: 'center', gap: 12,
          }}>
            <div>Couldn’t load the library.</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 420 }}>
              {error}
            </div>
            <Button kind="secondary" size="sm" icon="refresh-ccw"
                    onClick={() => setReloadKey((k) => k + 1)}>
              Retry
            </Button>
          </div>
        </CenteredMessage>
      );
    }
    return <CenteredMessage>Loading library…</CenteredMessage>;
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minHeight: 0, background: 'var(--bg)',
    }}>
      <Header
        config={config}
        scans={scans}
        scanning={scanning}
        error={error}
      />

      <RootsRow
        config={config}
        scans={scans}
        scanning={scanning}
        activeRootPath={activeRootPath}
        onSelectRoot={setActiveRootPath}
        onAddRoot={handleAddRoot}
        onRemoveRoot={handleRemoveRoot}
        onReveal={handleReveal}
        onRescan={handleRescan}
      />

      <FilterStrip
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        sortKey={sortKey}
        onSortChange={setSortKey}
        visibleCount={filteredProjects.length}
        totalCount={totalCount(scans)}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {config.roots.length === 0
          ? <EmptyConfigState onAddRoot={handleAddRoot} />
          : <ProjectGrid
              projects={filteredProjects}
              onClick={handleCardClick}
              onReveal={handleReveal}
            />}
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

function Header({ config, scans, scanning, error }) {
  const rootCount = config.roots.length;
  const projectCount = totalCount(scans);
  return (
    <div style={{ padding: '20px 24px 12px', flexShrink: 0 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-dim)',
      }}>
        Library
      </div>
      <h2 style={{ margin: '4px 0 6px', fontSize: 22, fontWeight: 700 }}>
        {rootCount === 0
          ? 'Add a folder to start your library'
          : `${projectCount} project${projectCount === 1 ? '' : 's'} across ${rootCount} folder${rootCount === 1 ? '' : 's'}`}
      </h2>
      {scanning.size > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Scanning {scanning.size} folder{scanning.size === 1 ? '' : 's'}…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: '#ff4b4b' }}>{error}</div>
      )}
    </div>
  );
}

function RootsRow({
  config, scans, scanning, activeRootPath,
  onSelectRoot, onAddRoot, onRemoveRoot, onReveal, onRescan,
}) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 24px 16px',
      overflowX: 'auto', flexShrink: 0,
    }}>
      {/* "All roots" pill — only when more than one root configured */}
      {config.roots.length > 1 && (
        <AllRootsCard
          selected={activeRootPath === null}
          totalProjects={totalCount(scans)}
          onClick={() => onSelectRoot(null)}
        />
      )}
      {config.roots.map((root) => (
        <RootCard
          key={root.path}
          root={root}
          scan={scans.get(root.path)}
          isScanning={scanning.has(root.path)}
          selected={activeRootPath === root.path}
          onClick={() => onSelectRoot(root.path)}
          onRemove={() => onRemoveRoot(root.path)}
          onReveal={() => onReveal(root.path)}
          onRescan={() => onRescan(root.path)}
        />
      ))}
      <AddRootCard onClick={onAddRoot} />
    </div>
  );
}

function AllRootsCard({ selected, totalProjects, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...rootCardBase,
        background: selected ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>All folders</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
        {totalProjects} project{totalProjects === 1 ? '' : 's'}
      </div>
    </button>
  );
}

function RootCard({ root, scan, isScanning, selected, onClick, onRemove, onReveal, onRescan }) {
  const count = scan?.projects.length ?? 0;
  return (
    <div style={{
      ...rootCardBase,
      background: selected ? 'var(--surface-2)' : 'var(--surface)',
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      cursor: 'pointer',
      padding: 0,
      display: 'flex', flexDirection: 'column',
    }}
      onClick={onClick}
    >
      <div style={{ padding: '10px 12px 6px', flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={root.path}>
          {root.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          {isScanning ? 'Scanning…' : `${count} project${count === 1 ? '' : 's'}`}
        </div>
      </div>
      <div style={{
        display: 'flex', gap: 4, padding: '4px 6px',
        borderTop: '1px solid var(--border)',
      }}>
        <IconBtn name="refresh-ccw" title="Rescan"
          onClick={(e) => { e.stopPropagation(); onRescan(); }} />
        <IconBtn name="external-link" title="Reveal in Explorer"
          onClick={(e) => { e.stopPropagation(); onReveal(); }} />
        <div style={{ flex: 1 }} />
        <IconBtn name="x" title="Remove from library"
          onClick={(e) => { e.stopPropagation(); onRemove(); }} />
      </div>
    </div>
  );
}

function AddRootCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Add a folder to the library"
      style={{
        ...rootCardBase,
        background: 'transparent',
        border: '1.5px dashed var(--border)',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4,
      }}
    >
      <Icon name="plus" size={22} style={{ color: 'var(--text-dim)' }} />
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Add folder</span>
    </button>
  );
}

function IconBtn({ name, title, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 6, borderRadius: 4, color: 'var(--text-dim)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Icon name={name} size={13} />
    </button>
  );
}

function FilterStrip({ statusFilter, onStatusChange, sortKey, onSortChange, visibleCount, totalCount }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 24px 14px', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => onStatusChange(o.id)}
            style={{
              padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
              border: '1px solid var(--border)', borderRadius: 4,
              background: statusFilter === o.id ? 'var(--surface-2)' : 'transparent',
              color: statusFilter === o.id ? 'var(--text)' : 'var(--text-dim)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {visibleCount} of {totalCount}
      </span>
      <label style={{
        fontSize: 11, color: 'var(--text-dim)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        Sort
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value)}
          style={{
            padding: '4px 6px', fontSize: 11.5,
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4,
            fontFamily: 'inherit',
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ProjectGrid({ projects, onClick, onReveal }) {
  if (projects.length === 0) {
    return (
      <div style={{
        padding: 48, textAlign: 'center', color: 'var(--text-dim)',
        fontSize: 13,
      }}>
        No projects match the current filter.
      </div>
    );
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 12,
    }}>
      {projects.map((p) => (
        <ProjectCard
          key={p.id}
          project={p}
          onClick={() => onClick(p)}
          onReveal={() => onReveal(p.mediaPath)}
        />
      ))}
    </div>
  );
}

function ProjectCard({ project, onClick, onReveal }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms',
        position: 'relative',
      }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      {/* Thumbnail — placeholder for v1; resolver lands in a later pass */}
      <div style={{
        aspectRatio: '16/9',
        background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-dim)',
        borderBottom: '1px solid var(--border)',
        position: 'relative',
      }}>
        {project.thumbPath
          ? <img src={`asset://localhost/${project.thumbPath}`}
                 alt=""
                 style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon name={project.kind === 'audio' ? 'music' : 'film'} size={32} />}
        {/* Reveal-in-Explorer button — top-right overlay on the thumb.
            Stops propagation so it doesn't trigger card-open. */}
        <button
          onClick={(e) => { e.stopPropagation(); onReveal(); }}
          title="Reveal in Explorer"
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 26, height: 26, padding: 0,
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4, cursor: 'pointer',
            color: 'rgba(255,255,255,0.8)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="external-link" size={13} />
        </button>
      </div>

      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Title — single line truncate */}
        <div
          title={project.mediaPath}
          style={{
            fontSize: 13, fontWeight: 700, color: 'var(--text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {project.title}
        </div>

        {/* Location — small dim secondary line; only when project isn't in
            the root itself. Disambiguates same-stem projects across folders. */}
        {project._locationLabel && (
          <div
            title={project.dirPath}
            style={{
              fontSize: 10.5, color: 'var(--text-dim)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: 'var(--font-mono)',
              marginTop: -2,
            }}
          >
            {project._locationLabel}
          </div>
        )}

        {/* Pills — only render the ones that are true */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <ProjectPills pills={project.pills} status={project.status} />
        </div>

        {/* Metadata row — only render known fields */}
        <ProjectMetaRow project={project} />
      </div>
    </div>
  );
}

function ProjectPills({ pills, status }) {
  const pillStyle = (color) => ({
    fontSize: 9.5, fontWeight: 700,
    padding: '2px 6px', borderRadius: 3,
    background: `${color}22`, color,
    border: `1px solid ${color}55`,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  });
  return (
    <>
      {pills.video && <span style={pillStyle('#4dabf7')}>video</span>}
      {pills.audio && <span style={pillStyle('#3ed598')}>audio</span>}
      {pills.funscript && <span style={pillStyle('#ffb547')}>funscript</span>}
      {pills.forged && <span style={pillStyle('#ff5470')}>forged</span>}
      {status === 'completed' && <span style={pillStyle('#c77dff')}>completed</span>}
    </>
  );
}

function ProjectMetaRow({ project }) {
  const parts = [];
  if (project.durationMs != null) parts.push(fmtDuration(project.durationMs));
  if (project.metadata.chapters != null) parts.push(`${project.metadata.chapters} ch`);
  if (project.metadata.bpm != null) parts.push(`${project.metadata.bpm} bpm`);
  if (project.metadata.beats != null) parts.push(`${project.metadata.beats} beats`);
  parts.push(fmtRelativeMtime(project.mtime));
  if (parts.length === 0) return null;
  return (
    <div style={{
      fontSize: 10, color: 'var(--text-dim)',
      display: 'flex', flexWrap: 'wrap', gap: 8,
      marginTop: 'auto',
    }}>
      {parts.map((s, i) => <span key={i}>{s}</span>)}
    </div>
  );
}

function EmptyConfigState({ onAddRoot }) {
  return (
    <div style={{
      maxWidth: 480, margin: '48px auto', textAlign: 'center',
      padding: 32, background: 'var(--surface)',
      border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      <Icon name="folder-open" size={40} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Your library is empty</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
        Add a folder where your media lives. FunscriptForge scans for videos and audio,
        and surfaces any projects you've already forged alongside them.
      </p>
      <button
        onClick={onAddRoot}
        style={{
          padding: '8px 16px', fontSize: 13, fontWeight: 700,
          background: 'var(--accent)', color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        <Icon name="plus" size={13} />
        Add a folder
      </button>
    </div>
  );
}

function CenteredMessage({ children }) {
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-dim)', fontSize: 13,
    }}>
      {children}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

const rootCardBase = {
  minWidth: 180, maxWidth: 220,
  borderRadius: 8, padding: '12px 14px',
  textAlign: 'left',
  cursor: 'pointer', fontFamily: 'inherit',
};

function totalCount(scans) {
  let n = 0;
  for (const r of scans.values()) n += r.projects.length;
  return n;
}

function sortProjects(projects, sortKey) {
  const copy = projects.slice();
  if (sortKey === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortKey === 'duration') {
    copy.sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1));
  } else {
    // lastEdited — newest first
    copy.sort((a, b) => (b.mtime > a.mtime ? 1 : (b.mtime < a.mtime ? -1 : 0)));
  }
  return copy;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Compute the project's location label — the path from the configured
 * root down to the project's parent folder, slash-normalized for
 * display. Empty when the project sits directly in the root (no extra
 * context needed).
 *
 * Examples (root = "/lib", rootLabel = "test_funscript"):
 *   dirPath = "/lib"                     → "" (project at root)
 *   dirPath = "/lib/2024"                → "2024"
 *   dirPath = "/lib/movies/archive"      → "movies/archive"
 *   dirPath = "C:\\Users\\bruce\\test\\sub" + root "C:\\Users\\bruce\\test"
 *                                        → "sub"
 */
function computeLocationLabel(dirPath, rootPath, _rootLabel) {
  if (!dirPath || !rootPath) return '';
  if (dirPath === rootPath) return '';
  // Strip the root prefix; then any leading separator.
  let rel = dirPath;
  if (dirPath.toLowerCase().startsWith(rootPath.toLowerCase())) {
    rel = dirPath.slice(rootPath.length);
  }
  rel = rel.replace(/^[\\/]+/, '');
  // Normalize backslashes to forward slashes for display.
  return rel.replace(/\\/g, '/');
}

function fmtRelativeMtime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!then) return '';
  const diff = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < day) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
