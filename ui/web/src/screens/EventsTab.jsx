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
//   ┌──────────────┬───────────────────────────┬──────────────┐
//   │  Library     │  Capture                  │  Timeline    │
//   │  (devices +  │  (selected effect +       │  (events by  │
//   │   effect     │   placeholder "wiring     │   chapter,   │
//   │   list)      │   later")                 │   read-only) │
//   └──────────────┴───────────────────────────┴──────────────┘
//   ┌────────────────────────────────────────────────────────┐
//   │  EventsTimelineStrip — full-width SVG                 │
//   │   lanes of event brackets · chapter band · funscript  │
//   └────────────────────────────────────────────────────────┘
//   ┌────────────────────────────────────────────────────────┐
//   │  Footer — counts + "wiring later" disabled actions    │
//   └────────────────────────────────────────────────────────┘
//
// Events are DURABLE: seeded from the canonical <stem>.feel.yml on project
// load (readFeelEvents) and written through on every discrete mutation —
// add / edit / delete (saveFeelEvents, fire-and-forget). The funscript is
// never touched; events layer on the output channels. Chapter scope + the
// selected/edited event id stay tab-local session state.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Button, Icon, fmtTime, fmtTimeShort, TrackStack, MediaViewer, ChapterRibbon, ShapeGlyph } from 'forgemoment';
import {
  EVENT_DEVICES,
  EVENT_FAMILIES,
  EVENT_EFFECTS,
  NORMAL_EFFECT,
  findEffect,
  familyOf,
  paramsFor,
} from '../data/events.js';
import { readFeelEvents, saveFeelEvents } from '../api/forge.js';
import { useChapterClip } from '../hooks/useChapterClip.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

