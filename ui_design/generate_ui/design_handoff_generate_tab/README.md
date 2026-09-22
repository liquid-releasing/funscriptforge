# Handoff: FunscriptForge — fresh app shell + Generate tab (two-lane axis-changer)

## Overview
A fresh, fully-navigable prototype of the FunscriptForge desktop app (Liquid Releasing),
plus a **new Generate tab** that lets a user author or regenerate a funscript by shaping
two draggable curves — **DEPTH** ("how deep") and **DENSITY** ("how busy") — over a shared
timeline. Sections authored here are the chapter substrate for the rest of the pipeline.

Two problems this design solves, per the design conversation:
1. **No page-to-page blocking.** Every tab is always clickable (a sample project is
   preloaded). A "Soft gate" mode is available but never hard-blocks.
2. **The old passages editor "didn't edit well."** It exposed intensity through dropdowns +
   a two-thumb slider. This replaces that with **directly draggable curves**.

## About the Design Files
The files in `src/` are **design references written in HTML/React-via-Babel** — a runnable
prototype showing intended look and behavior. They are **not** production code to copy
verbatim. The task is to **recreate these designs inside the real FunscriptForge codebase**
(the React + Tauri app at `ui/web/src`), using its existing components (`forgemoment`
primitives), tokens, and patterns. Where this prototype ships its own primitives
(`primitives.jsx`) or chart code (`charts.jsx`), prefer the equivalents already in the app.

The single-file `FunscriptForge App (standalone).html` is the same prototype bundled for
offline viewing — open it in any browser to interact with the real thing.

## Fidelity
**High-fidelity.** Final forge dark palette, typography, spacing, and interactions. The
funscript curve, heatmaps, waveform/spectrogram, and the two lanes are all live and
interactive. The **generated stroke data is a believable stand-in**, not real engine output —
see "Wiring to the real engine" below.

---

## Screens / Views

### App shell (all tabs)
- **TopBar** (height 52px, bg `--surface`, bottom border `--border`): flame logo chip
  (22×22, `--accent`, radius 5) + "FunscriptForge" + mono version. Then a divider and the
  open project's media icon + title + `duration · N acts`. Right side: environment pill,
  ghost "Open", primary "Export", gear (settings), help icons.
- **TabStrip** (height 42px tabs, horizontally scrollable): `Library · Project · Generate ·
  Analysis · Chapters · Phrases · Stanzas · Events · Channels · Polish · Export ┊ Catalog`.
  Active tab: text `--text`, 2px bottom border `--accent`. Generate tab is accented warm
  (`--accent-warm`) with a 6px dot to mark it new. A vertical separator precedes utility
  tabs (Catalog).
- **AcceptBar** (footer, shown on all tabs except Library/Catalog): summary text + "writes
  `<file>`" line + Reset + primary "Accept · chain to `<next>`" (warm "Write outputs" on
  Export). Encodes the pipeline chain Project→Generate→Analysis→…→Export.
- **StatusBar** (28px): synced dot, `scope:`, chain file, version. Mono 11px.

### Library
Card grid (`repeat(auto-fill, minmax(240px, 1fr))`, gap 16). A dashed "Drop a file" card +
one card per library entry: 116px hatched media thumb with media icon tinted by entry color,
duration chip, "no script yet" pill when `hasFunscript:false`; body has mono title + meta.

### Project (source hub)
- **Left rail (300px):** "Start a project" actions (Load sample / Open funscript / Import
  .forge / Browse library) + recent-projects list (40px media chip + title + mono meta;
  active item has 3px `--accent` left border).
- **Center:** title block (84px media chip + eyebrow + mono H2 + status pills); **Source
  media** section with a `Frames | Waveform | Spectrogram` segmented toggle; **Funscript**
  section (intensity heatmap strip + full `FunscriptChart`) OR a dashed "no funscript yet"
  empty state with a "Generate a funscript" CTA when the source is video-only; **Files in
  this project** list (media / source / chain / meta rows, disabled rows at 0.5 opacity).

### Generate (THE NEW TAB) — top-level layout
Header (eyebrow + H1 "Author the funscript") with a `Audio synth | Video motion | Imported`
source segmented control and a warm **Regenerate** button. Below: a **two-column** flex
(gap 20):

**Left column (312px, fixed):**
- **SourceCard** — "Source" pill + label, a 16:9 hatched media placeholder, a 40px waveform,
  helper copy ("lanes are seeded from this source… Regenerate reseeds").
- **DiagnosisPanel ("What to fix")** — reads the *live* generated script:
  - **Deciles** mini-histogram (10 bars; bar `i` = fraction of stroke positions in
    [`i*10`, `i*10+10`)).
  - **Dynamics** score bar 0–1 (warn <0.45, info 0.45–0.7, success ≥0.7) + numeric.
  - A headline message keyed to the score (centered-bell warning / decent / full-depth).
  - Three **FixCards** (each = icon chip + title + sub + arrow; turns green ✓ when satisfied):
    - **Fill the rails** → sets DEPTH lane to full strokes.
    - **Add an arc** → sets DENSITY lane to build → climax → comedown.
    - **Add a shaker track** → toggles a second axis lane under the funscript.

