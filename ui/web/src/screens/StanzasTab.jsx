// StanzasTab — apply transforms to one or more *stanzas* inside a
// chapter. Sibling to PhrasesTab; parallel structure, different unit.
//
// A "stanza" is a videoflow-classified audio phrase (variable length,
// intent vocabulary). Phrases tab uses the FF analyzer's motion-
// uniformity classification (diagnostic vocabulary: stingy / giggle /
// plateau …); Stanzas tab uses forgegen's audio-rhythm classification
// (intent vocabulary: tease / steady / edging / break / fast / slow).
// Two complementary lenses on the same funscript. See
// project_stanzas_tab.md for the full rationale.
//
// Layout — identical chassis to PhrasesTab:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Row 1 — CHAPTERS ribbon                                  │
//   ├──────────────────────────────────────────────────────────┤
//   │ Row 2 — Active chapter ChapterContextStrip + stanza bands│
//   ├──────────┬──────────────────────────────────┬────────────┤
//   │ Rail     │ Center — filtered StanzaTable     │ Transform  │
//   │ (Mode    │  before/after preview            │ Panel      │
//   │ / Single)│  per stanza                       │            │
//   └──────────┴──────────────────────────────────┴────────────┘
//
// Data: `readStanzas(project.path)` → pulls the `phrases` field out of
// the `<stem>.chapters.json` sidecar (videoflow-written; pre-computed).
// Cheap operation, no analyzer pipeline. If the sidecar is missing, the
// tab renders an empty state nudging the user to run auto-chapter on
// the Chapters tab first.
//
// Phase 1 ships Mode + Single rail flavors. Phase 2 (cluster rail)
// arrives once the Python clustering pass lands; the Segmented header
// will gain a `Cluster` option.

