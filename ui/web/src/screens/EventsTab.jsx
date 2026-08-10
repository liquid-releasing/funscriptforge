// EventsTab — point-in-time effects layered on the generated output
// channels. SKELETON pass: shows the three-pane shape (Library / Capture
// / Timeline) plus the bottom funscript strip with chapter band + event
// brackets. Click-to-select works; everything else (Begin/End capture,
// device targeting, intensity, param forms, drag-resize on strip, YAML
// preview, starter packs, Accept-writes-sidecar) lands in a follow-on
// "wiring" pass before FF beta.
//
// Layout:
//
//   ChapterRibbon (scope) · identity + Collapse · hero
//   (TrackStack funscript/events + monitor) · capture bar ①
//   ┌──────────────┬───────────────────────────┬──────────────┐
//   │ ② Library    │ ③ Effect config           │  Timeline    │
//   │  (Normal +   │  (intensity · tunables ·  │  (events by  │
//   │   effects,   │   broadcast/override) +   │   chapter,   │
//   │   glyphs)    │   Add/Update event        │   edit/del)  │
//   └──────────────┴───────────────────────────┴──────────────┘
//   ┌────────────────────────────────────────────────────────┐
//   │  Footer — counts + IO (starter packs / Edger — stubs)  │
//   └────────────────────────────────────────────────────────┘
//
// Events are DURABLE: seeded from the canonical <stem>.feel.yml on project
// load (readFeelEvents) and written through on every discrete mutation —
// add / edit / delete (saveFeelEvents, fire-and-forget). The funscript is
// never touched; events layer on the output channels. Chapter scope + the
// selected/edited event id stay tab-local session state.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Button, Icon, fmtTime, fmtTimeShort, TrackStack, MediaViewer, ChapterRibbon, CaptureBar } from 'forgemoment';
import { EVENT_DEVICES } from '../data/events.js';
import {
  readFeelEvents, saveFeelEvents, listEventRecipes,
  edgerExport, edgerImport, pickEventsYmlFile,
} from '../api/forge.js';
import {
  GROUP_COLORS, GROUP_NAMES, recipeColor, pickLabel, recipeBlend, BLEND_META,
  humanizeSteps, recipeGlyphKind, glyphPoints,
} from '../lib/eventCatalog.js';
import { useChapterClip } from '../hooks/useChapterClip.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

// ── Catalog vocabulary lives in lib/eventCatalog.js (testable, shared). The
// component-local pieces stay here: the synthetic "Normal" baseline (not an
// Edger event, not exported) and the RecipeGlyph SVG that renders the glyph
// kind/points derived there.
const NORMAL_RECIPE = {
  id: 'normal', name: 'normal', group: 'featured', baseline: true, branded: true,
  label: 'Normal', sfwLabel: 'Normal', nsfwLabel: 'Normal',
  desc: 'Baseline — no enhancement. Chain captures to cover ground fast.',
  params: [], steps: [], defaultParams: {},
};

// Self-heal for the pre-clamp snap artifact: an event whose Begin snapped onto
// the prior chapter's last beat (a few ms BEFORE a boundary) but which extends
// INTO the next chapter really belongs to that next chapter. Snap such begins
// up to the boundary so each event homes to exactly one chapter. Only touches
// begins within tol BEFORE a boundary that the event crosses; events genuinely
// starting (and ending) in the prior chapter are left alone. Returns the
// (possibly) rewritten list plus whether anything changed (→ re-persist once).
const SNAP_HEAL_TOL_MS = 250;
function healChapterSnap(loaded, chapterList) {
  if (!chapterList?.length) return { events: loaded, changed: false };
  const starts = chapterList
    .map((c) => c.atMs)
    .filter((m) => m != null)
    .sort((a, b) => a - b);
  let changed = false;
  const healed = loaded.map((e) => {
    for (const atMs of starts) {
      if (e.beginMs < atMs && atMs - e.beginMs <= SNAP_HEAL_TOL_MS && e.endMs > atMs) {
        changed = true;
        return { ...e, beginMs: atMs };
      }
    }
    return e;
  });
  return { events: healed, changed };
}

