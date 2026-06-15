// PassagesPanel — the Channels · Passages editor (4th strip alongside
// Character · Mechanical · Body). A passage is a span-relative intensity
// envelope over a run of chapters: a *shape* (Build/Sustain/Release/Swell/
// Steady) traveling a *range* (floor ◀▶ ceiling). Per-chapter Character/
// Mechanical = "what"; a passage = "how much" over a scene-scale span. The
// curve previewed here is baked into e-stim volume + multi-axis amplitude at
// export by forge/passages.py. See project_passage_arcs_cross_modality memory.

import { Button, Icon, Pill } from 'forgemoment';
import PresetLane from '../components/PresetLane.jsx';
import ArcSlider from '../components/ArcSlider.jsx';
import {
  SHAPE_BY_ID, shapeFactor, makePassage, arcShapeId,
  PASSAGE_PRESETS, passagesForPreset, presetSamples, activePassagePreset,
} from '../data/passages.js';

const ACCENT = '#ff8c42';

export default function PassagesPanel({ chapters, passages, onChange }) {
  const n = chapters.length;
  const activePreset = activePassagePreset(passages);

  const update = (id, patch) =>
    onChange(passages.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id) => onChange(passages.filter((p) => p.id !== id));
  const add = () => onChange([...passages, makePassage(0, Math.max(0, n - 1))]);

  if (n === 0) {
    return (
      <Panel>
        <Empty>No chapters yet — Passages ride over the chapter run, so detect or
          add chapters on the Chapters tab first.</Empty>
      </Panel>
    );
  }

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Passages</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1 }}>
          One overall arc across the whole run — it sets the direction for e-stim,
          mechanical, and body. Same idea as Generate's Range &amp; Pace, one
          altitude up.
        </span>
      </div>

      {/* The arc — preset-driven, same PresetLane widget as Generate's lanes. */}
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
        <PresetLane
          title="PASSAGE" hint="overall direction · e-stim · mechanical · body" color={ACCENT}
          presets={PASSAGE_PRESETS} activeId={activePreset}
          onPick={(id) => onChange(passagesForPreset(id, n))}
          samples={presetSamples(activePreset || 'hold')}
        />
      </div>

      {/* Chapter-aligned preview + optional hand fine-tune (post-beta). */}
      <EnvelopeRibbon chapters={chapters} passages={passages} />

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="sliders-horizontal" size={12} />
          Fine-tune by hand · {passages.length} {passages.length === 1 ? 'passage' : 'passages'}
          <span style={{ marginLeft: 'auto' }}>
            <Button kind="ghost" size="sm" icon="plus" onClick={add}>Add passage</Button>
          </span>
        </summary>
        {passages.length === 0 ? (
          <Empty>No hand-edited passages — pick a preset above, or Add one to lay a
            custom Build, Release, or Swell across specific chapters.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {passages.map((p) => (
              <PassageRow key={p.id} passage={p} n={n}
                          onChange={(patch) => update(p.id, patch)}
                          onRemove={() => remove(p.id)} />
            ))}
          </div>
        )}
      </details>
    </Panel>
  );
}

function PassageRow({ passage, n, onChange, onRemove }) {
  const begin = Math.min(passage.beginIdx, passage.endIdx);
  const end = Math.max(passage.beginIdx, passage.endIdx);
  // Same 4-slider arc model as the Channels lane — no shape dropdown / dual-thumb
  // range. The shape is INFERRED from the params (shown as a glyph) so the row
  // still reads at a glance.
  const shape = SHAPE_BY_ID[arcShapeId(passage)] || SHAPE_BY_ID.build;
  const [rp, fp] = [passage.risePoint ?? 1.0, passage.fallPoint ?? 1.0];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '150px 1fr 22px',
      gap: 14, alignItems: 'center',
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
    }}>
      {/* Span + inferred shape glyph */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Eyebrow>
          <span style={{ marginRight: 6, color: ACCENT, fontFamily: 'var(--font-mono)' }}>{shape.glyph}</span>
          {shape.label}
        </Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChapterSelect n={n} value={begin}
                         onChange={(v) => onChange({ beginIdx: Math.min(v, end) })} />
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>→</span>
          <ChapterSelect n={n} value={end}
                         onChange={(v) => onChange({ endIdx: Math.max(v, begin) })} />
        </div>
      </div>

      {/* The four arc sliders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 18px' }}>
        <ArcSlider label="Start depth" hint="where the arc begins" value={passage.floor} accent={ACCENT} compact
                   onChange={(v) => onChange({ floor: v, ceiling: Math.max(v, passage.ceiling) })} />
        <ArcSlider label="Peak" hint="how high it reaches" value={passage.ceiling} accent={ACCENT} compact
                   onChange={(v) => onChange({ ceiling: v, floor: Math.min(v, passage.floor) })} />
        <ArcSlider label="Rise point" hint="where it finishes climbing" value={rp} accent={ACCENT} compact
                   onChange={(v) => onChange({ risePoint: v, fallPoint: Math.max(v, fp) })} />
        <ArcSlider label="Fall point" hint="where it starts easing down" value={fp} accent={ACCENT} compact
                   onChange={(v) => onChange({ fallPoint: v, risePoint: Math.min(v, rp) })} />
      </div>

      {/* Delete */}
      <button onClick={onRemove} aria-label="Remove passage" title="Remove passage"
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)',
                       cursor: 'pointer', padding: 2, display: 'grid', placeItems: 'center' }}>
        <Icon name="trash-2" size={13} />
      </button>
    </div>
  );
}

