// ViewerTab — the last pipeline stage: review the generated output.
//
// You can't see the produced funscripts anywhere else. This stage loads a
// device's channels and shows them across the WHOLE timeline (audio + spectro
// + intensity arc on top, every channel below) so inconsistencies pop — e.g.
// a soft intro vs. a hot body. A right-panel monitor + one big baton tie the
// lanes to the source frame. No comparison, no editing — pure review.
//
// The surface itself is forgemoment's `ViewerPanel`, shared with
// ForgeAssembler and ForgePlayer. What stays here is everything that is
// FunscriptForge's: where the output lives (`viewer_load` scans
// `<stem>.output/` or a `.forge` bundle beside the media), how a path becomes
// a URL this webview can load, and the vocabulary of the empty state — "export
// it on the Export tab" means nothing in the other two apps.

import { useCallback, useEffect, useState } from 'react';
import { ViewerPanel } from 'forgemoment';
import { viewerLoad } from '../api/forge.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

export default function ViewerTab({ project, trackPeaks = null, trackSpectrogram = null }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  const loadKey = project?.mediaPath || project?.path || null;

  useEffect(() => {
    if (!loadKey) { setData(null); return undefined; }
    let live = true;
    setLoading(true);
    setLoadErr(null);
    viewerLoad(loadKey, { maxPoints: 2000 })
      .then((res) => { if (live) { setData(res || null); setLoading(false); } })
      .catch((e) => { if (live) { setLoadErr(String(e?.message || e)); setData(null); setLoading(false); } });
    return () => { live = false; };
  }, [loadKey]);

  // The 16k audio is fine for the full-timeline lane (it re-bins to pixel
  // width) but blocky in the monitor's ~12s window. Fetch a high-res envelope
  // once per project for the monitor only.
  const [monitorAudio, setMonitorAudio] = useState(null);
  useEffect(() => {
    if (!loadKey) { setMonitorAudio(null); return undefined; }
    let live = true;
    viewerLoad(loadKey, { audioPoints: 150000 })
      .then((res) => { if (live) setMonitorAudio(res?.audio?.peaks?.length ? res.audio : null); })
      .catch(() => { if (live) setMonitorAudio(null); });
    return () => { live = false; };
  }, [loadKey]);

  const loadChannel = useCallback(
    (device, channel) => viewerLoad(loadKey, { channel: `${device}/${channel}` }),
    [loadKey],
  );

  // The Viewer reviews the EXPORTED output, not the working funscript — so it
  // must NOT require project.path. A finished/media-only project has no working
  // funscript (the channels live in <stem>.output / .forge), yet mediaPath →
  // that output is exactly what we want to load.
  if (!loadKey) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Viewer</h2>
        <p>Open a project (or its media) to review its generated output.</p>
      </section>
    );
  }

  if (loading) {
    return <section style={{ padding: 24 }}><h2>Viewer</h2><p>Loading output…</p></section>;
  }

  const devices = data?.devices || [];
  if (!data?.available || !devices.length) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Viewer</h2>
        <p>No generated output found yet. Export the project (Export tab) to produce
           device channel funscripts, then review them here.</p>
        <p className="ff-meta" style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim, #6b7390)' }}>
          Looked for output next to: <code>{loadKey || '(no media/funscript path)'}</code>
        </p>
        {loadErr && <p className="ff-meta" style={{ fontSize: 12, color: 'var(--danger, #ff5470)' }}>
          load error: <code>{loadErr}</code></p>}
        {data?.error && <p className="ff-meta" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          reason: <code>{data.error}</code></p>}
      </section>
    );
  }

  // Prefer the live-analysis peaks if the project was analyzed this session;
  // otherwise use the peaks the loader pulled from the export/.forge so the
  // audio lane works on a finished, unanalyzed project too.
  const audio = (trackPeaks?.peaks?.length ? trackPeaks : null)
    || (data?.audio?.peaks?.length ? data.audio : null);

  return (
    <ViewerPanel
      devices={devices}
      durationMs={data?.durationMs || project?.durationMs || 0}
      chapters={data?.chapters || []}
      audio={audio}
      monitorAudio={monitorAudio}
      beats={data?.beats || null}
      events={data?.events || []}
      spectrogram={trackSpectrogram}
      spectrogramUrl={data?.spectrogramPng ? toMediaUrl(data.spectrogramPng) : null}
      screech={data?.screech || null}
      mediaUrl={toMediaUrl(project?.mediaPath)}
      mediaKind={project?.mediaKind ?? 'video'}
      loadChannel={loadChannel}
      source={{
        label: data?.source === 'forge' ? 'Bundle' : 'Output',
        name: data?.sourceName,
        path: data?.sourcePath,
      }}
    />
  );
}