// RecipeGlyph — a filled sparkline synthesized from the actual step stack (the
// "shape icon"): modulation → its waveform; a single linear change → ramp
// up/down/steady; baseline → a flat dim line. Grounded in real data.
function RecipeGlyph({ recipe, color, w = 34, h = 18 }) {
  const spec = recipeGlyphKind(recipe);
  const pts = glyphPoints(spec, w, h);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fill = `${pts[0][0].toFixed(1)},${(h - 2).toFixed(1)} ${line} ${pts[pts.length - 1][0].toFixed(1)},${(h - 2).toFixed(1)}`;
  const dim = spec.kind === 'flat';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0, display: 'block' }}>
      <polygon points={fill} fill={dim ? 'var(--text-dim)' : color} opacity={dim ? 0.1 : 0.18} />
      <polyline points={line} fill="none" stroke={dim ? 'var(--text-dim)' : color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function EventsTab({
  project, selectedDevices = [],
  trackPeaks = null, trackSpectrogram = null, trackBeats = null,
  // Shared active chapter (App) — seed the scope from it so Events opens on the
  // same chapter you were editing, report changes back, and host an "Accept and
  // next chapter" on the footer like Chapters / Channels.
  initialChapterId = null, onActiveChapterChange, onRegisterChapterNav,
}) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const totalMs = project?.durationMs ?? 0;
  // Real audio peaks for the monitor's Audio mode (the "wiry" waveform +
  // beat ticks + dashboard). Same guard ChaptersTab uses.
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

  // Load events from the canonical <stem>.feel.yml whenever the project
  // changes. Durable — every add/edit/delete writes back (see persist()).
  const [events, setEvents] = useState([]);
  useEffect(() => {
    setSelectedId(null);
    setScope('all');
    const path = project?.path;
    if (!path) { setEvents([]); return undefined; }
    let cancelled = false;
    readFeelEvents(path)
      .then((res) => {
        if (cancelled) return;
        const loaded = res?.events ?? [];
        // One-time self-heal: rescue events whose Begin snapped a few ms onto
        // the prior chapter's last beat (pre-clamp) but that cross into the
        // next chapter — re-home them and write back once if anything moved.
        const { events: healed, changed } = healChapterSnap(loaded, chapters);
        setEvents(healed);
        if (changed) persist(healed);
        // Seed the id counter past any e-cap-N already on disk so new
        // captures can't collide with persisted ids after a reload.
        let maxSeq = 0;
        for (const e of healed) {
          const m = /^e-cap-(\d+)$/.exec(e.id || '');
          if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        }
        seqRef.current = maxSeq;
      })
      .catch((e) => {
        console.error('read .feel.yml failed', e);
        if (!cancelled) setEvents([]);
      });
    return () => { cancelled = true; };
  }, [project?.path]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Write-through: persist the full events list to <stem>.feel.yml after a
  // discrete mutation (add / edit / delete). Fire-and-forget so the UI stays
  // instant; the funscript is never touched (events layer on output).
  const persist = (nextEvents) => {
    const path = project?.path;
    if (!path) return;
    saveFeelEvents(path, nextEvents).catch((e) => console.error('save .feel.yml failed', e));
  };

  // Effect catalog — the 32 Edger events, backend-sourced (list-event-recipes).
  // Fetched once; a synthetic "Normal" baseline is prepended for chaining.
  const [catalog, setCatalog] = useState({ groups: [], recipes: [] });
  useEffect(() => {
    let cancelled = false;
    listEventRecipes()
      .then((res) => { if (!cancelled) setCatalog(res || { groups: [], recipes: [] }); })
      .catch((e) => { console.error('list-event-recipes failed', e); });
    return () => { cancelled = true; };
  }, []);
  const recipes = useMemo(
    () => [NORMAL_RECIPE, ...(catalog.recipes ?? [])],
    [catalog],
  );
  const recipeMap = useMemo(() => {
    const m = new Map();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);
  const recipeById = (id) => recipeMap.get(id) || null;

  // Seed the scope from the shared active chapter (App) so Events opens on the
  // chapter you were editing in Chapters / Channels; a stale id falls back to
  // the first chapter via the activeChapter memo below.
  const [scope, setScope] = useState(initialChapterId || 'all'); // 'all' | chapter id
  // Report the scoped chapter up so the shared state (and the other tabs) follow.
  useEffect(() => {
    if (scope !== 'all') onActiveChapterChange?.(scope);
  }, [scope]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedId, setSelectedId] = useState(null);
  // Playhead + transport for the chapter-scoped hero. The MediaViewer is
  // the time backbone (emits onTimeChange while playing); click-to-seek on
  // the TrackStack and the transport buttons also drive currentMs.
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Collapse the hero (TrackStack + monitor) for more editing room below —
  // the reconciled design's "Collapse chart". Ribbon + identity row stay.
  const [collapsed, setCollapsed] = useState(false);
  // Capture bar (step ① — mark begin/end from the playhead). Both null until
  // captured; duration is derived. Chain carries this end → next begin so
  // back-to-back captures stay gapless; Snap pulls the mark to the nearest
  // beat (trackBeats.beatsMs) when within tolerance. Local-only for now.
  const [beginMs, setBeginMs] = useState(null);
  const [endMs, setEndMs] = useState(null);
  const [chain, setChain] = useState(true);
  const [snap, setSnap] = useState(true);
  const seqRef = useRef(0);
  // Pre-arm "Normal" (decision #5) — open Events ready to chain-capture
  // baseline coverage without picking an effect first.
  const [selectedEffectId, setSelectedEffectId] = useState('normal');
  // Label presentation — SFW (default, store positioning) vs NSFW (raw intent).
  const [labelMode, setLabelMode] = useState('sfw');
  // Transient "events saved ✓" confirmation. Events write through on every
  // edit, but the footer Accept gave no feedback on the LAST chapter (its nav
  // run was a no-op there), so a Scene Closer added to the final chapter read
  // as "not accepted" even though it was on disk (dogfood 2026-06-18). The
  // last-chapter Accept now flush-persists and pulses this so the save is
  // visible. Cleared on a timer; the ref lets the timer survive re-renders.
  const [savedPulse, setSavedPulse] = useState(false);
  const savedTimerRef = useRef(null);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) || null,
    [events, selectedId],
  );

  // Edit-mode: clicking a timeline event rehydrates the capture bar with its
  // begin/end and arms its effect, so the config pane loads its settings and
  // the commit button becomes "Update event". Deselecting (click again) clears
  // the marks back to a clean new-event capture.
  useEffect(() => {
    if (selectedEvent) {
      setSelectedEffectId(selectedEvent.effectId);
      setBeginMs(selectedEvent.beginMs);
      setEndMs(selectedEvent.endMs);
    } else {
      setBeginMs(null);
      setEndMs(null);
    }
  }, [selectedId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const timelineEvents = useMemo(() => {
    if (scope === 'all') return events;
    const ch = chapters.find((c) => c.id === scope);
    if (!ch) return events;
    // One home per event — the timeline list shows an event in exactly the
    // chapter its begin falls in (no double-listing across boundaries). The
    // capture clamp (clampToChapter) keeps a Begin mark from snapping across
    // the boundary, so an event added at a chapter's start stays homed there.
    return events.filter((e) => e.beginMs >= ch.atMs && e.beginMs < ch.endMs);
  }, [events, scope, chapters]);

  // ── Chapter-scoped hero (Stage 1a: TrackStack) ──────────────────────
  // The hero shows ONE chapter at a time: the scoped chapter when the user
  // has picked one, else the first chapter. Events overlapping that window
  // map to TrackStack's generic span shape (vocabulary stays here, not in
  // forgemoment — same pattern as ShapeGlyph).
  const activeChapter = useMemo(() => {
    if (scope !== 'all') return chapters.find((c) => c.id === scope) ?? chapters[0];
    return chapters[0];
  }, [scope, chapters]);

  // Footer "Accept and next chapter" (same as Channels). Events auto-save, so
  // this just advances the scoped chapter; on the last chapter it's a no-op
  // "Accept chapter". Registered with App so it sits on the always-visible
  // footer next to "Accept and chain to Channels" (dogfood 2026-06-16).
  const activeIdx = chapters.findIndex((c) => c.id === activeChapter?.id);
  const isLastChapter = activeIdx >= chapters.length - 1;

  // Completion gate — same contract as Chapters / Phrases / Stanzas. Events
  // auto-save, but the footer must NOT offer "chain to Channels" (nor show the
  // ready ✓) until every chapter has been CONSIDERED. "Considered" is the
  // walk/visit signal: a chapter can legitimately hold zero events, so there's
  // no per-chapter persisted signal to derive from — session-local, reset per
  // project, unlocked in bulk by "Accept all as-is".
  const [consideredChapterIds, setConsideredChapterIds] = useState(() => new Set());
  useEffect(() => { setConsideredChapterIds(new Set()); }, [project?.path]);
  const markConsidered = (id) => {
    if (id == null) return;
    setConsideredChapterIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id); return next;
    });
  };
  const chaptersConsideredComplete = chapters.length > 0
    && chapters.every((c) => consideredChapterIds.has(c.id));
  const acceptAllChaptersAsIs = () =>
    setConsideredChapterIds(new Set(chapters.map((c) => c.id)));

  // The VISIT half of "walk/visit" above. It was documented but never wired:
  // only the footer walk button marked anything, so a user who navigated by
  // clicking chapter bands — then edited each chapter and pressed "Accept last
  // chapter changes" — had exactly ONE chapter considered and could never
  // unlock the chain to Channels (D36).
  //
  // Opening a chapter IS the review on this tab: events auto-save and there is
  // nothing to per-chapter "accept", so there's no further act of acceptance to
  // wait for. Deliberately scoped to a REAL chapter — the 'all' scope must not
  // count, or merely landing on the tab (which defaults to 'all') would mark
  // every chapter considered and the gate would mean nothing.
  useEffect(() => {
    if (scope === 'all') return;
    markConsidered(activeChapter?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeChapter?.id]);

  const goNextRef = useRef(() => {});
  goNextRef.current = () => {
    // Walking a chapter marks it considered — that's what unlocks chaining.
    markConsidered(activeChapter?.id);
    if (activeIdx >= 0 && activeIdx < chapters.length - 1) {
      setScope(chapters[activeIdx + 1].id);
      return;
    }
    // Last chapter: there's no next to advance to. Events already write
    // through on every edit, but the user needs to SEE that the final
    // chapter's events (e.g. a Scene Closer) are committed — so flush-persist
    // and pulse a confirmation rather than silently doing nothing.
    persist(events);
    setSavedPulse(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedPulse(false), 2400);
  };
  useEffect(() => {
    if (!onRegisterChapterNav) return undefined;
    onRegisterChapterNav(
      chapters.length > 0
        ? {
            hasNext: !isLastChapter,
            label: isLastChapter ? 'Accept last chapter changes' : 'Accept and next chapter',
            run: () => goNextRef.current(),
            // Drives the footer gate: no chain to Channels (and no ready ✓)
            // until every chapter is considered.
            complete: chaptersConsideredComplete,
            considered: chapters.filter((c) => consideredChapterIds.has(c.id)).length,
            total: chapters.length,
          }
        : null,
    );
    return () => onRegisterChapterNav(null);
  }, [isLastChapter, chapters.length, onRegisterChapterNav, chaptersConsideredComplete, consideredChapterIds]);  // eslint-disable-line react-hooks/exhaustive-deps
  // Drop the confirmation timer on unmount.
  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const chapterEvents = useMemo(() => {
    if (!activeChapter) return [];
    return events
      .filter((e) => e.beginMs < activeChapter.endMs && e.endMs > activeChapter.atMs)
      .map((e) => {
        const r = recipeMap.get(e.effectId);
        return {
          id: e.id,
          start: e.beginMs,
          end: e.endMs,
          color: recipeColor(r),
          label: pickLabel(r, labelMode) || e.effectId,
        };
      });
  }, [events, activeChapter, recipeMap, labelMode]);

  // Snap the playhead to the active chapter's start when it changes, so the
  // baton begins inside the visible window rather than at 0. Also clear any
  // in-progress capture — marks belong to the chapter they were taken in.
  useEffect(() => {
    if (activeChapter) { setCurrentMs(activeChapter.atMs); setIsPlaying(false); }
    setBeginMs(null); setEndMs(null);
  }, [activeChapter?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Capture handlers ────────────────────────────────────────────────
  // Snap a raw playhead ms to the nearest beat when Snap is on and a beat
  // is within ~250 ms; otherwise leave it frame-precise.
  const snapMs = (ms) => {
    const beats = trackBeats?.beatsMs;
    if (!snap || !beats?.length) return Math.round(ms);
    let best = ms, bestD = Infinity;
    for (const b of beats) {
      const d = Math.abs(b - ms);
      if (d < bestD) { bestD = d; best = b; }
    }
    return bestD <= 250 ? Math.round(best) : Math.round(ms);
  };
  // Keep a captured mark inside the active chapter — snap-to-beat can pull a
  // mark a few ms ACROSS the boundary (e.g. capturing Begin at a chapter's
  // very start lands on the last beat of the prior chapter), which would file
  // the event under the wrong chapter. Clamp post-snap to the scope window.
  const clampToChapter = (ms) => {
    if (!activeChapter) return ms;
    return Math.max(activeChapter.atMs, Math.min(activeChapter.endMs, ms));
  };
  const handleCaptureBegin = () => setBeginMs(clampToChapter(snapMs(currentMs)));
  const handleCaptureEnd = () => setEndMs(clampToChapter(snapMs(currentMs)));
  const handleResetCapture = () => { setBeginMs(null); setEndMs(null); };

  // Commit the captured span as an event using the library's current effect
  // + device. Chain carries the end forward as the next begin (gapless);
  // otherwise the marks clear. Local-only until the .feel.yml wiring pass.
  const handleCommit = (config = {}) => {
    if (beginMs == null || endMs == null) return;
    const b = Math.min(beginMs, endMs);
    const e = Math.max(beginMs, endMs);
    if (e - b < 50) return;
    const base = {
      beginMs: b, endMs: e,
      effectId: selectedEffectId,
      devices: config.devices?.length ? config.devices : EVENT_DEVICES.map((d) => d.id),
      intensity: config.intensity != null ? config.intensity / 100 : 0.6,
      params: config.params || {},
      deviceCfg: config.deviceCfg || null,
    };
    const editing = selectedId && events.some((ev) => ev.id === selectedId);
    let next;
    if (editing) {
      // Update the selected event in place; stay in edit-mode on it.
      next = events
        .map((ev) => (ev.id === selectedId ? { ...ev, ...base } : ev))
        .sort((a, b2) => a.beginMs - b2.beginMs);
    } else {
      seqRef.current += 1;
      const id = `e-cap-${seqRef.current}`;
      next = [...events, { id, ...base }].sort((a, b2) => a.beginMs - b2.beginMs);
      // Stay in new-event mode (don't auto-select — that would flip us into
      // edit-mode and fight the chain carry-forward). Chain carries the end
      // forward as the next begin; otherwise clear the marks.
      if (chain) { setBeginMs(e); setEndMs(null); }
      else { setBeginMs(null); setEndMs(null); }
    }
    setEvents(next);
    persist(next);
  };

  const handleDeleteEvent = (id) => {
    const next = events.filter((e) => e.id !== id);
    setEvents(next);
    setSelectedId((s) => (s === id ? null : s));
    persist(next);
  };

  // ── Edger IO (FooterBar) ────────────────────────────────────────────
  // Export projects .feel.yml → playable <stem>.events.yml; Preview renders
  // the same YAML without writing; Import loads an Edger events.yml back into
  // the tab (replacing the working set) and writes it through to .feel.yml.
  const [ioBusy, setIoBusy] = useState(false);
  const [previewYaml, setPreviewYaml] = useState(null); // null | string (modal)
  const [ioNote, setIoNote] = useState(null); // null | { tone, text }

  const handleExport = async () => {
    if (!project?.path) return;
    setIoBusy(true);
    try {
      const res = await edgerExport(project.path, { write: true });
      let text = `Exported ${res.count} event${res.count === 1 ? '' : 's'} → ${res.path || 'events.yml'}`;
      if (res.skipped?.length) text += ` · skipped ${res.skipped.length} baseline`;
      setIoNote({ tone: 'ok', text });
    } catch (e) {
      setIoNote({ tone: 'err', text: `Export failed: ${e}` });
    } finally { setIoBusy(false); }
  };

  const handlePreview = async () => {
    if (!project?.path) return;
    setIoBusy(true);
    try {
      const res = await edgerExport(project.path, { write: false });
      setPreviewYaml(res?.yaml ?? 'events: []\n');
    } catch (e) {
      setIoNote({ tone: 'err', text: `Preview failed: ${e}` });
    } finally { setIoBusy(false); }
  };

  const handleImport = async () => {
    if (!project?.path) return;
    const picked = await pickEventsYmlFile(project.path);
    if (!picked) return;
    if (events.length > 0
      && !window.confirm(`Replace the ${events.length} current event${events.length === 1 ? '' : 's'} with the imported set?`)) {
      return;
    }
    setIoBusy(true);
    try {
      const res = await edgerImport(picked);
      const imported = (res?.events ?? []).map((e) => ({
        ...e,
        devices: e.devices?.length ? e.devices : EVENT_DEVICES.map((d) => d.id),
      }));
      setEvents(imported);
      persist(imported);
      setSelectedId(null);
      let maxSeq = 0;
      for (const e of imported) {
        const m = /^e-cap-(\d+)$/.exec(e.id || '');
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
      seqRef.current = maxSeq;
      let text = `Imported ${res.imported} event${res.imported === 1 ? '' : 's'}`;
      if (res.skipped?.length) {
        const head = res.skipped.slice(0, 3).join(', ');
        text += ` · skipped ${res.skipped.length} unknown (${head}${res.skipped.length > 3 ? '…' : ''})`;
      }
      setIoNote({ tone: res.skipped?.length ? 'warn' : 'ok', text });
    } catch (e) {
      setIoNote({ tone: 'err', text: `Import failed: ${e}` });
    } finally { setIoBusy(false); }
  };

  // Chapter clip for the monitor — same hook Chapters/Phrases use (stream-
  // copies the active chapter, blob/asset URL by size). Must run before the
  // early returns below (hook order). Null chapter → hook no-ops.
  const { clip: chapterClip, loading: chapterLoading } = useChapterClip(
    project?.mediaPath,
    activeChapter ?? null,
  );

  // Smooth baton clock. The MediaViewer hands its <video> up via videoElRef;
  // getLiveMs reads the real (un-throttled) media clock so TrackStack's baton
  // tracks the beats at 60fps. The clip plays at clip-relative time, so add
  // the same offset MediaViewer uses to report original-media ms.
  const videoElRef = useRef(null);
  const videoOffsetMs =
    chapterClip && chapterClip.chapterId === activeChapter?.id
      ? chapterClip.offsetMs
      : 0;
  const getLiveMs = useCallback(() => {
    const v = videoElRef.current;
    if (!v) return null;
    return v.currentTime * 1000 + videoOffsetMs;
  }, [videoOffsetMs]);

  if (!project?.path) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Events</h2>
        <p>Open a funscript from the Library tab to begin.</p>
      </section>
    );
  }

  if (chapters.length === 0) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Events</h2>
        <p>No chapters in this project — Events scopes to chapters, so detect or add chapters on the Chapters tab first.</p>
      </section>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px', background: 'var(--bg)' }}>
      {savedPulse && (
        <div style={{
          position: 'fixed', left: '50%', bottom: 84, transform: 'translateX(-50%)',
          zIndex: 50, padding: '10px 18px', borderRadius: 999,
          background: 'var(--accent, #ffb454)', color: '#1a1208', fontWeight: 700,
          fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', pointerEvents: 'none',
        }}>
          ✓ Events saved for this chapter
        </div>
      )}
      <Header
        eventCount={events.length}
        scopeCount={timelineEvents.length}
        scope={scope}
      />

      {activeChapter && (
        <>
          {/* CHAPTERS scope row — the shared ChapterRibbon (waveform bands,
              active outline), same as Chapters/Phrases/Stanzas. The single
              scope control for the work area (region 1 of the reconciled
              design): pick a band → the hero + monitor re-scope to it. */}
          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-dim)',
              flexShrink: 0, width: 64,
            }}>
              Chapters
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ChapterRibbon
                bands={chapters.map((c) => ({
                  id: c.id,
                  at_ms: c.atMs,
                  end_ms: c.endMs,
                  name: c.name,
                  color: c.color,
                }))}
                actions={actions}
                selectedId={activeChapter.id}
                onSelect={(band) => setScope(band.id)}
                showAxes={false}
                zoomable={false}
                height={36}
              />
            </div>
            {/* Accept-all lives ABOVE the chapter bar (footer stays uncluttered):
                one click marks every chapter considered so chaining to Channels
                unlocks without walking each one. Events already auto-save, so
                this only flips the gate — it never touches feel.yml. */}
            <button
              onClick={acceptAllChaptersAsIs}
              disabled={chaptersConsideredComplete}
              title="Mark every chapter considered and unlock chaining to Channels"
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
          </div>

          {/* Chapter identity + Collapse — the design's title row. */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, marginTop: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: activeChapter.color || '#888', flexShrink: 0 }} />
              <span style={{ fontSize: 15, fontWeight: 700 }}>{activeChapter.name || activeChapter.id}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {fmtTimeShort(activeChapter.atMs)}–{fmtTimeShort(activeChapter.endMs)}
                {' · '}{fmtTimeShort(activeChapter.endMs - activeChapter.atMs)}
                {' · '}{chapterEvents.length} event{chapterEvents.length === 1 ? '' : 's'}
              </span>
            </div>
            {/* Subtle Collapse — matches the Stanzas/Phrases title-row
                button (transparent, thin border, dim), not the bolder
                secondary Button. */}
            <button
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Expand' : 'Collapse'}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
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
              <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} />
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>

        {!collapsed && (
        // Single box around the funscript view + monitor, same as
        // Stanzas/Phrases (outer surface/border; no inner card border).
        <div style={{
          marginTop: 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 12,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 14, alignItems: 'start',
        }}>
          {/* Left — TrackStack hero (no inner box) */}
          <div style={{ minWidth: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: 6,
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                click to move the playhead · click an event to select
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                {fmtTime(currentMs)}
              </span>
            </div>
            <TrackStack
              scope={{ start: activeChapter.atMs, end: activeChapter.endMs }}
              actions={actions}
              events={chapterEvents}
              waveform={audioWaveform}
              spectrogram={trackSpectrogram}
              beats={trackBeats}
              lanes={['events', 'funscript', 'audio', 'spectro']}
              funscriptColorMode="velocity"
              currentMs={currentMs}
              getLiveMs={getLiveMs}
              selectedEventId={selectedId}
              onSeek={setCurrentMs}
              onSelectEvent={(id) => setSelectedId((s) => (s === id ? null : id))}
            />
          </div>

          {/* Right — reference monitor. Shares currentMs with the stack:
              video timeupdate drives the baton; the Events transport
              (chapter-start/end, ±1s, frame, play) + speed bar drive
              frame-precise begin/end landing. */}
          <MediaViewer
            width="100%"
            videoElRef={videoElRef}
            thumbnailAspect="16/9"
            videoSrc={
              chapterClip && chapterClip.chapterId === activeChapter.id
                ? chapterClip.url
                : (chapterLoading ? undefined : toMediaUrl(project?.mediaPath))
            }
            videoSrcOffsetMs={
              chapterClip && chapterClip.chapterId === activeChapter.id
                ? chapterClip.offsetMs
                : 0
            }
            media={{ kind: project?.mediaKind ?? 'video', title: activeChapter.name || activeChapter.id }}
            loadingLabel={chapterLoading ? 'Loading chapter…' : null}
            chapter={{
              id: activeChapter.id,
              title: activeChapter.name || activeChapter.id,
              color: activeChapter.color,
              start: activeChapter.atMs,
              end: activeChapter.endMs,
            }}
            funscript={{ actions }}
            audioWaveform={audioWaveform}
            spectrogram={trackSpectrogram}
            beats={trackBeats}
            currentMs={currentMs}
            totalMs={totalMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            onSeek={(ms) => setCurrentMs(Math.max(activeChapter.atMs, Math.min(activeChapter.endMs, ms)))}
            // Stop at the chapter boundary. A per-chapter CLIP ends there on its
            // own, but a DIRECT-PLAY source plays the whole video — so without an
            // explicit pause it runs past the chapter. Clamp the baton AND pause.
            onTimeChange={(ms) => {
              if (ms >= activeChapter.endMs) {
                setCurrentMs(activeChapter.endMs);
                setIsPlaying(false);
              } else if (ms < activeChapter.atMs) {
                setCurrentMs(activeChapter.atMs);
              } else {
                setCurrentMs(ms);
              }
            }}
            // Steps grow outward from play: frame hugs play, then ±1s, then
            // the chapter-edge jumps. (1s is a bigger move than 1 frame.)
            controls={['chapter-start', 'back1', 'frame-back', 'play', 'frame-forward', 'forward1', 'chapter-end']}
            showSpeed
            showMark={false}
            modeToggleAlign="start"
            modeToggleSize="sm"
          />
        </div>
        )}

        {/* Capture bar (step ① — mark begin/end from the playhead). */}
        <CaptureBar
          beginMs={beginMs}
          endMs={endMs}
          chain={chain}
          snap={snap}
          canSnap={!!trackBeats?.beatsMs?.length}
          scopeStart={activeChapter.atMs}
          scopeEnd={activeChapter.endMs}
          onCaptureBegin={handleCaptureBegin}
          onCaptureEnd={handleCaptureEnd}
          onBeginChange={setBeginMs}
          onEndChange={setEndMs}
          onToggleChain={() => setChain((v) => !v)}
          onToggleSnap={() => setSnap((v) => !v)}
          onReset={handleResetCapture}
        />
        </>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px minmax(360px, 1fr) 360px',
          gap: 14,
          marginTop: 12,
          alignItems: 'start',
        }}
      >
        <EffectLibrary
          recipes={recipes}
          groups={catalog.groups ?? []}
          selectedEffectId={selectedEffectId}
          onSelectEffect={setSelectedEffectId}
          labelMode={labelMode}
          onLabelMode={setLabelMode}
        />

        <CapturePane
          recipe={recipeById(selectedEffectId)}
          beginMs={beginMs}
          endMs={endMs}
          editingEvent={selectedId ? selectedEvent : null}
          labelMode={labelMode}
          onAddEvent={handleCommit}
        />

        <TimelinePane
          events={timelineEvents}
          totalEvents={events.length}
          scope={scope}
          chapters={chapters}
          recipeFor={recipeById}
          labelMode={labelMode}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={(id) => setSelectedId(id)}
          onDelete={handleDeleteEvent}
          onNewEvent={() => setSelectedId(null)}
        />
      </div>

      <FooterBar
        eventCount={events.length}
        scopeLabel={scope === 'all'
          ? 'All chapters'
          : (chapters.find((c) => c.id === scope)?.name ?? 'chapter')}
        busy={ioBusy}
        note={ioNote}
        onExport={handleExport}
        onPreview={handlePreview}
        onImport={handleImport}
      />

      {previewYaml != null && (
        <YamlPreviewModal yaml={previewYaml} onClose={() => setPreviewYaml(null)} />
      )}
    </div>
  );
}

