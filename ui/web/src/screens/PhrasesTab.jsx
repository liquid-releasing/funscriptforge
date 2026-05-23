// PhrasesTab — apply transforms to one or more phrases inside a chapter.
//
// Renamed lineage: Edit (pre-2026-05-16) → Transform (2026-05-16) → Phrases
// (2026-05-16 PM). The verb shift is "transform"; the noun shift is
// "phrases" — both pattern and phrase work apply transforms, so naming the
// tab after the *unit you're operating on* disambiguates from the Patterns
// tab one step earlier in the chain. Pattern mode is gone from the mode
// bar entirely (Patterns has its own tab now).
//
// Ports the prototype at
// [ui_design/ui_kits/funscriptforge-app/tab-Edit.jsx]. Same overall layout:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Row 1 — CHAPTERS ribbon (non-scrollable, no axes)        │
//   ├──────────────────────────────────────────────────────────┤
//   │ Row 2 — Active chapter funscript view (phrase bands +    │
//   │          action density + playhead). Phrase selector.    │
//   ├──────────────────────────────────────────────────────────┤
//   │ Row 3 — Mode bar (Behavior tag / Single phrase)          │
//   ├──────────┬──────────────────────────────────┬────────────┤
//   │ Left     │ Center (scrollable) — per-phrase │ Right —    │
//   │ rail     │ before/after preview, single     │ Transform  │
//   │ (scroll) │ phrase detail w/ Prev/Next nav   │ Panel      │
//   └──────────┴──────────────────────────────────┴────────────┘
//
// **One difference from the prototype**: Row 1 is **our `ChapterRibbon`**
// (waveform-aware, tone-tintable), not the prototype's solid-band strip.
// `showAxes={false}` keeps the row narrow chrome; `zoomable={false}` per
// user request — scroll/zoom has a separate UI home (TBD).
//
// **What's stubbed**: phrases / patterns / tags / transforms data sources.
// The prototype uses `FF_DATA.PHRASES`, `window.FF_TAGS`,
// `window.FF_TRANSFORMS`, `window.transformActions`. None of these exist
// in our Tauri app yet. Today's pass renders the layout with placeholders
// where the rich phrase data goes. Wiring up the real phrase data is the
// next conversation ("what a phrase is and where it gets built").
//
// **Scrolling**: the main panel (rail + center + transform) scrolls. The
// ribbon rows above do not.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChapterRibbon, ChapterContextStrip, MediaViewer, Segmented, TransformPanel,
  Icon, fmtTimeShort, fmtDurationMs,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { useChapterClip } from '../hooks/useChapterClip.js';
import { TRANSFORMS, BEHAVIOR_TAGS } from '../data/transforms.js';
import { analyzePhrases } from '../api/forge.js';

// Phrase helpers — duplicated from PatternsTab today. When a third
// consumer appears, lift these into `src/lib/phrase_slice.js` or
// similar. For now duplication beats premature abstraction.
function clamp01_100(v) { return Math.max(0, Math.min(100, v)); }

function sliceForPhrase(actions, phrase) {
  if (!actions || !phrase) return { acts: [], dur: 0 };
  const s = phrase.at_ms;
  const e = phrase.end_ms;
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
  // Other transforms: pass-through preview until CLI integration lands.
  return actions;
}

function findTag(id) {
  return BEHAVIOR_TAGS.find((t) => t.id === id) || null;
}

// Module-level stable empty array. Used as the fallback for the
// `allPhrases` derivation so the value is reference-stable across
// renders when the cache hasn't loaded yet — `?? []` would create a
// fresh array each render, cascading through downstream useMemo deps
// and triggering an infinite render loop via the edit-set useEffect.
// Same pattern applied in StanzasTab for the same reason.
const EMPTY_PHRASES = [];

