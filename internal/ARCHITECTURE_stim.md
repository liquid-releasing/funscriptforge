# Stim Tab Architecture

FunScriptForge wraps edger's funscript-tools workflow and makes it approachable.

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
| --- | --- |
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

### Config files

Characters (Gentle, Reactive, Scene Builder, Unpredictable, Balanced) are set in config files.

The first time the user goes to this tab, the config files are generated and put into a folder used by the application. Users can hand edit the config files themselves. 

We generate defaults. (No need to provide an editor or sliders)

[Named config profiles](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-three-creative-decisions)

Config files are saved using [Automatin with `--json`](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#automating-with---json)

Use the currrent defaults we use for Gentle, Reactive, Scene Builder, Unpredictable, Balanced

### Layout

**Top:** Character cards (Gentle, Reactive, Scene Builder, Unpredictable, Balanced)
— same as today. Select one to set the algorithm preset.

**Middle:**

Display the two most relevant sliders for the user to change.

Instead, we read the config file selected and display png charts of the named config in the documentation.

**Bottom:** 

- [Device Selector](#device-selector)
- [Bottom section](#bottom-section)

### Device Selector

User picks their device target. This determines which output files get generated:

| Device target | Output files | Notes |
|---|---|---|
| **2-channel (2B, legacy)** | alpha, beta | 18 seconds to generate |
| **3-phase (stereo stim)** | alpha, beta, prostate variants, frequency, pulse_frequency, pulse_width, pulse_rise, volume, volume-prostate (10 files) | 2-3 minutes. Default for most users. |
| **4-phase (FOC, experimental)** | All 3-phase + E1-E4 motion axes (14 files) | Not active selection |

Each device bucket shows its expected output file list so the user knows what they'll get before committing.

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

#### Documentation update

The sim tab documents should describe what the sliders mean.

The charts display the [Three creative decisions](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-three-creative-decisions) such as

| | Description | Value | Chart | Result | Notes |
| - | - | - | - | - | - |
| **Min distance** | The `min_distance_from_center` config setting (0.1–0.9) controls how far from center the electrode can range. Higher = wider sweep, more pronounced movement. | low (0.1) | ████░░░░░░   | electrode stays near center — subtle | |
| **Frequency blend** | The frequency output is a blend of two signals:<p/>
**Scene energy (ramp):** A slow-building intensity curve that rises and falls with the overall pace of a scene. Think of it as the "mood arc."<p/>**Action speed:** Direct tracking of how fast the source funscript is moving.<p/>
  Fast strokes → faster pulse rate, immediately. | ratio 5 |  ████████░░░░  | 50% / 50%  ← default, balanced | **Rule of thumb:**
- Fast, intense content → lower ratio (reactive)
- Slow, scene-building content → higher ratio (gradual build)
- Mixed content → default (5)|
| **Pulse shape: Width** | how long each pulse lasts | wide    |▐███████▌   |  long, full pulses — more "filled in" sensation | The config sets a min and max for width — the output file sweeps between them based
on the source funscript's intensity. |
| ((Rise time: Attack)) | how the pulse attacks |  ▐█▌  ▐█▌ <p>   ▐/▌  ▐\▌ | immediate onset, hard edge | The config sets a min and max for attack — the output file sweeps between them based on the source funscript's intensity. |

The values in the value and chart columns reflect the user decision on the character selected.

### Bottom section

default is two-phase

#### Display 2d shows original, alpha and beta only

Rows of the original and preview

[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ]

see [funscript_1d_to_2d.py](https://github.com/edger477/funscript-tools/blob/main/processing/funscript_1d_to_2d.py) to calculate the 2d values. Use defaults.

#### Display 3 phase

as described in notes. three-column layout makes sense for the channels:

[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ] [ Pulse freq   ]
[ Frequency    ] [ Volume       ] [ Pulse rise    ]
[ Alpha prost. ] [ Beta prost.  ] [ Vol. prost.   ]

Compact, all visible at once, grouped by function. The input stays full-width on top as the reference. Each row is a logical group: position channels, modulation channels, prostate variants.

#### No display ooption for 4 phase

Use three phase.

#### funscript generation test results times

Response for victoriaoaks

| Technique | time | note |
| - | - | - |
| convert to 2d basic | 18seconds | alpha and beta only |
| process to 3p | 2 or 3 minutes | this is what we do i think.  10 files |

## Accept button response

Radio above Accept

- Generate 2d (for 2b, 312)
- Generate 3-phase (for stereo stim, Tingler, ZC95, NeoStim, FOC-Stim)
- Generate all including 4-phase (for Foc-Stim)

### Accept button functionality

Save the funscripts into our temp folder for copying into folders during export. No regeneration for export.

Remember which selection the user made. We will reuse it on export.

### Export behavior

And when we export, we use funscript-tools to generate some of the files. (the 10 documented ones). https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-ten-output-files

## References

### User creative decisions

We support the creative decisions:
- https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#1-algorithm--where-the-sensation-moves

what he thinks users want to change
- https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#key-config-settings

### output best practices

https://github.com/edger477/funscript-tools/blob/main/FUNDAMENTAL_OPERATIONS.md#iv-best-practices

## Bug fixes

9. Old chain files in output — pre-.forge/ projects still have _funscript_*.json at top level
10. Stim 20s to respond to character selection — pre-cache path PNGs