export default function EventsTab({
  project, selectedDevices = [],
  trackPeaks = null, trackSpectrogram = null, trackBeats = null,
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
        setEvents(loaded);
        // Seed the id counter past any e-cap-N already on disk so new
        // captures can't collide with persisted ids after a reload.
        let maxSeq = 0;
        for (const e of loaded) {
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

  const [scope, setScope] = useState('all'); // 'all' | chapter id
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
  const [libDevice, setLibDevice] = useState(() => {
    const proj = selectedDevices?.[0];
    if (proj && EVENT_DEVICES.find((d) => d.id === proj)) return proj;
    return EVENT_DEVICES[0].id;
  });
  // Pre-arm "Normal" (decision #5) — open Events ready to chain-capture
  // baseline coverage without picking an effect first.
  const [selectedEffectId, setSelectedEffectId] = useState(NORMAL_EFFECT.id);

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
    return events.filter((e) => e.beginMs >= ch.atMs && e.beginMs < ch.endMs);
  }, [events, scope, chapters]);

  const densityByChapter = useMemo(() => {
    const map = {};
    chapters.forEach((c) => { map[c.id] = 0; });
    events.forEach((e) => {
      const ch = chapters.find((c) => e.beginMs >= c.atMs && e.beginMs < c.endMs);
      if (ch) map[ch.id] += 1;
    });
    return map;
  }, [events, chapters]);

  const filterChapter = (id) => setScope((s) => (s === id ? 'all' : id));

  // ── Chapter-scoped hero (Stage 1a: TrackStack) ──────────────────────
  // The hero shows ONE chapter at a time: the scoped chapter when the user
  // has picked one, else the first chapter. Events overlapping that window
  // map to TrackStack's generic span shape (vocabulary stays here, not in
  // forgemoment — same pattern as ShapeGlyph).
  const activeChapter = useMemo(() => {
    if (scope !== 'all') return chapters.find((c) => c.id === scope) ?? chapters[0];
    return chapters[0];
  }, [scope, chapters]);

  const chapterEvents = useMemo(() => {
    if (!activeChapter) return [];
    return events
      .filter((e) => e.beginMs < activeChapter.endMs && e.endMs > activeChapter.atMs)
      .map((e) => {
        const eff = findEffect(e.effectId);
        const fam = familyOf(eff);
        return {
          id: e.id,
          start: e.beginMs,
          end: e.endMs,
          color: fam?.color,
          label: eff?.label || e.effectId,
        };
      });
  }, [events, activeChapter]);

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
  const handleCaptureBegin = () => setBeginMs(snapMs(currentMs));
  const handleCaptureEnd = () => setEndMs(snapMs(currentMs));
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
      devices: config.devices?.length ? config.devices : [libDevice],
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

  // Chapter clip for the monitor — same hook Chapters/Phrases use (stream-
  // copies the active chapter, blob/asset URL by size). Must run before the
  // early returns below (hook order). Null chapter → hook no-ops.
  const { clip: chapterClip, loading: chapterLoading } = useChapterClip(
    project?.mediaPath,
    activeChapter ?? null,
  );

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
          gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 14, alignItems: 'start',
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
              lanes={['events', 'funscript']}
              funscriptColorMode="velocity"
              currentMs={currentMs}
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
            onTimeChange={(ms) => setCurrentMs(Math.max(activeChapter.atMs, Math.min(activeChapter.endMs, ms)))}
            // Steps grow outward from play: frame hugs play, then ±1s, then
            // the chapter-edge jumps. (1s is a bigger move than 1 frame.)
            controls={['chapter-start', 'back1', 'frame-back', 'play', 'frame-forward', 'forward1', 'chapter-end']}
            showSpeed
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
          onCaptureBegin={handleCaptureBegin}
          onCaptureEnd={handleCaptureEnd}
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
          libDevice={libDevice}
          onDeviceChange={setLibDevice}
          selectedEffectId={selectedEffectId}
          onSelectEffect={setSelectedEffectId}
        />

        <CapturePane
          effect={findEffect(selectedEffectId)}
          libDevice={libDevice}
          beginMs={beginMs}
          endMs={endMs}
          editingEvent={selectedId ? selectedEvent : null}
          onAddEvent={handleCommit}
        />

        <TimelinePane
          events={timelineEvents}
          totalEvents={events.length}
          scope={scope}
          chapters={chapters}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={(id) => setSelectedId(id)}
          onDelete={handleDeleteEvent}
        />
      </div>

      <EventsTimelineStrip
        events={events}
        scope={scope}
        chapters={chapters}
        density={densityByChapter}
        actions={actions}
        totalMs={totalMs}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onFilterChapter={filterChapter}
      />

      <FooterBar
        eventCount={events.length}
        scopeLabel={scope === 'all'
          ? 'All chapters'
          : (chapters.find((c) => c.id === scope)?.name ?? 'chapter')}
      />
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

function TargetDot({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="7" cy="7" r="1.6" fill="currentColor" />
    </svg>
  );
}

function GreyCheck({ checked, disabled, label, onToggle }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      title={disabled ? `${label} — needs beats` : label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: 'transparent', border: 'none', padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? 'var(--text-dim)' : 'var(--text-soft)',
        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? 'var(--text-muted)' : 'transparent',
        border: `1px solid ${checked ? 'var(--text-muted)' : 'var(--border)'}`,
        color: 'var(--bg)', fontSize: 11, fontWeight: 800, lineHeight: 1,
      }}>
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

function CaptureButton({ label, set, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} from playhead`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '7px 13px', borderRadius: 7,
        background: set ? 'var(--surface-2)' : 'var(--bg)',
        border: `1px solid ${set ? 'var(--text-dim)' : 'var(--border)'}`,
        color: set ? 'var(--text)' : 'var(--text-soft)',
        fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}
    >
      <TargetDot />
      Capture
    </button>
  );
}

function ClockField({ ms }) {
  const set = ms != null;
  return (
    <span className="mono" style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '7px 12px', borderRadius: 7, minWidth: 96, justifyContent: 'center',
      background: 'var(--bg)', border: '1px solid var(--border)',
      color: set ? 'var(--text)' : 'var(--text-dim)',
      fontSize: 14, fontWeight: 600, letterSpacing: '0.02em',
    }}>
      {fmtClock(ms)}
    </span>
  );
}

function CaptureBar({
  beginMs, endMs, chain, snap, canSnap,
  onCaptureBegin, onCaptureEnd, onToggleChain, onToggleSnap, onReset,
}) {
  const dur = (beginMs != null && endMs != null) ? Math.abs(endMs - beginMs) : null;

  return (
    <div style={{
      marginTop: 12, padding: '14px 16px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      {/* Row 1 — mark begin / end */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <StepBadge n={1} />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          Mark begin / end from playhead
        </span>

        <span style={{ width: 8 }} />

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Begin</span>
        <CaptureButton label="Begin" set={beginMs != null} onClick={onCaptureBegin} />
        <ClockField ms={beginMs} />

        <Icon name="arrow-right" size={14} style={{ color: 'var(--text-dim)' }} />

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>End</span>
        <CaptureButton label="End" set={endMs != null} onClick={onCaptureEnd} />
        <ClockField ms={endMs} />
      </div>

      {/* Row 2 — derived duration · toggles · reset · add */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginTop: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'var(--text-dim)',
          }}>
            Duration · derived
          </div>
          <div className="mono" style={{
            fontSize: 18, fontWeight: 600, marginTop: 1,
            color: dur != null ? 'var(--text)' : 'var(--text-dim)',
          }}>
            {dur != null ? fmtClock(dur) : '––:––.–––'}
          </div>
        </div>

        <span style={{ flex: 1 }} />

        <GreyCheck checked={chain} label="Chain" onToggle={onToggleChain} />
        <GreyCheck checked={snap && canSnap} disabled={!canSnap} label="Snap to beat" onToggle={onToggleSnap} />

        <button
          type="button"
          onClick={onReset}
          disabled={beginMs == null && endMs == null}
          title="Clear marks"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '6px 11px', borderRadius: 7,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-soft)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
            opacity: (beginMs == null && endMs == null) ? 0.5 : 1,
          }}
        >
          <Icon name="rotate-ccw" size={12} /> Reset
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// EffectLibrary — left pane
// ──────────────────────────────────────────────────────────────
function EffectLibrary({ libDevice, onDeviceChange, selectedEffectId, onSelectEffect }) {
  const filtered = EVENT_EFFECTS.filter((e) => e.devices.includes(libDevice));
  const byFamily = {};
  filtered.forEach((e) => {
    (byFamily[e.family] = byFamily[e.family] || []).push(e);
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
            <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{filtered.length}</span>}>
              Effect library
            </SectionLabel>
          </div>
        </div>
        <div style={{
          display: 'flex', gap: 2, padding: 2, marginTop: 6,
          background: 'var(--surface-2)', borderRadius: 6,
          border: '1px solid var(--border)',
        }}>
          {EVENT_DEVICES.map((d) => {
            const isSel = d.id === libDevice;
            return (
              <button
                key={d.id}
                onClick={() => onDeviceChange(d.id)}
                title={d.desc}
                style={{
                  flex: 1, padding: '5px 6px', border: 'none', borderRadius: 4,
                  background: isSel ? 'var(--accent)' : 'transparent',
                  color: isSel ? '#fff' : 'var(--text-muted)',
                  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {/* Normal — pinned baseline (decision #5). Pre-armed; not exported.
            The eraser/coverage primitive for chaining captures. */}
        {(() => {
          const sel = selectedEffectId === NORMAL_EFFECT.id;
          const c = familyOf(NORMAL_EFFECT).color;
          return (
            <button
              onClick={() => onSelectEffect(NORMAL_EFFECT.id)}
              title={NORMAL_EFFECT.desc}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', width: '100%', textAlign: 'left',
                background: sel ? 'var(--surface-2)' : 'transparent',
                border: 'none',
                borderLeft: sel ? `3px solid ${c}` : '3px solid transparent',
                borderBottom: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Normal</span>
                  <span style={{
                    fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--text-dim)',
                    border: '1px solid var(--border)', borderRadius: 3, padding: '0 4px',
                  }}>
                    baseline
                  </span>
                </div>
                <div style={{
                  fontSize: 10.5, color: 'var(--text-dim)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {NORMAL_EFFECT.desc}
                </div>
              </div>
              <ShapeGlyph points={NORMAL_EFFECT.preview} color={c} filled width={40} height={20} title="Normal" />
            </button>
          );
        })()}
        {Object.keys(EVENT_FAMILIES).map((famKey) => {
          const items = byFamily[famKey];
          if (!items?.length) return null;
          const fam = EVENT_FAMILIES[famKey];
          return (
            <div key={famKey}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 12px 4px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: fam.color,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 1, background: fam.color }} />
                {fam.label}
              </div>
              {items.map((e) => {
                const sel = e.id === selectedEffectId;
                return (
                  <button
                    key={e.id}
                    onClick={() => onSelectEffect(e.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', width: '100%', textAlign: 'left',
                      background: sel ? 'var(--surface-2)' : 'transparent',
                      border: 'none',
                      borderLeft: sel ? `3px solid ${fam.color}` : '3px solid transparent',
                      color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: fam.color, flexShrink: 0,
                    }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 12.5, fontWeight: 600,
                        color: sel ? 'var(--text)' : 'var(--text-soft)',
                      }}>
                        {e.label}
                      </div>
                      <div style={{
                        fontSize: 10.5, color: 'var(--text-dim)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {e.desc}
                      </div>
                    </div>
                    <ShapeGlyph points={e.preview} color={fam.color} filled width={40} height={20} title={e.label} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CapturePane — step ③ effect config (intensity · tunables · devices)
// + commit. Accent follows the armed effect's family color.
// ──────────────────────────────────────────────────────────────
function CapturePane({ effect, libDevice, beginMs, endMs, editingEvent, onAddEvent }) {
  const effId = effect?.id;
  const editId = editingEvent?.id;
  const isEditing = !!editingEvent;
  const [intensity, setIntensity] = useState(70);
  const [paramVals, setParamVals] = useState({});
  const [deviceCfg, setDeviceCfg] = useState({});

  // Load config: from the event being edited when one is selected (and its
  // effect is armed), else the armed effect's defaults. Re-runs when the
  // armed effect OR the edited event changes.
  useEffect(() => {
    if (!effect) return;
    const defaultDevices = () => {
      const dc = {};
      EVENT_DEVICES.forEach((d) => {
        if (effect.devices.includes(d.id)) dc[d.id] = { mode: 'broadcast', value: 100 };
      });
      return dc;
    };
    if (editingEvent && editingEvent.effectId === effect.id) {
      setIntensity(Math.round((editingEvent.intensity ?? (effect.baseline ? 1 : 0.7)) * 100));
      const pv = {};
      paramsFor(effect).forEach((p) => {
        pv[p.key] = editingEvent.params?.[p.key] != null ? editingEvent.params[p.key] : p.def;
      });
      setParamVals(pv);
      setDeviceCfg(editingEvent.deviceCfg || defaultDevices());
    } else {
      setIntensity(effect.baseline ? 100 : 70);
      const pv = {};
      paramsFor(effect).forEach((p) => { pv[p.key] = p.def; });
      setParamVals(pv);
      setDeviceCfg(defaultDevices());
    }
  }, [effId, editId]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!effect) return <div />;

  const fam = familyOf(effect);
  const color = fam.color;
  const params = paramsFor(effect);
  const dur = (beginMs != null && endMs != null) ? Math.abs(endMs - beginMs) : null;
  const ready = beginMs != null && endMs != null && dur >= 50;
  const targeted = EVENT_DEVICES.filter((d) => effect.devices.includes(d.id));
  const canAdd = ready && targeted.length > 0;

  const toggleMode = (id) => setDeviceCfg((prev) => {
    const next = prev[id]?.mode === 'override' ? 'broadcast' : 'override';
    return { ...prev, [id]: { mode: next, value: next === 'override' ? intensity : 100 } };
  });

  const commit = () => {
    if (!canAdd) return;
    onAddEvent({
      intensity,
      params: paramVals,
      devices: targeted.map((d) => d.id),
      deviceCfg,
    });
  };

  const fmtParam = (p, v) => (p.step < 1 ? Number(v).toFixed(2) : String(v));

  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid ${color}66`,
      borderRadius: 10, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 14,
      minHeight: 360,
    }}>
      {/* ③ header — swatch · name · family tag · armed */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StepBadge n={3} />
        <span style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 17, fontWeight: 700 }}>{effect.label}</span>
        <span style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
          textTransform: 'uppercase', color,
          background: `${color}22`, borderRadius: 4, padding: '2px 7px',
        }}>
          {fam.label}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: isEditing ? color : 'var(--text-dim)' }}>
          {isEditing ? 'editing' : 'armed'}
        </span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.5, marginTop: -4 }}>
        {effect.desc}
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Intensity */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'var(--text-muted)', width: 80, flexShrink: 0,
          }}>
            Intensity
          </span>
          <input
            type="range" min={0} max={100} step={1} value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value, 10))}
            style={{ flex: 1, accentColor: color, cursor: 'pointer' }}
          />
          <span className="mono" style={{ fontSize: 16, fontWeight: 700, width: 34, textAlign: 'right' }}>
            {intensity}
          </span>
        </div>
      </div>

      {/* Per-effect tunables */}
      {params.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {params.map((p) => (
            <div key={p.key} style={{
              flex: '1 1 150px', minWidth: 140,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 11px', borderRadius: 8,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-soft)', flexShrink: 0 }}>
                {p.label}
              </span>
              <input
                type="range" min={p.min} max={p.max} step={p.step} value={paramVals[p.key] ?? p.def}
                onChange={(e) => setParamVals((v) => ({ ...v, [p.key]: parseFloat(e.target.value) }))}
                style={{ flex: 1, minWidth: 0, accentColor: color, cursor: 'pointer' }}
              />
              <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
                {fmtParam(p, paramVals[p.key] ?? p.def)}
                {p.unit && <span style={{ color: 'var(--text-dim)', fontSize: 9.5 }}>{p.unit}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Devices — broadcast / override */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6,
        }}>
          <span style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            Devices
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
            ○ broadcast · ● override
          </span>
        </div>
        {EVENT_DEVICES.map((d) => {
          const supported = effect.devices.includes(d.id);
          const cfg = deviceCfg[d.id];
          const override = cfg?.mode === 'override';
          const value = supported ? (override ? (cfg.value ?? intensity) : intensity) : null;
          return (
            <div key={d.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '6px 2px', opacity: supported ? 1 : 0.5,
            }}>
              <button
                type="button"
                onClick={supported ? () => toggleMode(d.id) : undefined}
                disabled={!supported}
                title={supported ? (override ? 'Override — click for broadcast' : 'Broadcast — click for override') : undefined}
                style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0, padding: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: override ? color : 'transparent',
                  border: `1.5px solid ${supported ? (override ? color : 'var(--text-dim)') : 'var(--border)'}`,
                  cursor: supported ? 'pointer' : 'default',
                }}
              >
                {override && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0d0d0d' }} />}
              </button>
              <span style={{
                fontSize: 13, fontWeight: 700, width: 96, flexShrink: 0,
                color: supported ? 'var(--text)' : 'var(--text-dim)',
              }}>
                {d.label}
              </span>
              {supported && override ? (
                <input
                  type="range" min={0} max={100} step={1}
                  value={cfg.value ?? intensity}
                  onChange={(e) => setDeviceCfg((prev) => ({
                    ...prev,
                    [d.id]: { mode: 'override', value: parseInt(e.target.value, 10) },
                  }))}
                  style={{ flex: 1, minWidth: 0, accentColor: color, cursor: 'pointer' }}
                />
              ) : (
                <span style={{
                  fontSize: 12, flex: 1,
                  color: supported ? 'var(--text-soft)' : 'var(--text-dim)',
                  fontStyle: supported ? 'normal' : 'italic',
                }}>
                  {supported ? 'broadcast' : 'not on this effect'}
                </span>
              )}
              <span className="mono" style={{
                fontSize: 13, flexShrink: 0, width: 34, textAlign: 'right',
                color: supported ? 'var(--text)' : 'var(--text-dim)',
              }}>
                {supported ? value : 'n/a'}
              </span>
            </div>
          );
        })}
      </div>

      <span style={{ flex: 1 }} />

      {/* Commit — captured span hint + full-width Add event */}
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
          ? (isEditing ? `Update ${effect.label} event` : `Add ${effect.label} event`)
          : 'Capture a begin and end first'}
        style={{
          padding: '13px 16px', borderRadius: 9, width: '100%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          background: canAdd ? color : 'var(--surface-2)',
          border: 'none',
          color: canAdd ? '#fff' : 'var(--text-dim)',
          fontFamily: 'inherit', fontSize: 15, fontWeight: 800,
          cursor: canAdd ? 'pointer' : 'default',
        }}
      >
        <Icon name={isEditing ? 'check' : 'plus'} size={16} /> {isEditing ? 'Update event' : 'Add event'}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TimelinePane — right
