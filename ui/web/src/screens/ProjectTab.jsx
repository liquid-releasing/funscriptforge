// Project — working view for a single funscript project.
//
// Layout:
//   Left rail (320px)   — "Start a project" actions (sample / open / library)
//                         + search + session-loaded recents.
//   Center (flex)        — title block, funscript chart, files-in-project list,
//                          "Add or replace…" affordance. Device picker moved
//                          to the Device tab 2026-05-17.
//
// Recents data: every project loaded since the app launched. No mock
// fixtures. Lives in App.jsx as `loadedProjects`. Cross-session memory
// belongs to the Library tab (it scans configured roots on each open).
//
// Files-in-project: real readdir of the funscript's folder via
// loadProjectFiles (api/library.js) — same matching rule scan.js applies
// for funscript ↔ media pairing.

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Pill,
  Icon,
  TextInput,
  SectionLabel,
} from 'forgemoment';
import { pickFunscriptFile, pickProjectFile, classifyProjectFile } from '../api/forge.js';
import { loadProjectFiles, revealInExplorer } from '../api/library.js';
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
  onPickAndOpen,
  onLoadSample,
  onGoToLibrary,
  onAttachMedia,
  onAppError,
  onRevertToOriginal,
  isLoadingProject,
}) {
  const [search, setSearch] = useState('');
  // Inline two-step confirm for the destructive "Revert to original"
  // action — matches AnalysisTab's Re-analyze confirm rather than a
  // browser confirm() dialog.
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  // On-disk inventory for the currently active project — drives the
  // "Files in this project" list with real readdir data instead of
  // hardcoded placeholders. Stays null in browser mode (no Tauri readdir).
  const [projectFiles, setProjectFiles] = useState(null);
  const seedId =
    typeof openedProject === 'string' ? openedProject : openedProject?.id ?? null;
  const [activeProjectId, setActiveProjectId] = useState(seedId);

  // If the user opens a new project from Library while we're mounted, sync.
  useEffect(() => {
    if (typeof openedProject === 'string') setActiveProjectId(openedProject);
    else if (openedProject?.id) setActiveProjectId(openedProject.id);
  }, [openedProject]);

  // Re-scan the active project's folder whenever the path changes —
  // gives us companions / sidecars / forge dir / "nearby funscripts"
  // straight from disk, instead of the hardcoded placeholder rows.
  const activePath =
    typeof openedProject === 'object' ? openedProject?.path : null;
  useEffect(() => {
    let cancelled = false;
    if (!activePath || String(activePath).startsWith('sample://')) {
      setProjectFiles(null);
      return undefined;
    }
    loadProjectFiles(activePath).then((res) => {
      if (!cancelled) setProjectFiles(res);
    });
    return () => { cancelled = true; };
  }, [activePath]);

  // Session recents = every project loaded since the app launched.
  // No mock fixtures. Cross-session memory belongs to the Library tab
  // (which scans configured roots on every open).
  const filtered = useMemo(() => {
    if (!search.trim()) return loadedProjects;
    const q = search.toLowerCase();
    return loadedProjects.filter((p) => p.title.toLowerCase().includes(q));
  }, [loadedProjects, search]);

  // Pending placeholder takes precedence — its id (`pending:<path>`) is not
  // in the recents list, so the regular find would miss it.
  const pendingPlaceholder =
    typeof openedProject === 'object' && openedProject?._pending ? openedProject : null;
  // Cold-start placeholder: when nothing is user-opened and the active id
  // doesn't match a real recent, render the ActiveProject layout with
  // "Project" as the title + a skeleton chart, instead of the dashed
  // EmptyProject. Keeps layout consistent across cold-start / loading
  // / loaded.
  const active =
    pendingPlaceholder ??
    loadedProjects.find((p) => p.id === activeProjectId) ??
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
  //
  // defaultPath = the project's own folder, so the dialog starts where
  // the user expects (the funscript's neighbourhood), not in whatever
  // folder the OS last remembered.
  const handleAddOrReplace = async () => {
    const projectDir = projectDirname(openedProject);
    const path = await pickProjectFile(projectDir);
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
          // follows. Session-loaded projects always have a path, so we
          // unconditionally hand off to App.handleSelectProject — it
          // swaps without reload when cached, reloads otherwise.
          onSelectProject?.(p);
        }}
        search={search}
        onSearch={setSearch}
        onOpen={handleOpen}
        onLoadSample={onLoadSample}
        onPickAndOpen={onPickAndOpen}
        onGoToLibrary={onGoToLibrary}
        loading={false}
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', background: 'var(--bg)' }}>
        {active ? (
          <ActiveProject
            project={active}
            projectFiles={projectFiles}
            onAddOrReplace={handleAddOrReplace}
            onOpenScript={onOpenScript}
          />
        ) : (
          <EmptyProject onOpen={handleOpen} />
        )}
      </div>
    </div>
  );
}

