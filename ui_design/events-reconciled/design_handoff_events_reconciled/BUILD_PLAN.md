# Events tab — build plan (reconciled)

How we turn the `events-reconciled` prototype into the real Events tab in
**FunscriptForge (Tauri + React 18 + Vite)**. This plan encodes the design
decisions locked with the user 2026-06-01 (see memory `project_events_design`),
which differ from the raw prototype in a few deliberate places — follow THIS
plan where it diverges from `README.md`.

## Principles
- **Reuse the chassis, don't rebuild.** The prototype's custom SVG charts +
  `window.RX_*` globals are reference only. Production uses the existing
  forgemoment `MediaViewer`, `FunscriptChart`, chapter scoping, the
  slice-viewer pattern, and our `.feel.yml` reader — same as Phrases/Stanzas.
- **Wire through `python cli.py` + `.feel.yml`**, never the prototype's mock
  data (`feedback_funscriptforge_not_streamlit_port`).
- **`.feel.yml` is the canonical middle file.** Edger yml is a *derived
  export* and an *import path*, not the live store.

## What already exists (reuse)
- `ui/web/src/screens/EventsTab.jsx` (767 lines) — the tab to rework, not
  greenfield. Existing "Events deep pass v1" (multi-track timeline +
  auto-suggested events) — keep what fits.
- forgemoment `MediaViewer` — prop-driven transport via `controls=[...]`
  array (today: prev/frame-back/back5/play/forward5/frame-forward/next).
- forgemoment `FunscriptChart` / `Charts.jsx` primitives.
- `ShapeGlyph` (✅ shipped slice a) — recipe/shape icon renderer.
- `.feel.yml` reader bits in `ui/web/src/api/` + the forge dir layout.

## Stages

### Stage 0 — Data + serialize (backend-first)
- Define the `.feel.yml` `events:` schema (spans + recipe + intensity +
  params + per-device overrides + compose mode). Each event device-agnostic;
  device packs expand at export.
- `cli.py`: read events from `.feel.yml`; read the recipe library projection
  (categories, recipes, `preview[]`, tunables, SFW/NSFW copy) the tab
  consumes read-only.
- Serialize working events → `.feel.yml events:`. Rust mirror if a new
  command is added (`feedback_rust_mirror_drift`).
- **Edger interop:** import (upload Edger yml → ingest into `.feel.yml`) +
  export (derive Edger yml at Export time). Map our richer fields → Edger's
  subset; drop-with-note what Edger can't represent.
- **In-place "Save edits"** (user decision 2026-06-02): the shared global
  `AcceptBar` primary is structurally "Accept **and chain** to <next tab>"
  (`onAccept` → `setTab(nextTab)`); Events needs a SECOND verb that persists
  WITHOUT advancing the chain, because it's an accumulation workflow (drop
  many events across chapters in one sitting). Add an optional
  `onSave`/`saveLabel` to forgemoment `AcceptBar` → render a secondary
  **Save edits** button beside Accept-and-chain; Events opts in. Note: even
  today's Accept doesn't write disk (chain pass deferred), so wire this only
  once `.feel.yml` serialize exists — then Save = write `events:` to the
  sidecar, stay on tab. Deferred here rather than a session-only stub.

