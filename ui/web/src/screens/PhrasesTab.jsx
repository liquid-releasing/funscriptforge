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

import { useMemo, useState } from 'react';
import { ChapterRibbon, Segmented, Pill, Icon } from 'forgemoment';

export default function PhrasesTab({ project }) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const [activeChapterId, setActiveChapterId] = useState(chapters[0]?.id ?? null);
  const [mode, setMode] = useState('tag');   // 'tag' | 'single'

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

  // Phrases-in-scope — stubbed until phrase data source is decided.
  // When real data lands, this is `cli.py assess` output filtered to the
  // active chapter's time range.
  const phrasesInScope = useMemo(() => [], [activeChapter.id]);

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

      {/* ── Row 2 — Active chapter funscript view (phrase bands) ── */}
      <HeaderRow style={{ padding: '12px 22px 14px' }}>
        <div style={{ width: '100%' }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChapter.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {activeChapter.name || activeChapter.id}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)' }}>
                {fmt(activeChapter.atMs)}–{fmt(activeChapter.endMs)} · {phrasesInScope.length} phrases
              </span>
            </div>
            {/* Insert / Join chapter buttons used to live here; removed
                2026-05-16 — chapter mutations belong on the Chapters tab
                (via the per-band 3-dot menu), not duplicated in the
                Transform context. */}
          </div>

          {/* Phrase view placeholder. In the prototype, this is the
              `ChapterFunscriptView` SVG with phrase bands + action density
              + playhead. Will port that next — it's substantial code that
              depends on phrase data we don't have yet. */}
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
        </div>
      </HeaderRow>

      {/* Row 3 (compact phrase chip strip) removed 2026-05-16 — redundant
          with the predominant phrase view above. Mode bar moves up. */}

      {/* ── Row 3 — Mode bar (was Row 4) ── */}
      <HeaderRow>
        <RowLabel>Edit by</RowLabel>
        <Segmented value={mode} onChange={setMode} options={[
          // Pattern mode removed 2026-05-16 PM — Patterns has its own tab
          // now (chapter → patterns → phrases). What stays here is
          // phrase-scoped: tag-bucket transforms vs single-phrase detail.
          { value: 'tag',     label: 'Behavior tag' },
          { value: 'single',  label: 'Single phrase' },
        ]} />
        <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Pick a {mode === 'tag' ? 'tag' : 'phrase'} on the left rail, see
          the effect on the right.
        </span>
        <div style={{ flex: 1 }} />
        <Pill tone="accent">
          <Icon name="target" size={11} style={{ marginRight: 4 }} />
          0 affected · transform TBD
        </Pill>
      </HeaderRow>

      {/* ── Body — rail + center + transform panel. Only this row scrolls. ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left rail */}
        <div style={{
          width: 240, flexShrink: 0, overflow: 'auto',
          background: 'var(--surface)', borderRight: '1px solid var(--border)',
          padding: '12px 0',
        }}>
          <RailPlaceholder mode={mode} />
        </div>

        {/* Center — per-phrase preview or single-phrase detail. This is the
            main scrollable workspace ("the ones in the main panel"). */}
        <div style={{
          flex: 1, overflow: 'auto', padding: '20px 24px',
          background: 'var(--bg)',
        }}>
          <CenterPlaceholder mode={mode} />
        </div>

        {/* Right — TransformPanel. Catalog + parameter editor. Stubbed
            until we wire forge transforms into a JSON catalog the
            TransformPanel can consume. */}
        <div style={{
          width: 320, flexShrink: 0, overflow: 'auto',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          padding: '14px 16px',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10,
          }}>
            Transform
          </div>
          <div style={{
            padding: 14, background: 'var(--bg)',
            border: '1px dashed var(--border)', borderRadius: 6,
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            TransformPanel from forgemoment will mount here. It needs a
            transform catalog (FF has one in <code>pattern_catalog/</code>
            and <code>forge/funscript_tools.py</code> — surface it as JSON
            via <code>cli.py list-transforms --format json</code> or wire
            into Rust at project-load time).
          </div>
        </div>
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
