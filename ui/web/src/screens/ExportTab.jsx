// ExportTab — the end of the pipeline, restructured around the three
// questions every export answers (the ForgeGen v2 Output model, made
// FF-native):
//
//   TARGETS       — WHAT gets written, grouped by who consumes it
//                   (Strokers · E-stim · Authoring · Preview). Honest
//                   readiness cards: the packager writes what's forged, so a
//                   card shows ready / auto / opt-in / not-ready, never a
//                   checkbox that lies. (Per-target opt-out is the next
//                   iteration — needs a `cli.py export` skip flag.)
//   DESTINATIONS  — WHERE it goes. Disk (loose folder | .forge bundle) is the
//                   format choice; "Open in ForgePlayer" is a real local
//                   hand-off; Autoblow cloud is a post-beta `later` card.
//   ACTIONS       — the verbs: Export (→ destination) · Reveal · Copy path ·
//                   Open in ForgePlayer →.
//
// Export remains a PACKAGER, not a generator: it gathers the effective motion
// track, the device files Polish stamped (+ auto-generated e-stim/TCode from
// Channels), events, authoring sidecars, thumbnails, and a manifest. It only
// writes new files — nothing destructive.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pill, Button, Icon, TrackStack } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';
import { exportWrite, revealPath, polishRead, openInForgePlayer, isTauri, pickFolder } from '../api/forge.js';
import { svgElementToPngDataUrl } from '../lib/laneSnapshot.js';

// Width/height the hidden export lanes render at — wide enough that the
// snapshot reads as a full-track overview (matches the player's lanes), not so
// wide it overflows the browser canvas cap. Each lane is captured at 2× for
// crispness in the bundle.
const PREVIEW_W = 1280;
const PREVIEW_LANE_H = { funscript: 150, audio: 90, spectro: 90 };

// The Polish stations that are mechanical strokers (ride under the Strokers
// target). estim3p is the e-stim flagship and lives in its own target.
const STROKER_STATIONS = ['handy', 'tcode', 'lovense', 'vacuglide'];

