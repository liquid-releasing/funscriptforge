// PassagesPanel — the Channels · Passages editor (4th strip alongside
// Character · Mechanical · Body). A passage is a span-relative intensity
// envelope over a run of chapters: a *shape* (Build/Sustain/Release/Swell/
// Steady) traveling a *range* (floor ◀▶ ceiling). Per-chapter Character/
// Mechanical = "what"; a passage = "how much" over a scene-scale span. The
// curve previewed here is baked into e-stim volume + multi-axis amplitude at
// export by forge/passages.py. See project_passage_arcs_cross_modality memory.

import { Button, Icon, Pill } from 'forgemoment';
import PresetLane from '../components/PresetLane.jsx';
import {
  PASSAGE_SHAPES, SHAPE_BY_ID, shapeFactor, makePassage,
  PASSAGE_PRESETS, passagesForPreset, presetSamples, activePassagePreset,
} from '../data/passages.js';

const ACCENT = '#ff8c42';

// One CSS injection for the dual-thumb range (pseudo-element thumb rules can't
// be inline-styled). Scoped to .pg-range; mounted once with the panel.
const RANGE_CSS = `
.pg-range { position: relative; height: 26px; }
.pg-range input { -webkit-appearance: none; appearance: none; background: transparent;
  position: absolute; left: 0; right: 0; top: 0; width: 100%; height: 26px; margin: 0;
  pointer-events: none; }
.pg-range input::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
  pointer-events: auto; width: 15px; height: 15px; border-radius: 50%; background: ${ACCENT};
  border: 2px solid var(--surface); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
.pg-range input::-moz-range-thumb { pointer-events: auto; width: 15px; height: 15px;
  border-radius: 50%; background: ${ACCENT}; border: 2px solid var(--surface); cursor: pointer; }
`;

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
      <style>{RANGE_CSS}</style>

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
  const shape = SHAPE_BY_ID[passage.shape] || SHAPE_BY_ID.steady;
  const begin = Math.min(passage.beginIdx, passage.endIdx);
  const end = Math.max(passage.beginIdx, passage.endIdx);
  const pct = (v) => `${Math.round(v * 100)}%`;

  const setFloor = (v) => onChange({ floor: Math.min(v, passage.ceiling) });
  const setCeiling = (v) => onChange({ ceiling: Math.max(v, passage.floor) });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '128px 150px 1fr 22px',
      gap: 12, alignItems: 'center',
      padding: '10px 12px', borderRadius: 8,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
    }}>
      {/* Shape */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Eyebrow>Shape</Eyebrow>
        <select value={passage.shape}
                onChange={(e) => onChange({ shape: e.target.value })}
                style={selectStyle}>
          {PASSAGE_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>{s.glyph}  {s.label}</option>
          ))}
        </select>
      </label>

      {/* Span */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Eyebrow>Span</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChapterSelect n={n} value={begin}
                         onChange={(v) => onChange({ beginIdx: Math.min(v, end) })} />
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>→</span>
          <ChapterSelect n={n} value={end}
                         onChange={(v) => onChange({ endIdx: Math.max(v, begin) })} />
        </div>
      </div>

      {/* Range (two-headed) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Eyebrow>{shape.id === 'steady' ? 'Range · (no-op)' : 'Range'}</Eyebrow>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-soft)' }}>
            {pct(passage.floor)} ◀▶ {pct(passage.ceiling)}
          </span>
        </div>
        <div className="pg-range">
          {/* track + active fill */}
          <div style={{ position: 'absolute', top: 11, left: 0, right: 0, height: 4,
                        background: 'var(--border)', borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: 11, height: 4, borderRadius: 2,
                        background: shape.id === 'steady' ? 'var(--text-dim)' : ACCENT,
                        left: `${passage.floor * 100}%`,
                        width: `${(passage.ceiling - passage.floor) * 100}%` }} />
          <input type="range" min={0} max={1} step={0.01} value={passage.floor}
                 onChange={(e) => setFloor(parseFloat(e.target.value))} />
          <input type="range" min={0} max={1} step={0.01} value={passage.ceiling}
                 onChange={(e) => setCeiling(parseFloat(e.target.value))} />
        </div>
        <span style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>{shape.desc}</span>
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
export function EnvelopeRibbon({ chapters, passages, height = 64 }) {
  const n = chapters.length;
  const W = 1000;
  const H = height;
  const cellW = W / n;
  const yFor = (factor) => H - 4 - factor * (H - 12);  // 4px pad top/bottom

  const livePassages = passages.filter((p) => (p.shape || 'steady') !== 'steady');

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                  background: 'var(--surface-2)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           style={{ display: 'block', width: '100%', height: H }}>
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
            const y = yFor(shapeFactor(p.shape, frac, p.floor, p.ceiling));
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
        {/* chapter numbers */}
        {chapters.map((c, i) => (
          <text key={i} x={i * cellW + cellW / 2} y={H - 5} fill="var(--text-dim)"
                fontSize={9} textAnchor="middle">{i + 1}</text>
        ))}
      </svg>
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
