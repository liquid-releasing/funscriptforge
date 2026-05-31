# Transforms

FunscriptForge has 26 built-in transforms plus 6 tone transforms. Each one is designed to fix a specific kind of problem. Some are subtle finishing tools; others make substantial changes.

---

## How to choose

Start with the behavioral tag. Each tag has a primary recommendation:

| Tag | Start with |
|---|---|
| stingy | Amplitude Scale (scale down), or Performance |
| giggle | Normalize Range |
| plateau | Amplitude Scale (scale up) |
| drift | Recenter |
| half_stroke | Recenter |
| drone | Beat Accent or Boost Contrast |
| lazy | Amplitude Scale (scale up) + Normalize Range |
| frantic | Halve Tempo |

See [Behavioral Tags →](../reference/behavioral-tags.md) for the full recommendation list per tag.

Separately, if a section is genuinely **too fast for your device to play cleanly** — runaway bursts well above a comfortable stroke rate — reach for **[Tame](#tame)** (under Structural transforms). This is rare; most content never needs it.

---

## Non-structural transforms

These transforms preserve all action timestamps — they only change position values.

---

### Passthrough

**What it does:** Makes no changes. Returns positions exactly as they are.

**Use it when:** The phrase is already well-formed and you want to mark it as reviewed. Phrases accepted with Passthrough appear in the Completed transforms table at export time.

---

### Amplitude Scale

**What it does:** Stretches or compresses stroke depth around the midpoint (position 50). A scale above 1.0 makes strokes larger; below 1.0 makes them smaller.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Scale | 2.0 | 0.1 – 5.0 | Multiplier applied to distance from midpoint |

**Use it when:** The phrase has the right tempo and centering but the strokes are too small (scale up) or too large and demanding (scale down).

<!-- CAPTION: Illustration — a phrase before and after Amplitude Scale at 1.5. The strokes are visibly taller/deeper after the transform. Caption: "Amplitude Scale at 1.5×. Strokes that barely moved the device now fill the range." -->

---

### Normalize Range

**What it does:** Expands the phrase's positions to fill a target range. Unlike Amplitude Scale, Normalize uses the actual min and max of the phrase rather than the midpoint — it pulls the floor to the target floor and the ceiling to the target ceiling.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Target low | 0 | 0 – 49 | Lowest position in the output |
| Target high | 100 | 51 – 100 | Highest position in the output |

**Use it when:** The phrase is compressed into a narrow band anywhere in the range. Normalize expands it to fill the device's full capability regardless of where it is centered.

---

### Smooth

**What it does:** Applies a low-pass filter that reduces micro-movements and jitter without changing the overall shape.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Strength | 0.15 | 0.01 – 0.5 | Filter intensity — higher removes more variation |

**Use it when:** The phrase has noisy, choppy motion. Smooth softens it without changing the tempo or amplitude.

---

### Clamp Upper Half

**What it does:** Remaps all positions into the upper half of the range (50–100). The phrase's full motion is preserved but scaled into the top half.

**Use it when:** You want intense sections to always stay high, even at the lowest point of each stroke.

---

### Clamp Lower Half

**What it does:** Remaps all positions into the lower half of the range (0–50).

**Use it when:** You want a section to stay low — a gentler, more restrained register.

---

### Invert

**What it does:** Flips all positions around the midpoint. Position 70 becomes 30; position 20 becomes 80.

**Use it when:** The phrase is phase-inverted relative to the content — the device moves up where it should move down, or vice versa. Also useful for creating counterpoint between two overlapping phrases.

---

### Boost Contrast

**What it does:** Pushes positions toward the extremes (0 and 100) and away from the midpoint. The result is more pronounced peaks and troughs with less time in the middle range.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Strength | 0.5 | 0.0 – 1.0 | How aggressively positions are pushed to the extremes |

**Use it when:** The phrase is rhythmically flat — it moves but lacks punch at the peaks. Often effective on drone phrases that have good tempo but no variation.

---

### Shift

**What it does:** Adds a fixed offset to every position, clamped to [0, 100]. Positive values shift up; negative values shift down.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Offset | 0 | -50 – 50 | Fixed amount to add to every position |

**Use it when:** You want to nudge the whole phrase up or down without changing its shape — for example, shifting a phrase slightly higher so it doesn't touch 0 on the downstroke.

---

### Recenter

**What it does:** Shifts all positions so the phrase's midpoint lands at the target value. Preserves the amplitude and shape of the phrase — just moves it to a new center.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Target center | 50 | 0 – 100 | The desired midpoint after recentering |

**Use it when:** The phrase is drifting (midpoint below 30 or above 70) or confined to a half (midpoint below 38 or above 62). Recenter is the primary fix for both drift and half_stroke tags.

---

### Break

**What it does:** Reduces amplitude by a fraction and applies light LPF smoothing. The result is quieter, softer motion — like a rest or recovery section.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Amplitude reduce | 0.40 | 0.0 – 1.0 | How much to compress toward center (0.4 = 40% reduction) |
| LPF strength | 0.30 | 0.0 – 0.5 | LPF smoothing applied after reduction |

**Use it when:** A section of the script needs to feel quieter — a transition, a recovery, or a scene that is genuinely low-intensity.

---

### Performance

**What it does:** A composite transform for high-BPM phrases. Applies velocity capping, softened reversals, range compression, and LPF smoothing — shaped to feel intentional rather than mechanical.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Max velocity | 0.32 | 0.05 – 1.0 | Maximum velocity in pos/ms before softening |
| Reversal soften | 0.62 | 0.0 – 1.0 | How much to soften stroke reversals |
| Height blend | 0.75 | 0.0 – 1.0 | Blend factor for range compression |
| Range low | 15 | 0 – 40 | Minimum output position |
| Range high | 92 | 60 – 100 | Maximum output position |
| LPF strength | 0.16 | 0.0 – 0.5 | LPF applied to the result |

**Use it when:** A fast phrase sounds mechanical or harsh. Performance shapes it to feel driven and energetic rather than like a device failing to keep up.

---

### Three-One Pulse

**What it does:** Groups strokes into a 3+1 rhythm — three full strokes followed by one flat hold beat, repeating across the phrase.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Amplitude scale | 1.0 | 0.1 – 3.0 | Scale factor for stroke depth |
| Range low | 0 | 0 – 49 | Minimum output position |
| Range high | 100 | 51 – 100 | Maximum output position |

**Use it when:** A fast phrase needs a breathing pattern — give it a rhythmic rest every fourth beat to make it feel musical rather than relentless.

---

### Beat Accent

**What it does:** Boosts positions away from the center at every Nth stroke reversal. On accented reversals, the position is pushed further toward the extreme — creating a pulsed emphasis on selected beats.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Every Nth beat | 1 | 1 – 16 | How frequently to apply the accent |
| Accent amount | 4 | 1 – 30 | How much to push the position at the accented beat |
| Radius (ms) | 40 | 5 – 200 | Width of the accent in milliseconds |
| Start at (ms) | 0 | 0+ | Offset before first accent |
| Max accents | 0 | 0+ | Limit total accents (0 = unlimited) |

**Use it when:** A drone phrase has good rhythm but no dynamics. Beat Accent adds pulse without changing the tempo.

---

### Blend Seams

**What it does:** Detects high-velocity jumps at the boundaries between transforms and applies bilateral LPF smoothing only at those seams. The interior of each phrase is untouched.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Max velocity (pos/ms) | 0.50 | 0.05 – 2.0 | Velocity above which a boundary is treated as a seam |
| Max blend strength | 0.70 | 0.0 – 1.0 | LPF applied at detected seams |

**Use it when:** You have applied different transforms to adjacent phrases and the boundary between them produces a spike. Blend Seams is also available as a global option at export time.

---

### Final Smooth

**What it does:** A light global LPF finishing pass applied across the entire phrase.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Strength | 0.10 | 0.01 – 0.5 | Filter intensity — keep this low to avoid dulling the phrase |

**Use it when:** As the last step before export to remove any residual sharp edges. Also available as a global option at export time — you rarely need to apply it per-phrase.

---

### Funnel

**What it does:** Progressively shifts the center and scales the amplitude from the start of the phrase to the end. You define the starting and ending states and the transform interpolates between them.

**Parameters:**

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| Start center | 30 | 0 – 100 | Center position at the start |
| End center | 70 | 0 – 100 | Center position at the end |
| Start amplitude scale | 0.2 | 0.0 – 2.0 | Amplitude scale at the start |
| End amplitude scale | 1.0 | 0.0 – 2.0 | Amplitude scale at the end |

**Use it when:** A phrase needs to build or taper — a ramp-up into an intense section, or a wind-down after a peak.

---

## Structural transforms

These transforms change the number of actions, their timestamps, or both. The phrase duration is preserved but the internal structure may change substantially.

---

### Halve Tempo

**What it does:** Keeps every other stroke cycle and retimes the remainder evenly across the original duration. The result has half the BPM with the same start time, end time, and amplitude.

**Parameters:**

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| Amplitude scale | 1.0 | 0.1 – 3.0 | Optional scale factor applied after halving |

**Use it when:** A phrase is frantic (BPM > 200) or simply too fast to feel meaningful. Halve Tempo is the primary fix for frantic phrases.

---

### Tame

**What it does:** Caps stroke rate at a maximum BPM by thinning out only the strokes that exceed the ceiling, then applies a light *groove* (subtle velocity variation) so the result doesn't feel mechanical. It does **not** reshape stroke depth or reposition anything — content already under the ceiling passes through completely untouched.

Think of Tame as the gentle, surgical member of the family: where most transforms actively reshape a phrase, Tame only steps in when motion is faster than a device can comfortably play, and leaves everything else alone.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Max BPM | 360 | 60 – 450 | Stroke-rate ceiling. Only strokes faster than this are thinned. 360 ≈ an e-stim (FOC) limit; lower it for mechanical strokers (e.g. ~120 for The Handy). |
| Groove | 0.2 | 0.0 – 1.0 | Light humanize — adds subtle velocity variation to long monotone runs (needs ~60s+ of motion to take effect). 0 = off. 0.2 = gentle; 0.35 ≈ natural. |

**Use it when:** A section is genuinely too fast for your device to play cleanly — runaway bursts well above a comfortable stroke rate. This is an **edge case**: the vast majority of scripts are already well within device limits and will see no change from Tame. For phrases that are merely *frantic* but still playable, use **Halve Tempo** instead.

**Tame vs. the tones:** Tame shares the *spirit* of the [tones](tone.md) — a named, slider-driven adjustment — but it sits on the opposite end. The six expressive tones (Tender → Dominant) reshape the **feel** of your whole script. Tame changes nothing about the feel; it's a **corrective** that quietly removes speed a device can't play, applied per phrase or stanza from the transform picker rather than globally from the Tone tab.

---

### Nudge

**What it does:** Shifts the phrase forward or backward in time by a specified number of milliseconds. The gap created at the leading edge is filled with a short transition from the preceding position.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Nudge (ms) | 0 | -2000 – 2000 | Positive = shift forward; negative = shift backward |
| Transition (ms) | 100 | 0 – 500 | Duration of the fill transition at the leading edge |

**Use it when:** A phrase is slightly out of sync with a beat drop or audio cue. Nudge corrects the alignment without re-scripting.

---

### Stroke

**What it does:** Replaces the phrase with a regular synthetic 0–100 oscillation at the phrase's current BPM.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| BPM | phrase BPM | 10 – 300 | Target BPM for the synthetic stroke |

**Use it when:** The phrase's motion is so irregular that corrective transforms cannot fix it — a clean synthetic stroke is better than trying to salvage the original. BPM defaults to the phrase's current BPM.

---

### Waiting

**What it does:** Replaces the phrase with a very slow oscillating stroke. Creates a placeholder for static or near-still sections.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Start position | 100 | 0 – 100 | Position at the start of the waiting stroke |
| End position | 0 | 0 – 100 | Position at the end of the waiting stroke |
| BPM | 1.0 | 0.0 – 5.0 | Oscillation rate (default ~1 cycle per minute) |
| Original influence % | 0 | 0 – 100 | How much of the original motion to blend in |

**Use it when:** A section of the script has essentially no motion and the device should be parked but not completely still — the slow waiting motion prevents the device from going cold. Set Original influence > 0 to blend some of the original motion back in.

---

### Tide

**What it does:** Generates fast oscillations riding on a slow sine-wave center. The center point ebbs and flows over the phrase duration while the fast oscillations continue throughout.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Center high | 70 | 20 – 90 | Highest center position during the tide cycle |
| Center low | 41 | 0 – 80 | Lowest center position during the tide cycle |
| Stroke span | 30 | 5 – 60 | Amplitude of the fast oscillations |
| BPM | 252 | 10 – 300 | Rate of the fast oscillations |
| Wave period (s) | 135 | 10 – 600 | Duration of one slow center cycle |

**Use it when:** A long phrase needs a breathing quality — the sensation of ebb and flow within continuous motion.

---

### Drift

**What it does:** Generates a high plateau with small oscillations and one slow dip — replicating the feeling of the drift behavioral pattern but with intentional shape.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Plateau position | 85 | 50 – 100 | Center of the high plateau |
| Wobble depth | 10 | 0 – 30 | Amplitude of small oscillations on the plateau |
| Wobble BPM | 80 | 20 – 150 | Rate of the small oscillations |
| Dip bottom | 30 | 0 – 70 | Lowest position during the dip |
| Dip timing | 0.2 | 0.0 – 0.9 | When the dip occurs (fraction of phrase duration) |
| Dip duration (s) | 4.0 | 0.5 – 15.0 | How long the dip lasts |

**Use it when:** You want a phrase that reads as a deliberate drift, not accidental off-centering.

---

## User-defined transforms

Beyond the built-ins, you can add your own:

**JSON recipes** — chain existing built-in transforms in `user_transforms/`. Safe: parameters are validated; only built-in transforms can be referenced.

**Python plugins** — custom transform logic in `plugins/`. Disabled by default. Enable with `FUNSCRIPT_PLUGINS_ENABLED=1`. See [Extending Transforms →](../reference/cli.md) for details.
