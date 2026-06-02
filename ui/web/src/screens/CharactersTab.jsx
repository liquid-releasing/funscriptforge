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
  MediaViewer, ChapterRibbon, Slider,
} from 'forgemoment';
import {
  CHARACTERS as STYLE_CATALOG,
  ESTIM_CHANNELS,
  seedCharacterAssignments,
  defaultParamsFor,
} from '../data/characters.js';
import { listCharacters } from '../api/forge.js';
import { useChapterClip } from '../hooks/useChapterClip.js';

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
      description: c.description || style?.desc || style?.description || '',
      // Sliders: prefer Python's catalog when it ships them; fall
      // back to the JS-side defs so the slider UI lights up even
      // before the canonical Python catalog grows sliders.
      sliders: (c.sliders && c.sliders.length > 0) ? c.sliders : (style?.sliders || []),
      color: style?.color || '#9ca3af',
      icon: style?.icon || 'circle',
      tagline: style?.tagline || '',
      devices: style?.devices || ['estim'],
    };
  });
}

// "Nothing" — explicit opt-out. Selecting this leaves the chapter to
// funscript-tools' default behaviour (Edger's code). Hardcoded outside
// the catalog because it's a UI affordance, not a character preset.
const NOTHING_COLOR = '#64748b';
const NOTHING = {
  id: '__nothing__',
  label: 'Nothing',
  color: NOTHING_COLOR,
  icon: null,            // grey card, no icon — neutral / opt-out
  tagline: 'Sets to default in funscript-tool',
  description: "Sets to default in funscript-tool — the chapter passes through with Edger's reference behaviour, untouched by the per-chapter character pipeline.",
};

