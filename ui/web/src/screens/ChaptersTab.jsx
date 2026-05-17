// ChaptersTab — pick a chapter, set its tone.
//
// Chapters were originally a way to make long funscripts manageable. On this
// tab, each chapter gets one tone (Tender/Build/Tease/Edge/Climax/Dominant)
// which biases the per-phrase suggestions on later tabs. The tone math
// running here is a JS-side preview — the canonical transform will move to
// `python cli.py tone <funscript> --chapter <id> --tone <name> --impact <v>`
// once the analyzer ships that endpoint (tracked in
// project-funscriptforge-pending). Same JS-preview / CLI-canonical split as
// the Device tab sliders.
//
// Layout:
//   Top:    full-script FunscriptChart with chapter bands beneath
//   Left:   chapter rail (300px)
//   Right:  active chapter detail — header, MediaViewer (chapter-scoped),
//           tone picker (6 cards), tone params, before/after, stats,
//           split/join affordances (UI only — logic deferred).
//
// Library tone pre-seed: if the project arrived with `project.libraryTone`,
// chapters default to that. Otherwise each chapter's initial tone is derived
// from `chapter.intent` when it matches a known tone, else falls back to
// `project.toneSuggestion`, else 'build'.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Icon, MediaViewer, Slider, ChapterRibbon } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { createChaptersSidecar, analyzeChaptersWithVideoflow } from '../api/forge.js';