import { useEffect, useMemo, useState } from 'react';
import {
  ChapterRibbon, ChapterContextStrip, Segmented, TransformPanel,
  Icon, fmtTimeShort, fmtDurationMs,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { TRANSFORMS, BEHAVIOR_TAGS, FORGEGEN_MODES } from '../data/transforms.js';
import { readStanzas } from '../api/forge.js';

function clamp01_100(v) { return Math.max(0, Math.min(100, v)); }

function sliceForStanza(actions, stanza) {
  if (!actions || !stanza) return { acts: [], dur: 0 };
  const s = stanza.at_ms;
  const e = stanza.end_ms;
  const acts = actions
    .filter((a) => a.at >= s && a.at <= e)
    .map((a) => ({ at: a.at - s, pos: a.pos }));
  return { acts, dur: Math.max(1, e - s) };
}

function previewActions(actions, transformId, params) {
  if (!actions || actions.length === 0) return actions;
  if (transformId === 'amplitude_scale') {
    const s = Number(params?.scale ?? 1);
    return actions.map((a) => ({ at: a.at, pos: clamp01_100(50 + (a.pos - 50) * s) }));
  }
  if (transformId === 'recenter') {
    const off = Number(params?.offset ?? 0);
    return actions.map((a) => ({ at: a.at, pos: clamp01_100(a.pos + off) }));
  }
  return actions;
}

function findMode(id) {
  return FORGEGEN_MODES.find((m) => m.id === id) || null;
}

// Module-level stable empty arrays for the cache-miss fallback. `?? []`
// would create a fresh array each render, cascading through downstream
// useMemo deps and triggering an infinite render loop via the edit-set
// useEffect (observed 2026-05-23). Same pattern used in PhrasesTab.
const EMPTY_STANZAS = [];
const EMPTY_CLUSTERS = [];

export default function StanzasTab({
  project,
  setBusy,
  setAppError,
  stanzasByPath = {},
  setStanzasByPath = () => {},
}) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? null);
  const [mode, setMode] = useState('tag');   // 'tag' (forgegen mode) | 'single'

  // Edit set — derived from rail selection, toggleable per-row.
  const [editedStanzaIds, setEditedStanzaIds] = useState([]);
  const toggleEditedStanza = (id) => {
    setEditedStanzaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const [activeModeId, setActiveModeId] = useState(null);
  const [activeClusterId, setActiveClusterId] = useState(null);
  const [focusStanzaId, setFocusStanzaId] = useState(null);

  const [isStanzaViewExpanded, setIsStanzaViewExpanded] = useState(true);
  useEffect(() => { setIsStanzaViewExpanded(true); }, [activeChapterId]);

  // TransformPanel state — same shape as Phrases/Patterns.
  const [category, setCategory] = useState('behavior');
  const [transformId, setTransformId] = useState(null);
  const [params, setParams] = useState({});

  // Empty / no-project states
  if (!project?.path) {
    return <EmptyState title="No project open"
      body="Open a funscript from the Library tab to apply transforms." />;
  }
  if (chapters.length === 0) {
    return <EmptyState title="No chapters yet"
      body="Stanzas live inside chapters. Create chapters on the Chapters tab first, then come back." />;
  }

  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? chapters[0];
  // Active chapter's index in the chapter list — used to filter stanzas
  // by `chapter_idx` (videoflow phrase records carry this field).
  const activeChapterIdx = chapters.findIndex((c) => c.id === activeChapter.id);

  // Stanzas + clusters pulled from <stem>.chapters.json via readStanzas.
  // Cached at App.jsx level keyed by funscript path so tab switches
  // don't re-read.
  const cacheEntry = project?.path ? stanzasByPath[project.path] : null;
  const allStanzas = cacheEntry?.stanzas ?? EMPTY_STANZAS;
  const allClusters = cacheEntry?.clusters ?? EMPTY_CLUSTERS;
  const stanzasLoaded = !!cacheEntry?.loaded;

  useEffect(() => {
    if (!project?.path) return undefined;
    if (stanzasByPath[project.path]?.loaded) return undefined;
    let cancelled = false;
    setAppError?.(null);
    readStanzas(project.path)
      .then((resp) => {
        if (cancelled) return;
        const stanzas = Array.isArray(resp?.stanzas) ? resp.stanzas : [];
        const clusters = Array.isArray(resp?.clusters) ? resp.clusters : [];
        setStanzasByPath((prev) => ({
          ...prev,
          [project.path]: { stanzas, clusters, loaded: true },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('readStanzas failed', err);
        setAppError?.(`Read stanzas failed: ${err?.message ?? err}`);
        setStanzasByPath((prev) => ({
          ...prev,
          [project.path]: { stanzas: [], clusters: [], loaded: true },
        }));
      });
    return () => { cancelled = true; };
  }, [project?.path]);

  // Stanzas scoped to the active chapter by chapter_idx (set in Python
  // when reading the sidecar). Falls back to start-in-chapter time
  // filter when chapter_idx is missing (defensive — older sidecars
  // shouldn't be missing the field, but render gracefully if so).
  const stanzasInScope = useMemo(() => {
    if (!activeChapter) return [];
    return allStanzas.filter((s) => {
      if (typeof s.chapter_idx === 'number') return s.chapter_idx === activeChapterIdx;
      return s.at_ms >= activeChapter.atMs && s.at_ms < activeChapter.endMs;
    });
  }, [allStanzas, activeChapter?.id, activeChapterIdx]);

  // Mode counts in the active chapter — drives rail badges + default.
  const modesWithCount = useMemo(() => {
    const counts = {};
    for (const s of stanzasInScope) {
      if (s.mode) counts[s.mode] = (counts[s.mode] || 0) + 1;
    }
    return FORGEGEN_MODES.map((m) => ({ ...m, count: counts[m.id] || 0 }));
  }, [stanzasInScope]);
  const firstPresentModeId = useMemo(
    () => modesWithCount.find((m) => m.count > 0)?.id ?? null,
    [modesWithCount],
  );

  // Clusters intersected with active-chapter scope. A cluster is
  // "in scope" if any of its stanza IDs land inside this chapter; the
  // rail badge counts only the in-chapter members.
  const stanzasInScopeIdSet = useMemo(
    () => new Set(stanzasInScope.map((s) => s.id)),
    [stanzasInScope],
  );
  const clustersInScope = useMemo(() => {
    return allClusters
      .map((c) => {
        const memberIds = c.stanza_ids.filter((sid) => stanzasInScopeIdSet.has(sid));
        return { ...c, members_in_scope: memberIds };
      })
      .filter((c) => c.members_in_scope.length > 0)
      .sort((a, b) => b.members_in_scope.length - a.members_in_scope.length);
  }, [allClusters, stanzasInScopeIdSet]);

  const firstPresentClusterId = useMemo(
    () => clustersInScope[0]?.id ?? null,
    [clustersInScope],
  );

  useEffect(() => {
    setActiveModeId(firstPresentModeId);
  }, [firstPresentModeId, activeChapterId]);
  useEffect(() => {
    setActiveClusterId(firstPresentClusterId);
  }, [firstPresentClusterId, activeChapterId]);
  useEffect(() => {
    if (mode === 'single' && stanzasInScope.length > 0) {
      const stillExists = focusStanzaId && stanzasInScope.some((s) => s.id === focusStanzaId);
      if (!stillExists) setFocusStanzaId(stanzasInScope[0].id);
    }
  }, [mode, stanzasInScope, focusStanzaId]);

  useEffect(() => {
    if (mode === 'tag') {
      setEditedStanzaIds(stanzasInScope.filter((s) => s.mode === activeModeId).map((s) => s.id));
    } else if (mode === 'cluster') {
      const active = clustersInScope.find((c) => c.id === activeClusterId);
      setEditedStanzaIds(active ? active.members_in_scope : []);
    } else if (mode === 'single') {
      setEditedStanzaIds(focusStanzaId ? [focusStanzaId] : []);
    } else {
      setEditedStanzaIds(stanzasInScope.map((s) => s.id));
    }
  }, [mode, activeModeId, activeClusterId, focusStanzaId, stanzasInScope, clustersInScope]);

  // Project stanzas into ChapterContextStrip's band vocabulary.
  const editedStanzaIdSet = useMemo(() => new Set(editedStanzaIds), [editedStanzaIds]);
  const stanzaBands = useMemo(() => stanzasInScope.map((s, i) => {
    const m = findMode(s.mode);
    const color = m?.color || 'var(--text-dim)';
    const isTarget = editedStanzaIdSet.has(s.id);
    const isFocused = mode === 'single' && focusStanzaId === s.id;
    return {
      id: s.id,
      at_ms: s.at_ms,
      end_ms: s.end_ms,
      fill: color,
      fillOpacity: isTarget ? 0.18 : 0.08,
      stroke: color,
      strokeWidth: isTarget ? 1.5 : 1,
      strokeOpacity: isTarget ? 1 : 0.45,
      focused: isFocused,
      label: `S${s.number ?? i + 1}`,
      labelBg: isTarget ? color : 'rgba(0,0,0,0.45)',
      labelColor: isTarget ? '#0e1117' : 'rgba(255,255,255,0.7)',
      title: m ? `${m.label} · click to focus` : 'Click to focus',
    };
  }), [stanzasInScope, editedStanzaIdSet, mode, focusStanzaId]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
    }}>
      {/* Row 1 — Chapters ribbon */}
      <HeaderRow>
        <RowLabel>Chapters</RowLabel>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChapterRibbon
            bands={chapters.map((c) => ({
              id: c.id,
              at_ms: c.atMs,
              end_ms: c.endMs,
              name: c.name,
              color: c.color,
              toneColor: undefined,
            }))}
            actions={actions}
            selectedId={activeChapter.id}
            onSelect={(band) => setActiveChapterId(band.id)}
            showAxes={false}
            zoomable={false}
            height={36}
          />
        </div>
      </HeaderRow>

      {/* Row 2 — Active chapter waveform with overlaid stanza bands */}
      <ChapterContextStrip
        chapter={{ at_ms: activeChapter.atMs, end_ms: activeChapter.endMs }}
        actions={actions}
        bands={stanzaBands}
        onSelectBand={(sid) => { setMode('single'); setFocusStanzaId(sid); }}
        expanded={isStanzaViewExpanded}
        onToggleExpanded={() => setIsStanzaViewExpanded((v) => !v)}
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChapter.color }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              {activeChapter.name || activeChapter.id}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)' }}>
              {isStanzaViewExpanded
                ? `${fmt(activeChapter.atMs)}–${fmt(activeChapter.endMs)} · ${stanzasInScope.length} stanzas`
                : `· ${stanzasInScope.length} stanzas`}
            </span>
          </div>
        }
        height={108}
      />

      {/* Body — rail + center + transform panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left rail */}
        <div style={{
          width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <Segmented value={mode} onChange={setMode} options={[
              { value: 'tag',     label: 'Mode' },
              { value: 'cluster', label: 'Cluster' },
              { value: 'single',  label: 'Single' },
            ]} />
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {mode === 'tag' && (
              <ForgegenModeRail
                modesWithCount={modesWithCount}
                activeModeId={activeModeId}
                onSelect={setActiveModeId}
              />
            )}
            {mode === 'cluster' && (
              <ClusterRail
                clusters={clustersInScope}
                activeClusterId={activeClusterId}
                onSelect={setActiveClusterId}
              />
            )}
            {mode === 'single' && (
              <StanzaRail
                stanzas={stanzasInScope}
                focusStanzaId={focusStanzaId}
                onSelect={setFocusStanzaId}
              />
            )}
          </div>
        </div>

        {/* Center — filtered StanzaTable */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '20px 24px',
          background: 'var(--bg)',
        }}>
          <StanzaTable
            stanzas={(() => {
              if (mode === 'tag') {
                return stanzasInScope.filter((s) => s.mode === activeModeId);
              }
              if (mode === 'cluster') {
                const active = clustersInScope.find((c) => c.id === activeClusterId);
                if (!active) return [];
                const ids = new Set(active.members_in_scope);
                return stanzasInScope.filter((s) => ids.has(s.id));
              }
              return focusStanzaId
                ? stanzasInScope.filter((s) => s.id === focusStanzaId)
                : [];
            })()}
            actions={actions}
            editedStanzaIds={editedStanzaIds}
            transformId={transformId}
            params={params}
            onToggleStanza={toggleEditedStanza}
            loaded={stanzasLoaded}
            allStanzasCount={allStanzas.length}
          />
        </div>

        <TransformPanel
          transforms={TRANSFORMS}
          tags={BEHAVIOR_TAGS}
          category={category}
          onCategoryChange={setCategory}
          transformId={transformId}
          onTransformChange={setTransformId}
          params={params}
          onParamsChange={setParams}
          affected={editedStanzaIds.length}
          applyLabel="Apply"
          cancelLabel="Cancel"
          onApply={() => console.log('Stanzas/apply', { stanzaIds: editedStanzaIds, transformId, params })}
          onCancel={() => { setTransformId(null); setParams({}); }}
          width={320}
        />
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function EmptyState({ title, body }) {
  return (
    <section style={{ padding: '32px 24px', maxWidth: 720 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-dim)',
      }}>
        Stanzas · empty
      </div>
      <h2 style={{ margin: '4px 0 8px', fontSize: 24, fontWeight: 700 }}>{title}</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{body}</p>
    </section>
  );
}

