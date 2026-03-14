# Behavioral Tags

FunscriptForge classifies every phrase by its motion characteristics. The tag names the dominant behavior — and if there is a problem, it names that too.

Use the tag to quickly find what needs fixing and to know which transform to reach for.

---

## How tags are assigned

After the structural analysis, the behavioral classifier measures each phrase's:

- **Amplitude span** — how far the device moves (max_pos − min_pos across the phrase)
- **Mean position** — the average center of the motion
- **Mean velocity** — how fast positions change on average
- **BPM** — cycles per minute
- **BPM variation** — how much the tempo fluctuates within the phrase
- **Duration** — how long the phrase lasts

A phrase can have more than one tag. The tags are not mutually exclusive.

---

## Tags

### stingy

**What it is:** High-BPM, full-range, high-velocity hammering. The device is working at its limit with no variation.

**Detection:** BPM > 120, velocity > 0.35, amplitude span > 75.

**The problem:** Intense and physically demanding. No dynamics, no variation, no nuance. Fatigues both the device and the user quickly.

**Fix:** Reduce intensity. Start with **Amplitude Scale** (scale down to 0.7–0.9) or **Performance** to shape the velocity profile. If the tempo is the issue, **Halve Tempo** is an option.

<!-- CAPTION: Chart — a stingy phrase. Full-range strokes packed tightly, no variation in amplitude. Caption: "Stingy: full-range hammering at high BPM. Every stroke hits the extremes with no relief." -->

---

### giggle

**What it is:** Tiny oscillations centered around the midpoint. The device barely moves.

**Detection:** Amplitude span < 20, mean position between 35 and 65.

**The problem:** The motion is technically present but imperceptible. The device shakes rather than strokes.

**Fix:** **Normalize Range** expands the span to fill the target range while preserving the centering and tempo. For very fast giggle phrases, **Amplitude Scale** with scale > 2.0 may be needed.

<!-- CAPTION: Chart — a giggle phrase. Small oscillations clustered tightly around position 50. Caption: "Giggle: the device trembles but doesn't stroke. Normalize Range fixes this in one step." -->

---

### plateau

**What it is:** Moderate oscillations centered in the middle of the range. Some motion, but not enough range to be engaging.

**Detection:** Amplitude span between 20 and 40, mean position between 35 and 65.

**The problem:** The phrase is correctly centered but the strokes are shallow. It feels like the device is half-committing.

**Fix:** **Amplitude Scale** (scale up to 1.4–1.8) or **Normalize Range** to expand the span to full range.

---

### drift

**What it is:** Motion displaced into the top or bottom third of the range. The center of the oscillation is far from 50.

**Detection:** Mean position below 30 or above 70, amplitude span > 15.

**The problem:** The device is using only one end of its range. The other end is wasted.

**Fix:** **Recenter** with target center = 50. This moves the entire oscillation to the middle of the range without changing the stroke depth or tempo.

<!-- CAPTION: Chart — a drift phrase. Oscillations running between roughly 60–90, hugging the top of the range. Caption: "Drift: the motion is real but confined to the wrong zone. Recenter brings it back to the full range." -->

---

### half_stroke

**What it is:** Reasonable stroke depth but confined to one half of the range (top or bottom).

**Detection:** Amplitude span > 30, mean position below 38 or above 62.

**The problem:** Similar to drift but with more stroke depth. The device uses half its range well but ignores the other half.

**Fix:** **Recenter** with target center = 50. Preserves the stroke depth; just repositions it.

---

### drone

**What it is:** Long, sustained, highly uniform motion. No tempo variation, no amplitude variation.

**Detection:** Duration > 90 seconds, BPM coefficient of variation < 10%.

**The problem:** A monotone section that fatigues quickly. Machine-like regularity with no dynamics.

**Fix:** **Beat Accent** adds periodic emphasis without changing the tempo. **Boost Contrast** increases the amplitude at peaks and troughs. **Three-One Pulse** introduces a rhythmic rest beat every four cycles.

<!-- CAPTION: Chart — a drone phrase. Very regular, high-density oscillations across several minutes with no visible variation. Caption: "Drone: the phrase is structurally correct but behaviorally flat. Beat Accent or Boost Contrast adds dynamics." -->

---

### lazy

**What it is:** Slow and shallow. Low BPM, narrow amplitude.

**Detection:** BPM < 60, amplitude span < 50.

**The problem:** The motion is both slow and shallow — doubly understated. Either it reflects genuinely quiet content (fine, mark it as Passthrough) or it needs energy added.

**Fix:** **Amplitude Scale** to increase stroke depth. **Normalize Range** if the span is very compressed. If the content is genuinely quiet, **Passthrough** is appropriate.

---

### frantic

**What it is:** BPM above 200 — near or above the mechanical limits of most devices.

**Detection:** BPM > 200.

**The problem:** Most mechanical devices (Handy, OSR2, SR6) cannot reliably execute motion above 200–250 BPM. The device skips or stutters. The experience is noise, not motion.

**Fix:** **Halve Tempo** reduces BPM by half while preserving duration, amplitude, and feel. A 240 BPM phrase becomes 120 BPM — still fast but executable.

<!-- CAPTION: Chart — a frantic phrase. Extremely dense, tightly packed oscillations. Caption: "Frantic: the device physically cannot follow this. Halve Tempo makes it executable without losing the energy." -->

---

## No tag

Phrases without a tag are well-formed. The amplitude, centering, tempo, and dynamics are all within normal parameters.

The Export tab still suggests a transform for untagged phrases (usually **Amplitude Scale** or **Passthrough**). You can accept the suggestion, change it, or mark the phrase explicitly with **Passthrough** to leave it unchanged.

---

## Summary table

| Tag | Amplitude | Position | BPM | Duration | Primary fix |
| --- | --- | --- | --- | --- | --- |
| stingy | > 75 | any | > 120 | any | Amplitude Scale ↓ or Performance |
| giggle | < 20 | 35–65 | any | any | Normalize Range |
| plateau | 20–40 | 35–65 | any | any | Amplitude Scale ↑ |
| drift | > 15 | < 30 or > 70 | any | any | Recenter |
| half_stroke | > 30 | < 38 or > 62 | any | any | Recenter |
| drone | any | any | any | > 90 s, low variation | Beat Accent or Boost Contrast |
| lazy | < 50 | any | < 60 | any | Amplitude Scale ↑ |
| frantic | any | any | > 200 | any | Halve Tempo |

---

## Related

- [Transforms →](../guide/transforms.md) — full reference for every transform
- [Pattern Editor →](../guide/pattern-editor.md) — fix all phrases of a given tag at once
- [Concepts →](../concepts.md) — how behavioral classification fits the pipeline
