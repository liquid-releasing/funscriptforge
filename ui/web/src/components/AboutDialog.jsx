// AboutDialog — modal overlay opened from the TopBar help button.
// Three sections:
//   1. Identity (logo / name / version / build info)
//   2. Help links (docs, GitHub issues, source)
//   3. Acknowledgements (Liquid Releasing app family + open-source thanks)
//
// Light skeleton — content is static. Links go to placeholder URLs until
// the public docs site exists; tracked in
// project_funscriptforge_pending.md.

import { Button, Icon, Pill } from 'forgemoment';

// Version sourced from package.json at build time. Vite exposes
// `import.meta.env` but not package.json directly, so we hardcode for
// now and pair the bump with the version field in package.json.
const APP_VERSION = '0.0.1';
const APP_CODENAME = 'scaffold';

const HELP_LINKS = [
  {
    label: 'Documentation',
    desc: 'User guide, tab walkthroughs, troubleshooting',
    icon: 'file-text',
    href: 'https://github.com/liquid-releasing/funscriptforge#readme',
  },
  {
    label: 'Report an issue',
    desc: 'GitHub issues — bug reports, feature requests',
    icon: 'alert-circle',
    href: 'https://github.com/liquid-releasing/funscriptforge/issues',
  },
  {
    label: 'Source',
    desc: 'Repository — MIT licensed',
    icon: 'git-branch',
    href: 'https://github.com/liquid-releasing/funscriptforge',
  },
];

const SHORTCUTS = [
  { combo: 'Ctrl + O',         action: 'Open funscript' },
  { combo: 'Ctrl + E',         action: 'Jump to Export' },
  { combo: 'Ctrl + 1 … 9 / 0', action: 'Jump to tab by index' },
  { combo: 'Esc',              action: 'Close this dialog' },
];

export default function AboutDialog({ open, onClose, inTauri }) {
  if (!open) return null;

  // Click-outside to close. Click inside the dialog stops propagation.
  const onBackdropClick = () => onClose?.();

  return (
    <div
      onClick={onBackdropClick}
      role="dialog" aria-modal="true" aria-label="About FunscriptForge"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center',
        zIndex: 100, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '85vh', overflow: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <Header onClose={onClose} />

        <div style={{ padding: '18px 22px' }}>
          <Identity inTauri={inTauri} />
          <Section title="Help &amp; Resources">
            <LinkList items={HELP_LINKS} />
          </Section>
          <Section title="Keyboard shortcuts">
            <ShortcutTable />
          </Section>
          <Section title="Acknowledgements">
            <Acknowledgements />
          </Section>
        </div>

        <Footer onClose={onClose} />
      </div>
    </div>
  );
}

function Header({ onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '14px 18px 14px 22px',
      borderBottom: '1px solid var(--border)',
    }}>
      <Icon name="help-circle" size={18} style={{ color: 'var(--accent)' }} />
      <span style={{ fontSize: 15, fontWeight: 700 }}>About FunscriptForge</span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          background: 'transparent', border: 'none',
          color: 'var(--text-dim)', cursor: 'pointer',
          padding: 4, borderRadius: 4,
          display: 'grid', placeItems: 'center',
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

function Identity({ inTauri }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 14, borderRadius: 8,
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      marginBottom: 18,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 10,
        background: 'linear-gradient(135deg, #ff7b7b 0%, #c77dff 100%)',
        display: 'grid', placeItems: 'center',
        flexShrink: 0,
      }}>
        <Icon name="zap" size={22} style={{ color: '#fff' }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>
          FunscriptForge
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>
          v{APP_VERSION} · {APP_CODENAME}
        </div>
      </div>
      <Pill tone="neutral" dot>{inTauri ? 'Tauri desktop' : 'browser'}</Pill>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-muted)',
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function LinkList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item) => (
        <a
          key={item.label}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 1fr 14px',
            gap: 10, padding: '9px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6, alignItems: 'center',
            color: 'var(--text)', textDecoration: 'none',
          }}
        >
          <Icon name={item.icon} size={13} style={{ color: 'var(--text-dim)' }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item.desc}</div>
          </div>
          <Icon name="external-link" size={11} style={{ color: 'var(--text-dim)' }} />
        </a>
      ))}
    </div>
  );
}

function ShortcutTable() {
  return (
    <div style={{
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: 6, overflow: 'hidden',
    }}>
      {SHORTCUTS.map((s, i) => (
        <div key={s.combo} style={{
          display: 'grid',
          gridTemplateColumns: '140px 1fr',
          gap: 14, padding: '8px 12px',
          borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--border)' : 'none',
          fontSize: 12,
          alignItems: 'baseline',
        }}>
          <span className="mono" style={{
            fontSize: 11.5, fontWeight: 600,
            color: 'var(--text-soft)',
          }}>
            {s.combo}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{s.action}</span>
        </div>
      ))}
      <div style={{
        padding: '6px 12px', fontSize: 10.5,
        color: 'var(--text-dim)', background: 'var(--bg)',
      }}>
        wiring later — listed for orientation, no global handler yet.
      </div>
    </div>
  );
}

function Acknowledgements() {
  return (
    <div style={{
      fontSize: 12, color: 'var(--text-muted)',
      lineHeight: 1.6, padding: '8px 4px',
    }}>
      Part of the Liquid Releasing app family alongside Beatflo (rhythm authoring)
      and the Sync Player (multi-modal playback). Built on{' '}
      <Link href="https://tauri.app">Tauri 2</Link>,{' '}
      <Link href="https://react.dev">React</Link>, and{' '}
      <Link href="https://vitejs.dev">Vite</Link> with icons by{' '}
      <Link href="https://lucide.dev">Lucide</Link>.
      Funscript tooling derives from the broader OSS haptics community —
      see the source repo for full attributions.
    </div>
  );
}

function Link({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       style={{ color: 'var(--accent)', textDecoration: 'none' }}>
      {children}
    </a>
  );
}

function Footer({ onClose }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '12px 18px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface-2)',
    }}>
      <span style={{
        fontSize: 11, color: 'var(--text-dim)',
        alignSelf: 'center', flex: 1,
      }}>
        MIT licensed · &copy; 2026 Liquid Releasing
      </span>
      <Button kind="primary" size="sm" onClick={onClose}>Done</Button>
    </div>
  );
}
