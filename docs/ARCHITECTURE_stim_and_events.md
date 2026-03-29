# Stim Tab & Enhance Tab Architecture

> FunScriptForge wraps edger's funscript-tools workflow and makes it approachable.
> We are the gateway into more sophisticated work that funscript-tools enables.

## How users should think about it

Your funscript describes **what happens** — strokes, speed, rhythm.

The **Stim tab** decides **how that feels** — where the sensation moves,
how sharp or gentle, how the intensity builds. Pick a style, see a preview,
done.

The **Enhance tab** adds **moments** — an edge here, a texture change there.
These enhance what's already playing. They don't replace the funscript,
they layer on top of it at the phrases you choose.

That's it: **what happens → how it feels → special moments.**

The Enhance tab lets casual users implement feels that previously required
hand-editing YAML, understanding signal processing, or reverse-engineering
hardware protocols. The complexity behind Edge, Throb, Deny — that's real
engineering by edger and AquariumParrot. But the user just sees a name,
a suggestion, and an Accept button.

Everything below is implementation detail.

---

## Overview

The Stim tab and Enhance tab are the estim-specific layers of FunScriptForge.
They sit after the funscript chain (Original → Device → Tone → Phrases) and
control how the funscript translates into multi-channel electrical stimulation.

```
Our chain:   Original → Device → Tone → Phrases
                                           ↓
Stim tab:    User picks algorithm + creative knobs (global settings)
                                           ↓
Enhance tab:  User assigns events to phrases (per-phrase channel effects)
                                           ↓
Export:      cli.process() → 10 channel files → process_events() enhances them → final output
```

## Relationship to funscript-tools

We wrap edger's exposed workflow — not cherry-picked parameters:

| edger's workflow step | FunScriptForge surface |
|---|---|
| Load funscript | **Project tab** (already done) |
| Configure (algorithm, freq, pulse, volume) | **Stim tab** — our UI over his config |
| Process (generate output files) | **Export** — calls `cli.process()` |
| Apply custom events at timecodes | **Enhance tab** — our phrase editor generates `.events.yml` |

Credit where due: funscript-tools is edger's work. The MCB and Clutch event
libraries are reverse-engineered by AquariumParrot from their respective
SuperCollider scripts. We build the usability layer.

## Stim Tab Design

### Purpose
Global estim configuration. User makes three creative decisions that control
how the funscript maps to electrical stimulation channels.

### Layout

**Top:** Character cards (Gentle, Reactive, Scene Builder, Unpredictable, Balanced)
— same as today. Select one to set the algorithm preset.

**Middle:** Sliders with live matplotlib preview

```
┌──────────────────────┬─────────────────────────────────┐
│                      │                                 │
│   [Matplotlib        │   Slider: Sweep width           │
│    preview with      │   ─────────●──────────          │
│    fixed 0-1 axes]   │                                 │
│                      │   Slider: Build speed            │
│   Updates live as    │   ──────────────●─────          │
│   sliders move.      │                                 │
│   User sees the      │   Slider: ...                   │
│   delta.             │                                 │
│                      │                                 │
└──────────────────────┴─────────────────────────────────┘
```

Key: Matplotlib on the LEFT with fixed x/y axes so the user can see how much
each slider changes the output. Replaces Plotly path chart.

**Bottom:** Device selector → expected output files

### Device Selector

User picks their device target. This determines which output files get generated:

| Device target | Output files | Notes |
|---|---|---|
| **2-channel (2B, legacy)** | alpha, beta | 18 seconds to generate |
| **3-phase (stereo stim)** | alpha, beta, prostate variants, frequency, pulse_frequency, pulse_width, pulse_rise, volume, volume-prostate (10 files) | 2-3 minutes. Default for most users. |
| **4-phase (FOC, experimental)** | All 3-phase + E1-E4 motion axes (14 files) | Several minutes. New FOC hardware only. |

Each device bucket shows its expected output file list so the user knows
what they'll get before committing.

> **Open question:** How does restim consume these files per device type?
> Must test before locking device buckets.

### Character → Config Mapping

Characters are presets over funscript-tools config. Each maps to:
- `alpha_beta_generation.algorithm` (circular, top-left-right, top-right-left, restim-original)
- Frequency blend ratios (`ramp_combine_ratio`, `pulse_combine_ratio`)
- Pulse shape (`pulse_width_min/max`, `pulse_rise_min/max`)
- Points per second, speed threshold, direction change probability

Power users expand to see the underlying config. Defaults handle 80% of cases.

### Preview Functions (no I/O)

