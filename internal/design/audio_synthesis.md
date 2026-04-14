# Audio synthesis — design

> **Status**: Design. Not started.
> **Captured**: 2026-04-12 from restim codebase research.
> **Updated**: 2026-04-12 — device-aware analysis of all five estim paths.
> **Depends on**: funscript-tools channel generation (shipped v0.6.0),
> restim fork at `bruceatxolvco/restim` (cloned, up to date with
> upstream v1.58).

## The problem

FunscriptForge generates estim channel funscripts (via funscript-tools)
but users must run restim separately to turn those funscripts into
playable audio. restim is a real-time Qt GUI — no CLI, no library API.
The user experience today:

1. Export channel funscripts from FunscriptForge
2. Download + install restim
3. Open restim, load funscripts, configure device, hit play
4. Or: open restim's "bake audio" dialog, configure, write WAV

We want:

1. Export from FunscriptForge → WAV/MP3 files appear in `estim/` folder

edger has stopped doing audio. FunscriptForge may be the only tool that
ships estim audio from funscripts. This is the headline feature.

## Why edger doesn't care about audio

edger uses FOC-Stim hardware. FOC devices are **protocol-controlled** —
they receive real-time commands over serial/TCP telling the firmware what
carrier frequency, pulse width, and position to generate. There is no
audio file in the FOC workflow. Same for NeoStim.

The **stereostim community** (2b, 312, Tingler, ZC95) is entirely
audio-based. These users need WAV files routed to their audio device.
restim can do this in real time, but there's no batch tool that just
hands them a file. That's our gap.

## Device-aware audio: which devices get WAV files?

FunscriptForge already knows which devices the user selected (Device
tab → `st.session_state["output_targets"]`). The export panel already
splits `MECHANICAL_KEYS` vs `ESTIM_KEYS`. We use that same split to
decide what to render.

### The five estim device classes

| Device class | restim DeviceType | Signal type | Produces audio? | What we export |
| --- | --- | --- | --- | --- |
| **Audio 3-phase — continuous** (2b/312) | `AUDIO_THREE_PHASE` + `CONTINUOUS` | Stereo L/R waveform | **Yes** | Channel funscripts **+ WAV** |
| **Audio 3-phase — pulse** (Tingler/ZC95) | `AUDIO_THREE_PHASE` + `PULSE_BASED` | Stereo L/R pulse train | **Yes** | Channel funscripts **+ WAV** |
| **FOC-Stim — 3-phase** | `FOCSTIM_THREE_PHASE` | Protobuf RPC commands | **No** | Channel funscripts only |
| **FOC-Stim — 4-phase** | `FOCSTIM_FOUR_PHASE` | Protobuf RPC commands (4 electrodes) | **No** | Channel funscripts only |
| **NeoStim — 3-phase** | `NEOSTIM_THREE_PHASE` | USB HID voltage/freq params | **No** | Channel funscripts only |

**Audio devices** (top two rows): the device *is* an audio amplifier
connected to electrodes. The computer sends a WAV-format stereo signal
through the audio jack. The waveform IS the stimulation.

**Protocol devices** (bottom three rows): the device has its own
microcontroller that generates the stimulation waveform internally.
The computer sends parameter updates (position, frequency, pulse width)
over serial/USB. No audio file involved — restim owns the real-time
control loop and device drivers.

### Mapping to our export keys

| Our `output_targets` key | Audio render? | Waveform mode |
| --- | --- | --- |
| `legacy` (Audio 3-phase continuous) | **Yes** | `continuous` |
| `stereostim` (Audio 3-phase pulse) | **Yes** | `pulse` |
| `foc3phase` | No — funscripts only | — |
| `foc4phase` | No — funscripts only | — |
| `neostim` | No — funscripts only | — |

The export panel checks which estim keys are selected. If any
audio-capable key is present (`legacy` or `stereostim`), render WAV.

### Future: our own player

FOC-Stim and NeoStim users need restim today for device control.
When FunscriptForge ships its own real-time player (desktop app +
PyWebView), we could potentially add protocol drivers for these devices
too — sending the same alpha/beta/carrier data as real-time commands
instead of audio samples. That's a separate feature, not this PR.

## restim's audio pipeline

Traced from `diglet48/restim` v1.58. The core math is ~500 lines of
numpy with no Qt dependency.