function LeftRail({
  projects, active, onPick, search, onSearch, onOpen,
  onLoadSample, onPickAndOpen, onGoToLibrary,
}) {
  const hasStartActions = !!(onLoadSample || onPickAndOpen || onGoToLibrary);
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
      {hasStartActions && (
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)' }}>
          <div
            style={{
              fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 8,
            }}
          >
            Start a project
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {onLoadSample && (
              <Button kind="primary" size="sm" icon="star"
                      onClick={onLoadSample}
                      style={{ justifyContent: 'center' }}>
                Load sample project
              </Button>
            )}
            {onPickAndOpen && (
              <Button kind="secondary" size="sm" icon="folder-open"
                      onClick={onPickAndOpen}
                      style={{ justifyContent: 'center' }}>
                Open a funscript…
              </Button>
            )}
            {onGoToLibrary && (
              <Button kind="ghost" size="sm" icon="library"
                      onClick={onGoToLibrary}
                      style={{ justifyContent: 'center' }}>
                Browse library
              </Button>
            )}
          </div>
        </div>
      )}
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
        {projects.length === 0 ? (
          <div style={{
            padding: '16px 18px', fontSize: 11.5, color: 'var(--text-dim)',
            lineHeight: 1.5,
          }}>
            Projects you open this session will appear here.
          </div>
        ) : (
          projects.map((p) => (
            <ProjectRow key={p.id} project={p} active={p.id === active} onClick={() => onPick(p)} />
          ))
        )}
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

