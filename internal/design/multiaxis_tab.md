# Multi-axis tab — design

> **Status**: Design only. Not started.
> **Captured**: 2026-04-12
> **Ships as**: Its own PR, independent of audio/desktop/device-redesign.
> **Tier**: Free tier gets preset dropdowns. Pro tier adds parameter
> editing + AI-tracked import.

## The pitch

Every OSR2 and SR6 user has a library of single-axis funscripts. The
device has 6 axes of motion. Today those 5 extra axes sit idle unless
the user hand-scripts them in OpenFunscripter (hours of work per
script) or relies on MultiFunPlayer's random fill at playback time
(decent but not authored).

FunscriptForge can generate **phrase-aware multi-axis scripts** from a
single L0 stroke funscript — no video, no GPU, no hand-scripting.
The user picks a position style per phrase and FunscriptForge derives
the secondary axes algorithmically. The result is an authored
multi-axis experience that changes character across the scene arc.

> "Every mechanical script becomes multi-axis. Per phrase. At export."

## The six axes (T-Code convention)

| Axis | Code | Motion | File suffix |
| --- | --- | --- | --- |
| Stroke | L0 | Up/down | `.funscript` (existing) |
| Surge | L1 | Forward/back | `.surge.funscript` |
| Sway | L2 | Left/right | `.sway.funscript` |
| Twist | R0 | Rotation | `.twist.funscript` |
| Roll | R1 | Tilt left/right | `.roll.funscript` |
| Pitch | R2 | Tilt forward/back | `.pitch.funscript` |

Not every device supports every axis:

| Device | Axes supported |
| --- | --- |
| OSR2 | L0, R1, R2 (stroke + roll + pitch) |
| OSR2+ | L0, R0, R1, R2 (adds twist) |
| SR6 | L0, L1, L2, R0, R1, R2 (all six) |
| The Handy | L0 only |

FunscriptForge generates all six. Devices ignore the files they can't
use. The T-Code player (MultiFunPlayer, XTP) auto-discovers files by
the `.axis.funscript` naming convention.

## Tab UX — phrase table with style dropdown

The Multi-axis tab shows the **phrase table** the user already knows
from the Phrases tab, with one new column: a **style dropdown** per
phrase.

```text
┌───┬─────────┬──────┬─────┬────────────┬────────────────────┐
│ # │ Time    │ Dur  │ BPM │ Tag        │ Multi-axis style   │
├───┼─────────┼──────┼─────┼────────────┼────────────────────┤
│ 1 │ 0:00    │ 0:45 │  80 │ slow-build │ None           ▼   │
│ 2 │ 0:45    │ 1:20 │ 110 │ steady     │ Cowgirl        ▼   │
│ 3 │ 2:05    │ 0:30 │  60 │ transition │ None           ▼   │
│ 4 │ 2:35    │ 2:10 │ 140 │ intense    │ Missionary     ▼   │
│ 5 │ 4:45    │ 1:00 │ 160 │ climax     │ Random         ▼   │
│ 6 │ 5:45    │ 0:20 │  40 │ cooldown   │ None           ▼   │
└───┴─────────┴──────┴─────┴────────────┴────────────────────┘

    [ Apply to all: ▼ None  ]       [ Preview ]       [ Accept ]
```

### Controls

