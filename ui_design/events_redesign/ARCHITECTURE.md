# Events tab — architecture decisions

This document captures the design decisions made during the Events tab pass against the **Cross-Device Pattern Thesis** (see `forge-ui-design/CROSS_DEVICE_PATTERN_THESIS.md` in the parent project for the source). Each decision is stated as a position, with the rationale and the alternatives considered.

These decisions shape the data model, the UI, and the export pipeline. They are stable for the Events tab and intended to extend to adjacent surfaces (Characters, Phrases, Haptics, Multi-axis) when those collapse into the unified-vocabulary architecture the thesis points toward.

---

## TL;DR — what this design commits to

1. **Patterns + recipes are the single modulation language**, validated end-to-end through Events.
2. **Recipes layer over primitives.** Users author in recipes; the engine renders primitives. The thesis's "single modulation language" lives at the primitive layer; recipes are the user vocabulary.
3. **`.feel.yml` is the canonical, device-agnostic project sidecar.** Restim YAML / bHaptics .tact / Freyja JSON / OWO are *derived* exports.
4. **Events are spans, not taps.** A span carries begin, end, recipe, intensity, optional params, optional per-device overrides.
5. **Normal is the eraser.** A recipe with `compose: replace` and `primitives: []`. Surfaces explicit pass-through as a first-class authoring action.
6. **Compose mode is per-recipe**: `additive` (default) or `replace`. Stacking is resolved at render time per the rules in §5.
7. **Body regions are deferred** for v1. Architecture leaves room (`event.regions: { chest_l: ... }`); the UI doesn't draw a silhouette yet. Lands when haptics ships.
8. **The "Patterns" tab is renamed to "Motifs"** so the word "patterns" can mean the modulation alphabet without colliding.
9. **Recipe authoring lives in forgeworkbench**, not in the Events tab. Events is a *consumer*.
10. **Tap-to-create is a per-recipe opt-in.** Short-shape recipes (Impact) allow committing with only a begin anchor.

---

## 1. Recipes over primitives — the layering decision

**The thesis said:** *patterns (Pulse, Wave, Tremor, Sustain, Rolling, Impact, Reactive) are the single modulation language across every downstream device.*

**The problem:** edger's existing events vocabulary (Surge, Edge, Tease, Climax, Punch, Soften, …) is not 1:1 with primitives. Surge is a *recipe* — slow ramp-in + sustained throb + slow ramp-out — that's three primitives stitched with envelopes. Mapping Surge to a single Pulse or Wave is lossy. The thesis collapse, strictly applied, would discard everything that's natural about how edgers author.

**The decision:** introduce a **recipe layer over the primitive alphabet.** Recipes are named compositions of primitives. The user authors in recipes (Surge, Edge, …). The engine renders primitives (Pulse + Wave + Sustain + …). The thesis's promise — *one modulation language across every device* — holds at the primitive layer, which is where device packs live. The recipe layer is a UX-side abstraction on top.

**Alternatives considered:**
- **Strict primitives only.** Picker shows Pulse / Wave / Tremor / Sustain / Rolling / Impact. Closer to the thesis literally. *Rejected*: forces users to compose multi-primitive recipes by hand for every common case (Surge = pick three primitives back to back, set envelopes correctly, hope the timing matches). Unusable.
- **No primitives at all; recipes are atomic.** Each device pack has its own renderer per recipe. *Rejected*: this is the iter-9 model, where Surge is one black-box-per-device. Doesn't honor the thesis (no shared modulation language), and adding a new device requires re-implementing every recipe per device.
- **Two layers (committed)**: primitives = engine alphabet, recipes = user vocabulary, device packs = per-device renderer at the primitive level. Each recipe declares its primitives + tunables; the device pack expands primitives, not recipes. This is what shipped.

**Implication:** the recipe library lives in **forgeworkbench**. Each recipe in the library carries its primitive composition + tunable metadata + preview shape. The Events tab is a *consumer* of the library — it doesn't author recipes, just selects them.

---

## 2. `.feel.yml` as the canonical sidecar

**Decision:** the project's authoritative state lives in `.feel.yml` (YAML, one file per project). It contains:

- Project metadata
- Beat track (BPM, downbeat, meter)
- Chapters, phrases, motifs, stanzas (existing structural data)
- **Events** (the new section the Events tab writes)
- Recipe library *projection* — a snapshot of the workbench's recipe library, so the file is self-describing for downstream tools that don't have the workbench installed

