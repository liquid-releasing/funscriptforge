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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pill, Icon, fmtTimeShort,
  MediaViewer, ChapterRibbon, Slider, Sparkline,
} from 'forgemoment';
import {
  CHARACTERS as STYLE_CATALOG,
  ESTIM_CHANNELS,
  seedCharacterAssignments,
  backfillCharacterAssignments,
  characterForPosition,
  defaultParamsFor,
} from '../data/characters.js';
import {
  listCharacters, readCharacters, saveCharacters, stimProcess, multiaxisProcess,
  readPassages, savePassages,
} from '../api/forge.js';
import { useChapterClip } from '../hooks/useChapterClip.js';
import MechanicalPanel from './MechanicalPanel.jsx';
import { EnvelopeRibbon } from './PassagesPanel.jsx';
import ArcSlider from '../components/ArcSlider.jsx';
import {
  PASSAGE_PRESETS, PASSAGE_SHAPES, passagesForPreset, activePassagePreset,
  passageInfoForChapter, arcFromPassages, passagesFromArc,
} from '../data/passages.js';
import { activeAxes, DEFAULT_STYLE, mechStyleForPosition } from '../data/multiaxis.js';

// Merge the canonical Python catalog (id / label / description / sliders)
// with the JS-side UI overlay (color / tagline / devices) by id. Same
// pattern as the iter-10 Streamlit panel's `_CARD_STYLE` lookup. If a
// custom character lives in the user's stim_presets.json that we don't
// have UI metadata for, fall back to neutral defaults so it still renders.
// The Python catalog ships sliders in its own schema —
// `{ cv, label, hint, from_, to_, min_label, max_label }` (cv is the
// control-value param key). The slider UI expects
// `{ id, label, leftHint, rightHint, min, max, step, def, unit }`, so
// translate. Python carries no step/default/unit, so derive a sensible
// step from the range and default to the midpoint. Without this the
// sliders render with `key={undefined}` (React key warning) and NaN
// ranges/blank hints.
function normalizeSlider(s) {
  if (!s || s.id !== undefined) return s; // already UI-shaped (JS fallback)
  const min = s.from_ ?? 0;
  const max = s.to_ ?? 1;
  const span = max - min;
  const step = span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1;
  return {
    id: s.cv,
    label: s.label,
    leftHint: s.min_label ?? '',
    rightHint: s.max_label ?? '',
    hint: s.hint,
    min, max, step,
    def: min + span / 2,
    unit: '',
  };
}

