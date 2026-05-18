// CharactersTab — pick a sensation character per chapter, review the
// generated 9-channel grid. SKELETON pass: shows the iter-10 design's
// shape (chapter list / character cards / 9-channel grid) but skips
// sliders, electrode diagram, carrier pattern, beat-sync, and the
// actual channel generation. Tab id stays 'stim' to keep TAB_CHAIN /
// chain filenames stable; label says "Characters" — the design's own
// vocabulary called these character cards already, just under the wrong
// tab name. See memory `project_characters_tab.md`.
//
// Layout:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │  Header                                                      │
//   ├──────────────────────────────────────────────────────────────┤
//   │  Active chapter ChapterContextStrip (chapter-scoped wave)   │
//   ├──────────────────────┬───────────────────────────────────────┤
//   │  Chapter list with   │  Active character cards (5)           │
//   │  per-chapter pill    │  Description + supported devices      │
//   │                      │  Wiring-later placeholder for sliders │
//   ├──────────────────────┴───────────────────────────────────────┤
//   │  9-channel preview grid (3×3) — labeled placeholders         │
//   └──────────────────────────────────────────────────────────────┘
//
// State is local to this tab. The wiring pass adds per-chapter override
// persistence to a chain file, real preset list from cli.py
// list-characters, and the 9-channel output from cli.py stim-process.

import { useEffect, useMemo, useState } from 'react';
import {
  Pill, Icon, fmtTimeShort,
  ChapterContextStrip,
} from 'forgemoment';
import {
  CHARACTERS as STYLE_CATALOG,
  ESTIM_CHANNELS,
  seedCharacterAssignments,
} from '../data/characters.js';
import { listCharacters } from '../api/forge.js';

// Merge the canonical Python catalog (id / label / description / sliders)
// with the JS-side UI overlay (color / tagline / devices) by id. Same
// pattern as the iter-10 Streamlit panel's `_CARD_STYLE` lookup. If a
// custom character lives in the user's stim_presets.json that we don't
// have UI metadata for, fall back to neutral defaults so it still renders.
function mergeCatalogs(canonical) {
  const styleById = Object.fromEntries(STYLE_CATALOG.map((c) => [c.id, c]));
  if (!canonical || canonical.length === 0) return STYLE_CATALOG;
  return canonical.map((c) => {
    const style = styleById[c.id];
    return {
      id: c.id,
      label: c.label || style?.label || c.id,
      description: c.description || style?.desc || '',
      sliders: c.sliders || [],
      color: style?.color || '#9ca3af',
      tagline: style?.tagline || '',
      devices: style?.devices || ['estim'],
    };
  });
}

