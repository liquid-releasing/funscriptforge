// MechanicalPanel — the "Mechanical" editor in the Channels tab.
//
// Mechanical = the multi-axis motion we already generate (forge/multiaxis.py
// + multiaxis_presets.py), surfaced with a cooler viewer. The user authors
// ONE per-chapter position style (None / Cowgirl / Missionary / Doggy /
// Riding / Random); the secondary-axis funscripts (roll/pitch/twist/surge/
// sway, derived from the L0 stroke) generate later at Polish/export time.
//
// The hero here is the AxisDiagram — a stylized multi-axis stroker where
// each axis glows in proportion to how hard the selected style drives it.
// Ported + restyled from the v3 channels design (channels-mech.jsx).

import { Icon } from 'forgemoment';
import {
  MULTIAXIS_STYLES, AXIS_META, SECONDARY_AXES,
  styleById, axisAmplitude,
} from '../data/multiaxis.js';

const ACTIVE = '#ff8c42';   // ember-warm — an axis the style drives
const IDLE = '#3a3f5c';     // dim — axis at rest
const INHERIT = '#4dabf7';  // blue — L0 stroke, inherited (not authored)

function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-dim)',
    }}>
      <span>{children}</span>
      {right}
    </div>
  );
}

export default function MechanicalPanel({ styleId, onSelectStyle }) {
  const style = styleById(styleId);
  const axes = style.axes || {};
  const activeCount = Object.keys(axes).length;

  return (
    <div>
      <SectionLabel right={(
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
          T-code · multi-axis
        </span>
      )}>
        Mechanical
      </SectionLabel>

      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 16, marginTop: 6,
      }}>
        {/* Position-style picker — the existing multiaxis presets. */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8, marginBottom: 14,
        }}>
          {MULTIAXIS_STYLES.map((s) => {
            const sel = s.id === styleId;
            const n = Object.keys(s.axes || {}).length;
            return (
              <button
                key={s.id}
                onClick={() => onSelectStyle(s.id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: 10, borderRadius: 8, textAlign: 'left',
                  background: sel ? ACTIVE + '20' : 'var(--surface-2)',
                  border: `1.5px solid ${sel ? ACTIVE : 'var(--border)'}`,
                  color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{s.label}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>
                  {n === 0 ? 'stroke only' : `${n} ax${n === 1 ? 'is' : 'es'}`}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{
          fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5,
          marginBottom: 14, paddingBottom: 14,
          borderBottom: '1px solid var(--border)',
        }}>
          {style.desc}
        </div>

        {/* The cooler viewer. */}
        <AxisDiagram axes={axes} />

        {/* Per-axis amplitude bars — covers all five secondary axes,
            including surge/sway which the diagram only hints at. */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SECONDARY_AXES.map((axis) => {
            const meta = AXIS_META[axis];
            const amp = axisAmplitude(styleId, axis);
            const on = amp > 0;
            return (
              <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{
                  width: 26, fontSize: 10, fontWeight: 700,
                  color: on ? ACTIVE : 'var(--text-dim)',
                }}>{meta.tcode}</span>
                <span style={{
                  width: 48, fontSize: 11.5,
                  color: on ? 'var(--text)' : 'var(--text-dim)',
                }}>{meta.label}</span>
                <div style={{
                  flex: 1, height: 5, borderRadius: 3,
                  background: 'var(--surface-2)', overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.round(amp * 100)}%`, height: '100%',
                    background: ACTIVE, borderRadius: 3,
                  }} />
                </div>
                <span className="mono" style={{
                  width: 34, textAlign: 'right', fontSize: 10,
                  color: on ? 'var(--text-muted)' : 'var(--text-dim)',
                }}>{on ? `${Math.round(amp * 100)}%` : '—'}</span>
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 14, fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5,
        }}>
          <Icon name="info" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {activeCount === 0
            ? 'Stroke passes through untouched — no secondary-axis files generated.'
            : 'Secondary-axis funscripts (roll · pitch · twist · surge · sway) derive from the stroke at Polish/export time.'}
        </div>
      </div>
    </div>
  );
}

// ── Axis diagram — a stylized multi-axis stroker. Each axis glows in
// proportion to the style's amplitude for it; idle axes sit dim + dashed.
function AxisDiagram({ axes }) {
  const W = 460;
  const H = 300;
  const amp = (name) => axes[name] ?? 0;
  // opacity for an active axis, scaled by amplitude (floor so a low-amp
  // axis still reads as "on").
  const op = (name) => (amp(name) > 0 ? 0.45 + 0.55 * amp(name) : 1);
  const col = (name) => (amp(name) > 0 ? ACTIVE : IDLE);
  const on = (name) => amp(name) > 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="mech-bg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--surface-2)" />
          <stop offset="100%" stopColor="var(--bg)" />
        </linearGradient>
        <radialGradient id="mech-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACTIVE} stopOpacity={0.35} />
          <stop offset="100%" stopColor={ACTIVE} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#mech-bg)" rx={8} />

      {/* Frame guidelines */}
      <line x1={W / 2} y1={24} x2={W / 2} y2={H - 24} stroke={IDLE} strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />
      <line x1={48} y1={H / 2} x2={W - 48} y2={H / 2} stroke={IDLE} strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />

      <g transform={`translate(${W / 2} ${H / 2})`}>
        {/* L0 stroke axis — the inherited input (always shown, blue). */}
        <g>
          <rect x={-130} y={-9} width={260} height={18} rx={4} fill="var(--surface)" stroke={INHERIT} strokeWidth={1.4} opacity={0.85} />
          <line x1={-110} y1={0} x2={110} y2={0} stroke={INHERIT} strokeWidth={1} opacity={0.5} />
          <text x={-130} y={-22} fontSize={9} fontFamily="var(--font-mono, monospace)" fill={INHERIT} fontWeight={700}>
            L0 · Stroke
          </text>
          <text x={-130} y={-11} fontSize={8} fontFamily="var(--font-mono, monospace)" fill={INHERIT} opacity={0.7}>
            inherited
          </text>
        </g>

        {/* Carriage on the stroke track. */}
        <g>
          <rect x={20} y={-22} width={50} height={44} rx={6}
                fill="var(--surface)" stroke={INHERIT} strokeWidth={1.6} />
          <circle cx={45} cy={0} r={4} fill={INHERIT} />
        </g>

        {/* R0 · Twist — circular arrow around the carriage. */}
        <g transform="translate(45 0)" opacity={op('twist')}>
          <path d="M -28 0 A 28 28 0 1 0 28 0" stroke={col('twist')} strokeWidth={on('twist') ? 2 : 1.4} fill="none" strokeDasharray={on('twist') ? '0' : '4 3'} />
          <polygon points="22,-4 30,0 22,4" fill={col('twist')} />
          <text x={0} y={-34} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono, monospace)" fill={col('twist')} fontWeight={700}>R0 · Twist</text>
        </g>

        {/* R1 · Roll — side-tilt indicator (upper-left). */}
        <g transform="translate(-92 -54)" opacity={op('roll')}>
          <line x1={-16} y1={0} x2={16} y2={0} stroke={col('roll')} strokeWidth={on('roll') ? 2.5 : 1.5} />
          <line x1={-16} y1={0} x2={-16} y2={5} stroke={col('roll')} strokeWidth={1.5} />
          <line x1={16} y1={0} x2={16} y2={-5} stroke={col('roll')} strokeWidth={1.5} />
          <text x={0} y={-12} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono, monospace)" fill={col('roll')} fontWeight={700}>R1 · Roll</text>
        </g>

        {/* R2 · Pitch — fore/aft tilt (lower-left). */}
        <g transform="translate(-92 54)" opacity={op('pitch')}>
          <line x1={0} y1={-13} x2={0} y2={13} stroke={col('pitch')} strokeWidth={on('pitch') ? 2.5 : 1.5} />
          <polygon points="-4,9 0,15 4,9" fill={col('pitch')} />
          <polygon points="-4,-9 0,-15 4,-9" fill={col('pitch')} />
          <text x={0} y={30} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono, monospace)" fill={col('pitch')} fontWeight={700}>R2 · Pitch</text>
        </g>

        {/* L1 · Surge — fore/aft slide (top center). */}
        <g transform="translate(0 -108)" opacity={op('surge')}>
          <line x1={-18} y1={0} x2={18} y2={0} stroke={col('surge')} strokeWidth={on('surge') ? 2.5 : 1.5} strokeDasharray={on('surge') ? '0' : '4 3'} />
          <polygon points="14,-4 20,0 14,4" fill={col('surge')} />
          <polygon points="-14,-4 -20,0 -14,4" fill={col('surge')} />
          <text x={0} y={-10} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono, monospace)" fill={col('surge')} fontWeight={700}>L1 · Surge</text>
        </g>

        {/* L2 · Sway — side slide (bottom center). */}
        <g transform="translate(0 108)" opacity={op('sway')}>
          <line x1={-18} y1={0} x2={18} y2={0} stroke={col('sway')} strokeWidth={on('sway') ? 2.5 : 1.5} strokeDasharray={on('sway') ? '0' : '4 3'} />
          <polygon points="14,-4 20,0 14,4" fill={col('sway')} />
          <polygon points="-14,-4 -20,0 -14,4" fill={col('sway')} />
          <text x={0} y={20} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono, monospace)" fill={col('sway')} fontWeight={700}>L2 · Sway</text>
        </g>
      </g>
    </svg>
  );
}
