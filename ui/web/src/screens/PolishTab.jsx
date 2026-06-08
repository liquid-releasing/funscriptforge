// Polish — the last step before Export. Shapes the device-agnostic Channels
// output into device-ready files via per-station "forge passes" (clamp +
// smoothing + lag), Stamping one output (or TCode set) per station.
//
// Assembly-line layout (v3 variant B): a conveyor of stations across the top
// (Channels source -> each device), and a workbench below for the focused
// station — 3-pane live preview + knobs + Stamp. Preview runs in-process via
// polishEngine.js on a representative window; Stamp writes the whole track via
// Python (polishApply) and records it in <stem>.polish.yml (polishWrite).

import React, { useEffect, useMemo, useState } from 'react';

import { polishApply, polishRead, polishWrite } from '../api/forge.js';
import { POLISH_DEVICES, outputFilesFor } from '../data/polishDevices.js';
import { previewPass, resolveKnobs } from '../data/polishEngine.js';
import {
  AnvilGlyph, DeviceGlyph, HeatMeter, KnobRow, MiniTrace, Sparks,
  StatTriplet, StateBadge, TracePane, shade,
} from './polish/PolishWidgets.jsx';

const PREVIEW_MS = 30000;          // representative preview window length
const EXPRESSIVE = true;           // forge metaphor (sparks / hot anvil)

function seedKnobs() {
  const o = {};
  for (const d of POLISH_DEVICES) o[d.id] = resolveKnobs(d);
  return o;
}

// RMS difference between source and performed, normalised 0..1 — how much the
// station reshaped the signal ("burn-off"). Mirrors the design's burnOff.
function burnOff(tr) {
  const a = tr?.character || [];
  const b = tr?.performed || [];
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i].pos - b[i].pos) ** 2;
  return Math.min(1, Math.sqrt(s / n) / 30);
}