function HeaderRow({ children, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 22px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}

function RowLabel({ children }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      width: 64, flexShrink: 0,
    }}>{children}</span>
  );
}

function fmt(ms) {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── Rails ────────────────────────────────────────────────────────────

function RailSectionHeader({ children }) {
  return (
    <div style={{
      padding: '12px 14px 8px', fontSize: 10, fontWeight: 700,
      color: 'var(--text-dim)', textTransform: 'uppercase',
      letterSpacing: '0.08em', borderBottom: '1px solid var(--border)',
    }}>
      {children}
    </div>
  );
}

function ForgegenModeRail({ modesWithCount, activeModeId, onSelect }) {
  return (
    <>
      <RailSectionHeader>Forgegen modes</RailSectionHeader>
      {modesWithCount.map((m) => {
        const sel = m.id === activeModeId;
        const has = m.count > 0;
        return (
          <button
            key={m.id}
            onClick={() => has && onSelect(m.id)}
            disabled={!has}
            title={has ? `${m.label} — ${m.count} stanza${m.count === 1 ? '' : 's'}` : `${m.label} — none in this chapter`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '9px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? m.color : 'transparent'}`,
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: has ? 'var(--text)' : 'var(--text-dim)',
              cursor: has ? 'pointer' : 'not-allowed',
              opacity: has ? 1 : 0.45,
              textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: sel ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {m.label}
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1, lineHeight: 1.3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {m.desc}
              </div>
            </div>
            <span className="mono" style={{
              fontSize: 11, fontWeight: 600,
              color: has ? 'var(--text)' : 'var(--text-dim)',
              background: has ? 'var(--surface-2)' : 'transparent',
              padding: '2px 7px', borderRadius: 4, minWidth: 24, textAlign: 'center',
            }}>
              {m.count}
            </span>
          </button>
        );
      })}
    </>
  );
}

function ClusterRail({ clusters, activeClusterId, onSelect }) {
  if (clusters.length === 0) {
    return (
      <>
        <RailSectionHeader>Clusters</RailSectionHeader>
        <div style={{ padding: 14, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          No multi-member clusters in this chapter. Clustering groups stanzas with similar
          mode + length + density; a chapter needs at least two similar stanzas to surface one.
        </div>
      </>
    );
  }
  return (
    <>
      <RailSectionHeader>Clusters ({clusters.length})</RailSectionHeader>
      {clusters.map((c) => {
        const sel = c.id === activeClusterId;
        const m = findMode(c.mode);
        const color = m?.color || 'var(--text-dim)';
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            title={c.label}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '9px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? color : 'transparent'}`,
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: 'var(--text)',
              cursor: 'pointer',
              textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: sel ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {m?.label || c.mode || 'unknown'}
                <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
                  {' · '}~{c.length_bucket}s
                </span>
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1, lineHeight: 1.3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                textTransform: 'capitalize',
              }}>
                {c.density_bucket} density
              </div>
            </div>
            <span className="mono" style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--text)',
              background: 'var(--surface-2)',
              padding: '2px 7px', borderRadius: 4, minWidth: 24, textAlign: 'center',
            }}>
              {c.members_in_scope.length}
            </span>
          </button>
        );
      })}
    </>
  );
}

