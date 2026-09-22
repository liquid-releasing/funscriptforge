// FunscriptForge prototype — shared primitives (forgemoment substitutes).
// Loaded as text/babel; exports to window at the end.

const { useState, useRef, useEffect, useCallback } = React;

// ── Icon — self-contained inline SVG set (functional UI icons) ────────────
const ICON_PATHS = {
  'flame': "<path d='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'/>",
  'film': "<rect x='2.5' y='3' width='19' height='18' rx='2'/><line x1='7' y1='3' x2='7' y2='21'/><line x1='17' y1='3' x2='17' y2='21'/><line x1='2.5' y1='12' x2='21.5' y2='12'/><line x1='2.5' y1='7.5' x2='7' y2='7.5'/><line x1='17' y1='7.5' x2='21.5' y2='7.5'/><line x1='2.5' y1='16.5' x2='7' y2='16.5'/><line x1='17' y1='16.5' x2='21.5' y2='16.5'/>",
  'music': "<path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/>",
  'folder-open': "<path d='M6 14l1.45-4.36A2 2 0 0 1 9.35 8H20l-2.3 6.9A2 2 0 0 1 15.8 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'/>",
  'download': "<path d='M12 3v12'/><path d='m7 10 5 5 5-5'/><path d='M5 21h14'/>",
  'sliders-horizontal': "<line x1='3' y1='6' x2='14' y2='6'/><line x1='18' y1='6' x2='21' y2='6'/><circle cx='16' cy='6' r='2'/><line x1='3' y1='12' x2='8' y2='12'/><line x1='12' y1='12' x2='21' y2='12'/><circle cx='10' cy='12' r='2'/><line x1='3' y1='18' x2='14' y2='18'/><line x1='18' y1='18' x2='21' y2='18'/><circle cx='16' cy='18' r='2'/>",
  'help-circle': "<circle cx='12' cy='12' r='10'/><path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'/><line x1='12' y1='17' x2='12.01' y2='17'/>",
  'lock': "<rect x='5' y='11' width='14' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/>",
  'x': "<line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/>",
  'star': "<polygon points='12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9'/>",
  'box': "<path d='M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/>",
  'library': "<path d='m16 6 4 14'/><path d='M12 6v14'/><path d='M8 8v12'/><path d='M4 4v16'/>",
  'upload-cloud': "<path d='M12 13v8'/><path d='m8 17 4-4 4 4'/><path d='M20 16.5A4.5 4.5 0 0 0 16 9h-1.26A8 8 0 1 0 4 16'/>",
  'rotate-ccw': "<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5'/>",
  'more-horizontal': "<circle cx='12' cy='12' r='1'/><circle cx='19' cy='12' r='1'/><circle cx='5' cy='12' r='1'/>",
  'clock': "<circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 16 14'/>",
  'hash': "<line x1='4' y1='9' x2='20' y2='9'/><line x1='4' y1='15' x2='20' y2='15'/><line x1='10' y1='3' x2='8' y2='21'/><line x1='16' y1='3' x2='14' y2='21'/>",
  'bookmark': "<path d='m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'/>",
  'wand-2': "<path d='m3 21 11-11'/><path d='M15 4V2'/><path d='M15 10V8'/><path d='M12.5 6.5h-2'/><path d='M19.5 6.5h-2'/><path d='m16.8 8.3-1.4-1.4'/><path d='m16.8 4.7-1.4 1.4'/><path d='M20 16v4'/><path d='M18 18h4'/>",
  'git-branch': "<line x1='6' y1='3' x2='6' y2='15'/><circle cx='18' cy='6' r='3'/><circle cx='6' cy='18' r='3'/><path d='M18 9a9 9 0 0 1-9 9'/>",
  'settings-2': "<path d='M20 7h-9'/><path d='M14 17H5'/><circle cx='17' cy='17' r='3'/><circle cx='7' cy='7' r='3'/>",
  'audio-lines': "<path d='M2 10v3'/><path d='M6 6v11'/><path d='M10 3v18'/><path d='M14 8v7'/><path d='M18 5v13'/><path d='M22 10v3'/>",
  'layers': "<path d='m12 2 9 5-9 5-9-5 9-5z'/><path d='m3 12 9 5 9-5'/><path d='m3 17 9 5 9-5'/>",
  'file-down': "<path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z'/><path d='M14 2v5h5'/><path d='M12 18v-6'/><path d='m9 15 3 3 3-3'/>",
  'plus': "<line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/>",
  'check': "<polyline points='20 6 9 17 4 12'/>",
  'arrow-right': "<line x1='5' y1='12' x2='19' y2='12'/><polyline points='12 5 19 12 12 19'/>",
  'skip-back': "<polygon points='19 20 9 12 19 4 19 20'/><line x1='5' y1='19' x2='5' y2='5'/>",
  'skip-forward': "<polygon points='5 4 15 12 5 20 5 4'/><line x1='19' y1='5' x2='19' y2='19'/>",
  'play': "<polygon points='6 4 20 12 6 20 6 4'/>",
  'pause': "<rect x='6' y='4' width='4' height='16'/><rect x='14' y='4' width='4' height='16'/>",
  'square': "<rect x='5' y='5' width='14' height='14' rx='1'/>",
  'alert-triangle': "<path d='m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/>",
  'info': "<circle cx='12' cy='12' r='10'/><line x1='12' y1='11' x2='12' y2='16'/><line x1='12' y1='8' x2='12.01' y2='8'/>",
  'check-circle': "<path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/><polyline points='22 4 12 14.01 9 11.01'/>",
  'move-diagonal': "<polyline points='13 5 19 5 19 11'/><polyline points='11 19 5 19 5 13'/><line x1='19' y1='5' x2='5' y2='19'/>",
  'trending-up': "<polyline points='22 7 13.5 15.5 8.5 10.5 2 17'/><polyline points='16 7 22 7 22 13'/>",
  'activity': "<polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/>",
  'trash-2': "<polyline points='3 6 5 6 21 6'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><line x1='10' y1='11' x2='10' y2='17'/><line x1='14' y1='11' x2='14' y2='17'/>",
  'git-compare-arrows': "<circle cx='5' cy='6' r='3'/><circle cx='19' cy='18' r='3'/><path d='M12 6h5a2 2 0 0 1 2 2v7'/><polyline points='15 9 12 6 15 3'/><path d='M12 18H7a2 2 0 0 1-2-2V9'/><polyline points='9 15 12 18 9 21'/>",
  'gamepad-2': "<line x1='6' y1='11' x2='10' y2='11'/><line x1='8' y1='9' x2='8' y2='13'/><line x1='15' y1='12' x2='15.01' y2='12'/><line x1='18' y1='10' x2='18.01' y2='10'/><rect x='2' y='6' width='20' height='12' rx='2'/>",
  'move-3d': "<path d='M5 3v16h16'/><path d='m5 19 6-6'/><path d='m2 6 3-3 3 3'/><path d='m18 16 3 3-3 3'/>",
  'zap': "<polygon points='13 2 3 14 12 14 11 22 21 10 12 10 13 2'/>",
  'bluetooth': "<path d='m7 7 10 10-5 5V2l5 5L7 17'/>",
  'folder': "<path d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z'/>",
  'package': "<path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/>",
  'file-cog': "<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><circle cx='12' cy='15' r='2'/><path d='M12 12.5v1'/><path d='M12 16.5v1'/><path d='m14.2 13.8-.9.5'/><path d='m10.7 15.7-.9.5'/><path d='m14.2 16.2-.9-.5'/><path d='m10.7 14.3-.9-.5'/>",
  'external-link': "<path d='M15 3h6v6'/><path d='M10 14 21 3'/><path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/>",
  'link': "<path d='M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1'/><path d='M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'/>",
  'loader': "<line x1='12' y1='2' x2='12' y2='6'/><line x1='12' y1='18' x2='12' y2='22'/><line x1='4.9' y1='4.9' x2='7.8' y2='7.8'/><line x1='16.2' y1='16.2' x2='19.1' y2='19.1'/><line x1='2' y1='12' x2='6' y2='12'/><line x1='18' y1='12' x2='22' y2='12'/><line x1='4.9' y1='19.1' x2='7.8' y2='16.2'/><line x1='16.2' y1='7.8' x2='19.1' y2='4.9'/>",
  'alert-circle': "<circle cx='12' cy='12' r='10'/><line x1='12' y1='8' x2='12' y2='12'/><line x1='12' y1='16' x2='12.01' y2='16'/>",
  'shapes': "<path d='M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1z'/><rect x='3' y='14' width='7' height='7' rx='1'/><circle cx='17.5' cy='17.5' r='3.5'/>",
  'sliders': "<line x1='4' y1='21' x2='4' y2='14'/><line x1='4' y1='10' x2='4' y2='3'/><line x1='12' y1='21' x2='12' y2='12'/><line x1='12' y1='8' x2='12' y2='3'/><line x1='20' y1='21' x2='20' y2='16'/><line x1='20' y1='12' x2='20' y2='3'/><line x1='2' y1='14' x2='6' y2='14'/><line x1='10' y1='8' x2='14' y2='8'/><line x1='18' y1='16' x2='22' y2='16'/>",
  'volume-2': "<polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5'/><path d='M15.5 8.5a5 5 0 0 1 0 7'/><path d='M19 5a9 9 0 0 1 0 14'/>",
  'list': "<line x1='8' y1='6' x2='21' y2='6'/><line x1='8' y1='12' x2='21' y2='12'/><line x1='8' y1='18' x2='21' y2='18'/><line x1='3' y1='6' x2='3.01' y2='6'/><line x1='3' y1='12' x2='3.01' y2='12'/><line x1='3' y1='18' x2='3.01' y2='18'/>",
  'sparkles': "<path d='M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z'/>",
};
function Icon({ name, size = 16, stroke = 2, style, title, ...rest }) {
  const inner = ICON_PATHS[name] || "<circle cx='12' cy='12' r='3'/>";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + inner }} {...rest} />
  );
}