- **Per-phrase dropdown**: None / Cowgirl / Missionary / Doggy / Riding / Random
- **Apply to all**: bulk-set every phrase to one style (for "I just want
  cowgirl everywhere" users)
- **Preview**: generates the secondary-axis data and renders small
  charts per axis (like the Stim channel previews)
- **Accept**: saves the per-phrase style assignments to the project
  file; the actual funscript files are generated at Export time

### Data model

```python
# In forge_project dict:
{
    "multiaxis_styles": {
        "0": "cowgirl",      # phrase index → style name
        "1": "missionary",
        "3": "random",
        # phrases not listed → "none" (no secondary axes)
    }
}
```

Clean, sparse, serializable. Phrases are keyed by index; missing =
none. The `.forgetmpl` template captures these so they're reusable
across projects.

## Style presets

Each style is a config dict that maps secondary axes to algorithms.
The algorithms derive motion from the L0 stroke data for the phrase's
time range.

### Cowgirl

Rocking motion — pitch follows the stroke, gentle roll sway.

```python
{
    "roll":  {"algorithm": "sine", "amplitude": 0.3, "freq_hz": 0.5,
              "modulate_by": "stroke_velocity", "mod_strength": 0.4},
    "pitch": {"algorithm": "correlate_stroke", "correlation": 0.7,
              "phase_offset": 0.0, "amplitude": 0.6},
    "twist": {"algorithm": "random_walk", "amplitude": 0.15,
              "smoothing": 0.8},
}
```

| Axis | What it does |
| --- | --- |
| Roll | Gentle left-right sway, amplitude grows with stroke speed |
| Pitch | Forward on up-stroke, back on down-stroke. Strong correlation. |
| Twist | Very slight random twist for variety |
| Surge/sway | None (stationary hips) |

### Missionary

Side-to-side emphasis — roll is dominant, driven by stroke speed.

```python
{
    "roll":  {"algorithm": "correlate_stroke_velocity", "amplitude": 0.7,
              "smoothing": 0.6},
    "pitch": {"algorithm": "sine", "amplitude": 0.2, "freq_hz": 0.3},
    "twist": {"algorithm": "none"},
}
```

| Axis | What it does |
| --- | --- |
| Roll | Dominant — fast strokes create pronounced side-to-side |
| Pitch | Gentle forward bias |
| Twist | None |

### Doggy

Forward-thrust emphasis — pitch is dominant with a forward bias.

```python
{
    "pitch": {"algorithm": "correlate_stroke", "correlation": 0.8,
              "phase_offset": 0.0, "amplitude": 0.8, "bias": 0.3},
    "roll":  {"algorithm": "none"},
    "twist": {"algorithm": "none"},
}
```

| Axis | What it does |
| --- | --- |
| Pitch | Strong forward-back tracking the stroke. Biased forward. |
| Roll | None (stable hips) |
| Twist | None |

### Riding

Full circular motion — all axes active, wide amplitude.

```python
{
    "roll":  {"algorithm": "sine", "amplitude": 0.6, "freq_hz": 0.4,
              "modulate_by": "stroke_velocity", "mod_strength": 0.5},
    "pitch": {"algorithm": "correlate_stroke", "correlation": -0.5,
              "amplitude": 0.6},
    "twist": {"algorithm": "random_walk", "amplitude": 0.4,
              "smoothing": 0.7},
    "surge": {"algorithm": "sine", "amplitude": 0.3, "freq_hz": 0.2},
    "sway":  {"algorithm": "sine", "amplitude": 0.3, "freq_hz": 0.15,
              "phase_offset": 1.57},
}
```

| Axis | What it does |
| --- | --- |
| Roll | Wide sway, speed-modulated |
| Pitch | Anti-correlated with stroke (leans back on up-stroke) |
| Twist | Random walk with moderate smoothing |
| Surge | Slow forward-back drift |
| Sway | Slow left-right drift, phase-shifted from surge |

### Random

All axes get independent random walks. The "I don't know, surprise me"
option. Amplitude scaled by stroke velocity so fast sections get more
motion and slow sections stay calm.

```python
{
    "roll":  {"algorithm": "random_walk", "amplitude": 0.5,
              "modulate_by": "stroke_velocity", "smoothing": 0.6},
    "pitch": {"algorithm": "random_walk", "amplitude": 0.5,
              "modulate_by": "stroke_velocity", "smoothing": 0.6},
    "twist": {"algorithm": "random_walk", "amplitude": 0.3,
              "smoothing": 0.7},
    "surge": {"algorithm": "random_walk", "amplitude": 0.2,
              "smoothing": 0.8},
    "sway":  {"algorithm": "random_walk", "amplitude": 0.2,
              "smoothing": 0.8},
}
```

## Generation algorithms

Each algorithm takes the L0 stroke data for a phrase's time range and
produces a 0-100 position stream for one secondary axis.

### `none`

Output: constant 50 (neutral position) for the phrase duration. The
device doesn't move on this axis.

### `sine`

Sinusoidal oscillation at a fixed frequency, optionally modulated by
stroke velocity.

Parameters:
- `amplitude`: 0.0–1.0 (maps to 0–50 position units from center)
- `freq_hz`: oscillation frequency in Hz
- `phase_offset`: radians
- `modulate_by`: "stroke_velocity" or null
- `mod_strength`: 0.0–1.0 (how much velocity scales amplitude)

### `correlate_stroke`

Derives the axis value directly from the L0 stroke position, with
configurable correlation strength and phase offset.

Parameters:
- `correlation`: -1.0 to 1.0 (1.0 = same direction, -1.0 = inverted)
- `amplitude`: 0.0–1.0
- `phase_offset`: radians (0 = in-phase, π = anti-phase)
- `bias`: -1.0 to 1.0 (shifts the output center — 0.3 = biased forward)

### `correlate_stroke_velocity`

Like `correlate_stroke` but driven by the derivative (speed) of L0
rather than the position. Fast strokes produce large axis motion; slow
strokes produce small motion.

Parameters:
- `amplitude`: 0.0–1.0
- `smoothing`: 0.0–1.0 (low-pass filter on the velocity signal)

### `random_walk`

Brownian motion with configurable smoothing and optional velocity
modulation. Produces naturalistic drift.

Parameters:
- `amplitude`: 0.0–1.0
- `smoothing`: 0.0–1.0 (higher = smoother, less jitter)
- `modulate_by`: "stroke_velocity" or null
- `seed`: int (per-phrase, deterministic — same script always
  produces the same random walk)

## Stitching across phrases

Each phrase produces an independent signal per axis. At phrase
boundaries the signals must blend to avoid discontinuities.

**Crossfade strategy**: 200ms raised-cosine crossfade centered on the
phrase boundary. The outgoing phrase's signal fades to neutral (50)
while the incoming phrase's signal fades in from neutral. If adjacent
phrases have the same style, the crossfade blends them without going
through neutral.

For "none" phrases: the axis stays at 50 (neutral) for the entire
phrase. If a "none" phrase is between two styled phrases, the
crossfade naturally ramps down to 50 and back up.

## What gets written at export

When mechanical is selected and `multiaxis_styles` has any non-none
entries:

```text
mechanical/
  {stem}.funscript              ← L0 stroke (existing)
  {stem}.roll.funscript         ← R1 (NEW)
  {stem}.pitch.funscript        ← R2 (NEW)
  {stem}.twist.funscript        ← R0 (NEW, if any style uses it)
  {stem}.surge.funscript        ← L1 (NEW, if any style uses it)
  {stem}.sway.funscript         ← L2 (NEW, if any style uses it)
```

Only axes that have at least one non-none phrase are written. If no
phrase uses twist, no `.twist.funscript` is generated. This keeps the
output clean — devices that don't support twist won't find a file
they'd ignore anyway.

The README's mechanical section explains: "Multi-axis files were
generated by FunscriptForge based on per-phrase position styles. Load
all files in this folder into your T-Code player (MultiFunPlayer, XTP)
for the full experience."

## Preview UX

The Preview button generates the secondary-axis data in memory and
renders small charts (like the Stim channel previews):

```text
┌─────────────────────────────────────────┐
│  Multi-axis preview                      │
│                                          │
│  L0 Stroke (input)                       │
│  ████████████████████████████████        │
│                                          │
│  R1 Roll          R2 Pitch               │
│  ████████████     ████████████           │
│                                          │
│  R0 Twist                                │
│  ████████████                            │
│                                          │
│  L1 Surge         L2 Sway                │
│  (not used)       (not used)             │
└─────────────────────────────────────────┘
```

Charts show phrase boundaries as vertical lines and style labels at
the top of each phrase's region, so the user can see where each style
starts and stops.

## File layout

```text
forge/
  multiaxis.py              ← NEW. Style presets + generation algorithms
  multiaxis_presets.py       ← NEW. Preset configs (cowgirl, missionary, etc.)
forge/tabs/
  multiaxis_tab.py           ← NEW. Streamlit tab UI
ui/streamlit/
  panels/export_panel.py     ← Modified. Calls multiaxis generation at export
tests/
  test_multiaxis.py          ← NEW. Algorithm tests + stitching tests
docs/guide/
  multiaxis.md               ← NEW. User guide
```

## Pro tier upgrade path

### Free tier (this PR)

- 5 preset styles: Cowgirl, Missionary, Doggy, Riding, Random
- Per-phrase dropdown (the table)
- Apply-to-all bulk action
- Preview charts
- Export generates the files

### Pro tier v1 — parameter editing

Each style becomes **editable**. The preset is a starting point; the
user can adjust:

- Per-axis amplitude (slider, 0–100%)
- Correlation strength with L0 (slider, -100% to +100%)
- Frequency for sine-based axes (slider, 0.1–2.0 Hz)
- Smoothing for random-walk axes (slider, 0–100%)
- Bias for pitch/roll (slider, -50 to +50)

This is the "I know what feels good on my device" power-user mode.

### Pro tier v2 — custom styles

The user can **create their own named styles** from scratch, saved to
their stim_presets.json (same pattern as Stim tab character presets).
Community sharing: export a style as JSON, import someone else's.

### Pro tier v3 — AI-tracked import

Import FunGen's AI-tracked multi-axis output. FunGen generates
`.roll.funscript`, `.pitch.funscript` etc. from video analysis.
FunscriptForge can:

1. Load FunGen's output files on the Project tab
2. Display them in the Multi-axis tab as "AI-tracked" style
3. Let the user **override specific phrases** with manual style picks
4. The override table shows "AI-tracked" as a style option alongside
   the presets

This turns FunscriptForge into the **editor** for FunGen's output —
FunGen does the heavy tracking, FunscriptForge lets you shape it.

## Sequencing

This is a **self-contained PR** that doesn't depend on:
- Audio PR (estim concern, not mechanical)
- Desktop app PR (works in browser)
- Device/export redesign PR (the current export structure supports it)

It does depend on:
- Phrases existing (they do — assessment detects them)
- The mechanical/ export subfolder (shipped in the current cycle)

So it can ship **anytime after the current export-restructure cycle
lands** (which it has — merged to main today).

Recommended order within the broader roadmap:

1. ✅ Export folder restructure (done, on main)
2. **Multi-axis tab** (this PR) — ships as free tier
3. Audio synthesis PR — ships as free tier (stereostim) + Pro (rest)
4. Desktop app PR
5. Device/export redesign PR (fit badges, performance maximums)

Multi-axis before audio because:
- It's smaller scope (one tab + one module vs. restim extraction)
- It's entirely self-contained (no external deps)
- It serves the mechanical user base (Handy/OSR users on eroscripts)
  who are the **largest funscript audience** — giving them multi-axis
  makes FunscriptForge immediately relevant to a community that
  currently has no easy multi-axis path

## Open questions

1. **Where in the tab order?** After Phrases and before Stim? Or after
   Stim? I lean "after Phrases" because multi-axis is a shaping
   decision on the same funscript, like Tone. Stim generates a
   different output entirely (estim channels).

2. **Should "None" phrases generate neutral-position files or no
   actions at all?** Neutral (constant 50) is safest because T-Code
   players may behave unpredictably if an axis file has gaps. But it
   also means the axis file is non-empty even when unused.

3. **Should the preview play back in real-time?** A small animated
   preview showing the device motion would be incredible for UX but
   is significant rendering work. Defer to v2?

4. **Seed determinism**: same script + same styles should always
   produce the same multi-axis output. The random-walk algorithm needs
   a per-phrase seed derived from the phrase index + project name, not
   from system time.

5. **OSR2 vs SR6 axis support**: should the tab show only the axes the
   user's selected device supports? Today we don't know which OSR
   variant they have. Could add a "Device variant" picker (OSR2 /
   OSR2+ / SR6) that filters which axes appear. Or just generate all
   six and let the device ignore what it can't use.

6. **Transition styles**: should there be a "transition" style
   specifically for transition phrases? A smooth ramp from one
   position style to another, auto-detected from the adjacent phrases'
   styles. This would be elegant but adds complexity.

## What this is NOT

- **Not a manual multi-axis editor.** We're not competing with OFS for
  hand-placement of axis keyframes. We're generating algorithmically
  from presets. The user picks styles, not individual points.
- **Not AI video tracking.** We don't analyze video. We derive from
  the L0 stroke data. AI tracking is Pro tier v3 (FunGen import).
- **Not real-time playback.** We generate files at export time, not
  during playback. MultiFunPlayer handles playback; we handle
  authoring.

## References

- [MultiFunPlayer](https://github.com/Yoooi0/MultiFunPlayer) — random/pattern axis fill at playback time
- [FunGen AI](https://github.com/ack00gar/FunGen-AI-Powered-Funscript-Generator) — AI video tracking, multi-axis output
- [OpenFunscripter](https://github.com/OpenFunscripter/OFS) — manual multi-axis editing
- [OSR Wiki](https://osr.wiki/books/sr6/page/overview) — axis naming conventions
- Pro tier design: `internal/design/pro_tier.md`
- Cross-device translation: `memory/project_funscriptforge_cross_device.md`