funscript-tools exposes three preview functions callable without processing:
- `cli.preview_electrode_path()` — algorithm path visualization
- `cli.preview_frequency_blend()` — frequency blending strategy
- `cli.preview_pulse_shape()` — pulse characteristics

These power the live matplotlib previews on the Stim tab.

## Enhancement System

### What enhancements are

Enhancements are **composable, multi-axis effects** applied to the generated
output channel files at specific timecodes. They are NOT funscript transforms
— they operate on alpha, beta, volume, pulse_frequency, pulse_width, and
frequency channels AFTER `cli.process()` generates them.

Each event is a sequence of operations:
- `apply_linear_change` — linear ramp on an axis (with ramp_in/ramp_out)
- `apply_modulation` — sinusoidal/waveform modulation on an axis

Events don't rebuild the funscript — they **enhance** it. The baseline channels
carry the funscript's intent; events layer additional sensation on top
(additive mode is the default for most events).

Events are **composable**: multiple events at the same timecode hit different
axes. Edge builds tension on volume/pulse, freq_shift changes texture,
pulse_wobble changes feel — all stackable.

### Processing order

```
cli.process()        → generates baseline channel files
process_events()     → modifies those files at phrase timecodes
                       (reads .events.yml, applies to channel .funscript files)
```

Sequential, not separate. Events enhance the generated channels — they layer
on top of the baseline, they don't replace it.

### Enchantments (ship with FunScriptForge)

Ten enchantments ship with FunScriptForge — the General events from
funscript-tools v2.2.0. These are NOT funscript transforms — Tone shapes
the funscript, Enchantments layer sensation onto the output channels.
They operate on completely different things and never conflict.

Three families:

**Buzz family** — modulate volume + pulse to create intensity effects:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Cum** | Release — high pulse, slow 1.5Hz throb, wide pulse sweep | volume_boost: +0.2, pulse_freq: 90→80 | additive |
| **Edge** | Tension build — pulse ramp, 10Hz volume buzz | volume_boost: +0.15, pulse_freq: 40→50 | additive |
| **Stay** | Hold — locked high pulse, subtle 15Hz hum | volume_boost: +0.1, pulse_freq: +80 | additive |

**Stroke family** — modulate alpha (spatial movement) + volume:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Slow** | Pull back — quarter-speed alpha, volume reduction | stroke_freq: 0.25, volume_boost: -0.1 | additive |
| **Medium** | Neutral — moderate movement, no volume change | stroke_freq: 1.0, volume_boost: 0.0 | additive |
| **Fast** | Speed up — fast alpha, volume push | stroke_freq: 2.0, volume_boost: +0.03 | additive |
| **Lube** | Ease off — gentle movement, pull back intensity | stroke_freq: 0.5, volume_boost: -0.1 | additive |

**Control family** — overwrite or gently shape the signal:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Ruin** | Kill — volume to zero, 10s ramp recovery | duration: 30s, ramp_in: 10s | overwrite |
| **Stop** | Floor — volume to minimum, hold | duration: 30s, vol: 0.05→0.1 | overwrite |
| **Tranquil** | Breathe — gentle 15Hz volume oscillation | duration: 20s, osc_amplitude: 0.5 | additive |

Users can add more enchantments from edger's MCB and Clutch libraries
(30+ events, credit: AquariumParrot). We ship the basics, docs show how
to extend.

### User controls per enchantment

Only two sliders in our UI:
- **Duration** — how long the effect lasts (default from YAML)
- **Intensity** — scales volume_boost / buzz_intensity / stroke_intensity
  proportionally (maps to the right params behind the scenes)

