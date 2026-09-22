# Handoff: Events Tab — Reconciled

## Overview
The **Events tab** is where an author marks moments in a video/funscript and attaches **events** — time-spanned haptic "recipes" (Surge, Edge, Climax, Soften, …) that drive e‑stim / vibrator / bHaptics / shaker devices. This reconciled design merges the best parts of ~9 prior iterations into a single top‑to‑bottom layout. It resolves two specific problems from the previous build (`09-fixes-and-forge-streamer`):

1. **Video placement** — the monitor now sits in the top row beside the script chart (compact, reference‑sized), not orphaned.
2. **Chapter scoping** — the **CHAPTERS** waveform at the very top is the *single* scope control: picking a chapter re‑scopes the entire work area below it.

The authoring flow is deliberately **time → effect → tune**, marked with ①②③ badges in the UI:
- **① Mark begin/end** in the capture bar (from the playhead).
- **② Pick the effect** in the cascading Effect Library.
- **③ Tune** intensity / params / devices, then **Add event**.

## About the Design Files
The files in `source/` are a **design reference built in HTML + React (via in‑browser Babel)**. They are a high‑fidelity prototype of look and behavior — **not production code to ship as‑is**. The task is to **recreate this design in the target codebase's environment** (the project targets **Tauri + React 18 + Vite**, per the parent `ARCHITECTURE_ADDENDUM_2026_05.md`) using its established components, state, and data layer. Where this prototype uses `window.RX_*` globals and inline mock data, production should use real modules, the project's `.feel.yml` reader, and the recipe library service.

## Fidelity
**High‑fidelity.** Colors, typography, spacing, component states, and interactions are final‑intent. Recreate pixel‑accurately using the codebase's existing primitives. The SVG charts (spectrum, funscript line, mini previews) are *deterministic mocks* — replace the synthetic data generators with real analysis/funscript data, keeping the same visual treatment.

---

## Region map (annotated screenshots)
See `annotated/01-top.png` and `annotated/02-bottom.png` for the full layout with every region called out. The numbered regions:

| # | Region | Selector | Section below |
|---|---|---|---|
| A | Tab strip | `.rx-tabstrip` | §0 |
| 1 | CHAPTERS waveform (scope control) | `.rx-chapters` | §1 |
| 2 | Act title · NSFW · counts · Collapse | `.rx-titlerow` | §2 |
| 3 | Chapter‑aware script chart (hero) | `.rx-script` | §3 (ROW A left) |
| 4 | Media monitor (compact) | `.rx-mv` | §3 (ROW A right) |
| 5 | ① Capture bar — mark begin/end | `.rx-capbar` | §4 |
| 6 | ② Effect Library (cascading selector) | `.rx-lib` | §5 left |
| 7 | ③ Effect config (tune + Add event) | `.rx-cfg` | §5 middle |
| 8 | Timeline list (by Act) | `.rx-list` | §5 right |
| 9 | Composite funscript timeline (whole script) | `.rx-fun` | §6 |
| 10 | IO bar (packs / YAML / export) | `.rx-io` | §7 |

---

## Layout (top → bottom)

The whole tab is a vertical stack. Page background `--bg #0e1117`. Horizontal page padding is `22px`.

### 0. Tab strip
- Full‑width bar, `--surface` bg, bottom border `--border`.
- Left: anvil glyph + `FunscriptForge` (600) + `/` + monospace filename.
- Right: tab list (`Library Project Device Chapters Shapes Phrases Stanzas Events Characters Export Catalog`). Active tab (**Events**) has `--text` color + 2px `--accent` bottom border. Inactive `--text-muted`.

### 1. CHAPTERS waveform  *(scope control)*
- Row: 74px label gutter (`CHAPTERS`, 10px, letter‑spacing .14em, `--text-dim`) + a full‑width waveform panel (`--surface-2`, 1px `--border`, radius `--r-3`, **height 66px**).
- The waveform is an SVG of per‑stanza vertical bars colored by an energy→velocity gradient (see Design Tokens → chart gradient). Quiet stanzas render `#3a4a64` at lower opacity.
- Chapter boundaries drawn as 2px `--bg` dividers. Each chapter overlaid with a label (`ch1`…) at top‑left; the **selected** chapter gets an inset 2px `--accent` outline.
- A 2px `--accent` vertical **playhead** tracks current time.
- **Interaction:** clicking seeks to that time **and** sets scope to the clicked chapter.

