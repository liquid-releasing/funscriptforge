// Project — working view for a single funscript project.
//
// Ported from ui_design/ui_kits/funscriptforge-app/tab-Project.jsx, rewritten
// as a real ES module: primitives come from forgemoment, recents flow through
// the platform adapter (../api/forge.js).
//
// Layout:
//   Left rail (320px)   — search + recent-project switcher; active project drives center.
//   Center (flex)        — title block, funscript chart, files-in-project list,
//                          "Replace files…" affordance. Device picker moved to
//                          the Device tab 2026-05-17 (where it belongs — gives
//                          a clearer home, makes the tab detachable for other
//                          LQR apps, and supports a SFW build via vocab swap).
//
// State ownership:
//   activeProjectId   — local; which project the center is displaying
//
// Project lookup precedence: the prop `openedProjectId` (passed from
// LibraryScreen via App.jsx) seeds activeProjectId on first mount. Users can
// then switch projects via the left rail without losing the lift to App.

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Pill,
  Icon,
  TextInput,
  SectionLabel,
} from 'forgemoment';
import { listRecents, pickFunscriptFile, pickProjectFile, classifyProjectFile } from '../api/forge.js';
import { generatePreviewActions, parseDurationToMs } from '../lib/funscriptPreview.js';
import FunscriptChart from '../components/FunscriptChart.jsx';

// Cold-start substitute when no project is opened and no real recent
// matches the active id. ActiveProject reads `_placeholder` to suppress
// metadata pills and the "loading…" copy that's reserved for actual
// in-flight loads. Renders the same layout shell so the page feels
// consistent across cold-start / loading / loaded.
const COLD_START_PLACEHOLDER = {
  id: 'placeholder',
  title: 'Project',
  duration: '—',
  mediaKind: 'video',
  _placeholder: true,
};

export default function ProjectTab({
  openedProject,
  loadedProjects = [],
  onOpenScript,
  onSelectProject,
  onAttachMedia,
  onAppError,
  isLoadingProject,
}) {
  const [search, setSearch] = useState('');
  const [recents, setRecents] = useState(null);
  const seedId =
    typeof openedProject === 'string' ? openedProject : openedProject?.id ?? null;
  const [activeProjectId, setActiveProjectId] = useState(seedId);

  useEffect(() => {
    let cancelled = false;
    listRecents()
      .then((r) => { if (!cancelled) setRecents(r); })
      .catch((err) => {
        if (cancelled) return;
        console.error('ProjectTab: failed to load recents', err);
        setRecents([]);
      });
    return () => { cancelled = true; };
  }, []);

  // If the user opens a new project from Library while we're mounted, sync.
  useEffect(() => {
    if (typeof openedProject === 'string') setActiveProjectId(openedProject);
    else if (openedProject?.id) setActiveProjectId(openedProject.id);
  }, [openedProject]);

  // Merge session-loaded projects (lifted to App.jsx, survive tab unmounts)
  // with the listRecents() result. Loaded projects always appear first,
  // most-recently-loaded at the top.
  const mergedRecents = useMemo(() => {
    if (!recents) return null;
    const loadedIds = new Set(loadedProjects.map((p) => p.id));
    const rest = recents.filter((r) => !loadedIds.has(r.id));
    return [...loadedProjects, ...rest];
  }, [recents, loadedProjects]);

  const filtered = useMemo(() => {
    if (!mergedRecents) return [];
    if (!search.trim()) return mergedRecents;
    const q = search.toLowerCase();
    return mergedRecents.filter((p) => p.title.toLowerCase().includes(q));
  }, [mergedRecents, search]);

  // Pending placeholder takes precedence — its id (`pending:<path>`) is not
  // in the recents list, so the regular find would miss it and the
  // fallback would silently show the first mock recent.
  const pendingPlaceholder =
    typeof openedProject === 'object' && openedProject?._pending ? openedProject : null;
  // Cold-start placeholder: when nothing is user-opened and the active id
  // doesn't match a real recent, render the ActiveProject layout with
  // "Project" as the title + a skeleton chart, instead of silently showing
  // the first mock or the dashed EmptyProject. Keeps layout consistent
  // across cold-start / loading / loaded.
  const active =
    pendingPlaceholder ??
    mergedRecents?.find((p) => p.id === activeProjectId) ??
    COLD_START_PLACEHOLDER;

  // Left-rail "Open" button: only ever opens a new funscript. Single-type
  // picker keeps this affordance unambiguous.
  const handleOpen = async () => {
    const path = await pickFunscriptFile();
    if (!path) return;
    onOpenScript?.(path);
  };

  // Active-project "Add or replace…" button: opens the multi-type picker
  // and routes by extension. Funscript → reopens the project; audio/video
  // → attaches as media; .ffmeta / .chapters.json → noted but not yet
  // wired through to import. Anything else: surface a footer error.
  const handleAddOrReplace = async () => {
    const path = await pickProjectFile();
    if (!path) return;
    const kind = classifyProjectFile(path);
    if (kind === 'funscript') {
      onOpenScript?.(path);
    } else if (kind === 'media') {
      onAttachMedia?.(path);
    } else if (kind === 'meta') {
      // TODO: route .chapters.json → loadChaptersSidecar, .ffmeta → loadFFMeta.
      // The bundle-aware load path is queued as part of the .ffmeta scaffolding.
      console.log('ProjectTab: meta-file import not wired yet', path);
      onAppError?.(`Importing sidecar files isn't wired yet: ${basename(path)}`);
    } else {
      onAppError?.(`Unrecognized file type: ${basename(path)}`);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      <LeftRail
        projects={filtered}
        active={activeProjectId}
        onPick={(p) => {
          // Route through App so openedProject (and the TopBar header)
          // follows. The smart switch avoids a reload flash when the
          // project is already cached. Mock recents (no path) get the
          // old local-only behavior — onSelectProject silently no-ops
          // for them, so update activeProjectId here for the preview.
          if (p?.path || loadedProjects.some((lp) => lp.id === p?.id)) {
            onSelectProject?.(p);
          } else {
            setActiveProjectId(p?.id);
          }
        }}
        search={search}
        onSearch={setSearch}
        onOpen={handleOpen}
        loading={recents === null}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', background: 'var(--bg)' }}>
        {active ? (
          <ActiveProject
            project={active}
            onAddOrReplace={handleAddOrReplace}
          />
        ) : (
          <EmptyProject onOpen={handleOpen} />
        )}
      </div>
    </div>
  );
}

function LeftRail({ projects, active, onPick, search, onSearch, onOpen, loading }) {
  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border)' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 8,
          }}
        >
          Recent projects
        </div>
        <TextInput value={search} onChange={onSearch} placeholder="Search by name…" />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading
          ? <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)' }}>Loading…</div>
          : projects.map((p) => (
              <ProjectRow key={p.id} project={p} active={p.id === active} onClick={() => onPick(p)} />
            ))}
        <button
          onClick={onOpen}
          style={{
            display: 'flex',
            gap: 12,
            width: '100%',
            padding: '14px 16px',
            border: 'none',
            borderLeft: '3px solid transparent',
            background: 'transparent',
            color: '#ff7b7b',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <Icon name="plus" size={16} />
          <span>Drop a new file…</span>
        </button>
      </div>
    </div>
  );
}

