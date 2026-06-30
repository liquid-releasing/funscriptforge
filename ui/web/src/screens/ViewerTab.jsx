// ViewerTab — the last pipeline stage: review the generated output.
//
// You can't see the produced funscripts anywhere else. This stage loads a
// device's channels and shows them across the WHOLE timeline (audio + spectro
// + intensity arc on top, every channel below) so inconsistencies pop — e.g.
// a soft intro vs. a hot body. A right-panel monitor + one big baton tie the
// lanes to the source frame. No comparison, no editing — pure review.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MediaViewer } from 'forgemoment';
import ChannelStack from './ChannelStack.jsx';
import { viewerLoad } from '../api/forge.js';
import { analyzeChannels, posAt } from '../lib/forgeStats.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

// Intensity arc: prefer the felt `volume` channel; else a normalized velocity
// envelope of the device's primary channel. Returns [{ at, v:0..1 }].
function computeIntensity(channels, durationMs, bins = 320) {
  if (!channels.length || durationMs <= 0) return [];
  const vol = channels.find((c) => c.name === 'volume' || c.name === 'volume-prostate');
  const step = durationMs / bins;
  if (vol && vol.actions.length > 1) {
    return Array.from({ length: bins + 1 }, (_, i) => {
      const at = i * step;
      return { at, v: Math.max(0, Math.min(1, posAt(vol.actions, at) / 100)) };
    });
  }
  // velocity envelope of the densest channel
  const ch = channels.reduce((a, b) => (b.actions.length > a.actions.length ? b : a), channels[0]);
  const a = ch.actions;
  const binMax = new Array(bins + 1).fill(0);
  let gmax = 0;
  for (let i = 1; i < a.length; i += 1) {
    const dt = Math.max(1, a[i].at - a[i - 1].at);
    const v = Math.abs(a[i].pos - a[i - 1].pos) / dt;
    const bi = Math.min(bins, Math.floor(a[i].at / step));
    if (v > binMax[bi]) binMax[bi] = v;
    if (v > gmax) gmax = v;
  }
  if (gmax === 0) gmax = 1;
  return binMax.map((v, i) => ({ at: i * step, v: v / gmax }));
}