Ruin and Stop only need Duration (they're already all-or-nothing).
Event Time comes from the video player position — no typing.

### Why these don't duplicate Tone

Tone operates on the **funscript** (position data, timing, rhythm).
Enhancements operate on the **output channels** (volume, pulse_frequency,
frequency, pulse_width, alpha, beta). Different layers entirely.

A phrase can have Tone "Gentle" AND Enhancement "Edge" — Tone shapes the
stroke pattern, Edge layers tension onto the electrical channels. No conflict.

### Advanced event library (gateway to funscript-tools)

The full catalog (30+ events including MCB and Clutch libraries by
AquariumParrot) lives in funscript-tools. Power users can access them
through edger's Custom Event Builder:

> "Want more enhancements? funscript-tools has 30+ events including
> reverse-engineered effects from MCB and Clutch hardware.
> [Link to funscript-tools]"

We are the gateway. Power users graduate to the full toolkit.

### The `.events.yml` is an export artifact

We export the generated `.events.yml` alongside the channel files in the
output folder. It's human-readable YAML. The user can:

1. **Edit by hand** — tweak timing, swap events, adjust params
2. **Open in edger's Custom Event Builder** — full visual editor with
   access to all 30+ events, parameter controls, timeline view
3. **Re-run `process_events()`** — apply their changes without re-exporting

This is the graduation path. We make it easy, the YAML makes it portable,
edger's tools make it powerful. The user's work isn't locked in our UI.

### Event catalog visualization

Each event is deterministic math — `apply_linear_change` and `apply_modulation`
with known parameters. We render previews directly from the YAML definitions
without touching any funscript data.

```
┌─────────────────────────────────────────┐
│  Edge                                   │
│  "Builds tension across multiple        │
│   channels simultaneously"              │
│                                         │
│  pulse_freq   ╱‾‾‾‾‾‾‾‾‾‾‾             │
│  volume       ∿∿∿∿∿∿∿∿∿∿∿∿             │
│  pulse_width  ∿∿∿∿∿∿∿∿∿∿∿∿             │
│                                         │
│  Duration: 15s    Mode: additive        │
│  Axes: pulse_frequency, volume,         │
│        volume-prostate, pulse_width     │
└─────────────────────────────────────────┘
```

Each catalog card shows:
- **Name + description** — what it feels like
- **Matplotlib mini-charts** per axis it touches (fixed x = 0 to duration, fixed y = 0 to 1)
- **Duration and mode** (additive vs overwrite)
- **Axes affected** — so user knows what channels change

Previews generate automatically from YAML. If edger adds a new event, the
preview renders without code changes.

### Event axis coverage

No single event is comprehensive — they're surgical by design:

| Event | pulse_freq | volume | alpha | beta | frequency | pulse_width |
|---|---|---|---|---|---|---|
| edge | X | X | | | | X |
| freq_shift | | | | | X | |
| pulse_wobble | | | | | | X |
| mcb_edge_ce | X | X | X | X | | |

This is the composability model. Stack events to cover more axes.

## Enchantment Tab (new tab, after Stim)

### Purpose

Point-in-time enchantment placement. The user watches the video within a
phrase, stops at the moment something happens, and drops an enchantment
on that exact timecode. Enchantments are moments, not phrase-wide blankets.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Phrase selector]  ◄ Phrase 3 of 20 ►                      │
├─────────────────────────────────────────────────────────────┤
│  [Funscript waveform — scoped to selected phrase]           │
├─────────────────────────────────┬───────────────────────────┤
│   Editing Phrase 3                                          │
│   Tone: Tease | Transforms: Halve, Normalize                │
│   Stim: Reactive                                            │
│   [Video player]                │   Enchantment catalog     │
│   Scoped to current phrase      │                           │
│   Shows 30-90s, not 2 hours     │   ○ Cum                  │
│                                 │   ○ Edge                 │
│   [━━━━━━●━━━━━━━━━]            │   ○ Fast                 │
│   1:45        2:15              │   ○ Lube                 │
│                                 │   ○ Medium               │
│   Timecode: 1:52.300            │   ○ Slow                 │
│                                 │   ○ Stay                 │
│                                 │   ○ Ruin                 │
│                                 │   ○ Stop                 │
│                                 │   ○ Tranquil             │
│                                 │                           │
│                                 │  [Duration  ━━━●━━━━]     │
│                                 │  [Intensity ━━━━●━━]      │
│                                 │                           │
│                                 │  [+ Add]                  │
│   ┌─ Active: Edge (1:52-2:07) 🗑─┐                          │
│   └──────────────────────────────┘                          │
├─────────────────────────────────┴───────────────────────────┤
│                                                             │
│  ┌──────────┬──────────────┬──────────┬───┐                 │
│  │ Timecode │ Enchantment  │ Duration │   │                 │
│  ├──────────┼──────────────┼──────────┼───┤                 │
│  │ 1:52     │ Edge         │ 15s      │ 🗑 │                │
│  │ 2:03     │ Cum          │ 15s      │ 🗑 │                │
│  │ 2:41     │ Tranquil     │ 20s      │ 🗑 │                │
│  └──────────┴──────────────┴──────────┴───┘                 │
│                                                             │
│                        [Accept]                             │
└─────────────────────────────────────────────────────────────┘
```

### Workflow

1. **Pick a phrase** from the selector → everything scopes to that chunk
2. **Watch the video** within that phrase — stop at the moment
3. **Click an enchantment** from the catalog list
4. **Adjust Duration / Intensity** if you want (defaults are fine)
5. **Click Add** → row appears in the table, video positions to end of the enchantment (timecode + duration). User sees exactly where the effect ends — no mental math. They can keep watching forward, rewind, or place another enchantment right there.
6. **Repeat** for other moments in this phrase
7. **Next phrase** — table shows that phrase's enchantments (previous phrase's work is kept automatically)
8. When done with all phrases, **Accept** → saves merged `.events.yml` to the working folder

### Key design decisions

- **Phrase-scoped everything** — video, funscript, table all show only the
  current phrase. You never get lost in a two-hour video.
- **The table IS the YAML** — each row maps to one event entry. What you
  see is what gets exported. The table for each phrase shows only that
  phrase's enchantments.
- **Two sliders, not five** — Duration and Intensity. Intensity scales
  the right params behind the scenes (volume_boost, buzz_intensity,
  stroke_intensity depending on the enchantment family).
- **Timecode from video** — stop the video, click Add. No millisecond typing.
- **No video? Still works** — timecode input field appears. User clicks
  the funscript waveform or types the time manually.
- **Live active enchantment display** — as the video plays, the area
  below the timecode shows which enchantment is currently active and its
  time range. When the playhead is in a gap, it's empty (ready to add).
  Trashcan right there for quick removal without scrolling to the table.
  You see enchantments light up as you watch the phrase.
- **Overlap prevention** — can't place an enchantment where one already
  exists. Add is disabled when playhead is inside an active enchantment.
- **One enchantment per timecode** — no stacking in v1. The YAML format
  supports composing multiple events at the same timecode, but we don't
  expose that until we understand axis overlap behavior. Power users can
  stack by editing the exported `.events.yml` directly.
- **Implied acceptance** — adding a row saves it in session. Switching
  phrases keeps your work. No per-row or per-phrase accept. The final
  Accept at the bottom saves everything to `.events.yml` at once.
- **Trashcan removes a row** — simple, no confirmation needed.
- **Extensible catalog** — users can add MCB, Clutch, or custom events.
  If the YAML definitions are present, they show up in the catalog list.
  We ship the 10 basics. Docs show how to add more.

### Export integration

Accept saves the `.events.yml` per phrase to the working folder.
At export time, all phrase `.events.yml` files merge into one:

```yaml
events:
  - time: 112300       # absolute timecode from phrase 3
    name: edge
    params:
      duration_ms: 15000
  - time: 123000
    name: cum
    params:
      duration_ms: 15000
  - time: 161000
    name: tranquil
    params:
      duration_ms: 20000