function ChapterSelect({ n, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))}
            style={{ ...selectStyle, padding: '4px 6px', minWidth: 52 }}>
      {Array.from({ length: n }, (_, i) => (
        <option key={i} value={i}>Ch {i + 1}</option>
      ))}
    </select>
  );
}

// SVG ribbon: equal-width chapter cells with boundary ticks, and each passage's
// envelope drawn as a filled polyline over the cells it spans (top = 100%).
// Exported so the persistent Channels arc lane reuses the exact same drawing.
export function EnvelopeRibbon({ chapters, passages, height = 64, activeIdx = -1 }) {
  const n = chapters.length;
  const W = 1000;
  const H = height;
  const cellW = W / n;
  const yFor = (factor) => H - 4 - factor * (H - 12);  // 4px pad top/bottom

  const livePassages = passages.filter((p) => (p.shape || 'steady') !== 'steady');

  // "You-are-here" marker: the chapter being edited. A translucent cell band
  // plus, when a passage covers it, a dot on the curve at the chapter's center
  // — so the arc visibly ties to the volume drawn below.
  const hasActive = activeIdx >= 0 && activeIdx < n;
  let marker = null;
  if (hasActive) {
    const cx = (activeIdx + 0.5) * cellW;
    const cover = livePassages.find(
      (p) => activeIdx >= Math.min(p.beginIdx, p.endIdx) && activeIdx <= Math.max(p.beginIdx, p.endIdx),
    );
    if (cover) {
      const b = Math.min(cover.beginIdx, cover.endIdx);
      const e = Math.max(cover.beginIdx, cover.endIdx);
      const x0 = b * cellW;
      const span = Math.max(1, (e + 1) * cellW - x0);
      const frac = Math.max(0, Math.min(1, (cx - x0) / span));
      marker = { cx, cy: yFor(shapeFactor(cover.shape, frac, cover.floor, cover.ceiling, cover.risePoint, cover.fallPoint)) };
    } else {
      marker = { cx, cy: null };
    }
  }

  return (
    <div style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 8,
                  overflow: 'hidden', background: 'var(--surface-2)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           style={{ display: 'block', width: '100%', height: H }}>
        {/* active chapter highlight band (behind everything) */}
        {hasActive && (
          <rect x={activeIdx * cellW} y={0} width={cellW} height={H}
                fill="var(--text)" fillOpacity={0.07} />
        )}
        {/* chapter cell boundaries */}
        {Array.from({ length: n + 1 }, (_, i) => (
          <line key={i} x1={i * cellW} y1={0} x2={i * cellW} y2={H}
                stroke="var(--border)" strokeWidth={1} />
        ))}
        {/* full-intensity reference line */}
        <line x1={0} y1={yFor(1)} x2={W} y2={yFor(1)}
              stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4" />
        {livePassages.map((p) => {
          const b = Math.min(p.beginIdx, p.endIdx);
          const e = Math.max(p.beginIdx, p.endIdx);
          const x0 = b * cellW;
          const x1 = (e + 1) * cellW;
          const span = Math.max(1, x1 - x0);
          const STEPS = 40;
          const pts = [];
          for (let i = 0; i <= STEPS; i += 1) {
            const frac = i / STEPS;
            const x = x0 + frac * span;
            const y = yFor(shapeFactor(p.shape, frac, p.floor, p.ceiling, p.risePoint, p.fallPoint));
            pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
          }
          const area = `${x0},${H} ${pts.join(' ')} ${x1},${H}`;
          return (
            <g key={p.id}>
              <polygon points={area} fill={ACCENT} fillOpacity={0.14} />
              <polyline points={pts.join(' ')} fill="none" stroke={ACCENT} strokeWidth={2} />
            </g>
          );
        })}
        {/* you-are-here marker: vertical tick (the dot rides as a CSS overlay
            below so it stays round under the non-uniform x/y scale) */}
        {marker && (
          <line x1={marker.cx} x2={marker.cx} y1={0} y2={H}
                stroke="var(--text)" strokeOpacity={0.35} strokeWidth={1} />
        )}
        {/* chapter numbers */}
        {chapters.map((c, i) => (
          <text key={i} x={i * cellW + cellW / 2} y={H - 5}
                fill={i === activeIdx ? 'var(--text)' : 'var(--text-dim)'}
                fontSize={9} fontWeight={i === activeIdx ? 700 : 400}
                textAnchor="middle">{i + 1}</text>
        ))}
      </svg>
      {/* round you-are-here dot on the curve (CSS, so it's not stretched) */}
      {marker && marker.cy != null && (
        <div style={{
          position: 'absolute',
          left: `${(marker.cx / W) * 100}%`,
          top: `${(marker.cy / H) * 100}%`,
          width: 7, height: 7, borderRadius: '50%',
          background: '#fff', border: `1.6px solid ${ACCENT}`,
          transform: 'translate(-50%, -50%)', pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}

// ── small shared bits ──────────────────────────────────────────
function Panel({ children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: 14 }}>
      {children}
    </div>
  );
}
function Eyebrow({ children }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                   textTransform: 'uppercase', color: 'var(--text-dim)' }}>{children}</span>
  );
}
function Empty({ children }) {
  return (
    <div style={{ padding: '18px 14px', fontSize: 12, color: 'var(--text-dim)',
                  lineHeight: 1.5, textAlign: 'center' }}>{children}</div>
  );
}
const selectStyle = {
  fontSize: 11.5, padding: '5px 8px', borderRadius: 6,
  background: 'var(--surface, #12151e)', color: 'var(--text)',
  border: '1px solid var(--border)', outline: 'none', fontFamily: 'inherit',
};