function ActiveProject({ project, projectFiles, onAddOrReplace, onOpenScript }) {
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
                {/* Working-copy indicator. When the project has accumulated
                    edits (Apply / Tone), the app shows the work funscript
                    everywhere — including reanalyze — not the original.
                    Surfacing it here answers "am I on the original or my
                    edits?" at a glance, and pairs with Revert below. */}
                {project.hasWorkingEdits && (
                  <Pill tone="warn" dot title="This project has unsaved edits. The editor (and reanalyze) read this working copy, not the original file. Use Revert to original to discard all edits.">
                    Edited — working copy
                  </Pill>
                )}
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Revert to original — only when there are working edits to
              discard. Two-step inline confirm because it's destructive
              (throws away every edit across all tabs). Distinct from the
              per-tab footer Reset. */}
          {!isPlaceholder && !isPending && project.hasWorkingEdits && (
            confirmingRevert ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Discard all edits?
                </span>
                <Button
                  kind="danger" size="sm" icon="rotate-ccw"
                  onClick={() => { setConfirmingRevert(false); onRevertToOriginal?.(); }}
                >
                  Revert
                </Button>
                <Button kind="ghost" size="sm" onClick={() => setConfirmingRevert(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                kind="ghost" size="sm" icon="rotate-ccw"
                title="Discard all edits and restore the original funscript"
                onClick={() => setConfirmingRevert(true)}
              >
                Revert to original
              </Button>
            )
          )}
          <Button kind="ghost" size="sm" icon="more-horizontal">More</Button>
        </div>
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

      {projectFiles?.companionFunscripts?.length > 0 && (
        <NearbyFunscriptBanner
          items={projectFiles.companionFunscripts}
          onOpen={onOpenScript}
        />
      )}

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
        {/* Detected media — from readdir when available, else fall back
            to what the project record carries (browser mode / sample). */}
        {projectFiles ? (
          projectFiles.media.length > 0 ? (
            projectFiles.media.map((m) => (
              <FileRow
                key={`media:${m.path}`}
                icon={m.kind === 'video' ? 'film' : 'music'}
                name={m.name}
                sub={`${m.kind} · same folder · auto-detected`}
                tag="media"
              />
            ))
          ) : (
            <FileRow
              icon="alert-circle"
              name="no media attached"
              sub="drop a video/audio file with the same stem next to the funscript"
              tag="media"
              disabled
            />
          )
        ) : project.mediaPath ? (
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

        <FileRow
          icon="file-cog"
          name={projectFiles?.funscript?.name
            ?? (project.path ? basename(project.path) : `${project.title}.funscript`)}
          sub="source funscript · imported as-is"
          tag="source"
        />

        {/* Detected sidecars — chapters.json / beats.json / etc. live next
            to the funscript, surfaced from disk. */}
        {projectFiles?.sidecars?.map((s) => (
          <FileRow
            key={`sidecar:${s.path}`}
            icon={sidecarIcon(s.kind)}
            name={s.name}
            sub={sidecarLabel(s.kind)}
            tag={sidecarTag(s.kind)}
          />
        ))}

        {/* Forge dir — present once the project has artifacts. Reveal
            button takes the user to the folder in their OS file explorer. */}
        {projectFiles?.forgeDir && (
          <FileRow
            icon="folder"
            name={basename(projectFiles.forgeDir)}
            sub="forge folder · edits and clips stored here"
            tag="forge"
            revealPath={projectFiles.forgeDir}
          />
        )}

        {/* ffmeta fallback — only when scan didn't pick up an actual
            sidecar. Disabled so the user reads it as "will be written
            on first Accept" rather than "exists now." */}
        {!projectFiles?.sidecars?.some((s) => s.kind === 'ffmeta') && (
          <FileRow
            icon="settings-2"
            name={`${project.title}.ffmeta.json`}
            sub="our edit metadata · created on first Accept"
            tag="meta"
            disabled
          />
        )}

        {/* Chain placeholders — forward indicators for outputs each
            downstream tab will write on Accept. Always shown, always
            disabled, describe the pipeline shape. */}
        <FileRow icon="git-branch" name="_funscript_device.json"
                 sub="device-aware reset · written when Device tab is accepted"
                 tag="chain" disabled />
        <FileRow icon="git-branch" name="_funscript_phrases.json"
                 sub="phrase-level edits · written when Phrases tab is accepted"
                 tag="chain" disabled />
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

// Derive the project's folder from its funscript path. Skips synthetic
// `sample://` projects and anything without a path.
function projectDirname(project) {
  const path = typeof project === 'object' ? project?.path : null;
  if (!path || String(path).startsWith('sample://')) return undefined;
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return idx > 0 ? path.slice(0, idx) : undefined;
}

function FileRow({ icon, name, sub, tag, disabled, revealPath }) {
  const onReveal = revealPath
    ? () => revealInExplorer(revealPath).catch((e) => console.warn('reveal failed', e))
    : null;
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
      {onReveal && (
        <button
          onClick={onReveal}
          title="Reveal in Explorer"
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-dim)', borderRadius: 4, cursor: 'pointer',
            padding: '4px 6px',
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          <Icon name="external-link" size={12} />
        </button>
      )}
      <Pill tone={pillTone(tag)}>{tag}</Pill>
    </div>
  );
}

function pillTone(tag) {
  if (tag === 'source') return 'info';
  if (tag === 'forge')  return 'warn';
  if (tag === 'feel')   return 'accent';
  if (tag === 'chain')  return 'warn';
  return 'neutral';
}

function sidecarIcon(kind) {
  switch (kind) {
    case 'chapters':     return 'bookmark';
    case 'beats':        return 'activity';
    case 'audio-peaks':  return 'volume-2';
    case 'spectrogram':  return 'layers';
    case 'phrases':      return 'list';
    case 'events':       return 'zap';
    case 'feel':         return 'sliders';
    case 'ffmeta':       return 'settings-2';
    default:             return 'file';
  }
}

function sidecarLabel(kind) {
  switch (kind) {
    case 'chapters':     return 'chapter boundaries · auto-loaded';
    case 'beats':        return 'beat grid · auto-loaded';
    case 'audio-peaks':  return 'waveform peaks · auto-loaded';
    case 'spectrogram':  return 'spectrogram cells · auto-loaded';
    case 'phrases':      return 'phrase slices · auto-loaded';
    case 'events':       return 'point-in-time effects';
    case 'feel':         return 'canonical .feel.yml · cross-device';
    case 'ffmeta':       return 'project metadata · phrase tags, transforms, accept history';
    default:             return 'sidecar';
  }
}

function sidecarTag(kind) {
  if (kind === 'feel' || kind === 'events') return 'feel';
  return 'meta';
}

function NearbyFunscriptBanner({ items, onOpen }) {
  // Funscripts whose stems differ from this project's by punctuation
  // or case only — the strict-stem scan won't auto-attach them, so we
  // surface them as a suggestion the user can act on.
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px', marginBottom: 18,
      background: 'rgba(255, 181, 71, 0.08)',
      border: '1px solid rgba(255, 181, 71, 0.35)',
      borderRadius: 8,
    }}>
      <Icon name="link" size={16} style={{ color: '#ffb547', marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
          {items.length === 1
            ? 'Found a nearby funscript with a similar name'
            : `Found ${items.length} nearby funscripts with similar names`}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Stems differ only by punctuation or case. Open one to switch projects.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {items.map((it) => (
            <button
              key={it.path}
              onClick={() => onOpen?.(it.path)}
              title={it.path}
              style={{
                padding: '4px 9px', fontSize: 11.5, fontWeight: 600,
                background: 'var(--surface-2)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 4,
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <Icon name="file-cog" size={11} />
              {it.name}
            </button>
          ))}
        </div>
      </div>
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
