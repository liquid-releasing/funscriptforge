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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChapterRibbon, TransformPanel,
  Button, Icon, Sparkline, fmtTimeShort,
} from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { TRANSFORMS, BEHAVIOR_TAGS } from '../data/transforms.js';

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

// ─── Stub instance generator ──────────────────────────────────────────
// Deterministic-ish fake instances per chapter so the UI has data before
// the videoflow classifier ships. Generates a *distribution* — 3 of one
// pattern type, 2 of another, 1 of a third — so the rail's count column
// is non-trivial and the table demonstrates the multi-instance layout
// for at least one pattern type. Replace with the real bridge call once
// `analyzePatternsWithVideoflow` lands.
function stubInstancesForChapter(chapter, projectId) {
  if (!chapter) return [];
  const span = Math.max(1, chapter.end_ms - chapter.at_ms);
  const seed = (projectId || '').length + (chapter.id || '').length;
  // Pick 3 pattern types from the catalog; assign instance counts 3/2/1.
  const offset = seed % PATTERN_TYPES.length;
  const buckets = [
    { patternId: PATTERN_TYPES[(offset) % PATTERN_TYPES.length].id, count: 3 },
    { patternId: PATTERN_TYPES[(offset + 1) % PATTERN_TYPES.length].id, count: 2 },
    { patternId: PATTERN_TYPES[(offset + 3) % PATTERN_TYPES.length].id, count: 1 },
  ];
  const total = buckets.reduce((s, b) => s + b.count, 0);          // 6
  const dur = Math.floor(span / total * 0.85);                      // each instance ~chapter/6 wide
  const instances = [];
  let i = 0;
  for (const bucket of buckets) {
    for (let k = 0; k < bucket.count; k++) {
      const at = chapter.at_ms + Math.floor((span - dur) * (i / Math.max(1, total - 1)) * 0.95) + 200;
      const end = Math.min(chapter.end_ms - 100, at + dur);
      instances.push({
        id: `${chapter.id}_inst_${i}`,
        chapterId: chapter.id,
        patternId: bucket.patternId,
        at_ms: at,
        end_ms: end,
        bpm: 48 + ((seed + i * 17) % 80),
      });
      i++;
    }
  }
  return instances;
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
export default function PatternsTab({ project }) {
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

  // Pattern instances inside the active chapter. Stub today; real call
  // will be `analyzePatternsWithVideoflow(project.path, chapter.id)`.
  const instances = useMemo(
    () => stubInstancesForChapter(activeChapter, project?.id),
    [activeChapter?.id, project?.id],
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

  // Which instance is the transform target. Reset to the first matching
  // instance when the chapter or pattern filter changes.
  const [activeInstanceId, setActiveInstanceId] = useState(null);
  useEffect(() => {
    setActiveInstanceId(activeInstances[0]?.id ?? null);
  }, [activeChapter?.id, activePatternId]);

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
    // TODO: shell out to `cli.py transform --instance ${activeInstanceId} ...`
    // For now this logs — the JS preview already shows the effect.
    console.log('Patterns/apply', {
      instanceId: activeInstanceId,
      transformId,
      params,
    });
  };

  // Collapse toggle for the selection area (CHAPTERS row + pattern context
  // strip). Default expanded; collapse to give the body more vertical room
  // when the user is deep in transform editing. Collapsed state renders a
  // single thin pill carrying "what's selected" + an expand chevron.
  const [isContextExpanded, setIsContextExpanded] = useState(true);

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

  const activePatternType = findPattern(activePatternId);
  const activeInstanceCount = instances.filter((i) => i.patternId === activePatternId).length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {isContextExpanded ? (
        <>
          {/* Row 1 — CHAPTERS ribbon (narrow chrome, no axes, no zoom) */}
          <div style={{ padding: '8px 16px', background: 'var(--surface)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', alignItems: 'center', gap: 12 }}>
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
                height={56}
              />
            </div>
          </div>

          {/* Row 2 — Pattern context strip. Header carries the active pattern's
              identity (label + count + description + suggested transform); the
              waveform below shows the active chapter's full motion with all
              pattern instances overlaid as tinted bands. Selected pattern's
              bands at high opacity; other patterns dimmed so the user sees
              context without losing focus. Click anywhere on the strip to
              select whichever pattern lives at that time. */}
          <PatternContextStrip
            chapter={activeChapter}
            actions={project?.actions || []}
            instances={instances}
            selectedPatternId={activePatternId}
            onSelectPattern={(pid) => {
              setActivePatternId(pid);
              // Reset instance focus to the first matching instance.
              const first = instances.find((i) => i.patternId === pid);
              if (first) setActiveInstanceId(first.id);
            }}
            onCollapse={() => setIsContextExpanded(false)}
          />
        </>
      ) : (
        // Collapsed pill — replaces both Row 1 and Row 2 with a single
        // thin bar so the body has the full vertical area. Click the pill
        // anywhere to expand back. ~36px tall vs ~260px expanded.
        <CollapsedSelectionPill
          chapter={activeChapter}
          patternType={activePatternType}
          instanceCount={activeInstanceCount}
          onExpand={() => setIsContextExpanded(true)}
        />
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
            activeInstanceId={activeInstanceId}
            patternType={findPattern(activePatternId)}
            transformId={transformId}
            params={params}
            onFocusInstance={setActiveInstanceId}
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
          applyLabel="Accept"
          cancelLabel="Cancel"
          onApply={handleApply}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

// ─── Pattern context strip ───────────────────────────────────────────
//
// Replaces the older flat PATTERN_RIBBON. Two visual jobs in one row:
//
//   1. **Header text** — tells the user what they're looking at: pattern
//      label, instance count, description, suggested transform. This is
//      the "what + why" for the active pattern selection.
//
//   2. **Chapter context** — the full active chapter's funscript rendered
//      with velocity colormap, with every pattern instance overlaid as a
//      tinted band. Selected pattern's instances are at *full opacity*;
//      other patterns at reduced opacity so they fade into context. This
//      is the "where" — which slices of the chapter are this pattern.
//
// Selection is bidirectional: the left rail drives it (current behavior),
// but the user can also click anywhere on the strip to select whichever
// pattern lives at that time. Click on the waveform background between
// bands selects nothing — only band clicks change the pattern.
function PatternContextStrip({
  chapter, actions, instances, selectedPatternId, onSelectPattern,
  onCollapse,
}) {
  const wrapRef = useRef(null);
  const [pxWidth, setPxWidth] = useState(800);
  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setPxWidth(entry.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const selectedPattern = findPattern(selectedPatternId);
  const selectedTransform = TRANSFORMS.find((t) => t.id === selectedPattern.suggestedTransformId);
  const selectedInstances = instances.filter((i) => i.patternId === selectedPatternId);

  const span = Math.max(1, chapter.end_ms - chapter.at_ms);
  const xFor = (ms) => ((ms - chapter.at_ms) / span) * pxWidth;

  // Slice the funscript to the chapter range and shift to 0-relative for
  // Sparkline, which expects start/end in the same scale as the actions.
  const chapterActions = useMemo(
    () => (actions || [])
      .filter((a) => a.at >= chapter.at_ms && a.at <= chapter.end_ms)
      .map((a) => ({ at: a.at - chapter.at_ms, pos: a.pos })),
    [actions, chapter.at_ms, chapter.end_ms],
  );

  return (
    <div style={{
      padding: '12px 22px 14px', background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Header — pattern identity. Collapse chevron in top-right when
          the parent wires `onCollapse` (Patterns tab does). */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3,
            background: selectedPattern.color, alignSelf: 'center',
          }} />
          <strong style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            {selectedPattern.label}
          </strong>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            · {selectedInstances.length} phrase{selectedInstances.length === 1 ? '' : 's'}
          </span>
          <div style={{ flex: 1 }} />
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Collapse selection area"
              aria-label="Collapse selection area"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 5,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
              }}
            >
              <Icon name="chevron-up" size={12} />
              Collapse
            </button>
          )}
        </div>
        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          {selectedPattern.desc}
        </div>
        {selectedTransform && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
            Suggested transform:{' '}
            <strong style={{ color: 'var(--text-muted)' }}>{selectedTransform.label}</strong>
            {' '}— {selectedTransform.summary}
          </div>
        )}
      </div>

      {/* Waveform + overlaid pattern bands. Layering matters:
            1. dark base (the wrap div itself)
            2. pattern-color wash *behind* selected pattern's instances
               only — sits behind the waveform so the funscript bars
               appear to live on a colored field
            3. velocity-colored waveform at full contrast (no global dim)
            4. outline boxes on top for every instance — selected pattern
               gets a bold pattern-color border (similar weight to the
               chapter selection ring); other patterns get a thin low-
               alpha border so the user sees they exist as context.
          User asked to preserve the velocity contrast outside the
          selection — dimming the whole waveform washed it out. */}
      <div
        ref={wrapRef}
        style={{
          position: 'relative', height: 96,
          background: 'var(--bg)',
          border: '1px solid var(--border)', borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {/* Layer 2 — pattern-color wash behind every instance. Selected
            gets a stronger wash so it pops; other patterns get a faint
            wash so they're visible as context without competing. User
            flagged 2026-05-17 that they liked the tint on non-selected
            items — keeping it in, just at low alpha. */}
        {instances.map((inst) => {
          const left = xFor(inst.at_ms);
          const right = xFor(inst.end_ms);
          const width = Math.max(2, right - left);
          const pattern = findPattern(inst.patternId);
          const isSelected = inst.patternId === selectedPatternId;
          return (
            <div
              key={`wash-${inst.id}`}
              style={{
                position: 'absolute',
                left, top: 0, width, height: '100%',
                background: pattern.color,
                opacity: isSelected ? 0.22 : 0.07,
                pointerEvents: 'none',
              }}
            />
          );
        })}

        {/* Layer 3 — velocity waveform at full contrast */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <Sparkline
            actions={chapterActions}
            start={0}
            end={span}
            colorMode="velocity"
            height="100%"
            filled
          />
        </div>

        {/* Layer 4 — outline boxes for every instance. Click selects the
            pattern. Selected: bold pattern-color border. Others: thin
            low-alpha border (visible as context, not loud). */}
        {instances.map((inst) => {
          const left = xFor(inst.at_ms);
          const right = xFor(inst.end_ms);
          const width = Math.max(2, right - left);
          const pattern = findPattern(inst.patternId);
          const isSelected = inst.patternId === selectedPatternId;
          return (
            <button
              key={inst.id}
              onClick={(e) => { e.stopPropagation(); onSelectPattern?.(inst.patternId); }}
              title={`${pattern.label} · click to focus`}
              style={{
                position: 'absolute',
                left, top: 0, width, height: '100%',
                background: 'transparent',
                border: isSelected
                  ? `4px solid ${pattern.color}`
                  : `2px solid ${pattern.color}55`,
                borderRadius: 3,
                padding: 0, cursor: 'pointer', boxSizing: 'border-box',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Collapsed selection pill ────────────────────────────────────────
//
// Single thin bar that replaces both the CHAPTERS ribbon and the pattern
// context strip when the user wants more vertical space for the body
// (rail / center table / transform panel). Click anywhere on the pill to
// expand back to the full selection UI.
//
// Carries enough information to keep the user oriented without the rich
// display: active chapter (id + time range), active pattern type (color
// chip + label + instance count).
function CollapsedSelectionPill({ chapter, patternType, instanceCount, onExpand }) {
  return (
    <button
      onClick={onExpand}
      title="Expand selection area"
      aria-label="Expand selection area"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        cursor: 'pointer', fontFamily: 'inherit',
        textAlign: 'left', width: '100%', border: 'none',
        color: 'var(--text)',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
                     textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Selection
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
        {chapter.name || chapter.id}
      </span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {fmtTimeShort(chapter.at_ms)}–{fmtTimeShort(chapter.end_ms)}
      </span>
      <span style={{ color: 'var(--text-dim)' }}>·</span>
      <span style={{
        width: 10, height: 10, borderRadius: 2,
        background: patternType.color, flexShrink: 0,
      }} />
      <strong style={{ fontSize: 12.5, fontWeight: 700 }}>
        {patternType.label}
      </strong>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        · {instanceCount} phrase{instanceCount === 1 ? '' : 's'}
      </span>
      <div style={{ flex: 1 }} />
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: 'var(--text-dim)',
      }}>
        Expand
        <Icon name="chevron-down" size={12} />
      </span>
    </button>
  );
}

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
function InstanceTable({
  instances, actions, activeInstanceId, patternType,
  transformId, params, onFocusInstance,
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
          gridTemplateColumns: '120px 60px 1fr 1fr 36px',
          gap: 12, padding: '10px 14px',
          background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <span>Time</span>
          <span style={{ textAlign: 'right' }}>BPM</span>
          <span>Original</span>
          <span>Preview</span>
          <span></span>
        </div>

        {/* Body rows */}
        {instances.map((inst) => (
          <InstanceRow
            key={inst.id}
            instance={inst}
            actions={actions}
            transformId={transformId}
            params={params}
            focused={inst.id === activeInstanceId}
            onFocus={() => onFocusInstance(inst.id)}
          />
        ))}
      </div>
    </>
  );
}

function InstanceRow({ instance, actions, transformId, params, focused, onFocus }) {
  const { acts: originalActs, dur } = useMemo(
    () => sliceForInstance(actions, instance),
    [actions, instance],
  );
  const previewActs = useMemo(
    () => previewActions(originalActs, transformId, params),
    [originalActs, transformId, params],
  );

  // Per-row viewport — original and preview share it so drag/zoom in
  // one mirrors the other (the controlled-viewport mode FunscriptChart
  // already supports via `view` + `onViewChange`).
  const [view, setView] = useState({ start: 0, end: dur });
  useEffect(() => { setView({ start: 0, end: dur }); }, [dur]);

  return (
    <div
      onClick={onFocus}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 60px 1fr 1fr 36px',
        gap: 12, padding: '12px 14px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        background: focused ? 'rgba(255,75,75,0.05)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        {fmtTimeShort(instance.at_ms)}–{fmtTimeShort(instance.end_ms)}
      </span>
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
      <Button
        kind="ghost"
        size="sm"
        icon="external-link"
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        aria-label="Focus instance"
      />
    </div>
  );
}
