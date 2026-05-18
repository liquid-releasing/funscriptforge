// ExportTab — the end of the pipeline. SKELETON pass: shows the
// shape of what Export will write, in either of two modes:
//
//   Loose files (dev)  — multiple sidecars + funscripts land in the
//                        project folder. Today's reality; the way
//                        external tools that read chapters.json / etc.
//                        keep working.
//   .forge bundle (v1) — single zip with manifest.ffmeta + funscripts
//                        + audio + thumbnails. The shape the LQR
//                        multi-modal player consumes. See memory
//                        `project_export_bundle_design.md`.
//
// Skeleton ships: mode toggle, artifact summary (checkboxes + filenames),
// naming controls (loose mode) or bundle preview (forge mode), 4 stub
// compatibility checks, disabled Write button. No real file writes —
// that lands in the wiring pass with `cli.py export` (forge bundle) and
// `cli.py finalize` (loose files).
//
// State is local. Cross-tab artifact awareness (which artifacts are
// actually fresh vs stale) attaches when the chain-file plumbing lands.

import { useMemo, useState } from 'react';
import { Pill, Button, Icon, fmtTimeShort } from 'forgemoment';
import FunscriptChart from '../components/FunscriptChart.jsx';

const MODES = [
  {
    id: 'loose',
    label: 'Loose files',
    subtitle: 'dev — multiple sidecars in the project folder',
  },
  {
    id: 'forge',
    label: '.forge bundle',
    subtitle: 'v1 — single zip the LQR player consumes',
  },
];

// What can ship today. Each artifact carries:
//   id, kind ('funscript'|'sidecar'|'audio'|'thumbnail'|'manifest')
//   desc, devicesRequired (subset of project's selectedDevices that must
//   be on for this artifact to make sense), default enabled state.
//
// `name` is a function so loose/forge modes can produce different paths
// (loose = sidecar next to funscript; forge = path inside the zip).
const ARTIFACTS = [
  {
    id: 'motion',
    kind: 'funscript',
    desc: 'Primary stroke axis (L0). Required for any linear stroker.',
    devicesRequired: [],
    defaultEnabled: true,
  },
  {
    id: 'motion-osr',
    kind: 'funscript',
    desc: 'Multi-axis sidecars: roll / pitch / sway. Required for OSR2 / SR6.',
    devicesRequired: ['sr6'],
    defaultEnabled: true,
  },
  {
    id: 'estim-channels',
    kind: 'funscript',
    desc: '9-channel e-stim envelopes generated from per-chapter characters.',
    devicesRequired: ['estim'],
    defaultEnabled: true,
  },
  {
    id: 'events',
    kind: 'sidecar',
    desc: 'Point-in-time effects (edge, hold, surge…) from Events tab.',
    devicesRequired: [],
    defaultEnabled: true,
  },
  {
    id: 'authoring-sidecars',
    kind: 'sidecar',
    desc: 'Authoring analysis: chapter boundaries, phrase tags, stanza assignments, per-chapter characters. One JSON file per analysis kind — emitted only when the corresponding tab produced data.',
    devicesRequired: [],
    defaultEnabled: true,
  },
  {
    id: 'heatmap',
    kind: 'thumbnail',
    desc: 'Velocity-colored heatmap PNG of the primary funscript. Library cards / shareable previews.',
    devicesRequired: [],
    defaultEnabled: true,
  },
  {
    id: 'stim-audio',
    kind: 'audio',
    desc: 'Stereo WAV rendered from the alpha/beta channels. Plays directly on the e-stim device.',
    devicesRequired: ['estim'],
    defaultEnabled: true,
  },
  {
    id: 'thumbnails',
    kind: 'thumbnail',
    desc: 'Per-chapter snapshot PNGs (hero + chapter_*.png). Forge only.',
    devicesRequired: [],
    defaultEnabled: true,
    forgeOnly: true,
  },
  {
    id: 'manifest',
    kind: 'manifest',
    desc: 'manifest.ffmeta — what artifacts the bundle contains and how they relate.',
    devicesRequired: [],
    defaultEnabled: true,
    forgeOnly: true,
  },
];

