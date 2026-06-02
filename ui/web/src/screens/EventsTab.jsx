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
// State is local to this tab (events array seeded from sampleEventsForProject,
// chapter scope, selected event id). No persistence; tab unmount drops state.
// Lifting to App.jsx and writing to <stem>.events.yml comes with the wiring
// pass.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Button, Icon, fmtTime, TrackStack, MediaViewer } from 'forgemoment';
import {
  EVENT_DEVICES,
  EVENT_FAMILIES,
  EVENT_EFFECTS,
  findEffect,
  sampleEventsForProject,
} from '../data/events.js';
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

  // Seed sample events whenever the project changes. Local-only —
  // persistence comes with the wiring pass.
  const [events, setEvents] = useState(() => sampleEventsForProject(chapters));
  useEffect(() => {
    setEvents(sampleEventsForProject(chapters));
    setSelectedId(null);
    setScope('all');
  }, [project?.path]);  // eslint-disable-line react-hooks/exhaustive-deps

  const [scope, setScope] = useState('all'); // 'all' | chapter id
  const [selectedId, setSelectedId] = useState(null);
  // Playhead + transport for the chapter-scoped hero. The MediaViewer is
  // the time backbone (emits onTimeChange while playing); click-to-seek on
  // the TrackStack and the transport buttons also drive currentMs.
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [libDevice, setLibDevice] = useState(() => {
    const proj = selectedDevices?.[0];
    if (proj && EVENT_DEVICES.find((d) => d.id === proj)) return proj;
    return EVENT_DEVICES[0].id;
  });
  const [selectedEffectId, setSelectedEffectId] = useState('edge');

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedId) || null,
    [events, selectedId],
  );

  // When a timeline event is selected, sync the library cursor to its effect.
  useEffect(() => {
    if (selectedEvent) {
      setSelectedEffectId(selectedEvent.effectId);
    }
  }, [selectedEvent?.effectId]);  // eslint-disable-line react-hooks/exhaustive-deps

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
        const fam = eff ? EVENT_FAMILIES[eff.family] : null;
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
  // baton begins inside the visible window rather than at 0.
  useEffect(() => {
    if (activeChapter) { setCurrentMs(activeChapter.atMs); setIsPlaying(false); }
  }, [activeChapter?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

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
        <div style={{
          marginTop: 12, display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 14, alignItems: 'start',
        }}>
          {/* Left — TrackStack hero */}
          <div style={{
            padding: '10px 14px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10,
          }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: 6,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                  background: activeChapter.color || '#888', marginRight: 7,
                  verticalAlign: '0px',
                }} />
                {activeChapter.name || activeChapter.id}
                <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
                  click to move the playhead · click an event to select
                </span>
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
            width={320}
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
        />

        <TimelinePane
          events={timelineEvents}
          totalEvents={events.length}
          scope={scope}
          chapters={chapters}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
        <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{filtered.length}</span>}>
          Effect library
        </SectionLabel>
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
// CapturePane — center placeholder for skeleton
// ──────────────────────────────────────────────────────────────
function CapturePane({ effect, libDevice }) {
  if (!effect) return <div />;
  const fam = EVENT_FAMILIES[effect.family];
  const supports = effect.devices.includes(libDevice);
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
      minHeight: 360,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: fam.color }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{effect.label}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{effect.desc}</div>
        </div>
        <Pill tone="neutral">{fam.label}</Pill>
      </div>

      {!supports && (
        <div style={{
          padding: 10, background: 'var(--surface-2)', borderRadius: 6,
          fontSize: 11.5, color: 'var(--text-dim)',
        }}>
          <Icon name="info" size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />
          {EVENT_DEVICES.find((d) => d.id === libDevice)?.label} doesn't ship a {effect.label} mapping.
          Pick another device tab to see this effect on a supported target.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <SectionLabel>Supported devices</SectionLabel>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EVENT_DEVICES.map((d) => {
          const on = effect.devices.includes(d.id);
          return (
            <span key={d.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 8px', borderRadius: 999,
                background: on ? 'rgba(77,171,247,0.18)' : 'var(--surface-2)',
                border: `1px solid ${on ? '#4dabf7' : 'var(--border)'}`,
                color: on ? '#4dabf7' : 'var(--text-dim)',
                fontSize: 10.5, fontWeight: 600,
              }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: on ? '#4dabf7' : 'var(--text-dim)',
              }} />
              {d.label}
            </span>
          );
        })}
      </div>

      <div style={{
        marginTop: 'auto', padding: 12, borderRadius: 6,
        background: 'var(--surface-2)',
        border: '1px dashed var(--border)',
        fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
          <Icon name="cog" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Capture lands in the wiring pass
        </div>
        Begin/End capture from the playhead, device targeting, intensity scrub, and per-device
        parameter forms attach here once the MediaViewer is synced through the chapter strip
        and the <span className="mono">.events.yml</span> sidecar pipeline is plumbed.
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TimelinePane — right
// ──────────────────────────────────────────────────────────────
function TimelinePane({ events, totalEvents, scope, chapters, selectedId, onSelect }) {
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
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ evt, selected, onSelect }) {
  const eff = findEffect(evt.effectId);
  const fam = eff ? EVENT_FAMILIES[eff.family] : null;
  const dur = evt.endMs - evt.beginMs;
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
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
          const fam = eff ? EVENT_FAMILIES[eff.family] : null;
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
          const fam = eff ? EVENT_FAMILIES[eff.family] : null;
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