// ──────────────────────────────────────────────────────────────
// ExportTab
// ──────────────────────────────────────────────────────────────
export default function ExportTab({
  project, trackPeaks = null, trackSpectrogram = null,
  setBusy = () => {}, setAppError = () => {},
}) {
  const projectStem = useMemo(() => {
    if (!project?.path) return 'project';
    const file = String(project.path).split(/[/\\]/).pop() || 'project';
    return file.replace(/\.funscript$/i, '');
  }, [project?.path]);

  const path = project?.path ?? null;
  const isSample = typeof path === 'string' && path.startsWith('sample://');
  const canWrite = !!path && !isSample;
  const hasMedia = !!project?.mediaPath;

  // Disk shape — MULTI-select. One Export can write a .forge bundle AND a loose
  // output folder (each is its own write). At least one must stay selected.
  const [shapes, setShapes] = useState(() => new Set(['forge']));
  const modes = useMemo(() => ['forge', 'loose'].filter((m) => shapes.has(m)), [shapes]);
  const toggleShape = (shape) => setShapes((s) => {
    const next = new Set(s);
    if (next.has(shape)) { if (next.size > 1) next.delete(shape); } // keep ≥1
    else next.add(shape);
    return next;
  });
  const [stem, setStem] = useState(projectStem);
  // Destination folder. null = the project folder (the default, == where the
  // CLI writes when --out is omitted). A user-picked folder overrides it so you
  // can steer the output somewhere findable / test what lands where.
  const [outDir, setOutDir] = useState(null);
  // Whether to also launch ForgePlayer after writing.
  const [toForgePlayer, setToForgePlayer] = useState(false);

  // The project's own folder (dirname of the funscript), and the resolved
  // output path so the user sees exactly where the export lands BEFORE writing.
  const projectFolder = useMemo(
    () => (path ? String(path).split(/[/\\]/).slice(0, -1).join('/') : ''),
    [path],
  );
  // Switching projects clears a custom destination so B never writes into the
  // folder you picked for A.
  useEffect(() => { setOutDir(null); }, [path]);
  const folder = outDir || projectFolder;
  const nameForShape = (shape) => (shape === 'forge' ? `${stem}.forge` : `${stem}.output`);
  const pathForShape = (shape) => (folder ? `${folder}/${nameForShape(shape)}` : nameForShape(shape));

  const onPickFolder = async () => {
    const picked = await pickFolder(folder || undefined);
    if (picked) setOutDir(picked);
  };

  // Render/processing options applied during write (real backend effect).
  const [options, setOptions] = useState({
    blendSeams: true,
    finalSmooth: true,
    stimWav: false,
    // Stim MP3 ON by default — the two rendered stim tracks (normal +
    // prostate) are the e-stim flagship deliverable; users expect them in the
    // bundle, not an opt-in they have to discover. WAV stays opt-in (large).
    stimMp3: true,
    includeMedia: false,
  });

  // Polish stamps drive what's forged — Export packs what it finds; we read the
  // stamp record so the target cards reflect reality, not aspiration.
  const [polishPasses, setPolishPasses] = useState({});
  useEffect(() => {
    if (!path) { setPolishPasses({}); return undefined; }
    let cancelled = false;
    polishRead(path)
      .then((res) => { if (!cancelled) setPolishPasses(res?.passes || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  const stampedStations = useMemo(
    () => Object.entries(polishPasses).filter(([, p]) => p?.accepted).map(([id]) => id),
    [polishPasses],
  );

  const [writing, setWriting] = useState(false);
  // One write per selected shape → an array of results. `primary` is the one we
  // hand to single-target actions (Reveal / ForgePlayer): the .forge bundle if
  // present, else the first written.
  const [results, setResults] = useState(null);
  const primary = useMemo(() => {
    if (!results || !results.length) return null;
    return results.find((r) => r.shape === 'forge') || results[0];
  }, [results]);
  const [writeError, setWriteError] = useState(null);
  const [launching, setLaunching] = useState(false);

  const ctx = useMemo(() => ({
    stem,
    hasMedia,
    actionCount: project?.actionCount ?? (project?.actions?.length ?? 0),
    // Chapters are the root of all forge metadata — phrases, per-chapter
    // characters and events all require chapters first. No chapters → a bare
    // funscript → the authoring bundle would hold only motion.funscript, so
    // the Forge-metadata card must not claim sidecars it can't write.
    hasChapters: (project?.chapterList?.length ?? project?.chapters ?? 0) > 0,
    stampedStations,
    stampedStrokers: stampedStations.filter((id) => STROKER_STATIONS.includes(id)),
    estimStamped: stampedStations.includes('estim3p'),
    stimWav: options.stimWav,
    stimMp3: options.stimMp3,
  }), [stem, hasMedia, project, stampedStations, options.stimWav, options.stimMp3]);

  const targets = useMemo(() => TARGET_GROUPS.map((t) => ({ ...t, ...t.derive(ctx) })), [ctx]);
  // Which target groups are checked ("what's in the bundle"). Default = all in.
  const [kept, setKept] = useState(() => new Set(TARGET_GROUPS.map((t) => t.id)));
  const toggleKeep = (id) => setKept((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const keptCount = targets.filter((t) => kept.has(t.id)).length;
  const excludeIds = TARGET_GROUPS.filter((t) => !kept.has(t.id)).map((t) => t.id);
  const readyCount = targets.filter((t) => t.state === 'ready' || t.state === 'auto' || t.state === 'present').length;

  const launchForgePlayer = async (revealAfter, target) => {
    const t = target || primary;
    setLaunching(true);
    try {
      await openInForgePlayer(t?.path || path);
      if (revealAfter && t?.path) await revealPath(t.path);
    } catch (e) {
      setWriteError(String(e?.message || e));
    } finally {
      setLaunching(false);
    }
  };

  const shapeLabel = (s) => (s === 'forge' ? 'the .forge bundle' : 'the loose folder');

  // Hidden full-track lanes — the player's EXACT TrackStack render, captured to
  // PNG so the bundle's Preview images can't drift from what the editor shows.
  const funscriptLaneRef = useRef(null);
  const audioLaneRef = useRef(null);
  const spectroLaneRef = useRef(null);
  const previewActions = useMemo(
    () => (Array.isArray(project?.actions) ? project.actions : []),
    [project?.actions],
  );
  const previewDurationMs = useMemo(() => {
    if (project?.durationMs) return project.durationMs;
    const last = previewActions.length ? previewActions[previewActions.length - 1].at : 0;
    return Math.max(1, last);
  }, [project?.durationMs, previewActions]);
  const previewScope = useMemo(
    () => ({ start: 0, end: previewDurationMs }),
    [previewDurationMs],
  );
  const hasWaveform = !!(trackPeaks?.peaks?.length);
  const hasSpectro = !!(trackSpectrogram?.cells?.length && trackSpectrogram?.nFrames);

  // Snapshot each present lane's <svg> to a PNG data URL. Returns an object
  // keyed by export role; absent lanes are simply omitted (the CLI falls back
  // to its matplotlib render for any role we don't supply).
  const capturePreviews = async () => {
    const svgOf = (ref) => ref.current?.querySelector('svg') || null;
    const out = {};
    const [funscript, audio, spectrogram] = await Promise.all([
      previewActions.length ? svgElementToPngDataUrl(svgOf(funscriptLaneRef)) : Promise.resolve(null),
      hasWaveform ? svgElementToPngDataUrl(svgOf(audioLaneRef)) : Promise.resolve(null),
      hasSpectro ? svgElementToPngDataUrl(svgOf(spectroLaneRef)) : Promise.resolve(null),
    ]);
    if (funscript) out.funscript = funscript;
    if (audio) out.audio = audio;
    if (spectrogram) out.spectrogram = spectrogram;
    return out;
  };

  const doWrite = async () => {
    if (!canWrite || !modes.length) return;
    setWriting(true); setWriteError(null); setResults(null);
    setBusy({ message: `Export — packaging ${modes.map(shapeLabel).join(' + ')}…` });
    // Export streams per-step progress over `ff:progress` (motion → stations →
    // thumbnails → audio → packaging). Pipe each line into the footer so a slow
    // export (unstamped-station generation, stim-audio render) visibly advances.
    let offProgress = null;
    try {
      if (isTauri()) {
        const { listen } = await import('@tauri-apps/api/event');
        offProgress = await listen('ff:progress', (event) => {
          const raw = String(event?.payload ?? '');
          const line = raw.startsWith('progress: ') ? raw.slice('progress: '.length) : raw;
          if (line && !line.includes('::')) setBusy({ message: line });
        });
      }
    } catch { /* listener is best-effort; the export still runs */ }
    // Snapshot the player's lanes to PNGs ONCE (same images for every shape);
    // best-effort, a capture failure just lets the CLI fall back per role.
    let previews = {};
    try { previews = await capturePreviews(); } catch { previews = {}; }
    try {
      // One write per selected shape (the CLI takes a single --mode). Sequential
      // so the footer progress reads cleanly; each lands as its own snapshot.
      const written = [];
      for (const m of modes) {
        const res = await exportWrite(path, {
          mode: m,
          previews,
          // Only send --out when the user picked a folder; otherwise let the CLI
          // use its default (next to the source), which equals projectFolder.
          out: outDir ? pathForShape(m) : null,
          stem: stem !== projectStem ? stem : null,
          media: project?.mediaPath || null,
          blendSeams: options.blendSeams,
          finalSmooth: options.finalSmooth,
          stimWav: options.stimWav,
          stimMp3: options.stimMp3,
          includeMedia: options.includeMedia,
          exclude: excludeIds,
        });
        if (!res) { setWriteError('Export is unavailable in browser mode.'); return; }
        written.push({ ...res, shape: m });
      }
      setResults(written);
      if (toForgePlayer) {
        // Hand off: ForgePlayer now opens the bundle directly (its importer
        // boots straight into the scene), so pass the .forge — no reveal needed.
        const forgeRes = written.find((r) => r.shape === 'forge') || written[0];
        if (forgeRes?.path) await launchForgePlayer(false, forgeRes);
      }
    } catch (e) {
      setWriteError(String(e?.message || e));
      setAppError(String(e?.message || e));
    } finally {
      if (offProgress) { try { offProgress(); } catch { /* already torn down */ } }
      setBusy(null);
      setWriting(false);
    }
  };

  if (!project?.path) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Export</h2>
        <p>Open a funscript from the Library tab to begin.</p>
      </section>
    );
  }

  const destLabel = modes.map((m) => (m === 'forge' ? '.forge bundle' : 'loose folder')).join(' + ');
  const destSummary = toForgePlayer ? `${destLabel} · ForgePlayer` : destLabel;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px', background: 'var(--bg)' }}>
      {/* Hidden full-track lanes — the player's EXACT TrackStack render, kept
          in the DOM (offscreen, NOT display:none so the ResizeObserver sizes
          them) so doWrite can snapshot each <svg> to a Preview PNG. One lane
          each, full-track scope, no baton. */}
      <div aria-hidden style={{ position: 'absolute', left: -99999, top: 0, width: PREVIEW_W, pointerEvents: 'none' }}>
        <div ref={funscriptLaneRef} style={{ width: PREVIEW_W }}>
          <TrackStack
            scope={previewScope}
            actions={previewActions}
            lanes={['funscript']}
            funscriptColorMode="velocity"
            baton="none"
            laneHeights={{ funscript: PREVIEW_LANE_H.funscript }}
          />
        </div>
        <div ref={audioLaneRef} style={{ width: PREVIEW_W }}>
          <TrackStack
            scope={previewScope}
            waveform={hasWaveform ? trackPeaks : null}
            lanes={['audio']}
            baton="none"
            laneHeights={{ audio: PREVIEW_LANE_H.audio }}
          />
        </div>
        <div ref={spectroLaneRef} style={{ width: PREVIEW_W }}>
          <TrackStack
            scope={previewScope}
            spectrogram={hasSpectro ? trackSpectrogram : null}
            lanes={['spectro']}
            baton="none"
            laneHeights={{ spectro: PREVIEW_LANE_H.spectro }}
          />
        </div>
      </div>

      <Header stem={stem} stationCount={stampedStations.length} readyCount={readyCount} total={targets.length} />

      <ExportPreview project={project} stem={stem} />

      {/* TARGETS — what gets written; check what goes in the bundle */}
      <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{keptCount} of {targets.length} selected</span>}>
        What's in the bundle
      </SectionLabel>
      <div style={{
        marginTop: 6, marginBottom: 18,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10,
      }}>
        {targets.map((t) => (
          <TargetCard key={t.id} target={t} kept={kept.has(t.id)} onToggle={() => toggleKeep(t.id)} />
        ))}
      </div>

      {/* DESTINATIONS — where it goes */}
      <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>pick where it lands</span>}>
        Destinations
      </SectionLabel>
      <div style={{
        marginTop: 6, marginBottom: 18,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10,
        alignItems: 'start',
      }}>
        <DiskDestination
          shapes={shapes} onToggleShape={toggleShape} modes={modes}
          stem={stem} onStem={setStem}
          folder={folder} nameForShape={nameForShape}
          isCustom={!!outDir}
          onPickFolder={onPickFolder}
          onResetFolder={() => setOutDir(null)}
        />
        <ForgePlayerDestination on={toForgePlayer} onToggle={() => setToForgePlayer((v) => !v)} />
        <CloudDestination />
      </div>

      {/* OPTIONS — content-shaping toggles applied during write */}
      <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>applied during write</span>}>
        Options
      </SectionLabel>
      <Options options={options} onChange={setOptions} estimExportable={kept.has('estim')} hasMedia={hasMedia} />

      {/* ACTIONS — the verbs */}
      <ActionsRow
        destSummary={destSummary}
        readyCount={keptCount}
        canWrite={canWrite && keptCount > 0 && modes.length > 0}
        isSample={isSample}
        writing={writing}
        launching={launching}
        results={results}
        primary={primary}
        error={writeError}
        toForgePlayer={toForgePlayer}
        onWrite={doWrite}
        onReveal={() => primary?.path && revealPath(primary.path)}
        onCopy={() => results?.length && navigator.clipboard?.writeText(results.map((r) => r.path).join('\n'))}
        onForgePlayer={() => launchForgePlayer(true)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TARGETS — consumer-grouped readiness. Each group's `derive(ctx)` returns
// { state, hint, stat[], files[] } so the card reflects what the packager
// will actually write. States:
//   ready    — forged / stamped, will export (green)
//   auto     — generated at export from upstream assignments (blue)
//   present  — sidecar(s) present, will ride along (green)
//   optional — opt-in render, off unless toggled (neutral)
//   none     — nothing to write; do X first (dim)
// ──────────────────────────────────────────────────────────────
const TARGET_GROUPS = [
  {
    id: 'strokers',
    label: 'Strokers',
    ext: '.funscript',
    icon: 'move-3d',
    color: '#4dabf7',
    consumer: 'MultiFunPlayer · Intiface · Handy',
    derive(ctx) {
      const stamped = ctx.stampedStrokers;
      const files = ['motion.funscript', ...stamped.map((id) => `stations/${id}/`)];
      return {
        state: 'ready',
        hint: 'Stroke axis (L0) + any Polish-stamped device files. OSR2/SR6 ship as multi-axis funscripts (MultiFunPlayer / XTPlayer convert them to TCode for the firmware) — auto-generated from Channels if not stamped.',
        stat: [
          { label: 'actions', value: (ctx.actionCount || 0).toLocaleString() },
          { label: 'devices', value: stamped.length ? `${stamped.length} stamped` : 'motion + auto' },
        ],
        files,
      };
    },
  },
  {
    id: 'estim',
    label: 'E-stim',
    ext: '×9 channels',
    icon: 'zap',
    color: '#c075ff',
    consumer: 'restim · ForgePlayer',
    derive(ctx) {
      const audio = [ctx.stimWav && 'audio/stim.wav', ctx.stimMp3 && 'audio/stim.mp3'].filter(Boolean);
      if (ctx.estimStamped) {
        return {
          state: 'ready',
          hint: 'Polish-stamped 9-channel set. Authored events bake into the channels at generation.',
          stat: [{ label: 'channels', value: 9 }, { label: 'audio', value: audio.length ? audio.length : 'opt-in' }],
          files: ['stations/estim3p/  ×9', ...audio],
        };
      }
      return {
        state: 'auto',
        hint: 'Auto-generated at export from your per-chapter Channels characters (skipped if none assigned). Stamp E-Stim in Polish to tune it.',
        stat: [{ label: 'channels', value: '9 · auto' }, { label: 'audio', value: audio.length ? audio.length : 'opt-in' }],
        files: ['stations/estim3p/  ×9', ...audio],
      };
    },
  },
  {
    id: 'authoring',
    label: 'Forge metadata',
    ext: '.json · .yml',
    icon: 'file-cog',
    color: '#a3e635',
    consumer: 'reopen in FunscriptForge · Edger',
    derive(ctx) {
      // Honest empty state for a bare funscript: with no chapters there's no
      // forge metadata to pack, so don't show a green "present" card listing
      // sidecars that don't exist.
      if (!ctx.hasChapters) {
        return {
          state: 'none',
          hint: 'No forge metadata yet — detect chapters (Chapters tab), then add phrase tags, per-chapter characters, or events. Until then a bundle holds only the motion funscript.',
          stat: [{ label: 'sidecars', value: 'none yet' }],
          files: [],
        };
      }
      return {
        state: 'present',
        hint: 'The re-editable project: chapter boundaries, phrase tags, per-chapter characters, and the events sidecar. Pack it to reopen and reproduce this exact output later — leave it out for a play-only bundle.',
        stat: [{ label: 'sidecars', value: 'chapters · phrases · characters' }, { label: 'events', value: 'events.yml' }],
        files: ['{chapters,phrases,characters}.json', 'events.yml'],
      };
    },
  },
  {
    id: 'preview',
    label: 'Preview / share',
    ext: '.png',
    icon: 'image',
    color: '#c77dff',
    consumer: 'library cards · shareable previews',
    derive(ctx) {
      return {
        state: ctx.hasMedia ? 'ready' : 'optional',
        hint: ctx.hasMedia
          ? 'Funscript · audio · spectrogram lane images (the player’s own render) + hero & per-chapter frames (media attached).'
          : 'Funscript / audio / spectrogram lane images always ride (the player’s own render). Attach media for hero + per-chapter frames.',
        stat: [{ label: 'lanes', value: 'funscript · audio · spectro' }, { label: 'frames', value: ctx.hasMedia ? 'hero + chapters' : 'needs media' }],
        files: ['thumbnails/funscript.png', 'thumbnails/audio.png', 'thumbnails/spectrogram.png', ...(ctx.hasMedia ? ['thumbnails/hero.png', 'thumbnails/chapter_*.png'] : [])],
      };
    },
  },
];

const STATE_BADGE = {
  ready:    { tone: 'success', label: 'ready' },
  auto:     { tone: 'info',    label: 'auto' },
  present:  { tone: 'success', label: 'present' },
  optional: { tone: 'neutral', label: 'opt-in' },
  none:     { tone: 'warn',    label: 'not ready' },
};

function TargetCard({ target: t, kept = true, onToggle }) {
  const badge = STATE_BADGE[t.state] || STATE_BADGE.ready;
  // Unchecked = excluded from the bundle: dim it and drop the color accent.
  const off = !kept;
  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={kept}
      title={kept ? 'In the bundle — click to leave out' : 'Left out — click to include'}
      style={{
        position: 'relative', padding: 14, borderRadius: 10, cursor: 'pointer',
        background: off ? 'var(--surface-2, #12151e)' : 'var(--surface)',
        // Longhand only — mixing `border` shorthand with `borderLeft` warns in
        // React (shorthand/non-shorthand conflict on rerender).
        borderStyle: 'solid',
        borderWidth: '1px 1px 1px 4px',
        borderColor: `var(--border) var(--border) var(--border) ${off ? 'var(--border)' : t.color}`,
        display: 'flex', flexDirection: 'column', gap: 8,
        opacity: off ? 0.55 : 1,
        boxShadow: kept ? `0 0 0 1px ${t.color}33` : 'none',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
          background: `${t.color}26`, border: `1px solid ${t.color}59`, flexShrink: 0,
        }}>
          <Icon name={t.icon} size={13} style={{ color: t.color }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{t.label}</div>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.ext}</span>
        </div>
        <Pill tone={badge.tone} dot={badge.tone !== 'neutral'}>{badge.label}</Pill>
        {/* Keep/skip checkbox — mirrors the ForgeGen target pattern. */}
        <div style={{
          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: kept ? t.color : 'transparent',
          border: `1.5px solid ${kept ? t.color : 'var(--border-strong, var(--border))'}`,
          color: '#0e1117',
        }}>
          {kept && <Icon name="check" size={12} />}
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>{t.hint}</p>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
        <Icon name="arrow-right" size={10} style={{ verticalAlign: '-1px', marginRight: 4, color: 'var(--text-dim)' }} />
        {t.consumer}
      </div>

      <div style={{ display: 'flex', gap: 14, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
        {t.stat.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text)', fontWeight: 700 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// DESTINATIONS
// ──────────────────────────────────────────────────────────────
function DestShell({ color, icon, label, right, children, on = true }) {
  return (
    <div style={{
      padding: 14, borderRadius: 10,
      background: on ? 'var(--surface)' : 'var(--surface-2, #12151e)',
      // Longhand only — `border` shorthand + `borderLeft` warns on rerender.
      borderStyle: 'solid',
      borderWidth: '1px 1px 1px 4px',
      borderColor: (() => { const edge = on ? color : 'var(--border)'; return `${edge} ${edge} ${edge} ${color}`; })(),
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: on ? `0 0 0 1px ${color}40` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center',
          background: `${color}26`, border: `1px solid ${color}59`, flexShrink: 0,
        }}>
          <Icon name={icon} size={13} style={{ color }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function DiskDestination({ shapes, onToggleShape, modes, stem, onStem, folder, nameForShape, isCustom, onPickFolder, onResetFolder }) {
  return (
    <DestShell color="#4dabf7" icon="save" label="Disk"
               right={<Pill tone={isCustom ? 'success' : 'info'} dot>{isCustom ? 'custom folder' : 'project folder'}</Pill>}>
      <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
        Pick one or both shapes, then where they land:
      </p>
      <MultiSegmented
        selected={shapes}
        onToggle={onToggleShape}
        options={[
          { value: 'forge', label: '.forge bundle', hint: 'single zip · backup + re-import + sharing' },
          { value: 'loose', label: 'Output folder', hint: 'device folders + README, for any player' },
        ]}
      />
      {/* Resolved output path(s) — shown BEFORE writing so "where did it go?"
          never comes up. The folder is editable; the filename is derived. */}
      <div style={{ paddingTop: 8, borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
            {modes.length > 1 ? 'Lands here · both' : 'Lands here'}
          </span>
          {isCustom && (
            <button onClick={(e) => { e.stopPropagation(); onResetFolder?.(); }}
                    style={{ fontSize: 9.5, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              use project folder
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onPickFolder?.(); }}
                  style={{
                    fontSize: 10, fontWeight: 600, color: '#4dabf7', cursor: 'pointer',
                    background: 'rgba(77,171,247,0.12)', border: '1px solid rgba(77,171,247,0.4)',
                    borderRadius: 5, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
            <Icon name="folder" size={10} /> Change…
          </button>
        </div>
        {modes.map((m) => {
          const fullPath = `${folder || '—'}/${nameForShape(m)}`;
          return (
            <span key={m} className="mono" title={fullPath}
                  style={{ fontSize: 10.5, color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fullPath}
            </span>
          );
        })}
        <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
          Never overwrites — adds (1), (2)… if one's already there. Each export is a new snapshot.
        </span>
      </div>
      {shapes.has('loose') && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          stem
          <input
            type="text" value={stem} onChange={(e) => onStem(e.target.value)}
            className="mono"
            style={{
              flex: 1, fontSize: 11.5, padding: '5px 8px', background: 'var(--surface-2, #12151e)',
              borderRadius: 5, border: '1px solid var(--border)', color: 'var(--text)', outline: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
      )}
    </DestShell>
  );
}

function ForgePlayerDestination({ on, onToggle }) {
  return (
    <div role="button" tabIndex={0}
         onClick={onToggle}
         onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}
         style={{ cursor: 'pointer' }}>
      <DestShell color="#3ed598" icon="play" label="Open in ForgePlayer" on={on}
                 right={<CheckboxSquare checked={on} color="#3ed598" />}>
        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
          Hand the result to the LQR player. Launches ForgePlayer and reveals the file
          so you can drop it into a stim slot.
        </p>
        <div className="mono" style={{
          fontSize: 9.5, color: 'var(--text-dim)', padding: '4px 6px', borderRadius: 4,
          background: 'var(--surface-2, #12151e)',
        }}>
          dev launcher · full .forge auto-import is a ForgePlayer follow-up
        </div>
      </DestShell>
    </div>
  );
}

function CloudDestination() {
  return (
    <div style={{ opacity: 0.6 }}>
      <DestShell color="#3fd0c9" icon="upload-cloud" label="Autoblow cloud" on={false}
                 right={<Pill tone="neutral">later</Pill>}>
        <p style={{ fontSize: 11.5, color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
          Push the clamped stroke script to a Vacuglide / Autoblow device over the cloud SDK.
          Post-beta — needs an account token + the device.
        </p>
      </DestShell>
    </div>
  );
}

function CheckboxSquare({ checked, color }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 5,
      border: `1.5px solid ${checked ? color : 'var(--border-strong, var(--border))'}`,
      background: checked ? color : 'transparent',
      display: 'grid', placeItems: 'center', flexShrink: 0,
    }}>
      {checked && <Icon name="check" size={12} style={{ color: '#fff' }} />}
    </div>
  );
}

// Multi-select shape toggle — each option is an independent checkbox-button, so
// .forge bundle and Output folder can both be on. (Replaces the old single-pick
// Segmented; at least one stays selected, enforced by the parent toggle.)
function MultiSegmented({ selected, onToggle, options }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: 6 }}>
      {options.map((o) => {
        const sel = selected.has(o.value);
        return (
          <button key={o.value} onClick={(e) => { e.stopPropagation(); onToggle(o.value); }} style={{
            display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 9px', borderRadius: 6,
            background: sel ? 'rgba(77,171,247,0.12)' : 'var(--surface-2, #12151e)',
            border: `1px solid ${sel ? '#4dabf7' : 'var(--border)'}`,
            color: sel ? '#4dabf7' : 'var(--text-soft)', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${sel ? '#4dabf7' : 'var(--border-strong, var(--border))'}`,
                background: sel ? '#4dabf7' : 'transparent',
                display: 'grid', placeItems: 'center',
              }}>
                {sel && <Icon name="check" size={9} style={{ color: '#fff' }} />}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{o.label}</span>
            </span>
            <span style={{ fontSize: 9.5, color: sel ? 'rgba(77,171,247,0.85)' : 'var(--text-dim)' }}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// OPTIONS
// ──────────────────────────────────────────────────────────────
const OPTION_DEFS = [
  { id: 'blendSeams', label: 'Blend seams', desc: 'Smooths high-velocity jumps only at phrase boundaries.' },
  { id: 'finalSmooth', label: 'Final smooth', desc: 'Light global low-pass that removes residual sharp edges.' },
  { id: 'stimWav', label: 'Stim audio · WAV', desc: 'Pre-render the e-stim channels to stereo WAV (lossless, ~10 MB/min). Renders from the stamped E-Stim station, or the channels auto-generated from your Channels characters.', estim: true },
  { id: 'stimMp3', label: 'Stim audio · MP3', desc: 'Same render as MP3 (compact, the common real-world format). Renders from the stamped E-Stim station, or the auto-generated channels.', estim: true },
  { id: 'includeMedia', label: 'Include source media', desc: 'Embed the video/audio for a standalone bundle (big — GBs). Off = lean bundle that relinks to the original on disk (the manifest records its name + size).', media: true },
];

function Options({ options, onChange, estimExportable, hasMedia }) {
  const toggle = (id) => onChange((p) => ({ ...p, [id]: !p[id] }));
  return (
    <div style={{
      marginTop: 6, marginBottom: 18,
      display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
    }}>
      {OPTION_DEFS.map((o) => {
        const disabled = (o.estim && !estimExportable) || (o.media && !hasMedia);
        const disabledHint = o.media ? 'attach media first' : 'include e-stim first';
        const on = !!options[o.id] && !disabled;
        return (
          <label key={o.id} style={{
            display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10, padding: '10px 12px', borderRadius: 6,
            background: on ? 'rgba(77,171,247,0.05)' : 'var(--surface)',
            border: `1px solid ${on ? 'rgba(77,171,247,0.35)' : 'var(--border)'}`,
            cursor: disabled ? 'not-allowed' : 'pointer', alignItems: 'flex-start',
            opacity: disabled ? 0.5 : 1,
          }}>
            <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(o.id)}
                   style={{ marginTop: 4, accentColor: '#4dabf7' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {o.label}
                {disabled && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>· {disabledHint}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.45 }}>{o.desc}</div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ACTIONS
// ──────────────────────────────────────────────────────────────
function ActionsRow({
  destSummary, readyCount, canWrite, isSample, writing, launching, results, primary, error,
  toForgePlayer, onWrite, onReveal, onCopy, onForgePlayer,
}) {
  const wrote = !!(results && results.length);
  const totalArtifacts = wrote ? results.reduce((n, r) => n + (r.artifacts || 0), 0) : 0;
  const stations = primary?.stations?.length || 0;
  return (
    <>
      <SectionLabel>Actions</SectionLabel>
      <div style={{
        marginTop: 6, padding: 14,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <Button kind="ghost" size="sm" icon="folder-open" disabled={!wrote} onClick={onReveal}>Reveal</Button>
        <Button kind="ghost" size="sm" icon="copy" disabled={!wrote} onClick={onCopy}>Copy path</Button>
        <Button kind="ghost" size="sm" icon="play" disabled={!wrote || launching} onClick={onForgePlayer}>
          {launching ? 'Launching…' : 'Open in ForgePlayer →'}
        </Button>
        <span style={{ flex: 1 }} />
        {error && (
          <span style={{ fontSize: 11, color: '#ff5470', maxWidth: 380, textAlign: 'right' }}>{error}</span>
        )}
        {wrote && !error && (
          <span style={{ fontSize: 11, color: '#3ed598', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={12} />
            Wrote {totalArtifacts} file{totalArtifacts === 1 ? '' : 's'}
            {results.length > 1 ? ` across ${results.length} outputs` : ''}
            {stations ? ` · ${stations} station${stations === 1 ? '' : 's'}` : ''}
            {primary?.manifest?.project_version ? ` · snapshot v${primary.manifest.project_version}` : ''}
            {' → '}
            <span className="mono" style={{ color: 'var(--text-soft)' }}>{shortPath(primary.path)}</span>
          </span>
        )}
        {!wrote && !error && !canWrite && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {isSample ? 'Export needs a real project on disk.' : 'Open a project to export.'}
          </span>
        )}
        <Button kind="primary" size="sm" icon="download" disabled={!canWrite || writing} onClick={onWrite}>
          {writing ? 'Writing…' : `Export (${readyCount} → ${destSummary})`}
        </Button>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Header + ExportPreview + helpers (preserved)
// ──────────────────────────────────────────────────────────────
function Header({ stem, stationCount, readyCount, total }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          Export · end of the pipeline
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>Targets · Destinations · Actions</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4, maxWidth: 720, lineHeight: 1.45 }}>
          Pick what to write, where it lands, and the verb. Export is a packager — it collects
          the motion track, the device files Polish stamped, events, and authoring sidecars, and
          only writes new files (nothing destructive).
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Pill tone={readyCount > 0 ? 'success' : 'neutral'} dot>{readyCount}/{total} targets</Pill>
        <Pill tone={stationCount > 0 ? 'info' : 'neutral'} dot>
          {stationCount} station{stationCount === 1 ? '' : 's'}
        </Pill>
        <Pill tone="neutral">{stem}</Pill>
      </div>
    </div>
  );
}

function ExportPreview({ project, stem }) {
  const actions = project?.actions ?? [];
  const totalMs = project?.durationMs ?? 0;
  const actionCount = project?.actionCount ?? actions.length;
  return (
    <div style={{ marginTop: 16, marginBottom: 4 }}>
      <SectionLabel right={<Pill tone="success" dot>fresh</Pill>}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" size={12} style={{ color: 'var(--accent)' }} />
          Export preview
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>
            final funscript · all accepted transforms applied
          </span>
        </span>
      </SectionLabel>
      <div style={{ marginTop: 6, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        {actions.length > 0 ? (
          <FunscriptChart actions={actions} totalMs={totalMs} totalActionCount={actionCount} height={200} />
        ) : (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
            No actions in the loaded funscript — preview unavailable.
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><span className="mono" style={{ color: 'var(--text-soft)' }}>{stem}.funscript</span> · primary stroke axis</span>
          <span style={{ flex: 1 }} />
          <span>scroll / drag the chart to inspect any region before writing</span>
        </div>
      </div>
    </div>
  );
}

function shortPath(p) {
  if (!p) return '';
  const parts = String(p).split(/[/\\]/);
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`;
}

function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 4,
    }}>
      <span>{children}</span>
      {right}
    </div>
  );
}
