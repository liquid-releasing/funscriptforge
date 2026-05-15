// Library — first-run landing screen.
//
// Ported from ui_design/ui_kits/funscriptforge-app/LibraryScreen.jsx, but
// rewritten as a real ES module: primitives come from forgemoment (Button,
// Pill, Card, SectionHeading, Icon, MiniWave) rather than window globals.
// Recents and tone templates come through the platform adapter
// (../api/forge.js) so the same screen works in Tauri and browser modes.

import { useEffect, useState } from 'react';
import {
  Button,
  Pill,
  Card,
  SectionHeading,
  Icon,
  Sparkline,
} from 'forgemoment';
import { listRecents, listToneTemplates, pickFunscriptFile } from '../api/forge.js';
import { generatePreviewActions, parseDurationToMs } from '../lib/funscriptPreview.js';

export default function LibraryScreen({ onOpen }) {
  const [recents, setRecents] = useState(null);
  const [tones, setTones] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listRecents(), listToneTemplates()])
      .then(([r, t]) => {
        if (cancelled) return;
        setRecents(r);
        setTones(t);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('LibraryScreen: failed to load library data', err);
        setRecents([]);
        setTones([]);
      });
    return () => { cancelled = true; };
  }, []);

  const handleOpen = async () => {
    const path = await pickFunscriptFile();
    if (!path) return;
    // Hand the path up to App.jsx, which orchestrates load_project (so the
    // wait-cursor + tab pre-switch happen at the app level rather than
    // here, where they'd race with the tab change).
    onOpen?.(path);
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Hero onOpen={handleOpen} />

        <SectionHeading
          title="Recent"
          subtitle="Pick up where you left off."
          right={
            <Button kind="ghost" size="sm" iconRight="chevron-right">
              All projects
            </Button>
          }
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
            marginBottom: 36,
          }}
        >
          <NewProjectCard onClick={handleOpen} />
          {recents === null
            ? <RecentSkeleton count={3} />
            : recents.map((f) => (
                <FileCard key={f.id} file={f} onOpen={() => onOpen?.(f.id)} />
              ))}
        </div>

        <SectionHeading
          title="Tone templates"
          subtitle="Start from a forged baseline."
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          {(tones ?? []).map((t) => (
            <Card key={t.id} hoverable padding={16} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ToneIcon tone={t} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {t.tagline}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function Hero({ onOpen }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(255,75,75,0.12), rgba(199,125,255,0.06))',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '32px 36px',
        marginBottom: 32,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.08,
          pointerEvents: 'none',
          backgroundImage:
            'radial-gradient(circle at 20% 30%, var(--accent), transparent 40%), ' +
            'radial-gradient(circle at 80% 70%, #c77dff, transparent 40%)',
        }}
      />
      {/* Forge artwork — right-side hero illustration at full color.
          Source: funscriptforge/media/hammer-striking-anvil.png. */}
      <img
        src="/hero-forge.png"
        alt=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: -32,
          bottom: -32,
          width: 280,
          height: 280,
          objectFit: 'contain',
          pointerEvents: 'none',
          filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.4))',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 600 }}>
        <Pill tone="accent" dot style={{ marginBottom: 12 }}>
          Alpha — your feedback shapes this
        </Pill>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          Forge a stronger script.
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'var(--text-muted)',
            margin: '0 0 20px',
            maxWidth: 540,
            lineHeight: 1.5,
          }}
        >
          Drop in a funscript, refine its tone, rewrite chapters, and shape patterns
          to match exactly what you want — without rebuilding from zero.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button kind="primary" icon="upload" onClick={onOpen}>
            Open script
          </Button>
          <Button kind="secondary" icon="plus">
            New project
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileCard({ file, onOpen }) {
  // Real funscripts get downsampled previews from the backend in
  // `file.previewActions`. Until the Python bridge lands, generate a
  // believable curve deterministically from the project id + duration so
  // each card looks distinct without faking a perfectly clean wave.
  const previewActions = file.previewActions ?? generatePreviewActions(file);
  const durationMs = parseDurationToMs(file.duration) || 60000;

  return (
    <Card hoverable onClick={onOpen} padding={0}>
      <div
        style={{
          height: 84,
          background: 'var(--surface-2)',
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
          overflow: 'hidden',
          padding: 6,
        }}
      >
        <Sparkline
          actions={previewActions}
          start={0}
          end={durationMs}
          colorMode="velocity"
          filled
          height={72}
        />
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.title}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {file.duration} · {file.phrases} ph.
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{file.edited}</span>
        </div>
      </div>
    </Card>
  );
}

function NewProjectCard({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'rgba(255,75,75,0.08)' : 'var(--surface)',
        border: `1.5px dashed ${hover ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 10,
        padding: '20px 14px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: hover ? '#ff7b7b' : 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 142,
        transition: 'all 150ms',
      }}
    >
      <Icon name="upload" size={28} stroke={1.5} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>Drop a .funscript</span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>or click to browse</span>
    </button>
  );
}

function RecentSkeleton({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        minHeight: 142,
        opacity: 0.4,
      }}
    />
  ));
}

function ToneIcon({ tone }) {
  // The canonical PNGs from funscriptforge/assets/tone_cards/ — copied into
  // /public/tones/ during scaffold so the same path works in Tauri and web.
  // Each tone has a brand color used as a faint backplate for visual anchor.
  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={tone.icon}
        alt={`${tone.label} tone`}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