**Alternatives considered:**
- `<stem>.events.json` as a sibling file (iter-9 prototype's approach). *Rejected*: fragments project state across N files, each surface inventing its own sidecar. The user opens "one project," the toolchain reads "five files." Thesis-incompatible.
- JSON instead of YAML. *Acceptable substitute* if YAML libs are a problem in Rust/Tauri; the schema is the same. YAML is preferred for human-readability (events authoring produces a lot of timestamps, recipe IDs, params — YAML reads cleaner).
- Storing only IDs of recipes, with the library entirely external. *Rejected*: brittle when projects move between machines or when the library version drifts. Project must be self-describing.

**Restim YAML / .tact / Freyja / OWO are derived export artifacts**, not primary state. The user never edits them directly; they're regenerated from `.feel.yml` at export time via device packs. See `HANDOFF.md` §5 for the transform.

---

## 3. Events are spans, not taps

**Decision:** every event has `begin_ms` and `end_ms`. There is no "instant event" type. An Impact landing at frame 5832 is a span from 38,400 ms to 38,750 ms — same shape as a Surge spanning 8 seconds.

**Why:** events were originally conceived (in edger) as *spans of the funscript that get emphasis applied during playback*. The thesis brief implied point-in-time impulses; the user pushed back. Both are special cases of the same model: a span with a recipe.

**UX accommodation:** **tap-to-create** lets recipes that *feel* instantaneous (Impact) be committed with only a begin anchor, with the end auto-derived from the recipe's default duration. The data model is unchanged — only the capture-row UI differs. See `RECIPES.md` for the `tapToCreate` flag.

**Alternatives considered:**
- Two event types: `Span` and `Instant`. *Rejected*: doubles the schema for a UX shortcut that's already addressable at the recipe level.
- All events are instants; "spans" are pairs of instants. *Rejected*: every consumer (engine, export, UI) has to reconstruct ranges. Forces complexity onto consumers to keep the authoring model simple — wrong direction.

---

## 4. Normal as the eraser

**Decision:** **Normal** is a first-class recipe in the catalog, with `compose: replace`, `primitives: []`, `isBaseline: true`. It's the **default selection** in the picker.

**What it does:** during a Normal event's span, downstream playback *ignores* whatever recipe a phrase, chapter, or other event would have otherwise applied, and passes through the funscript as authored. It's the eraser. The rest in music notation.

**Why it matters:**
1. **Composes with phrases / chapters.** Phrases and chapters can apply their own ambient recipes. Normal carves a hole — "during this span, none of that applies."
2. **Solves the phrase-vs-event resolution question.** The thesis brief flagged: "if a phrase says Sustain from 35–45s and you drop an Impact at 38.5s, which wins?" Answer: layer additively (most cases). When you want override, place a Normal that covers the conflicting span and then place the override on top.
3. **Surfaces "silence" as an authoring intent.** Without it, the user has no way to express "I deliberately want nothing here." With it, "nothing" becomes intentional, visible on the strip, and auditable.

**Visual treatment:** dashed border, hatched fill, gray (Baseline family). Reads as negative space — distinctly NOT a competing recipe color band.

**Alternatives considered:**
- No eraser; conflicts resolved by intensity-zero events. *Rejected*: intensity 0 still composes additively, which means an underlying Surge still plays. Doesn't solve the conflict.
- A separate mode/flag on the event ("clear underlying") rather than a recipe. *Rejected*: events become structurally inconsistent. Cleaner to model "clear" as a recipe with `compose: replace` and let the picker handle it uniformly.

---

## 5. Compose modes — `additive` vs `replace`

**Decision:** every recipe declares a `compose` mode. Two values today:

- `additive` *(default)* — sum per device, capped at 1.0
- `replace` — override everything underneath for the span

**Resolution rules** when multiple events overlap in time on the same device:
- All `additive` → sum each device, clamp at 1.0
- Any `replace` → that event wins for its span on that device
- Two `replace` overlapping → second-authored wins (rare; UI warns)

**Why per-recipe (not per-event):** edgers think *Surge composes additively, Normal replaces* — that's a property of the recipe's meaning, not of individual events. Asking the user to set compose mode on every event would be noise. The recipe declares its semantics; events inherit.

**Future:** `subtract` (event applies negative intensity) is plausible as a third mode, but absent any concrete use case in the current design — defer.

---

## 6. Per-device intensity chevron

**Decision:** every event carries an optional `devices: { estim?: number, vibrator?: number, bhaptics?: number, shaker?: number }` block. Absent or empty → broadcast at the event's `intensity`. Present keys override that device's intensity to the explicit 0..1 value.

**Why this shape:**
- It's the *minimum* surface that lets users tune cross-device feel.
- It scales: when new device classes are added (haptics suit, multi-axis), they just become new optional keys.
- It composes cleanly with the recipe's intensity: `final_device_intensity = event.intensity × (event.devices[device] ?? 1.0)`.

**Alternatives considered:**
- Per-event "devices supported" enum (just on/off, like Characters has). *Rejected*: doesn't let the user tune a punch to feel hard on the shaker but light on the vibrator. Loses fidelity.
- Devices declared at the recipe level. *Rejected*: same recipe authored in different events legitimately wants different per-device feel. Recipe-level is the *default*; event-level is the *override*.

**Default:** the chevron is collapsed and shows `broadcast (all 100%)`. Power users open it; everyone else doesn't see the complexity.

---

## 7. Body regions deferred

**Decision:** the `regions: { chest_l: 1.0, lower_back: 0.6, … }` field defined in the thesis is **architecturally reserved** but **NOT surfaced in the v1 UI**.

**Why defer:**
- The project doesn't have a region model yet — chapters, phrases, motifs, stanzas, but no body-spatial concept.
- Regions only make sense for haptics; the v1 device matrix is e-stim + vibrator + bHaptics + shaker, only one of which is region-aware.
- Designing a region picker without a region authority is premature.

**Forward-compatibility:** the `.feel.yml` schema allows the field. The Events tab's inspector layout has visual room for it. When haptics ships:
1. Add a body-silhouette region picker (the iter-9 `haptics-frames.jsx` component is the right shape).
2. Extend the inspector with a "Regions" section that drops in next to "Devices."
3. Older `.feel.yml` files (no regions) continue to play — engine treats absent regions as "broadcast to all body regions at event intensity."

---

## 8. The "Patterns" rename to "Motifs"

**Decision:** the existing tab named "Patterns" (which lists *recurring* funscript shapes detected by the analyzer) is renamed to **"Motifs"** in lockstep with this Events tab shipping.

**Why:** the word "pattern" has been overloaded:
- In the analyzer / tab UI: "pattern" = a recurring funscript shape (the existing Patterns tab's contents)
- In the thesis: "pattern" = the modulation alphabet primitive (Pulse, Wave, Tremor, …)

Shipping Events with the modulation-primitive sense while a sibling tab uses the funscript-shape sense guarantees user confusion every session. Renaming the tab is one rename + one doc update; not renaming creates a permanent ambient cost.

**"Motifs"** is the chosen name because:
- Musical / structural vocabulary, consistent with the existing "Stanzas" (beat-grouping) and "Phrases" (one-off slices) tabs
- A motif is a recurring small structural unit — semantically correct for what the tab actually does
- Free of collision with the modulation-primitive sense of "pattern"

---

## 9. Recipe authoring lives in forgeworkbench

**Decision:** the Events tab is a *consumer* of the recipe library. Recipes are *authored* in **forgeworkbench** (the eventual renamed FunscriptForge Pro).

**Why:** keeping authoring out of the consumer surface:
- Lets the Events tab stay focused on event placement (the user job-to-be-done is "mark moments in the video," not "design new recipes")
- Means the recipe library is *one thing* read by many tabs (Events, future Phrases-with-recipes, future Characters-as-pattern-projections, …) — single source of truth
- Allows community recipe packs without exposing every consumer to recipe-pack management UI

**What the Events tab does instead:** if the user wants a recipe variation that doesn't exist, they pick the closest recipe and adjust its tunables on a per-event basis. If they consistently want a recipe with non-default tunables, they create that as a new recipe in the workbench.

---

## 10. The picker shipped #1, designed-for #3

**Decision:** sectioned dropdown with search and per-recipe preview waveforms, as a stepping stone to a card-grid modal palette when the library grows past ~30 recipes.

**Why:**
- A flat dropdown breaks past ~12 entries; edger's 15 is already past that line.
- A card-grid modal is over-engineered for ~8–15 recipes.
- The data shape that drives the sectioned dropdown (recipes grouped by family, with previews, with search) **is the data shape the card-grid modal will need**. Same data, two presentations. Building #1 doesn't waste work; it produces the schema #3 reads.

**The preview waveform is the signature touch.** Each recipe carries a 24-point normalized array; the dropdown renders it as a tiny SVG; the eventual modal renders it at larger scale. The user sees the shape before committing — pattern-recognition does the work that long descriptions can't.

---

## 11. Chain mode + tap-to-create — workflow shortcuts

**Decision:** two opt-in flow shortcuts that match how authoring actually happens:

- **Chain mode** (on by default): after `+ Add event`, the next event's begin auto-stages to the just-committed event's end. Eliminates "Set begin" for every event in a sequence.
- **Tap-to-create** (per recipe, opt-in): for short-shape recipes (Impact), `+ Add hit` works with only a begin anchor — end auto-derives from the recipe's default duration.

**Why both:** authoring a punch combo is "tap-tap-tap-tap" — pause, anchor, pause, anchor, pause, anchor. Chain mode collapses the per-event "set begin" step. Tap-to-create collapses the per-event "set end" step. Together they reduce a four-click-per-event flow to a one-click-per-event flow for the most common case.

**Why not always-on tap-to-create:** recipes with long defaults (Surge 8 s, Climax 6 s) shouldn't silently extend 8 seconds of video on a single click. The flag is per-recipe so the user opts in by *choosing the recipe*, which is intentional.

---

## 12. Hotkeys — designed-in, not yet wired

**Decision:** the Tweaks panel exposes a hotkey legend toggle. The legend is shown when on; the bindings are *not yet wired*. Proposed bindings:

| Key | Action |
|---|---|
| `I` | Set begin |
| `O` | Set end |
| `Enter` | Add event |
| `Space` | Play / pause |
| `,` `.` | Frame step |
| `1`–`9` | Arm a recipe (binds to favorite/recent list, configurable) |

**Why not wired:** the user is visual-first. Hotkeys are a power-user affordance; shipping the visual flow first is correct. The hotkeys will sit cleanly on top of the same `onSetBegin` / `onSetEnd` / `onAdd` / `onSeek` callbacks the buttons already use — Claude Code can bolt them on without touching the data model.

---

## 13. Open questions

These were surfaced during the design pass but not resolved. Some need product calls, some need user research:

- **Devices broadcast semantics when `devices` block is partial.** Two reasonable interpretations: "named devices override, unnamed broadcast" (what the prototype assumes) vs. "named devices are the whitelist, unnamed are off" (more restrictive). Confirm with the team.
- **Compose `replace` over edger** — current edger player has no `mode: replace` concept. Coordinate to add it, or implement Normal as a cancel-event sequence. See `HANDOFF.md` §5.4.
- **Recipe library file format and distribution.** Single recipes.json shipped with the app? Per-recipe YAML? Community pack format? Per-user override directory? All TBD.
- **Beat-snap granularity.** Default snaps to the nearest beat. Sub-beat resolutions (half-beat, quarter-beat) on a modifier key?
- **Multi-event selection.** The iter-9 prototype hinted at shift-click multi-select for bulk operations (delete, shift in time, change recipe). v1 doesn't implement it; v2 should.
- **Undo / redo.** Tab-level undo stack hooks into where? Project-wide vs per-tab? The existing FunscriptForge has "50-level undo/redo" advertised; events should integrate into the same stack.

---

## 14. What this design pass did NOT decide

These are explicitly out of scope and pointed forward to other passes:

- **Characters tab redesign.** The thesis identifies a downstream collapse (Characters become filtered views of the recipe catalog). Not done here. Characters keeps its current shape; this pass adds an open question for that future work.
- **Haptics tab.** Architecture-ready, UI-deferred. When body regions land, haptics becomes a device target in the unified authoring tab, not its own surface. Future pass.
- **Stim tab.** Same logic — folds into the unified authoring tab when characters merge with recipes.
- **Multi-axis tab.** Same.
- **The unified "Catalog" tab.** The thesis points toward a Catalog tab that's the single source of truth for recipes; today the workbench plays that role. Whether Catalog merges into the workbench or becomes its own tab is a forgeworkbench design call, not an Events tab call.

---

## 15. References

- `forge-ui-design/CROSS_DEVICE_PATTERN_THESIS.md` — the thesis this design honors
- `forge-ui-design/REDESIGN_BRIEF_EVENTS.md` — the design brief
- `forge-ui-design/ARCHITECTURE_ADDENDUM_2026_05.md` — stack + viewer/clock model
- `forge-ui-design/iterations/01-events/.../tab-Events.jsx` — the iter-9 prototype this design explicitly does NOT extend
- `forge-ui-design/iterations/04-beats-b/.../docs/architecture_haptics.md` — `.feel.yml` schema origin, region × phrase model
- `HANDOFF.md` (this delivery) — integration notes, `.feel.yml` → edger YAML transform
- `RECIPES.md` (this delivery) — how to author a recipe
- `USER_GUIDE.md` (this delivery) — end-user guide and glossary