**Right column (flex):**
1. **Funscript editor** — "live result · N actions" label, intensity heatmap strip, the
   `FunscriptChart` (velocity-colored, draggable to pan, scroll to zoom, click to seek,
   white playhead), an optional **ShakerLane** (second axis, shown when shaker on), and a
   **Transport** (skip ∓5s, play/pause, stop, mono time `m:ss / m:ss`).
2. **Axis-changer · depth & density** — the `AxisChanger` widget (see below).
3. **Sections & passages** — a `SectionStrip` (one button per section, width ∝ duration,
   tinted by character color, selected = solid fill) + a "Selected section" card with
   Begin/End sliders (mapped to `m:ss`) and a character/feel chip picker.

### Analysis / Chapters / Phrases / Stanzas / Events / Channels / Polish / Export / Catalog
Faithful, navigable supporting tabs (see `tabs_rest.jsx`). They render read-only/secondary
views derived from the same sections + live actions. Lower priority than Generate for
implementation.

---

## The AxisChanger (most important component)
A docked widget (bg `--surface`, border `--border`, radius 8) containing **two stacked
lanes** that share one horizontal timeline; chapter ticks line up across both.

Each lane (`LaneEditor`):
- A curve defined by control points `[{ t: 0..1, v: 0..1 }]`. First point pinned at `t=0`,
  last at `t=1`; interior points movable in both t and v (clamped between neighbors ±0.01).
- **Interactions:** drag a handle (16px dot) up/down to change value, drag an interior
  handle sideways to move it in time; **double-click empty space** to add a handle;
  **double-click a handle** to remove it (min 2 points).
- Rendered as an SVG smooth path (Catmull-Rom→Bézier) with a gradient area fill, dashed
  gridlines at 0.5 and 1.0, chapter tick verticals, optional white playhead. Handles are
  DOM divs over the SVG for crisp hit targets. `padL=56` reserves room for the lane label.
- **Per-lane presets** (pill buttons that replace the control points):
  - DEPTH: Shallow tease / Full depth / Grow to rails.
  - DENSITY: Gentle build / Slow burn / Edge & release.
- **Curve sampling** (shared with the generator): `sampleCurve(points, t)` does piecewise
  smoothstep (`f*f*(3-2f)`) between control points — soft, no overshoot.

**Why two lanes:** they answer independent questions. A slow-burn can be full-depth but start
sparse (depth flat, density ramps); a tease can stay busy but start shallow (density flat,
depth ramps). One handle can't express both.

