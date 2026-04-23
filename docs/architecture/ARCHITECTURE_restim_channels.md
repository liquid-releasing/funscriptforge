# Architecture: restim Canonical Channels

## Overview

[restim](https://github.com/diglet48/restim) is the estim audio engine FunscriptForge uses (via funscript-tools) to synthesize estim audio from funscripts. This doc is the authoritative list of **which funscript filenames restim actually recognizes**, plus the distinction between restim-canonical names and the community-organization suffixes that exist above restim's layer.

This matters for FunscriptForge because our exported filenames must match restim's recognized suffixes — otherwise downstream consumers won't pick up our channel outputs.

## Canonical channel list

restim auto-detects funscript files by matching the pattern `{stem}.{channel}.funscript`. The channels it recognizes, grouped by role:

| Group | Channels |
|---|---|
| **Position (3-phase)** | `alpha`, `beta`, `gamma` |
| **Pulse parameters** | `pulse_frequency`, `pulse_width`, `pulse_rise_time`, `pulse_interval_random` |
| **Frequency / volume** | `frequency` (carrier), `volume` |
| **4-phase electrode intensity** | `e1`, `e2`, `e3`, `e4` |
| **Vibration motor 1** | `vib1_frequency`, `vib1_strength`, `vib1_left_right_bias`, `vib1_up_down_bias`, `vib1_random` |
| **Vibration motor 2** | `vib2_frequency`, `vib2_strength`, `vib2_left_right_bias`, `vib2_up_down_bias`, `vib2_random` |

**Any filename outside this list won't be picked up by restim.** It's parsed by `qt_ui/models/funscript_kit.py` + `funscript/collect_funscripts.py`.

## Subchannel modifiers — ours, not restim's

The community convention `-prostate`, `-stereostim`, `-foc-stim`, `-2b` (e.g. `scene.volume-stereostim.funscript`) is **content-organization metadata**, not a restim-recognized format.

restim's filename parser splits on the last dot and would treat `volume-stereostim` as a literal unknown channel name — **it would fail to match `volume`**. These suffixes are consumed by a layer ABOVE restim (a player, a picker, an assembly tool).

Flow:

```
FunscriptForge emits: scene.volume-stereostim.funscript   (stereostim-tuned variant)
                      scene.volume-foc-stim.funscript     (FOC-stim-tuned variant)
                             ↓  [ForgePlayer or user picks one via device profile]
                             ↓  [suffix stripped, plain name used]
restim receives:      scene.volume.funscript (plain)
```

## Legacy `.funscript` handling

`restim/funscript_1d_to_2d.py` converts a plain `.funscript` (1D position) into `.alpha` + `.beta` via radial interpolation in stim-math's 2D coordinate space. So:

- A plain `.funscript` CAN be played as estim — restim converts it on the fly
- The "2b" device in the ecosystem is served by this legacy conversion path
- FunscriptForge's output for legacy-only scenes is often just `{stem}.funscript` (no channel suffix)

## Device type vs. channel presence

restim has a unified pipeline; **device type selection picks the algorithm**, not the file list. Options:

| Device type | Notes |
|---|---|
| `AUDIO_THREE_PHASE` | 3-phase stereo (alpha + beta) |
| `FOCSTIM_THREE_PHASE` | 3-phase FOC-stim hardware |
| `FOCSTIM_FOUR_PHASE` | 4-phase FOC-stim (uses e1–e4, or derives from alpha+beta+gamma) |
| `NEOSTIM_THREE_PHASE` | NeoStim hardware |

There is **no "stereostim mode" vs "foc-stim mode" toggle inside restim**. The upstream tool (FunscriptForge's export, ForgePlayer's routing) configures the device type before restim runs.

## Implications for FunscriptForge

- **Estim export names must use the plain canonical suffixes.** `alpha`, `beta`, `pulse_frequency`, `volume`, etc. — no subchannel modifiers in the output filenames consumed by restim.
- **Device-generation variants** — if FunscriptForge produces multiple encodings for the same channel (one tuned for stereostim, one for FOC-stim), name them with `-stereostim` / `-foc-stim` subchannel suffixes. These files are NOT restim-consumable directly; they're meta-variants for ForgePlayer / ForgeAssembler to pick among.
- **Multi-axis channels** (`roll`, `pitch`, `twist`, `surge`, `sway`) are NOT restim's domain — they target SR6-class mechanical hardware or VR alignment. Export them alongside estim outputs; they route to different consumers.
- **4-phase electrode support** — if FunscriptForge ever generates 4-phase FOC-stim output, use `e1` / `e2` / `e3` / `e4` suffixes. restim supports these natively.
- **Vibration motor channels** — if generating vibration-motor content (Lovense, etc.), use the `vib1_*` / `vib2_*` suffix family.

## Re-derivation

If restim updates its channel list (adds new parameters, changes names), re-derive from:

- `qt_ui/models/funscript_kit.py` — default channel enum members
- `qt_ui/device_wizard/axes.py` — `AxisEnum` full list
- `funscript/collect_funscripts.py` — filename-suffix parsing (`split_funscript_path()`)

Any changes → update this doc + the sibling memory `reference_restim_canonical_channels.md` + ForgePlayer's mirror of this doc.
