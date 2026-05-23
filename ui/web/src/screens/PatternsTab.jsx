// PatternsTab — Chapter → Patterns → Phrases is the editing chain. This
// tab is the middle stop: pick a structural pattern type from the rail,
// see every instance of it inside the active chapter, transform one
// instance at a time.
//
// Layout:
//   Row 1: CHAPTERS ribbon (narrow chrome — same component as the
//          Transform tab, showAxes/zoomable off)
//   Row 2: Pattern context strip — header carrying the active pattern's
//          label + count + description + suggested transform, and below
//          it the full chapter's velocity-colored waveform with every
//          pattern instance overlaid as a tinted band. Selected pattern's
//          instances are at high opacity; other patterns dimmed. Click a
//          band to switch which pattern is active.
//   Body:  rail (pattern types w/ instance counts) | center (per-
//          instance BEFORE/AFTER table; real FunscriptCharts with
//          velocity colormap, viewports synced per row) | TransformPanel
//          (categories hidden — we're already scoped to structural
//          transforms on this tab)
//
// Pattern detection is a stub for now. Real classifier ships via
// `cli.py classify-patterns` → `videoflow.patterns.classify_patterns_from_funscript`
// (analog of the chapters bridge). Pending list item:
// project-funscriptforge-pending → "Real backend: cli.py classify-patterns".
//
// Transform application is JS-side preview only. Accept will eventually
// shell out to `python cli.py transform`/`pattern-transform` for the
// canonical mutation — same JS-preview / CLI-canonical pattern as the
// Device tab sliders and Chapters tab tone CLI.