// Lightweight read-only preview of the rendered events.yml — what `edger-export`
// would write. Click the backdrop or Close to dismiss; Copy puts it on the
// clipboard.
function YamlPreviewModal({ yaml, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 'min(680px, 92vw)', maxHeight: '82vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="file-text" size={15} style={{ color: 'var(--text-dim)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>events.yml — preview</span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>(not written)</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button kind="ghost" size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(yaml)}>Copy</Button>
            <Button kind="secondary" size="sm" icon="x" onClick={onClose}>Close</Button>
          </div>
        </div>
        <pre style={{
          margin: 0, padding: 16, overflow: 'auto', flex: 1,
          fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55,
          color: 'var(--text-soft)', whiteSpace: 'pre',
        }}>
          {yaml}
        </pre>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────
function Header({ eventCount, scopeCount, scope }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, marginBottom: 4,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>
          Events · point-in-time enhancements
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
          Drop effects on moments
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4,
          maxWidth: 720, lineHeight: 1.45,
        }}>
          Effects layer on the generated output channels — they don't rewrite the funscript.
          One verb hits any device that supports it. Capture, parameter forms, and YAML persistence land in the wiring pass.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Pill tone="info" dot>{eventCount} total</Pill>
        <Pill tone="neutral">{scopeCount} in scope</Pill>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CaptureBar — step ①: mark begin / end from the playhead