function ProjectRow({ project, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 12,
        width: '100%',
        padding: '12px 16px',
        border: 'none',
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
        borderBottom: '1px solid var(--border)',
        background: active ? 'var(--surface-2)' : 'transparent',
        color: 'var(--text)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 6,
          flexShrink: 0,
          background: 'var(--bg)',
          border: `1px solid ${project.color ?? 'var(--border)'}`,
          color: project.color ?? 'var(--text-dim)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Icon name={project.mediaKind === 'video' ? 'film' : 'music'} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: active ? 700 : 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {project.title}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-dim)',
            marginTop: 2,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {project.duration} · {project.chapters} ch · {project.edited}
        </div>
      </div>
    </button>
  );
}

function ActiveProject({ project, onAddOrReplace }) {
  // Real funscripts loaded via the Rust bridge populate `project.actions`
  // (downsampled to ~1200 points by load_project). Recents and mock projects
  // get a deterministic synthesised curve from the preview generator.
  // `_pending` is the placeholder seeded by App.handleOpenScript at click
  // time — path + title known, chart not yet loaded.
  // `_placeholder` is the cold-start substitute — no project opened at all.
  // Both render the skeleton chart and dim the pills; copy differs.
  const isPending = !!project._pending;
  const isPlaceholder = !!project._placeholder;
  const isQuiet = isPending || isPlaceholder;
  const hasRealActions = Array.isArray(project.actions) && project.actions.length > 0;
  const chartActions = hasRealActions ? project.actions : generatePreviewActions(project, 1200);
  const totalMs = project.durationMs || parseDurationToMs(project.duration) || 60000;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 22 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 10,
            flexShrink: 0,
            background: 'var(--surface)',
            border: `1px solid ${project.color ?? 'var(--border)'}`,
            color: project.color ?? 'var(--text-dim)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name={project.mediaKind === 'video' ? 'film' : 'music'} size={32} stroke={1.5} />
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            Project
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>
            {project.title}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, opacity: isQuiet ? 0.55 : 1 }}>
            {isPlaceholder ? (
              <Pill tone="neutral">Open a project to begin</Pill>
            ) : (
              <>
                <Pill tone="neutral"><Icon name="clock" size={11} style={{ marginRight: 4 }} />{project.duration}</Pill>
                {project.actionCount > 0 && (
                  <Pill tone="neutral">
                    <Icon name="hash" size={11} style={{ marginRight: 4 }} />
                    {project.actionCount.toLocaleString()} actions
                  </Pill>
                )}
                {project.chapters > 0 && (
                  <Pill tone="neutral">
                    <Icon name="bookmark" size={11} style={{ marginRight: 4 }} />
                    {project.chapters} chapters
                  </Pill>
                )}
                {project.toneSuggestion && (
                  <Pill tone="accent" dot title={project.toneRationale}>
                    Tone: {project.toneSuggestion}
                  </Pill>
                )}
                {isPending ? (
                  <Pill tone="info" dot>loading…</Pill>
                ) : (
                  <Pill tone="info" dot>last opened {project.edited}</Pill>
                )}
              </>
            )}
          </div>
        </div>
        <Button kind="ghost" size="sm" icon="more-horizontal">More</Button>
      </div>

      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            Drag to pan · scroll to zoom
          </span>
        }
      >
        Funscript
      </SectionLabel>
      <div style={{ marginBottom: 28 }}>
        {isQuiet ? (
          <FunscriptChartSkeleton label={isPlaceholder ? 'No project loaded' : 'Loading funscript…'} />
        ) : (
          <FunscriptChart
            actions={chartActions}
            totalMs={totalMs}
            height={260}
            // When the Rust bridge populated stats over the full action set,
            // pass them through so the footer doesn't under-report against
            // the downsampled preview.
            totalActionCount={project.actionCount}
            avgSpeed={project.avgSpeed}
            minPos={project.minPos}
            maxPos={project.maxPos}
          />
        )}
      </div>

      <SectionLabel>Files in this project</SectionLabel>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: 24,
          overflow: 'hidden',
        }}
      >
        {project.mediaPath ? (
          <FileRow
            icon={project.mediaKind === 'video' ? 'film' : 'music'}
            name={basename(project.mediaPath)}
            sub={`${project.mediaKind} · same folder · auto-detected`}
            tag="media"
          />
        ) : (
          <FileRow
            icon="alert-circle"
            name="no media attached"
            sub="drop a video/audio file with the same stem next to the funscript"
            tag="media"
            disabled
          />
        )}
        <FileRow icon="file-cog" name={project.path ? basename(project.path) : `${project.title}.funscript`} sub="source funscript · imported as-is" tag="source" />
        {project.sidecarsFound?.length > 0
          ? project.sidecarsFound.map((p) => (
              <FileRow
                key={p}
                icon="settings-2"
                name={basename(p)}
                sub="sidecar · auto-loaded"
                tag="meta"
              />
            ))
          : (
            <FileRow
              icon="settings-2"
              name={`${project.title}.ffmeta.json`}
              sub="our edit metadata · created on first Accept"
              tag="meta"
              disabled
            />
          )}
        <FileRow icon="git-branch" name="_funscript_device.json" sub="device-aware reset · written when Device tab is accepted" tag="chain" disabled />
        <FileRow icon="git-branch" name="_funscript_phrases.json" sub="phrase-level edits · written when Phrases tab is accepted" tag="chain" disabled />
      </div>

      {/* Device picker lives on the Device tab (2026-05-17). Project tab's
          job here ends with the file list + the "Add or replace…" button.
          The button opens a multi-type picker (funscript / audio / video /
          sidecar) and routes the pick by extension. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button kind="ghost" size="md" icon="folder-open" onClick={onAddOrReplace}>
          Add or replace…
        </Button>
      </div>
    </>
  );
}

// DeviceCard moved to DeviceTab.jsx (2026-05-17) — the device picker now
// lives where it belongs.

function basename(p) {
  if (!p) return '';
  const parts = String(p).split(/[/\\]/);
  return parts[parts.length - 1] || String(p);
}

function FileRow({ icon, name, sub, tag, disabled }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={16} style={{ color: 'var(--text-dim)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{sub}</div>
      </div>
      <Pill tone={tag === 'source' ? 'info' : tag === 'chain' ? 'warn' : 'neutral'}>{tag}</Pill>
    </div>
  );
}

function EmptyProject({ onOpen }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <button
        onClick={onOpen}
        style={{
          background: 'var(--surface)',
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 12,
          padding: '40px 56px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <Icon name="upload-cloud" size={36} stroke={1.5} />
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>
          Drop a funscript
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          .funscript · media file attached later
        </div>
      </button>
    </div>
  );
}

// Blank shaded placeholder shown in place of FunscriptChart while a
// project is loading. Same vertical footprint (height 260) so the page
// doesn't reflow when the real chart lands. No animation — just a quiet
// shaded panel; the global busy banner already says "Loading <file>…".
function FunscriptChartSkeleton({ label = 'Loading funscript…' }) {
  return (
    <div
      role="presentation"
      aria-busy="true"
      style={{
        height: 260,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'grid', placeItems: 'center',
        color: 'var(--text-dim)',
        fontSize: 12,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Icon name="loader" size={14} stroke={1.5} />
        {label}
      </span>
    </div>
  );
}