import { useEffect, useMemo, useState } from 'react';
import {
  ChapterRibbon, ChapterContextStrip, MediaViewer, TransformPanel,
  Icon, fmtTimeShort, fmtDurationMs,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { useChapterClip } from '../hooks/useChapterClip.js';
import { TRANSFORMS, BEHAVIOR_TAGS } from '../data/transforms.js';
import { loadPhrasesSidecar } from '../api/forge.js';

// ─── Catalogs (local stubs until backend ships) ───────────────────────
//
// PATTERN_TYPES — the 8 canonical structural patterns the videoflow
// classifier will eventually surface. Source of truth will be
// `videoflow.patterns` once the module lands; for now these IDs are
// internal-only and match the prototype `tab-Edit.jsx` mock-ups.
//
// Colors: 8 distinguishable hues tuned for dark bg. Deliberately
// disjoint from the Chapters tab tone palette so the two ribbons read
// as different contexts (chapters vs patterns) at a glance.
const PATTERN_TYPES = [
  { id: 'steady', label: 'Steady', color: '#a78bfa',
    desc: 'Regular up-down strokes, even spacing.',
    suggestedTransformId: 'passthrough' },
  { id: 'pulse',  label: 'Pulse',  color: '#22d3ee',
    desc: 'Repeating pulses with rest between.',
    suggestedTransformId: 'boost_contrast' },
  { id: 'three_one', label: '3+1', color: '#facc15',
    desc: 'Three full strokes followed by a hold.',
    suggestedTransformId: 'three_one_pulse' },
  { id: 'tide',   label: 'Tide',   color: '#2dd4bf',
    desc: 'Fast strokes riding on a slow oscillation.',
    suggestedTransformId: 'tide' },
  { id: 'drift',  label: 'Drift',  color: '#94a3b8',
    desc: 'Motion happening in the wrong zone — centre of gravity is displaced. Needs recentering.',
    suggestedTransformId: 'recenter' },
  { id: 'burst',  label: 'Burst',  color: '#fb923c',
    desc: 'Short bursts of high-BPM motion.',
    suggestedTransformId: 'halve_tempo' },
  { id: 'taper',  label: 'Taper',  color: '#f472b6',
    desc: 'Amplitude shrinks across the run.',
    suggestedTransformId: 'funnel' },
  { id: 'swell',  label: 'Swell',  color: '#4ade80',
    desc: 'Amplitude grows across the run.',
    suggestedTransformId: 'funnel' },
];

const findPattern = (id) => PATTERN_TYPES.find((p) => p.id === id) ?? PATTERN_TYPES[0];

// Transforms + tags catalogs come from the shared data module so the
// Phrases tab can use the same source. See [data/transforms.js].
//
// Patterns we *see* (left rail PATTERN_TYPES above) vs patterns we
// *change to* (right panel structural transforms — stroke/drift/tide/
// waiting/halve_tempo/nudge) are two different namespaces with some
// overlapping names. The classifier *detects* a Drift pattern; the
// Drift *transform* synthesises a Drift-shaped replacement. Same word,
// different direction.

// ─── Phrase-as-instance loader ────────────────────────────────────────
// Real data path: phrases come from `.<stem>.forge/<stem>.phrases.json`
// (written by `cli.py assess`). Each phrase is a slice with a structural
// `label` that matches one of PATTERN_TYPES' ids — no mapping needed,
// the shape labeler produces those strings verbatim.
//
// chapter_id is null on disk today (funscript-only analysis doesn't see
// chapter boundaries), so chapter assignment happens client-side via
// at_ms ∈ chapter window. Phrases that straddle a chapter boundary are
// assigned to whichever chapter contains their start.
function phrasesForChapter(phrases, chapter) {
  if (!chapter || !Array.isArray(phrases) || phrases.length === 0) return [];
  return phrases
    .filter((p) => p.at_ms >= chapter.at_ms && p.at_ms < chapter.end_ms)
    .map((p) => ({
      id: p.id,
      chapterId: chapter.id,
      patternId: p.label || 'steady',
      at_ms: p.at_ms,
      end_ms: p.end_ms,
      bpm: Math.round(p?.metrics?.bpm ?? 0),
    }));
}

// ─── Transform preview (JS-side, illustrative) ────────────────────────
// Mirrors the Device tab's JS-preview / CLI-canonical pattern: real
// transforms ship via `python cli.py transform`; this is just enough to
// see a velocity-profile change while iterating on the UI.
function previewActions(actions, transformId, params) {
  if (!actions || actions.length === 0) return actions;
  if (transformId === 'amplitude_scale') {
    const s = Number(params?.scale ?? 1);
    return actions.map((a) => ({
      at: a.at,
      pos: clamp01_100(50 + (a.pos - 50) * s),
    }));
  }
  if (transformId === 'recenter') {
    const off = Number(params?.offset ?? 0);
    return actions.map((a) => ({ at: a.at, pos: clamp01_100(a.pos + off) }));
  }
  if (transformId === 'velocity_smooth') {
    const w = Math.max(1, Math.floor(Number(params?.window ?? 3)));
    if (w === 1) return actions;
    const half = Math.floor(w / 2);
    return actions.map((_, i) => {
      let sum = 0; let n = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(actions.length - 1, i + half); j++) {
        sum += actions[j].pos; n++;
      }
      return { at: actions[i].at, pos: clamp01_100(sum / Math.max(1, n)) };
    });
  }
  return actions;
}

function clamp01_100(v) { return Math.max(0, Math.min(100, v)); }

// Slice the full action set into a single pattern instance and shift
// timestamps so the slice starts at 0 (FunscriptChart's totalMs is the
// span of the slice, not the project — keeps each row self-contained).
function sliceForInstance(actions, instance) {
  if (!actions || !instance) return { acts: [], dur: 0 };
  const s = instance.at_ms;
  const e = instance.end_ms;
  const acts = actions
    .filter((a) => a.at >= s && a.at <= e)
    .map((a) => ({ at: a.at - s, pos: a.pos }));
  return { acts, dur: Math.max(1, e - s) };
}