function mergeCatalogs(canonical) {
  const styleById = Object.fromEntries(STYLE_CATALOG.map((c) => [c.id, c]));
  if (!canonical || canonical.length === 0) return STYLE_CATALOG;
  return canonical.map((c) => {
    const style = styleById[c.id];
    return {
      id: c.id,
      label: c.label || style?.label || c.id,
      description: c.description || style?.desc || style?.description || '',
      // Sliders: prefer Python's catalog when it ships them (normalized
      // from its cv/from_/to_ schema to the UI shape); fall back to the
      // JS-side defs so the slider UI lights up even before the canonical
      // Python catalog grows sliders.
      sliders: (c.sliders && c.sliders.length > 0)
        ? c.sliders.map(normalizeSlider)
        : (style?.sliders || []),
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
  // App-level footer busy setter — drives the AcceptBar's sliding progress
  // ribbon while the 9 channels recompute, so the (fast) calc has visible
  // feedback at the footer.
  onBusy,
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
  // Hydrate per-chapter assignments: read the `<stem>.characters.json`
  // sidecar first (durable authoring), and only fall back to the seed when
  // the sidecar is empty/missing. Once loaded into the App-level cache for
  // this path we never re-read (the cache is the working copy).
  const loadingPathsRef = useRef(new Set());
  useEffect(() => {
    if (!path) return;
    // Already have REAL assignments cached → done. Critically, an empty `{}`
    // must NOT count as "have it" (it would permanently block seeding), so we
    // test key count, not truthiness.
    const cached = charactersByPath[path];
    if (cached && Object.keys(cached).length > 0) return;
    if (chapters.length === 0) return;  // wait for chapters before seeding
    // Guard against re-firing the async read while it's already in flight.
    if (loadingPathsRef.current.has(path)) return;
    loadingPathsRef.current.add(path);
    let cancelled = false;
    const done = () => loadingPathsRef.current.delete(path);
    // No saved assignments → seed the journey-arc defaults across ALL chapters
    // AND persist them to <stem>.characters.json so Export/generation read the
    // same defaults the user sees (they were in-memory only before).
    const seedAndSave = () => {
      if (cancelled) return;
      const seeded = seedCharacterAssignments(chapters);
      if (Object.keys(seeded).length === 0) return;
      setCharactersByPath((prev) => (
        prev[path] && Object.keys(prev[path]).length > 0 ? prev : { ...prev, [path]: seeded }
      ));
      saveCharacters(path, seeded).catch(() => {});  // idempotent
    };
    readCharacters(path)
      .then((res) => {
        done();
        if (cancelled) return;
        const disk = res?.characters;
        if (disk && Object.keys(disk).length > 0) {
          // Backfill old sidecars: entries predating the mechStyle seed (or a
          // missing character/params) get the journey-arc defaults filled in —
          // user-chosen values are never overwritten. Write through only when
          // something was actually filled.
          const { map, changed } = backfillCharacterAssignments(disk, chapters);
          setCharactersByPath((prev) => (
            prev[path] && Object.keys(prev[path]).length > 0 ? prev : { ...prev, [path]: map }
          ));
          if (changed) saveCharacters(path, map).catch(() => {});
        } else {
          seedAndSave();
        }
      })
      .catch(() => { done(); seedAndSave(); });
    return () => { cancelled = true; };
  }, [path, chapters, charactersByPath, setCharactersByPath]);

  const setApplied = (updater) => {
    if (!path) return;
    setCharactersByPath((prev) => {
      const current = prev[path] || {};
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [path]: next };
    });
  };

  // Commit a full per-chapter assignment map AND write it through to the
  // `<stem>.characters.json` sidecar (no Accept-to-save step — durable on
  // every mutation, mirroring the Events feel.yml write-through). Export
  // reads this sidecar to run the real channel generation.
  const commitApplied = (nextMap) => {
    setApplied(nextMap);
    if (path) saveCharacters(path, nextMap).catch(() => {});
  };

  const [activeChapterId, setActiveChapterId] = useState(() => chapters[0]?.id ?? null);
  useEffect(() => {
    // Pick the first chapter on project change — and RECOVER when chapters
    // arrive after mount (analyze finishes after Channels is already shown):
    // if the active id isn't among the loaded chapters, fall to the first.
    // Without this, activeChapterId stuck at null → no active chapter → the
    // seeded character/mechanical defaults never render.
    setActiveChapterId((prev) => (
      prev && chapters.some((c) => c.id === prev) ? prev : (chapters[0]?.id ?? null)
    ));
  }, [path, chapters]);  // eslint-disable-line react-hooks/exhaustive-deps
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
    // Preserve any sibling slice (e.g. the Mechanical mechStyle) on this
    // chapter — Accept commits the character, not the whole entry.
    const prevEntry = applied?.[activeChapterId] || {};
    commitApplied({
      ...(applied || {}),
      [activeChapterId]: {
        ...prevEntry,
        characterId: staged.characterId,
        params: { ...staged.params },
      },
    });
    const i = chapters.findIndex((c) => c.id === activeChapterId);
    if (i >= 0 && i < chapters.length - 1) {
      setActiveChapterId(chapters[i + 1].id);
    }
  };

  // ── Editor mode — which channel editor is on the strip below the
  // viewer. Character = the stim sensation gestalt (cards + sliders);
  // Mechanical = the multi-axis position style; Body = haptic regions
  // (coming soon). The chapter scope is shared across all of them.
  const [editorMode, setEditorMode] = useState('character');

  // Mechanical: per-chapter position style, written through to applied
  // immediately on pick (no Accept step — mirrors the Events write-through
  // the user preferred). Rides in the same per-chapter applied object as
  // the character, so it persists the same way.
  // Mechanical: per-chapter position style, STAGED then committed on Accept
  // (mirrors Character's accept-and-advance). The axis diagram + strip count
  // track the staged pick; the chapter-list chip and export read the
  // committed value.
  const appliedMechStyle = appliedForActive?.mechStyle ?? DEFAULT_STYLE;
  const [stagedMechStyle, setStagedMechStyle] = useState(appliedMechStyle);
  useEffect(() => {
    setStagedMechStyle(appliedForActive?.mechStyle ?? DEFAULT_STYLE);
  }, [activeChapterId, appliedForActive?.mechStyle]);
  const mechDirty = stagedMechStyle !== appliedMechStyle;
  const acceptMech = () => {
    if (!activeChapterId) return;
    const prevEntry = applied?.[activeChapterId] || {};
    commitApplied({
      ...(applied || {}),
      [activeChapterId]: { ...prevEntry, mechStyle: stagedMechStyle },
    });
    const i = chapters.findIndex((c) => c.id === activeChapterId);
    if (i >= 0 && i < chapters.length - 1) setActiveChapterId(chapters[i + 1].id);
  };
  const resetMech = () => setStagedMechStyle(appliedMechStyle);
  const mechAxisCount = activeAxes(stagedMechStyle).length;

  // ── Passages — span-relative intensity arcs over the chapter run. Loaded
  // from `<stem>.passages.json` and written through on every edit (no Accept,
  // mirroring the Events feel.yml pattern). Export bakes them into e-stim
  // volume + multi-axis amplitude. (See project_passage_arcs_cross_modality.)
  const [passages, setPassages] = useState([]);
  // Bumped AFTER a passages write lands on disk, so the 9-channel recompute
  // (which reads passages from disk via stim-process / multiaxis-process)
  // re-runs against fresh data — picking a preset reshapes the volume/motion
  // drawing live, with no read-stale-then-redraw race.
  const [passagesNonce, setPassagesNonce] = useState(0);
  useEffect(() => {
    if (!path) { setPassages([]); return undefined; }
    let cancelled = false;
    readPassages(path)
      .then((res) => { if (!cancelled) { setPassages(res?.passages || []); setPassagesNonce((k) => k + 1); } })
      .catch(() => { if (!cancelled) setPassages([]); });
    return () => { cancelled = true; };
  }, [path]);
  // Debounce the disk write so a slider drag doesn't fire (and race) a write
  // per tick. State updates instantly (the arc/ribbon redraw live); only the
  // trailing value persists, then the nonce bump re-runs the channel preview.
  const passagesSaveTimer = useRef(null);
  const commitPassages = (next) => {
    setPassages(next);
    if (!path) { setPassagesNonce((k) => k + 1); return; }
    if (passagesSaveTimer.current) clearTimeout(passagesSaveTimer.current);
    passagesSaveTimer.current = setTimeout(() => {
      savePassages(path, next)
        .then(() => setPassagesNonce((k) => k + 1))
        .catch(() => {});
    }, 180);
  };
  // Index of the chapter being edited, and how (if at all) the active passage
  // shapes it — drives the provenance badge, the ribbon "you-are-here" marker,
  // and the per-channel ×factor tag, so the passage→volume link is legible.
  const activeChapterIdx = useMemo(
    () => chapters.findIndex((c) => c.id === activeChapterId),
    [chapters, activeChapterId],
  );

  // The journey-arc default for THIS chapter's position — what the auto-seed
  // would assign. Exposed as an explicit "Use default" button under each grid
  // so the user can snap a chapter (or one whose sidecar saved blank) back to
  // the recommended character / mechanical style without hunting for it.
  const safeIdx = Math.max(0, activeChapterIdx);
  const n = chapters.length;
  const defaultCharId = n ? characterForPosition(safeIdx, n) : null;
  const defaultMechId = n ? mechStyleForPosition(safeIdx, n) : DEFAULT_STYLE;
  const defaultCharLabel = defaultCharId ? (findChar(defaultCharId)?.label ?? null) : null;
  const useDefaultCharacter = () => { if (defaultCharId) setStagedCharacter(defaultCharId); };
  const useDefaultMech = () => setStagedMechStyle(defaultMechId);
  const passageInfo = useMemo(
    () => passageInfoForChapter(passages, chapters, activeChapterIdx),
    [passages, chapters, activeChapterIdx],
  );
  // Human label for the active arc: the matched preset's name, else the shape.
  const passageName = useMemo(() => {
    if (!passageInfo) return null;
    const presetId = activePassagePreset(passages);
    const preset = presetId && PASSAGE_PRESETS.find((p) => p.id === presetId);
    if (preset) return preset.label;
    const sh = PASSAGE_SHAPES.find((s) => s.id === passageInfo.shape);
    return sh ? sh.label : passageInfo.shape;
  }, [passageInfo, passages]);

  // ── Real per-chapter channel draw (all 9, live) ───────────────────
  // Generate the full 3-phase channel set for the active chapter's
  // character via the funscript-tools pipeline (the proven Streamlit
  // path) over just this chapter's window. Measured: ~0.7s per chapter
  // vs ~60s for a 67-min script — at chapter scope the full 9 channels
  // cost the same as 2D, so we draw them all live (the 2D/3-phase split
  // was a whole-script Streamlit holdover). Short slice → fast is the
  // whole reason long scripts became chapters. Debounced; latest wins.
  const [channelData, setChannelData] = useState(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  // Drive the preview off the STAGED character + sliders (what the user is
  // actively editing), NOT the committed `applied` — so moving a slider or
  // switching the card updates the chart live, before Accept. staged resets
  // to applied on chapter switch, so the chart shows the committed state
  // first and then tracks edits.
  const stagedParamsKey = JSON.stringify(staged.params || {});
  useEffect(() => {
    setChannelData(null);
    if (editorMode !== 'character' || !path || !activeChapter || !stagedChar) {
      setChannelsLoading(false);
      return undefined;
    }
    let cancelled = false;
    let startedBusy = false;
    setChannelsLoading(true);
    const timer = setTimeout(() => {
      // Run the footer ribbon while the real compute is in-flight (after the
      // debounce) — not during the 250ms settle, so a slider drag doesn't
      // strobe it. Cleared in finally (or by cleanup if a newer run supersedes
      // this one). startedBusy gates the cleanup so we only ever clear what we set.
      startedBusy = true;
      onBusy?.({ message: 'Calculating the 9 channels…' });
      stimProcess(path, {
        character: stagedChar.label,
        sliders: staged.params || {},
        mode: '3phase',
        startMs: activeChapter.atMs,
        endMs: activeChapter.endMs,
      })
        .then((res) => { if (!cancelled) setChannelData(res?.channels || {}); })
        .catch(() => { if (!cancelled) setChannelData({}); })
        .finally(() => {
          if (cancelled) return;
          setChannelsLoading(false);
          onBusy?.(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (startedBusy) onBusy?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, activeChapterId, stagedChar?.id, editorMode, stagedParamsKey, passagesNonce]);

  // ── Real per-chapter Mechanical draw ──────────────────────────────
  // Generate the secondary-axis funscripts (twist/roll/pitch/surge/sway)
  // for the staged style over the active chapter window. The engine is
  // pure-Python deterministic + sub-ms, so this is effectively instant.
  const [axisData, setAxisData] = useState(null);
  const [axisLoading, setAxisLoading] = useState(false);
  useEffect(() => {
    setAxisData(null);
    if (editorMode !== 'mechanical' || !path || !activeChapter
        || !stagedMechStyle || stagedMechStyle === DEFAULT_STYLE) {
      setAxisLoading(false);
      return undefined;
    }
    let cancelled = false;
    setAxisLoading(true);
    const timer = setTimeout(() => {
      multiaxisProcess(path, {
        style: stagedMechStyle,
        startMs: activeChapter.atMs,
        endMs: activeChapter.endMs,
      })
        .then((res) => { if (!cancelled) setAxisData(res?.axes || {}); })
        .catch(() => { if (!cancelled) setAxisData({}); })
        .finally(() => { setAxisLoading(false); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, activeChapterId, stagedMechStyle, editorMode, passagesNonce]);

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
      <Header mode={editorMode} character={appliedChar} mechStyle={stagedMechStyle} mechAxisCount={mechAxisCount} />

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
                waveform={audioWaveform}
                spectrogram={trackSpectrogram}
                beats={trackBeats}
                fill
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

      {/* Persistent passage-arc lane — the scene-scale "how much" arc, always
          visible between the viewer and the per-channel editors. Presets +
          Adjust (4 sliders) + Per-span (inline multi-arc editor) all live here;
          Passages is no longer a strip tab. */}
      {chapters.length > 0 && (
        <PassageArcLane
          chapters={chapters}
          passages={passages}
          activeIdx={activeChapterIdx}
          info={passageInfo}
          passageName={passageName}
          onPick={(id) => commitPassages(passagesForPreset(id, chapters.length))}
          onArcChange={(arc) => commitPassages(passagesFromArc(arc, chapters.length))}
        />
      )}

      {/* Editor strip — picks which channel editor runs below. The
          chapter selected above is the shared scope for all of them. */}
      <EditorStrip
        mode={editorMode}
        onMode={setEditorMode}
        characterLabel={appliedChar?.label || (isNothingApplied ? NOTHING.label : null)}
        mechCount={mechAxisCount}
        passageCount={passages.length}
      />

      <div
        style={{
          display: 'grid',
          // Chapter rail is a compact fixed width — it only needs room for the
          // color bar + ch# + m:ss range (user nit: it was eating ~40% of the
          // row in empty space). Narrowing it pulls the editor + the nine
          // channels left, closer to where the chapter is picked.
          gridTemplateColumns: '216px minmax(420px, 1fr)',
          gap: 16, marginTop: 8, alignItems: 'start',
        }}
      >
        <ChapterList
          chapters={chapters}
          applied={applied}
          catalog={catalog}
          activeId={activeChapterId}
          onSelect={setActiveChapterId}
        />

        {editorMode === 'mechanical' ? (
          <MechanicalPanel
            styleId={stagedMechStyle}
            onSelectStyle={setStagedMechStyle}
            axisData={axisData}
            loading={axisLoading}
            chapter={activeChapter}
            dirty={mechDirty}
            isLastChapter={chapters.findIndex((c) => c.id === activeChapterId) >= chapters.length - 1}
            onAccept={acceptMech}
            onReset={resetMech}
            onUseDefault={useDefaultMech}
            defaultStyleId={defaultMechId}
          />
        ) : (
          // Right column: the character selection, with the 9-channel preview
          // tucked DIRECTLY UNDER it. It used to render as a detached
          // full-width section at the very bottom of the tab (below the chapter
          // list too); grouping it under the cards keeps "pick a character →
          // here's the 9 channels it produces" in one visual unit.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <CharacterPanel
              catalog={catalog}
              stagedChar={stagedChar}
              isNothingStaged={isNothingStaged}
              stagedParams={staged.params}
              onSelectCharacter={setStagedCharacter}
              onParamChange={setStagedParam}
              onAccept={acceptChange}
              onReset={resetStaged}
              onUseDefault={useDefaultCharacter}
              defaultLabel={defaultCharLabel}
              dirty={dirty}
              isLastChapter={chapters.findIndex((c) => c.id === activeChapterId) >= chapters.length - 1}
              estimSelected={estimSelected}
              catalogWarning={catalogWarning}
            />
            {editorMode === 'character' && (
              <ChannelGrid
                character={appliedChar}
                estimSelected={estimSelected}
                channelData={channelData}
                loading={channelsLoading}
                chapter={activeChapter}
                passageFactor={passageInfo?.factor ?? null}
                passageName={passageName}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// PassageArcLane — the persistent, preset-driven "how much" arc row.
// Sits between the viewer and the per-channel editors so the scene-scale
// arc is always visible (the user asked for Passages as a ROW with
// presets, not buried in a strip tab). Preset pills set ONE full-run arc
// that steers e-stim / mechanical / body together; the chapter-aligned
// EnvelopeRibbon (same component the full editor uses) previews it under
// the chapters. "Fine-tune" jumps to the full Passages editor for
// per-span Build/Release/Swell shaping.
// ──────────────────────────────────────────────────────────────
function PassageArcLane({ chapters, passages, activeIdx, info, passageName, onPick, onArcChange }) {
  const activeId = activePassagePreset(passages);
  const ACCENT = '#ff8c42';
  const fmt = (v) => `×${(v ?? 1).toFixed(2)}`;
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Live arc params (the four sliders edit ONE full-span passage). Reads back
  // from the current passages, so a preset click repositions the sliders too.
  const arc = arcFromPassages(passages);
  const setArc = (patch) => onArcChange?.({ ...arc, ...patch });
  // Provenance line: what shapes THIS chapter, by how much, and where it's
  // headed — so the volume drawing below is never an unexplained number.
  let provenance = null;
  if (info) {
    const here = `${fmt(info.factor)} at Ch ${activeIdx + 1}`;
    let trend = '';
    if (info.shape === 'build') trend = `, rising to ${fmt(info.ceiling)} by Ch ${info.endIdx + 1}`;
    else if (info.shape === 'release') trend = `, easing to ${fmt(info.floor)} by Ch ${info.endIdx + 1}`;
    else if (info.shape === 'sustain') trend = ' (held across the run)';
    else if (info.shape === 'swell') trend = ` (peaks mid-run, eases by Ch ${info.endIdx + 1})`;
    provenance = (
      <span>
        Volume &amp; motion here follow the <strong style={{ color: ACCENT }}>{passageName}</strong> arc — <span className="mono">{here}</span>{trend}.
      </span>
    );
  }
  return (
    <div style={{
      marginTop: 12,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: ACCENT,
        }}>
          Intensity arc
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
          overall direction · e-stim · mechanical · body
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {PASSAGE_PRESETS.map((pr) => {
            const active = pr.id === activeId;
            return (
              <button
                key={pr.id}
                onClick={() => onPick(pr.id)}
                title={pr.hint}
                style={{
                  fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                  padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                  background: active ? ACCENT : 'var(--surface-2)',
                  border: `1px solid ${ACCENT}`,
                  color: active ? '#0e1117' : ACCENT,
                }}
              >
                {pr.label}
              </button>
            );
          })}
          <button
            onClick={() => setAdjustOpen((v) => !v)}
            title="Shape the arc by hand — start depth, peak, and where it rises/falls"
            style={{
              fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
              padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              background: adjustOpen ? ACCENT : 'transparent',
              border: `1px solid ${adjustOpen ? ACCENT : 'var(--border)'}`,
              color: adjustOpen ? '#0e1117' : 'var(--text-dim)',
            }}
          >
            Adjust {adjustOpen ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* Four-slider arc editor — start depth, peak, and where it rises / falls.
          Edits ONE full-span passage; presets just preset these four. */}
      {adjustOpen && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px 16px',
          padding: '8px 14px 10px', borderTop: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}>
          <ArcSlider label="Start depth" hint="where the arc begins" compact
                     value={arc.floor} accent={ACCENT}
                     onChange={(v) => setArc({ floor: v, ceiling: Math.max(v, arc.ceiling) })} />
          <ArcSlider label="Peak" hint="how high it reaches" compact
                     value={arc.ceiling} accent={ACCENT}
                     onChange={(v) => setArc({ ceiling: v, floor: Math.min(v, arc.floor) })} />
          <ArcSlider label="Rise point" hint="where it finishes climbing" compact
                     value={arc.risePoint} accent={ACCENT}
                     onChange={(v) => setArc({ risePoint: v, fallPoint: Math.max(v, arc.fallPoint) })} />
          <ArcSlider label="Fall point" hint="where it starts easing down" compact
                     value={arc.fallPoint} accent={ACCENT}
                     onChange={(v) => setArc({ fallPoint: v, risePoint: Math.min(v, arc.risePoint) })} />
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)' }}>
        <EnvelopeRibbon chapters={chapters} passages={passages} height={52} activeIdx={activeIdx} />
      </div>
      {/* Provenance note — names where the active chapter's intensity comes
          from, so the per-channel volume drawing is self-explaining. When no
          passage covers this chapter, say so plainly (the volume is the
          character's own level). */}
      <div style={{
        padding: '6px 12px', borderTop: '1px solid var(--border)',
        fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.45,
      }}>
        {provenance || (
          <span>No arc over Ch {activeIdx + 1} — volume here is the character's own level (×1.00). Pick a preset to shape it.</span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// EditorStrip — the under-viewer toggle that picks which channel
// editor runs. Character shows the chosen character's NAME (it's one
// pick per chapter, computed downstream into the e-stim gestalt);
// Mechanical shows an active-axis COUNT (it's authored routing). A
// hairline divider sets Body — the future anatomy editor — apart. The
// intent line restates what the active editor authors. (See
// project_channels_character_merge memory for the why.)
// ──────────────────────────────────────────────────────────────
function EditorStrip({ mode, onMode, characterLabel, mechCount, passageCount }) {
  // Passages is NOT a strip tab anymore — it lives entirely in the persistent
  // arc lane above (presets + Adjust sliders + Per-span). The strip is just the
  // per-chapter "what" editors. (user 2026-06-15: "we don't need a passages
  // button anymore … sliders along the top to control stuff".)
  const items = [
    { id: 'character', label: 'Character', meta: characterLabel || '—' },
    {
      id: 'mechanical', label: 'Mechanical',
      meta: mechCount === 0 ? 'stroke only' : `${mechCount} ax${mechCount === 1 ? 'is' : 'es'}`,
    },
    { id: 'body', label: 'Body', meta: 'soon', disabled: true },
  ];
  const intent = mode === 'character'
    ? 'Sensation — how the e-stim feels'
    : mode === 'mechanical'
      ? 'Geometric — the toy moves in these directions'
      : mode === 'passages'
        ? 'Dynamic — how intensity rises and falls over the scene'
        : 'Anatomical — which body regions fire';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
      <div style={{
        display: 'inline-flex', gap: 4, padding: 4,
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
      }}>
        {items.map((it) => {
          const active = it.id === mode;
          return (
            <Fragment key={it.id}>
              {it.id === 'body' && (
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '2px 2px' }} />
              )}
              <button
                disabled={it.disabled}
                onClick={() => { if (!it.disabled) onMode(it.id); }}
                title={it.disabled ? 'Coming soon' : undefined}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', borderRadius: 7,
                  border: `1px solid ${active ? '#ff8c42' : 'transparent'}`,
                  background: active ? 'rgba(255,140,66,0.12)' : 'transparent',
                  color: it.disabled ? 'var(--text-dim)' : 'var(--text)',
                  cursor: it.disabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: it.disabled ? 0.55 : 1,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600 }}>{it.label}</span>
                <span className="mono" style={{
                  fontSize: 9.5, color: 'var(--text-dim)',
                  padding: '1px 6px', borderRadius: 999, background: 'var(--surface)',
                }}>{it.meta}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
      <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
        {intent}
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────
function Header({ mode, character, mechStyle, mechAxisCount }) {
  const isMech = mode === 'mechanical';
  const isPassages = mode === 'passages';
  const eyebrow = isPassages
    ? 'Channels · Passages — intensity over scene-scale spans'
    : isMech
      ? 'Channels · Mechanical — per-chapter motion'
      : 'Channels · Character — per-chapter sensation feel';
  const title = isPassages
    ? 'Shape how intensity rises and falls'
    : isMech ? 'Pick a motion style per chapter' : 'Pick a character per chapter';
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
          {eyebrow}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
          {title}
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4,
          maxWidth: 720, lineHeight: 1.45,
        }}>
          {isPassages ? (
            <>
              <strong>Passages</strong> lay a slow intensity arc over a run of chapters — the
              scene-scale rise and fall a single 3–5&nbsp;min chapter is too short to carry. Pick a
              shape (Build, Sustain, Release, Swell) and the range it travels; the envelope bakes
              into the e-stim volume and the multi-axis amplitude at export. Per-chapter Character
              and Mechanical say <em>what</em>; a passage says <em>how much</em>.
            </>
          ) : isMech ? (
            <>
              <strong>Mechanical</strong> drives a multi-axis toy — each chapter's position style
              generates a separate funscript per axis (R0&nbsp;twist, R1&nbsp;roll, R2&nbsp;pitch,
              L1&nbsp;surge, L2&nbsp;sway). They ride together in the .forge bundle so a multi-axis
              device plays the geometry while single-axis devices stay on the main stroke.
            </>
          ) : (
            <>
              <strong>Character</strong> shapes how the e-stim <em>feels</em> — each chapter's
              character produces a separate funscript per channel. E-stim resolves to 9 channels;
              the set rides together in the .forge bundle so the player picks what fits the connected
              device. Pick gentle, reactive, scene-builder, unpredictable, or balanced per chapter.
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {isMech
          ? (mechStyle && mechStyle !== 'None' && (
              <Pill tone="info" dot>{mechStyle} · {mechAxisCount} {mechAxisCount === 1 ? 'axis' : 'axes'}</Pill>
            ))
          : (!isPassages && character && <Pill tone="info" dot>{character.label}</Pill>)}
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
          const mechStyle = a?.mechStyle;
          const mechEdited = mechStyle && mechStyle !== 'None';
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
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                alignItems: 'flex-end', justifySelf: 'end',
              }}>
                {char && (
                  <Pill
                    tone="neutral"
                    style={{
                      background: char.color + '22',
                      color: char.color,
                      borderColor: char.color + '55',
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
                    }}
                  >
                    {NOTHING.label}
                  </Pill>
                )}
                {mechEdited && (
                  <span
                    title={`Mechanical: ${mechStyle}`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 9.5, fontWeight: 700, color: '#ff8c42',
                      background: 'rgba(255,140,66,0.12)',
                      border: '1px solid rgba(255,140,66,0.4)',
                      borderRadius: 999, padding: '1px 7px',
                    }}
                  >
                    <Icon name="refresh-cw" size={9} />
                    {mechStyle}
                  </span>
                )}
              </div>
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
  onSelectCharacter, onParamChange, onAccept, onReset, onUseDefault, defaultLabel,
  dirty, isLastChapter,
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
          onUseDefault={onUseDefault}
          defaultLabel={defaultLabel}
        />
      </div>
    </div>
  );
}

// Action row — "Use [Character] · next chapter" primary, Reset
// secondary, "unsaved changes" indicator. The Accept button is the
// commit-and-advance affordance the user asked for; it's enabled
// even when nothing is dirty so the user can power-walk through
// chapters where the seeded default already fits.
function ActionRow({ stagedChar, isNothingStaged, dirty, isLastChapter, onAccept, onReset, onUseDefault, defaultLabel }) {
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
      {onUseDefault && (
        <button
          onClick={onUseDefault}
          style={{
            padding: '6px 10px', fontSize: 11.5, fontWeight: 600,
            background: 'transparent', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 5,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
          title={defaultLabel
            ? `Use the recommended character for this chapter (${defaultLabel})`
            : 'Use the recommended character for this chapter'}
        >
          Use default{defaultLabel ? ` · ${defaultLabel}` : ''}
        </button>
      )}
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
// ChannelGrid — the output set this editor produces, as a grid of
// mini-previews (the "set of funscripts we end up with"). For Character
// that's the 9 e-stim channels, drawn LIVE per chapter from the real
// funscript-tools output (~0.7s/chapter — see the stimProcess effect).
// Same component will serve Mechanical's axis set later (set-driven).
// ──────────────────────────────────────────────────────────────

// Grid channel id → funscript-tools output suffix.
const _CHANNEL_SUFFIX = {
  alpha: 'alpha',
  beta: 'beta',
  pfreq: 'pulse_frequency',
  freq: 'frequency',
  volume: 'volume',
  prise: 'pulse_rise_time',
  aprost: 'alpha-prostate',
  bprost: 'beta-prostate',
  vprost: 'volume-prostate',
};

// Channels the passage envelope actually scales (intensity). Mirrors
// forge/passages.py::ESTIM_INTENSITY_CHANNELS so the ×factor tag only appears
// where the multiplier really applies (phase/freq channels pass through).
const _PASSAGE_SCALED_SUFFIXES = new Set(['volume', 'volume-prostate']);

function ChannelGrid({ character, estimSelected, channelData = null, loading = false, chapter = null, passageFactor = null, passageName = null }) {
  const liveCount = channelData
    ? Object.values(channelData).filter((c) => c?.actions?.length).length
    : 0;
  const rightLabel = loading
    ? 'generating…'
    : (liveCount > 0
      ? `${liveCount} channel${liveCount === 1 ? '' : 's'} live · this chapter`
      : 'static preview');
  return (
    <div style={{ marginTop: 18 }}>
      <SectionLabel
        right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{rightLabel}</span>}
      >
        9-channel preview
      </SectionLabel>
      <div style={{
        marginTop: 6,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        // Pin a moderate row height so cards don't stretch tall (which left the
        // waveform looking like ~1/4 of the cell). The chart flex-fills this.
        gridAutoRows: '128px',
        gap: 10,
      }}>
        {ESTIM_CHANNELS.map((ch) => {
          const accent = character ? character.color : ch.color;
          const data = channelData?.[_CHANNEL_SUFFIX[ch.id]];
          const live = !!(data?.actions?.length);
          // Show the passage multiplier only on the channels it actually scales,
          // and only when an arc is in effect (factor < ~1).
          const scaled = passageFactor != null && passageFactor < 0.995
            && _PASSAGE_SCALED_SUFFIXES.has(_CHANNEL_SUFFIX[ch.id]);
          return (
            <div key={ch.id} style={{
              background: 'var(--surface)',
              border: `1px solid ${live ? accent + '55' : 'var(--border)'}`,
              borderRadius: 8,
              padding: 12,
              display: 'flex', flexDirection: 'column', gap: 8,
              minHeight: 88,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 2, background: accent,
                }} />
                <span style={{ fontSize: 11.5, fontWeight: 600 }}>{ch.label}</span>
                {scaled && (
                  <span
                    className="mono"
                    title={`Scaled by the ${passageName || 'passage'} arc at this chapter`}
                    style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                      background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255',
                    }}
                  >
                    ×{passageFactor.toFixed(2)}
                  </span>
                )}
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                  {live ? 'live' : ch.id}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 64 }}>
                {live ? (
                  <Sparkline
                    actions={data.actions}
                    start={chapter?.atMs ?? data.actions[0].at}
                    end={chapter?.endMs ?? data.actions[data.actions.length - 1].at}
                    colorMode="velocity"
                    height="100%"
                    filled
                  />
                ) : (
                  <PlaceholderEnvelope color={accent} />
                )}
              </div>
            </div>
          );
        })}
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
