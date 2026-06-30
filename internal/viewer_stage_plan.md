# Funscript Viewer — the last stage (#6) — PLAN

**Status:** Plan for review (2026-06-30). Part of the screech-safety work
([[screech_safety_architecture]]). The other 5 pieces are landed; this is the
remaining UI stage.

## TL;DR — FINALIZED DESIGN (2026-06-30)

**Build a lightweight native `ViewerTab`, NOT a forgeviewer port.** After reviewing
forgeviewer ("the real deal" — but more than we need), the decision is to **drop
script comparison entirely** and build a focused last stage that reuses FSF's
existing components, borrowing only forgeviewer's pure `stats.js`.

**It is an output-REVIEW surface, not a player-first tab.** The job: see the
generated output across the whole timeline so inconsistencies pop — e.g.
VictoriaOaks reads soft in the intro vs. the body, and today that's visible
*nowhere*. The design is a near-exact reuse of EventsTab's hero pattern
(`TrackStack` + side `MediaViewer`, synced by a shared baton), reconfigured for
review.

### Layout (three columns + a shared baton)
```
[ E-Stim ▾ ] [Handy] [OSR2] …   device picker · chapters strip · ⚠ screech note
┌──────────┬─────────────────────────────────────┬────────────────┐
│ STATS    │ CENTER — lane stack (FULL timeline)  │ VIEWER (right) │
│ whole-   │  audio                               │  video frame   │
│ device   │  spectro                             │  @ baton       │
│ summary  │  intensity arc  ← soft intro pops    │  mode toggle   │
│          │  ───────────────────────────────────│  + transport   │
│          │  all 9 e-stim channels, stacked      │                │
│          │            ┃ big baton across lanes  │  (synced)      │
└──────────┴─────────────────────────────────────┴────────────────┘
   one shared clock → center lanes + right viewer move together
```

- **Header = device selector** (reuse existing device-picker chrome). Pick a device
  → **all its funscripts** load as stacked lanes (E-Stim = 9; multiaxis OSR2/SR6 =
  pitch/roll/surge/…; Handy/Lovense = 1). No comparison.
- **Center = `TrackStack`**, **default to the FULL timeline** (all chapters at once —
  a soft intro only shows when intro + body are on screen together; chapters as tint
  bands, zoom optional). Lanes, top→bottom: `audio`, `spectro`, **`intensity` arc**,
  then **all 9 e-stim channels** (velocity-coloured), compact ~40px DAW-style. A
  **big baton** (the `getLiveMs` line) sweeps across all lanes.
- **Right = `MediaViewer`** showing the **video frame at the baton** (mode toggle
  Video/Audio/Spectro/Funscript, transport). Same shared clock as the lanes — park
  the baton on a soft spot and *see the source moment*. This is what makes it a
  review tool.