### 2. Title row
- `● {Chapter color dot}` + `Act 2 — Rising` (h2, 22/700) + monospace meta: `03:00–06:00 · {n} stanzas · beat 92 bpm`.
- Right side: **NSFW descriptions** pill toggle (checkbox box + label; ON → `--accent-warm` fill/border), then two count pills: `● {72} total` and `{32} in scope` (monospace, pill border).

### 3. ROW A — chart + monitor  `grid-template-columns: minmax(0,1fr) 340px; gap 14px`
**Left — "Chapter‑aware script" chart (hero).** Panel, header row: `CHAPTER‑AWARE SCRIPT` label + hint `click to seek · click a stanza to focus` + right‑aligned **track toggles** (`Funscript / Audio / Spectro / Thumbs`; ON = `--surface-3`). Canvas (`--surface-2`, radius `--r-3`) is an SVG, scoped to the selected chapter, laid out top→bottom:
  - **Left axis gutter** 30px with `0 / 50 / 100` labels + faint gridlines.
  - **Stanza label chips** (`S1`…`Sn`) — small rounded chips at top; selected chip is filled white with dark text.
  - **Stanza spectrum** (134px tall) — per stanza, a cluster of thin vertical bars whose height = stanza energy × intra‑stanza arch × noise, colored by the velocity gradient. Selected stanza shows a translucent white box + 1.5px white outline.
  - **Event‑lane band** — events overlapping the chapter, greedily packed into lanes; each is a rounded rect filled at category color (32% / 60% selected), 1–2px stroke; baseline recipes render hollow with a dashed stroke; label text shown when wide enough.
  - **Stacked tracks** (only if toggled) — thin rows (`Funscript · muted`, `Audio`, `Spectro`, `Thumbs`) with mock signal art.
  - **Capture ghost bracket** — dashed `--accent-warm` BEGIN/END lines + translucent span while staging.
  - **Playhead** — 2px `--accent` line + top triangle.
  - **Ruler** — bottom 16px, monospace time ticks.

**Right — Media viewer (compact reference monitor).** Panel: mode segmented control (`Video / Audio / Spectro / Funscript`), stage (**aspect‑ratio 16/9**, black bg) rendering mock art per mode + a "now playing" recipe chip overlay top‑right, big monospace time readout `04:10.000 / 12:00`, 7‑button transport (prev‑chapter, frame‑back, −1s, **play/pause (round `--accent`)**, +1s, frame‑fwd, next‑chapter), a **SPEED** row (`0.25× 0.5× 1× 2×`, active = `--surface-3`), and the tip line *"Slow‑mo helps land precise begin / end frames without scrubbing."*

### 4. Capture bar  *(step ①, time selector)*
Full‑width bar (`--surface`, radius `--r-4`, margin `12px 22px`), flex row, wraps:
- `① MARK BEGIN / END FROM PLAYHEAD` lead (10px caps, `--text-dim`; ① is an accent circle badge).
- **Begin** label + `[◉ Capture]` button + editable monospace readout.
- `→`
- **End** label + `[◉ Capture]` button (disabled until begin set) + editable readout.
- `DURATION · derived` label + value (**read‑only**, computed `end − begin`).
- spacer, then **Chain** + **Snap to beat** checkboxes, then **↻ Reset**.
- When an existing event is selected the bar flips to **EDITING `{id}`** mode: Capture buttons become **To ▸** (move that edge to the playhead), readouts edit the event directly, Reset becomes **✕ Done**, border turns `--accent`.

### 5. ROW B — library · config · list  `grid-template-columns: 256px minmax(0,1fr) 340px; align-items: stretch`
All three panels share `max-height: calc(100vh − 360px)` (min 380) and read as equal‑height columns.

**Left — Effect Library (cascading selector, step ②).** Header `② EFFECT LIBRARY {count}`. Breadcrumb (`{device} › all categories`). **Device tabs** (`Estim / Vibrator / bHaptics / Shaker`, 4‑col grid; active = `--accent` fill). Search input. Scroll list grouped by **category** (`Buzz / Stroke / Control / Shape`) — each group header is a **collapsible** button (chevron rotates) with a colored dot + count. Each recipe row: category dot + name (600) + one‑line desc (ellipsis) + a **mini preview chart** (52×20 sparkline in the category color). Clicking a row **arms** that recipe (left accent bar on the armed row).

