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
  ChapterRibbon, ChapterContextStrip, Segmented, TransformPanel,
  Icon, fmtTimeShort, fmtDurationMs,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
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

export default function PhrasesTab({
  project,
  setBusy,
  setAppError,
  // Session-scoped phrase cache lifted to App.jsx so the tab can unmount
  // and remount (e.g. user tabs away and back) without re-running assess.
  // Keyed by funscript path.
  phrasesByPath = {},
  setPhrasesByPath = () => {},
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

  // TransformPanel state — same shape as PatternsTab so muscle memory
  // carries between tabs. Default category is Behavior since phrases
  // are tag-driven; Patterns defaults to Structural.
  const [category, setCategory] = useState('behavior');
  const [transformId, setTransformId] = useState(null);
  const [params, setParams] = useState({});

  // Focused phrase — set by clicking a band in the chapter funscript
  // view (Row 2). Today only drives the white inset border on the band.
  // When single-mode center pane lands, this is the same id it shows.
  const [focusPhraseId, setFocusPhraseId] = useState(null);

  // Empty / no-project states
  if (!project?.path) {
    return <EmptyState title="No project open"
      body="Open a funscript from the Library tab to apply transforms." />;
  }
  if (chapters.length === 0) {
    return <EmptyState title="No chapters yet"
      body="Transforms work on phrases inside a chapter. Create chapters on the Chapters tab first, then come back." />;
  }

  const activeChapter = chapters.find((c) => c.id === activeChapterId) ?? chapters[0];

  // Phrases for the loaded funscript come from the App-level cache. Hydrated
  // lazily via `cli.py assess` (analyze_phrases Tauri command) the first
  // time the tab mounts for a given project path; subsequent remounts
  // (tab switches) reuse the cached entry, so no re-analyze.
  const cacheEntry = project?.path ? phrasesByPath[project.path] : null;
  const allPhrases = cacheEntry?.phrases ?? [];
  const phrasesLoaded = !!cacheEntry?.loaded;

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

  // Phrases filtered to the active chapter's time range. Picks phrases
  // whose start lands inside the chapter; phrases that straddle a
  // boundary belong to whichever chapter contains their start.
  const phrasesInScope = useMemo(() => {
    if (!activeChapter) return [];
    return allPhrases.filter(
      (p) => p.at_ms >= activeChapter.atMs && p.at_ms < activeChapter.endMs,
    );
  }, [allPhrases, activeChapter?.id, activeChapter?.atMs, activeChapter?.endMs]);

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

      {/* ── Row 2 — Active chapter waveform with overlaid phrase bands.
            Collapsible: header stays visible so the user always sees the
            chapter context, body folds away when they want vertical room.
            Click a band → switch to single mode and focus that phrase. */}
      <ChapterContextStrip
        chapter={{ at_ms: activeChapter.atMs, end_ms: activeChapter.endMs }}
        actions={actions}
        bands={phraseBands}
        onSelectBand={(pid) => { setMode('single'); setFocusPhraseId(pid); }}
        expanded={isPhraseViewExpanded}
        onToggleExpanded={() => setIsPhraseViewExpanded((v) => !v)}
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChapter.color }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
              {activeChapter.name || activeChapter.id}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)' }}>
              {isPhraseViewExpanded
                ? `${fmt(activeChapter.atMs)}–${fmt(activeChapter.endMs)} · ${phrasesInScope.length} phrases`
                : `· ${phrasesInScope.length} phrases`}
            </span>
          </div>
        }
        height={108}
      />

      {/* Row 3 (compact phrase chip strip) removed 2026-05-16 — redundant
          with the predominant phrase view above. Mode bar moves up. */}

      {/* "Edit by" row removed 2026-05-17 — once the mode picker moved
          into the rail header (where it actually governs) and the
          "N affected" chip moved into the TransformPanel header (where
          the action originates), the row carried only a hint that the
          rail's own segmented control already implies. */}

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
          width={320}
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

