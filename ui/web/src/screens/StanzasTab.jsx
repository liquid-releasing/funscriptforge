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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChapterRibbon, ChapterContextStrip, MediaViewer, Segmented, TransformPanel,
  Icon, fmtTimeShort, fmtDurationMs,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { useChapterClip } from '../hooks/useChapterClip.js';
import { BEHAVIOR_TAGS, FORGEGEN_MODES } from '../data/transforms.js';
import { useTransformCatalog } from '../data/useTransformCatalog.js';
import { useTransformPreview } from '../api/useTransformPreview.js';
import { readStanzas, transformApplyActions, saveWorkingFunscript } from '../api/forge.js';

function sliceForStanza(actions, stanza) {
  if (!actions || !stanza) return { acts: [], dur: 0 };
  const s = stanza.at_ms;
  const e = stanza.end_ms;
  const acts = actions
    .filter((a) => a.at >= s && a.at <= e)
    .map((a) => ({ at: a.at - s, pos: a.pos }));
  return { acts, dur: Math.max(1, e - s) };
}

// Re-base backend-preview actions (ABSOLUTE time) to a stanza-local 0
// origin so they render on the same 0-based chart as the original slice.
function rebasePreview(previewAbs, stanza) {
  if (!previewAbs) return null;
  return previewAbs.map((a) => ({ at: a.at - stanza.at_ms, pos: a.pos }));
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
  // In-memory roll-forward of the working funscript. Apply patches the
  // transformed action list into App state (same path ChaptersTab's
  // "Accept tone" uses) so charts reflect the result immediately; disk
  // persistence rides the later chain-write.
  onActionsPatch = () => {},
  // Full-track audio sidecars (peaks / spectrogram / beats). Drive the
  // MediaViewer's Audio + Spectro modes — same shape ChaptersTab,
  // PhrasesTab, and PatternsTab consume.
  trackPeaks,
  trackSpectrogram,
  trackBeats,
  // Registers a per-chapter "Accept and next chapter" on the always-visible App
  // footer (mirrors Chapters/Channels/Phrases), beside the primary "Accept and
  // chain to <next>". Cleared on unmount.
  onRegisterChapterNav = () => {},
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

  // ── Pass-1 accept model: completion gate + transform Undo (mirrors
  // PhrasesTab). Chapters the user has CONSIDERED gate the footer chain;
  // the undo/redo stacks power the "oops, I just applied" fix. Reset per
  // project.
  const [consideredChapterIds, setConsideredChapterIds] = useState(() => new Set());
  useEffect(() => { setConsideredChapterIds(new Set()); }, [project?.path]);
  const markChapterConsidered = (id) => {
    if (id == null) return;
    setConsideredChapterIds((s) => (s.has(id) ? s : new Set(s).add(id)));
  };
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  useEffect(() => { setUndoStack([]); setRedoStack([]); }, [project?.path]);

  const [activeModeId, setActiveModeId] = useState(null);
  const [activeClusterId, setActiveClusterId] = useState(null);

  // Focused stanza — inline state w/ selectNonce bump. Mirrors PhrasesTab
  // so re-clicks of the same stanza re-fire the scope-reset effect (and
  // the seek lands at stanza start) instead of treating the re-click as
  // a no-op.
  const [focusStanzaId, setFocusStanzaId] = useState(null);
  const [selectNonce, setSelectNonce] = useState(0);
  // Manual multi-selection set for `single` mode — the edit set in that mode
  // (preview/apply are already multi-span). `focusStanzaId` is the ANCHOR
  // (drives the viewer + before/after chart); the whole set gets transformed.
  const [selectedStanzaIds, setSelectedStanzaIds] = useState([]);
  // Plain focus = replace selection with one (also the anchor).
  const focusStanza = (id) => {
    setFocusStanzaId(id);
    setSelectNonce((n) => n + 1);
    setSelectedStanzaIds(id == null ? [] : [id]);
  };
  // Move the anchor without collapsing the selection (ctrl / shift clicks).
  const setAnchorStanza = (id) => {
    setFocusStanzaId(id);
    setSelectNonce((n) => n + 1);
  };
  // Unified stanza click honoring modifiers (rail + strip + table route here).
  const selectStanza = (id, mods = {}) => {
    setMode('single');
    if (mods.shift && focusStanzaId != null && focusStanzaId !== id) {
      const order = stanzasInScope.map((s) => s.id);
      const a = order.indexOf(focusStanzaId);
      const b = order.indexOf(id);
      if (a === -1 || b === -1) { focusStanza(id); return; }
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const range = order.slice(lo, hi + 1);
      setSelectedStanzaIds((prev) => Array.from(new Set([...prev, ...range])));
      setAnchorStanza(id);
    } else if (mods.ctrl || mods.meta) {
      setSelectedStanzaIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
      setAnchorStanza(id);
    } else {
      focusStanza(id);
    }
  };

  const [isStanzaViewExpanded, setIsStanzaViewExpanded] = useState(true);
  useEffect(() => { setIsStanzaViewExpanded(true); }, [activeChapterId]);

  // ── Unified playback clock ───────────────────────────────────────
  // Single source of truth shared across the chapter strip (baton +
  // click-to-seek) AND the MediaViewer below. Same model as PhrasesTab
  // — chapter is the VIEW (scrolls the funscript tape, drives audio
  // scope), focused stanza is the SLICE (clamps playback transport).
  const [currentMs, setCurrentMs] = useState(() => {
    const id = chapters[0]?.id ?? null;
    const ch = chapters.find((c) => c.id === id);
    return ch?.atMs ?? 0;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaKind = project?.mediaKind || 'video';

  // TransformPanel state — same shape as Phrases/Patterns.
  const [category, setCategory] = useState('behavior');
  const [transformId, setTransformId] = useState(null);
  const [params, setParams] = useState({});
  // Authoritative transform catalog from the Python backend (param keys
  // match what apply expects — no hand-port drift). Static fallback in dev.
  const transformCatalog = useTransformCatalog();

  // Resolve activeChapter above the empty-state early returns so the
  // hooks below can be called unconditionally (Rules of Hooks). Falls
  // back to a stable {} when there's no chapter; the early returns
  // catch those cases before render uses it.
  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? chapters[0] ?? null;
  // Active chapter's index in the chapter list — used to filter stanzas
  // by `chapter_idx` (videoflow phrase records carry this field).
  const activeChapterIdx = activeChapter
    ? chapters.findIndex((c) => c.id === activeChapter.id)
    : -1;

  // Per-chapter "Accept and next chapter" footer button (beside "Accept and
  // chain to <next>"). Computed above the empty-state early returns so the
  // hooks run unconditionally (Rules of Hooks). Stanza edits already roll
  // forward via Apply, so "accept" = advance to the next chapter without
  // leaving the tab. Hidden on the last chapter (no next). The ref keeps `run`
  // fresh without re-registering every chapter change.
  const navIsLast = activeChapterIdx < 0 || activeChapterIdx >= chapters.length - 1;
  const navRunRef = useRef(() => {});
  navRunRef.current = () => {
    // Accepting a chapter marks it CONSIDERED — unlocks the footer chain.
    markChapterConsidered(activeChapter?.id);
    if (activeChapterIdx >= 0 && activeChapterIdx < chapters.length - 1) {
      setActiveChapterId(chapters[activeChapterIdx + 1].id);   // advance
    } else if (project?.path) {
      // Last chapter: nothing to advance to. Stanza edits already roll forward
      // on Apply (which saves), so "accept" re-persists the current working
      // funscript to disk and confirms — so the last chapter is never left
      // feeling un-committed when chaining to the next tab.
      setBusy?.({ message: 'Accepting last chapter changes…' });
      saveWorkingFunscript(project.path, actions)
        .catch((e) => setAppError?.(`Could not save: ${e?.message ?? e}`))
        .finally(() => setBusy?.(null));
    }
  };
  const chaptersConsideredComplete = chapters.length > 0
    && chapters.every((c) => consideredChapterIds.has(c.id));
  useEffect(() => {
    if (!onRegisterChapterNav) return undefined;
    onRegisterChapterNav(
      chapters.length > 0
        ? {
            hasNext: !navIsLast,
            label: navIsLast ? 'Accept last chapter changes' : 'Accept and next chapter',
            run: () => navRunRef.current(),
            complete: chaptersConsideredComplete,
            considered: chapters.filter((c) => consideredChapterIds.has(c.id)).length,
            total: chapters.length,
          }
        : null,
    );
    return () => onRegisterChapterNav(null);
  }, [navIsLast, chapters.length, onRegisterChapterNav, chaptersConsideredComplete, consideredChapterIds]);

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
      if (!stillExists) focusStanza(stanzasInScope[0].id);
    }
  }, [mode, stanzasInScope, focusStanzaId]);

  useEffect(() => {
    if (mode === 'tag') {
      setEditedStanzaIds(stanzasInScope.filter((s) => s.mode === activeModeId).map((s) => s.id));
    } else if (mode === 'cluster') {
      const active = clustersInScope.find((c) => c.id === activeClusterId);
      setEditedStanzaIds(active ? active.members_in_scope : []);
    } else if (mode === 'single') {
      // Manual-selection lens: edit set IS the multi-select set (falls back to
      // the anchor). Filter to in-scope ids so a chapter switch can't strand
      // a stale target.
      const scopeIds = new Set(stanzasInScope.map((s) => s.id));
      const sel = selectedStanzaIds.filter((id) => scopeIds.has(id));
      setEditedStanzaIds(sel.length ? sel : (focusStanzaId ? [focusStanzaId] : []));
    } else {
      setEditedStanzaIds(stanzasInScope.map((s) => s.id));
    }
  }, [mode, activeModeId, activeClusterId, focusStanzaId, selectedStanzaIds, stanzasInScope, clustersInScope]);

  // Project stanzas into ChapterContextStrip's band vocabulary.
  const editedStanzaIdSet = useMemo(() => new Set(editedStanzaIds), [editedStanzaIds]);

  // p98 velocity over the FULL track — shared colormap scale (mirrors
  // PhrasesTab / Chapters FunscriptChart) so a fast stanza renders the same
  // color as elsewhere instead of self-normalizing to a solid red bar.
  const velocityMax = useMemo(() => {
    if (!actions || actions.length < 2) return 0;
    const vs = [];
    for (let i = 1; i < actions.length; i++) {
      const dt = Math.max(1, actions[i].at - actions[i - 1].at);
      vs.push(Math.abs(actions[i].pos - actions[i - 1].pos) / dt);
    }
    if (!vs.length) return 0;
    vs.sort((a, b) => a - b);
    return vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.98))] || vs[vs.length - 1];
  }, [actions]);
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
      // White = "in my edit set" (orthogonal to category color), so the
      // selection stays legible even when the mode/cluster color is the wash.
      stroke: isTarget ? '#ffffff' : color,
      strokeWidth: isTarget ? 2 : 1,
      strokeOpacity: isTarget ? 1 : 0.45,
      focused: isFocused,
      label: `S${s.number ?? i + 1}`,
      labelBg: isTarget ? color : 'rgba(0,0,0,0.45)',
      labelColor: isTarget ? '#0e1117' : 'rgba(255,255,255,0.7)',
      title: m ? `${m.label} · click to focus` : 'Click to focus',
    };
  }), [stanzasInScope, editedStanzaIdSet, mode, focusStanzaId]);

  // Backend before/after preview for the edit set. previewBySpanStart is
  // keyed by stanza.at_ms (== span start_ms); rows re-base to 0.
  const previewSpans = useMemo(
    () => stanzasInScope
      .filter((s) => editedStanzaIdSet.has(s.id))
      .map((s) => ({ start_ms: s.at_ms, end_ms: s.end_ms })),
    [stanzasInScope, editedStanzaIdSet],
  );
  const { previewBySpanStart, previewLoading } = useTransformPreview({
    funscriptPath: project?.path,
    transformId,
    params,
    spans: previewSpans,
  });

  // Apply — roll the transform forward into the working funscript. Backend
  // re-runs the same merge preview shows (Python owns it → identical to a
  // later chain-write) and returns the full merged action list; we patch it
  // into App state and reset the edit selection so the panel returns to a
  // clean browsing state (the applied "after" is now the baseline). Disk
  // persistence rides the chain step. Mirrors PhrasesTab.handleApply.
  const handleApply = async () => {
    if (!project?.path || !transformId || previewSpans.length === 0) return;
    setBusy?.({ message: `Applying ${transformId} to ${previewSpans.length} stanza${previewSpans.length === 1 ? '' : 's'}…` });
    try {
      const res = await transformApplyActions(
        project.path, transformId, params, previewSpans,
      );
      if (res && Array.isArray(res.actions)) {
        // Snapshot the PRE-apply action list for Undo, then roll forward.
        setUndoStack((s) => [...s, actions]);
        setRedoStack([]);
        onActionsPatch(res.actions);
        // Write-through to the durable working funscript (survives reopen,
        // read by Export). In-memory is patched above; a save failure leaves
        // the session ahead of disk (recovers on next Apply) — surface but
        // don't roll back. Mirrors PhrasesTab.handleApply.
        await saveWorkingFunscript(project.path, res.actions);
        // KEEP the stanza selection so the user can layer another transform on
        // the SAME stanzas (mirrors PhrasesTab). Reset only the transform pick.
        setTransformId(null);
        setParams({});
      }
    } catch (e) {
      setAppError?.(`Could not apply transform: ${e?.message ?? e}`);
    } finally {
      setBusy?.(null);
    }
  };

  // Undo/Redo the applied-transform stack (mirrors PhrasesTab).
  const canUndo = undoStack.length > 0;
  const undoTransform = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, actions]);
    onActionsPatch(prev);
    if (project?.path) saveWorkingFunscript(project.path, prev).catch(() => {});
  };
  const redoTransform = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((s) => [...s, actions]);
    onActionsPatch(next);
    if (project?.path) saveWorkingFunscript(project.path, next).catch(() => {});
  };
  const acceptAllChaptersAsIs = () => {
    setConsideredChapterIds(new Set(chapters.map((c) => c.id)));
  };

  // Focused stanza derived from id + scope. Mirrors PhrasesTab.
  const focusedStanza = useMemo(
    () => (focusStanzaId != null
      ? stanzasInScope.find((s) => s.id === focusStanzaId) ?? null
      : null),
    [stanzasInScope, focusStanzaId],
  );
  const focusedIdx = focusedStanza
    ? stanzasInScope.findIndex((s) => s.id === focusedStanza.id)
    : -1;
  const prevStanza = focusedIdx > 0 ? stanzasInScope[focusedIdx - 1] : null;
  const nextStanza = (focusedIdx >= 0 && focusedIdx < stanzasInScope.length - 1)
    ? stanzasInScope[focusedIdx + 1] : null;

  // Clear focus + selection when chapter changes — same rule as PhrasesTab.
  useEffect(() => { setFocusStanzaId(null); setSelectedStanzaIds([]); }, [activeChapter?.id]);

  // Chapter clip for the MediaViewer below — same shared hook
  // ChaptersTab / PhrasesTab / PatternsTab use.
  const { clip: chapterClip } = useChapterClip(project?.mediaPath, activeChapter);
  // Full-track audio peaks — gate on a non-empty array so Audio mode
  // doesn't render an empty waveform while the sidecar is loading.
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

  // ── Scope-reset effect ───────────────────────────────────────────
  // When the active scope changes — new chapter, new focused stanza, OR
  // a re-click of the same stanza (selectNonce bump) — pause and land
  // the clock inside the new scope. Mirrors PhrasesTab.
  useEffect(() => {
    setIsPlaying(false);
    if (focusedStanza) {
      setCurrentMs((prev) => {
        if (prev >= focusedStanza.at_ms && prev < focusedStanza.end_ms) return prev;
        return focusedStanza.at_ms;
      });
      return;
    }
    if (!activeChapter) return;
    const cacheNow = project?.path ? stanzasByPath[project.path] : null;
    const stanzasNow = cacheNow?.stanzas ?? EMPTY_STANZAS;
    const first = stanzasNow.find((s) => {
      if (typeof s.chapter_idx === 'number') return s.chapter_idx === activeChapterIdx;
      return s.at_ms >= activeChapter.atMs && s.at_ms < activeChapter.endMs;
    });
    setCurrentMs((prev) => {
      if (prev >= activeChapter.atMs && prev < activeChapter.endMs) return prev;
      return first?.at_ms ?? activeChapter.atMs;
    });
  }, [activeChapter?.id, focusedStanza?.id, selectNonce, stanzasByPath, project?.path]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Empty / no-project states. Below ALL hooks so the hook count is
  // stable across renders (Rules of Hooks).
  if (!project?.path) {
    return <EmptyState title="No project open"
      body="Open a funscript from the Library tab to apply transforms." />;
  }
  if (chapters.length === 0) {
    return <EmptyState title="No chapters yet"
      body="Stanzas live inside chapters. Create chapters on the Chapters tab first, then come back." />;
  }

  // ── View / Slice scopes ─────────────────────────────────────────────
  // viewScope  — the larger context the user is navigating WITHIN
  //              (active chapter). Drives MediaViewer's funscript tape
  //              window + audio scope + corner title.
  // sliceScope — what's being edited. Drives the strip header identity
  //              AND playback clamps (transport floor, time-update loop).
  //              Stanza when focused, otherwise the active chapter.
  const chapterIdx = chapters.indexOf(activeChapter);
  const viewScope = {
    id: activeChapter.id,
    title: activeChapter.name || `Chapter ${chapterIdx + 1}`,
    color: activeChapter.toneColor || activeChapter.color || '#4dabf7',
    start: activeChapter.atMs,
    end: activeChapter.endMs,
  };
  let sliceScope = viewScope;
  let scopeKindLabel = `${stanzasInScope.length} ${stanzasInScope.length === 1 ? 'stanza' : 'stanzas'}`;
  if (focusedStanza) {
    const m = findMode(focusedStanza.mode);
    const stanzaNumber = focusedStanza.number
      ?? stanzasInScope.findIndex((s) => s.id === focusedStanza.id) + 1;
    sliceScope = {
      id: focusedStanza.id,
      title: m ? `${m.label} #${stanzaNumber}` : `Stanza #${stanzaNumber}`,
      color: m?.color || '#7aa2ff',
      // Clip to chapter bounds — same stopgap as PhrasesTab for
      // cross-chapter phrases. The phrase's editable region inside this
      // chapter ends at chapter.endMs even if its raw end_ms reaches
      // into the next chapter.
      start: Math.max(activeChapter.atMs, focusedStanza.at_ms),
      end: Math.min(activeChapter.endMs, focusedStanza.end_ms),
    };
    scopeKindLabel = focusedStanza.source || '';
  }
  const scope = sliceScope;

  // Prev gets Spotify-style "restart current slice if you're >3s into
  // it" behavior — same as PhrasesTab / ChaptersTab.
  const PREV_RESTART_THRESHOLD_MS = 3000;
  const onPrev = () => {
    const into = (currentMs || 0) - sliceScope.start;
    if (into > PREV_RESTART_THRESHOLD_MS) {
      setCurrentMs(sliceScope.start);
      return;
    }
    if (focusedStanza) {
      if (prevStanza) focusStanza(prevStanza.id);
    } else if (chapterIdx > 0) {
      setActiveChapterId(chapters[chapterIdx - 1].id);
    }
  };
  const onNext = focusedStanza
    ? (nextStanza ? () => focusStanza(nextStanza.id) : undefined)
    : (chapterIdx >= 0 && chapterIdx < chapters.length - 1
        ? () => setActiveChapterId(chapters[chapterIdx + 1].id)
        : undefined);

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
        {/* Accept-all above the chapter list — one click unlocks chaining
            (mirrors PhrasesTab). Preserves any transforms already made. */}
        <button
          onClick={acceptAllChaptersAsIs}
          disabled={chaptersConsideredComplete}
          title="Accept every chapter as-is (no transforms needed) and unlock chaining"
          style={{
            flexShrink: 0, padding: '5px 10px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
            color: chaptersConsideredComplete ? 'var(--text-dim)' : 'var(--text)',
            cursor: chaptersConsideredComplete ? 'default' : 'pointer',
            opacity: chaptersConsideredComplete ? 0.6 : 1,
            fontFamily: 'inherit', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          {chaptersConsideredComplete ? 'All chapters considered ✓' : 'Accept all as-is'}
        </button>
      </HeaderRow>

      {/* ── Title row — tab-level header: slice identity on the left,
            Collapse on the right. Mirrors PhrasesTab/PatternsTab. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--s-3)', padding: 'var(--s-2) var(--s-5) var(--s-3)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2,
              background: scope.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {scope.title}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
              {fmt(scope.start)}–{fmt(scope.end)} · {fmt(scope.end - scope.start)}
              {scopeKindLabel ? ` · ${scopeKindLabel}` : ''}
            </span>
          </div>
          {/* Stanza mode description when a stanza is focused. */}
          {focusedStanza && findMode(focusedStanza.mode)?.desc && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
              {findMode(focusedStanza.mode).desc}
            </div>
          )}
        </div>
        <button
          onClick={() => setIsStanzaViewExpanded((v) => !v)}
          title={isStanzaViewExpanded ? 'Collapse' : 'Expand'}
          aria-label={isStanzaViewExpanded ? 'Collapse' : 'Expand'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 5,
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-dim)',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
            flexShrink: 0,
          }}
        >
          <Icon name={isStanzaViewExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
          {isStanzaViewExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* ── Viewer grid (only when expanded) — funscript panel + video
            viewer wrapped in ONE bordered box so they read as a single
            unit. Mirrors PhrasesTab/PatternsTab. */}
      {isStanzaViewExpanded && (
      <div style={{ padding: '0 var(--s-5) var(--s-2)' }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        display: 'grid', gridTemplateColumns: '1fr 240px',
        gap: 'var(--s-5)', alignItems: 'stretch',
      }}>
        <ChapterContextStrip
          chapter={{ at_ms: activeChapter.atMs, end_ms: activeChapter.endMs }}
          actions={actions}
          bands={stanzaBands}
          waveform={audioWaveform}
          spectrogram={trackSpectrogram}
          beats={trackBeats}
          fill
          onSelectBand={(sid, clickedMs, mods = {}) => {
            const newStanza = stanzasInScope.find((x) => x.id === sid);
            if (!newStanza) return;
            // Ctrl/Cmd or Shift → multi-select (same as the rail).
            if (mods.ctrl || mods.meta || mods.shift) {
              selectStanza(sid, mods);
              return;
            }
            // Plain click — two-stage: 1st focuses (anchor + replace), 2nd on
            // the focused band seeks to that point.
            if (sid === focusStanzaId && clickedMs != null) {
              setCurrentMs(Math.max(newStanza.at_ms, Math.min(newStanza.end_ms, clickedMs)));
            } else {
              selectStanza(sid);
            }
          }}
          expanded={true}
          // No header / no onToggleExpanded — title + Collapse moved
          // to the tab-level title row above so the button sits above
          // the right-column viewer and stays put across collapse.
          height={180}
          velocityMax={velocityMax}
          currentMs={currentMs}
          onSeek={setCurrentMs}
        />

        <MediaViewer
          videoSrc={chapterClip?.url}
          videoSrcOffsetMs={chapterClip?.offsetMs ?? 0}
          media={{ kind: mediaKind, title: sliceScope.title }}
          // Corner slice tag — only when a single stanza is in focus.
          // Read the EXACT ribbon band label (which falls back to i+1 when
          // a stanza lacks `.number`) so the player chip can never show a
          // bare "S" while the ribbon shows "S7".
          sliceLabel={focusedStanza
            ? (stanzaBands.find((b) => b.id === focusedStanza.id)?.label ?? null)
            : null}
          loadingLabel={chapterClip ? null : 'Loading chapter clip…'}
          audioWaveform={audioWaveform}
          spectrogram={trackSpectrogram}
          beats={trackBeats}
          chapter={viewScope}
          funscript={{ actions }}
          currentMs={currentMs}
          totalMs={activeChapter.endMs}
          isPlaying={isPlaying}
          onPlayPause={() => setIsPlaying((p) => !p)}
          onSeek={(ms) => {
            // Clamp to SLICE (the editing target).
            setCurrentMs(Math.max(sliceScope.start, Math.min(sliceScope.end, ms)));
          }}
          onTimeChange={(ms) => {
            // Video-driven time updates (throttled 4Hz). Stanzas are a
            // REVIEW surface, not an edit scope — playback runs straight
            // through; NO loop-back at the slice boundary (that's chapters'
            // job). The highlighted stanza stays put as the playhead crosses
            // into the next; replay is one click on the prev transport.
            // User-decided 2026-06-01. See internal/beta_test_bugs.md #9.
            setCurrentMs(ms);
          }}
          onPrev={onPrev}
          onNext={onNext}
          controls={['chapter-start', 'back1', 'frame-back', 'play', 'frame-forward', 'forward1', 'chapter-end']}
          modeToggleAlign="start"
          modeToggleSize="sm"
          showModeLabel={false}
          showMark={false}
          width="100%"
          thumbnailAspect="16/9"
        />
      </div>
      </div>
      )}

      {/* Body — rail + center + transform panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left rail */}
        <div style={{
          width: 272, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <Segmented value={mode} onChange={setMode} options={[
              { value: 'all',     label: 'All' },
              { value: 'tag',     label: 'Mode' },
              { value: 'cluster', label: 'Cluster' },
              // "Single" → "Multiple" once 2+ stanzas are selected (Ctrl/Cmd-
              // click to add, Shift-click for a range).
              { value: 'single',  label: editedStanzaIds.length >= 2 ? 'Multiple' : 'Single' },
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
            {(mode === 'single' || mode === 'all') && (
              <StanzaRail
                stanzas={stanzasInScope}
                focusStanzaId={focusStanzaId}
                selectedIds={editedStanzaIds}
                onSelect={selectStanza}
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
              if (mode === 'all') return stanzasInScope;
              if (mode === 'tag') {
                return stanzasInScope.filter((s) => s.mode === activeModeId);
              }
              if (mode === 'cluster') {
                const active = clustersInScope.find((c) => c.id === activeClusterId);
                if (!active) return [];
                const ids = new Set(active.members_in_scope);
                return stanzasInScope.filter((s) => ids.has(s.id));
              }
              // Single/Multiple: show every selected stanza (the edit set).
              return stanzasInScope.filter((s) => editedStanzaIdSet.has(s.id));
            })()}
            actions={actions}
            editedStanzaIds={editedStanzaIds}
            previewBySpanStart={previewBySpanStart}
            previewLoading={previewLoading}
            onToggleStanza={(id) => {
              // Single/Multiple → toggle the manual selection (kept in sync
              // with Ctrl-click); other lenses toggle the derived edit set.
              if (mode === 'single') {
                setSelectedStanzaIds((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
              } else {
                toggleEditedStanza(id);
              }
            }}
            loaded={stanzasLoaded}
            allStanzasCount={allStanzas.length}
          />
        </div>

        <TransformPanel
          transforms={transformCatalog}
          tags={BEHAVIOR_TAGS}
          category={category}
          // Switching category clears the current selection (and its
          // params) so the dropdown resets to "Select a transform…" rather
          // than lingering on a transform from the old category. See
          // feedback-transform-selection-deliberate.
          onCategoryChange={(c) => { setCategory(c); setTransformId(null); setParams({}); }}
          transformId={transformId}
          onTransformChange={setTransformId}
          params={params}
          onParamsChange={setParams}
          affected={editedStanzaIds.length}
          applyLabel="Apply"
          cancelLabel="Cancel"
          onApply={handleApply}
          onCancel={() => { setTransformId(null); setParams({}); }}
          onUndo={undoTransform}
          canUndo={canUndo}
          undoLabel={undoStack.length > 0 ? `Undo (${undoStack.length})` : 'Undo'}
          undoTitle={canUndo ? `Undo the last applied transform — ${undoStack.length} stacked on this chapter` : 'Nothing to undo yet'}
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
  // Transparent background + no border — the ribbon row is part of the
  // unified "selector area" (page background). Only the chapter bands
  // inside have their own colors. Padding / gap aligned to the 8px
  // spacing grid (forgemoment tokens.css): --s-3 = 12px, --s-5 = 24px.
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
      padding: 'var(--s-3) var(--s-5)',
      background: 'transparent',
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

function StanzaRail({ stanzas, focusStanzaId, selectedIds, onSelect }) {
  const selSet = new Set(selectedIds || []);
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
      <div style={{ padding: '0 14px 6px', fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.4 }}>
        Ctrl/⌘-click to multi-select · Shift-click for a range
      </div>
      {stanzas.map((s) => {
        const isAnchor = s.id === focusStanzaId;
        const inSet = selSet.has(s.id);
        const sel = isAnchor || inSet;
        const m = findMode(s.mode);
        const color = m?.color || 'var(--text-dim)';
        return (
          <button
            key={s.id}
            onClick={(e) => onSelect(s.id, { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey })}
            title={m ? `${m.label} · ${fmtTimeShort(s.at_ms)}` : fmtTimeShort(s.at_ms)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '8px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? color : 'transparent'}`,
              background: isAnchor ? 'var(--surface-2)' : (inSet ? 'rgba(255,255,255,0.05)' : 'transparent'),
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
  stanzas, actions, editedStanzaIds, previewBySpanStart, previewLoading,
  onToggleStanza, loaded = true, allStanzasCount = 0,
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
          {previewLoading ? 'updating… · ' : ''}
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
            previewAbs={previewBySpanStart?.get(s.at_ms) ?? null}
            isEdited={editedStanzaIds.includes(s.id)}
            onToggle={() => onToggleStanza(s.id)}
          />
        ))}
      </div>
    </>
  );
}

function StanzaRow({ stanza, actions, previewAbs, isEdited, onToggle }) {
  const { acts: originalActs, dur } = useMemo(
    () => sliceForStanza(actions, stanza),
    [actions, stanza],
  );
  // Backend preview re-based to 0; falls back to original until it lands.
  const previewActs = useMemo(
    () => (isEdited ? (rebasePreview(previewAbs, stanza) ?? originalActs) : originalActs),
    [isEdited, previewAbs, stanza, originalActs],
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
          view={view} onViewChange={setView} axisOffsetMs={stanza.at_ms} bare
        />
      </div>
      <div style={{ height: 64 }}>
        <FunscriptChart
          actions={previewActs} totalMs={dur} height={64}
          view={view} onViewChange={setView} axisOffsetMs={stanza.at_ms} bare
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
