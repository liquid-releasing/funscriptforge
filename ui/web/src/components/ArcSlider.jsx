// ArcSlider — one labeled 0–100% slider for the passage-arc model (start depth
// / peak / rise point / fall point). Value is 0..1; the readout shows a
// percentage. Shared by the Channels arc lane and the per-span Passages editor
// so both use the exact same control.

export default function ArcSlider({ label, hint, value, accent = '#ff8c42', onChange, compact = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: compact ? 9 : 10, fontWeight: 700, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: 'var(--text-dim)',
        }}>{label}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-soft)', marginLeft: 'auto' }}>
          {Math.round((value ?? 0) * 100)}%
        </span>
      </span>
      <input
        type="range" min={0} max={100} value={Math.round((value ?? 0) * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        title={hint}
        style={{ width: '100%', accentColor: accent, cursor: 'pointer' }}
      />
    </label>
  );
}