// ─── Main ─────────────────────────────────────────────────────────────
export default function PatternsTab({ project, trackPeaks, trackSpectrogram, trackBeats }) {
  // Normalize chapter shape: ChaptersTab uses camelCase atMs/endMs, but
  // ChapterRibbon expects snake_case at_ms/end_ms. Same translation
  // ChaptersTab does — keep them in sync.
  const chapters = useMemo(() => {
    // `project.chapters` is a count on the loaded project — the list is
    // `chapterList`. Don't fall through to the count or `.map` blows up.
    const raw = Array.isArray(project?.chapterList) ? project.chapterList : [];
    return raw.map((c) => ({
      id: c.id,
      name: c.name || c.title || c.id,
      at_ms: c.atMs ?? c.at_ms ?? c.start ?? 0,
      end_ms: c.endMs ?? c.end_ms ?? c.end ?? 0,
      toneColor: c.toneColor || c.color || null,
    }));
  }, [project]);

  const [activeChapterId, setActiveChapterId] = useState(null);
  const activeChapter = chapters.find((c) => c.id === activeChapterId) || chapters[0];

  // Load the phrase slice sidecar that `cli.py assess` writes into
  // `.<stem>.forge/<stem>.phrases.json`. Three states:
  //   null      — fetch hasn't completed yet (initial mount)
  //   []        — fetch completed but no sidecar / no phrases. Drives
  //               the "Run analysis" CTA.
  //   [...]     — phrases loaded; each carries the structural shape
  //               label produced by assessment/shape_labeler.py.
  // PhrasesTab is the canonical place to *trigger* analysis; the
  // sidecar is a write-through side effect of that. PatternsTab only
  // reads — running analyze from two places would be confusing and
  // double the wall-clock on first open.
  const [allPhrases, setAllPhrases] = useState(null);
  useEffect(() => {
    if (!project?.path) {
      setAllPhrases([]);
      return undefined;
    }
    let cancelled = false;
    loadPhrasesSidecar(project.path)
      .then((data) => {
        if (cancelled) return;
        const slices = Array.isArray(data?.slices) ? data.slices : [];
        setAllPhrases(slices);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('loadPhrasesSidecar failed', err);
        setAllPhrases([]);
      });
    return () => { cancelled = true; };
  }, [project?.path]);

  const instances = useMemo(
    () => phrasesForChapter(allPhrases ?? [], activeChapter),
    [allPhrases, activeChapter?.id, activeChapter?.at_ms, activeChapter?.end_ms],
  );

  // Counts per pattern type — drives left-rail badges + filters the
  // table to the rail's selected pattern.
  const countsByPattern = useMemo(() => {
    const acc = {};
    for (const inst of instances) {
      acc[inst.patternId] = (acc[inst.patternId] || 0) + 1;
    }
    return acc;
  }, [instances]);

  // Default the rail selection to the first pattern type that actually
  // has instances in this chapter. If none, fall back to 'steady'.
  const firstPresent = PATTERN_TYPES.find((p) => countsByPattern[p.id] > 0)?.id ?? 'steady';
  const [activePatternId, setActivePatternId] = useState(firstPresent);
  useEffect(() => { setActivePatternId(firstPresent); }, [firstPresent]);

  const activeInstances = useMemo(
    () => instances.filter((i) => i.patternId === activePatternId),
    [instances, activePatternId],
  );

  // Project instances onto ChapterContextStrip's band visual vocabulary.
  // Selected pattern's instances: no wash + thick color border so the
  // velocity waveform shows full contrast (matches the ChapterRibbon
  // selected-band treatment). Non-selected: 0.35 wash + thin 2px border
  // with alpha so pattern identity reads as faint context.
  const patternBands = useMemo(() => instances.map((inst) => {
    const pattern = findPattern(inst.patternId);
    const isSelected = inst.patternId === activePatternId;
    return {
      id: inst.id,
      at_ms: inst.at_ms,
      end_ms: inst.end_ms,
      fill: pattern.color,
      fillOpacity: isSelected ? 0 : 0.35,
      stroke: isSelected ? pattern.color : `${pattern.color}55`,
      strokeWidth: isSelected ? 4 : 2,
      title: `${pattern.label} · click to focus`,
    };
  }), [instances, activePatternId]);

  // Which instances are being edited. Multi-select — default is "edit
  // all instances of the active pattern." User toggles individual rows
  // off via the per-row Edit button when they want to exclude an
  // instance. Reset to the full set whenever the chapter or active
  // pattern changes (new context → fresh selection).
  const [editedInstanceIds, setEditedInstanceIds] = useState([]);
  useEffect(() => {
    setEditedInstanceIds(activeInstances.map((i) => i.id));
  }, [activeChapter?.id, activePatternId]);
  const toggleEditedInstance = (id) => {
    setEditedInstanceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Focused phrase — inline state. selectNonce bumps on every focus()
  // call (even re-click) so the scope-reset effect re-seeks on
  // re-click instead of treating it as a no-op. Clears on chapter
  // change.
  const [focusedPhraseId, setFocusedPhraseId] = useState(null);
  const [selectNonce, setSelectNonce] = useState(0);
  const focusPhrase = (id) => {
    setFocusedPhraseId(id);
    setSelectNonce((n) => n + 1);
  };
  useEffect(() => { setFocusedPhraseId(null); }, [activeChapter?.id]);
  const focusedPhrase = useMemo(
    () => (focusedPhraseId != null
      ? activeInstances.find((i) => i.id === focusedPhraseId) ?? null
      : null),
    [activeInstances, focusedPhraseId],
  );
  const focusedIdx = focusedPhrase ? activeInstances.findIndex((i) => i.id === focusedPhrase.id) : -1;
  const prevPhrase = focusedIdx > 0 ? activeInstances[focusedIdx - 1] : null;
  const nextPhrase = (focusedIdx >= 0 && focusedIdx < activeInstances.length - 1)
    ? activeInstances[focusedIdx + 1] : null;

  // Unified playback clock — shared across the strip baton and the
  // MediaViewer below. Chapter is just a slice; we drive the viewer the
  // same way ChaptersTab does. Pre-refactor the viewer (SliceMediaPanel)
  // owned a second internal clock, which caused PhrasesTab regressions
  // (baton gone, re-click no-seek, back-5s dead, scroll broken) — fixed
  // by collapsing to one clock here.
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const { clip: chapterClip } = useChapterClip(project?.mediaPath, activeChapter);

  // Scope-reset: when chapter or focus changes, or the same phrase is
  // re-clicked (selectNonce bump), land the clock at the new scope's
  // start and pause.
  useEffect(() => {
    setIsPlaying(false);
    if (focusedPhrase) {
      setCurrentMs(focusedPhrase.at_ms);
    } else if (activeChapter) {
      setCurrentMs(activeChapter.at_ms);
    }
  }, [activeChapter?.id, focusedPhrase?.id, selectNonce]);

  // Full-track audio peaks piped to MediaViewer — gate on a non-empty
  // peaks array so the viewer doesn't render a blank Audio mode while
  // the sidecar is loading.
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

  // TransformPanel state. Categories are now visible (Tone / Behavior /
  // Structural) — the user can pick any transform across the catalog,
  // not just structural ones. Pattern instances most commonly want
  // structural replacements (stroke/drift/tide/etc.) so we default to
  // that category and the canonical 'stroke' transform.
  const [category, setCategory] = useState('structural');
  const [transformId, setTransformId] = useState('stroke');
  const initialParams = () => {
    const t = TRANSFORMS.find((x) => x.id === 'stroke');
    const out = {}; for (const p of t.params) out[p.id] = p.default; return out;
  };
  const [params, setParams] = useState(initialParams);

  const handleTransformChange = (id) => {
    setTransformId(id);
    const t = TRANSFORMS.find((x) => x.id === id);
    if (!t) return;
    setCategory(t.category);
    const out = {}; for (const p of t.params) out[p.id] = p.default;
    setParams(out);
  };

  const handleCancel = () => {
    // Reset params to the current transform's defaults. Keeps the
    // dropdown selection so the user doesn't lose context.
    const t = TRANSFORMS.find((x) => x.id === transformId);
    if (!t) return;
    const out = {}; for (const p of t.params) out[p.id] = p.default;
    setParams(out);
  };

  const handleApply = () => {
    // TODO: shell out to `cli.py transform --instances <ids> ...`
    // For now this logs — the JS preview already shows the effect.
    console.log('Patterns/apply', {
      instanceIds: editedInstanceIds,
      transformId,
      params,
    });
  };

  // Collapse toggle for the selection area (CHAPTERS row + pattern context
  // strip). Default expanded; collapse to give the body more vertical room
  // when the user is deep in transform editing. Collapsed state renders a
  // single thin pill carrying "what's selected" + an expand chevron.
  const [isContextExpanded, setIsContextExpanded] = useState(true);
  // Re-expand whenever the user moves to a different chapter — changing
  // chapter is a "starting fresh" moment, so the user wants to see the
  // pattern context for the new chapter without manually re-expanding.
  useEffect(() => { setIsContextExpanded(true); }, [activeChapterId]);

  // ─── Empty states ──────────────────────────────────────────────────
  if (!project) {
    return (
      <section style={{ flex: 1, display: 'grid', placeItems: 'center',
                        padding: 40, color: 'var(--text-dim)' }}>
        Open a funscript from the Library tab to begin.
      </section>
    );
  }
  if (chapters.length === 0) {
    return (
      <section style={{ flex: 1, display: 'grid', placeItems: 'center',
                        padding: 40, color: 'var(--text-dim)' }}>
        This project has no chapters yet. Visit the Chapters tab to add some.
      </section>
    );
  }
  // Phrases sidecar not yet read — quiet placeholder. Distinct from the
  // empty-after-load state below; null means the fetch hasn't returned,
  // [] means it returned with nothing to show.
  if (allPhrases === null) {
    return (
      <section style={{ flex: 1, display: 'grid', placeItems: 'center',
                        padding: 40, color: 'var(--text-dim)' }}>
        Loading phrase analysis…
      </section>
    );
  }
  // No phrases on disk — assess hasn't run yet for this project. Route
  // the user to the Phrases tab where the analyze pipeline lives; that
  // run writes the slice sidecar as a side effect, so the next time
  // they switch back here the data appears with no extra step.
  if (allPhrases.length === 0) {
    return (
      <section style={{ flex: 1, display: 'grid', placeItems: 'center',
                        padding: 40, color: 'var(--text-dim)', textAlign: 'center' }}>
        <div style={{ maxWidth: 420, lineHeight: 1.5 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            No phrase analysis yet
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            Open the <strong>Phrases</strong> tab and run analysis. Patterns
            will populate here automatically once the assess pass writes the
            phrase sidecar.
          </div>
        </div>
      </section>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {/* Row 1 — CHAPTERS ribbon. Transparent background; part of the
          unified "selector area" (page bg). Padding / gap on the 8px
          grid: --s-3 (12px) vertical, --s-5 (24px) horizontal. */}
      <div style={{ padding: 'var(--s-3) var(--s-5)', background: 'transparent',
                    display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
                       textTransform: 'uppercase', letterSpacing: '0.08em',
                       width: 64, flexShrink: 0 }}>Chapters</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChapterRibbon
            bands={chapters}
            actions={project?.actions || []}
            selectedId={activeChapter?.id}
            onSelect={(b) => setActiveChapterId(b.id)}
            showAxes={false}
            zoomable={false}
            height={36}
          />
        </div>
      </div>

      {/* Title row — full pattern block on the left (always, regardless
          of collapse), Collapse on the right. Padding on 8px grid:
          --s-2 top (8px), --s-3 bottom (12px) for roomier space to the
          viewer row below; --s-5 horizontal (24px). */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 'var(--s-3)', padding: 'var(--s-2) var(--s-5) var(--s-3)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PatternStripHeader
            pattern={findPattern(activePatternId)}
            count={activeInstances.length}
          />
          <PatternStripHeaderExtra pattern={findPattern(activePatternId)} />
        </div>
        <button
          onClick={() => setIsContextExpanded((v) => !v)}
          title={isContextExpanded ? 'Collapse' : 'Expand'}
          aria-label={isContextExpanded ? 'Collapse' : 'Expand'}
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
          <Icon name={isContextExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
          {isContextExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Viewer grid (only when expanded). Right column 320px matches
          TransformPanel below so the right edges align. Spacing on the
          8px grid: gap --s-3 (12px), horizontal --s-5 (24px). */}
      {isContextExpanded && (
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 320px',
        gap: 'var(--s-3)', padding: '0 var(--s-5) var(--s-2)', alignItems: 'start',
      }}>
        <ChapterContextStrip
          chapter={activeChapter}
          actions={project?.actions || []}
          bands={patternBands}
          onSelectBand={(bandId) => {
            const inst = instances.find((i) => i.id === bandId);
            if (inst) setActivePatternId(inst.patternId);
          }}
          expanded={true}
          // No header / no onToggleExpanded — title + Collapse moved to
          // the tab-level row above so the button sits above the right-
          // column viewer and stays put across collapse.
          height={180}
        />

        {/* MediaViewer — defaults to active-chapter scope; narrows to
            phrase scope when a row is clicked. Hidden when the strip is
            collapsed so the body gets the full height. Chapter is just a
            slice — same viewer, different bounds. */}
        {activeChapter && isContextExpanded && (() => {
        const chapterIdx = chapters.indexOf(activeChapter);
        // VIEW = chapter (the larger context we're navigating WITHIN).
        // SLICE = focused phrase, or chapter when nothing focused.
        // Funscript tape scrolls inside the view; playback clamps to
        // the slice.
        const viewScope = {
          id: activeChapter.id,
          title: activeChapter.name || `Chapter ${chapterIdx + 1}`,
          color: activeChapter.toneColor || '#4dabf7',
          start: activeChapter.at_ms,
          end: activeChapter.end_ms,
        };
        let sliceScope = viewScope;
        if (focusedPhrase) {
          const focusedPattern = findPattern(focusedPhrase.patternId);
          const focusedNumber =
            activeInstances.findIndex((i) => i.id === focusedPhrase.id) + 1;
          sliceScope = {
            id: focusedPhrase.id,
            title: `${focusedPattern.label} #${focusedNumber}`,
            color: focusedPattern.color,
            start: focusedPhrase.at_ms,
            end: focusedPhrase.end_ms,
          };
        }
        // Chapter scope: prev/next walks chapters. Phrase scope: walks
        // phrases within the active pattern's instance list.
        const onPrev = focusedPhrase
          ? (prevPhrase ? () => focusPhrase(prevPhrase.id) : undefined)
          : (chapterIdx > 0 ? () => setActiveChapterId(chapters[chapterIdx - 1].id) : undefined);
        const onNext = focusedPhrase
          ? (nextPhrase ? () => focusPhrase(nextPhrase.id) : undefined)
          : (chapterIdx >= 0 && chapterIdx < chapters.length - 1
              ? () => setActiveChapterId(chapters[chapterIdx + 1].id)
              : undefined);
        return (
          <MediaViewer
            videoSrc={chapterClip?.url}
            videoSrcOffsetMs={chapterClip?.offsetMs ?? 0}
            media={{ kind: project?.mediaKind || 'video', title: sliceScope.title }}
            loadingLabel={chapterClip ? null : 'Loading chapter clip…'}
            audioWaveform={audioWaveform}
            spectrogram={trackSpectrogram}
            beats={trackBeats}
            // View = chapter; the tape scrolls inside it.
            chapter={viewScope}
            funscript={{ actions: project?.actions || [] }}
            currentMs={currentMs}
            totalMs={activeChapter.end_ms}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            onSeek={(ms) => {
              // Clamp to slice (phrase or chapter), not view.
              setCurrentMs(Math.max(sliceScope.start, Math.min(sliceScope.end, ms)));
            }}
            onTimeChange={(ms) => {
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
        );
      })()}
      </div>
      )}

      {/* Body — rail | center table | TransformPanel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Left rail — pattern type list with counts */}
        <PatternRail
          patternTypes={PATTERN_TYPES}
          countsByPattern={countsByPattern}
          activePatternId={activePatternId}
          onSelect={setActivePatternId}
        />

        {/* Center — per-instance BEFORE/AFTER table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 18px',
                      background: 'var(--bg)' }}>
          <InstanceTable
            instances={activeInstances}
            actions={project?.actions || []}
            editedInstanceIds={editedInstanceIds}
            patternType={findPattern(activePatternId)}
            transformId={transformId}
            params={params}
            onToggleInstance={toggleEditedInstance}
            focusedPhraseId={focusedPhrase?.id ?? null}
            onFocusPhrase={focusPhrase}
          />
        </div>

        {/* Right — TransformPanel with full Tone / Behavior / Structural
            radios. Default category is Structural since pattern-instance
            work most commonly wants pattern replacements (stroke/drift/
            tide/etc.), but the user can switch to Tone or Behavior to
            apply phrase-style transforms to the instance. */}
        <TransformPanel
          transforms={TRANSFORMS}
          tags={BEHAVIOR_TAGS}
          category={category}
          onCategoryChange={setCategory}
          transformId={transformId}
          onTransformChange={handleTransformChange}
          params={params}
          onParamsChange={setParams}
          affected={editedInstanceIds.length}
          applyLabel="Apply"
          cancelLabel="Cancel"
          onApply={handleApply}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

// ─── Strip header content ────────────────────────────────────────────
//
// Three small components that feed `ChapterContextStrip`'s `header` and
// `headerExtra` slots. Split by state (expanded → pattern info, collapsed
// → chapter info) and by row position so the parent JSX reads cleanly.

function PatternStripHeader({ pattern, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{
        width: 12, height: 12, borderRadius: 3,
        background: pattern.color,
        alignSelf: 'center',
      }} />
      <strong style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
        {pattern.label}
      </strong>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        · {count} phrase{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function ChapterStripHeader({ chapter }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 12, height: 12, borderRadius: 3,
        background: chapter.toneColor || 'var(--text-dim)',
      }} />
      <strong style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        {chapter.name || chapter.id}
      </strong>
    </div>
  );
}

function PatternStripHeaderExtra({ pattern }) {
  const suggested = TRANSFORMS.find((t) => t.id === pattern.suggestedTransformId);
  return (
    <>
      <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
        {pattern.desc}
      </div>
      {suggested && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
          Suggested transform:{' '}
          <strong style={{ color: 'var(--text-muted)' }}>{suggested.label}</strong>
          {' '}— {suggested.summary}
        </div>
      )}
    </>
  );
}

// Old PatternContextStrip body lived here — replaced by
// `ChapterContextStrip` from forgemoment (2026-05-18).

// ─── Left rail ───────────────────────────────────────────────────────
function PatternRail({ patternTypes, countsByPattern, activePatternId, onSelect }) {
  return (
    <div style={{
      width: 240, flexShrink: 0, overflow: 'auto',
      background: 'var(--surface)', borderRight: '1px solid var(--border)',
    }}>
      <div style={{
        padding: '12px 14px', fontSize: 10, fontWeight: 700,
        color: 'var(--text-dim)', textTransform: 'uppercase',
        letterSpacing: '0.08em', borderBottom: '1px solid var(--border)',
      }}>
        Structural patterns
      </div>
      {patternTypes.map((p) => {
        const sel = p.id === activePatternId;
        const count = countsByPattern[p.id] || 0;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '10px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? 'var(--accent)' : 'transparent'}`,
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
              fontFamily: 'inherit',
            }}
          >
            <span style={{
              width: 12, height: 12, borderRadius: 3,
              background: p.color, flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: sel ? 700 : 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {p.label}
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)', marginTop: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {p.desc}
              </div>
            </div>
            <span className="mono" style={{
              fontSize: 11, fontWeight: 600,
              color: count > 0 ? 'var(--text)' : 'var(--text-dim)',
              background: count > 0 ? 'var(--surface-2)' : 'transparent',
              padding: '2px 7px', borderRadius: 4, minWidth: 24, textAlign: 'center',
            }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Center table ────────────────────────────────────────────────────
//
// Multi-row edit selection. Every row defaults to "being edited" — the
// transform applies to all of them at Accept time. The user toggles
// individual rows out of the edit set via the per-row Edit button. Rows
// in the edit set get a low-opacity pattern-color background tint
// (subtle but discriminable, redundantly conveyed by the toggle icon so
// it stays accessible for colorblind users); non-edited rows keep the
// default surface background and their Preview column shows the
// original (no transform applied visually).
function InstanceTable({
  instances, actions, editedInstanceIds, patternType,
  transformId, params, onToggleInstance,
  focusedPhraseId, onFocusPhrase,
}) {
  if (instances.length === 0) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', background: 'var(--surface)',
        border: '1px dashed var(--border)', borderRadius: 8,
        color: 'var(--text-dim)', fontSize: 13,
      }}>
        No instances of {patternType.label} in this chapter.
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Per-instance preview · before / after
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {instances.length} instance{instances.length === 1 ? '' : 's'}
        </div>
      </div>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {/* Header row */}
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

        {/* Body rows */}
        {instances.map((inst, idx) => (
          <InstanceRow
            key={inst.id}
            instance={inst}
            number={idx + 1}
            actions={actions}
            transformId={transformId}
            params={params}
            patternType={patternType}
            isEdited={editedInstanceIds.includes(inst.id)}
            onToggle={() => onToggleInstance(inst.id)}
            isFocused={focusedPhraseId === inst.id}
            // Always re-focus on click — even on the already-focused row.
            // The panel's reset effect uses selectNonce as a tiebreaker
            // so a re-click re-seeks to phrase start. Dismiss via the X
            // button in the panel header.
            onFocus={() => onFocusPhrase?.(inst.id)}
          />
        ))}
      </div>
    </>
  );
}

function InstanceRow({
  instance, number, actions, transformId, params,
  patternType, isEdited, onToggle,
  isFocused, onFocus,
}) {
  const patternColor = patternType.color;
  const { acts: originalActs, dur } = useMemo(
    () => sliceForInstance(actions, instance),
    [actions, instance],
  );
  // Non-edited rows: preview = original (no transform applied visually).
  // Reinforces "which rows get the change" without needing extra chrome.
  const previewActs = useMemo(
    () => (isEdited ? previewActions(originalActs, transformId, params) : originalActs),
    [originalActs, transformId, params, isEdited],
  );

  // Per-row viewport — original and preview share it so drag/zoom in
  // one mirrors the other (the controlled-viewport mode FunscriptChart
  // already supports via `view` + `onViewChange`).
  const [view, setView] = useState({ start: 0, end: dur });
  useEffect(() => { setView({ start: 0, end: dur }); }, [dur]);

  // Selection by inset border (matches ChapterRibbon's 2px-white and
  // PatternRibbon's 1.5px-white style — same visual language across the
  // ribbon and the table). Edited rows get a 2px pattern-color inset
  // ring; skipped rows get nothing (just the shared row divider). Using
  // boxShadow inset instead of `border` so the row's grid layout doesn't
  // jump when the state flips, and so it overlays the divider cleanly.
  // Focused row stacks a white outer ring on top — clear visual
  // hierarchy: focused (white) > edited (color) > skipped (none).
  let rowRing = 'none';
  if (isFocused) rowRing = `inset 0 0 0 2px #fff, inset 0 0 0 4px ${patternColor}`;
  else if (isEdited) rowRing = `inset 0 0 0 2px ${patternColor}`;

  return (
    <div
      onClick={onFocus}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 60px 1fr 1fr 80px',
        gap: 12, padding: '12px 14px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        boxShadow: rowRing,
        opacity: isEdited ? 1 : 0.55,
        cursor: onFocus ? 'pointer' : 'default',
        background: isFocused ? 'var(--surface-2)' : 'transparent',
      }}
    >
      {/* Col 1 — stacked #/pattern · time range · length. All visible
          rows share the active pattern (rail-filtered) so the chip is
          identical per row; carrying it on every row keeps the column
          self-describing and parallel to Phrases. */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            #{number}
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '1px 6px', borderRadius: 99,
            background: `${patternColor}22`,
            color: patternColor,
            fontSize: 9.5, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {patternType.label}
          </span>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {fmtTimeShort(instance.at_ms)}–{fmtTimeShort(instance.end_ms)}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          {fmtDurationMs(instance.end_ms - instance.at_ms)}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>
        {instance.bpm}
      </span>
      <div style={{ height: 64 }}>
        <FunscriptChart
          actions={originalActs}
          totalMs={dur}
          height={64}
          view={view}
          onViewChange={setView}
          bare
        />
      </div>
      <div style={{ height: 64 }}>
        <FunscriptChart
          actions={previewActs}
          totalMs={dur}
          height={64}
          view={view}
          onViewChange={setView}
          bare
        />
      </div>
      {/* Toggle: include / exclude this row from the edit set. Check
          icon when included, empty circle when not. Click toggles.
          stopPropagation so the row's onFocus doesn't also fire — the
          edit-set toggle and the focus toggle are independent gestures. */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={isEdited ? 'Exclude from edit' : 'Include in edit'}
        aria-label={isEdited ? 'Exclude this instance from the edit' : 'Include this instance in the edit'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 9px', borderRadius: 5,
          background: 'transparent',
          border: `1px solid ${isEdited ? patternColor : 'var(--border)'}`,
          color: isEdited ? patternColor : 'var(--text-dim)',
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

// Viewer wiring: each editing tab now calls MediaViewer directly with
// a scope object (chapter is just one kind of slice). The brief
// SliceMediaPanel wrapper that lived between 2026-05-22 and 2026-05-23
// was deleted once it was clear it duplicated MediaViewer's responsibility
// AND introduced a second clock that broke baton + transport in phrase
// scope. The unified-clock fix collapsed four regressions into zero.
