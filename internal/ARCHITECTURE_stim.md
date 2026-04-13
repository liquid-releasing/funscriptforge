# Stim Tab Architecture

FunscriptForge wraps edger's funscript-tools workflow and makes it approachable.

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

The Stim tab and Enhance tab are the estim-specific layers of FunscriptForge.
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

| edger's workflow step | FunscriptForge surface |
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

Characters (Gentle, Reactive, Scene Builder, Unpredictable, Balanced) are set
in a JSON config file that lives in the OS app-config directory:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\funscriptforge\stim_presets.json` |
| macOS | `~/Library/Application Support/funscriptforge/stim_presets.json` |
| Linux | `$XDG_CONFIG_HOME/funscriptforge/stim_presets.json` |

The first time the user opens the Stim tab, the file is created using
funscript-tools' `BUILTIN_PRESETS` as defaults. Users can hand-edit the
file to override any field; on subsequent loads we deep-merge their
overrides over the built-ins. Custom user-defined preset names are kept,
so power users can author their own characters.

If the user file is corrupt (invalid JSON, top-level array instead of
object, etc.) the stim panel renders a warning banner at the top of the
tab so the user knows their hand-edits were ignored, and falls back to
the built-in defaults so the tab still works.

CLI commands for managing the file (no UI):

```bash
python cli.py stim-config --ensure   # write defaults if missing (idempotent)
python cli.py stim-config --show     # print the path and current contents
python cli.py stim-config --reset    # overwrite with built-in defaults
```

Reference: funscript-tools [Named config profiles](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-three-creative-decisions)
and [Automating with `--json`](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#automating-with---json).

### Layout

**Top:** Character cards (Gentle, Reactive, Scene Builder, Unpredictable,
Balanced) — same as today. Select one to set the algorithm preset.

**Middle:** Sliders bound to the selected character's slider definitions
(one row per slider, with min/max labels from the preset). Slider values
override the preset config in memory only — they do not write back to the
JSON file. For persistent overrides, hand-edit the config file.

The static electrode-path PNG renders next to the sliders as a visual
reference for the selected character. All five path PNGs are pre-cached
on first stim tab visit for instant character switching.

**Bottom:**

- [Display Selector](#display-selector)
- Preview button → runs the pipeline matching the Display Selector
- Channel previews (read from disk)
- Accept button → always generates the full set (see [Accept](#accept-button-functionality))

### Display Selector

A radio above the Preview button labelled **Stim channel display**.
This is **not** a device target — it controls how much of the pipeline
runs on Preview so the user can iterate quickly.

| Display option | Preview cost | What it shows |
|---|---|---|
| **2D (alpha + beta)** *(default)* | ~18 seconds | Input + alpha + beta only |
| **3-phase (10 channels)** | 2-3 minutes | Input + 9 channels in a 3×3 grid |

Default is **2D** because most slider iteration only needs alpha/beta to
judge the change. The user explicitly opts in to the 3-phase wait when
they're ready to fine-tune the full output.

A caption under the radio acknowledges what the user is targeting:

> 🎯 Targeting: stim device. Accept always generates the full set —
> this radio only changes how much you see while editing.

**4-phase (FOC) is intentionally not offered.** FOC users graduate to
funscript-tools directly — same gateway pattern as advanced enchantments.

> **Note on restim:** restim consumes the generated funscript files at
> export time, not from this tab. The Display Selector only affects what
> we render in the preview area.

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

### Channel previews

Layout depends on the [Display Selector](#display-selector) choice.

**Display 2D** — Input + alpha + beta only:

```text
[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ]
```

See [funscript_1d_to_2d.py](https://github.com/edger477/funscript-tools/blob/main/processing/funscript_1d_to_2d.py)
for the alpha/beta computation. We use defaults.

**Display 3-phase** — Input + 9 channels in a 3×3 grid grouped by function:

```text
[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ] [ Pulse freq   ]
[ Frequency    ] [ Volume       ] [ Pulse rise   ]
[ Alpha prost. ] [ Beta prost.  ] [ Vol. prost.  ]
```

Compact, all visible at once. The input stays full-width on top as the
reference. Each row is a logical group: position channels, modulation
channels, prostate variants.

#### funscript generation test results times

Response for VictoriaOaks (~30-minute funscript):

| Technique | Time | Note |
| --- | --- | --- |
| convert to 2D basic | 18 seconds | alpha and beta only |
| process to 3-phase | 2-3 minutes | full 10-file output |

## Accept button functionality

Accept **always generates the full set** of channel files — alpha, beta,
prostate variants, frequency, pulse_frequency, pulse_width, pulse_rise,
volume, volume-prostate. The cost to the user is waiting for everything
to be generated; the benefit is that **device selection is deferred to
the Export tab**, where the user picks which subset of files to copy
into per-device output folders without re-running the pipeline.

Optimization: when the user has just run Preview with the same config
hash, Accept reuses the preview files instead of regenerating them. The
common path (Preview to verify, then Accept) is therefore close to free.

Settings (character + slider values) are saved to the project file so
the same settings are reused on Export.

### Export behavior

Export uses funscript-tools to generate the [ten output files](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-ten-output-files).
restim consumes these files at export time, not from the Stim tab.

The Export tab's `_do_export_to_folders` (in `ui/streamlit/panels/export_panel.py`)
calls `forge.funscript_tools.process()` directly when `forge_project["stim_character"]`
is set. It first checks `list_outputs()` for files already produced by Stim
Accept and reuses them; otherwise it runs the full pipeline against the
just-written main funscript at the output folder. This means Export
produces channel files even when the user skipped the Stim tab's Accept
button, as long as a preset has been selected.

## Future work (after user testing)

### Documentation: Three creative decisions reference

The Stim tab user docs should describe what the sliders mean using
funscript-tools' [three creative decisions](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-three-creative-decisions)
framing. Sketch of the table to build out:

| Decision | Description | Example value | Visual | Result |
| --- | --- | --- | --- | --- |
| **Min distance** | `min_distance_from_center` (0.1–0.9). Higher = wider sweep, more pronounced movement. | low (0.1) | `████░░░░░░` | electrode stays near center — subtle |
| **Frequency blend** | Blend of scene energy (ramp) vs action speed. Lower ratio = reactive; higher = scene-building. | ratio 5 | `████████░░` | 50/50 — balanced default |
| **Pulse width** | How long each pulse lasts. Min/max sweep based on intensity. | wide | `▐███████▌` | long, full pulses — "filled in" sensation |
| **Pulse rise (attack)** | How the pulse attacks. Min/max sweep based on intensity. | sharp | `▐█▌ ▐█▌` | immediate onset, hard edge |

This is **future work** — write the docs after user testing tells us
which decisions need the most explanation.

## References

### User creative decisions

We support the creative decisions documented in funscript-tools:

- [Algorithm — where the sensation moves](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#1-algorithm--where-the-sensation-moves)
- [Key config settings](https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#key-config-settings)

### Output best practices

[FUNDAMENTAL_OPERATIONS.md](https://github.com/edger477/funscript-tools/blob/main/FUNDAMENTAL_OPERATIONS.md#iv-best-practices)