// Output variants — same logical channel set, different encodings for
// specific hardware. Per-variant `check(ctx)` runs against the loaded
// project and returns { tone, msg } when something's outside the
// device's limits — surfaced as a caution triangle in the UI. ctx
// fields used today: actionCount; expandable as wiring lands.
const OUTPUT_VARIANTS = {
  mechanical: {
    label: 'Mechanical',
    variants: [
      {
        id: 'mech-1d',
        label: 'Mechanical (Handy / OSR2 / Intiface)',
        desc: 'One 1D funscript covering Handy, OSR2, and Bluetooth devices (Lovense, Kiiroo). Velocity limit comes from The Handy (most restrictive).',
        defaultEnabled: true,
        check: (ctx) => {
          if (ctx.actionCount > 10000) {
            return {
              tone: 'warn',
              msg: `${ctx.actionCount.toLocaleString()} actions exceeds The Handy's ~10,000 ceiling. The writer will downsample at export time.`,
            };
          }
          return null;
        },
      },
    ],
  },
  estim: {
    label: 'E-stim',
    note: 'Channel funscripts are identical regardless of which e-stim variant is checked. The difference is the WAV encoding / protocol metadata.',
    variants: [
      {
        id: 'estim-audio-pulse',
        label: 'Audio 3-phase — pulse',
        sublabel: 'Tingler / EstimHero / ZC95',
        desc: 'Pulse train with cosine envelope · stereo WAV · default',
        defaultEnabled: true,
        audio: true,
      },
      {
        id: 'estim-audio-continuous',
        label: 'Audio 3-phase — continuous',
        sublabel: 'Legacy 2b / 312',
        desc: 'Continuous sine carrier · stereo WAV',
        defaultEnabled: false,
        audio: true,
        check: (ctx) => {
          if (ctx.actionCount > 8000) {
            return {
              tone: 'warn',
              msg: 'Legacy 2b / 312 may struggle with very dense content. Consider Pulse encoding for high-density scenes.',
            };
          }
          return null;
        },
      },
      {
        id: 'estim-foc-3',
        label: 'FOC-Stim — 3-phase',
        desc: 'Protocol device · channel funscripts · restim required',
        defaultEnabled: false,
      },
      {
        id: 'estim-foc-4',
        label: 'FOC-Stim — 4-phase',
        desc: 'Protocol device · experimental four-phase mode',
        defaultEnabled: false,
      },
      {
        id: 'estim-neostim',
        label: 'NeoStim — 3-phase',
        desc: 'Protocol device · NeoStim three-phase mode',
        defaultEnabled: false,
      },
    ],
  },
};

function defaultVariantState() {
  const out = {};
  Object.values(OUTPUT_VARIANTS).forEach((group) => {
    group.variants.forEach((v) => { out[v.id] = v.defaultEnabled; });
  });
  return out;
}

// Loose-mode filename per suffix scheme. The .axis. vs _axis. distinction
// matters: most players expect `.roll.funscript`; legacy players need
// `_roll.funscript`.
function looseFilename(stem, id, scheme) {
  const sep = scheme === 'underscore' ? '_' : '.';
  switch (id) {
    case 'motion':         return `${stem}.funscript`;
    case 'motion-osr':     return `${stem}${sep}roll.funscript · ${stem}${sep}pitch.funscript · ${stem}${sep}sway.funscript`;
    case 'estim-channels': return `${stem}.channels/<character>/<channel>.funscript  (×9)`;
    case 'events':         return `${stem}.events.yml`;
    case 'authoring-sidecars':
      return `${stem}.{chapters,phrases,stanzas,characters}.json  (×4)`;
    case 'heatmap':        return `${stem}.heatmap.png`;
    case 'stim-audio':     return `${stem}.stim.wav`;
    case 'thumbnails':     return '—';
    case 'manifest':       return `${stem}.ffmeta`;
    default:               return '?';
  }
}