### Step 1: Funscript → alpha/beta

restim operates on **two funscripts** mapped to a 2D position space:

- **alpha** — X position in the stimulation field (−1 to +1)
- **beta** — Y position in the stimulation field (−1 to +1)

These come from either:
- Two hand-authored `.alpha.funscript` + `.beta.funscript` files
- restim's built-in `convert_1d_to_2d()` which traces semicircular arcs
  from a single funscript (in `funscript/funscript_conversion.py`)

**funscript-tools already generates alpha + beta.** Its `process()`
pipeline outputs `{stem}.alpha.funscript` and `{stem}.beta.funscript`
using its own circular/linear algorithm with speed-aware direction
changes. This is our input — we don't need restim's 1D→2D converter.

### Step 2: Axis interpolation

Funscript points are sparse (10–50 Hz). Audio is 44100 Hz. restim
bridges this with `np.interp()`:

```python
# axis.py — LinearInterpolator
def interpolate(self, timeline, timestamp):
    return np.interp(timestamp, timeline.x(), timeline.y())
```

At render time, a timeline array of audio-rate timestamps is generated:
```python
timeline = np.linspace(0, duration_s, n_samples)
alpha = np.interp(timeline, funscript_x, funscript_y)
beta  = np.interp(timeline, funscript_x, funscript_y)
```

### Step 3: Carrier generation

A carrier wave at the stimulation frequency (typically 600–1000 Hz):

```python
# sine_generator.py — AngleGenerator
theta = np.linspace(phase, phase + 2π * freq * n/sr, n)
```

The carrier frequency can itself be a funscript-controlled axis or a
constant. funscript-tools generates a `.carrier_frequency.funscript`
for some presets.

### Step 4: 3-phase transform

The core math in `stim_math/threephase.py`. The alpha/beta position
modulates the carrier via a "squeeze" matrix:

```
carrier [cos(θ), sin(θ)]
    → squeeze(alpha, beta)          # position-dependent amplitude/phase
    → ab_transform                  # 3-electrode → stereo projection
    → [L, R] audio channels
```

The squeeze matrix (`threephase.py:36-52`):
```python
r = sqrt(alpha² + beta²)
t11 = (2 - r + alpha) / 2
t12 = -beta / 2
t21 = t12
t22 = (2 - r - alpha) / 2
```

Final stereo projection (`threephase.py:82-83`):
```python
T = (P @ ab_transform)[:2, :2] / sqrt(3)
L, R = T @ [squeezed_x, squeezed_y]
```

Where `P` is the electrode-to-channel matrix and `ab_transform` is the
Clarke transform (3-phase electrical engineering). Both are constant
matrices defined in `stim_math/transforms.py`.

### Step 5: Volume and calibration

- Master volume × API volume × inactivity × external
- Center calibration: reduces volume near (0, 0) for comfort
- Hardware calibration: corrects for electrode asymmetry (dB offsets)
- Vibration modulation: optional amplitude envelope

For batch rendering, most of these are constants (no UI interaction).

### Step 6: File output

```python
# audio_write_dialog.py:140-149
timeline = np.linspace(0, duration_s, n_samples) + epoch
for chunk in chunker(timeline, samplerate // 10):
    data = np.vstack(algo.generate_audio(sr, chunk, chunk)).T
    file.write(data)   # soundfile → WAV/MP3/OGG
```

Chunked to avoid 4GB peak allocation for long files. Output is float32
stereo at 44100 Hz via the `soundfile` library (libsndfile backend).

## What funscript-tools already gives us

When FunscriptForge runs `cli.process()`, the output folder contains:

| File | Purpose | Used by audio? |
| --- | --- | --- |
| `{stem}.funscript` | Main stroke (L0) | Input to alpha/beta generation |
| `{stem}.alpha.funscript` | Alpha axis position | **Yes — direct input** |
| `{stem}.beta.funscript` | Beta axis position | **Yes — direct input** |
| `{stem}.speed.funscript` | Stroke velocity | No (used during generation) |
| `{stem}.carrier_frequency.funscript` | Carrier freq over time | **Yes — if present** |
| `{stem}.pulse_frequency.funscript` | Pulse rate over time | Yes (pulse mode only) |
| `{stem}.volume.funscript` | Volume envelope | Optional |
| `{stem}.alpha-prostate.funscript` | Prostate channel alpha | **Yes — second audio file** |
| `{stem}.beta-prostate.funscript` | Prostate channel beta | **Yes — second audio file** |