// ── Button ────────────────────────────────────────────────────────────────
const BTN_SIZE = {
  sm: { padding: '5px 10px', fontSize: 12, height: 28, gap: 6 },
  md: { padding: '8px 14px', fontSize: 13, height: 36, gap: 7 },
  icon: { padding: 0, width: 32, height: 32, justifyContent: 'center', gap: 0 },
  iconsm: { padding: 0, width: 28, height: 28, justifyContent: 'center', gap: 0 },
};
function Button({ kind = 'secondary', size = 'md', icon, iconRight, children, style, disabled, ...rest }) {
  const [hover, setHover] = useState(false);
  const sz = BTN_SIZE[size] || BTN_SIZE.md;
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: sz.justifyContent || 'flex-start',
    gap: sz.gap, fontFamily: 'inherit', fontWeight: 600, fontSize: sz.fontSize,
    padding: sz.padding, width: sz.width, height: sz.height,
    borderRadius: 'var(--r-2)', cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', whiteSpace: 'nowrap',
    opacity: disabled ? 0.4 : 1, transition: 'all .15s var(--ease-standard)',
    transform: hover && !disabled && kind === 'primary' ? 'translateY(-1px)' : 'none',
  };
  const kinds = {
    primary: { background: 'var(--accent)', color: '#fff', boxShadow: hover && !disabled ? 'var(--elev-2)' : 'none' },
    warm:    { background: 'var(--accent-warm)', color: '#1a0e08', boxShadow: hover && !disabled ? 'var(--elev-2)' : 'none' },
    secondary: { background: hover && !disabled ? 'rgba(255,75,75,0.06)' : 'transparent',
                 color: 'var(--text)', borderColor: hover && !disabled ? 'var(--accent)' : 'var(--border-strong)' },
    ghost:   { background: hover && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--text-muted)' },
    danger:  { background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' },
  };
  return (
    <button
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      disabled={disabled} style={{ ...base, ...(kinds[kind] || kinds.secondary), ...style }} {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}

// ── Pill ──────────────────────────────────────────────────────────────────
const PILL_TONE = {
  neutral: { bg: 'var(--surface-3)', fg: 'var(--text-muted)', dot: 'var(--text-dim)' },
  accent:  { bg: 'rgba(255,75,75,0.14)', fg: 'var(--accent-2)', dot: 'var(--accent)' },
  warm:    { bg: 'rgba(255,140,66,0.14)', fg: 'var(--accent-warm)', dot: 'var(--accent-warm)' },
  info:    { bg: 'rgba(77,171,247,0.14)', fg: 'var(--info)', dot: 'var(--info)' },
  success: { bg: 'rgba(62,213,152,0.14)', fg: 'var(--success)', dot: 'var(--success)' },
  warn:    { bg: 'rgba(255,181,71,0.14)', fg: 'var(--warn)', dot: 'var(--warn)' },
  danger:  { bg: 'rgba(255,84,112,0.14)', fg: 'var(--danger)', dot: 'var(--danger)' },
};
function Pill({ tone = 'neutral', dot, children, style, title }) {
  const t = PILL_TONE[tone] || PILL_TONE.neutral;
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 'var(--r-pill)', fontSize: 11, fontWeight: 600,
      background: t.bg, color: t.fg, lineHeight: 1.4, ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot }} />}
      {children}
    </span>
  );
}