// ──────────────────────────────────────────────────────────────
function TimelinePane({ events, totalEvents, scope, chapters, selectedId, onSelect, onEdit, onDelete }) {
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
                selected={evt.id === selectedId}
                onSelect={() => onSelect(evt.id === selectedId ? null : evt.id)}
                onEdit={() => onEdit(evt.id)}
                onDelete={() => onDelete(evt.id)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ evt, selected, onSelect, onEdit, onDelete }) {
  const eff = findEffect(evt.effectId);
  const fam = familyOf(eff);
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
        gridTemplateColumns: '60px 1fr auto',
        gap: 8, padding: '7px 12px', cursor: 'pointer',
        background: selected ? 'var(--surface-2)' : 'transparent',
        borderLeft: `3px solid ${selected && fam ? fam.color : 'transparent'}`,
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
      }}
    >
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-soft)' }}>
        {fmtTime(evt.beginMs)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: 1, background: fam?.color || '#888',
          }} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{eff?.label || evt.effectId}</span>
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
// EventsTimelineStrip — full-width SVG bottom panel
// (project-scoped; complement to forgemoment's chapter-scoped
// ChapterContextStrip)
// ──────────────────────────────────────────────────────────────
const STRIP_LANES = 4;
const STRIP_LANE_H = 18;
const STRIP_FUN_H = 60;
const STRIP_CHAP_H = 18;
const STRIP_PAD_TOP = 6;
const STRIP_PAD_BOT = 6;
const STRIP_TOTAL_H =
  STRIP_PAD_TOP + STRIP_LANES * STRIP_LANE_H + 4 + STRIP_CHAP_H + 4 + STRIP_FUN_H + STRIP_PAD_BOT;