**Middle — Effect config (step ③).** Header: `③ {dot} {Recipe name} {Category badge}` + role text (`armed` / `editing {id}`). **Long description** (switches to the NSFW variant when the toggle is on). Divider, then: **Intensity** slider (0–100; disabled for baseline recipes), **Params** (per‑recipe tunables as compact chip sliders), **Devices** block (`○ broadcast · ● override` legend; each device row: toggle ○/● + name + either a slider (when overridden) or `broadcast` / `not on this effect` text + a numeric read). Actions pinned to bottom: **+ Add event** (disabled until begin+end set, with hint *"Set begin & end in the bar above ↑"*). When editing: **🗑 Delete** + **✓ Done**.

**Right — Timeline list.** Header `Timeline {n} events`. Scroll list grouped by **Act** (sticky act headers: colored square + `ACT n — NAME` + count). Each event row: monospace timestamp · `{dot} {Recipe} {+Δs derived duration}` · device tags (monospace chips) · optional NSFW description line (when toggle on) · **▷ seek** + **🗑 delete** actions. Selected row highlighted with a left accent bar; out‑of‑scope rows dimmed to 40%.

### 6. Composite funscript timeline  *(whole‑script overview, NOT a scope selector)*
Full‑width panel (`margin 0 22px 12px`). Header `Funscript timeline` + hint *"whole script · all events overlaid · click to seek · click a band to select"* + monospace `2,183 actions · 72 events`. Canvas (height ~150): full‑duration act region tints (scoped act a touch brighter, **read‑only**), `--bg` dividers, **non‑interactive act labels** (`ACT n — NAME {count}`), the **funscript position line** across the entire script (white, .7 opacity), **every event overlaid** as a lane‑packed colored band (category color; selected → white stroke), and the `--accent` playhead. Legend: `Buzz / Stroke / Control / Shape` + `— funscript position`. **Click seeks**, clicking a band selects that event. It does **not** change chapter scope (scope is owned by the CHAPTERS row only).

### 7. IO bar
`--grad-cta` bar: **📦 Starter packs**, **⤴ Load YAML…**, **⟨/⟩ Preview events.yml**, spacer, then `{n} events · scope: {chapter}`.

---