// Neutral (grey) palette — no accent fills. Begin/End grab the current
// playhead position (optionally snapped to beat); DURATION is derived;
// Chain / Snap are sticky toggles; + Add event commits the span.
// ──────────────────────────────────────────────────────────────
function fmtClock(ms) {
  if (ms == null || Number.isNaN(ms)) return '––:––.–––';
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const f = total % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

// Shared step badge — ① capture · ② library · ③ config. One look: red fill,
// dark glyph, 22px (matches the config card's ③).
const STEP_RED = '#ff5a5f';
function StepBadge({ n }) {
  return (
    <span style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: STEP_RED, color: '#0d0d0d', fontSize: 12, fontWeight: 800,
    }}>{n}</span>
  );
}

// CaptureBar (+ its TargetDot / GreyCheck / CaptureButton / ClockField / parseClock
// helpers) now lives in forgemoment — imported at the top of this file. fmtClock
// and StepBadge stay local because other sections of this tab use them.

// ──────────────────────────────────────────────────────────────
// EffectLibrary — step ②: search + collapsible source groups
// (Featured · General · MCB · Clutch · Test) over the 32 Edger events.
// ──────────────────────────────────────────────────────────────
function RecipeRow({ recipe, selected, labelMode, onSelect }) {
  const c = recipeColor(recipe);
  const blend = recipeBlend(recipe);
  return (
    <button
      onClick={() => onSelect(recipe.id)}
      title={recipe.desc || recipe.name}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '7px 12px', width: '100%', textAlign: 'left',
        background: selected ? 'var(--surface-2)' : 'transparent',
        border: 'none',
        borderLeft: selected ? `3px solid ${c}` : '3px solid transparent',
        color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      <RecipeGlyph recipe={recipe} color={c} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: selected ? 'var(--text)' : 'var(--text-soft)' }}>
            {pickLabel(recipe, labelMode)}
          </span>
          {recipe.baseline && (
            <span style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px',
            }}>baseline</span>
          )}
          {blend === 'overwrite' && (
            <span title={BLEND_META.overwrite.tip} style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: BLEND_META.overwrite.color, flexShrink: 0,
            }}>replaces</span>
          )}
        </div>
        <div className="mono" style={{
          fontSize: 9.5, color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {recipe.name}{recipe.steps?.length ? ` · ${recipe.steps.length} step${recipe.steps.length === 1 ? '' : 's'}` : ''}
        </div>
      </div>
    </button>
  );
}