export default function CharactersTab({
  project,
  selectedDevices = [],
  charactersByPath = {},
  setCharactersByPath = () => {},
  // Full-track audio sidecars (peaks / spectrogram / beats). Same shape
  // ChaptersTab / PhrasesTab / StanzasTab consume; drive MediaViewer's
  // Audio + Spectro modes for the focused chapter.
  trackPeaks,
  trackSpectrogram,
  trackBeats,
}) {
  const chapters = project?.chapterList ?? [];
  const actions = project?.actions ?? [];
  const path = project?.path ?? null;

  // Per-chapter character assignments, read from the App-level cache.
  // Shape: { [chapterId]: { characterId: string|null, params: {...} } }
  // null characterId === Nothing (passthrough to funscript-tools default).
  // Seeded on first visit per path so the tab always has something to
  // show; subsequent visits reuse whatever the user picked. Real
  // persistence (chain file) lands with the wiring pass.
  const applied = (path && charactersByPath[path]) || null;
  useEffect(() => {
    if (!path) return;
    if (charactersByPath[path]) return;
    if (chapters.length === 0) return;
    setCharactersByPath((prev) => ({
      ...prev,
      [path]: seedCharacterAssignments(chapters),
    }));
  }, [path, chapters, charactersByPath, setCharactersByPath]);

  const setApplied = (updater) => {
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

  // ── Viewer state — mirrors Phrases/Stanzas/Patterns chrome ──────────
  // Scope here is the chapter itself (user picks a chapter on the left
  // rail, then picks a character for that chapter). No ChapterContextStrip
  // — chapter navigation lives in the ChapterList rail below; the viewer
  // is purely "watch the video while you decide on a character."
  const [currentMs, setCurrentMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const mediaKind = project?.mediaKind || 'video';

  // Reset clock to chapter start on chapter switch / project switch; pause.
  useEffect(() => {
    setIsPlaying(false);
    if (activeChapter) setCurrentMs(activeChapter.atMs);
    else setCurrentMs(0);
  }, [activeChapter?.id]);

  // Chapter clip for the MediaViewer — same shared hook every other
  // editing tab uses (Chapters / Phrases / Patterns / Stanzas).
  const { clip: chapterClip } = useChapterClip(project?.mediaPath, activeChapter);
  const audioWaveform = trackPeaks?.peaks?.length ? trackPeaks : null;

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

  // Applied (committed) state for the active chapter — what export
  // would read today. Always present once seeding has run.
  const appliedForActive = (activeChapterId && applied) ? applied[activeChapterId] : null;

  // Staged state — what the sliders + card grid are editing for the
  // active chapter. Diverges from applied when the user changes the
  // character pick or tweaks a slider; Accept commits + advances.
  // Mirrors the original tab-Stim.jsx model.
  const [staged, setStaged] = useState({ characterId: undefined, params: {} });

  // Reset staged whenever the active chapter changes OR seeding fills
  // in the applied entry — pull the chapter's currently-applied state
  // into staged so the panel reflects the saved character + sliders.
  useEffect(() => {
    if (!appliedForActive) return;
    setStaged({
      characterId: appliedForActive.characterId,
      params: { ...(appliedForActive.params || {}) },
    });
  }, [activeChapterId, appliedForActive?.characterId]);
  // (intentionally don't depend on appliedForActive.params reference;
  // chapter switch is the only trigger for staged-reset)

  const stagedChar = (staged.characterId && staged.characterId !== null)
    ? findChar(staged.characterId)
    : null;
  const isNothingStaged = staged.characterId === null;
  // Applied = the committed character for the active chapter; what
  // ChapterRibbon, ChapterList, title row, ChannelGrid show. Staged
  // drives the CharacterPanel (cards, sliders, desc) only.
  const appliedChar = appliedForActive?.characterId
    ? findChar(appliedForActive.characterId)
    : null;
  const isNothingApplied = appliedForActive?.characterId === null;

  // Dirty = staged diverges from applied for this chapter. Drives the
  // Accept button enabled state + "unsaved changes" indicator.
  const dirty = useMemo(() => {
    if (!appliedForActive) return false;
    if (staged.characterId !== appliedForActive.characterId) return true;
    const appliedParams = appliedForActive.params || {};
    const stagedParams = staged.params || {};
    const keys = new Set([...Object.keys(appliedParams), ...Object.keys(stagedParams)]);
    for (const k of keys) {
      if (appliedParams[k] !== stagedParams[k]) return true;
    }
    return false;
  }, [appliedForActive, staged]);

  // ── Staged mutators ───────────────────────────────────────────────
  // Card click — switch character (or Nothing) in staged ONLY.
  // Sliders default fresh from the new character's catalog defs.
  // Accept commits.
  const setStagedCharacter = (characterId) => {
    setStaged({
      characterId,
      params: characterId ? defaultParamsFor(characterId) : {},
    });
  };
  const setStagedParam = (key, value) => {
    setStaged((s) => ({ ...s, params: { ...s.params, [key]: value } }));
  };
  const resetStaged = () => {
    if (!appliedForActive) return;
    setStaged({
      characterId: appliedForActive.characterId,
      params: { ...(appliedForActive.params || {}) },
    });
  };
  // Accept = commit staged → applied for the active chapter, then
  // advance to the next chapter. The "Use [Character] · next chapter"
  // button calls this. Last chapter: commit, no advance.
  const acceptChange = () => {
    if (!activeChapterId) return;
    setApplied((a) => ({
      ...a,
      [activeChapterId]: {
        characterId: staged.characterId,
        params: { ...staged.params },
      },
    }));
    const i = chapters.findIndex((c) => c.id === activeChapterId);
    if (i >= 0 && i < chapters.length - 1) {
      setActiveChapterId(chapters[i + 1].id);
    }
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
      <Header chapter={activeChapter} character={appliedChar} estimSelected={estimSelected} />

      {activeChapter && (
        <>
          {/* Title row — chapter identity + character pill on left,
              Collapse on right. Mirrors the Phrases / Stanzas / Patterns
              chrome pattern. Stays put across expand/collapse. */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            gap: 'var(--s-3)', marginTop: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2,
                  background: activeChapter.color || 'var(--text-dim)',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  {activeChapter.name || activeChapter.id}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                  {fmtTimeShort(activeChapter.atMs)}–{fmtTimeShort(activeChapter.endMs)}
                </span>
                {appliedChar && (
                  <Pill
                    tone="neutral"
                    style={{
                      background: appliedChar.color + '22',
                      color: appliedChar.color,
                      borderColor: appliedChar.color + '55',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <Icon name={appliedChar.icon || 'circle'} size={11} />
                    {appliedChar.label}
                  </Pill>
                )}
                {isNothingApplied && (
                  <Pill
                    tone="neutral"
                    style={{
                      background: NOTHING_COLOR + '22',
                      color: NOTHING_COLOR,
                      borderColor: NOTHING_COLOR + '55',
                    }}
                  >
                    {NOTHING.label}
                  </Pill>
                )}
              </div>
            </div>
            <button
              onClick={() => setIsViewerExpanded((v) => !v)}
              title={isViewerExpanded ? 'Collapse' : 'Expand'}
              aria-label={isViewerExpanded ? 'Collapse' : 'Expand'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 5,
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                flexShrink: 0,
              }}
            >
              <Icon name={isViewerExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
              {isViewerExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {/* Bordered viewer box — multi-chapter ChapterRibbon on the
              left (so the user sees the whole project at a glance with
              each chapter's assigned character tinting its band), and
              the MediaViewer on the right scoped to the active chapter.
              Same pattern as ChaptersTab's top row; the character
              assignment per chapter rides on the band's `toneColor`. */}
          {isViewerExpanded && (
            <div style={{
              marginTop: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 12,
              display: 'grid', gridTemplateColumns: '1fr 320px',
              gap: 'var(--s-5)', alignItems: 'stretch',
            }}>
              <ChapterRibbon
                bands={chapters.map((c) => {
                  const a = applied?.[c.id];
                  const char = a?.characterId ? findChar(a.characterId) : null;
                  return {
                    id: c.id,
                    at_ms: c.atMs,
                    end_ms: c.endMs,
                    name: c.name,
                    color: c.color,
                    toneColor: char?.color,
                  };
                })}
                actions={actions}
                selectedId={activeChapterId}
                onSelect={(band) => setActiveChapterId(band.id)}
                onSeek={(ms) => setCurrentMs(Math.max(activeChapter.atMs, Math.min(activeChapter.endMs, ms)))}
                currentMs={currentMs}
                height={180}
              />

              <MediaViewer
                videoSrc={chapterClip?.url}
                videoSrcOffsetMs={chapterClip?.offsetMs ?? 0}
                media={{ kind: mediaKind, title: activeChapter.name || activeChapter.id }}
                loadingLabel={chapterClip ? null : 'Loading chapter clip…'}
                audioWaveform={audioWaveform}
                spectrogram={trackSpectrogram}
                beats={trackBeats}
                chapter={{
                  id: activeChapter.id,
                  title: activeChapter.name || activeChapter.id,
                  color: activeChapter.color || '#4dabf7',
                  start: activeChapter.atMs,
                  end: activeChapter.endMs,
                }}
                funscript={{ actions }}
                currentMs={currentMs}
                totalMs={activeChapter.endMs}
                isPlaying={isPlaying}
                onPlayPause={() => setIsPlaying((p) => !p)}
                onSeek={(ms) => {
                  setCurrentMs(Math.max(activeChapter.atMs, Math.min(activeChapter.endMs, ms)));
                }}
                onTimeChange={(ms) => {
                  if (ms >= activeChapter.endMs) setCurrentMs(activeChapter.atMs);
                  else if (ms < activeChapter.atMs) setCurrentMs(activeChapter.atMs);
                  else setCurrentMs(ms);
                }}
                controls={['chapter-start', 'back1', 'frame-back', 'play', 'frame-forward', 'forward1', 'chapter-end']}
                modeToggleAlign="start"
                modeToggleSize="sm"
                showModeLabel={false}
                showMark={false}
                width={320}
                thumbnailAspect="16/7"
              />
            </div>
          )}
        </>
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
          applied={applied}
          catalog={catalog}
          activeId={activeChapterId}
          onSelect={setActiveChapterId}
        />

        <CharacterPanel
          catalog={catalog}
          stagedChar={stagedChar}
          isNothingStaged={isNothingStaged}
          stagedParams={staged.params}
          onSelectCharacter={setStagedCharacter}
          onParamChange={setStagedParam}
          onAccept={acceptChange}
          onReset={resetStaged}
          dirty={dirty}
          isLastChapter={chapters.findIndex((c) => c.id === activeChapterId) >= chapters.length - 1}
          estimSelected={estimSelected}
          catalogWarning={catalogWarning}
        />
      </div>

      <ChannelGrid character={appliedChar} estimSelected={estimSelected} />
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
function ChapterList({ chapters, applied, catalog, activeId, onSelect }) {
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
          const a = applied?.[c.id];
          const charId = a?.characterId;
          const char = charId ? lookup(charId) : null;
          const isNothing = (c.id in (applied || {})) && charId === null;
          const isActive = c.id === activeId;
          const accent = char?.color || (isNothing ? NOTHING_COLOR : null);
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
                borderLeft: isActive && accent ? `3px solid ${accent}` : '3px solid transparent',
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
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Icon name={char.icon || 'circle'} size={11} />
                  {char.label}
                </Pill>
              )}
              {isNothing && (
                <Pill
                  tone="neutral"
                  style={{
                    background: NOTHING_COLOR + '22',
                    color: NOTHING_COLOR,
                    borderColor: NOTHING_COLOR + '55',
                    justifySelf: 'end',
                  }}
                >
                  {NOTHING.label}
                </Pill>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// One character pick — color-tinted icon + label + tagline. Used both
// for catalog characters and the Nothing opt-out card.
function CharacterCard({ label, tagline, color, icon, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: 10, gap: 6, borderRadius: 8,
        background: selected ? color + '20' : 'var(--surface-2)',
        border: `1.5px solid ${selected ? color : 'var(--border)'}`,
        color: 'var(--text)', cursor: 'pointer',
        fontFamily: 'inherit', textAlign: 'left',
        minHeight: 96,
      }}
    >
      {/* Icon is optional — Nothing card renders without one (grey,
          no glyph) to read as the neutral / opt-out option. */}
      {icon
        ? <Icon name={icon} size={20} style={{ color }} />
        : <span style={{ height: 20 }} />}
      <span style={{
        fontSize: 12, fontWeight: 700,
        color: selected ? color : 'var(--text-soft)',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 10.5, color: 'var(--text-dim)',
        lineHeight: 1.35,
      }}>
        {tagline}
      </span>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// CharacterPanel — right rail
// ──────────────────────────────────────────────────────────────
function CharacterPanel({
  catalog,
  stagedChar, isNothingStaged, stagedParams,
  onSelectCharacter, onParamChange, onAccept, onReset, dirty, isLastChapter,
  estimSelected, catalogWarning,
}) {
  // Card grid auto-sizes — usually 5 + Nothing = 6, but accommodates a
  // custom preset the user dropped into stim_presets.json. Cap at 7
  // columns; beyond that wraps to a second row.
  const cardCols = Math.min(Math.max(catalog.length + 1, 1), 7);
  const sliders = stagedChar?.sliders || [];
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
            const sel = stagedChar && c.id === stagedChar.id;
            return (
              <CharacterCard
                key={c.id}
                label={c.label}
                tagline={c.tagline}
                color={c.color}
                icon={c.icon || 'circle'}
                selected={sel}
                onClick={() => onSelectCharacter(c.id)}
              />
            );
          })}
          {/* Nothing — opt-out card; null staged uses Edger's defaults */}
          <CharacterCard
            key={NOTHING.id}
            label={NOTHING.label}
            tagline={NOTHING.tagline}
            color={NOTHING.color}
            icon={NOTHING.icon}
            selected={isNothingStaged}
            onClick={() => onSelectCharacter(null)}
          />
        </div>

        {stagedChar && (
          <div style={{
            fontSize: 12, color: 'var(--text-dim)',
            lineHeight: 1.5, marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            {stagedChar.description || stagedChar.desc}
          </div>
        )}
        {isNothingStaged && (
          <div style={{
            fontSize: 12, color: 'var(--text-dim)',
            lineHeight: 1.5, marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            {NOTHING.description}
          </div>
        )}

        {/* Per-character sliders — each with left/right hint above the
            track, matching the original tab-Stim.jsx design. Nothing
            renders no sliders (no params to tune). */}
        {stagedChar && sliders.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {sliders.map((s) => {
              const value = stagedParams?.[s.id] ?? s.def;
              const valueLabel = typeof value === 'number'
                ? `${value.toFixed(s.step < 1 ? 2 : 0)}${s.unit || ''}`
                : `${value}${s.unit || ''}`;
              return (
                <div key={s.id} style={{ marginBottom: 12 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: 10, color: 'var(--text-dim)', marginBottom: 4,
                  }}>
                    <span>← {s.leftHint}</span>
                    <span>{s.rightHint} →</span>
                  </div>
                  <Slider
                    label={s.label}
                    valueLabel={valueLabel}
                    value={value}
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    onChange={(v) => onParamChange(s.id, v)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {stagedChar && (
          <>
            <SectionLabel>Supports</SectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, marginBottom: 12 }}>
              {stagedChar.devices.map((d) => (
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

        {/* Action row — Accept commits staged → applied for this
            chapter and advances to the next. Reset restores staged
            to the committed values. Mirrors original tab-Stim.jsx. */}
        <ActionRow
          stagedChar={stagedChar}
          isNothingStaged={isNothingStaged}
          dirty={dirty}
          isLastChapter={isLastChapter}
          onAccept={onAccept}
          onReset={onReset}
        />

        {!estimSelected && (
          <div style={{
            marginTop: 10, fontSize: 11, color: '#ffb547',
          }}>
            Without e-stim selected on the Device tab, the generated channels won't be exported.
          </div>
        )}
      </div>
    </div>
  );
}

// Action row — "Use [Character] · next chapter" primary, Reset
// secondary, "unsaved changes" indicator. The Accept button is the
// commit-and-advance affordance the user asked for; it's enabled
// even when nothing is dirty so the user can power-walk through
// chapters where the seeded default already fits.
function ActionRow({ stagedChar, isNothingStaged, dirty, isLastChapter, onAccept, onReset }) {
  const label = stagedChar?.label
    || (isNothingStaged ? NOTHING.label : null);
  const color = stagedChar?.color
    || (isNothingStaged ? NOTHING_COLOR : 'var(--accent)');
  // Button text: "Use Reactive · next chapter" / "Use Reactive (last)"
  const verb = label ? `Use ${label}` : 'Use this character';
  const suffix = isLastChapter ? '(last chapter)' : '· next chapter';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginTop: 6,
      paddingTop: 12, borderTop: '1px solid var(--border)',
    }}>
      <button
        onClick={onAccept}
        disabled={!label}
        style={{
          padding: '8px 14px', fontSize: 12.5, fontWeight: 700,
          background: label ? color : 'var(--surface-2)',
          color: label ? '#fff' : 'var(--text-dim)',
          border: 'none', borderRadius: 6,
          cursor: label ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
        title={label ? `Commit ${label} to this chapter and move on` : 'Pick a character first'}
      >
        <Icon name="check" size={13} />
        {verb} {suffix}
      </button>
      {dirty && (
        <button
          onClick={onReset}
          style={{
            padding: '6px 10px', fontSize: 11.5, fontWeight: 600,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 5,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
          title="Discard staged changes for this chapter"
        >
          Reset
        </button>
      )}
      <span style={{ flex: 1 }} />
      {dirty && (
        <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>
          unsaved changes
        </span>
      )}
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
