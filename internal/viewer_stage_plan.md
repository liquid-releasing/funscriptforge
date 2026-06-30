# Funscript Viewer — the last stage (#6) — PLAN

**Status:** Plan for review (2026-06-30). Part of the screech-safety work
([[screech_safety_architecture]]). The other 5 pieces are landed; this is the
remaining UI stage.

## TL;DR — FINALIZED DESIGN (2026-06-30)

**Build a lightweight native `ViewerTab`, NOT a forgeviewer port.** After reviewing
forgeviewer ("the real deal" — but more than we need), the decision is to **drop
script comparison entirely** and build a focused last stage that reuses FSF's
existing components, borrowing only forgeviewer's pure `stats.js`.

Shape:
- **Header = device/funscript selector** (reuse the existing device-picker chrome).
  Click a device → its funscript loads onto the lanes. **One device at a time — no
  comparison.** This replaces forgeviewer's entire ScriptRail / overlay / baseline /
  divergence apparatus (which only existed to juggle multiple scripts).
- **Center = `TrackStack` lanes** (forgemoment, already in-app): `funscript` +
  `audio` + `spectro` + a **new `screech` markers lane**. Proven pattern — EventsTab
  drives the same component.
- **Left = single-script stats list** — port forgeviewer's pure `stats.js`; render
  liveliness + density + usable-range + velocity + stroke. **Drop** deltas-vs-baseline
  and cross-script dynamics (comparison features); keep the absolute stats.
- **Screech** = the markers lane + one stat row ("1 screech tamed · 19 co-rail
  caps") from `<stem>.screech.json`.

### Resolved decisions
- **E-Stim (9 channels):** default to the **felt channel `volume`** (where the flash
  lives) with a **small channel dropdown** (frequency/alpha/beta/…). One lane at a
  time.
- **Thumbnails lane:** **deferred** — ship `funscript + audio + spectro + screech`
  first (all reuse existing wiring; TrackStack's `thumbs` lane isn't wired yet).
- **No compare, no overlay, no `.forge`-save modal, no divergence strip.**

### What we borrow from forgeviewer
Only `stats.js` (pure functions) and a few token/visual cues. Everything else is
native FSF (`TrackStack`, `MediaViewer`, the device-picker header, the tab shell).

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
   drop `dynamics`/divergence (need comparison). Add a vitest.
2. **`ViewerTab.jsx`** (`ui/web/src/screens/`) — header device/channel selector +
   left stats panel + center `TrackStack`. Chapter-scoped like EventsTab.
3. **`TrackStack` `screech` lane** (forgemoment) — add `'screech'` to the
   `activeLanes` filter + a render block (band per region; amber=source_screech,
   red=co_rail; hover tooltip). ~5–15 lines mirroring the events lane.
4. **Bridge** — `readScreechJson` (forge.js) → `read_screech_json` (commands.rs) →
   `screech-read` (cli.py) returning `<stem>.screech.json`.
5. **Channel loader** — reuse `stim-process`/`list-outputs` to get the device's
   funscript(s); for e-stim, default `volume` + dropdown.
6. **Mount** — wire into App.jsx (below).

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