// .forge bundle internal path. Matches the proposed layout in the
// export-bundle memory.
function forgeBundlePath(id) {
  switch (id) {
    case 'motion':         return 'motion.funscript';
    case 'motion-osr':     return 'motion.osr.funscript';
    case 'estim-channels': return 'stim/<character>/<channel>.funscript  (×9)';
    case 'events':         return 'events.yml';
    case 'authoring-sidecars':
      return '{chapters,phrases,stanzas,characters}.json  (×4)';
    case 'heatmap':        return 'thumbnails/waveform.png';
    case 'stim-audio':     return 'audio/stim.wav';
    case 'thumbnails':     return 'thumbnails/  (hero.png + chapter_*.png)';
    case 'manifest':       return 'manifest.ffmeta';
    default:               return '?';
  }
}

export default function ExportTab({ project, selectedDevices = [] }) {
  const projectStem = useMemo(() => {
    if (!project?.path) return 'project';
    const file = String(project.path).split(/[/\\]/).pop() || 'project';
    return file.replace(/\.funscript$/i, '');
  }, [project?.path]);

  const [mode, setMode] = useState('forge');
  const [enabled, setEnabled] = useState(() =>
    Object.fromEntries(ARTIFACTS.map((a) => [a.id, a.defaultEnabled])),
  );
  const [stem, setStem] = useState(projectStem);
  const [suffixScheme, setSuffixScheme] = useState('dot'); // 'dot' | 'underscore'
  // Post-processing applied during write — these modify the primary funscript's
  // content, not the artifact set. Default both on; the wiring pass plumbs
  // them through cli.py finalize / cli.py export.
  const [postProcessing, setPostProcessing] = useState({
    blendSeams: true,
    finalSmooth: true,
  });
  const [variants, setVariants] = useState(defaultVariantState);

  // Skeleton-only artifact filter: show what's relevant given the project's
  // selected devices + the active mode. An artifact is "available" if (a)
  // it has no device prerequisites OR (b) at least one of its required
  // devices is selected. Forge-only artifacts hide in loose mode.
  const availableArtifacts = useMemo(() => {
    return ARTIFACTS.filter((a) => {
      if (a.forgeOnly && mode !== 'forge') return false;
      if (a.devicesRequired.length === 0) return true;
      return a.devicesRequired.some((d) => selectedDevices.includes(d));
    });
  }, [mode, selectedDevices]);

  const checkedCount = availableArtifacts.filter((a) => enabled[a.id]).length;

  const toggle = (id) => setEnabled((e) => ({ ...e, [id]: !e[id] }));

  if (!project?.path) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Export</h2>
        <p>Open a funscript from the Library tab to begin.</p>
      </section>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px', background: 'var(--bg)' }}>
      <Header
        mode={mode}
        stem={stem}
        checkedCount={checkedCount}
        availableCount={availableArtifacts.length}
      />

      <ModeToggle mode={mode} onChange={setMode} />

      <ExportPreview
        project={project}
        stem={stem}
      />

      <PostProcessing
        postProcessing={postProcessing}
        onChange={setPostProcessing}
      />

      <ArtifactSummary
        mode={mode}
        artifacts={availableArtifacts}
        enabled={enabled}
        stem={stem}
        suffixScheme={suffixScheme}
        onToggle={toggle}
      />

      <OutputVariants
        selectedDevices={selectedDevices}
        variants={variants}
        onChange={setVariants}
        project={project}
      />

      {mode === 'loose' ? (
        <NamingControls
          stem={stem}
          onStemChange={setStem}
          suffixScheme={suffixScheme}
          onSuffixSchemeChange={setSuffixScheme}
          projectPath={project.path}
        />
      ) : (
        <BundlePreview stem={stem} />
      )}

      <CompatibilityChecks mode={mode} />

      <FooterActions mode={mode} stem={stem} checkedCount={checkedCount} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────
function Header({ mode, stem, checkedCount, availableCount }) {
  const modeLabel = MODES.find((m) => m.id === mode)?.label || mode;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>
          Export · end of the pipeline
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
          Write outputs
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4,
          maxWidth: 720, lineHeight: 1.45,
        }}>
          Pack the project for the LQR player ({modeLabel.toLowerCase()}).
          Nothing is destructive — Export only writes new files.
          The actual writer lands with the wiring pass; checkboxes and naming reflect what would land.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Pill tone="info" dot>{checkedCount} of {availableCount}</Pill>
        <Pill tone="neutral">{stem}</Pill>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Mode toggle — Loose vs .forge bundle