// The six canonical tones. Source of truth: forge/tabs/tone_tab.py::_TONES
// in the Python side — the IDs MUST match (tender/build/tease/edge/climax/
// dominant) or chapter-tone records won't round-trip when the CLI lands.
const TONES = [
  { id: 'tender',   label: 'Tender',   color: '#8b9bff',
    desc: 'Soft, slow, intimate. Low BPM ceiling, gentle contrast.',
    params: [
      { id: 'ceiling',  label: 'Speed ceiling', min: 60, max: 180, step: 5,    def: 110, fmt: (v) => `${v}/s` },
      { id: 'softness', label: 'Edge softness', min: 0,  max: 1,   step: 0.05, def: 0.55, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'build',    label: 'Build',    color: '#4dabf7',
    desc: 'Gradual escalation. Amplitude grows phrase over phrase.',
    params: [
      { id: 'ramp',     label: 'Ramp curve',    min: 0,  max: 1,   step: 0.05, def: 0.65, fmt: (v) => v.toFixed(2) },
      { id: 'headroom', label: 'End headroom',  min: 0,  max: 30,  step: 1,    def: 12,   fmt: (v) => `${v}%` },
    ] },
  { id: 'tease',    label: 'Tease',    color: '#c77dff',
    desc: 'Patient, withholding. Holds back contrast for later release.',
    params: [
      { id: 'withhold', label: 'Withhold',      min: 0,   max: 1,   step: 0.05, def: 0.7,  fmt: (v) => v.toFixed(2) },
      { id: 'release',  label: 'Release point', min: 0.4, max: 0.95, step: 0.05, def: 0.8,  fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'edge',     label: 'Edge',     color: '#ffb547',
    desc: 'Sustained intensity at the threshold. High variance, no payoff.',
    params: [
      { id: 'hold', label: 'Hold intensity', min: 0,   max: 1, step: 0.05, def: 0.7,  fmt: (v) => v.toFixed(2) },
      { id: 'drop', label: 'Drop point',     min: 0.5, max: 1, step: 0.05, def: 0.85, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'climax',   label: 'Climax',   color: '#ff5470',
    desc: 'Peak BPM and contrast. Short, dense, uncompromising.',
    params: [
      { id: 'density',  label: 'Density',  min: 0.5, max: 2, step: 0.05, def: 1.4,  fmt: (v) => `${v.toFixed(2)}×` },
      { id: 'contrast', label: 'Contrast', min: 0,   max: 1, step: 0.05, def: 0.75, fmt: (v) => v.toFixed(2) },
    ] },
  { id: 'dominant', label: 'Dominant', color: '#ff8c47',
    desc: 'Demanding rhythm, hard contrast, strong recenter pressure.',
    params: [
      { id: 'recenter', label: 'Recenter', min: 0, max: 1, step: 0.05, def: 0.6,  fmt: (v) => v.toFixed(2) },
      { id: 'rhythm',   label: 'Rhythm',   min: 0, max: 1, step: 0.05, def: 0.55, fmt: (v) => v.toFixed(2) },
    ] },
  // 'none' (2026-05-17) — explicit "no tone" so the user isn't forced to
  // pick one before Accept. Selecting it returns the funscript unchanged
  // through `applyTone`. Sits at the end of the picker grid.
  { id: 'none',     label: 'Untoned',  color: '#64748b',
    desc: 'No tone applied — chapter passes through unchanged.',
    params: [] },
];

function findTone(id) { return TONES.find((t) => t.id === id) ?? TONES[1]; }

// Map a free-text intent or tone-suggestion to a known tone id. Unknown →
// null so the caller can fall back. Case-insensitive; matches the label.
function intentToToneId(intent) {
  if (!intent) return null;
  const k = String(intent).trim().toLowerCase();
  const hit = TONES.find((t) => t.id === k || t.label.toLowerCase() === k);
  return hit?.id ?? null;
}

function defaultToneParams() {
  const out = {};
  TONES.forEach((t) => {
    out[t.id] = { impact: 1.0 };
    t.params.forEach((p) => { out[t.id][p.id] = p.def; });
  });
  return out;
}

// Per-chapter initial tone map. Reads chapter.intent first, then falls back
// to the project's analyzer-suggested tone, then 'build'. Used both on first
// render and on project change / chapter creation.
function seedTones(chapters, projectTone) {
  const out = {};
  chapters.forEach((c) => {
    out[c.id] =
      intentToToneId(c.intent) ??
      intentToToneId(projectTone) ??
      'build';
  });
  return out;
}

// Per-chapter initial params map (fresh defaults for every tone, every
// chapter). Cheap to compute; we don't try to migrate prior params onto
// new chapters because chapter boundaries change.
function seedParams(chapters) {
  const out = {};
  chapters.forEach((c) => { out[c.id] = defaultToneParams(); });
  return out;
}

// Apply a tone to a chapter's slice of actions. JS preview only — the
// canonical transform will move to `python cli.py tone`. Curve shapes mirror
// the prototype (ui_design/.../tab-Chapters.jsx::applyToneCurve) so the
// before/after preview reads the same here.
function applyTone(actions, chapterStart, chapterEnd, tone, params) {
  if (!actions || actions.length === 0) return [];
  const slice = actions.filter((a) => a.at >= chapterStart && a.at <= chapterEnd);
  if (slice.length === 0) return [];
  // 'none' / Untoned — passthrough, no transform. Lets the user Accept
  // a chapter without committing to a tone.
  if (tone.id === 'none') return slice.map((a) => ({ at: a.at, pos: a.pos }));
  const dur = Math.max(1, chapterEnd - chapterStart);
  const impact = params.impact ?? 1;
  const clamp = (v) => Math.max(0, Math.min(100, v));

  return slice.map((a, i, arr) => {
    const t = (a.at - chapterStart) / dur; // 0..1 progress through chapter
    let v = a.pos;
    if (tone.id === 'tender') {
      const prev = arr[Math.max(0, i - 2)].pos;
      const next = arr[Math.min(arr.length - 1, i + 2)].pos;
      const smoothed = (prev + v * 2 + next) / 4;
      const ceilingPull = (params.ceiling - 110) / 70;
      v = smoothed - (smoothed - 50) * (0.25 - ceilingPull * 0.1);
      v = v - (v - 50) * params.softness * 0.35;
    } else if (tone.id === 'build') {
      const ramp = t ** (1 - params.ramp * 0.7 + 0.3);
      const cap = 100 - params.headroom;
      v = 50 + (v - 50) * (0.4 + ramp * 0.85);
      if (v > cap) v = cap;
    } else if (tone.id === 'tease') {
      const before = t < params.release;
      v = before
        ? 50 + (v - 50) * (1 - params.withhold * 0.7)
        : 50 + (v - 50) * (1 + params.withhold * 0.5);
    } else if (tone.id === 'edge') {
      const inHold = t < params.drop;
      v = inHold
        ? 70 + (v - 50) * (1 - params.hold * 0.55)
        : v - (v - 50) * 0.35;
    } else if (tone.id === 'climax') {
      v = 50 + (v - 50) * (1 + params.contrast * 0.85);
      const sgn = v >= 50 ? 1 : -1;
      v += sgn * (params.density - 1) * 8;
    } else if (tone.id === 'dominant') {
      v = v - (v - 50) * params.recenter * 0.5;
      const beat = Math.sin(t * Math.PI * 18) * params.rhythm * 14;
      v = 50 + (v - 50) * (1 + params.rhythm * 0.3) + beat * 0.4;
    }
    // Mix toned curve toward original by impact (0 = original, 1 = full tone)
    const mixed = a.pos + (v - a.pos) * impact;
    return { at: a.at, pos: Math.round(clamp(mixed)) };
  });
}

function fmtTimeShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

// Sentinel used when chapters is empty so the useMemo deps stay stable
// across the empty → populated transition. Without this the hook deps
// would shift between renders and we'd hit React's "rendered different
// number of hooks" guard.
const EMPTY_CHAPTER = { id: '__empty__', atMs: 0, endMs: 0, name: '', color: '#888' };

export default function ChaptersTab({ project, onAttachMedia, onChaptersChange, setBusy, setAppError }) {
  const totalMs = project?.durationMs ?? 0;
  const actions = Array.isArray(project?.actions) ? project.actions : [];

  // Local chapter state — initialised from project.chapterList (parsed from
  // the sidecar by the Rust bridge) and replaced when the user kicks off
  // chapter creation in the empty state. Syncs when a different project
  // loads.
  const [chapters, setChapters] = useState(() =>
    Array.isArray(project?.chapterList) ? project.chapterList : [],
  );
  const [activeId, setActiveId] = useState(chapters[0]?.id ?? null);
  // tonesByChapter: { ch1: 'build', ch2: 'edge', ... }
  const [tonesByChapter, setTonesByChapter] = useState(() =>
    seedTones(chapters, project?.toneSuggestion),
  );
  // paramsByChapter: { ch1: { tender: {...}, build: {...}, ... }, ... }
  const [paramsByChapter, setParamsByChapter] = useState(() =>
    seedParams(chapters),
  );

  // When the user opens a different project, reset the local chapter list
  // and the per-chapter maps. Keying off project.path covers the case
  // where Rust populates chapterList for the new project.
  useEffect(() => {
    const next = Array.isArray(project?.chapterList) ? project.chapterList : [];
    setChapters(next);
    setActiveId(next[0]?.id ?? null);
    setTonesByChapter(seedTones(next, project?.toneSuggestion));
    setParamsByChapter(seedParams(next));
  }, [project?.path]);

  // Auto-split + sidecar write. The Rust bridge persists the file; the
  // returned record list refreshes local state so the rest of the tab
  // populates immediately without a project reload.
  const [splitN, setSplitN] = useState(4);
  const [creating, setCreating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  // Playback clock for the chapter-scoped edit loop. JS-only for now — the
  // MediaViewer's <video> element doesn't share this clock yet (pending: tie
  // video.currentTime to currentMs and vice versa). The timecode, the
  // keyboard shortcuts, and the chapter-end loop all run off this state.
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const hydrateFromChapterList = (created) => {
    setChapters(created);
    setActiveId(created[0]?.id ?? null);
    setTonesByChapter(seedTones(created, project?.toneSuggestion));
    setParamsByChapter(seedParams(created));
    // Lift the new chapter list back to App.jsx so downstream tabs
    // (Patterns, Phrases) see the same chapters. Without this push, they
    // would still see the original (often empty) chapterList from
    // load_project.
    onChaptersChange?.(created);
  };
  const handleCreateChapters = async () => {
    if (!project?.path || creating) return;
    setCreating(true);
    try {
      const created = await createChaptersSidecar(project.path, splitN);
      hydrateFromChapterList(created);
    } catch (err) {
      console.error('ChaptersTab: create_chapters_sidecar failed', err);
    } finally {
      setCreating(false);
    }
  };

  // Content-aware detection via videoflow.structural — requires adjacent
  // media. The Rust command errors out cleanly when no media is attached;
  // surface that to the user so they know to attach a file. Drives the
  // global footer busy state so the live ProgressReporter events from
  // videoflow appear in the AcceptBar; the consumer can Cancel mid-run
  // and we discard the in-flight result.
  const analyzeCancelledRef = useRef(false);
  const handleAnalyzeWithVideoflow = async () => {
    if (!project?.path || analyzing) return;
    setAnalyzeError(null);
    setAnalyzing(true);
    analyzeCancelledRef.current = false;
    setBusy?.({
      message: 'Analyzing chapters…',
      onCancel: () => {
        analyzeCancelledRef.current = true;
        setAnalyzing(false);
        setBusy?.(null);
      },
    });
    try {
      const detected = await analyzeChaptersWithVideoflow(project.path, null, project.mediaPath || null);
      if (analyzeCancelledRef.current) return;
      hydrateFromChapterList(detected);
    } catch (err) {
      if (analyzeCancelledRef.current) return;
      console.error('ChaptersTab: analyze_chapters_with_videoflow failed', err);
      setAnalyzeError(String(err?.message ?? err));
      setAppError?.(`Auto-chapter failed: ${err?.message ?? err}`);
    } finally {
      if (!analyzeCancelledRef.current) {
        setAnalyzing(false);
        setBusy?.(null);
      }
    }
  };

  // ── Hooks must run unconditionally — empty-state early return goes AFTER.
  // active falls back to a zero-length sentinel so the useMemo deps stay
  // stable when chapters is empty.
  const active = chapters.find((c) => c.id === activeId) ?? chapters[0] ?? EMPTY_CHAPTER;
  const toneId = tonesByChapter[active.id] ?? 'build';
  const tone = findTone(toneId);
  const toneParams = paramsByChapter[active.id]?.[tone.id] ?? {};

  const beforeSlice = useMemo(
    () => actions.filter((a) => a.at >= active.atMs && a.at <= active.endMs),
    [actions, active.atMs, active.endMs],
  );
  const afterSlice = useMemo(
    () => applyTone(actions, active.atMs, active.endMs, tone, toneParams),
    [actions, active.atMs, active.endMs, tone, toneParams],
  );

  // When the active chapter changes, jump the playhead to the chapter start
  // and pause. Click-to-select shouldn't leave the user with the playhead in
  // the middle of an unrelated chapter.
  useEffect(() => {
    if (active === EMPTY_CHAPTER) return;
    setCurrentMs(active.atMs);
    setIsPlaying(false);
  }, [active.id]);

  // rAF clock: advance currentMs while playing; loop back at chapter end.
  // The boundary is hard — we never let the playhead leave the active
  // chapter while playing (per "stay constrained in the thing we are
  // editing"). To leave the chapter the user clicks another band.
  useEffect(() => {
    if (!isPlaying || active === EMPTY_CHAPTER) return undefined;
    let rafId;
    let last = performance.now();
    const tick = (t) => {
      const dt = t - last;
      last = t;
      setCurrentMs((prev) => {
        const next = prev + dt;
        if (next >= active.endMs) return active.atMs;  // loop
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, active.atMs, active.endMs]);

  // Keyboard shortcuts. Brackets for chapter nav, Space for play/pause,
  // Home jumps to chapter start, , and . step one frame (~33ms ≈ 30fps).
  // Skip when focus is in an input/textarea so typing isn't hijacked.
  useEffect(() => {
    const onKey = (e) => {
      const tgt = e.target;
      if (tgt && tgt.matches && tgt.matches('input, textarea, [contenteditable="true"]')) return;
      const i = chapters.findIndex((c) => c.id === active.id);
      if (e.key === '[' && i > 0) {
        setActiveId(chapters[i - 1].id); e.preventDefault();
      } else if (e.key === ']' && i >= 0 && i < chapters.length - 1) {
        setActiveId(chapters[i + 1].id); e.preventDefault();
      } else if (e.key === ' ' || e.code === 'Space') {
        setIsPlaying((p) => !p); e.preventDefault();
      } else if (e.key === 'Home') {
        setCurrentMs(active.atMs); e.preventDefault();
      } else if (e.key === ',') {
        setCurrentMs((ms) => Math.max(active.atMs, ms - 33)); e.preventDefault();
      } else if (e.key === '.') {
        setCurrentMs((ms) => Math.min(active.endMs, ms + 33)); e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [chapters, active.id, active.atMs, active.endMs]);

  // Empty-state early return AFTER all hooks have run.
  if (chapters.length === 0) {
    return (
      <ChaptersEmptyState
        canCreate={!!project?.path}
        n={splitN}
        onChangeN={setSplitN}
        onCreate={handleCreateChapters}
        creating={creating}
        hasMedia={!!project?.mediaPath}
        onAttachMedia={onAttachMedia}
        onAnalyze={handleAnalyzeWithVideoflow}
        analyzing={analyzing}
        analyzeError={analyzeError}
      />
    );
  }

  const setParam = (key, val) => {
    setParamsByChapter((s) => ({
      ...s,
      [active.id]: {
        ...s[active.id],
        [tone.id]: { ...s[active.id][tone.id], [key]: val },
      },
    }));
  };

  return (
    <section style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Page header */}
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>
          Chapters · tone
        </div>
        <h2 style={{ margin: '4px 0 6px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Set the emotional arc
        </h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 780, lineHeight: 1.5 }}>
          Each chapter gets one tone. Tone is a script-wide bias that shapes
          the phrase-level suggestions on the Edit tab — set the stage here,
          refine per-phrase next. <em>Preview only;</em> tone CLI lands later.
        </div>
      </div>

      {/* Top row: ChapterRibbon (left) + chapter-scoped MediaViewer (right).
          The ribbon's active band carries the funscript waveform for that
          chapter, so the older separate FunscriptChart at the top is gone —
          the waveform is now content *inside* the ribbon, not a sibling.
          Same height left/right (default-200 ribbon ≈ default-200 viewer).

          Click a band's title or frame to select that chapter (chapter
          becomes the new edit scope). The 3-dot per-band menu offers
          Split-at-playhead / Join-with-prev / Join-with-next — all stubbed
          for now (handlers log TODO). The redundant Split/Join in the
          ActiveChapterHeader below has been dropped. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 12,
        }}>
          <ChapterRibbon
            bands={chapters.map((c) => ({
              id: c.id,
              at_ms: c.atMs,
              end_ms: c.endMs,
              name: c.name,
              color: c.color,
              toneColor: findTone(tonesByChapter[c.id])?.color,
            }))}
            actions={actions}
            selectedId={active.id}
            onSelect={(band) => setActiveId(band.id)}
            menu={[
              {
                id: 'split',
                label: 'Split at playhead',
                icon: 'scissors',
                onClick: (band) => console.log('TODO: split chapter at playhead', band.id),
              },
              {
                id: 'join-prev',
                label: 'Join with previous',
                icon: 'corner-up-left',
                onClick: (band) => console.log('TODO: join with previous', band.id),
                disabled: (_b, i) => i <= 0,
              },
              {
                id: 'join-next',
                label: 'Join with next',
                icon: 'corner-up-right',
                onClick: (band) => console.log('TODO: join with next', band.id),
                disabled: (_b, i) => i >= chapters.length - 1,
              },
            ]}
            height={200}
          />
        </div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 12,
        }}>
          <MediaViewer
            videoSrc={project?.mediaPath ? toFileUrl(project.mediaPath) : undefined}
            media={{ kind: project?.mediaKind ?? 'video', title: active.name || active.id }}
            chapter={{
              id: active.id,
              title: active.name || `Chapter ${chapters.indexOf(active) + 1}`,
              color: active.color,
              start: active.atMs,
              end: active.endMs,
            }}
            funscript={{ actions }}
            currentMs={currentMs}
            totalMs={totalMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            // Manual seek clamps to chapter bounds — you can't leave the
            // chapter via scrubbing, only via clicking another band.
            onSeek={(ms) => setCurrentMs(Math.max(active.atMs, Math.min(active.endMs, ms)))}
            modeToggleAlign="start"
            modeToggleSize="sm"
            showModeLabel={false}
            showMark={false}
            onPrev={() => {
              const i = chapters.indexOf(active);
              if (i > 0) setActiveId(chapters[i - 1].id);
            }}
            onNext={() => {
              const i = chapters.indexOf(active);
              if (i < chapters.length - 1) setActiveId(chapters[i + 1].id);
            }}
            width="100%"
            height={200}
          />
        </div>
      </div>

      {/* Rail + detail row. Rail is a scannable vertical list of all chapters;
          the bands above are the horizontal time-aware selector. Both drive
          the same activeId — the rail is what you read, the bands are what
          you click when you need positional context. */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 18 }}>
        <ChapterRail
          chapters={chapters}
          tones={tonesByChapter}
          activeId={active.id}
          onSelect={setActiveId}
        />

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ActiveChapterHeader
            chapter={active}
            tone={tone}
            mediaPath={project?.mediaPath}
            onAttachMedia={onAttachMedia}
          />

          {/* Tone picker — full width in the detail column */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16,
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <SectionLabel>Tone · {tone.label}</SectionLabel>
            <TonePicker
              tones={TONES}
              value={tone.id}
              onChange={(id) => setTonesByChapter((s) => ({ ...s, [active.id]: id }))}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {tone.desc}
            </div>
          </div>

          {/* Tone params + before/after preview */}
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16,
          }}>
            <Slider
              label="Impact — how much of this tone to apply"
              value={toneParams.impact ?? 1}
              min={0} max={1} step={0.01}
              valueLabel={(toneParams.impact ?? 1).toFixed(2)}
              onChange={(v) => setParam('impact', v)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
              {tone.params.map((p) => {
                const v = toneParams[p.id] ?? p.def;
                return (
                  <Slider
                    key={p.id}
                    label={p.label}
                    value={v}
                    min={p.min} max={p.max} step={p.step}
                    valueLabel={p.fmt(v)}
                    onChange={(nv) => setParam(p.id, nv)}
                  />
                );
              })}
            </div>

            <div style={{ height: 1, background: 'var(--border)', margin: '16px 0 14px' }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <BeforeAfterCol title="Before" subtitle="source — device aware">
                <FunscriptChart
                  actions={beforeSlice.map((a) => ({ at: a.at - active.atMs, pos: a.pos }))}
                  totalMs={active.endMs - active.atMs}
                  height={120}
                  bare
                />
              </BeforeAfterCol>
              <BeforeAfterCol
                title="After"
                subtitle={`${tone.label} · impact ${Math.round((toneParams.impact ?? 1) * 100)}%`}
                accent={tone.color}
              >
                <FunscriptChart
                  actions={afterSlice.map((a) => ({ at: a.at - active.atMs, pos: a.pos }))}
                  totalMs={active.endMs - active.atMs}
                  height={120}
                  bare
                />
              </BeforeAfterCol>
            </div>
          </div>

          {/* Quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <ChStat label="Tone" value={tone.label} hint="chapter bias" color={tone.color} />
            <ChStat label="Duration" value={fmtTimeShort(active.endMs - active.atMs)}
                     hint={`${Math.round(((active.endMs - active.atMs) / Math.max(1, totalMs)) * 100)}% of script`} />
            <ChStat label="Content" value={active.content_type || '—'} hint="from sidecar" />
            <ChStat label="Confidence" value={
              active.confidence ? `${Math.round(active.confidence * 100)}%` : '—'
            } hint="analyzer score" />
          </div>
        </div>
      </div>
    </section>
  );
}

// Convert a local filesystem path to a Tauri-safe file URL. Used so the
// MediaViewer's <video src> can load the adjacent media file. In browser
// mode mediaPath is null; this fn won't run.
function toFileUrl(path) {
  if (!path) return undefined;
  // Tauri's WebView accepts file:// URLs on Windows when the path is
  // converted from backslashes to forward slashes; the protocol allowlist
  // is configured in tauri.conf.json. If the asset protocol gets set up
  // later we'll swap to convertFileSrc here.
  const fwd = String(path).replace(/\\/g, '/');
  return fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`;
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)',
      textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{children}</div>
  );
}

function BeforeAfterCol({ title, subtitle, accent, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: accent || 'var(--text)' }}>{title}</div>
        <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>— {subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function ChapterRail({ chapters, tones, activeId, onSelect }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden', alignSelf: 'start',
    }}>
      <div style={{
        padding: '12px 14px', fontSize: 10, fontWeight: 700,
        color: 'var(--text-dim)', textTransform: 'uppercase',
        letterSpacing: '0.08em', borderBottom: '1px solid var(--border)',
      }}>
        Chapters · {chapters.length}
      </div>
      {chapters.map((c, i) => {
        const sel = c.id === activeId;
        const t = findTone(tones[c.id]);
        return (
          <button
            key={c.id}
            onClick={() => onSelect?.(c.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '12px 14px', border: 'none',
              borderLeft: `3px solid ${sel ? 'var(--accent)' : 'transparent'}`,
              borderBottom: i < chapters.length - 1 ? '1px solid var(--border)' : 'none',
              background: sel ? 'var(--surface-2)' : 'transparent',
              color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 4, height: 36, borderRadius: 2, background: c.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: sel ? 700 : 600 }}>
                {c.name || `Chapter ${i + 1}`}
              </div>
              <div style={{
                fontSize: 10.5, color: 'var(--text-dim)',
                marginTop: 2, fontFamily: 'var(--font-mono)',
              }}>
                {fmtTimeShort(c.atMs)}–{fmtTimeShort(c.endMs)}
              </div>
            </div>
            <Pill tone="neutral" style={{ background: t.color + '22', color: t.color, borderColor: t.color + '55' }}>
              {t.label}
            </Pill>
          </button>
        );
      })}
    </div>
  );
}

function ActiveChapterHeader({ chapter, tone, mediaPath, onAttachMedia }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: chapter.color }} />
      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
        {chapter.name || chapter.id}
      </h3>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
        {fmtTimeShort(chapter.atMs)}–{fmtTimeShort(chapter.endMs)}
      </span>
      <Pill tone="neutral" style={{ background: tone.color + '22', color: tone.color, borderColor: tone.color + '55' }}>
        Tone: {tone.label}
      </Pill>
      <div style={{ flex: 1 }} />
      {/* Split/Join moved into the per-band 3-dot menu on the ChapterRibbon
          above — same actions, but adjacent to the band they operate on. */}
      {!mediaPath && (
        <ChapterActionButton onClick={onAttachMedia} title="Attach video / audio">
          <Icon name="upload-cloud" size={12} style={{ marginRight: 4 }} />
          Attach media
        </ChapterActionButton>
      )}
    </div>
  );
}

function ChapterActionButton({ children, disabled, ...rest }) {
  return (
    <button
      disabled={disabled}
      style={{
        padding: '5px 10px', fontSize: 11.5, fontWeight: 600,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        color: disabled ? 'var(--text-dim)' : 'var(--text)',
        borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1, fontFamily: 'inherit',
        display: 'inline-flex', alignItems: 'center',
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

function TonePicker({ tones, value, onChange }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tones.length}, 1fr)`, gap: 6 }}>
      {tones.map((t) => {
        const sel = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange?.(t.id)}
            title={t.desc}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 10px', borderRadius: 6,
              background: sel ? t.color + '22' : 'var(--surface)',
              border: `1.5px solid ${sel ? t.color : 'var(--border)'}`,
              color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 700, color: sel ? t.color : 'var(--text)' }}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Empty state — shown when project.chapterList is empty and no chapters
// have been created yet in-session. Two creation paths:
//   1. Manual equal-split (always available) — N-slider writes evenly-spaced
//      chapters into <stem>.chapters.json.
//   2. Analyze with videoflow (requires adjacent media) — content-aware
//      boundaries via videoflow.structural.auto_chapter, which inspects the
//      audio (RMS / spectral flux / recurrence clustering) and writes the
//      same sidecar shape, tagged so we can tell hand-split from analyzer.
function ChaptersEmptyState({
  canCreate, n, onChangeN, onCreate, creating,
  hasMedia, onAttachMedia, onAnalyze, analyzing, analyzeError,
}) {
  const busy = creating || analyzing;
  return (
    <section style={{ padding: '32px 24px', maxWidth: 720 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-dim)',
      }}>
        Chapters · empty
      </div>
      <h2 style={{ margin: '4px 0 8px', fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>
        No chapters yet
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 560 }}>
        Chapters break a long funscript into manageable arcs. Pick a starting
        point — content-aware detection from the adjacent media, or an
        equal-split you can fine-tune later. Either way writes to{' '}
        <code>&lt;stem&gt;.chapters.json</code> next to the funscript.
      </p>

      {/* Card 1: Analyze with videoflow — content-aware, requires media */}
      <div style={{
        marginTop: 22, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Analyze with videoflow
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Recommended when media is attached
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Inspects the adjacent video/audio (RMS, spectral flux, recurrence
          clustering) and writes content-aware chapter boundaries. Slower than
          equal-split but the cuts land on real transitions.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onAnalyze}
            disabled={!canCreate || !hasMedia || busy}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: 700,
              background: canCreate && hasMedia && !busy ? 'var(--accent)' : 'var(--surface-2)',
              color: canCreate && hasMedia && !busy ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: canCreate && hasMedia && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {analyzing ? 'Analyzing…' : 'Analyze with videoflow'}
          </button>
          {!hasMedia && canCreate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={onAttachMedia}
                disabled={busy}
                style={{
                  padding: '7px 12px', fontSize: 12, fontWeight: 600,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Icon name="upload-cloud" size={12} />
                Attach media…
              </button>
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                Videoflow needs a video or audio file to inspect.
              </span>
            </div>
          )}
        </div>
        {analyzeError && (
          <div style={{ fontSize: 11.5, color: '#e74c3c' }}>
            {analyzeError}
          </div>
        )}
      </div>

      {/* Card 2: Equal-split — always available */}
      <div style={{
        marginTop: 14, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
                      textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Equal-split
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 1 }}>
            <Slider
              label={`Number of chapters: ${n}`}
              value={n}
              min={2}
              max={12}
              step={1}
              valueLabel={`${n}`}
              onChange={onChangeN}
            />
          </div>
          <button
            onClick={onCreate}
            disabled={!canCreate || busy}
            style={{
              padding: '9px 18px', fontSize: 13, fontWeight: 700,
              background: canCreate && !busy ? 'var(--accent)' : 'var(--surface-2)',
              color: canCreate && !busy ? '#fff' : 'var(--text-dim)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: canCreate && !busy ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {creating ? 'Creating…' : `Create ${n} chapters`}
          </button>
        </div>
        {!canCreate && (
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
            Open a funscript on the Library tab first.
          </div>
        )}
      </div>
    </section>
  );
}

function ChStat({ label, value, hint, color }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 8,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: color || 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
    </div>
  );
}