function StanzaRail({ stanzas, focusStanzaId, onSelect }) {
  if (stanzas.length === 0) {
    return (
      <>
        <RailSectionHeader>Jump to stanza</RailSectionHeader>
        <div style={{ padding: 14, fontSize: 11.5, color: 'var(--text-dim)' }}>
          No stanzas in this chapter.
        </div>
      </>
    );
  }
  return (
    <>
      <RailSectionHeader>Jump to stanza ({stanzas.length})</RailSectionHeader>
      {stanzas.map((s) => {
        const sel = s.id === focusStanzaId;
        const m = findMode(s.mode);
        const color = m?.color || 'var(--text-dim)';
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            title={m ? `${m.label} · ${fmtTimeShort(s.at_ms)}` : fmtTimeShort(s.at_ms)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? color : 'transparent'}`,
              background: sel ? 'var(--surface-2)' : 'transparent',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: sel ? 700 : 500, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                #{s.number ?? '—'}
                {m && <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> · {m.label}</span>}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                color: 'var(--text-dim)', marginTop: 1,
              }}>
                {fmtTimeShort(s.at_ms)} · {fmtDurationMs(s.end_ms - s.at_ms)}
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

// ─── Stanza table ────────────────────────────────────────────────────

function StanzaTable({
  stanzas, actions, editedStanzaIds, transformId, params, onToggleStanza,
  loaded = true, allStanzasCount = 0,
}) {
  if (!stanzas || stanzas.length === 0) {
    return (
      <>
        <SectionEyebrow>Per-stanza preview · before / after</SectionEyebrow>
        <div style={{
          padding: 32, textAlign: 'center', background: 'var(--surface)',
          border: '1px dashed var(--border)', borderRadius: 8,
          color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            {!loaded
              ? 'Reading sidecar…'
              : (allStanzasCount === 0
                ? 'No stanza analysis on this project yet'
                : 'No stanzas in this rail selection')}
          </div>
          {!loaded
            ? 'Reading <stem>.chapters.json next to the funscript.'
            : (allStanzasCount === 0
              ? 'Stanzas come from the videoflow auto-chapter pass (which classifies phrases from the audio). If you only added chapters manually, the sidecar has chapter boundaries but no phrase analysis. Run auto-chapter on the Chapters tab against the media to populate them.'
              : 'Pick another mode or stanza from the left rail.')}
        </div>
      </>
    );
  }
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <SectionEyebrow>Per-stanza preview · before / after</SectionEyebrow>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {stanzas.length} stanza{stanzas.length === 1 ? '' : 's'}
        </div>
      </div>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '120px 60px 1fr 1fr 80px',
          gap: 12, padding: '10px 14px',
          background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <span>#&nbsp;·&nbsp;Time&nbsp;·&nbsp;Length</span>
          <span style={{ textAlign: 'right' }}>Source</span>
          <span>Original</span>
          <span>Preview</span>
          <span style={{ textAlign: 'center' }}>Edit</span>
        </div>
        {stanzas.map((s) => (
          <StanzaRow
            key={s.id}
            stanza={s}
            actions={actions}
            transformId={transformId}
            params={params}
            isEdited={editedStanzaIds.includes(s.id)}
            onToggle={() => onToggleStanza(s.id)}
          />
        ))}
      </div>
    </>
  );
}

function StanzaRow({ stanza, actions, transformId, params, isEdited, onToggle }) {
  const { acts: originalActs, dur } = useMemo(
    () => sliceForStanza(actions, stanza),
    [actions, stanza],
  );
  const previewActs = useMemo(
    () => (isEdited ? previewActions(originalActs, transformId, params) : originalActs),
    [originalActs, transformId, params, isEdited],
  );

  const [view, setView] = useState({ start: 0, end: dur });
  useEffect(() => { setView({ start: 0, end: dur }); }, [dur]);

  const m = findMode(stanza.mode);
  const modeColor = m?.color || 'var(--text-dim)';
  const rowRing = isEdited ? `inset 0 0 0 2px ${modeColor}` : 'none';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 60px 1fr 1fr 80px',
        gap: 12, padding: '12px 14px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        boxShadow: rowRing,
        opacity: isEdited ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            #{stanza.number ?? '—'}
          </span>
          {m && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1px 6px', borderRadius: 99,
              background: `${m.color}22`,
              color: m.color,
              fontSize: 9.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {m.label}
            </span>
          )}
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {fmtTimeShort(stanza.at_ms)}–{fmtTimeShort(stanza.end_ms)}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          {fmtDurationMs(stanza.end_ms - stanza.at_ms)}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 10.5, textAlign: 'right', color: 'var(--text-dim)' }}>
        {stanza.source || '—'}
      </span>
      <div style={{ height: 64 }}>
        <FunscriptChart
          actions={originalActs} totalMs={dur} height={64}
          view={view} onViewChange={setView} bare
        />
      </div>
      <div style={{ height: 64 }}>
        <FunscriptChart
          actions={previewActs} totalMs={dur} height={64}
          view={view} onViewChange={setView} bare
        />
      </div>
      <button
        onClick={onToggle}
        title={isEdited ? 'Exclude from edit' : 'Include in edit'}
        aria-label={isEdited ? 'Exclude this stanza from the edit' : 'Include this stanza in the edit'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 9px', borderRadius: 5,
          background: 'transparent',
          border: `1px solid ${isEdited ? modeColor : 'var(--border)'}`,
          color: isEdited ? modeColor : 'var(--text-dim)',
          cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 10.5, fontWeight: 600,
        }}
      >
        <Icon name={isEdited ? 'check' : 'circle'} size={11} />
        {isEdited ? 'Edit' : 'Skip'}
      </button>
    </div>
  );
}

function SectionEyebrow({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{children}</div>
  );
}
