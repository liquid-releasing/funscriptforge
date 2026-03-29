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

### Enhancements (ship with FunScriptForge)

Twelve enhancements ship with FunScriptForge. These are NOT transforms —
Tone shapes the funscript, Enhancements layer sensation onto the output
channels. They operate on completely different things and never conflict.

| Enhancement | Source event | What it does to the channels |
|---|---|---|
| **Edge** | `edge` | Tension build — pulse_freq ramp + volume buzz + pulse_width modulation |
| **Ruin** | `ruin` | Volume drops away, slow recovery — creates a hole |
| **Tranquil** | `tranquil` | Gentle volume oscillation — a breath |
| **Tease** | `mcb_tease` | Low, slow oscillation on volume |
| **Throb** | `mcb_throb` | Pulsating rhythm on volume |
| **Deny** | `mcb_denial` | Pulls back volume + locks pulse rate — creates contrast |
| **Intensity Build** | `mcb_intensity_build` | Linear volume ramp up |
| **Release** | `mcb_release` | Gradual power reduction |
| **Calm** | `mcb_calm` | Very slow sway, slightly below baseline |
| **Shift Up** | `clutch_freq_shift_up` | Carrier frequency jump — texture change |
| **Shift Down** | `clutch_freq_shift_down` | Carrier frequency drop — opposite texture |
| **Wobble** | `clutch_pulse_wobble` | Pulse width variation — tactile texture |

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

## Enhance Tab (new tab, after Stim)

### Purpose

Per-phrase event assignment. The user sees their phrases and picks which
events to apply to each one.

### Layout concept

```
┌─────────────────────────────────────────────────────────┐
│  [Full funscript visualization with phrase boundaries]  │
├────────┬──────────┬───────────┬──────────────┬──────────┤
│ Phrase │ Time     │ Duration  │ Event        │ Preview  │
├────────┼──────────┼───────────┼──────────────┼──────────┤
│ 1      │ 0:00     │ 45s       │ —            │          │
│ 2      │ 0:45     │ 1:10      │ Edge         │ [mini]   │
│ 3      │ 1:55     │ 0:30      │ —            │          │
│ 4      │ 2:25     │ 1:05      │ Freq Shift ↑ │ [mini]   │
│ ...    │          │           │              │          │
└────────┴──────────┴───────────┴──────────────┴──────────┘
```

- Funscript on top for spatial reference
- Table of phrases with suggested enhancements pre-filled
- Mini preview renders per enhancement
- User reviews, tweaks if they want, clicks **Accept**
- Accept bakes selections into export — generates `.events.yml` automatically
- No sliders for v1 — defaults are tuned
- Duration is always `phrase.end_ms - phrase.start_ms` — the enhancement fills the phrase
- "— " (blank) = no enhancement, phrase passes through unchanged
- Near-zero effort: open tab, glance, Accept

### Enhancement suggestions

We already analyze each phrase (pace, intensity, arc shape). The suggestion
engine recommends enhancements that amplify what the funscript is already doing:

| Phrase pattern | Suggested enhancement | Why |
|---|---|---|
| High energy, trending up | **Edge** or **Intensity Build** | Amplify the climax |
| Sudden drop after peak | **Ruin** or **Release** | Punctuate the comedown |
| Slow, low energy | **Tranquil** or **Calm** | Breathe with the pause |
| Long steady plateau | **Wobble** or **Throb** | Add interest to flat sections |
| Mood/texture change | **Shift Up** or **Shift Down** | Mark the transition |
| Teasing, variable pace | **Tease** | Match the playfulness |
| Sharp contrast moment | **Deny** | Heighten the contrast |

The suggestion appears as a subtle hint next to each phrase row.
User can accept, pick a different one, or leave blank. Same pattern as
Tone suggestions — analyze, recommend, let the user decide.

### Export integration

At export time, we generate the `.events.yml` from phrase assignments:

```yaml
events:
  - time: 45000        # phrase 2 start_ms
    name: edge
    params:
      duration_ms: 70000  # phrase 2 end_ms - start_ms
  - time: 145000       # phrase 4 start_ms
    name: clutch_freq_shift_up
    params:
      duration_ms: 65000
```

Then:
1. `cli.process()` — generates 10 channel files from Stim config
2. `process_events()` — applies events from generated `.events.yml`
3. Output folder has final files ready for restim

### forgegen integration (future)

The event library is the content generation seed for forgegen:
- Beat detection says "climax at 3:42" → assign `edge`
- Energy drops at 5:10 → assign nothing (let baseline carry)
- Scene texture change at 7:00 → assign `clutch_freq_shift_up`

Three layers, one catalog:
1. **FunScriptForge** (manual) — user picks events, assigns to phrases
2. **forgegen** (auto) — algorithm picks events based on analysis
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

### Phase 2: Event catalog
- [ ] Parse `config.event_definitions.yml` for starter events (edge, freq_shift, pulse_wobble)
- [ ] Render matplotlib preview cards from YAML definitions
- [ ] Build event catalog component (reusable)

### Phase 3: Enhance tab (one evening session)
- [ ] Parse phrase analysis → auto-suggest enhancements
- [ ] Phrase table with suggestions pre-filled + dropdown override
- [ ] Accept writes selections to session state
- [ ] Export generates `.events.yml` from accepted selections
- [ ] Wire into export pipeline: `cli.process()` then `process_events()`
- No sliders. No parameter UI. Defaults from YAML. Table + Accept.

### Phase 4: forgegen integration (future)
- [ ] Auto-assign events based on scene analysis
- [ ] Suggestion engine: "this phrase looks like a climax → try Edge?"