The alpha/beta funscripts are already in restim's coordinate space
(0–100 → 0.0–1.0 after normalization). No conversion needed.

## What we extract from restim

### Files to copy (MIT license, full attribution)

**Continuous mode** (2b/312 — legacy audio devices):

| restim source | What it contains | Lines |
| --- | --- | --- |
| `stim_math/threephase.py` | ThreePhaseSignalGenerator, center calibration | ~120 lines needed |
| `stim_math/transforms.py` | Constant matrices (P, ab_transform) | 16 lines |
| `stim_math/sine_generator.py` | AngleGenerator (carrier phase) | 12 lines needed |
| `stim_math/trig.py` | `norm()` helper | ~5 lines |
| Batch render loop | Chunked write to soundfile | ~15 lines |

**Pulse mode** (Tingler/ZC95 — modern audio devices):

| restim source | What it contains | Lines |
| --- | --- | --- |
| `stim_math/audio_gen/pulse_based.py` | ThreePhasePulseBasedAlgorithm | ~170 lines needed |
| `stim_math/pulse.py` | Pulse envelope (cosine ramp) | ~20 lines |

**Total extraction: ~360 lines of numpy math.** Both modes share
threephase.py, transforms.py, and sine_generator.py.

### Files we do NOT need

- All Qt UI (`qt_ui/` — ~4000 lines)
- All device drivers (`device/` — serial, TCP, protobuf for FOC/NeoStim)
- Real-time audio callback (`sounddevice` integration)
- AlgorithmFactory (431 lines of Qt wiring we replace with one function)
- Pattern generators, motion generators
- Vibration modulation (nice-to-have later, not MVP)
- IMU/sensor code
- Simfile (DDR) conversion
- Hardware calibration (user can calibrate in restim)
- A/B testing mode (restim-specific experimentation feature)

### Dependencies added

- `numpy` — already a dependency
- `soundfile` — new dependency (~200KB, wraps libsndfile)

`sounddevice` is NOT needed for batch rendering.

## Our API

```python
# forge/audio_synthesis.py

def render_stereo_audio(
    alpha_funscript_path: str,
    beta_funscript_path: str,
    output_path: str,
    duration_s: float,
    waveform: str = "continuous",              # "continuous" or "pulse"
    carrier_frequency: float | str = 700.0,    # Hz or path to .carrier_frequency.funscript
    volume: float = 0.8,
    samplerate: int = 44100,
    format: str = "wav",                       # wav, mp3, ogg
    # Pulse-mode params (ignored for continuous):
    pulse_frequency: float = 40.0,             # Hz — pulse repetition rate
    pulse_width_cycles: float = 5.0,           # carrier cycles per pulse
    pulse_rise_time: float = 2.0,              # carrier cycles for ramp
    on_progress: callable = None,
) -> dict:
    """
    Render alpha + beta funscripts to a stereo audio file using
    restim's 3-phase synthesis math.

    waveform="continuous" — smooth sine carrier modulated by position.
        Best for legacy audio devices (2b, 312).
    waveform="pulse" — discrete pulse trains with configurable width
        and rise time. Best for modern audio devices (Tingler, ZC95).

    Returns dict with metadata (duration, file_size, peak_amplitude).

    Attribution: Core 3-phase synthesis math by diglet48 (restim).
    MIT License. https://github.com/diglet48/restim
    """
```

One function, two waveform modes. Both produce stereo L/R WAV using
the same 3-phase position math. The difference is the carrier shape:
continuous is a smooth sine; pulse is duty-cycled bursts with
cosine-ramped envelopes.

### Which waveform for which device?

The export panel already knows which estim device keys are selected.

```python
AUDIO_DEVICE_WAVEFORMS = {
    "legacy":     "continuous",   # 2b, 312 — smooth carrier
    "stereostim": "pulse",        # Tingler, ZC95 — pulse trains
}
```

If the user selected both `legacy` and `stereostim`, we render **two
WAV files** — one per waveform mode. Each gets its own filename suffix
so the user knows which to play on which device.

### Channel mapping at export