export default function PhrasesTab({
  project,
  setBusy,
  setAppError,
  // Session-scoped phrase cache lifted to App.jsx so the tab can unmount
  // and remount (e.g. user tabs away and back) without re-running assess.
  // Keyed by funscript path.
  phrasesByPath = {},
  setPhrasesByPath = () => {},
  // Full-track audio sidecars (peaks / spectrogram / beats). Drive the
  // MediaViewer's Audio + Spectro modes — same shape ChaptersTab and
  // PatternsTab consume.
  trackPeaks,
  trackSpectrogram,
  trackBeats,
}) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? null);
  const [mode, setMode] = useState('tag');   // 'tag' | 'single'

  // Mirrors PatternsTab's edit-set model. The TransformPanel's "affected"
  // chip and the per-row Edit/Skip toggle key off this list. Default is
  // driven by the left-rail selection (active tag in tag mode, focused
  // phrase in single mode); user can still toggle individual rows off
  // via the per-row Edit/Skip button.
  const [editedPhraseIds, setEditedPhraseIds] = useState([]);
  const toggleEditedPhrase = (id) => {
    setEditedPhraseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Left-rail tag-mode selection. Drives "which phrases are in edit"
  // when mode === 'tag'. Reset to the first tag that has phrases in
  // scope whenever the chapter changes (analogous to PatternsTab's
  // firstPresent pattern-type default).
  const [activeTagId, setActiveTagId] = useState(null);

  // Collapse toggle for the phrase selection bar (Row 2 — active chapter
  // funscript view). Matches the Patterns context-strip collapse: gives
  // the user more vertical space for the rail/center/transform panel
  // when they don't need the chapter-level overview.
  const [isPhraseViewExpanded, setIsPhraseViewExpanded] = useState(true);
  // Re-expand when the user moves to a different chapter — same rule as
  // PatternsTab: a chapter change is a "starting fresh" moment, so the
  // phrase context should be visible by default for the new chapter.
  useEffect(() => { setIsPhraseViewExpanded(true); }, [activeChapterId]);

  // ── Unified playback clock ───────────────────────────────────────
  // Single source of truth shared across the chapter strip (baton +
  // click-to-seek) AND the MediaViewer below. Pre-refactor, the viewer
  // (SliceMediaPanel) owned a second internal clock — the resulting
  // two-clock split was the root cause of the four PhrasesTab
  // regressions (baton gone in funscript mode, re-click no-seek,
  // back-5s dead, funscript scroll broken). Chapter is just a slice;
  // every editing tab drives MediaViewer the same way ChaptersTab does.
  // Seed from the first chapter's start synchronously so the baton has
  // a sensible position on the first frame (before the scope-reset
  // effect below fires).
  const [currentMs, setCurrentMs] = useState(() => {
    const id = chapters[0]?.id ?? null;
    const ch = chapters.find((c) => c.id === id);
    return ch?.atMs ?? 0;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaKind = project?.mediaKind || 'video';

  // TransformPanel state — same shape as PatternsTab so muscle memory
  // carries between tabs. Default category is Behavior since phrases
  // are tag-driven; Patterns defaults to Structural.
  const [category, setCategory] = useState('behavior');
  const [transformId, setTransformId] = useState(null);
  const [params, setParams] = useState({});

  // Resolve the active chapter + phrasesInScope above the empty-state
  // early returns so the hooks below can be called unconditionally
  // (Rules of Hooks). Fall back to safe defaults when there's no
  // project / no chapters; the early returns below catch those cases
  // and short-circuit render before any of this matters.
  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? chapters[0] ?? null;
  const cacheEntry = project?.path ? phrasesByPath[project.path] : null;
  const allPhrases = cacheEntry?.phrases ?? EMPTY_PHRASES;
  const phrasesLoaded = !!cacheEntry?.loaded;
  const phrasesInScope = useMemo(() => {
    if (!activeChapter) return [];
    return allPhrases.filter(
      (p) => p.at_ms >= activeChapter.atMs && p.at_ms < activeChapter.endMs,
    );
  }, [allPhrases, activeChapter?.id, activeChapter?.atMs, activeChapter?.endMs]);

  // Focused phrase — inline state. The selectNonce counter bumps on
  // every focus call (even re-click of the same id) so the scope-reset
  // effect below re-seeks to phrase.at_ms instead of treating the
  // re-click as a no-op. Clears on parent-chapter change.
  const [focusedPhraseId, setFocusedPhraseId] = useState(null);
  const [selectNonce, setSelectNonce] = useState(0);
  const focus = (id) => {
    setFocusedPhraseId(id);
    setSelectNonce((n) => n + 1);
  };
  const clearFocusedPhrase = () => setFocusedPhraseId(null);
  useEffect(() => { setFocusedPhraseId(null); }, [activeChapter?.id]);
  const focusedPhrase = useMemo(
    () => (focusedPhraseId != null
      ? phrasesInScope.find((p) => p.id === focusedPhraseId) ?? null
      : null),
    [phrasesInScope, focusedPhraseId],
  );
  const focusedIdx = focusedPhrase ? phrasesInScope.findIndex((p) => p.id === focusedPhrase.id) : -1;
  const prevPhrase = focusedIdx > 0 ? phrasesInScope[focusedIdx - 1] : null;
  const nextPhrase = (focusedIdx >= 0 && focusedIdx < phrasesInScope.length - 1)
    ? phrasesInScope[focusedIdx + 1] : null;
  const focusPhraseId = focusedPhrase?.id ?? null;
  const setFocusPhraseId = (id) => (id == null ? clearFocusedPhrase() : focus(id));

  // Chapter clip for the MediaViewer below — same shared hook that
  // ChaptersTab and PatternsTab use. Handles ffmpeg extract + blob /
  // asset-URL fallback above the 150 MB cap.
  const { clip: chapterClip } = useChapterClip(project?.mediaPath, activeChapter);
  // Full-track audio peaks — gate on a non-empty array so Audio mode
  // doesn't render an empty waveform while the sidecar is loading.
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

  // ── Scope-reset effect ───────────────────────────────────────────
  // When the active scope changes — new chapter, new focused phrase, OR
  // a re-click of the same phrase (selectNonce bump) — pause and land
  // the clock inside the new scope. The functional setState honors any
  // currentMs that the click handler ALREADY set inside the new scope
  // (band click-to-seek path); otherwise it lands on the phrase start.
  // For chapter scope, lands on the first phrase inside the chapter
  // rather than chapter start so the user lands on their first edit
  // target. Falls back to chapter start when phrases haven't loaded.
  useEffect(() => {
    setIsPlaying(false);
    if (focusedPhrase) {
      setCurrentMs((prev) => {
        if (prev >= focusedPhrase.at_ms && prev < focusedPhrase.end_ms) return prev;
        return focusedPhrase.at_ms;
      });
      return;
    }
    if (!activeChapter) return;
    const cacheNow = project?.path ? phrasesByPath[project.path] : null;
    const phrasesNow = cacheNow?.phrases ?? EMPTY_PHRASES;
    const first = phrasesNow.find(
      (p) => p.at_ms >= activeChapter.atMs && p.at_ms < activeChapter.endMs,
    );
    setCurrentMs((prev) => {
      // Preserve currentMs when it's already inside the active chapter,
      // matching the focused-phrase logic above. Avoids snapping the
      // baton back to chapter start on every chapter re-render.
      if (prev >= activeChapter.atMs && prev < activeChapter.endMs) return prev;
      return first?.at_ms ?? activeChapter.atMs;
    });
  }, [activeChapter?.id, focusedPhrase?.id, selectNonce, phrasesByPath, project?.path]);  // eslint-disable-line react-hooks/exhaustive-deps

  const assessCancelledRef = useRef(false);
  useEffect(() => {
    if (!project?.path) return undefined;
    // Cache hit — skip assess entirely.
    if (phrasesByPath[project.path]?.loaded) return undefined;
    let cancelled = false;
    assessCancelledRef.current = false;
    setBusy?.({
      message: 'Assessing phrases…',
      onCancel: () => {
        assessCancelledRef.current = true;
        cancelled = true;
        // Mark loaded with whatever we have (likely nothing) so the
        // empty-state copy stops spinning. User can re-enter the tab to
        // retry; the cache entry counts as "loaded" only on real success
        // or explicit cancel.
        setPhrasesByPath((prev) => ({
          ...prev,
          [project.path]: { phrases: prev[project.path]?.phrases ?? [], loaded: true },
        }));
        setBusy?.(null);
      },
    });
    setAppError?.(null);
    analyzePhrases(project.path)
      .then((rows) => {
        if (cancelled) return;
        setPhrasesByPath((prev) => ({
          ...prev,
          [project.path]: { phrases: Array.isArray(rows) ? rows : [], loaded: true },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('analyzePhrases failed', err);
        setAppError?.(`Phrase assess failed: ${err?.message ?? err}`);
        // Mark loaded so the empty state shows "no phrases" instead of
        // hammering assess on every re-mount of a broken project.
        setPhrasesByPath((prev) => ({
          ...prev,
          [project.path]: { phrases: [], loaded: true },
        }));
      })
      .finally(() => {
        if (!cancelled) setBusy?.(null);
      });
    return () => { cancelled = true; };
  }, [project?.path]);

  // Tag counts inside the active chapter — drives the rail's count
  // badges and which tag is "first present" when picking a default.
  const tagsWithCount = useMemo(() => {
    const counts = {};
    for (const p of phrasesInScope) {
      if (p.tag) counts[p.tag] = (counts[p.tag] || 0) + 1;
    }
    return BEHAVIOR_TAGS.map((t) => ({ ...t, count: counts[t.id] || 0 }));
  }, [phrasesInScope]);
  const firstPresentTagId = useMemo(
    () => tagsWithCount.find((t) => t.count > 0)?.id ?? null,
    [tagsWithCount],
  );

  // Whenever the scope changes (chapter switch or phrases hydrate),
  // reset the rail selection. Tag mode → first tag with phrases.
  // Single mode → first phrase in scope. These defaults are what the
  // user lands on; they can pick anything else from the rail.
  useEffect(() => {
    setActiveTagId(firstPresentTagId);
  }, [firstPresentTagId, activeChapterId]);
  useEffect(() => {
    if (mode === 'single' && phrasesInScope.length > 0) {
      const stillExists = focusPhraseId && phrasesInScope.some((p) => p.id === focusPhraseId);
      if (!stillExists) setFocusPhraseId(phrasesInScope[0].id);
    }
  }, [mode, phrasesInScope, focusPhraseId]);

  // Derive the edit set from the rail selection. Tag mode → every
  // phrase whose tag matches the active rail tag is in edit. Single
  // mode → just the focused phrase. User can still toggle individual
  // rows out via the per-row Edit/Skip button.
  useEffect(() => {
    if (mode === 'tag') {
      setEditedPhraseIds(phrasesInScope.filter((p) => p.tag === activeTagId).map((p) => p.id));
    } else if (mode === 'single') {
      setEditedPhraseIds(focusPhraseId ? [focusPhraseId] : []);
    } else {
      setEditedPhraseIds(phrasesInScope.map((p) => p.id));
    }
  }, [mode, activeTagId, focusPhraseId, phrasesInScope]);

  // Project phrases into ChapterContextStrip's band vocabulary. Targets
  // (edit set) get a brighter tag-color wash + bold border; skipped get
  // a faint wash + dimmed border. Focused phrase (single mode) layers a
  // white inset ring on top.
  const editedPhraseIdSet = useMemo(() => new Set(editedPhraseIds), [editedPhraseIds]);
  const phraseBands = useMemo(() => phrasesInScope.map((p, i) => {
    const tag = BEHAVIOR_TAGS.find((t) => t.id === p.tag);
    const color = tag?.color || 'var(--text-dim)';
    const isTarget = editedPhraseIdSet.has(p.id);
    const isFocused = mode === 'single' && focusPhraseId === p.id;
    return {
      id: p.id,
      at_ms: p.at_ms,
      end_ms: p.end_ms,
      fill: color,
      fillOpacity: isTarget ? 0.18 : 0.08,
      stroke: color,
      strokeWidth: isTarget ? 1.5 : 1,
      strokeOpacity: isTarget ? 1 : 0.45,
      focused: isFocused,
      label: `P${p.number ?? i + 1}`,
      labelBg: isTarget ? color : 'rgba(0,0,0,0.45)',
      labelColor: isTarget ? '#0e1117' : 'rgba(255,255,255,0.7)',
      title: tag ? `${tag.label} · click to focus` : 'Click to focus',
    };
  }), [phrasesInScope, editedPhraseIdSet, mode, focusPhraseId]);

  // Empty / no-project states. Below ALL hooks so the hook count is
  // stable across renders (Rules of Hooks). When no project is open
  // the hooks above no-op cleanly thanks to the EMPTY_PHRASES stable
  // fallback + the `if (!activeChapter)` guard in the phrasesInScope
  // memo.
  if (!project?.path) {
    return <EmptyState title="No project open"
      body="Open a funscript from the Library tab to apply transforms." />;
  }
  if (chapters.length === 0) {
    return <EmptyState title="No chapters yet"
      body="Transforms work on phrases inside a chapter. Create chapters on the Chapters tab first, then come back." />;
  }

  // ── View / Slice scopes ─────────────────────────────────────────────
  // The user's framing 2026-05-23: "in every case... we are viewing a
  // slice, editing, selecting, scrolling, finding. the view is the
  // chapter. the slice is the phrase."
  //
  //   viewScope  — the larger context the user is navigating WITHIN.
  //                For PhrasesTab this is always the active chapter.
  //                Drives MediaViewer's funscript tape (scrolls within
  //                this window), audio scope, and the corner title.
  //   sliceScope — what's being edited. Drives the strip header identity
  //                AND playback clamps (back-5s floor, time-update loop).
  //                Phrase when focused, otherwise the active chapter.
  //
  // Pre-2026-05-23 PM the code passed sliceScope as MediaViewer's
  // `chapter` prop — which locked the funscript tape to the phrase span
  // so it couldn't scroll. Wrong: the tape should show the chapter, the
  // phrase is just where playback is bounded.
  const chapterIdx = chapters.indexOf(activeChapter);
  const viewScope = {
    id: activeChapter.id,
    title: activeChapter.name || `Chapter ${chapterIdx + 1}`,
    color: activeChapter.toneColor || activeChapter.color || '#4dabf7',
    start: activeChapter.atMs,
    end: activeChapter.endMs,
  };
  let sliceScope = viewScope;
  let scopeKindLabel = `${phrasesInScope.length} ${phrasesInScope.length === 1 ? 'phrase' : 'phrases'}`;
  if (focusedPhrase) {
    const tag = findTag(focusedPhrase.tag);
    // Use the phrase's own `number` field (the global numbering the
    // table + rail + bands already display) — NOT the chapter-scoped
    // findIndex+1, which produced "Drone #1" for a phrase that the
    // rest of the UI labels "Drone #3" (user-flagged 2026-05-23).
    const phraseNumber = focusedPhrase.number
      ?? phrasesInScope.findIndex((p) => p.id === focusedPhrase.id) + 1;
    // CLIP TO CHAPTER BOUNDS. Stopgap for the cross-chapter phrase
    // problem (user-flagged 2026-05-23 on Euphoria2 phrase 6, which
    // straddles ch6/ch7). The phrase's "editable region" inside this
    // chapter ends at chapter.endMs even if its raw end_ms reaches
    // into ch7. The tail surfaces in ch7 when the user switches there.
    // Source fix: videoflow detector splits phrases at chapter cuts —
    // see [[project-funscriptforge-pending]] phrase-detector item.
    sliceScope = {
      id: focusedPhrase.id,
      title: tag ? `${tag.label} #${phraseNumber}` : `Phrase #${phraseNumber}`,
      color: tag?.color || '#7aa2ff',
      start: Math.max(activeChapter.atMs, focusedPhrase.at_ms),
      end: Math.min(activeChapter.endMs, focusedPhrase.end_ms),
    };
    scopeKindLabel = focusedPhrase.bpm ? `${focusedPhrase.bpm} BPM` : '';
  }
  // Strip header uses sliceScope (it identifies what's being edited).
  // Backward-compat alias so the existing strip header JSX below
  // (`scope.color`, `scope.title`, etc.) doesn't need rewriting.
  const scope = sliceScope;
  // Prev/next handlers per scope. Chapter scope walks chapters; phrase
  // scope walks phrases within the active pattern's instance list.
  //
  // Prev gets Spotify-style "restart current slice if you're >3s into
  // it" behavior — same as ChaptersTab. Mid-slice press = restart;
  // near-the-start press = go to actual previous slice. Without this
  // every prev-press from inside a phrase jumped backward, which made
  // it impossible to restart-and-replay the current phrase.
  const PREV_RESTART_THRESHOLD_MS = 3000;
  const onPrev = () => {
    const into = (currentMs || 0) - sliceScope.start;
    if (into > PREV_RESTART_THRESHOLD_MS) {
      setCurrentMs(sliceScope.start);
      return;
    }
    if (focusedPhrase) {
      if (prevPhrase) focus(prevPhrase.id);
    } else if (chapterIdx > 0) {
      setActiveChapterId(chapters[chapterIdx - 1].id);
    }
  };
  const onNext = focusedPhrase
    ? (nextPhrase ? () => focus(nextPhrase.id) : undefined)
    : (chapterIdx >= 0 && chapterIdx < chapters.length - 1
        ? () => setActiveChapterId(chapters[chapterIdx + 1].id)
        : undefined);

  return (
    // The outermost layout: column with a fixed-height header stack on
    // top (rows 1-4) and a flex body below (rail + center + panel) that
    // is the only scrollable area.
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
    }}>
      {/* ── Row 1 — Chapters ribbon (ChapterRibbon, no axes, no zoom) ── */}
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
              // Tone tints inherit from Chapters tab decisions. Wire to a
              // shared tonesByChapter when active-chapter + tones lift to
              // App.jsx.
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

      {/* ── Title row — tab-level header: slice identity on the left,
            Collapse on the right. Padding on 8px grid: --s-2 top (8px),
            --s-3 bottom (12px) for slightly roomier space between the
            Collapse button and the viewer row below. */}
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
          {/* Phrase description from the tag, when a phrase is focused. */}
          {focusedPhrase && findTag(focusedPhrase.tag)?.desc && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
              {findTag(focusedPhrase.tag).desc}
            </div>
          )}
        </div>
        <button
          onClick={() => setIsPhraseViewExpanded((v) => !v)}
          title={isPhraseViewExpanded ? 'Collapse' : 'Expand'}
          aria-label={isPhraseViewExpanded ? 'Collapse' : 'Expand'}
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
          <Icon name={isPhraseViewExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
          {isPhraseViewExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* ── Viewer grid (only when expanded) — funscript panel + video
            viewer wrapped in ONE bordered box so they read as a single
            unit (paint mock 2026-05-23). Same box treatment as Chapters
            tab. Outer div carries the page-edge padding; the box
            (--surface + border + radius) contains the grid. */}
      {isPhraseViewExpanded && (
      <div style={{ padding: '0 var(--s-5) var(--s-2)' }}>
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        display: 'grid', gridTemplateColumns: '1fr 320px',
        gap: 'var(--s-5)', alignItems: 'start',
      }}>
        <ChapterContextStrip
          chapter={{ at_ms: activeChapter.atMs, end_ms: activeChapter.endMs }}
          actions={actions}
          bands={phraseBands}
          onSelectBand={(pid, clickedMs) => {
            // Two-stage click semantics:
            //   1st click on a band  → focus + land at phrase start
            //   2nd click on focused → seek to clicked position
            setMode('single');
            const newPhrase = phrasesInScope.find((x) => x.id === pid);
            if (!newPhrase) return;
            if (pid === focusPhraseId && clickedMs != null) {
              setCurrentMs(Math.max(newPhrase.at_ms, Math.min(newPhrase.end_ms, clickedMs)));
            } else {
              setFocusPhraseId(pid);
            }
          }}
          expanded={true}
          // No header / no onToggleExpanded — title + Collapse moved
          // to the tab-level title row above so the button sits above
          // the right-column viewer and stays put across collapse.
          height={180}
          currentMs={currentMs}
          onSeek={setCurrentMs}
        />

        {/* Right column — just the MediaViewer card. Matches the
            TransformPanel width (320px) below so the right edges
            align across rows. */}
        <MediaViewer
              videoSrc={chapterClip?.url}
              videoSrcOffsetMs={chapterClip?.offsetMs ?? 0}
              media={{ kind: mediaKind, title: sliceScope.title }}
              loadingLabel={chapterClip ? null : 'Loading chapter clip…'}
              audioWaveform={audioWaveform}
              spectrogram={trackSpectrogram}
              beats={trackBeats}
              // VIEW = chapter. Funscript tape, baton positioning, and
              // the corner title all read this as "what we're looking
              // through." Scrolling/zoom inside the tape rides on this.
              chapter={viewScope}
              funscript={{ actions }}
              currentMs={currentMs}
              totalMs={activeChapter.endMs}
              isPlaying={isPlaying}
              onPlayPause={() => setIsPlaying((p) => !p)}
              onSeek={(ms) => {
                // Clamp to SLICE (the editing target). Transport
                // buttons can't cross the slice boundary even though
                // the view is wider. MediaViewer's own floor uses
                // viewScope.start (chapter), so this tab clamp is the
                // tight one.
                setCurrentMs(Math.max(sliceScope.start, Math.min(sliceScope.end, ms)));
              }}
              onTimeChange={(ms) => {
                // Video-driven time updates (throttled 4Hz). Loop back
                // to sliceScope.start on overshoot so playback stays
                // inside the focused slice even though the chapter
                // clip extends past it.
                if (ms >= sliceScope.end) setCurrentMs(sliceScope.start);
                else if (ms < sliceScope.start) setCurrentMs(sliceScope.start);
                else setCurrentMs(ms);
              }}
              onPrev={onPrev}
              onNext={onNext}
              modeToggleAlign="start"
              modeToggleSize="sm"
              showModeLabel={false}
              showMark={false}
              width="100%"
              thumbnailAspect="16/7"
            />
      </div>
      </div>
      )}

      {/* ── Body — rail + center + transform panel. Only this row scrolls. ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left rail — header now carries the mode picker (Behavior tag /
            Single phrase). Picker governs rail organization, so it lives
            where it acts. */}
        <div style={{
          width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <Segmented value={mode} onChange={setMode} options={[
              // Pattern mode removed 2026-05-16 PM — Patterns has its own
              // tab now. What stays here is phrase-scoped: tag-bucket
              // transforms vs single-phrase detail.
              { value: 'tag',     label: 'Behavior tag' },
              { value: 'single',  label: 'Single phrase' },
            ]} />
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {mode === 'tag' ? (
              <BehaviorTagRail
                tagsWithCount={tagsWithCount}
                activeTagId={activeTagId}
                onSelect={setActiveTagId}
              />
            ) : (
              <PhraseRail
                phrases={phrasesInScope}
                focusPhraseId={focusPhraseId}
                onSelect={setFocusPhraseId}
              />
            )}
          </div>
        </div>

        {/* Center — filtered PhraseTable. Tag mode → all phrases whose
            tag matches the rail selection. Single mode → just the
            focused phrase. The strip above still shows the full chapter
            with all bands so the user keeps context regardless of
            filter. Same table chrome in both modes — the muscle memory
            stays. */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '20px 24px',
          background: 'var(--bg)',
        }}>
          <PhraseTable
            phrases={
              mode === 'tag'
                ? phrasesInScope.filter((p) => p.tag === activeTagId)
                : (focusPhraseId
                  ? phrasesInScope.filter((p) => p.id === focusPhraseId)
                  : [])
            }
            actions={actions}
            editedPhraseIds={editedPhraseIds}
            transformId={transformId}
            params={params}
            onTogglePhrase={toggleEditedPhrase}
            loaded={phrasesLoaded}
          />
        </div>

        {/* Right — TransformPanel. Real mount (was a placeholder). The
            transform catalog comes from the same TRANSFORMS source as
            the Patterns tab; param editor surfaces accordingly. The
            "N affected" chip in the panel's header reads from
            editedPhraseIds — empty today, will populate when phrase
            data is wired. */}
        <TransformPanel
          transforms={TRANSFORMS}
          tags={BEHAVIOR_TAGS}
          category={category}
          onCategoryChange={setCategory}
          transformId={transformId}
          onTransformChange={setTransformId}
          params={params}
          onParamsChange={setParams}
          affected={editedPhraseIds.length}
          applyLabel="Apply"
          cancelLabel="Cancel"
          onApply={() => console.log('Phrases/apply', { phraseIds: editedPhraseIds, transformId, params })}
          onCancel={() => { setTransformId(null); setParams({}); }}
        />
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function EmptyState({ title, body }) {
  return (
    <section style={{ padding: '32px 24px', maxWidth: 720 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-dim)',
      }}>
        Transform · empty
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

// ─── Rails — left panel selectors ─────────────────────────────────────
//
// Two flavors driven by the rail header's mode picker.
// Tag mode: list of behavior tags with phrase counts in the active
// chapter. Picking a tag puts its phrases into the edit set and
// filters the center table to those phrases.
// Single mode: list of phrases in the active chapter, numbered. Picking
// a phrase focuses it (white inset on the strip band, single row in
// the center table, full edit-set is that one phrase).
//
// Both rails follow the same row chrome as PatternsTab's PatternRail
// — left accent stripe in the active color, swatch dot, two-line text,
// (tag rail) count badge.

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

function BehaviorTagRail({ tagsWithCount, activeTagId, onSelect }) {
  return (
    <>
      <RailSectionHeader>Behavior tags</RailSectionHeader>
      {tagsWithCount.map((t) => {
        const sel = t.id === activeTagId;
        const has = t.count > 0;
        return (
          <button
            key={t.id}
            onClick={() => has && onSelect(t.id)}
            disabled={!has}
            title={has ? `${t.label} — ${t.count} phrase${t.count === 1 ? '' : 's'}` : `${t.label} — none in this chapter`}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '9px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? t.color : 'transparent'}`,
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: has ? 'var(--text)' : 'var(--text-dim)',
              cursor: has ? 'pointer' : 'not-allowed',
              opacity: has ? 1 : 0.45,
              textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: sel ? 700 : 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {t.label}
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1, lineHeight: 1.3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {t.desc}
              </div>
            </div>
            <span className="mono" style={{
              fontSize: 11, fontWeight: 600,
              color: has ? 'var(--text)' : 'var(--text-dim)',
              background: has ? 'var(--surface-2)' : 'transparent',
              padding: '2px 7px', borderRadius: 4, minWidth: 24, textAlign: 'center',
            }}>
              {t.count}
            </span>
          </button>
        );
      })}
    </>
  );
}

function PhraseRail({ phrases, focusPhraseId, onSelect }) {
  if (phrases.length === 0) {
    return (
      <>
        <RailSectionHeader>Jump to phrase</RailSectionHeader>
        <div style={{ padding: 14, fontSize: 11.5, color: 'var(--text-dim)' }}>
          No phrases in this chapter.
        </div>
      </>
    );
  }
  return (
    <>
      <RailSectionHeader>Jump to phrase ({phrases.length})</RailSectionHeader>
      {phrases.map((p) => {
        const sel = p.id === focusPhraseId;
        const tag = findTag(p.tag);
        const color = tag?.color || 'var(--text-dim)';
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            title={tag ? `${tag.label} · ${fmtTimeShort(p.at_ms)}` : fmtTimeShort(p.at_ms)}
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
                #{p.number ?? '—'}
                {tag && <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> · {tag.label}</span>}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5,
                color: 'var(--text-dim)', marginTop: 1,
              }}>
                {fmtTimeShort(p.at_ms)} · {fmtDurationMs(p.end_ms - p.at_ms)}
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}

// ─── Phrase table — center editing area ──────────────────────────────
//
// Mirrors PatternsTab's InstanceTable: per-row preview (original / after
// transform), tag-color inset border when in edit set, per-row Edit/Skip
// toggle. Columns: stacked #/time, BPM, tag pill, original chart,
// preview chart, edit toggle. Empty state when phrase data isn't wired
// yet (`cli.py assess` pending).
function PhraseTable({
  phrases, actions, editedPhraseIds, transformId, params, onTogglePhrase,
  loaded = true,
}) {
  if (!phrases || phrases.length === 0) {
    return (
      <>
        <SectionEyebrow>Per-phrase preview · before / after</SectionEyebrow>
        <div style={{
          padding: 32, textAlign: 'center', background: 'var(--surface)',
          border: '1px dashed var(--border)', borderRadius: 8,
          color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            {loaded ? 'No phrases in this chapter' : 'Assessing phrases…'}
          </div>
          {loaded
            ? 'The assessment ran but found no phrases starting inside this chapter. Try a different chapter, or re-cut the chapter boundaries on the Chapters tab.'
            : 'Running cli.py assess against the funscript. Progress is shown in the footer.'}
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
        <SectionEyebrow>Per-phrase preview · before / after</SectionEyebrow>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {phrases.length} phrase{phrases.length === 1 ? '' : 's'}
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
          <span style={{ textAlign: 'right' }}>BPM</span>
          <span>Original</span>
          <span>Preview</span>
          <span style={{ textAlign: 'center' }}>Edit</span>
        </div>
        {phrases.map((p) => (
          <PhraseRow
            key={p.id}
            phrase={p}
            actions={actions}
            transformId={transformId}
            params={params}
            isEdited={editedPhraseIds.includes(p.id)}
            onToggle={() => onTogglePhrase(p.id)}
          />
        ))}
      </div>
    </>
  );
}

function PhraseRow({ phrase, actions, transformId, params, isEdited, onToggle }) {
  const { acts: originalActs, dur } = useMemo(
    () => sliceForPhrase(actions, phrase),
    [actions, phrase],
  );
  const previewActs = useMemo(
    () => (isEdited ? previewActions(originalActs, transformId, params) : originalActs),
    [originalActs, transformId, params, isEdited],
  );

  const [view, setView] = useState({ start: 0, end: dur });
  useEffect(() => { setView({ start: 0, end: dur }); }, [dur]);

  const tag = findTag(phrase.tag);
  const tagColor = tag?.color || 'var(--text-dim)';
  // Inset-border selection in the tag color — same model as Patterns
  // (matches ChapterRibbon's 2px-white ring). Skipped rows dimmed.
  const rowRing = isEdited ? `inset 0 0 0 2px ${tagColor}` : 'none';

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
      {/* Col 1 — stacked #/tag · time range · length. Tag identity rides
          on a small inline chip next to the phrase number so the column
          carries all three pieces of info without spending a separate
          column on tag (which Patterns doesn't need either). */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            #{phrase.number ?? '—'}
          </span>
          {tag && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1px 6px', borderRadius: 99,
              background: `${tag.color}22`,
              color: tag.color,
              fontSize: 9.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>
              {tag.label}
            </span>
          )}
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {fmtTimeShort(phrase.at_ms)}–{fmtTimeShort(phrase.end_ms)}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          {fmtDurationMs(phrase.end_ms - phrase.at_ms)}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>
        {phrase.bpm ?? '—'}
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
        aria-label={isEdited ? 'Exclude this phrase from the edit' : 'Include this phrase in the edit'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 9px', borderRadius: 5,
          background: 'transparent',
          border: `1px solid ${isEdited ? tagColor : 'var(--border)'}`,
          color: isEdited ? tagColor : 'var(--text-dim)',
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