- **DEPTH** color `--accent` (#ff4b4b), label "DEPTH / how deep" → drives stroke amplitude.
- **DENSITY** color #4dabf7, label "DENSITY / how busy" → drives stroke tempo (BPM).

---

## Interactions & Behavior
- **Navigation:** tabs always clickable (free-roam). Soft-gate mode shows a lock hint on
  project-requiring tabs but still allows the click. Stored in `localStorage['ff_navmode']`.
- **Playback:** Transport play loop advances `playheadMs` via `requestAnimationFrame`, loops
  at the end; position persisted to `localStorage['ff_playhead']`.
- **Live regeneration:** editing either lane (or applying a fix/preset) recomputes the
  funscript with `buildFromLanes` and updates the editor, heatmap, and diagnosis immediately.
- **FunscriptChart:** drag = pan, wheel = zoom toward cursor (min window 2s), click (no drag)
  = seek. Line color = per-segment velocity through a blue→cyan→green→yellow→orange→red ramp.
- **Accept/chain:** the AcceptBar advances to the next pipeline tab and shows the chain file
  it "writes" (`<title>.<tab>.json`). In the prototype this only navigates.
- **Transitions:** `.fade-in` is a 0.22s translateY entrance. IMPORTANT: it does **not**
  animate opacity — opacity-from-0 entrances freeze invisible when the tab is backgrounded
  (the CSS-animation clock pauses). Keep entrance animations off the opacity channel, or
  guarantee the visible end-state without relying on the animation.

## State Management
Top-level state lives in `App` (`main.jsx`):
- `tab` (active tab id; default `'project'`)
- `project` (derived from a library entry via `projectFromEntry`)
- `sections` (array; see data model) — the chapter substrate
- `depth`, `density` (each `[{t,v}]` control-point arrays; defaults `FF.DEFAULT_DEPTH` /
  `FF.DEFAULT_DENSITY`)
- `source` (`'audio' | 'video' | 'import'`)
- `shaker` (bool), `playing` (bool), `playheadMs` (number, persisted)
- `navMode` (`'freeroam' | 'softgate'`, persisted), `settingsOpen`, `aboutOpen`
- `liveActions = useMemo(() => buildFromLanes(depth, density, duration), [depth, density, duration])`
  — the single source of truth for the rendered script; passed to every tab.

Opening a project resets lanes to defaults and clears playback.

## Data model
```
section = {
  id, label,                 // e.g. 's3', 'Rise'
  beginMs, endMs,            // section bounds in ms (these ARE chapter bounds)
  characterId,               // one of the characters below
  shape,                     // legacy passage shape — not used by the lane generator
  floor, ceiling,            // legacy envelope bounds
  startVal, endVal           // legacy per-section levels (used by old ArcEditor only)
}
lane point = { t: 0..1, v: 0..1 }   // normalized time, normalized value
action     = { at: ms, pos: 0..100 } // funscript action (output)
```
Characters (id → color, tagline) in `data.js`: `gentle` #4dabf7, `reactive` #ff5470,
`scene_builder` #3ed598, `unpredictable` #ffb547, `balanced` #c77dff, `scene_closer` #ff8e72.

## Wiring to the real engine (read this)
The prototype synthesizes strokes in `buildFromLanes(depth, density, duration)` in
`tabs_core.jsx`. Replace this with your real generator. The intended mapping (from the design
conversation) is:
- **DENSITY lane → `--density-arc`** (already wired end-to-end in your engine). Controls
  strokes-per-second / tempo. Prototype maps `bpm = 30 + density*168`.
- **DEPTH lane → `--center-trajectory`** (also in the engine). Controls how rail-to-rail the
  strokes are. Prototype maps `amplitude = 14 + depth*84`, centered ~50, narrowing jitter as
  depth rises.
Both lanes are backed by real flags — nothing here is speculative. The diagnosis classifier
(`diagnose(actions)` → deciles, dynamics, rails, coverage, avgDepth) is the implementable
half of the "what to fix" mockup and can run against real output.

Recommended build order (cheapest first): ship the **DENSITY lane only** (it's the
`--density-arc` you already have), then add the **DEPTH lane** (`--center-trajectory`).

---

## Design Tokens (from `ff.css`; marketing tokens are source of truth)
**Colors**
- bg `#0e1117` · surface `#1a1d27` · surface-2 `#12151e` · surface-3 `#232735`
- border `#2d3148` · border-strong `#3a3f5c`
- text `#fafafa` · text-muted `#9ba3c4` · text-soft `#b8bfd8` · text-dim `#6b7390`
- accent `#ff4b4b` · accent-2 `#ff7b7b` · accent-warm `#ff8c42`
- success `#3ed598` · warn `#ffb547` · danger `#ff5470` · info `#4dabf7`

**Radii** 4 / 6 / 8 / 10 / 12 px, pill 999
**Spacing** 4 / 8 / 12 / 16 / 24 / 32 px
**Shadows** elev-1 `0 2px 6px rgba(0,0,0,.4)` · elev-2 `0 6px 20px rgba(0,0,0,.4)` ·
elev-3 `0 12px 40px rgba(0,0,0,.55)` · glow-accent `0 0 0 3px rgba(255,75,75,.25)`
**Type** sans = Inter; mono = JetBrains Mono (mono uses tabular-nums). Eyebrow = 11px/700,
uppercase, 0.08em tracking, `--text-dim`.
**Velocity colormap** (FunscriptChart line): 0.00 #2A6FDB → 0.25 #22D3EE → 0.50 #3ED598 →
0.70 #FFE14D → 0.85 #FF8C42 → 1.00 #FF4B4B (linear-interpolated).
**Easing** standard `cubic-bezier(0.2,0,0,1)` · emph `cubic-bezier(0.3,0,0,1)`

## Assets
- Icons: **Lucide** (loaded via CDN in the prototype; the `Icon` primitive resolves icon
  nodes from `window.lucide`). Use your codebase's existing icon set.
- Fonts: Inter + JetBrains Mono (Google Fonts in the prototype).
- No raster image assets — media thumbnails are CSS hatch placeholders; replace with real
  video frames / waveform / spectrogram in the app.

## Files (in `src/`)
| File | Contains |
|---|---|
| `FunscriptForge App.html` | Entry; script load order; fonts + Lucide CDN |
| `ff.css` | Tokens + app-shell chrome (TopBar/TabStrip/AcceptBar/StatusBar) |
| `data.js` | Sample project, sections, characters, lane defaults, `fmtTime`, arc helpers |
| `primitives.jsx` | Icon, Button, Pill, TextInput, SectionLabel, Segmented, Slider, Empty |
| `charts.jsx` | **FunscriptChart**, Heatmap, Waveform, Spectrogram, ThumbStrip, velColor |
| `lanes.jsx` | **LaneEditor**, **AxisChanger**, `sampleCurve`, `LANE_PRESETS` |
| `arc_editor.jsx` | Legacy single-arc editor (superseded by lanes; kept for reference) |
| `shell.jsx` | TopBar, TabStrip, AcceptBar, StatusBar |
| `tabs_core.jsx` | Library, Project, **GenerateTab**, `buildFromLanes`, `diagnose`, Diagnosis |
| `tabs_rest.jsx` | Analysis, Chapters, Phrases/Stanzas, Events, Channels, Polish, Export, Catalog |
| `main.jsx` | `App` root: state, nav, play loop, settings/about, render |

> Load order matters: `data.js` (plain global) → `primitives` → `charts` → `arc_editor` →
> `lanes` → `shell` → `tabs_core` → `tabs_rest` → `main`. Each file attaches its exports to
> `window` (the prototype shares scope that way; in the real app use normal imports).
