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

import { Icon, Sparkline } from 'forgemoment';
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

export default function MechanicalPanel({
  styleId, onSelectStyle, onApplyToAll,
  axisData = null, loading = false, chapter = null,
  dirty = false, onReset,
  onUseDefault, defaultStyleId,
}) {
  const style = styleById(styleId);
  const defaultStyleLabel = defaultStyleId ? styleById(defaultStyleId).label : null;
  const axes = style.axes || {};
  const activeCount = Object.keys(axes).length;

  // The pick is STAGED; the single "Accept and next chapter" on the always-
  // visible footer commits it (alongside the staged character) and advances —
  // there is no in-body accept anymore (it duplicated the footer's advance and
  // could desync the chapter, the dogfood complaint we fixed for Character /
  // Channels too). This row keeps the quick "Use default" + "Reset" helpers and
  // a hint that the commit lives on the footer.
  const acceptRow = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
      paddingTop: 12, borderTop: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {style.label} staged · accept in the footer ↓
      </span>
      {onUseDefault && (
        <button
          onClick={onUseDefault}
          title={defaultStyleLabel
            ? `Use the recommended mechanical style for this chapter (${defaultStyleLabel})`
            : 'Use the recommended mechanical style for this chapter'}
          style={{
            padding: '6px 10px', fontSize: 11.5, fontWeight: 600,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 5,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Use default{defaultStyleLabel ? ` · ${defaultStyleLabel}` : ''}
        </button>
      )}
      {dirty && (
        <button
          onClick={onReset}
          title="Discard the staged style for this chapter"
          style={{
            padding: '6px 10px', fontSize: 11.5, fontWeight: 600,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 5,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Reset
        </button>
      )}
      <span style={{ flex: 1 }} />
      {dirty && (
        <span style={{ fontSize: 10.5, color: ACTIVE }}>unsaved changes</span>
      )}
    </div>
  );

  return (
    <div>
      <SectionLabel right={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onApplyToAll && (
            <button
              onClick={onApplyToAll}
              title="Set every chapter to this mechanical style — fills the mechanical pass in one click"
              style={{
                padding: '5px 11px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                textTransform: 'none', letterSpacing: 0, whiteSpace: 'nowrap',
              }}
            >
              Apply to all chapters
            </button>
          )}
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            T-code · multi-axis
          </span>
        </div>
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
                <span style={{ fontSize: 10, color: sel ? ACTIVE : 'var(--text-dim)', fontWeight: 600 }}>
                  {s.tag}
                </span>
              </button>
            );
          })}
        </div>

        {/* Accept sits directly under the cards — pick → commit in one place. */}
        {acceptRow}

        <div style={{
          fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5,
          marginTop: 14, marginBottom: 14, paddingBottom: 14,
          borderBottom: '1px solid var(--border)',
        }}>
          {style.desc}
        </div>

        {/* The cooler viewer. */}
        <AxisDiagram axes={axes} />

        {/* Per-axis output funscripts — the REAL curves the engine produces
            for this style over this chapter, T-code labeled. These are exactly
            what export writes (<stem>.<axis>.funscript). Only the axes this
            style drives are shown; stroke-only styles show none. */}
        {activeCount > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SECONDARY_AXES.map((axis) => {
              const amp = axisAmplitude(styleId, axis);
              if (amp === 0) return null;       // style doesn't drive this axis
              const meta = AXIS_META[axis];
              const data = axisData?.[axis];
              const live = !!(data?.actions?.length);
              return (
                <div key={axis} style={{
                  background: 'var(--surface-2)',
                  border: `1px solid ${live ? ACTIVE + '55' : 'var(--border)'}`,
                  borderRadius: 8, padding: '8px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: ACTIVE }}>{meta.tcode}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600 }}>{meta.label}</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      {live ? `${Math.round(amp * 100)}%` : (loading ? 'generating…' : `${Math.round(amp * 100)}%`)}
                    </span>
                  </div>
                  {live ? (
                    <div style={{ height: 40 }}>
                      <Sparkline
                        actions={data.actions}
                        start={chapter?.atMs ?? data.actions[0].at}
                        end={chapter?.endMs ?? data.actions[data.actions.length - 1].at}
                        colorMode="velocity"
                        height="100%"
                        filled
                      />
                    </div>
                  ) : (
                    <div style={{
                      height: 40, display: 'grid', placeItems: 'center',
                      fontSize: 10, color: 'var(--text-dim)',
                    }}>{loading ? '…' : 'no preview'}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{
          marginTop: 14, fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5,
        }}>
          <Icon name="info" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {activeCount === 0
            ? 'Stroke passes through untouched — no secondary-axis files generated.'
            : 'All five axes are derived algorithmically from the L0 stroke at export. Surge & sway only export to SR6-class devices.'}
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