function EffectLibrary({ recipes, groups, selectedEffectId, labelMode, onLabelMode, onSelectEffect }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set(['mcb', 'clutch', 'test']));
  const toggle = (key) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const q = query.trim().toLowerCase();
  const matches = (r) => !q
    || (r.sfwLabel || r.label || '').toLowerCase().includes(q)
    || (r.name || '').toLowerCase().includes(q)
    || (r.nsfwLabel || '').toLowerCase().includes(q)
    || (r.desc || '').toLowerCase().includes(q);

  // Normal is pinned ABOVE the sections as a permanent baseline anchor (it's a
  // navigation tool, not an effect) — hidden only while searching.
  const normal = recipes.find((r) => r.baseline) || null;
  // Section list: Featured (curated quick-access set) first, then catalog
  // groups. Featured is the `featured` flag (a ~10-event curation), distinct
  // from `branded` (now all 32 carry an SFW label).
  const sections = [
    { key: 'featured', name: 'Featured', items: recipes.filter((r) => r.featured && !r.baseline && matches(r)) },
    ...(groups || []).map((g) => ({
      key: g.key, name: GROUP_NAMES[g.key] || g.name,
      items: recipes.filter((r) => r.group === g.key && !r.baseline && matches(r)),
    })),
  ].filter((s) => s.items.length > 0);

  const modeBtn = (m) => ({
    padding: '2px 9px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    background: labelMode === m ? 'var(--text-muted)' : 'transparent',
    color: labelMode === m ? 'var(--bg)' : 'var(--text-dim)',
    border: 'none',
  });

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', maxHeight: 560,
    }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StepBadge n={2} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <SectionLabel>Effect library</SectionLabel>
          </div>
          {/* SFW / NSFW label toggle — SFW default (store positioning). */}
          <div style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 1 }}>
            <button type="button" onClick={() => onLabelMode('sfw')} style={modeBtn('sfw')} title="Friendly labels">SFW</button>
            <button type="button" onClick={() => onLabelMode('nsfw')} style={modeBtn('nsfw')} title="Raw intent labels">NSFW</button>
          </div>
        </div>
        <div style={{ position: 'relative', marginTop: 6 }}>
          <Icon name="search" size={12} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-dim)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '5px 8px 5px 26px',
              borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 11.5, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Pinned baseline — always reachable above the source groups. */}
      {normal && !q && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          <RecipeRow recipe={normal} selected={normal.id === selectedEffectId} labelMode={labelMode} onSelect={onSelectEffect} />
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {sections.map((s) => {
          const isCollapsed = !q && collapsed.has(s.key);
          const c = GROUP_COLORS[s.key] || 'var(--text-muted)';
          return (
            <div key={s.key}>
              <button
                onClick={() => toggle(s.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '8px 12px 4px', background: 'transparent', border: 'none',
                  cursor: q ? 'default' : 'pointer', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: c, fontFamily: 'inherit',
                }}
              >
                {!q && <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={11} />}
                <span style={{ width: 6, height: 6, borderRadius: 1, background: c }} />
                {s.name}
                <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontWeight: 600 }}>
                  {s.items.length}
                </span>
              </button>
              {!isCollapsed && s.items.map((r) => (
                <RecipeRow key={`${s.key}-${r.id}`} recipe={r} selected={r.id === selectedEffectId} labelMode={labelMode} onSelect={onSelectEffect} />
              ))}
            </div>
          );
        })}
        {sections.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11.5, color: 'var(--text-dim)' }}>
            No events match “{query}”.
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CapturePane — step ③ effect config. Top (full-width): name · section ·
// description. Two columns: LEFT = "what this produces" (humanized step
// stack); RIGHT = stacked sliders (intensity + real params). Below: device
// profiles (broadcast/override) + Add event. Accent = source-group color.
// ──────────────────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step, unit, color, onChange, fmt }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
          {fmt ? fmt(value) : value}
          {unit ? <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>{unit}</span> : null}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
      />
    </div>
  );
}