export default function CharactersTab({
  project,
  selectedDevices = [],
  charactersByPath = {},
  setCharactersByPath = () => {},
}) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const path = project?.path ?? null;

  // Per-chapter character assignments, read from the App-level cache.
  // Seeded on first visit per path so the tab always has something to
  // show; subsequent visits reuse whatever the user picked. Real
  // persistence (chain file) lands with the wiring pass.
  const assignments = (path && charactersByPath[path]) || null;
  useEffect(() => {
    if (!path) return;
    if (charactersByPath[path]) return;
    if (chapters.length === 0) return;
    setCharactersByPath((prev) => ({
      ...prev,
      [path]: seedCharacterAssignments(chapters),
    }));
  }, [path, chapters, charactersByPath, setCharactersByPath]);

  const setAssignments = (updater) => {
    if (!path) return;
    setCharactersByPath((prev) => {
      const current = prev[path] || {};
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [path]: next };
    });
  };

  const [activeChapterId, setActiveChapterId] = useState(() => chapters[0]?.id ?? null);
  useEffect(() => {
    setActiveChapterId(chapters[0]?.id ?? null);
  }, [path]);  // eslint-disable-line react-hooks/exhaustive-deps
  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || null,
    [chapters, activeChapterId],
  );

  // Hydrate the character catalog from cli.py list-characters once per
  // app lifetime (catalog is global, not per-project). Browser-mock
  // returns an empty list; mergeCatalogs falls back to the JS seed.
  const [canonical, setCanonical] = useState(null);
  const [catalogWarning, setCatalogWarning] = useState(null);
  useEffect(() => {
    let cancelled = false;
    listCharacters()
      .then((res) => {
        if (cancelled) return;
        setCanonical(res?.characters ?? []);
        setCatalogWarning(res?.warning ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('listCharacters failed, falling back to seed catalog:', e);
        setCanonical([]);
      });
    return () => { cancelled = true; };
  }, []);

  const catalog = useMemo(() => mergeCatalogs(canonical), [canonical]);
  const findChar = (id) => catalog.find((c) => c.id === id) || null;

  const activeCharId = (activeChapterId && assignments) ? assignments[activeChapterId] : null;
  const activeChar = activeCharId ? findChar(activeCharId) : null;

  const setActiveCharacter = (charId) => {
    if (!activeChapterId) return;
    setAssignments((a) => ({ ...a, [activeChapterId]: charId }));
  };

  if (!project?.path) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Characters</h2>
        <p>Open a funscript from the Library tab to begin.</p>
      </section>
    );
  }

  if (chapters.length === 0) {
    return (
      <section className="ff-placeholder" style={{ padding: 24 }}>
        <h2>Characters</h2>
        <p>No chapters in this project — Characters works per-chapter, so detect or add chapters on the Chapters tab first.</p>
      </section>
    );
  }

  const estimSelected = selectedDevices.includes('estim');

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px', background: 'var(--bg)' }}>
      <Header chapter={activeChapter} character={activeChar} estimSelected={estimSelected} />

      {activeChapter && (
        <div style={{ marginTop: 12 }}>
          <ChapterContextStrip
            chapter={{ at_ms: activeChapter.atMs, end_ms: activeChapter.endMs }}
            actions={actions}
            bands={[]}
            expanded={true}
            header={(
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{activeChapter.name || activeChapter.id}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {fmtTimeShort(activeChapter.atMs)}–{fmtTimeShort(activeChapter.endMs)}
                </span>
                {activeChar && (
                  <Pill
                    tone="neutral"
                    style={{
                      background: activeChar.color + '22',
                      color: activeChar.color,
                      borderColor: activeChar.color + '55',
                    }}
                  >
                    {activeChar.label}
                  </Pill>
                )}
              </div>
            )}
          />
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) minmax(420px, 1.4fr)',
          gap: 16, marginTop: 16, alignItems: 'start',
        }}
      >
        <ChapterList
          chapters={chapters}
          assignments={assignments}
          catalog={catalog}
          activeId={activeChapterId}
          onSelect={setActiveChapterId}
        />

        <CharacterPanel
          catalog={catalog}
          activeChar={activeChar}
          onSelect={setActiveCharacter}
          estimSelected={estimSelected}
          catalogWarning={catalogWarning}
        />
      </div>

      <ChannelGrid character={activeChar} estimSelected={estimSelected} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────