## Interactions & Behavior
- **Collapse chart** — the Act title row has a **▾ Collapse chart / ▸ Expand chart** toggle that hides ROW A (chart + monitor) to give more editing room; CHAPTERS scope, capture bar, ROW B, and the composite timeline remain. (`collapsed` state in `app.jsx`.)
- **Scope** is owned solely by the CHAPTERS waveform (click chapter) and by selecting an event (focuses that event's act). ROW A, the capture bar, and the chart are all scoped to it.
- **Playback**: `requestAnimationFrame` loop advances `currentMs` by `dt × speed` while playing; speed ∈ {0.25, 0.5, 1, 2}. Transport buttons seek ±1s, frame‑step ±33ms, jump to chapter start/end.
- **Capture**: *Set begin* snaps `currentMs` to the nearest beat (if Snap on) → `beginMs`; *Set end* → `max(beginMs+250, snappedNow)`. **Duration is always derived** (`end − begin`), never an input. **Add event** pushes `{begin,end,recipe,intensity,params,devices,chapter}`; **Chain** then auto‑moves the next begin to the just‑committed end.
- **Beat snap**: `beatMs = 60/bpm × 1000`; `round(ms/beatMs) × beatMs`.
- **Edit**: clicking an event (in chart, list, or composite timeline) loads it into the capture bar + config for in‑place editing; resize via the bar's To‑▸ buttons or by typing times.
- **NSFW toggle** swaps the config's long description and reveals per‑event description lines in the Timeline list.
- **Responsive**: ROW A collapses the monitor under the chart < 920px; ROW B collapses to one column < 980px; everything else reflows. Design width is 1600.

## State Management
Owned by `RxApp` (`app.jsx`):
- Clock/transport: `currentMs`, `isPlaying`, `speed` (+ `window.__rxPlayhead` mirror for cross‑component "move to playhead").
- Scope: `scopeId`, `selStanza`.
- Events: `events[]` (working set), `selectedId` (→ `selectedEvent`).
- Library/arming: `device`, `query`, `armedId` (arming resets params/intensity to the recipe's defaults and switches device if the recipe isn't on the current one).
- Capture staging: `beginMs`, `endMs`, `intensity`, `params`, `devices`, `chain`, `snap`.
- View: `nsfw`, `viewerMode`, `tracks` (which chart tracks are visible).
- `recipeAtPlayhead` (memo) drives the monitor's now‑playing chip.
- Tweaks (`tweaks-panel.jsx`): defaults for chain/snap/nsfw/device/tracks — replace with real app settings in production.

## Data model (see `source/data.js` and `DATA_FLOW.md`)
- `RX_CATS` — 4 effect categories (legend): Buzz `#ff5a5a`, Stroke `#4dabf7`, Control `#eab308`, Shape `#c77dff`.
- `RX_DEVICES` — Estim / Vibrator / bHaptics / Shaker.
- `RX_RECIPES` — each: `{ id, label, cat, devices[], desc, long, longNsfw, compose: 'additive'|'replace', intensity, isBaseline?, tunables[], preview:number[] }`.
- `RX_CHAPTERS` (= Acts) — `{ id, label, short, start, end, color }`.
- `RX_STANZAS` — beat‑grouped sub‑slices with `energy` (drives the spectrum).
- `RX_EVENTS` — `{ id, chapter, begin_ms, end_ms, recipe, intensity, params, devices }`.
- Helpers: `RX_recipeById`, `RX_catById`, `RX_chapterById`, `RX_chapterAt`, `RX_accentOf`, `RX_fmtTime(ms, withMs)`, `RX_durLabel`.

> **Production note:** events here are **spans, not taps**; recipes layer over device‑level *primitives*; `.feel.yml` is the canonical sidecar and Restim/.tact/Freyja/OWO are *derived* exports. The recipe library is **read** by Events and **authored elsewhere** (forgeworkbench). See the parent project's `Events_Tab_Deliverables/ARCHITECTURE.md` for the full rationale behind spans, `Normal`‑as‑eraser, compose modes, and per‑device overrides.

## Design Tokens
From `source/colors_and_type.css`:
- **Color**: `--bg #0e1117`, `--surface #1a1d27`, `--surface-2 #12151e`, `--surface-3 #232735`, `--border #2d3148`, `--border-strong #3a3f5c`; text `#fafafa / #9ba3c4 / #6b7390`; accents `--accent #ff4b4b`, `--accent-2 #ff7b7b`, `--accent-warm #ff8c42`; status `--success #3ed598`, `--warn #ffb547`, `--danger #ff5470`, `--info #4dabf7`.
- **Chart velocity gradient** (energy/speed → color): `#1f3a8a → #2563eb → #06b6d4 → #22c55e → #eab308 → #f97316 → #ef4444`.
- **Type**: Inter (sans), JetBrains Mono (mono). Scale h2 22/700, h3 16/600, body 14, label 13, caption 12, mono 13; tabular‑nums on all numerics.
- **Radius** `4/6/8/10/12` + pill; **shadows** `--elev-1..3`, `--glow-accent`; **motion** `--dur-fast 100ms / base 180 / slow 320`, `--ease-standard cubic-bezier(.2,0,0,1)`.

## Assets
No external images. All imagery (video frame, audio/spectro/funscript signals, thumbnails, spectrum, preview sparklines) is **deterministic SVG mock art** generated from seeded PRNGs — swap for real frames/analysis in production, preserving the visual style. Fonts load from Google Fonts (Inter, JetBrains Mono); use the codebase's existing font pipeline instead.

## Files (`source/`)
| File | Role |
|---|---|
| `Events_Reconciled.html` | Entry; loads tokens, styles, React+Babel, then the modules below in order. |
| `colors_and_type.css` | Design tokens + base type. |
| `styles.css` | All component styles (prefix `rx-`). |
| `data.js` | Mock data + data model + helpers (`window.RX_*`). |
| `shell.jsx` | Tab strip, CHAPTERS waveform, title/NSFW row. |
| `script-stack.jsx` | ROW A hero chart (spectrum + stanzas + event lanes + tracks). |
| `capture.jsx` | Capture bar (time selector), Effect config, Media viewer. |
| `library.jsx` | Cascading Effect Library + shared `RxChart` sparkline. |
| `timeline-list.jsx` | ACT‑grouped Timeline event list. |
| `funscript-timeline.jsx` | Composite whole‑script overview + IO bar. |
| `app.jsx` | Orchestrator: state, clock, capture logic, layout, Tweaks. |
| `tweaks-panel.jsx` | Prototype tweak‑panel harness (not production). |

See **`DATA_FLOW.md`** for the end‑to‑end pipeline (data → state → capture → render → export).
