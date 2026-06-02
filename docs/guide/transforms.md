# Transforms

FunscriptForge groups its transforms into three families — **Tones**, **Behaviors**, and **Structurals** — plus your own recipes and plugins. The picker ships **10 Behaviors**, **7 Structurals**, and **7 Tones**. Each transform fixes a specific kind of problem; some are subtle finishing tools, others make substantial changes.

> **Note on names:** A few older transforms were consolidated into more capable ones (2026-06-01). They still work in saved recipes but no longer clutter the picker — see [Consolidated transforms](#consolidated-transforms) at the bottom.

---

## How to choose

Start with the behavioral tag. Each tag has a primary recommendation:

| Tag | Start with |
|---|---|
| stingy | Amplitude Scale (scale down), or Performance |
| giggle | Range (fit to content) |
| plateau | Amplitude Scale (scale up) |
| drift | Recenter |
| half_stroke | Recenter |
| drone | Beat Accent, or Amplitude Scale (scale up) |
| lazy | Amplitude Scale (scale up) + Range |
| frantic | Halve Tempo |

See [Behavioral Tags →](../reference/behavioral-tags.md) for the full recommendation list per tag.

If a section is genuinely **too fast to feel meaningful**, reach for **Halve Tempo** (and **Performance** to shape what remains). Separately, the **[Tame](tone.md#tame)** tone is a gentle *device-aware softener* — it humanizes a relentless wall of fast strokes without dropping a single beat; it's applied like a tone, not a speed cap.

---

## Behaviors

Beat-preserving shape edits. They keep every action's timestamp and only change position values, so they're safe to chain.

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
| Scale | 2.0 | 0.1 – 5.0 | Multiplier applied to distance from midpoint. 1.0 = no change; >1 amplifies; <1 reduces. |

**Use it when:** The phrase has the right tempo and centering but the strokes are too small (scale up) or too large and demanding (scale down). Scaling above 1.0 also covers the old "boost contrast" — pushing peaks and troughs further apart.

---

### Range

**What it does:** Remaps the phrase's positions into a target band `[low, high]`. With **Fit to content** on, it stretches the phrase's *actual* min–max to fill the band (expand narrow motion). With it off, it compresses the full 0–100 scale into the band (e.g. keep everything in the upper or lower half).

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Fit to content | on | on / off | On = stretch the phrase's actual range to fill the band. Off = compress the nominal 0–100 scale into the band. |
| Low | 0 | 0 – 100 | Bottom of the target band. |
| High | 100 | 0 – 100 | Top of the target band. |

**Use it when:** The phrase is compressed into a narrow band and you want it to fill the device's range (Fit to content on). Or you want a section confined to a register — set the band to `[50, 100]` for an always-high feel, `[0, 50]` for a gentler low one (Fit to content off).

*(Range unifies the former Normalize Range and Clamp Upper/Lower Half.)*

---

### Smooth

**What it does:** Applies a low-pass filter that reduces micro-movements and jitter without changing the overall shape.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Strength | 0.15 | 0.01 – 0.5 | Filter intensity — higher removes more variation. ~0.10 is a light finishing pass. |

**Use it when:** The phrase has noisy, choppy motion. Smooth softens it without changing the tempo or amplitude. A light pass (≈0.10) also serves as a finishing touch before export.

---

### Invert

**What it does:** Flips all positions around the midpoint. Position 70 becomes 30; position 20 becomes 80.

**Use it when:** The phrase is phase-inverted relative to the content — the device moves up where it should move down, or vice versa. Also useful for creating counterpoint between two overlapping phrases.

---

### Recenter

**What it does:** Moves the whole phrase up or down so its midpoint lands at the target value, preserving the amplitude and shape — just shifts it to a new center. (This also covers "shift / lift": to nudge motion up or down, recenter to a new midpoint.)

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Target center | 50 | 0 – 100 | The desired midpoint after recentering. |

**Use it when:** The phrase is drifting (midpoint below 30 or above 70) or confined to a half (midpoint below 38 or above 62). Recenter is the primary fix for both drift and half_stroke tags.

---

### Ramp

**What it does:** A one-direction ramp across the phrase. It progressively shifts the center *and* scales stroke amplitude from a start setting to an end setting, interpolating between them. Set start **below** end to **rise** (build); start **above** end to **fall** (descend).

**Parameters:**

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| Start center | 30 | 0 – 100 | Center of gravity at the start. |
| End center | 70 | 0 – 100 | Center of gravity at the end. Higher than start = rise; lower = fall. |
| Start amplitude scale | 0.2 | 0.0 – 2.0 | Stroke depth at the start (0.2 = compressed; 1.0 = original). |
| End amplitude scale | 1.0 | 0.0 – 2.0 | Stroke depth at the end. |

**Use it when:** A phrase needs to build or taper in one direction — a ramp-up into an intense section, or a wind-down after a peak. For a rising-then-falling *arch*, split it across two phrases (a rising Ramp, then a falling one). *(Formerly "Funnel".)*

---

### Blend Seams

**What it does:** Detects high-velocity jumps at the boundaries between transforms and applies bilateral LPF smoothing only at those seams. The interior of each phrase is untouched.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Max velocity (pos/ms) | 0.50 | 0.05 – 2.0 | Velocity above which a boundary is treated as a seam. |
| Max blend strength | 0.70 | 0.0 – 1.0 | LPF applied at detected seams. |

**Use it when:** You have applied different transforms to adjacent phrases and the boundary between them produces a spike. Blend Seams is also available as a global option at export time.

---

### Beat Accent

**What it does:** Boosts positions away from the center at every Nth stroke reversal. On accented reversals, the position is pushed further toward the extreme — creating a pulsed emphasis on selected beats.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Every Nth beat | 1 | 1 – 16 | How frequently to apply the accent. |
| Accent amount | 4 | 1 – 30 | How much to push the position at the accented beat. |
| Radius (ms) | 40 | 5 – 200 | Width of the accent in milliseconds. |
| Start at (ms) | 0 | 0+ | Offset before the first accent. |
| Max accents | 0 | 0+ | Limit total accents (0 = unlimited). |

**Use it when:** A drone phrase has good rhythm but no dynamics. Beat Accent adds pulse without changing the tempo. For per-beat *depth* control across a repeating cycle, see **[Hero Beat](#hero-beat)**.

---

### Performance

**What it does:** A composite transform for high-BPM phrases. Applies velocity capping, softened reversals, range compression, and LPF smoothing — shaped to feel intentional rather than mechanical.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Max velocity | 0.32 | 0.05 – 1.0 | Maximum velocity in pos/ms before softening. |
| Reversal soften | 0.62 | 0.0 – 1.0 | How much to soften stroke reversals. |
| Height blend | 0.75 | 0.0 – 1.0 | Blend factor for range compression. |
| Range low | 15 | 0 – 40 | Minimum output position. |
| Range high | 92 | 60 – 100 | Maximum output position. |
| LPF strength | 0.16 | 0.0 – 0.5 | LPF applied to the result. |

**Use it when:** A fast phrase feels mechanical or harsh. Performance shapes it to feel driven and energetic rather than like a device failing to keep up.

---

## Structurals

Structure-level shaping — tempo, rhythmic patterning, and full replacements. Most change the number of actions or their timestamps (the phrase duration is preserved, but the internal structure may change substantially). The one exception is **Hero Beat**, which is grouped here because it reshapes rhythmic *structure* even though it keeps every beat.

---

### Hero Beat

**What it does:** An 8-step groove sequencer over the phrase's own beats (stroke reversals). Each of the eight sliders sets how much **depth** that beat keeps: 100 = full, 0 = flat to center. Walk the beats in order, looping 1→8, and each beat's stroke is scaled to its step's emphasis. Set the hero beats high and the rest lower to carve a groove out of an even "wall" of strokes. All sliders at 100 (the default) makes no change.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Beat 1 … Beat 8 | 100 | 0 – 100 | Depth kept for each step of the repeating 8-beat cycle. 100 = full depth; 0 = flat to center. |

**Use it when:** A section is rhythmically even and you want to author accents — a strong-weak-medium-weak pulse, or any custom emphasis pattern. (A `[100,100,100,0,…]` pattern reproduces the old "Three-One Pulse".)

Hero Beat is **beat-preserving** — it keeps every action's count and timing, and only scales depth. It uses the script's *own* beats, not the music's grid: when you're editing a script the beats it already has are the right ones to shape (aligning to the music is a job for generation, not editing).

---

### Halve Tempo

**What it does:** Keeps every other stroke cycle and retimes the remainder evenly across the original duration. The result has half the BPM with the same start time, end time, and amplitude.

**Parameters:**

| Parameter | Default | Range | Description |
| --- | --- | --- | --- |
| Amplitude scale | 1.0 | 0.1 – 3.0 | Optional scale factor applied after halving. |

**Use it when:** A phrase is frantic (BPM > 200) or simply too fast to feel meaningful. Halve Tempo is the primary fix for frantic phrases.

---

### Nudge

**What it does:** Shifts the phrase forward or backward in time by a specified number of milliseconds. The gap created at the leading edge is filled with a short transition from the preceding position.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Nudge (ms) | 0 | -2000 – 2000 | Positive = shift forward; negative = shift backward. |
| Transition (ms) | 100 | 0 – 500 | Duration of the fill transition at the leading edge. |

**Use it when:** A phrase is slightly out of sync with a beat drop or audio cue. Nudge corrects the alignment without re-scripting.

---

### Stroke

**What it does:** Replaces the phrase with a regular synthetic 0–100 oscillation at the phrase's current BPM.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| BPM | phrase BPM | 10 – 300 | Target BPM for the synthetic stroke. |

**Use it when:** The phrase's motion is so irregular that corrective transforms cannot fix it — a clean synthetic stroke is better than trying to salvage the original. BPM defaults to the phrase's current BPM.

---

### Waiting

**What it does:** Replaces the phrase with a very slow oscillating stroke. Creates a placeholder for static or near-still sections.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Start position | 100 | 0 – 100 | Position at the start of the waiting stroke. |
| End position | 0 | 0 – 100 | Position at the end of the waiting stroke. |
| BPM | 1.0 | 0.0 – 5.0 | Oscillation rate (default ~1 cycle per minute). |
| Original influence % | 0 | 0 – 100 | How much of the original motion to blend in. |

**Use it when:** A section has essentially no motion and the device should be parked but not completely still — the slow waiting motion prevents it from going cold. Set Original influence > 0 to blend some of the original motion back in.

---

### Tide

**What it does:** Generates fast oscillations riding on a slow sine-wave center. The center point ebbs and flows over the phrase duration while the fast oscillations continue throughout.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Center high | 70 | 20 – 90 | Highest center position during the tide cycle. |
| Center low | 41 | 0 – 80 | Lowest center position during the tide cycle. |
| Stroke span | 30 | 5 – 60 | Amplitude of the fast oscillations. |
| BPM | 252 | 10 – 300 | Rate of the fast oscillations. |
| Wave period (s) | 135 | 10 – 600 | Duration of one slow center cycle. |

**Use it when:** A long phrase needs a breathing quality — the sensation of ebb and flow within continuous motion.

---

### Drift

**What it does:** Generates a high plateau with small oscillations and one slow dip — replicating the feeling of the drift behavioral pattern but with intentional shape.

**Parameters:**

| Parameter | Default | Range | Description |
|---|---|---|---|
| Plateau position | 85 | 50 – 100 | Center of the high plateau. |
| Wobble depth | 10 | 0 – 30 | Amplitude of small oscillations on the plateau. |
| Wobble BPM | 80 | 20 – 150 | Rate of the small oscillations. |
| Dip bottom | 30 | 0 – 70 | Lowest position during the dip. |
| Dip timing | 0.2 | 0.0 – 0.9 | When the dip occurs (fraction of phrase duration). |
| Dip duration (s) | 4.0 | 0.5 – 15.0 | How long the dip lasts. |

**Use it when:** You want a phrase that reads as a deliberate drift, not accidental off-centering.

---

## Tones

The seven **Tones** live in the Tone picker and reshape the overall feel — see **[Tones →](tone.md)**. Six are expressive moods (Tender / Build / Tease / Edge / Climax / Dominant); the seventh, **Tame**, is a *corrective* device-aware softener that humanizes a relentless wall of fast strokes — every beat kept, amplitude untouched — applied per chapter, phrase, or stanza. See **[Tame →](tone.md#tame)**.

---

## Consolidated transforms

These older transforms were folded into more capable ones. They still resolve in saved recipes, but no longer appear in the picker:

| Old transform | Use instead |
|---|---|
| Normalize Range | **Range** (Fit to content on) |
| Clamp Upper / Lower Half | **Range** (Fit to content off, band = `[50,100]` / `[0,50]`) |
| Shift | **Recenter** (move the midpoint) |
| Boost Contrast | **Amplitude Scale** (scale > 1) |
| Final Smooth | **Smooth** (light strength) |
| Break | **Amplitude Scale** (scale < 1) + **Smooth** |
| Three-One Pulse | **Hero Beat** (`[100,100,100,0,…]`) |
| Funnel | **Ramp** (renamed) |

---

## User-defined transforms

Beyond the built-ins, you can add your own:

**JSON recipes** — chain existing built-in transforms in `user_transforms/`. Safe: parameters are validated; only built-in transforms can be referenced. Worked examples live in `user_transforms/examples/`.

**Python plugins** — custom transform logic in `plugins/`. Disabled by default. Enable with `FUNSCRIPT_PLUGINS_ENABLED=1`. See [Extending Transforms →](../reference/cli.md) for details.
