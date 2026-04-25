# Modulation architecture

How channel funscripts (volume, frequency, pulse_*, alpha, beta) are
modulated to create perceived effects. This is the layer **between**
the funscript content and the audio synthesizer — what shapes a flat
script into a sensation with rhythm, tension, and release.

This doc captures findings from external research (Edger's
`funscript-tools` design, restim's pulse/continuous algorithms,
ForgePlayer's real-time playback testing) so we can build a
first-class **modulation** feature in FunscriptForge that's aware of
how downstream synths actually consume our output.

Sibling: [ARCHITECTURE_stim_and_events.md](ARCHITECTURE_stim_and_events.md)
covers the existing **enchantment** system (10 ship-with-product
events). This doc covers the more general modulation primitives that
the enchantments are made of, plus channel-by-channel synthesis-side
behavior we need to honor.

## Edger's modulation primitive (`apply_modulation`)

Source: `funscript-tools/FUNDAMENTAL_OPERATIONS.md` (Edger's repo).

`apply_modulation` is the workhorse. It overlays a generated waveform
on a target axis for a duration:

```
apply_modulation(
    axis: "volume",                 # or pulse_frequency, pulse_width, alpha, beta
    duration_ms: 5000,
    waveform: "sin",                # sin / square / triangle / sawtooth
    frequency: 15,                  # Hz — how fast the modulation oscillates
    amplitude: 0.35,                # axis-units; 0..1 for volume
    max_level_offset: 0.0,          # peak relative to original (additive) or absolute (overwrite)
    phase: 0.0,                     # degrees, starting phase
    duty_cycle: 0.5,                # for square only
    mode: "additive",               # additive layers on existing values; overwrite replaces
    ramp_in_ms: 0, ramp_out_ms: 0,  # fade envelopes
)
```

Multi-axis targeting is built in: `axis: "volume,volume-prostate"`
applies the same modulation to multiple files at once. This is how
Edger keeps the main and prostate channels synchronized through the
same effect.

### The three families of modulation effect

These map to FunscriptForge's existing **enchantment** taxonomy
(see [ARCHITECTURE_stim_and_events.md:170](ARCHITECTURE_stim_and_events.md)):

| Family | Target axis | Frequency band | Perceived as |
|---|---|---|---|
| **Buzz** | volume | 10-65 Hz oscillation | Hum, vibration, rapid pulsing |
| **Stroke** | alpha | 0.25-2 Hz oscillation | Slow, medium, fast strokes |
| **Control** | volume | DC + slow ramps | Stop, ruin, tranquil |

The underlying primitive is the same — `apply_modulation` — only the
axis and frequency band differ.

### Sampling aliasing trap (non-obvious)

Edger explicitly warns: **avoid modulation frequencies at multiples
of 10 Hz** (10, 20, 30, 60). Funscripts are typically authored at a
~10 Hz action grid, and an aliased frequency lands every action point
at the same waveform phase, producing zero net modulation.

Use 9, 11, 15, 21, 23, 65 Hz instead.

This is a content-authoring concern, but the modulation feature in
FunscriptForge should warn or auto-snap to these "safe" frequencies
when the user types a multiple-of-10 value.

## Channel normalization scales (Edger's authoring contract)

From `funscript-tools/FUNDAMENTAL_OPERATIONS.md:23-40`. Funscripts
store `pos` as 0..100 ints; the values map to channel-specific units:

| Channel | Funscript 1.0 means | Authoring unit |
|---|---|---|
| `volume` | 1.0 | normalized 0..1 |
| `frequency` (carrier) | 1200 Hz | Hz (max 1200) |
| `pulse_frequency` | 200 Hz | Hz (max 200) |
| `pulse_width` | 100% | percent (max 100) |
| `pulse_rise_time` | (TBD) | (TBD) |

**Implication for any synth that consumes our output**: scale the 0..1
value to the channel's native unit using these maxes. `frequency`
specifically uses `max=1200`, NOT restim's safety range (500-1000).
The synth applies safety clamping later; the funscript's *intent* is
0..1200 Hz.

ForgePlayer's stim_synth previously used 500-1000 for `_CARRIER_RANGE`
and produced wrong output for varying-carrier scenes. Match the
authoring scale.

## Synthesis-side behavior we have to honor

restim has two algorithms with different sampling discipline. Edger's
modulation primitives interact with them differently:

### Continuous (`ThreePhaseAlgorithm`)

Samples carrier_frequency **once per audio chunk** ([restim/stim_math/audio_gen/continuous.py:43](https://github.com/diglet48/restim/blob/main/stim_math/audio_gen/continuous.py#L43)).
Position (alpha, beta) and volume are sampled per-sample (full array).

**Consequence**: a varying carrier funscript creates audible
chunk-boundary frequency-step artifacts (a "horse-hoof" buzz at the
chunk-rate, e.g. 10.7 Hz at 4096-frame blocks @ 44.1 kHz). FunscriptForge's
own MP3 renderer ([forge/audio_synthesis.py:64](../../forge/audio_synthesis.py))
sidesteps this by defaulting to a constant 700 Hz carrier and never
loading `frequency.funscript` unless explicitly passed a path.

For a real-time synth (e.g. ForgePlayer's continuous mode):
- Drop `frequency.funscript` and use a constant carrier — matches
  FunscriptForge's MP3 default.
- Or switch to pulse-based mode if the scene's intent really needs
  varying carrier.

### Pulse-based (`DefaultThreePhasePulseBasedAlgorithm`)

Samples carrier_frequency **per audio sample** ([restim/stim_math/audio_gen/pulse_based.py:121](https://github.com/diglet48/restim/blob/main/stim_math/audio_gen/pulse_based.py#L121)).
No chunk-step artifact.

Pulse-based is the only place where varying carrier funscripts work
correctly. FunscriptForge's pulse-mode MP3 render does honor
`frequency.funscript`.

### Volume modulation works in both modes

Volume is interpolated per-sample in both continuous and pulse-based,
so high-rate (10-65 Hz) volume modulations — Edger's "buzz" family —
ride through to the audio cleanly. The buzz is real and intentional,
not an artifact.

## Device-family volume scaling

Empirical observation from `liquid-releasing/forgeplayer/test_media/Zer0 Game/COMPARISON.md`:
the same hand-coded scene shipped in `foc/` and `stereostim/`
subfolders. **8 of 10 funscripts are byte-identical**. Only
`volume.funscript` and `volume-prostate.funscript` differ. Stereostim
runs ~+6 pos higher (median) than the FOC-stim variant, with
section-by-section fine-tuning. Both share alpha/beta/pulse_*/carrier.

**Interpretation**: the scripter authored ONE motion choreography and
ONE waveform-shape program; the volume curve is hardware-response
compensation. Stereostim hardware delivers less perceived intensity
per unit waveform amplitude than FOC-stim, so the volume curve gets
re-tuned upward for stereostim.

**Implication for FunscriptForge's modulation feature**: a future
**device-profile** layer could replace the current two-folder pattern
with one master script + a per-device volume offset/gain curve. The
scripter wouldn't maintain duplicates; the renderer would apply the
right curve per target device.

This is the natural home for "device awareness" beyond what
`ARCHITECTURE_device_awareness.md` already covers (groove, speed
clamp). That doc handles mechanical-device compatibility; this is its
estim-side counterpart.

## Enhancement to the existing enchantment system

The current enchantment system ships 10 fixed-parameter effects (Cum,
Edge, Stay, Slow/Medium/Fast/Lube, Ruin/Stop/Tranquil). Each is
implemented as a hard-coded `apply_modulation` call.

**Enhancement direction** (post-v1):

1. **Custom modulation builder** — UI for users to compose their own
   effects via the apply_modulation primitive. Same param surface
   Edger documents (axis, waveform, frequency, amplitude, mode,
   ramps). Placed alongside the enchantment selector on the
   Enchantment Tab.

2. **Aliasing-safe frequency picker** — slider snaps to safe values
   (9/11/15/21/23/65 Hz) by default; "show all" toggle to override.

3. **Channel-aware normalization** — UI shows values in axis units
   (Hz for frequency, % for pulse_width), normalizes on save. Today
   the user sees raw 0..1 values that don't match Edger's authoring
   scales.

4. **Device-profile volume offset** — per-target-device volume
   adjustment curve, applied on render. Replaces the dual-folder
   stereostim-vs-foc pattern. Device-awareness doc extension.

5. **Modulation preview** — before render, show the effect's
   waveform overlaid on the target funscript so the user can audit
   what they're stacking.

## Open questions / parking lot

- **Pulse-rise-time normalization** — Edger's `event_definitions.yml`
  doesn't include this in the normalization table. restim treats it
  as 2-20 carrier-cycles. Need to confirm authoring scale and add
  to the table above.
- **Multiple modulations on the same axis at the same time** — does
  apply_modulation in `additive` mode stack arithmetically, or does
  the second overwrite the first? Confirm behavior + document.
- **Sampling rate of the underlying funscript** — Edger says ~10 Hz
  but Zer0 Game has 100 ms (= 10 Hz) AND 100ms-spaced action tables.
  Consistent. Check whether higher-rate scripts (5 ms?) exist in the
  wild and how that affects the aliasing rules.
- **Discord references** — there's recollection of Edger / diglet48
  Discord discussion of volume design. Captured findings here are
  from public docs only. If a Discord snippet adds nuance (e.g.
  device-family scaling rationale), incorporate.

## Sources

- `funscript-tools/FUNDAMENTAL_OPERATIONS.md` — Edger's authoring primitives.
- `funscript-tools/docs/CLI_REFERENCE.md` — channel filename convention.
- `restim/stim_math/audio_gen/continuous.py` + `pulse_based.py` — synth-side sampling.
- `funscript-updater/forge/audio_synthesis.py` — FunscriptForge's MP3 renderer + defaults.
- `forgeplayer/test_media/Zer0 Game/COMPARISON.md` — empirical foc-vs-stereostim diff.
- `forgeplayer/docs/architecture/stim-synthesis.md` — real-time synth that surfaced the chunk-boundary issue.