export default function ViewerTab({ project, trackPeaks = null, trackSpectrogram = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoElRef = useRef(null);

  const loadKey = project?.mediaPath || project?.path || null;

  useEffect(() => {
    if (!loadKey) { setData(null); return undefined; }
    let live = true;
    setLoading(true);
    viewerLoad(loadKey, { maxPoints: 2000 })
      .then((res) => { if (live) { setData(res || null); setLoading(false); } })
      .catch(() => { if (live) { setData(null); setLoading(false); } });
    return () => { live = false; };
  }, [loadKey]);

  const devices = data?.devices || [];
  // Default to the first device (E-Stim sorts first) once data lands.
  useEffect(() => {
    if (devices.length && !devices.find((d) => d.name === deviceName)) {
      setDeviceName(devices[0].name);
    }
  }, [devices, deviceName]);

  const device = devices.find((d) => d.name === deviceName) || devices[0] || null;
  const durationMs = data?.durationMs || project?.durationMs || 0;
  const channels = device?.channels || [];

  const intensity = useMemo(() => computeIntensity(channels, durationMs), [channels, durationMs]);
  const summary = useMemo(() => analyzeChannels(channels, durationMs), [channels, durationMs]);
  const screech = data?.screech || null;
  const screechRegions = screech?.source_screech_regions || [];
  const capCount = screech?.generation_cap_regions?.length || 0;

  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;
  const getLiveMs = useCallback(() => {
    const v = videoElRef.current;
    return v ? v.currentTime * 1000 : null;
  }, []);

  if (!project?.path) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Viewer</h2>
        <p>Open a project to review its generated output.</p>
      </section>
    );
  }

  if (loading) {
    return <section style={{ padding: 24 }}><h2>Viewer</h2><p>Loading output…</p></section>;
  }

  if (!data?.available || !devices.length) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Viewer</h2>
        <p>No generated output found yet. Export the project (Export tab) to produce
           device channel funscripts, then review them here.</p>
      </section>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header — device picker + screech note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                    borderBottom: '1px solid var(--border, #2d3148)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                       color: 'var(--text-muted, #9ba3c4)', marginRight: 4 }}>Device</span>
        {devices.map((d) => (
          <button key={d.name} type="button" onClick={() => { setDeviceName(d.name); setSelectedChannel(null); }}
            style={{
              padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13,
              border: '1px solid var(--border, #2d3148)',
              background: d.name === deviceName ? 'var(--accent, #ff4b4b)' : 'transparent',
              color: d.name === deviceName ? '#fff' : 'var(--text, #fafafa)',
            }}>
            {d.name} <span style={{ opacity: 0.6, fontSize: 11 }}>· {d.channels.length}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {(screechRegions.length > 0 || capCount > 0) && (
          <span title="A screech was detected and tamed at generation"
                style={{ fontSize: 12, color: 'var(--warn, #ffb547)' }}>
            ⚠ {screechRegions.length} screech tamed{capCount ? ` · ${capCount} caps` : ''}
          </span>
        )}
      </div>

      {/* Body — stats | lanes | monitor */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Left — whole-device stats */}
        <aside style={{ width: 200, flexShrink: 0, padding: '12px 14px', overflowY: 'auto',
                        borderRight: '1px solid var(--border, #2d3148)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
                        color: 'var(--text-muted, #9ba3c4)', marginBottom: 8 }}>{device?.name}</div>
          <StatRow label="Liveliness" value={summary.liveliness} big />
          <StatRow label="Channels" value={summary.channelCount} />
          <StatRow label="Actions" value={summary.totalActions.toLocaleString()} />
          <StatRow label="Density" value={`${summary.actionsPerSec.toFixed(2)}/s`} />
          <StatRow label="Usable range" value={`${Math.round(summary.usableRange)}`} />
          <StatRow label="Avg velocity" value={`${Math.round(summary.avgVelocity)}`} />
          <StatRow label="Avg stroke" value={`${Math.round(summary.avgStroke)}`} />
          {selectedChannel && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border, #2d3148)' }}>
              <div style={{ fontSize: 11, color: 'var(--accent, #ff4b4b)', marginBottom: 6 }}>{selectedChannel}</div>
              {(() => {
                const pc = summary.perChannel.find((p) => p.name === selectedChannel);
                if (!pc) return <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</div>;
                return <>
                  <StatRow label="Liveliness" value={pc.liveliness} />
                  <StatRow label="Density" value={`${pc.actionsPerSec.toFixed(2)}/s`} />
                  <StatRow label="Range" value={`${Math.round(pc.usableRange)}`} />
                </>;
              })()}
            </div>
          )}
        </aside>

        {/* Center — the lane stack (the star) */}
        <main style={{ flex: 1, minWidth: 0, padding: 12, overflowY: 'auto' }}>
          <ChannelStack
            channels={channels}
            waveform={audioWaveform}
            spectrogram={trackSpectrogram}
            intensity={intensity}
            screechRegions={screechRegions}
            durationMs={durationMs}
            currentMs={currentMs}
            getLiveMs={getLiveMs}
            onSeek={(ms) => setCurrentMs(Math.max(0, Math.min(durationMs, ms)))}
            selectedChannel={selectedChannel}
            onSelectChannel={setSelectedChannel}
          />
        </main>

        {/* Right — reference monitor, synced to the same baton */}
        <aside style={{ width: 340, flexShrink: 0, padding: 12,
                        borderLeft: '1px solid var(--border, #2d3148)' }}>
          <MediaViewer
            width="100%"
            videoElRef={videoElRef}
            thumbnailAspect="16/9"
            videoSrc={toMediaUrl(project?.mediaPath)}
            media={{ kind: project?.mediaKind ?? 'video', title: 'Full timeline' }}
            funscript={device ? { actions: (channels.find((c) => c.name === selectedChannel) || channels[0])?.actions || [] } : { actions: [] }}
            audioWaveform={audioWaveform}
            spectrogram={trackSpectrogram}
            currentMs={currentMs}
            totalMs={durationMs}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            onSeek={(ms) => setCurrentMs(Math.max(0, Math.min(durationMs, ms)))}
            onTimeChange={(ms) => setCurrentMs(Math.max(0, Math.min(durationMs, ms)))}
            controls={['back1', 'frame-back', 'play', 'frame-forward', 'forward1']}
            showSpeed
            showMark={false}
            modeToggleAlign="start"
            modeToggleSize="sm"
          />
        </aside>
      </div>
    </section>
  );
}

function StatRow({ label, value, big = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '3px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted, #9ba3c4)' }}>{label}</span>
      <span style={{ fontSize: big ? 20 : 13, fontWeight: big ? 700 : 600,
                     color: big ? 'var(--accent-warm-2, #ffb547)' : 'var(--text, #fafafa)',
                     fontFamily: 'var(--font-mono, monospace)' }}>{value}</span>
    </div>
  );
}