function CapturePane({ recipe, beginMs, endMs, editingEvent, labelMode, onAddEvent }) {
  const recId = recipe?.id;
  const editId = editingEvent?.id;
  const isEditing = !!editingEvent;
  const [intensity, setIntensity] = useState(70);
  const [paramVals, setParamVals] = useState({});
  const [deviceCfg, setDeviceCfg] = useState({});

  // Load config from the edited event (when its recipe is armed) else the
  // recipe defaults. Re-runs when the armed recipe OR the edited event changes.
  useEffect(() => {
    if (!recipe) return;
    const defaultDevices = () => {
      const dc = {};
      EVENT_DEVICES.forEach((d) => { dc[d.id] = { mode: 'broadcast', value: 100 }; });
      return dc;
    };
    const params = recipe.params || [];
    if (editingEvent && editingEvent.effectId === recipe.id) {
      setIntensity(Math.round((editingEvent.intensity ?? (recipe.baseline ? 1 : 0.7)) * 100));
      const pv = {};
      params.forEach((p) => { pv[p.key] = editingEvent.params?.[p.key] != null ? editingEvent.params[p.key] : p.def; });
      setParamVals(pv);
      setDeviceCfg(editingEvent.deviceCfg || defaultDevices());
    } else {
      setIntensity(recipe.baseline ? 100 : 70);
      const pv = {};
      params.forEach((p) => { pv[p.key] = p.def; });
      setParamVals(pv);
      setDeviceCfg(defaultDevices());
    }
  }, [recId, editId]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!recipe) {
    return (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 14, minHeight: 360,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'var(--text-dim)',
      }}>
        Loading effects…
      </div>
    );
  }

  const color = recipeColor(recipe);
  const section = GROUP_NAMES[recipe.group] || recipe.group;
  const params = recipe.params || [];
  const title = pickLabel(recipe, labelMode);
  const blend = recipeBlend(recipe);
  const stepLines = recipe.baseline
    ? [{ text: 'Baseline — no enhancement. Holds coverage so chained captures stay gapless.', mode: null }]
    : humanizeSteps(recipe.steps, paramVals, recipe.defaultParams);
  const dur = (beginMs != null && endMs != null) ? Math.abs(endMs - beginMs) : null;
  const ready = beginMs != null && endMs != null && dur >= 50;
  const canAdd = ready;

  const toggleMode = (id) => setDeviceCfg((prev) => {
    const next = prev[id]?.mode === 'override' ? 'broadcast' : 'override';
    return { ...prev, [id]: { mode: next, value: next === 'override' ? intensity : 100 } };
  });

  const commit = () => {
    if (!canAdd) return;
    onAddEvent({
      intensity,
      params: paramVals,
      devices: EVENT_DEVICES.map((d) => d.id),
      deviceCfg,
    });
  };

  const fmtParam = (p, v) => (p.step < 1 ? Number(v).toFixed(2) : String(v));

  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${color}66`,
      borderRadius: 10, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
      minHeight: 360,
    }}>
      {/* TOP (full width) — ③ · name · section · description */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StepBadge n={3} />
        <RecipeGlyph recipe={recipe} color={color} w={30} h={16} />
        <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
        <span style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
          color, background: `${color}22`, borderRadius: 4, padding: '2px 7px',
        }}>
          {section}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: isEditing ? color : 'var(--text-dim)' }}>
          {isEditing ? 'editing' : 'armed'}
        </span>
      </div>
      {recipe.desc && (
        <div style={{ fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5, marginTop: -4 }}>
          {recipe.desc}
        </div>
      )}

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* TWO COLUMNS — left: what this produces · right: stacked sliders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        {/* LEFT — what this produces (the step stack) + blend badge */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginBottom: 6,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>
              What this produces
            </span>
            {blend && (
              <span title={BLEND_META[blend].tip} style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase',
                color: BLEND_META[blend].color, background: `${BLEND_META[blend].color}1f`,
                borderRadius: 4, padding: '2px 6px', flexShrink: 0,
              }}>
                {BLEND_META[blend].label}
              </span>
            )}
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stepLines.map((line, i) => (
              <li key={i} style={{
                fontSize: 11.5, color: 'var(--text-soft)', lineHeight: 1.4,
                display: 'flex', gap: 6,
              }}>
                {!recipe.baseline && (
                  <span className="mono" style={{ color, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                )}
                <span>
                  {line.text}
                  {line.mode === 'overwrite' && (
                    <span style={{ color: BLEND_META.overwrite.color, fontSize: 10, fontWeight: 700 }}> · replaces</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* RIGHT — stacked sliders (intensity + params) */}
        <div style={{ minWidth: 0 }}>
          <SliderRow
            label="Intensity" value={intensity} min={0} max={100} step={1}
            color={color} onChange={(v) => setIntensity(Math.round(v))}
          />
          {params.map((p) => (
            <SliderRow
              key={p.key}
              label={p.label} value={paramVals[p.key] ?? p.def}
              min={p.min} max={p.max} step={p.step} unit={p.unit} color={color}
              fmt={(v) => fmtParam(p, v)}
              onChange={(v) => setParamVals((vals) => ({ ...vals, [p.key]: v }))}
            />
          ))}
        </div>
      </div>

      {/* Commit — directly under the parameters so it's the obvious next move.
          Device overrides live below as a secondary refinement. */}
      {ready ? (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
          {fmtClock(Math.min(beginMs, endMs))} → {fmtClock(Math.max(beginMs, endMs))} · {fmtClock(dur)}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
          Capture a begin and end above to enable.
        </div>
      )}
      <button
        type="button"
        onClick={commit}
        disabled={!canAdd}
        title={canAdd
          ? (isEditing ? `Update ${title} event` : `Add ${title} event`)
          : 'Capture a begin and end first'}
        style={{
          padding: '13px 16px', borderRadius: 9, width: '100%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: canAdd ? color : 'var(--surface-2)', border: 'none',
          color: canAdd ? '#fff' : 'var(--text-dim)',
          fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
          cursor: canAdd ? 'pointer' : 'default',
        }}
      >
        <Icon name={isEditing ? 'check' : 'plus'} size={16} /> {isEditing ? 'Update event' : 'Add event'}
      </button>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Devices — broadcast / override + per-device `gets` (volume-as-intensity) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            Devices
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>○ broadcast · ● override</span>
        </div>
        {EVENT_DEVICES.map((d) => {
          const cfg = deviceCfg[d.id];
          const override = cfg?.mode === 'override';
          const value = override ? (cfg.value ?? intensity) : intensity;
          return (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 2px' }}>
              <button
                type="button"
                onClick={() => toggleMode(d.id)}
                title={override ? 'Override — click for broadcast' : 'Broadcast — click for override'}
                style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: override ? color : 'transparent',
                  border: `1.5px solid ${override ? color : 'var(--text-dim)'}`,
                  cursor: 'pointer',
                }}
              >
                {override && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0d0d0d' }} />}
              </button>
              <div style={{ width: 130, flexShrink: 0, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{d.label}</div>
                <div style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>{d.gets}</div>
              </div>
              {override ? (
                <input
                  type="range" min={0} max={100} step={1} value={cfg.value ?? intensity}
                  onChange={(e) => setDeviceCfg((prev) => ({
                    ...prev, [d.id]: { mode: 'override', value: parseInt(e.target.value, 10) },
                  }))}
                  style={{ flex: 1, minWidth: 0, accentColor: color, cursor: 'pointer' }}
                />
              ) : (
                <span style={{ fontSize: 12, flex: 1, color: 'var(--text-soft)' }}>broadcast</span>
              )}
              <span className="mono" style={{ fontSize: 13, flexShrink: 0, width: 34, textAlign: 'right' }}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TimelinePane — right
// ──────────────────────────────────────────────────────────────
function TimelinePane({ events, totalEvents, scope, chapters, recipeFor, labelMode, selectedId, onSelect, onEdit, onDelete, onNewEvent }) {
  const grouped = chapters.map((ch) => ({
    ch,
    items: events.filter((e) => e.beginMs >= ch.atMs && e.beginMs < ch.endMs),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, display: 'flex', flexDirection: 'column',
      maxHeight: 560,
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>Timeline</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          {events.length}{scope !== 'all' ? ` of ${totalEvents}` : ''} events
        </span>
      </div>

      {events.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
          No events in scope.
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {grouped.map(({ ch, items }) => (
          <div key={ch.id}>
            <div style={{
              position: 'sticky', top: 0, zIndex: 1,
              padding: '6px 12px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--border)',
              borderTop: '1px solid var(--border)',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 1, background: ch.color || '#888' }} />
              <span style={{ color: ch.color || 'var(--text)' }}>{ch.name || ch.id}</span>
              <span className="mono" style={{
                marginLeft: 'auto', color: 'var(--text-dim)', fontWeight: 600,
              }}>
                {items.length}
              </span>
            </div>
            {items.map((evt) => (
              <TimelineRow
                key={evt.id}
                evt={evt}
                recipe={recipeFor?.(evt.effectId)}
                labelMode={labelMode}
                selected={evt.id === selectedId}
                onSelect={() => onSelect(evt.id === selectedId ? null : evt.id)}
                onEdit={() => onEdit(evt.id)}
                onDelete={() => onDelete(evt.id)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* New-event affordance — explicit escape from edit-mode back to a
          blank, armed capture (clears the selection). Clicking a row body
          toggles select, but once you'd edited one there was no DISCOVERABLE
          way back to "add a new one" (dogfood 2026-06-16). Lives at the
          bottom-right of the list, below the last entry; lights up accent
          while an event is selected to read as "leave editing, start fresh." */}
      <div style={{
        padding: '8px 10px', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          type="button"
          onClick={onNewEvent}
          title="Start a new event (clears the editor)"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 7,
            background: selectedId ? 'var(--accent)' : 'var(--surface-2)',
            border: `1px solid ${selectedId ? 'var(--accent)' : 'var(--border)'}`,
            color: selectedId ? '#fff' : 'var(--text)',
            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          <Icon name="plus" size={15} /> New event
        </button>
      </div>
    </div>
  );
}

function TimelineRow({ evt, recipe, labelMode, selected, onSelect, onEdit, onDelete }) {
  const color = recipeColor(recipe);
  const label = pickLabel(recipe, labelMode) || evt.effectId;
  const dur = evt.endMs - evt.beginMs;
  const rowBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 5, padding: 0,
    background: 'transparent', border: '1px solid transparent',
    color: 'var(--text-dim)', cursor: 'pointer',
  };
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '84px 1fr auto',
        gap: 8, padding: '7px 12px', cursor: 'pointer',
        background: selected ? 'var(--surface-2)' : 'transparent',
        borderLeft: `3px solid ${selected ? color : 'transparent'}`,
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
      }}
    >
      {/* Begin AND end, in the precise mm:ss.mmm the capture bar takes — so
          the end time is directly reusable as the next event's start (manual
          chaining; dogfood 2026-06-16). The Chain toggle does this auto, but
          users often tweak in between and re-enter the exact end by hand. */}
      <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.4 }}>
        <div style={{ color: 'var(--text-soft)' }}>{fmtClock(evt.beginMs)}</div>
        <div style={{ color: 'var(--text-dim)' }} title="end — reuse as next start">
          {fmtClock(evt.endMs)}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RecipeGlyph recipe={recipe} color={color} w={22} h={12} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            +{(dur / 1000).toFixed(1)}s
          </span>
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
          {evt.devices.map((d) => (
            <span key={d} className="mono" style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: 'var(--bg)', border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}>{d}</span>
          ))}
        </div>
      </div>
      {/* Row actions — edit (rehydrate into the capture bar + config) and
          delete. stopPropagation so they don't also toggle row-select. */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <button
          type="button" title="Edit event"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={rowBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          <Icon name="pencil" size={13} />
        </button>
        <button
          type="button" title="Delete event"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={rowBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'transparent'; }}
        >
          <Icon name="trash-2" size={13} />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// FooterBar
// ──────────────────────────────────────────────────────────────
function FooterBar({ eventCount, scopeLabel, busy, note, onExport, onPreview, onImport }) {
  const noEvents = eventCount === 0;
  const noteColor = note?.tone === 'err' ? '#ff6b6b'
    : note?.tone === 'warn' ? '#ffb547'
      : note?.tone === 'ok' ? '#5dc98a' : 'var(--text-dim)';
  return (
    <div style={{
      marginTop: 16, padding: 14,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      {/* Export is the headline action — write the playable Edger events.yml. */}
      <Button kind="primary" size="sm" icon="download" onClick={onExport} disabled={busy || noEvents}>
        Export events.yml
      </Button>
      <Button kind="secondary" size="sm" icon="upload" onClick={onImport} disabled={busy}>
        Load Edger yml…
      </Button>
      <Button kind="ghost" size="sm" icon="file-text" onClick={onPreview} disabled={busy || noEvents}>
        Preview events.yml
      </Button>
      <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
      <Button kind="ghost" size="sm" icon="box" disabled title="Bundled example packs — coming soon">
        Starter packs
      </Button>

      <span style={{ flex: 1, minWidth: 12 }} />

      {note && (
        <span style={{ fontSize: 11, color: noteColor, maxWidth: 420, textAlign: 'right' }}>
          {note.text}
        </span>
      )}
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {eventCount} event{eventCount === 1 ? '' : 's'} · scope: <span style={{ color: 'var(--text)' }}>{scopeLabel}</span>
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Local helpers
// ──────────────────────────────────────────────────────────────
function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-muted)',
    }}>
      <span>{children}</span>
      {right}
    </div>
  );
}