function EventsTimelineStrip({
  events, scope, chapters, density, actions, totalMs,
  selectedId, onSelect, onFilterChapter,
}) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    if (!wrapRef.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const safeTotal = Math.max(1, totalMs);
  const innerW = Math.max(1, width - 28); // 14px L+R padding (inside the wrapper's own padding)
  const xFor = (ms) => (ms / safeTotal) * innerW;

  // Greedy lane stacking.
  const placed = useMemo(() => {
    const sorted = [...events].sort((a, b) => a.beginMs - b.beginMs);
    const lanes = Array.from({ length: STRIP_LANES }, () => []);
    const out = [];
    for (const e of sorted) {
      let lane = -1;
      for (let i = 0; i < STRIP_LANES; i += 1) {
        const last = lanes[i][lanes[i].length - 1];
        if (!last || last.end <= e.beginMs) { lane = i; break; }
      }
      if (lane === -1) lane = STRIP_LANES - 1;
      lanes[lane].push({ start: e.beginMs, end: e.endMs });
      out.push({ ...e, lane });
    }
    return out;
  }, [events]);

  const funPath = useMemo(() => {
    if (!actions?.length) return '';
    const targetPts = Math.min(innerW, 1500);
    const stride = Math.max(1, Math.floor(actions.length / targetPts));
    const pts = [];
    for (let i = 0; i < actions.length; i += stride) {
      const a = actions[i];
      pts.push([xFor(a.at), (1 - a.pos / 100) * STRIP_FUN_H]);
    }
    const last = actions[actions.length - 1];
    pts.push([xFor(last.at), (1 - last.pos / 100) * STRIP_FUN_H]);
    let d = '';
    pts.forEach(([x, y], i) => {
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    });
    return d;
  }, [actions, innerW]);  // eslint-disable-line react-hooks/exhaustive-deps

  const funBandY = STRIP_PAD_TOP + STRIP_LANES * STRIP_LANE_H + 4 + STRIP_CHAP_H + 4;

  return (
    <div ref={wrapRef} style={{
      marginTop: 16, padding: '10px 14px',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', marginBottom: 6,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>
          Funscript timeline
          <span style={{
            fontWeight: 400, fontSize: 11, color: 'var(--text-dim)', marginLeft: 8,
          }}>
            click a bracket to select · click a chapter to scope
          </span>
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          {actions?.length ?? 0} actions · {events.length} events
        </span>
      </div>

      <svg width={innerW} height={STRIP_TOTAL_H}
           style={{ display: 'block', borderRadius: 6, background: 'var(--bg)' }}>
        <rect x={0} y={funBandY} width={innerW} height={STRIP_FUN_H}
              fill="rgba(255,255,255,0.02)" />

        {/* Chapter band — click to scope */}
        {chapters.map((c) => {
          const x0 = xFor(c.atMs);
          const x1 = xFor(c.endMs);
          const w = x1 - x0;
          const isScoped = scope === c.id;
          const dimmed = scope !== 'all' && !isScoped;
          const cy = STRIP_PAD_TOP + STRIP_LANES * STRIP_LANE_H + 4;
          const count = density?.[c.id] ?? 0;
          return (
            <g key={c.id}
               onClick={(e) => { e.stopPropagation(); onFilterChapter?.(c.id); }}
               style={{ cursor: 'pointer' }}>
              <rect x={x0} y={cy} width={w} height={STRIP_CHAP_H}
                    fill={c.color || '#888'}
                    fillOpacity={isScoped ? 0.55 : (dimmed ? 0.10 : 0.22)}
                    stroke={c.color || '#888'}
                    strokeOpacity={isScoped ? 1 : 0.55}
                    strokeWidth={isScoped ? 1.5 : 0.5} />
              {w > 70 && (
                <text x={x0 + 6} y={cy + STRIP_CHAP_H - 5}
                      fontSize={9} fontWeight={700}
                      fill={isScoped ? '#fff' : (dimmed ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.65)')}
                      style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}>
                  {(c.name || c.id).toUpperCase()}
                </text>
              )}
              {w > 130 && (
                <text x={x1 - 6} y={cy + STRIP_CHAP_H - 5}
                      fontSize={9} fontWeight={700} textAnchor="end"
                      fill={isScoped ? '#fff' : 'rgba(255,255,255,0.45)'}
                      style={{ pointerEvents: 'none', fontFamily: 'var(--font-mono)' }}>
                  {count}
                </text>
              )}
            </g>
          );
        })}

        {/* Per-event tints on funscript band */}
        {placed.map((evt) => {
          const eff = findEffect(evt.effectId);
          const fam = familyOf(eff);
          if (!fam) return null;
          const x0 = xFor(evt.beginMs);
          const x1 = xFor(evt.endMs);
          const w = Math.max(1.5, x1 - x0);
          const sel = evt.id === selectedId;
          return (
            <rect key={`tint-${evt.id}`}
                  x={x0} y={funBandY} width={w} height={STRIP_FUN_H}
                  fill={fam.color}
                  fillOpacity={sel ? 0.42 : 0.20}
                  style={{ pointerEvents: 'none' }} />
          );
        })}

        {/* Funscript polyline */}
        <path d={funPath} fill="none"
              stroke="rgba(255,255,255,0.78)" strokeWidth={1} strokeLinejoin="round"
              style={{ pointerEvents: 'none' }} />

        {/* Event brackets */}
        {placed.map((evt) => {
          const eff = findEffect(evt.effectId);
          const fam = familyOf(eff);
          if (!fam) return null;
          const x0 = xFor(evt.beginMs);
          const x1 = xFor(evt.endMs);
          const w = Math.max(2, x1 - x0);
          const y = STRIP_PAD_TOP + evt.lane * STRIP_LANE_H;
          const sel = evt.id === selectedId;
          const label = eff?.label || evt.effectId;
          const showLabel = w > 32;
          return (
            <g key={`br-${evt.id}`}
               onClick={(e) => {
                 e.stopPropagation();
                 onSelect?.(evt.id === selectedId ? null : evt.id);
               }}
               style={{ cursor: 'pointer' }}>
              <rect x={x0} y={y + 4} width={w} height={STRIP_LANE_H - 8}
                    rx={2} ry={2}
                    fill={fam.color} fillOpacity={sel ? 0.95 : 0.70}
                    stroke={sel ? '#fff' : 'transparent'} strokeWidth={sel ? 1 : 0} />
              <line x1={x0 + 0.5} x2={x0 + 0.5} y1={y + 1} y2={y + STRIP_LANE_H - 1}
                    stroke={fam.color} strokeWidth={1.5} pointerEvents="none" />
              <line x1={x1 - 0.5} x2={x1 - 0.5} y1={y + 1} y2={y + STRIP_LANE_H - 1}
                    stroke={fam.color} strokeWidth={1.5} pointerEvents="none" />
              {showLabel && (
                <text x={x0 + 4} y={y + STRIP_LANE_H - 6}
                      fontSize={9.5} fontWeight={700} fill="#0d0d0d"
                      style={{ pointerEvents: 'none', letterSpacing: '0.02em' }}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div style={{
        display: 'flex', gap: 12, marginTop: 8,
        fontSize: 10, color: 'var(--text-dim)',
      }}>
        {Object.keys(EVENT_FAMILIES).map((k) => {
          const f = EVENT_FAMILIES[k];
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: f.color }} />
              {f.label}
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 1, background: 'rgba(255,255,255,0.78)' }} />
          funscript position
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// FooterBar
// ──────────────────────────────────────────────────────────────
function FooterBar({ eventCount, scopeLabel }) {
  return (
    <div style={{
      marginTop: 16, padding: 14,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Button kind="secondary" size="sm" icon="box" disabled>
        Starter packs
      </Button>
      <Button kind="secondary" size="sm" icon="upload" disabled>
        Load YAML…
      </Button>
      <Button kind="ghost" size="sm" icon="file-text" disabled>
        Preview events.yml
      </Button>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {eventCount} sample events · scope: <span style={{ color: 'var(--text)' }}>{scopeLabel}</span>
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