- **Left = whole-device stats summary** (port forgeviewer's pure `stats.js`):
  liveliness + density + usable-range + velocity + stroke, aggregated for the
  selected device's output. No deltas/baseline (those were comparison).
- **Intensity arc** = a headline summary band (overall e-stim energy/envelope over
  time, per-chapter or derived) so soft-vs-hot stretches pop at a glance — the
  detail lives in the 9 lanes below.
- **Screech** = a quiet **note/badge** (ruler tick + one-liner from
  `<stem>.screech.json`), NOT an emphasised lane. It's rare; don't let it dominate.

### Resolved decisions (2026-06-30, second pass)
- **Show ALL channels** for the selected device (E-Stim = all 9), not volume+dropdown.
- **Full-timeline default** (not chapter-scoped) — consistency review needs the macro view.
- **Keep a playhead + right-panel viewer + big baton** across the lanes (reuse
  EventsTab's `TrackStack`+`MediaViewer` baton sync).
- **Intensity-arc headline strip:** YES.
- **Stats panel:** whole-device summary.
- **Thumbnails lane:** deferred.
- **Screech:** demoted to a note, not a lane.
- **No compare / overlay / divergence / `.forge`-save.**

### What we borrow from forgeviewer
Only `stats.js` (pure functions) and token/visual cues. Everything else is native
FSF (`TrackStack`, `MediaViewer`, device-picker header, tab shell).

## What forgeviewer already is

Three panels + chrome (read from the source):
- **Left — `ScriptRail`**: loaded items list (visibility, baseline, ±time-offset
  nudge, analyze, remove, source tags).
- **Center — `LaneStack`** (`Shell.jsx` + `LaneChart.jsx`): velocity-coloured
  position-vs-time curves stacked like DAW tracks, **one shared time axis**,
  `TimeRuler`, `Playhead`, hover scrub, chapter tint bands, **stacked OR overlay**,
  normalize, zoom-to-chapter.
- **Right — `StatInspector`** (`StatCards.jsx`): per-item stat cards (liveliness
  gauge, metric rows, deltas vs baseline, per-chapter dynamics sparkbars) + a
  `CompareTable`.
- **Bottom — `FVStatusBar`**; modals: `ForgeSaveModal`, `AddScriptModal` (real
  `.funscript` import parse), `TweaksPanel`, `FVToast`.
- **`stats.js`** — pure, unit-testable statistics engine. **`tokens.css`** already
  aligned with FunscriptForge (`--chart-v0..v6`, `--ch-1..7`, red accent).

## The reframe: compare-scripts → view-channels

forgeviewer compares N funscripts of the *same media*. Our last stage views the N
generated **e-stim channels** of *one project*. Same lane infrastructure — each
**channel** (`volume`, `frequency`, `alpha`, `beta`, `pulse_frequency`,
`volume-prostate`, …) becomes a **lane**. The ScriptRail lists channels; the
StatInspector shows per-channel stats; chapters/zoom/playhead all carry over
unchanged. The `{at,pos}` model is identical (channels already store 0..100).

## Screech markers (the point of this stage)

Driven by `<stem>.screech.json` (already written by `cap-stim`:
`source_screech_regions` + `generation_cap_regions`). Add a `<ScreechOverlay>` as a
sibling of `<Playhead>` in the lane-stack area — same `pct(ms) = ((ms-startMs)/span)
*100` projection, an absolute-positioned band per region:
- `source_screech` → amber (`--warn`), `co_rail` → red (`--danger`).
- Hover → tooltip: "screech tamed · volume 0.90→0.80 @ 1:21:02".
- Inspector summary card: "1 screech detected & tamed · 19 co-rail caps."

This is exactly the "tell the user we fixed a screech" surface from the
architecture decision — visual, on the timeline, at a glance.

## Port mechanics (straight from HANDOFF §7)

1. `.jsx` files are plain function components using `Object.assign(window, …)`
   exports → switch to ES `import`/`export`.
2. `Icon` reads `window.lucide` → `lucide-react`.
3. `data.js` sample generator → a real **channel loader** over the FSF bridge
   (read the generated channel funscripts + the `screech.json`).
4. `stats.js` is pure → reuse as-is; add a couple channel-aware metrics.
5. `tokens.css` → already FSF-aligned; merge into the app theme (don't rename
   `--chart-v*` / `--ch-*`).

## Build checklist (native ViewerTab)

1. **`stats.js`** — copy `forgeviewer/.../stats.js` into FSF (pure module); keep the
   single-script metrics (`liveliness`, density, `usableRange`, velocity, stroke);
   drop `dynamics`/divergence (comparison). Aggregate across the device's channels
   for the whole-device summary. Add a vitest.
2. **`ViewerTab.jsx`** (`ui/web/src/screens/`) — three columns: left whole-device
   stats · center `TrackStack` (full-timeline, all channels + audio/spectro/intensity)
   · right `MediaViewer`. Shared baton clock (`currentMs`/`getLiveMs`) wired between
   `TrackStack` and `MediaViewer` exactly as EventsTab does.
3. **`intensity` lane** — derive an envelope/energy band (overall e-stim intensity vs
   time; per-chapter or smoothed volume/velocity). Add as a `TrackStack` lane type or
   render in the stack. Makes soft-vs-hot legible.
4. **Channel loader** — get ALL of the selected device's funscripts (reuse
   `stim-process`/`list-outputs`/the `.output/<Device>/` files). E-Stim = 9 lanes.
5. **Screech NOTE** (not a lane) — read `<stem>.screech.json` via bridge
   (`readScreechJson` → `read_screech_json` → `screech-read`); render a ruler tick +
   a one-line badge ("1 screech tamed @ 1:21"). Low-key.
6. **Mount** — wire into App.jsx (below).

> Lanes count: audio + spectro + intensity + 9 channels = ~12. Use compact lane
> heights (~36–44px) and let the stack scroll. The center column is the star — give
> it the width; stats left ~240px, viewer right ~340px.

## Mount point in FunscriptForge (confirmed by recon)

New **"Viewer"** stage inserted **between Polish and Export**:
- `App.jsx:56–118` TABS — add `{ id: 'viewer', label: 'Viewer' }`.
- `App.jsx:911–921` TAB_CHAIN — `polish → viewer`, add `viewer → export`.
- `App.jsx:924` ANALYSIS_CONSUMER_TABS — add `'viewer'`.
- `App.jsx:1186–1340` render — `{tab === 'viewer' && <ViewerTab … />}`.
- Chapter-scoped like EventsTab (shares `activeChapterId`, `trackPeaks/
  Spectrogram/Beats`, footer chapter-nav registration).

### Bridge for the sidecar (confirmed by recon)
- `forge.js` — add `readScreechJson(funscriptPath)` (mirror `readFeelEvents`,
  forge.js:506).
- `commands.rs` — add `read_screech_json` → `run_cli(["screech-read", …])`
  (mirror the read_passages command).
- `cli.py` — add a tiny `screech-read` subcommand that returns the
  `<stem>.screech.json` (the writer `cap-stim` already exists).

## Bridge additions (forge.js + commands.rs + cli.py)

- Load the generated channel funscripts for a stem (reuse `stim-process` /
  `list-outputs`, or a small `viewer-load` that returns channels + sidecar).
- Read `<stem>.screech.json` (a generic `readJson`, or include it in `viewer-load`).

## Phasing

- **MVP (the ask):** ViewerTab — device/channel header selector + left stats list +
  `funscript`/`audio`/`spectro`/`screech` lanes + playhead, chapter-scoped.
  Read-only. One solid session.
- **Later (optional):** thumbnails lane; scrub synced to the Generate-tab
  MediaViewer; an opt-in "show original (pre-cap)" ghost curve so the user can see
  exactly what the screech fix removed (a light nod to compare, without the full
  apparatus).

## Decisions — all resolved (2026-06-30)

1. **No comparison** — single device/funscript at a time. ✓
2. **E-Stim channels** — default `volume` + channel dropdown. ✓
3. **Thumbnails** — deferred to a later pass. ✓
4. **Repo home** — native in `funscriptforge/ui/web` as the last stage. ✓
5. **Borrow** — only forgeviewer's `stats.js`; everything else native FSF. ✓