```

Then:
1. `cli.process()` — generates 10 channel files from Stim config
2. `process_events()` — applies enchantments from merged `.events.yml`
3. Output folder has final files + the `.events.yml` (editable, portable)

### forgegen integration (future)

The enchantment catalog is the content generation seed for forgegen:
- Beat detection says "hit at 3:42.300" → place `edge` at that timecode
- Energy drops at 5:10 → place `tranquil`
- Scene texture change at 7:00 → place `fast`

Three layers, one catalog:
1. **FunScriptForge** (manual) — user watches video, places enchantments
2. **forgegen** (auto) — algorithm places enchantments based on analysis
3. **funscript-tools** (engine) — executes them all via `process_events()`

## Processing Time Budget

| Step | Victoria Oaks benchmark | When it runs |
|---|---|---|
| Stim preview | Instant | Stim tab (preview functions, no I/O) |
| 2D generation | ~18 seconds | Export (alpha + beta only) |
| 3-phase generation | 2-3 minutes | Export (10 files) |
| Event application | Seconds | Export (after generation) |

Stim tab is interactive. Export is async with progress bar.

## Implementation Plan

### Phase 1: Stim tab refinement (current)
- [ ] Replace Plotly path chart with matplotlib (fixed axes, live update)
- [ ] Add device selector with expected output file list
- [ ] Wire `cli.preview_*()` functions for live previews
- [ ] Test restim device consumption to validate device buckets

### Phase 2: Enchantment catalog
- [ ] Parse `config.event_definitions.yml` for the 10 basic enchantments
- [ ] Render matplotlib preview cards from YAML definitions
- [ ] Build enchantment catalog component (reusable list)

### Phase 3: Enchantment tab (one evening session)
- [ ] Phrase selector scoping (video + funscript + table per phrase)
- [ ] Video player scoped to phrase time range
- [ ] Enchantment catalog list with click-to-select
- [ ] Duration + Intensity sliders (two only)
- [ ] Add button → row in table (timecode from video position)
- [ ] Trashcan delete per row
- [ ] Accept saves merged `.events.yml` to working folder
- [ ] Wire into export pipeline: `cli.process()` then `process_events()`
- [ ] Docs: how to add custom enchantments (MCB, Clutch, user-defined)

### Phase 4: forgegen integration (future)
- [ ] Auto-assign events based on scene analysis
- [ ] Suggestion engine: "this phrase looks like a climax → try Edge?"
