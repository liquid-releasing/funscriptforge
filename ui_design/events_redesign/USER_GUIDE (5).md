# Events tab — User guide

The **Events** tab is where you mark up moments in your video that should be *emphasized* in playback — a punch landing, a gunshot, a slow release, a held tease. You author events as **spans** on the timeline, pick a **recipe** that describes how each span should feel, and the engine renders that into whatever device the user happens to have plugged in (e-stim, vibrator, bHaptics vest, shaker).

This document covers everything visible in the tab. The **Glossary** at the bottom defines every term.

---

## The capture loop — adding your first event

1. **Pick a chapter** in the top CHAPTERS row. Everything below scopes to that chapter.
2. **Play the video** in the right-hand viewer until you see the moment you want to emphasize.
3. **Pause** and frame-step (the `◁I` / `I▷` buttons in the transport) to land on the exact frame the moment *starts*.
4. Click **`Set begin`** in the capture row. The time is captured and an orange ghost-bracket appears on the strip.
5. Continue / scrub / frame-step to where the moment *ends*.
6. Click **`Set end`**. The ghost-bracket extends to the end time.
7. Pick a **recipe** from the dropdown (Surge, Edge, Tease, Impact, …). Each recipe shows a tiny preview waveform so you can see its shape.
8. Adjust **intensity** (and any per-recipe parameters that appear) if the defaults aren't right.
9. Click **`+ Add event`**. The bracket commits to the strip with its recipe color and label.

**Chain mode** (on by default) auto-stages the next event's begin to the just-committed event's end — so editing a sequence of punches is one anchor-press per event, not two.

**Beat snap** (on by default) snaps Set Begin and Set End to the nearest beat. Turn off for free-floating events.

---

## Tap-to-create — for one-hit events

Some recipes (Impact, by default) describe a *single hit* — a gunshot, a slap. For these, you don't need to set an end:

1. Pause on the frame where the hit happens.
2. Click `Set begin`.
3. Click `+ Add hit`. The end auto-derives from the recipe's default duration (350 ms for Impact).

You can still set an end manually if you want a different length (e.g. a sustained Impact across a punch combo).

---

## Editing an existing event

Click any colored bracket on the strip to select it. The capture row swaps into an **event inspector** with:

- **Begin / End** as click-to-edit times — click the number, type a new time (`MM:SS.mmm` or just seconds), Enter to commit.
- **`← begin to ▸`** / **`▸ to end →`** — move the begin or end to the current playhead position.
- **Recipe** picker, **Intensity** slider, **Params** sliders, **Devices** chevron — same as capture.
- **🗑 Delete** to remove the event.
- **✕ Done** at the top right to deselect and return to capture mode.

You can also **drag the bracket's edges** on the strip itself (works best when zoomed in).

### Typing exact times

Anywhere a time is shown (Begin, End, or in the event inspector), **click the number** to edit it as text. Accepted formats:

- `MM:SS.mmm` — e.g. `04:07.173`
- `MM:SS` — e.g. `04:07`
- raw seconds — e.g. `247.173` or `247`

Press **Enter** to commit, **Escape** to cancel.

---

## The editing strip — what you're looking at

The big band beneath the title is the **editing strip**, the main canvas. It shows:

- **Events** as colored brackets, labeled with their recipe. Color is the recipe's *family* (Edging pink, Release orange, Rhythm blue, Punctuate purple, Texture green, Baseline gray).
- **Lanes** stacked vertically when events overlap in time — so you can see at a glance which moments are layered.
- **Playhead** as a red vertical line.
- **Beat grid** as faint vertical ticks (downbeats slightly stronger). Toggle in Tweaks.
- **Ghost bracket** in orange while you're in mid-capture (Set Begin pressed, Set End not yet).
- **Time ruler** at the bottom.
- **Background view** behind the brackets — toggle in the strip toolbar:
  - **Video** — thumbnail strip across the timeline (the default; matches what you're watching).
  - **Audio** — waveform.
  - **Spectro** — spectrogram. Best for finding pitched events.
  - **Funscript** — the funscript shape, colored by velocity.
  - **Energy** — smoothed audio loudness envelope. Good for finding peaks at a glance.
  - **None** — dark grid.
- **Click any point** on the strip to seek the video to that moment.
- **Drag the bracket's edge** on a selected event to resize it.
- **Zoom** with the `−` / `+` / **Fit** buttons in the toolbar.

---

## The right-side viewer

Always-visible video / audio / spectrogram / funscript pane. Has its own mode toggle independent of the strip's background — so you can watch the video on the right while looking at audio waveform on the strip, for instance.

- Transport: prev chapter / frame back / step −1s / play-pause / step +1s / frame forward / next chapter.
- **Speed** picker: 0.25× / 0.5× / 1× / 2×. Slow-motion is your friend for landing precise begin / end frames.
- **Now-playing overlay** in the corner shows which recipe is firing at the current playhead. Useful for sanity-checking what playback will feel like.

---

## Normal — the eraser

**Normal** is the only recipe that **replaces** what's underneath instead of adding to it. Use it to:
- Carve a quiet pocket inside an emphasized chapter
- Briefly stop everything for impact (the silence before a drop)
- Override a phrase-level recipe for a specific moment

Visually it renders as a dashed/hatched box on the strip — *negative space*, not a competing color.

---

## Per-device intensity overrides

By default, every event broadcasts to every device the user has set up. Open the **Devices ▾** chevron in the capture row to override per device:

- **○** = broadcast at the event's intensity (default)
- **●** = override active; slider sets that device's intensity 0–100

Example: an Impact event has its `shaker` overridden to 100% (so the punch hits the body hard) while `vibrator` is at 70% (lighter). E-stim and bHaptics broadcast at the event's intensity.

---

## Tweaks

Click the Tweaks toggle in the toolbar to surface a small panel for:

- **Default background** — what the strip shows initially (Video / Audio / Spectro / Funscript / Energy / None).
- **Show beat grid** — on / off.
- **Chain mode default** — whether new sessions start with chain mode on.
- **Beat-snap default** — whether new sessions start with beat-snap on.
- **Show hotkey legend** — adds a row of keyboard shortcut hints (planned hotkeys, not wired yet).
- **Viewer position** — viewer on the right (default) or left.

---

## Tips

- **Use slow-motion liberally.** Hitting a precise frame at 1× speed is hard. At 0.25× you have time to anchor cleanly.
- **Chain mode + Impact** is the killer combo for punch sequences. Pause at the first punch, Set begin, + Add hit, play to the next punch (chain has staged the begin at the previous end already), pause, + Add hit. Repeat.
- **Click the time number** anywhere it appears to type an exact value. Faster than scrubbing when you know what you want.
- **Audio** background is best for finding screams and silences. **Energy** is best for finding loudness peaks. **Video** is best for action you recognize visually.

---

## Glossary

### Event vocabulary

- **Event** — a span of the project timeline (begin → end) with a recipe and an intensity. The unit of authoring in this tab. Saved into `.feel.yml` under the `events:` section.
- **Span** — the time region an event covers: begin (inclusive) and end (exclusive). Events with `begin ≈ end` (~350 ms) read as point-in-time hits even though they're technically spans in the data model.
- **Recipe** — a named modulation behavior. Surge, Edge, Tease, Climax, Impact, Pulse, Rolling, Soften, Normal. What you pick when authoring; the underlying composition (primitives) is an implementation detail.
- **Primitive** — a single modulation shape from the engine's alphabet: Pulse, Wave, Tremor, Sustain, Rolling, Impact. Recipes are built from one or more primitives stitched with envelopes.
- **Family** — a recipe grouping by feel: **Edging**, **Release**, **Rhythm**, **Punctuate**, **Texture**, **Baseline**. Determines the recipe's color in the UI.
- **Compose mode** — how an event interacts with whatever else is playing at the same time. **Additive** (default) layers on top; **Replace** (Normal) overrides everything underneath.
- **Intensity** — 0–100% scaler applied to the recipe's underlying intensity. 0 doesn't mean silent unless the recipe also has tunables driving it; it means "apply the recipe at zero amplitude," which for most recipes is effectively silent.
- **Tunable / Param** — a per-recipe parameter the user can override on a per-event basis. Tremor frequency, Ramp up time, Decay time, Period, etc. Each recipe declares its own set.
- **Baseline** — the special recipe family containing only **Normal**. Renders distinctively (dashed border, hatched fill) because it's negative space, not a competing modulation.
- **Tap-to-create** — a recipe flag that allows committing an event with only a begin anchor. The end auto-derives from the recipe's default duration. On for Impact; off for everything else (recipes can be marked tap-to-create individually).

### Spatial / temporal vocabulary

- **Chapter** — a top-level division of the project (Opening / Build / Rising / Heated / Climax / Aftercare in the demo). Authored in the Chapters tab; the Events tab uses it for scope and as visual context.
- **Phrase** — a sub-chapter slice of one-off motion shapes from the funscript analyzer. Authored in the Phrases tab. Events live alongside phrases; both write into `.feel.yml`.
- **Motif** — recurring funscript shapes (renamed from "Patterns" in this design to free that word for the modulation alphabet). Authored in the Motifs tab.
- **Stanza** — beat-grouping (e.g. 4 beats → 1 with emphasis on the 1). Authored in the Stanzas tab.
- **Region** *(future)* — a body region (chest-left, lower-back, abdomen, …). When haptics ships, events grow an optional regions field; deferred entirely in v1.
- **Scope** — the current chapter (or "all") the editor is focused on. Top CHAPTERS row picks it.
- **Lane** — a horizontal row in the strip used to stack visually-overlapping events. Auto-packed left-to-right. Lanes are presentation, not data — `.feel.yml` doesn't store lane assignments.

### Capture vocabulary

- **Capture row** — the controls below the strip used to author a new event.
- **Set begin / Set end** — the two anchors of a span. Click captures the current playhead time. Click the time number itself to type a value directly.
- **Ghost bracket** — the orange dashed bracket on the strip showing the span being captured before it commits.
- **Chain mode** — auto-stages the next event's begin to the just-committed event's end. On by default.
- **Beat snap** — rounds begin / end to the nearest beat at the project's BPM. On by default.
- **Devices chevron** — the expandable Devices ▾ control for per-device intensity overrides.
- **Inspector** — the capture-row variant that appears when an existing event is selected. Includes Delete and the begin/end nudge buttons.
- **Now-playing overlay** — the small chip on the MediaViewer showing which recipe (if any) is firing at the current playhead time.

### Architecture vocabulary

- **`.feel.yml`** — the canonical, device-agnostic project sidecar. Stores chapters, phrases, motifs, stanzas, beat, **and events** in one file. The single source of truth.
- **Recipe library** — the catalog of recipes the workbench publishes; the Events tab is a *consumer* of this library. New recipes are authored in **forgeworkbench**.
- **forgeworkbench** — the eventual renamed FunscriptForge Pro. Where recipe authoring lives (and where this Events tab itself lives).
- **Restim event YAML** — the *derived* per-device export artifact for e-stim playback. Generated from `.feel.yml` at export time. The Events tab doesn't read or write this directly.
- **Device pack** — the per-device renderer that expands a recipe into device-specific parameters. Lives alongside the recipe in the workbench.

### Things you won't see in the UI yet but may hear mentioned

- **Cross-device pattern thesis** — the architectural decision that patterns + recipes are the single modulation language across every device. The Events tab is the first surface to fully honor it.
- **Cross-device intent** — the idea that you author once (`.feel.yml`) and the same authored intent renders correctly on whatever device the playback environment has.
- **The viewer** *(Unified Viewer)* — the shared video/audio/spectro/funscript thumbnail-sized component. Appears in every editing tab. Master clock for the whole app.