```
funscript-tools process()
    ├── {stem}.alpha.funscript  ──┐
    ├── {stem}.beta.funscript   ──┤──→  render_stereo_audio() → {stem}.wav
    │                              │     (main stimulation audio)
    ├── {stem}.alpha-prostate.funscript ──┐
    └── {stem}.beta-prostate.funscript  ──┤──→  render_stereo_audio() → {stem}.prostate.wav
                                           │     (prostate channel audio)
```

Two audio files per waveform mode per export:
1. **Main stim audio** — from alpha + beta channels
2. **Prostate audio** — from alpha-prostate + beta-prostate channels

Both rendered with the same 3-phase math, same carrier frequency.

## Integration with export

In `export_panel.py`, after writing estim funscripts. The export panel
already calls `_split_targets()` to get `estim_keys`. We check which
of those keys are audio-capable:

```python
from forge.audio_synthesis import render_stereo_audio

AUDIO_DEVICE_WAVEFORMS = {
    "legacy":     "continuous",
    "stereostim": "pulse",
}

# After funscript-tools process() completes:
audio_keys = [k for k in estim_keys if k in AUDIO_DEVICE_WAVEFORMS]
for device_key in audio_keys:
    waveform = AUDIO_DEVICE_WAVEFORMS[device_key]

    # Main stim audio
    alpha_path = estim_dir / f"{stem}.alpha.funscript"
    beta_path = estim_dir / f"{stem}.beta.funscript"
    if alpha_path.exists() and beta_path.exists():
        audio_path = estim_dir / f"{stem}.{device_key}.wav"
        render_stereo_audio(alpha_path, beta_path, audio_path,
                            duration_s, waveform=waveform)

    # Prostate audio (if 3-phase preset with prostate)
    p_alpha = estim_dir / f"{stem}.alpha-prostate.funscript"
    p_beta = estim_dir / f"{stem}.beta-prostate.funscript"
    if p_alpha.exists() and p_beta.exists():
        p_audio = estim_dir / f"{stem}.prostate.{device_key}.wav"
        render_stereo_audio(p_alpha, p_beta, p_audio,
                            duration_s, waveform=waveform)
```

If the user selected only FOC/NeoStim devices (no audio keys), no WAV
files are rendered — just funscripts. The export panel already handles
this naturally because `audio_keys` will be empty.

## Export UX

The Export tab shows **"Generate audio files (WAV)"** checkbox.

- **Visible** only when an audio-capable device is selected (`legacy`
  or `stereostim`).
- **Hidden** when only FOC/NeoStim devices are selected (no audio
  to render — these are protocol devices).
- **Enabled by default** when visible.

When checked, the estim/ folder gets audio files named by device:
```
estim/
  {stem}.funscript                          ← main funscript (always)
  {stem}.alpha.funscript                    ← alpha channel (always)
  {stem}.beta.funscript                     ← beta channel (always)
  {stem}.legacy.wav                         ← continuous audio (if legacy selected)
  {stem}.stereostim.wav                     ← pulse audio (if stereostim selected)
  {stem}.alpha-prostate.funscript           ← prostate alpha (always, if 3-phase)
  {stem}.beta-prostate.funscript            ← prostate beta (always, if 3-phase)
  {stem}.prostate.legacy.wav                ← prostate continuous (if legacy)
  {stem}.prostate.stereostim.wav            ← prostate pulse (if stereostim)
  ...other channel files...
```

If only one audio device is selected (the common case), the user gets
one pair of WAV files. If both audio devices are selected, two pairs —
each optimized for that device's waveform mode.

Progress messages:

- "Rendering audio — legacy continuous, main channel (Xs elapsed)…"
- "Rendering audio — stereostim pulse, prostate channel (Xs elapsed)…"

For a 30-minute funscript at 44100 Hz, expect ~2–5 seconds per WAV
(restim reports rendering at 10–60× realtime).

## Audio parameters: free vs Pro

The `render_stereo_audio()` API accepts all parameters. The difference
is where the values come from:

### Free tier — sensible defaults, no sliders

| Parameter | Default | Why this value |
| --- | --- | --- |
| Carrier frequency | 700 Hz | Safe middle ground for all audio devices |
| Volume | 0.8 | Headroom without clipping |
| Pulse frequency | 40 Hz | Comfortable default for Tingler/ZC95 |
| Pulse width | 5 cycles | Standard pulse width |
| Pulse rise time | 2 cycles | Smooth onset, no click artifacts |