// ──────────────────────────────────────────────────────────────
function ModeToggle({ mode, onChange }) {
  return (
    <div style={{
      marginTop: 14,
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 8,
    }}>
      {MODES.map((m) => {
        const sel = m.id === mode;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            style={{
              display: 'flex', flexDirection: 'column',
              padding: '12px 14px', borderRadius: 8,
              background: sel ? 'rgba(77,171,247,0.10)' : 'var(--surface)',
              border: `1.5px solid ${sel ? '#4dabf7' : 'var(--border)'}`,
              color: 'var(--text)', cursor: 'pointer',
              fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: sel ? '#4dabf7' : 'var(--text-soft)',
            }}>
              {m.label}
            </span>
            <span style={{
              fontSize: 11, color: 'var(--text-dim)', marginTop: 2,
            }}>
              {m.subtitle}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ExportPreview — final funscript at full width
// ──────────────────────────────────────────────────────────────
function ExportPreview({ project, stem }) {
  const actions = project?.actions ?? [];
  const totalMs = project?.durationMs ?? 0;
  const actionCount = project?.actionCount ?? actions.length;
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel right={(
        <Pill tone="success" dot>fresh</Pill>
      )}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="activity" size={12} style={{ color: 'var(--accent)' }} />
          Export preview
          <span style={{
            fontSize: 10, fontWeight: 500, color: 'var(--text-dim)',
            textTransform: 'none', letterSpacing: 0,
          }}>
            final funscript · all accepted transforms applied
          </span>
        </span>
      </SectionLabel>
      <div style={{
        marginTop: 6, padding: 14,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8,
      }}>
        {actions.length > 0 ? (
          <FunscriptChart
            actions={actions}
            totalMs={totalMs}
            totalActionCount={actionCount}
            height={220}
          />
        ) : (
          <div style={{
            padding: 32, textAlign: 'center', fontSize: 12,
            color: 'var(--text-dim)',
          }}>
            No actions in the loaded funscript — preview unavailable.
          </div>
        )}
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--text-dim)',
          display: 'flex', gap: 16, flexWrap: 'wrap',
        }}>
          <span><span className="mono" style={{ color: 'var(--text-soft)' }}>{stem}.funscript</span> · primary stroke axis</span>
          <span style={{ flex: 1 }} />
          <span>scroll / drag the chart to inspect any region before writing</span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// PostProcessing — content-modifying toggles applied during write
// ──────────────────────────────────────────────────────────────
const POST_OPTIONS = [
  {
    id: 'blendSeams',
    label: 'Blend seams',
    desc: 'Detects high-velocity jumps at phrase boundaries and applies targeted smoothing only at those seams.',
  },
  {
    id: 'finalSmooth',
    label: 'Final smooth',
    desc: 'Light global low-pass pass that removes residual sharp edges.',
  },
];

function PostProcessing({ postProcessing, onChange }) {
  const toggle = (id) => onChange((p) => ({ ...p, [id]: !p[id] }));
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel right={(
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          applied during write
        </span>
      )}>
        Post-processing
      </SectionLabel>
      <div style={{
        marginTop: 6,
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
      }}>
        {POST_OPTIONS.map((o) => {
          const on = !!postProcessing[o.id];
          return (
            <label key={o.id} style={{
              display: 'grid',
              gridTemplateColumns: '20px 1fr',
              gap: 10, padding: '10px 12px', borderRadius: 6,
              background: on ? 'rgba(77,171,247,0.05)' : 'var(--surface)',
              border: `1px solid ${on ? 'rgba(77,171,247,0.35)' : 'var(--border)'}`,
              cursor: 'pointer', alignItems: 'flex-start',
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(o.id)}
                     style={{ marginTop: 4, accentColor: '#4dabf7' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.45 }}>
                  {o.desc}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ArtifactSummary — checkbox list of what would be written
// ──────────────────────────────────────────────────────────────
function ArtifactSummary({ mode, artifacts, enabled, stem, suffixScheme, onToggle }) {
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel right={
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          {artifacts.filter((a) => enabled[a.id]).length} of {artifacts.length}
        </span>
      }>
        Artifacts
      </SectionLabel>
      <div style={{
        marginTop: 6,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {artifacts.map((a, i) => {
          const fname = mode === 'forge'
            ? forgeBundlePath(a.id)
            : looseFilename(stem, a.id, suffixScheme);
          const on = enabled[a.id];
          return (
            <label key={a.id} style={{
              display: 'grid',
              gridTemplateColumns: '20px 1fr',
              gap: 10, padding: '10px 14px', alignItems: 'flex-start',
              background: on ? 'rgba(77,171,247,0.04)' : 'transparent',
              borderBottom: i < artifacts.length - 1 ? '1px solid var(--border)' : 'none',
              cursor: 'pointer',
            }}>
              <input type="checkbox" checked={on} onChange={() => onToggle(a.id)}
                     style={{ marginTop: 4, accentColor: '#4dabf7' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mono" style={{
                    fontSize: 12, fontWeight: 600,
                    color: on ? 'var(--text)' : 'var(--text-dim)',
                  }}>
                    {fname}
                  </span>
                  <KindBadge kind={a.kind} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.45 }}>
                  {a.desc}
                </div>
              </div>
            </label>
          );
        })}
        {artifacts.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
            No artifacts available for the current device selection.
          </div>
        )}
      </div>
    </div>
  );
}

function KindBadge({ kind }) {
  const palettes = {
    funscript: { color: '#4dabf7', label: 'funscript' },
    sidecar:   { color: '#a3e635', label: 'sidecar' },
    audio:     { color: '#ffb547', label: 'audio' },
    thumbnail: { color: '#c77dff', label: 'thumbnail' },
    manifest:  { color: '#3ed598', label: 'manifest' },
  };
  const p = palettes[kind] || { color: 'var(--text-dim)', label: kind };
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
      textTransform: 'uppercase', padding: '1px 6px', borderRadius: 3,
      background: p.color + '20', color: p.color,
      border: `1px solid ${p.color}55`,
    }}>
      {p.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// OutputVariants — same logical output, different encodings
//
// Mechanical row renders always; e-stim group renders only when estim
// is in selectedDevices (the channel funscripts are identical across
// e-stim variants — the variant chooser is about WAV/protocol).
// ──────────────────────────────────────────────────────────────
function OutputVariants({ selectedDevices, variants, onChange, project }) {
  const showEstim = selectedDevices.includes('estim');
  const groups = ['mechanical', ...(showEstim ? ['estim'] : [])];
  const ctx = {
    actionCount: project?.actionCount ?? (project?.actions?.length ?? 0),
  };
  const toggle = (id) => onChange((v) => ({ ...v, [id]: !v[id] }));

  // Audio-capable footer note fires when any audio variant is checked.
  const anyAudioOn = OUTPUT_VARIANTS.estim.variants.some(
    (v) => v.audio && variants[v.id],
  );

  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel right={(
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          per-device encoding · channel funscripts unchanged
        </span>
      )}>
        Output variants
      </SectionLabel>

      <div style={{
        marginTop: 6,
        display: 'grid',
        gridTemplateColumns: showEstim ? 'minmax(280px, 1fr) minmax(360px, 1.4fr)' : '1fr',
        gap: 12,
        alignItems: 'start',
      }}>
        {groups.map((groupKey) => (
          <VariantGroup
            key={groupKey}
            group={OUTPUT_VARIANTS[groupKey]}
            variants={variants}
            ctx={ctx}
            onToggle={toggle}
          />
        ))}
      </div>

      {showEstim && anyAudioOn && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 6,
          background: 'rgba(77,171,247,0.08)',
          border: '1px solid rgba(77,171,247,0.35)',
          fontSize: 11.5, color: '#4dabf7', lineHeight: 1.5,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Icon name="volume-2" size={12} style={{ marginTop: 2 }} />
          <div>
            Audio-capable variant selected — stereo <span className="mono">.wav</span> files render
            alongside the channel funscripts. Connect the e-stim device to audio output, hit play,
            no restim required.
          </div>
        </div>
      )}
    </div>
  );
}

function VariantGroup({ group, variants, ctx, onToggle }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'baseline', gap: 8,
        background: 'var(--surface-2)',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {group.label}
        </span>
        {group.note && (
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
            {group.note}
          </span>
        )}
      </div>
      {group.variants.map((v, i) => {
        const on = !!variants[v.id];
        const warning = v.check ? v.check(ctx) : null;
        return (
          <label key={v.id} style={{
            display: 'grid',
            gridTemplateColumns: '20px 1fr auto',
            gap: 10, padding: '10px 12px', alignItems: 'flex-start',
            background: on ? 'rgba(77,171,247,0.04)' : 'transparent',
            borderBottom: i < group.variants.length - 1 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
          }}>
            <input type="checkbox" checked={on} onChange={() => onToggle(v.id)}
                   style={{ marginTop: 3, accentColor: '#4dabf7' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 12.5, fontWeight: 600,
                  color: on ? 'var(--text)' : 'var(--text-soft)',
                }}>
                  {v.label}
                </span>
                {v.sublabel && (
                  <span style={{
                    fontSize: 10.5, color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {v.sublabel}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 11, color: 'var(--text-dim)',
                marginTop: 2, lineHeight: 1.4,
              }}>
                {v.desc}
              </div>
              {warning && on && (
                <div style={{
                  marginTop: 6, padding: '5px 8px', borderRadius: 4,
                  background: 'rgba(255,181,71,0.08)',
                  border: '1px solid rgba(255,181,71,0.35)',
                  fontSize: 10.5, color: '#ffb547', lineHeight: 1.4,
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <Icon name="alert-triangle" size={11} style={{ marginTop: 1, flexShrink: 0 }} />
                  <span>{warning.msg}</span>
                </div>
              )}
            </div>
            {warning && !on && (
              <Icon name="alert-triangle" size={12}
                    style={{ color: '#ffb547', marginTop: 4, flexShrink: 0 }}
                    title={warning.msg} />
            )}
          </label>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// NamingControls — loose mode only
// ──────────────────────────────────────────────────────────────
function NamingControls({ stem, onStemChange, suffixScheme, onSuffixSchemeChange, projectPath }) {
  const folder = projectPath
    ? String(projectPath).split(/[/\\]/).slice(0, -1).join('/')
    : '—';
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel>Naming &amp; folder</SectionLabel>
      <div style={{
        marginTop: 6,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 14,
        display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Output folder</span>
        <div className="mono" style={{
          fontSize: 11.5, padding: '6px 10px',
          background: 'var(--surface-2)', borderRadius: 5,
          border: '1px solid var(--border)',
          color: 'var(--text-soft)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {folder}
          <span style={{ marginLeft: 8, fontSize: 9.5, color: 'var(--text-dim)' }}>
            (folder picker — wiring later)
          </span>
        </div>

        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Filename stem</span>
        <input
          type="text" value={stem}
          onChange={(e) => onStemChange(e.target.value)}
          className="mono"
          style={{
            fontSize: 12, padding: '6px 10px',
            background: 'var(--surface-2)', borderRadius: 5,
            border: '1px solid var(--border)',
            color: 'var(--text)', outline: 'none',
            fontFamily: 'var(--font-mono)',
          }}
        />

        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Suffix scheme</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <SuffixOption
            id="dot" label=".axis.funscript" recommended
            selected={suffixScheme === 'dot'}
            onClick={() => onSuffixSchemeChange('dot')}
          />
          <SuffixOption
            id="underscore" label="_axis.funscript"
            selected={suffixScheme === 'underscore'}
            onClick={() => onSuffixSchemeChange('underscore')}
          />
        </div>
      </div>
    </div>
  );
}

function SuffixOption({ label, recommended, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 10px', borderRadius: 5,
      background: selected ? 'rgba(77,171,247,0.14)' : 'var(--surface-2)',
      border: `1px solid ${selected ? '#4dabf7' : 'var(--border)'}`,
      color: selected ? '#4dabf7' : 'var(--text-soft)',
      fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {label}
      {recommended && (
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
          background: '#3ed59820', color: '#3ed598', letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          recommended
        </span>
      )}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// BundlePreview — forge mode only
// ──────────────────────────────────────────────────────────────
function BundlePreview({ stem }) {
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel>Bundle preview</SectionLabel>
      <div style={{
        marginTop: 6,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 14,
      }}>
        <div className="mono" style={{
          fontSize: 11.5, color: 'var(--text-soft)',
          padding: 10, borderRadius: 5,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          whiteSpace: 'pre',
          lineHeight: 1.55,
        }}>
{`${stem}.forge/                       (a ZIP, single file from the user's view)
├── manifest.ffmeta              what artifacts ride together
├── motion.funscript             linear stroker (Handy / Keon)
├── motion.osr.funscript         multi-axis (OSR2 / SR6, when present)
├── stim/                        per-character channels
│   └── <character>/<channel>.funscript  ×9
├── events.yml                   point-in-time effects
├── chapters.json                section boundaries
├── characters.json              per-chapter character assignments
└── thumbnails/
    ├── hero.png                 library card image
    ├── chapter_*.png            per-chapter snapshot
    └── waveform.png             MiniWave-style funscript curve`}
        </div>
        <div style={{
          marginTop: 10, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5,
        }}>
          The LQR player reads <span className="mono">manifest.ffmeta</span> from the archive
          and selects the artifacts that match the connected device profile.
          Other consumers (Beatflo, Sync Player, future shareable-bundles site) read the same structure.
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CompatibilityChecks — static stubs for skeleton
// ──────────────────────────────────────────────────────────────
const CHECKS_LOOSE = [
  { status: 'ok',   label: 'Funscript v1.0 schema',  detail: 'Every .funscript validates against the canonical schema.' },
  { status: 'ok',   label: 'Action count',           detail: 'Within common player limits (≤10,000 actions per file).' },
  { status: 'warn', label: 'Adjacent media',         detail: 'No video file alongside the funscript — Library cards will use the placeholder.' },
  { status: 'ok',   label: 'Sidecar filenames',      detail: 'No collisions with existing files in the project folder.' },
];

const CHECKS_FORGE = [
  { status: 'ok',   label: 'manifest.ffmeta valid',  detail: 'Manifest references every artifact in the bundle.' },
  { status: 'ok',   label: 'Funscript v1.0 schema',  detail: 'Every .funscript validates against the canonical schema.' },
  { status: 'ok',   label: 'Thumbnails complete',    detail: 'hero + per-chapter + waveform PNGs all present.' },
  { status: 'warn', label: 'Bundle size',            detail: 'Estimated zip size ~12 MB — large for upload to bundles site.' },
];

function CompatibilityChecks({ mode }) {
  const checks = mode === 'forge' ? CHECKS_FORGE : CHECKS_LOOSE;
  return (
    <div style={{ marginTop: 16 }}>
      <SectionLabel right={
        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>wiring-later · static stubs</span>
      }>
        Compatibility checks
      </SectionLabel>
      <div style={{
        marginTop: 6,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {checks.map((c, i) => (
          <CheckRow key={c.label} check={c} last={i === checks.length - 1} />
        ))}
      </div>
    </div>
  );
}

function CheckRow({ check, last }) {
  const palettes = {
    ok:   { icon: 'check',           color: '#3ed598' },
    warn: { icon: 'alert-triangle',  color: '#ffb547' },
    err:  { icon: 'alert-circle',    color: '#ff5470' },
  };
  const p = palettes[check.status] || palettes.ok;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10,
      padding: '10px 14px', alignItems: 'flex-start',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <Icon name={p.icon} size={14} style={{ color: p.color, marginTop: 1 }} />
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{check.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.4 }}>
          {check.detail}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// FooterActions — disabled Write
// ──────────────────────────────────────────────────────────────
function FooterActions({ mode, stem, checkedCount }) {
  const writeLabel = mode === 'forge' ? `Pack ${stem}.forge` : 'Write outputs';
  return (
    <div style={{
      marginTop: 18, padding: 14,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Button kind="ghost" size="sm" icon="folder-open" disabled>
        Reveal in Explorer
      </Button>
      <Button kind="ghost" size="sm" icon="copy" disabled>
        Copy paths
      </Button>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {checkedCount} artifact{checkedCount === 1 ? '' : 's'} queued · writer wiring later
      </span>
      <Button kind="primary" size="sm" icon="download" disabled>
        {writeLabel}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Local helper
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
