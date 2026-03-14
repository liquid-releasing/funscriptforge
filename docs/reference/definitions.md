# Definitions

A complete glossary of every term used in FunscriptForge — in the app, in the docs, and in the output files.

---

## A

**Action**
A single `{at, pos}` pair in a funscript file. `at` is a timestamp in milliseconds; `pos` is a device position from 0 (bottom) to 100 (top). A funscript is a sorted list of actions.

**Amplitude**
The stroke depth of a phrase or cycle — how far the device moves from its lowest to its highest position within one oscillation. Measured as `max_pos − min_pos`. Full amplitude = 100; typical healthy amplitude = 60–90.

**Amplitude span**
The total position range covered by a phrase: the difference between the highest and lowest positions seen across all actions in the phrase.

**Assessment**
The full structural analysis of a funscript. Produced automatically when you load a file. Contains all phases, cycles, patterns, phrases, BPM transitions, and behavioral tags.

---

## B

**Behavioral tag**
A label assigned to a phrase by the behavioral classifier. Describes the dominant motion characteristic: stingy, giggle, plateau, drift, half_stroke, drone, lazy, or frantic. Phrases without a tag are well-formed.

**Blend seams**
An optional export pass that detects high-velocity jumps at phrase boundaries and applies targeted smoothing only at those transitions. Does not affect the interior of any phrase.

**BPM (beats per minute)**
The oscillation rate of a phrase or section. Measured as cycles per minute. 120 BPM = 120 complete up-down strokes per minute. Most mechanical devices handle up to ~200 BPM reliably.

**BPM threshold**
The BPM value used by the auto-suggestion engine in the Export tab to decide which transforms to recommend. Default is 120. Adjustable in the sidebar under Chart settings.

**BPM transition**
A detected tempo change between consecutive phrases. Shown as a thin vertical line on the Phrase Selector chart.

---

## C

**Cycle**
One complete up-down oscillation. A paired up phase + down phase. One cycle = one beat at the script's current BPM.

**Cycle count**
The number of complete oscillations in a phrase.

---

## D

**Device funscript**
The export output intended for mechanical devices (Handy, OSR2, SR6, etc.). Velocity is capped at 200 pos/s. Saved as `{name}.device.funscript`.

**Device safety**
The combination of quality-gate checks and velocity capping applied to the device export. Protects mechanical devices from motion commands they cannot execute safely.

---

## E

**Estim funscript**
The export output intended for electrostim routing (Restim, funscript-tools, Mk312, 2B, ET312). No velocity cap — the full waveform is preserved. Saved as `{name}.estim.funscript`.

---

## F

**Final smooth**
An optional export pass that applies a light global low-pass filter to the entire output. Default strength: 0.10. Removes residual sharp edges after all transforms have been applied.

**Forge log**
A `_forge_log` metadata block embedded in every exported funscript. Records the version, export timestamp, source filename, every transform applied (with parameters), and export options (blend seams, final smooth, clamp count).

**Frantic**
A behavioral tag. Assigned to phrases with BPM above 200 — near or above the mechanical limits of most devices.

**Funscript**
A `.funscript` file — a JSON document containing a sorted list of `{at, pos}` actions that describe device motion over time. The standard format for haptic device control.

---

## G

**Giggle**
A behavioral tag. Assigned to phrases with a very small amplitude span (< 20) centered around 50 — micro-motion that is barely perceptible.

---

## H

**Half-stroke**
A behavioral tag. Assigned to phrases with reasonable amplitude but confined to one half of the range (top or bottom). The device only uses half its capability.

---

## L

**Lazy**
A behavioral tag. Assigned to phrases with low BPM (< 60) and narrow amplitude span (< 50). Slow and shallow — low energy.

**Low-pass filter (LPF)**
A smoothing operation that reduces high-frequency variation. Used internally by several transforms (smooth, break, performance, blend seams, final smooth) to soften sharp transitions.

---

## O

**Oscillation count**
The total number of up-down pairs in a phrase (sum of oscillations across all cycles). Related to but not the same as cycle count — a cycle with multiple oscillations contributes more than 1.

---

## P

**Pattern**
A group of cycles with similar direction sequence and timing. The building block of a phrase.

**Passthrough**
A transform that makes no changes. Used to explicitly mark a phrase as reviewed and accepted as-is.

**Phase**
The smallest unit of motion. A single continuous movement in one direction — either upward, downward, or flat.

**Phrase**
A meaningful section of a funscript — the level at which FunscriptForge lets you work. Defined by a start time, end time, BPM, cycle count, amplitude characteristics, and a behavioral tag.

**Phrase Editor**
The tab in FunscriptForge where you edit one phrase at a time. Shows an original chart, a live preview chart, and transform controls.

**Plateau**
A behavioral tag. Assigned to phrases with a moderate amplitude span (20–40) centered in the middle of the range. Some motion, but lacking full range.

**Position (pos)**
A device position value from 0 (fully retracted / bottom) to 100 (fully extended / top). The unit all actions and transforms operate in.

---

## R

**Recenter**
A transform that shifts all positions in a phrase so the midpoint lands at a target value. Used to fix drift and half-stroke phrases.

---

## S

**Seam**
The boundary between two adjacent phrases. A point where one transform's output meets another's. Can produce velocity spikes if the transforms move the device in different directions at their endpoints.

**Split**
Dividing a phrase at a cycle boundary into two sub-phrases, each with its own transform. Useful when a phrase has two distinct characters.

**Stingy**
A behavioral tag. Assigned to phrases with full amplitude span, high velocity, and high BPM — intense, demanding, no variation.

---

## T

**Transform**
An operation applied to a phrase that changes how it feels — stroke depth, velocity profile, centering, smoothing, or tempo. Does not change action timestamps. 25 built-in transforms are available.

---

## V

**Velocity**
The rate of position change between two consecutive actions. Measured in positions per second (pos/s). Device safety thresholds: warning at 200 pos/s, error at 300 pos/s.

---

## W

**Window**
A user-defined time range used in the CLI `customize` step. Four window types: performance, break, raw, beats. Each type applies a different processing profile to the actions within it.