Free tier uses these defaults or reads from funscript-tools output
(`.carrier_frequency.funscript` if present). No user-facing controls.
The user gets audio that works — the "it just made me an audio file"
moment.

### Pro tier — sliders on all audio parameters

Pro adds an **Audio parameters** panel (on Stim tab or Export tab)
with sliders for:

- **Carrier frequency** (300–1500 Hz) — lower = deeper, higher = sharper
- **Volume** (0–1.0) — master output level
- **Pulse frequency** (10–100 Hz) — pulse repetition rate (pulse mode)
- **Pulse width** (1–20 carrier cycles) — wider = stronger sensation
- **Pulse rise time** (0.5–5 carrier cycles) — sharper or softer onset

These are the same knobs restim's UI exposes. The Pro user gets
restim-level control without leaving FunscriptForge. Combined with
per-device tuning, this means different audio parameter sets per device
class — the artist can tune the feel for each device independently.

### Carrier frequency source priority

1. **Pro slider** (if set) — user's explicit choice
2. **From funscript** — `.carrier_frequency.funscript` if funscript-tools
   generated one (interpolated at audio rate, varies over time)
3. **Default** (700 Hz) — constant for the full duration

## Safety

restim has safety frequency limits (min/max carrier frequency) to
prevent DC or dangerously high frequencies. We inherit these:

```python
MIN_CARRIER_FREQ = 300   # Hz — below this risks DC component
MAX_CARRIER_FREQ = 1500  # Hz — above this may not stimulate
```

These are clamped, not error conditions.

## File layout

```
forge/
  audio_synthesis.py          ← our render API (~100 lines)
  restim_math/                ← extracted from restim (attributed)
    __init__.py
    threephase.py             ← ThreePhaseSignalGenerator + center calibration
    transforms.py             ← constant matrices (Clarke transform)
    sine_generator.py         ← AngleGenerator (carrier phase accumulator)
    pulse.py                  ← pulse envelope (cosine ramp)
    LICENSE                   ← MIT license from restim
    ATTRIBUTION.md            ← credit to diglet48
```

## Attribution

Every file in `forge/restim_math/` carries:

```python
# Extracted from restim by diglet48.
# Original source: https://github.com/diglet48/restim
# License: MIT
# Modifications by Liquid Releasing for batch rendering integration.
```

`ATTRIBUTION.md` in the folder explains what was extracted, why, and
links to the upstream repo. The README and About page mention restim.

## Testing

```
tests/
  test_audio_synthesis.py
    - test_renders_wav_file
    - test_output_is_stereo
    - test_duration_matches_input
    - test_output_in_range (peak amplitude ≤ 1.0)
    - test_deterministic (same input → same output)
    - test_carrier_frequency_affects_output
    - test_empty_funscript_produces_silence
    - test_prostate_channel_renders
    - test_mp3_format
    - test_progress_callback
```

## Sequence

1. **Extract math** — copy ~170 lines from restim into `forge/restim_math/`
2. **Build render API** — `forge/audio_synthesis.py` with `render_stereo_audio()`
3. **Test standalone** — unit tests with synthetic funscripts
4. **Wire into export** — add audio rendering after funscript-tools process()
5. **Test end-to-end** — export with audio checkbox, verify WAV plays

## What this is NOT

- **Not real-time playback.** We render to file. restim handles playback.
- **Not a restim replacement.** restim is the gold standard for
  real-time experimentation, calibration, and device control. We just
  bake the audio so users don't need restim for playback.
- **Not a protocol driver.** FOC-Stim and NeoStim are protocol devices
  that need real-time command streams. We export funscripts for those
  users; they run restim for device control. Our own player could add
  protocol support later — separate feature, separate PR.
- **Not per-device tuning.** Both audio waveform modes use the same
  alpha/beta channel funscripts. Per-device tuning (different stim
  parameters per device class → different funscripts → different audio)
  is a Pro feature that builds on top of this.

## Credit

diglet48's restim is exceptional work — the 3-phase synthesis math,
the coordinate transforms, the safety limits. We extract a small
fraction of the codebase with full attribution and keep our fork synced
to benefit from upstream improvements. The goal is to make diglet48's
math accessible to users who would never install restim on their own.
