// AboutDialog — modal overlay opened from the TopBar help button.
// Sections: hero + identity, help/GitHub links, keyboard shortcuts,
// acknowledgements (real third-party credits), and a Liquid-Releasing
// footer (logo + copyright + license + trademark).
//
// Content source of truth for credits/license is forge/about.py (the
// former Streamlit "About" expander); kept in sync here for the Tauri UI.

import { Button, Icon, Pill } from 'forgemoment';
import { APP_VERSION } from '../appVersion.js';
import { openExternal } from '../api/forge.js';

const TAGLINE = 'The professional post-processor for haptic script creators.';
const GITHUB = 'https://github.com/liquid-releasing/funscriptforge';

const HELP_LINKS = [
  {
    label: 'Documentation',
    desc: 'User guide, tab walkthroughs, troubleshooting',
    icon: 'file-text',
    href: `${GITHUB}#readme`,
  },
  {
    label: 'Report an issue',
    desc: 'GitHub issues — bug reports, feature requests',
    icon: 'alert-circle',
    href: `${GITHUB}/issues`,
  },
  {
    label: 'Source',
    desc: 'Repository — MIT licensed',
    icon: 'git-branch',
    href: GITHUB,
  },
];

const SHORTCUTS = [
  { combo: 'Ctrl + O',         action: 'Open funscript' },
  { combo: 'Ctrl + E',         action: 'Jump to Export' },
  { combo: 'Ctrl + 1 … 9 / 0', action: 'Jump to tab by index' },
  { combo: 'Esc',              action: 'Close this dialog' },
];

// Third-party work FunscriptForge builds on. Credits carried over from
// forge/about.py and updated for the Tauri/React + bundled-backend build.
const CREDITS = [
  {
    name: 'funscript-tools',
    by: 'Edger · credited',
    note: 'Tone transforms + eTransform algorithms behind Stim channel '
        + 'generation. Used with credit to the author.',
    href: 'https://github.com/edger477/funscript-tools',
  },
  {
    name: 'restim',
    by: 'Diglet48 · MIT',
    note: '3-phase synthesis math for e-stim audio (stereo WAV rendering).',
    href: 'https://github.com/diglet48/restim',
  },
  {
    name: 'FFmpeg',
    by: 'bundled · GPL',
    note: 'Media decode + 720p chapter-clip transcode (libx264). Shipped as a '
        + 'separate binary; its GPL license + source link travel with the app.',
    href: 'https://ffmpeg.org',
  },
  {
    name: 'librosa · numba · SciPy',
    by: 'ISC / BSD',
    note: 'Audio structure, beat, and spectral analysis in the Python backend.',
    href: 'https://librosa.org',
  },
  {
    name: 'Tauri · React · Vite · Lucide',
    by: 'MIT / Apache-2.0',
    note: 'Desktop shell, UI, build tooling, and icons.',
    href: 'https://tauri.app',
  },
];

export default function AboutDialog({ open, onClose, inTauri }) {
  if (!open) return null;

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
        <Hero />

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

// Hero banner — the FunscriptForge key art. Public asset served at root.
function Hero() {
  return (
    <div style={{
      width: '100%', aspectRatio: '16 / 6', overflow: 'hidden',
      background: 'var(--surface-2)',
      borderBottom: '1px solid var(--border)',
    }}>
      <img
        src="/hero-forge.png"
        alt="FunscriptForge"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
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
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
          FunscriptForge
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
          {TAGLINE}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>
          v{APP_VERSION}
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
          onClick={(e) => { e.preventDefault(); openExternal(item.href); }}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55,
        marginBottom: 2,
      }}>
        FunscriptForge stands on the open-source haptics and scientific-Python
        communities. Each project remains under its own copyright and license:
      </div>
      {CREDITS.map((c) => (
        <a
          key={c.name}
          href={c.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); openExternal(c.href); }}
          style={{
            display: 'block', padding: '8px 11px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)', textDecoration: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{c.by}</span>
            <Icon name="external-link" size={10}
                  style={{ color: 'var(--text-dim)', marginLeft: 'auto' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.45 }}>
            {c.note}
          </div>
        </a>
      ))}
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
        The <span className="mono">.funscript</span> file format is a community
        standard, not owned by Liquid Releasing.
      </div>
    </div>
  );
}

function Footer({ onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
      borderTop: '1px solid var(--border)',
      background: 'var(--surface-2)',
    }}>
      <img
        src="/liquid-releasing-white.svg"
        alt="Liquid Releasing"
        style={{ height: 22, width: 'auto', opacity: 0.92, flexShrink: 0 }}
      />
      <span style={{
        fontSize: 10.5, color: 'var(--text-dim)',
        alignSelf: 'center', flex: 1, lineHeight: 1.4,
      }}>
        FunscriptForge™ is a trademark of Liquid Releasing.<br />
        © 2026 Liquid Releasing · MIT License.
      </span>
      <Button kind="primary" size="sm" onClick={onClose}>Done</Button>
    </div>
  );
}
