# End‑to‑End Data Flow — Events Tab

This document traces a value from raw project data all the way to an exported event, so an engineer can wire the prototype into the real app without reverse‑engineering it. File references are to `source/`.

```
.feel.yml (project)            recipe library (forgeworkbench)
   │  chapters/stanzas/beat        │  recipes + primitives + previews
   ▼                               ▼
 data.js  ──►  RxApp state  ──►  components (render)  ──►  user gesture
   (RX_*)        (app.jsx)         (shell/script/capture/library/list/fun)
                    ▲                                          │
                    └──────────────  callbacks  ◄─────────────┘
                                         │
                                         ▼
                              events[] mutated  ──►  serialize to .feel.yml `events:`
                                                      ──►  device packs ──► Restim YAML / .tact / Freyja / OWO
```

## 1. Inputs (today = mocks in `data.js`; prod = real services)
- **Project / structure** → `RX_PROJECT`, `RX_CHAPTERS` (acts), `RX_STANZAS`, `bpm`. *Prod:* read from `.feel.yml` (chapters, stanzas, beat track). The `energy` field on stanzas (drives the spectrum) comes from the analyzer.
- **Recipe library** → `RX_RECIPES`, `RX_CATS`, `RX_DEVICES`. *Prod:* read the workbench's recipe library (a `recipes.json`‑style projection embedded in `.feel.yml` so the file is self‑describing). Events is a **consumer** — it never authors recipes. Each recipe carries: category, device availability, `compose` mode, default intensity, `tunables[]`, `preview[]` (24‑pt normalized shape), and SFW/NSFW copy.
- **Existing events** → `RX_EVENTS`. *Prod:* the `.feel.yml` `events:` array.

> Replace the seeded‑PRNG generators (`rxRand`, `rxNoise`) and the literal arrays with real reads. Keep every field name — the components read them directly.

## 2. State ownership (`app.jsx` → `RxApp`)
One component owns everything; children are controlled (props down, callbacks up). Groups:

| Group | State | Notes |
|---|---|---|
| Clock | `currentMs`, `isPlaying`, `speed` | rAF loop advances `currentMs += dt*speed`; mirror to `window.__rxPlayhead` for "move edge to playhead". |
| Scope | `scopeId`, `selStanza`, `collapsed` | scope owned ONLY here; set by CHAPTERS row + event‑select. `collapsed` hides ROW A. |
| Events | `events[]`, `selectedId` | `selectedEvent = events.find(id)`. |
| Arming | `device`, `query`, `armedId` | arming resets `params`/`intensity` to recipe defaults; auto‑switches `device` if recipe not on it. |
| Staging | `beginMs`, `endMs`, `intensity`, `params`, `devices`, `chain`, `snap` | the in‑progress (not yet added) event. |
| View | `nsfw`, `viewerMode`, `tracks` | cosmetic/visibility. |

*Prod:* lift this into the app's store (Redux/Zustand/Tauri state). The undo/redo stack (the app advertises 50‑level undo) should wrap `events[]` mutations.

## 3. The authoring loop (time → effect → tune → add)
1. **Scrub** — user clicks the chart / CHAPTERS row / composite timeline → `seek(ms)` sets `currentMs`. Playback or frame‑step also move it. Speed 0.25×/0.5× for frame‑precise landing.
2. **① Mark** (`RxCaptureBar`) — *Set begin* → `snap(currentMs)` → `beginMs`; *Set end* → `max(beginMs+250, snap(currentMs))` → `endMs`. `snap(ms)= round(ms/beatMs)*beatMs` when **Snap** on; `beatMs = 60/bpm*1000`. **Duration is derived** (`end−begin`), shown read‑only.
3. **② Pick** (`RxEffectLibrary`) — device tab → collapsible category groups → recipe row → `arm(id)`.
4. **③ Tune** (`RxEffectConfig`) — intensity / per‑recipe `tunables` / per‑device overrides. Long description respects `nsfw`.
5. **Add** — `onAdd()` pushes `{ id, chapter: chapterAt(begin).id, begin_ms, end_ms, recipe: armedId, intensity, params, devices }` into `events[]`. **Chain** then sets `beginMs = endMs; endMs = null` so the next span starts where this one ended.

## 4. Editing an existing event
Selecting an event (chart band / list row / composite band) → `selectEvent(id)` sets `selectedId`, scopes to its act, seeks to its begin. The capture bar + config switch to **edit mode** and mutate that event in place via `updateSel(patch)` (`begin_ms`, `end_ms`, `recipe`, `intensity`, `params`, `devices`). `deleteSel()` / per‑row delete remove it.

## 5. Rendering (read‑only projections of state)
- `RxChaptersWave` — stanza energy → spectrum bars; selected chapter outline; playhead.
- `RxScriptStack` — scoped chapter: axis + stanza chips + spectrum + lane‑packed event band + optional tracks + ghost bracket + playhead + ruler. `msToX/xToMs` map the chapter window to the (width − 30px axis) plot.
- `RxMediaViewer` — `viewerMode` selects mock art; `recipeAtPlayhead` (memo over `events` + `currentMs`) drives the now‑playing chip.
- `RxTimelineList` — events grouped by chapter; out‑of‑scope dimmed; NSFW lines when toggled.
- `RxFunTimeline` — **whole script**: act tints (read‑only), funscript line, ALL events lane‑packed and overlaid, playhead. Click seeks / selects; **never** changes scope.

## 6. Output / export (the part to build for real)
The working `events[]` serializes back into `.feel.yml` under `events:`. Each event is **device‑agnostic**; device packs expand it at export time:
- `final_device_intensity = event.intensity × (event.devices[device] ?? 1)`.
- `compose: 'additive'` → sum per device, clamp 1.0; `'replace'` (baseline recipes like Normal/Mute/Freeze) → override the span.
- Recipe → primitives (Pulse/Wave/Tremor/Sustain/Rolling/Impact) → per‑device renderer → **Restim YAML / bHaptics .tact / Freyja JSON / OWO**. These are *derived* artifacts; the user never edits them directly.

See the parent project's `Events_Tab_Deliverables/ARCHITECTURE.md` (spans‑not‑taps, Normal‑as‑eraser, compose modes, per‑device chevron, `.feel.yml` canonical) and `RECIPES.md` for the recipe schema this UI consumes.

## 7. Wiring checklist for Claude Code
- [ ] Replace `data.js` globals with real modules: `.feel.yml` reader (chapters/stanzas/beat/events) + recipe library service.
- [ ] Port `RxApp` state into the app store; hook `events[]` mutations into undo/redo.
- [ ] Replace mock SVG generators with real frame thumbnails, audio/spectro analysis, and the actual funscript line — keep the visual treatment + velocity gradient.
- [ ] Implement `seek/play/frameStep/speed` against the real media element/clock.
- [ ] Implement beat‑snap from the real detected beat grid (sub‑beat modifier is an open question).
- [ ] Implement serialize → `.feel.yml events:` and the device‑pack export transforms.
- [ ] Wire the proposed hotkeys (I/O set begin/end, Enter add, Space play, , . frame‑step, 1–9 arm recipe) onto the existing callbacks.
- [ ] Replace `tweaks-panel.jsx` with real settings; drop the `window.__rx*` globals in favor of refs/context.
```
```
