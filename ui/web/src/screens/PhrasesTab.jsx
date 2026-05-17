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
import { ChapterRibbon, Segmented, TransformPanel, Icon, fmtTimeShort } from 'forgemoment';
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

export default function PhrasesTab({ project, setBusy, setAppError }) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? null);
  const [mode, setMode] = useState('tag');   // 'tag' | 'single'

  // Mirrors PatternsTab's edit-set model. Lands at 0 today (no phrase
  // data wired yet); the TransformPanel's "affected" chip and the
  // per-row Edit/Skip toggle key off this list. Default whenever the
  // scope changes: every phrase is in the edit set ("edit all unless
  // you opt one out") — same rule Patterns uses.
  const [editedPhraseIds, setEditedPhraseIds] = useState([]);
  const toggleEditedPhrase = (id) => {
    setEditedPhraseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

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

  // All phrases for the loaded funscript. Hydrated lazily from
  // `cli.py assess` (via the analyze_phrases Tauri command) the first
  // time this tab mounts with a project that has a path. The full list
  // is held here; phrasesInScope below filters to the active chapter.
  const [allPhrases, setAllPhrases] = useState([]);
  const [phrasesLoaded, setPhrasesLoaded] = useState(false);

  const assessCancelledRef = useRef(false);
  useEffect(() => {
    if (!project?.path) {
      setAllPhrases([]);
      setPhrasesLoaded(false);
      return undefined;
    }
    let cancelled = false;
    assessCancelledRef.current = false;
    setPhrasesLoaded(false);
    setAllPhrases([]);
    setBusy?.({
      message: 'Assessing phrases…',
      onCancel: () => {
        assessCancelledRef.current = true;
        cancelled = true;
        setPhrasesLoaded(true); // Stop showing the spinner; row table renders empty state.
        setBusy?.(null);
      },
    });
    setAppError?.(null);
    analyzePhrases(project.path)
      .then((rows) => {
        if (cancelled) return;
        setAllPhrases(Array.isArray(rows) ? rows : []);
        setPhrasesLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('analyzePhrases failed', err);
        setAppError?.(`Phrase assess failed: ${err?.message ?? err}`);
        setPhrasesLoaded(true); // Avoid hammering on a broken project.
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

  // Reset edit-set when scope changes: every phrase starts "in edit",
  // user opts rows out via the per-row toggle. Same rule as Patterns.
  useEffect(() => {
    setEditedPhraseIds(phrasesInScope.map((p) => p.id));
  }, [phrasesInScope]);

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

      {/* ── Row 2 — Active chapter funscript view (phrase bands).
            Collapsible (matches Patterns context-strip behavior): the
            user can fold this row down to its header strip when they
            want more vertical space for the body. */}
      <HeaderRow style={{ padding: '12px 22px 14px' }}>
        <div style={{ width: '100%' }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: isPhraseViewExpanded ? 8 : 0,
          }}>
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
            <button
              onClick={() => setIsPhraseViewExpanded((v) => !v)}
              title={isPhraseViewExpanded ? 'Collapse phrase view' : 'Expand phrase view'}
              aria-label={isPhraseViewExpanded ? 'Collapse phrase view' : 'Expand phrase view'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 5,
                color: 'var(--text-dim)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
              }}
            >
              <Icon name={isPhraseViewExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
              {isPhraseViewExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {/* Phrase view placeholder — only rendered when expanded. In
              the prototype, this is the `ChapterFunscriptView` SVG with
              phrase bands + action density + playhead. Will port that
              next — it's substantial code that depends on phrase data
              we don't have yet. */}
          {isPhraseViewExpanded && (
            <div style={{
              height: 108,
              background: 'var(--bg)', border: '1px dashed var(--border)',
              borderRadius: 6, display: 'grid', placeItems: 'center',
              textAlign: 'center', padding: 16,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  Phrase view — coming next
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', maxWidth: 540, lineHeight: 1.5 }}>
                  Will render this chapter's phrases as colored bands with action density,
                  clickable to focus. Ported from
                  ChapterFunscriptView in <code>tab-Edit.jsx</code>.
                  Pending: phrase data source.
                </div>
              </div>
            </div>
          )}
        </div>
      </HeaderRow>

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
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
            <RailPlaceholder mode={mode} />
          </div>
        </div>

        {/* Center — per-phrase preview (tag mode) or single-phrase
            detail (single mode). The editing area: where the transform
            actually lands. Width is whatever's left after rail (240) +
            transform panel (320); the table columns shrink-stretch to
            fit. */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '20px 24px',
          background: 'var(--bg)',
        }}>
          {mode === 'tag' ? (
            <PhraseTable
              phrases={phrasesInScope}
              actions={actions}
              editedPhraseIds={editedPhraseIds}
              transformId={transformId}
              params={params}
              onTogglePhrase={toggleEditedPhrase}
              loaded={phrasesLoaded}
            />
          ) : (
            <CenterPlaceholder mode={mode} />
          )}
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

function SmallButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
        background: 'var(--surface-2)', border: '1px solid var(--border)',
        color: disabled ? 'var(--text-dim)' : 'var(--text)',
        borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function fmt(ms) {
  const s = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function RailPlaceholder({ mode }) {
  const title = mode === 'tag' ? 'Behavioral tags' : mode === 'single' ? 'Jump to phrase' : 'Structural patterns';
  return (
    <div style={{ padding: '0 14px' }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
      }}>{title}</div>
      <div style={{
        padding: 12, background: 'var(--bg)',
        border: '1px dashed var(--border)', borderRadius: 6,
        fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5,
      }}>
        Rail items appear here when phrase data is wired. Each row is
        clickable to focus that {mode === 'tag' ? 'tag' : 'phrase'}.
      </div>
    </div>
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
          gridTemplateColumns: '90px 50px 90px 1fr 1fr 80px',
          gap: 10, padding: '10px 14px',
          background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <span>#&nbsp;/&nbsp;Time</span>
          <span style={{ textAlign: 'right' }}>BPM</span>
          <span>Tag</span>
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
        gridTemplateColumns: '90px 50px 90px 1fr 1fr 80px',
        gap: 10, padding: '12px 14px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        boxShadow: rowRing,
        opacity: isEdited ? 1 : 0.55,
      }}
    >
      {/* Col 1 — stacked phrase number + time range */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
          #{phrase.number ?? '—'}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {fmtTimeShort(phrase.at_ms)}–{fmtTimeShort(phrase.end_ms)}
        </span>
      </div>
      <span className="mono" style={{ fontSize: 11.5, textAlign: 'right' }}>
        {phrase.bpm ?? '—'}
      </span>
      {tag ? (
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '3px 8px', borderRadius: 99,
          background: `${tag.color}22`,
          color: tag.color,
          fontSize: 10.5, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          width: 'fit-content',
        }}>
          {tag.label}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
      )}
      <div style={{ height: 56 }}>
        <FunscriptChart
          actions={originalActs} totalMs={dur} height={56}
          view={view} onViewChange={setView} bare
        />
      </div>
      <div style={{ height: 56 }}>
        <FunscriptChart
          actions={previewActs} totalMs={dur} height={56}
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

function CenterPlaceholder({ mode }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
      }}>
        {mode === 'single' ? 'Phrase detail · before / after' : 'Per-phrase preview'}
      </div>
      <div style={{
        padding: 32, textAlign: 'center', background: 'var(--surface)',
        border: '1px dashed var(--border)', borderRadius: 8,
        color: 'var(--text-dim)', fontSize: 13,
      }}>
        {mode === 'single'
          ? 'PreviewChart (original above, preview below) + Prev/Next phrase nav. Lands when phrase data is wired.'
          : 'Per-phrase preview table — # / Time / BPM / Original sparkline / Preview sparkline / Expand. Lands when phrase data is wired.'}
      </div>
    </div>
  );
}