function Header({ chapter, character, estimSelected }) {
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
          Characters · per-chapter sensation feel
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
          Pick a character per chapter
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4,
          maxWidth: 720, lineHeight: 1.45,
        }}>
          This is the first tab that <em>generates</em> output — each chapter's character produces a separate funscript per channel.
          E-stim resolves to 9 channels; the set rides together in the .forge bundle so the player picks what fits the connected device.
          Pick gentle, reactive, scene-builder, unpredictable, or balanced per chapter.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {!estimSelected && (
          <Pill tone="warn">
            <Icon name="alert-triangle" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            E-stim not selected on Device tab
          </Pill>
        )}
        {character && <Pill tone="info" dot>{character.label}</Pill>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ChapterList — left rail
// ──────────────────────────────────────────────────────────────
function ChapterList({ chapters, assignments, catalog, activeId, onSelect }) {
  const lookup = (id) => catalog.find((c) => c.id === id) || null;
  return (
    <div>
      <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{chapters.length}</span>}>
        Chapters
      </SectionLabel>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden', marginTop: 6,
      }}>
        {chapters.map((c, i) => {
          const charId = assignments?.[c.id];
          const char = lookup(charId);
          const isActive = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '8px 1fr auto',
                gap: 12, padding: '12px 14px', alignItems: 'center',
                width: '100%', textAlign: 'left', cursor: 'pointer',
                fontFamily: 'inherit',
                background: isActive ? 'var(--surface-2)' : 'transparent',
                border: 'none',
                borderLeft: isActive && char ? `3px solid ${char.color}` : '3px solid transparent',
                borderBottom: i < chapters.length - 1 ? '1px solid var(--border)' : 'none',
                color: 'var(--text)',
              }}
            >
              <span style={{
                width: 4, height: 32, borderRadius: 2,
                background: c.color || 'var(--text-dim)',
              }} />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: isActive ? 'var(--text)' : 'var(--text-soft)',
                }}>
                  {c.name || c.id}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                  {fmtTimeShort(c.atMs)}–{fmtTimeShort(c.endMs)}
                </div>
              </div>
              {char && (
                <Pill
                  tone="neutral"
                  style={{
                    background: char.color + '22',
                    color: char.color,
                    borderColor: char.color + '55',
                    justifySelf: 'end',
                  }}
                >
                  {char.label}
                </Pill>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CharacterPanel — right rail
// ──────────────────────────────────────────────────────────────
function CharacterPanel({ catalog, activeChar, onSelect, estimSelected, catalogWarning }) {
  // Card grid auto-sizes — usually 5, but accommodates a custom preset
  // the user dropped into stim_presets.json. Cap at 6 columns; beyond
  // that wraps to a second row.
  const cardCols = Math.min(Math.max(catalog.length, 1), 6);
  return (
    <div>
      <SectionLabel
        right={catalogWarning ? (
          <span title={catalogWarning}
            style={{ fontSize: 10, color: '#ffb547', cursor: 'help' }}>
            <Icon name="alert-triangle" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
            user preset file ignored
          </span>
        ) : null}
      >
        Character
      </SectionLabel>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 16, marginTop: 6,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cardCols}, 1fr)`,
          gap: 8, marginBottom: 14,
        }}>
          {catalog.map((c) => {
            const sel = activeChar && c.id === activeChar.id;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                style={{
                  display: 'flex', flexDirection: 'column',
                  padding: 10, gap: 4, borderRadius: 8,
                  background: sel ? c.color + '20' : 'var(--surface-2)',
                  border: `1.5px solid ${sel ? c.color : 'var(--border)'}`,
                  color: 'var(--text)', cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                  minHeight: 80,
                }}
              >
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: sel ? c.color : 'var(--text-soft)',
                }}>
                  {c.label}
                </span>
                <span style={{
                  fontSize: 10.5, color: 'var(--text-dim)',
                  lineHeight: 1.35,
                }}>
                  {c.tagline}
                </span>
              </button>
            );
          })}
        </div>

        {activeChar && (
          <div style={{
            fontSize: 12, color: 'var(--text-dim)',
            lineHeight: 1.5, marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            {activeChar.description}
          </div>
        )}

        {activeChar && (
          <>
            <SectionLabel>Supports</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {activeChar.devices.map((d) => (
                <span key={d} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 999,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  fontSize: 10.5, fontWeight: 600,
                  color: 'var(--text-muted)',
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: 'var(--text-dim)',
                  }} />
                  {d}
                </span>
              ))}
            </div>
          </>
        )}

        <div style={{
          marginTop: 14, padding: 12, borderRadius: 6,
          background: 'var(--surface-2)',
          border: '1px dashed var(--border)',
          fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
            <Icon name="cog" size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Sliders, carrier pattern, beat-sync land in the wiring pass
          </div>
          Per-character sliders pull from <span className="mono">funscript_tools.get_builtin_presets()</span>{' '}
          (the Streamlit reference impl is the schema source-of-truth).
          The 9-channel preview below redraws when{' '}
          <span className="mono">cli.py stim-process</span> emits real channel funscripts.
          {!estimSelected && (
            <div style={{ marginTop: 6, color: '#ffb547' }}>
              Without e-stim selected on the Device tab, the generated channels won't be exported.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ChannelGrid — 9 labeled cells in a 3×3 layout
// ──────────────────────────────────────────────────────────────
function ChannelGrid({ character, estimSelected }) {
  return (
    <div style={{ marginTop: 18 }}>
      <SectionLabel
        right={
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            wiring-later · static preview
          </span>
        }
      >
        9-channel preview
      </SectionLabel>
      <div style={{
        marginTop: 6,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
      }}>
        {ESTIM_CHANNELS.map((ch) => (
          <div key={ch.id} style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8,
            minHeight: 88,
            opacity: estimSelected ? 1 : 0.55,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 2,
                background: character ? character.color : ch.color,
              }} />
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{ch.label}</span>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                {ch.id}
              </span>
            </div>
            <PlaceholderEnvelope color={character ? character.color : ch.color} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Static decorative envelope so cells look like channel previews,
// not empty boxes. Single SVG path; varies with character color only.
function PlaceholderEnvelope({ color }) {
  return (
    <svg width="100%" height={36} viewBox="0 0 200 36" preserveAspectRatio="none"
         style={{ display: 'block' }}>
      <path
        d="M0,28 C 24,28 32,8 56,8 C 80,8 92,28 116,28 C 140,28 152,12 176,12 C 188,12 196,18 200,22"
        fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.5} />
      <path
        d="M0,28 C 24,28 32,8 56,8 C 80,8 92,28 116,28 C 140,28 152,12 176,12 C 188,12 196,18 200,22 L 200,36 L 0,36 Z"
        fill={color} fillOpacity={0.08} />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────
// Local helper — SectionLabel mirrors the EventsTab style.
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