// ── TextInput ───────────────────────────────────────────────────────────
function TextInput({ value, onChange, placeholder, icon, style }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 34,
      background: 'var(--surface-2)', border: `1px solid ${focus ? 'var(--border-strong)' : 'var(--border)'}`,
      borderRadius: 'var(--r-2)', boxShadow: focus ? 'var(--glow-accent)' : 'none', ...style,
    }}>
      {icon && <Icon name={icon} size={14} style={{ color: 'var(--text-dim)' }} />}
      <input
        value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ flex: 1, background: 'transparent', border: 0, outline: 'none',
                 color: 'var(--text)', fontSize: 13, minWidth: 0 }}
      />
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────
function SectionLabel({ children, right, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, ...style }}>
      <span className="eyebrow">{children}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      <span style={{ flex: right ? 0 : 1, marginLeft: 12, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Segmented control ───────────────────────────────────────────────────
function Segmented({ options, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? '4px 9px' : '6px 12px';
  const fs = size === 'sm' ? 11.5 : 12.5;
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-2)', padding: 2, gap: 2 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange?.(o.value)} style={{
            border: 0, cursor: 'pointer', padding: pad, fontSize: fs, fontWeight: 600,
            borderRadius: 'var(--r-1)', fontFamily: 'inherit',
            background: active ? 'var(--accent)' : 'transparent',
            color: active ? '#fff' : 'var(--text-muted)',
            display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          }}>
            {o.icon && <Icon name={o.icon} size={13} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Slider ──────────────────────────────────────────────────────────────
function Slider({ value, min = 0, max = 1, step = 0.01, onChange, accent = 'var(--accent)' }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, background: 'var(--border)' }} />
      <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: accent }} />
      <input type="range" min={min} max={max} step={step} value={value}
             onChange={(e) => onChange?.(parseFloat(e.target.value))}
             style={{ position: 'absolute', left: 0, right: 0, width: '100%', margin: 0,
                      WebkitAppearance: 'none', appearance: 'none', background: 'transparent',
                      height: 22, cursor: 'pointer' }} />
    </div>
  );
}

// Empty-state block
function Empty({ icon, title, children }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '48px 24px', textAlign: 'center', color: 'var(--text-dim)' }}>
      {icon && <Icon name={icon} size={30} stroke={1.5} style={{ marginBottom: 12, color: 'var(--text-dim)' }} />}
      {title && <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>{title}</div>}
      <div style={{ fontSize: 12.5, maxWidth: 380, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

// global slider thumb styling (can't inline ::-webkit-slider-thumb)
(function injectSliderCss() {
  if (document.getElementById('ff-slider-css')) return;
  const el = document.createElement('style');
  el.id = 'ff-slider-css';
  el.textContent = `
    input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; appearance:none;
      width:15px;height:15px;border-radius:50%;background:var(--accent);
      border:2px solid var(--surface);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.5); }
    input[type=range]::-moz-range-thumb{ width:15px;height:15px;border-radius:50%;
      background:var(--accent);border:2px solid var(--surface);cursor:pointer; }
  `;
  document.head.appendChild(el);
})();

Object.assign(window, { Icon, Button, Pill, TextInput, SectionLabel, Segmented, Slider, Empty });