export default function PolishTab({ project, setAppError = () => {}, setBusy = () => {} }) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const path = project?.path ?? null;
  const isSample = typeof path === 'string' && path.startsWith('sample://');
  const canStamp = !!path && !isSample;
  const stem = useMemo(() => {
    if (!path) return 'scene';
    const base = path.split(/[\\/]/).pop() || 'scene';
    return base.replace(/\.[^.]+$/, '');
  }, [path]);

  const [focused, setFocused] = useState(POLISH_DEVICES[0]?.id);
  const [knobs, setKnobs] = useState(seedKnobs);
  const [passes, setPasses] = useState({});        // id -> {accepted, accepted_at, knobs, source_hash}
  const [currentHash, setCurrentHash] = useState('');
  const [stamping, setStamping] = useState(null);  // id currently being stamped
  const [stampError, setStampError] = useState({}); // id -> message

  const focusedDevice = POLISH_DEVICES.find((d) => d.id === focused) || POLISH_DEVICES[0];
  const ember = focusedDevice.ember;

  // ── Load the polish.yml stamp record on mount / project switch ──────────
  useEffect(() => {
    setPasses({});
    setStampError({});
    setKnobs(seedKnobs());
    if (!path) return undefined;
    let cancelled = false;
    polishRead(path)
      .then((res) => {
        if (cancelled || !res) return;
        setCurrentHash(res.current_hash || '');
        const p = res.passes || {};
        setPasses(p);
        setKnobs((prev) => {
          const next = { ...prev };
          for (const d of POLISH_DEVICES) {
            if (p[d.id]?.knobs) next[d.id] = { ...next[d.id], ...p[d.id].knobs };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [path]);

  // ── Representative preview window (active/first chapter, capped) ─────────
  const previewWindow = useMemo(() => {
    if (!actions.length) return null;
    const t0 = actions[0].at;
    const tN = actions[actions.length - 1].at;
    const ch = chapters[0];
    const start = ch ? (ch.atMs ?? t0) : t0;
    const chEnd = ch ? (ch.endMs ?? tN) : tN;
    const end = Math.min(chEnd, start + PREVIEW_MS);
    return { start, end: end > start ? end : Math.min(tN, start + PREVIEW_MS) };
  }, [actions, chapters]);

  const windowLen = previewWindow ? Math.max(1, previewWindow.end - previewWindow.start) : 1;

  const windowActions = useMemo(() => {
    if (!previewWindow) return [];
    return actions
      .filter((a) => a.at >= previewWindow.start && a.at <= previewWindow.end)
      .map((a) => ({ at: a.at - previewWindow.start, pos: a.pos }));
  }, [actions, previewWindow]);

  const ribbon = useMemo(() => {
    if (!previewWindow) return [];
    const within = chapters.filter((c) => (c.endMs ?? previewWindow.end) > previewWindow.start && (c.atMs ?? 0) < previewWindow.end);
    if (!within.length) return [{ id: 'win', start: 0, end: windowLen, label: 'Preview window', color: '#6b7390' }];
    return within.map((c, i) => ({
      id: c.id ?? `c${i}`,
      start: Math.max(0, (c.atMs ?? 0) - previewWindow.start),
      end: Math.min(windowLen, (c.endMs ?? previewWindow.end) - previewWindow.start),
      label: c.name || c.tag || `Chapter ${i + 1}`,
      color: '#6b7390',
    }));
  }, [chapters, previewWindow, windowLen]);

  // ── Traces for every station (cheap pure-JS pass on the window) ─────────
  const allTraces = useMemo(() => {
    const m = {};
    for (const d of POLISH_DEVICES) {
      m[d.id] = windowActions.length >= 2
        ? previewPass(windowActions, d, knobs[d.id])
        : { character: [], clamped: [], performed: [], stats: {} };
    }
    return m;
  }, [windowActions, knobs]);

  const traces = allTraces[focusedDevice.id] || { character: [], clamped: [], performed: [], stats: {} };

  const setKnob = (id, key, value) => {
    setKnobs((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
    // Editing knobs breaks the stamp seal — the written file no longer matches.
    setPasses((p) => (p[id]?.accepted ? { ...p, [id]: { ...p[id], accepted: false } } : p));
  };

  const stateOf = (d) => {
    const p = passes[d.id];
    if (p?.accepted) {
      if (currentHash && p.source_hash && p.source_hash !== currentHash) return 'stale';
      return 'accepted';
    }
    if (d.id === focused) return 'active';
    return 'pending';
  };

  const stampedCount = POLISH_DEVICES.filter((d) => stateOf(d) === 'accepted').length;

  const stamp = async (d) => {
    if (!canStamp) return;
    setStamping(d.id);
    setStampError((e) => ({ ...e, [d.id]: null }));
    // Forging the whole track is slow — e-stim regenerates 9 channels per
    // chapter via funscript-tools, TCode the axis set. Surface it in the
    // footer so the wait isn't a silent "is it stuck?".
    const forgingMsg = d.kind === 'estim'
      ? `Forging ${d.label} — generating 9 channels per chapter (this can take a bit)…`
      : d.tcode
        ? `Forging ${d.label} — generating the multi-axis TCode set…`
        : `Forging ${d.label} — clamping the whole track…`;
    setBusy({ message: forgingMsg });
    try {
      const res = await polishApply(path, d.id, knobs[d.id]);
      if (!res || res.error) {
        // Expected guidance (e.g. "assign a character") — surface INLINE under
        // the station's Stamp button, not via the global app-error banner
        // (which would bleed onto every other tab, incl. Export).
        setStampError((e) => ({ ...e, [d.id]: res?.error || 'Stamp failed' }));
        return;
      }
      const next = {
        ...passes,
        [d.id]: {
          accepted: true,
          accepted_at: new Date().toISOString(),
          knobs: knobs[d.id],
          source_hash: res.source_hash || currentHash,
        },
      };
      setPasses(next);
      if (res.source_hash) setCurrentHash(res.source_hash);
      await polishWrite(path, next);
    } catch (err) {
      const msg = String(err?.message || err);
      setStampError((e) => ({ ...e, [d.id]: msg }));
      setAppError(msg);
    } finally {
      setStamping(null);
      setBusy(null);
    }
  };

  const outputFiles = outputFilesFor(focusedDevice, stem);
  const focusedState = stateOf(focusedDevice);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e1117', color: '#fafafa' }}>
      {/* ── Headline ─────────────────────────────────────────────── */}
      <div style={{ padding: '16px 28px 6px', display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Polish</h1>
        <span style={{ fontSize: 13, color: '#9ba3c4' }}>
          One pipeline. Each station forges a device-ready file from your Channels output.
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6b7390' }}>
          {stampedCount}/{POLISH_DEVICES.length} stamped
        </span>
      </div>

      {/* ── Conveyor: stations row (slim — leave the bench room) ────── */}
      <div style={{ padding: '8px 28px 10px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: `auto repeat(${POLISH_DEVICES.length}, 1fr)`,
          alignItems: 'stretch', gap: 0, background: '#12151e', border: '1px solid #2d3148',
          borderRadius: 12, padding: 10,
        }}>
          {/* Origin — Channels source */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 18px 0 6px', borderRight: '1px dashed #3a3f5c', minWidth: 110 }}>
            <div style={{ width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', background: 'rgba(155,163,196,0.08)', border: '1px solid #3a3f5c' }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#9ba3c4" strokeWidth={1.8}>
                <path d="M4 14 Q 8 6 12 14 T 20 14" />
                <circle cx={4} cy={14} r={1.5} fill="#9ba3c4" />
              </svg>
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ba3c4', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>Channels</div>
            <div style={{ fontSize: 10, color: '#6b7390', marginTop: 2 }}>source</div>
          </div>

          {POLISH_DEVICES.map((d, i) => {
            const isFocused = d.id === focused;
            const st = stateOf(d);
            const dTraces = allTraces[d.id];
            return (
              <button key={d.id} onClick={() => setFocused(d.id)} style={{
                position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6,
                padding: '10px 12px', border: 'none', background: isFocused ? `${d.ember}10` : 'transparent',
                borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                outline: isFocused ? `1px solid ${d.ember}66` : '1px solid transparent',
              }}>
                <span style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', color: '#3a3f5c', fontSize: 14 }}>→</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, display: 'grid', placeItems: 'center', background: isFocused ? `${d.ember}22` : '#1a1d27', border: `1px solid ${isFocused ? d.ember + '55' : '#2d3148'}` }}>
                    <DeviceGlyph kind={d.glyph} size={16} ember={isFocused || st === 'accepted' ? d.ember : '#9ba3c4'} glow={isFocused && EXPRESSIVE} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.label}{d.experimental && <span style={{ color: '#ffb547', fontSize: 9, marginLeft: 4 }}>exp</span>}
                    </div>
                    <div style={{ fontSize: 9.5, color: '#6b7390', lineHeight: 1.2 }}>{d.sublabel}</div>
                  </div>
                  {st === 'accepted' && (
                    <span style={{ width: 16, height: 16, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'rgba(62,213,152,0.18)', color: '#3ed598', fontSize: 10, fontWeight: 800 }}>✓</span>
                  )}
                </div>
                <div style={{ height: 26, background: 'rgba(255,255,255,0.02)', borderRadius: 4, overflow: 'hidden', padding: '3px 4px' }}>
                  <MiniTrace samples={dTraces?.performed} totalMs={windowLen} ember={d.ember} />
                </div>
                <HeatMeter value={burnOff(dTraces)} ember={d.ember} height={3} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, fontFamily: 'var(--font-mono)', color: '#6b7390', marginTop: 2 }}>
                  <span>0{i + 1}</span>
                  <StateBadge state={st} ember={d.ember} />
                </div>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 10.5, color: '#6b7390', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', display: 'flex', gap: 14 }}>
          <span>↑ click any station to bring it to the bench</span>
          <span style={{ color: '#3a3f5c' }}>·</span>
          <span>preview is a {Math.round(windowLen / 1000)}s window; Stamp forges the whole track</span>
        </div>
      </div>

      {/* ── Workbench ────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '0 28px 24px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, minHeight: 0 }}>
        {/* Left: anvil + 3-pane preview + stats */}
        <section style={{
          background: EXPRESSIVE ? `linear-gradient(180deg, ${ember}08, transparent 30%), #12151e` : '#12151e',
          border: `1px solid ${EXPRESSIVE ? ember + '33' : '#2d3148'}`, borderRadius: 12,
          padding: '18px 22px', overflow: 'auto', position: 'relative',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          {EXPRESSIVE && <Sparks ember={ember} count={6} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, position: 'relative' }}>
            <AnvilGlyph size={44} hot={EXPRESSIVE} ember={ember} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: ember, letterSpacing: '0.16em', textTransform: 'uppercase' }}>On the bench</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>
                {focusedDevice.label}{focusedDevice.experimental && <span style={{ fontSize: 11, color: '#ffb547', marginLeft: 8 }}>experimental</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#6b7390', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>output</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: ember, marginTop: 2 }}>{outputFiles[0]}</div>
              {outputFiles.length > 1 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6b7390', marginTop: 1 }}>+ {outputFiles.length - 1} axis sibling{outputFiles.length - 1 > 1 ? 's' : ''}</div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 150, background: 'rgba(255,255,255,0.015)', border: '1px solid #2d3148', borderRadius: 8, padding: '14px 16px', marginBottom: 14, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7390', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Three-pane preview</div>
            {windowActions.length >= 2 ? (
              <div style={{ flex: 1, minHeight: 0 }}>
                <TracePane traces={traces} phrases={ribbon} totalMs={windowLen} ember={ember} fill />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#6b7390', fontSize: 13 }}>
                {path ? 'No actions in the preview window.' : 'Open a project to preview.'}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, position: 'relative' }}>
            <StatTriplet label="Peak BPM" src={traces.stats.srcMaxBpm ?? ''} polished={traces.stats.clampMaxBpm ?? ''} accent={ember} />
            <StatTriplet label="RMS" src={traces.stats.srcRms ?? ''} polished={traces.stats.clampRms ?? ''} accent={ember} />
            <StatTriplet label="Peak Δ" src="" polished={`${traces.stats.peakDelta ?? 0}%`} accent={ember} />
            <StatTriplet label="Mech. lag" src="" polished={`${traces.stats.mechLagMs ?? 0} ms`} accent={ember} />
          </div>
        </section>

        {/* Right: knobs + Stamp */}
        <aside style={{ background: '#12151e', border: '1px solid #2d3148', borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #2d3148' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: ember, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Hammer &amp; tongs</div>
            <div style={{ fontSize: 11, color: '#6b7390', marginTop: 2 }}>{focusedDevice.constraintHint}</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
            {focusedDevice.knobs.map((k) => (
              <KnobRow key={k.key} knob={k} value={knobs[focusedDevice.id]?.[k.key]} onChange={(v) => setKnob(focusedDevice.id, k.key, v)} ember={ember} dense />
            ))}
          </div>
          <div style={{ borderTop: '1px solid #2d3148', padding: '12px 18px' }}>
            {stampError[focusedDevice.id] && (
              <div style={{ fontSize: 11, color: '#ff6b6b', marginBottom: 8, lineHeight: 1.3 }}>{stampError[focusedDevice.id]}</div>
            )}
            <button
              onClick={() => stamp(focusedDevice)}
              disabled={!canStamp || stamping === focusedDevice.id}
              style={{
                width: '100%', borderRadius: 8, padding: '11px 16px',
                background: focusedState === 'accepted' ? 'transparent' : `linear-gradient(135deg, ${ember}, ${shade(ember, -20)})`,
                color: focusedState === 'accepted' ? '#3ed598' : '#fff',
                fontWeight: 700, fontSize: 12.5,
                cursor: canStamp && stamping !== focusedDevice.id ? 'pointer' : 'not-allowed',
                opacity: canStamp ? 1 : 0.5,
                boxShadow: focusedState === 'accepted' ? 'none' : `0 4px 14px ${ember}55`,
                border: focusedState === 'accepted' ? '1px solid rgba(62,213,152,0.4)' : 'none',
              }}
            >
              {stamping === focusedDevice.id ? 'Forging…'
                : focusedState === 'accepted' ? '✓ Stamped · re-forge'
                  : focusedState === 'stale' ? 'Re-stamp · source changed'
                    : 'Stamp this pass'}
            </button>
            {!canStamp && (
              <div style={{ fontSize: 10, color: '#6b7390', marginTop: 8, textAlign: 'center' }}>
                {isSample ? 'Stamping needs a real project on disk.' : 'Open a project to stamp.'}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