### Stage 1 — Shared `TrackStack` (funscript + events lanes)  ⭐ the real new build
The hero chart is a NEW shared forgemoment component, **`TrackStack`** —
stacked, time-aligned lanes sharing one axis + playhead, each toggleable,
all **full-strength (NOT muted** — the muted-background idea is retired;
separate lanes don't compete). Reusable across Events/Phrases/Stanzas/
Chapters like `ShapeGlyph`. Complementary to the video monitor (which shows
these as one-at-a-time *modes*); TrackStack shows them *simultaneously*,
side by side with the player.

Build **shared, lane-by-lane**:
- **Stage 1a (here):** funscript lane (full-strength) + **events lane**
  (lane-packed colored recipe bands; category color; selected = white
  stroke; baseline = hollow/dashed). This is the one genuinely new piece.
- Later lanes (1b+): audio (peaks sidecar), spectro (spectrogram sidecar),
  thumbs (sampled chapter-clip frames) — each a small addition, all data
  already produced as sidecars (wiring, not analysis).
- **No zoom/pan to start.** Scoped to the slice selected by the CHAPTERS
  waveform (scope owner); reuse the slice-viewer scope object
  (`project_slice_viewer_pattern`). Phrases/Stanzas adopt the same stack
  minus the events lane.

### Stage 2 — Shared MediaViewer transport + speed (forgemoment)
- Extend `MediaViewer`'s `controls` token set:
  `chapter-start` (jump to scope.start), `back1`/`forward1` (±1s),
  keep `frame-back`/`frame-forward`, `chapter-end` (jump to scope.end).
  Events controls = `['chapter-start','frame-back','back1','play','forward1','frame-forward','chapter-end']`.
- Add an **optional speed bar** rendered directly under the transport, gated
  by a prop (e.g. `showSpeed`), values `0.25/0.5/1/2×` → drives
  `video.playbackRate`. **Events-only**; Phrases/Stanzas omit it.
- frame-step uses real fps when known; ~33 ms fallback for audio-only.
- Time-readout size = the shared component's (matches Phrases/Stanzas
  automatically — don't restyle bigger).

### Stage 3 — Effect Library + "Normal" default
- Cascading selector (device tabs → collapsible category groups → recipe
  rows). Each row: `ShapeGlyph(recipe.preview)` + name + desc.
- **Pin "Normal" above the groups + pre-arm it** (opt-out card pattern):
  the eraser/baseline so chained captures keep continuous coverage.
- Arming resets params/intensity to recipe defaults; auto-switch device if
  the recipe isn't on the current one. NEVER auto-pick on category change
  (`feedback_transform_selection_deliberate`).

### Stage 4 — Capture bar + Effect config + "what this produces"
- Capture bar (① mark begin/end from playhead; duration derived; Chain +
  Snap-to-beat; edit-mode flip when an event is selected).
- Effect config (③): intensity + per-recipe tunables + per-device override
  rows (`broadcast`/`override`). NSFW long-desc swap.
- **Update-5:** under **+ Add event**, a live read-only summary of what the
  event will actually produce in OUR terms (recipe + intensity + resolved
  params + per-device output). A sentence; optional expandable detail.
- Timeline list (by Act): rows show `ShapeGlyph` icon (update 6) + timestamp
  + recipe + device tags; out-of-scope dimmed.

### Stage 5 — Composite timeline + IO bar + polish
- Whole-script overview (read-only, all events overlaid; click seeks/selects;
  never changes scope). Taller side panels (update 4) once the hero chart is
  compact.
- IO bar: starter packs, Load Edger yml…, Preview events.yml, export.
- Undo/redo wrap on `events[]` mutations.

## Sequencing notes
- Stage 0 + Stage 2 are independent and can land first (backend + shared
  viewer). Stage 1 is the critical-path new build. Stages 3–5 are mostly
  wiring on top.
- Each stage is independently testable; commit per stage.

## Pre-beta — next pass (Events authoring loop SHIPPED + durable 2026-06-02)
The core loop is done and persists to `.feel.yml`: capture ① → library ②
(Normal pre-armed + glyphs) → config ③ (intensity · tunables ·
broadcast/override w/ per-device slider) → Add/Update → edit-mode + row
edit/trash. Bottom `EventsTimelineStrip` REMOVED (redundant w/ ChapterRibbon
scoping; whole-script overview to be rebuilt on TrackStack later). Remaining
for beta, in rough priority:
1. **Edger import/export** (Stage 0 interop) — derive Edger yml at Export;
   ingest uploaded Edger yml → `.feel.yml`. The only way to get events OUT.
2. **"What this produces" summary** (Update-5) — live read-only sentence under
   Add event: recipe + intensity + resolved params + per-device output.
3. **Undo/redo** on `events[]` mutations (delete is currently permanent).
4. **FooterBar IO** — wire the disabled stubs (Starter packs · Load Edger yml…
   · Preview events.yml) or hide until real.
5. **Stage 1b lanes** — audio / spectro / thumbs in the hero TrackStack
   (sidecars already exist; wiring not analysis).
6. **Stage 0b** — Accept stamps ffmeta (`accepted_tabs`/`edited_at`) + Reset
   restores from `.feel.yml`. Coupled to the deferred GLOBAL Reset semantics;
   NOT needed for durability (write-through already covers that).
7. **Whole-script event overview** — rebuild the removed strip on TrackStack
   (all events, click-to-seek/scope) once §5 lands. Stage 5 polish.
8. **pytest** for the `feel-write`/`feel-read` round-trip.

## Deferred / open
- Audio-waveform + thumbnail chart backgrounds (Stage 1 makes them swappable).
- Zoom/pan on the hero chart (explicitly out for v1).
- Sub-beat snap modifier (open in the prototype's DATA_FLOW).
