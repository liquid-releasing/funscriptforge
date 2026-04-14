# Glossary

A complete glossary of every term used in FunscriptForge — in the app, in the docs, and in the output files.

---

## A

**Accept**
The action of confirming your work on a tab before moving to the next. Clicking Accept saves your changes to the chain file and unlocks downstream tabs. Each tab (Project, Device, Tone, Phrases, Stim, Multi-axis) has its own Accept button.

**Action**
A single `{at, pos}` pair in a funscript file. `at` is a timestamp in milliseconds; `pos` is a device position from 0 (bottom) to 100 (top). A funscript is a sorted list of actions.

**Alpha channel**
One of the two primary estim channel funscripts produced by funscript-tools. Controls one dimension of the 3-phase stimulation field. The alpha channel drives the left-right balance of the stereo audio output. File: `{stem}.alpha.funscript`.

**Amplitude**
The stroke depth of a phrase or cycle — how far the device moves from its lowest to its highest position within one oscillation. Measured as `max_pos - min_pos`. Full amplitude = 100; typical healthy amplitude = 60-90.

**Amplitude span**
The total position range covered by a phrase: the difference between the highest and lowest positions seen across all actions in the phrase.

**Assessment**
The full structural analysis of a funscript. Produced automatically when you click Accept on the Project tab. Contains all phases, cycles, patterns, phrases, BPM transitions, and behavioral tags.

**Audio synthesis**
The process of rendering stereo WAV files from estim channel funscripts. FunscriptForge uses 3-phase synthesis math extracted from restim (by diglet48, MIT license). Two waveform modes: continuous (for legacy devices) and pulse (for stereostim devices).

---

## B

**Behavioral tag**
A label assigned to a phrase by the behavioral classifier. Describes the dominant motion characteristic. Phrases without a tag are well-formed. The eight tags are: stingy, giggle, plateau, drift, half_stroke, drone, lazy, frantic.

**Beta channel**
The second estim channel funscript produced by funscript-tools. Controls the other dimension of the 3-phase stimulation field. File: `{stem}.beta.funscript`.

**Blend seams**
An optional export pass that detects high-velocity jumps at phrase boundaries and applies targeted smoothing only at those transitions. Does not affect the interior of any phrase.

**BPM (beats per minute)**
The oscillation rate of a phrase or section. Measured as cycles per minute. 120 BPM = 120 complete up-down strokes per minute. Most mechanical devices handle up to ~200 BPM reliably.

**BPM threshold**
The BPM value used by the auto-suggestion engine in the Export tab to decide which transforms to recommend. Default is 120. Adjustable in the sidebar under Chart settings.

**BPM transition**
A detected tempo change between consecutive phrases. Shown as a thin vertical line on the Phrase Selector chart. Often corresponds to scene changes in the source video.

---

## C

**Chain (chain file)**
A JSON file that records the state of your funscript at each workflow step. Each tab that modifies the funscript writes a chain file (e.g., `_funscript_device.json`, `_funscript_tone.json`). The Export tab reads the full chain to produce the final output.

**Continuous waveform**
One of two audio synthesis modes. Produces a smooth sine carrier signal suitable for legacy estim devices (2b, 312). Output file: `{stem}.legacy.wav`.

**Cycle**
One complete up-down oscillation. A paired up phase + down phase. One cycle = one beat at the script's current BPM.

**Cycle count**
The number of complete oscillations in a phrase.

---

## D

**Device funscript**
The export output intended for mechanical devices (Handy, OSR2, SR6, etc.). Velocity is capped for device safety. Saved in the `mechanical/` subfolder.

**Device safety**
The combination of quality-gate checks, groove, and velocity capping applied to the device export. Protects mechanical devices from motion commands they cannot execute safely.

**Drift**
A behavioral tag. Assigned to phrases where the motion center is displaced into the top or bottom third of the position range.

**Drone**
A behavioral tag. Assigned to phrases with sustained uniform motion — monotone, repetitive, fatiguing. Low variation in BPM and amplitude across cycles.

---

## E

**Estim funscript**
The export output intended for electrostim routing. No velocity cap — the full waveform is preserved. Saved in the `estim/` subfolder along with all channel files.

---

## F

**Final smooth**
An optional export pass that applies a light global low-pass filter to the entire output. Default strength: 0.10. Removes residual sharp edges after all transforms have been applied.

**FOC-Stim**
A protocol-based estim device. Does not use audio files — generates stimulation signals in its own firmware. Uses restim for real-time device control with exported channel funscripts. Supports 3-phase and 4-phase modes.

**Forge log**
A `_forge_log` metadata block embedded in every exported funscript. Records the version, export timestamp, source filename, every transform applied (with parameters), and export options.

**Frantic**
A behavioral tag. Assigned to phrases with BPM above 200 — near or above the mechanical limits of most devices.

**Funscript**
A `.funscript` file — a JSON document containing a sorted list of `{at, pos}` actions that describe device motion over time. The standard format for haptic device control.

**funscript-tools**
An external tool (by Lucifie) that generates estim channel funscripts from a primary funscript. Produces alpha, beta, frequency, volume, pulse_frequency, and pulse_rise channels. FunscriptForge calls it during export when estim devices are selected.

---

## G

**Giggle**
A behavioral tag. Assigned to phrases with a very small amplitude span (< 20) centered around the midpoint — micro-motion that is barely perceptible.

**Groove**
A device-aware setting on the Device tab that adds natural timing variation to each cycle. Range: 0.0 (mechanical — every cycle identical) to 0.50 (loose, unpredictable). 0.35 matches expert hand-scripted scripts. Applied during device export.

---

## H

**Half-stroke**
A behavioral tag. Assigned to phrases with reasonable amplitude but confined to one half of the position range (top or bottom). The device only uses half its capability.

**Heatmap**
A color-coded PNG visualization of the exported funscript. Colors represent velocity — fast strokes are warm (red/orange), slow strokes are cool (blue/green). Written as `{stem}.heatmap.png`.

---

## L

**Lazy**
A behavioral tag. Assigned to phrases with low BPM (< 60) and narrow amplitude span (< 50). Slow and shallow — low energy.

**Legacy (device)**
An audio-based estim device class including the 2b and 312. Uses continuous sine carrier waveforms. FunscriptForge renders a `{stem}.legacy.wav` file for these devices.

**Low-pass filter (LPF)**
A smoothing operation that reduces high-frequency variation. Used internally by several transforms (smooth, break, performance, blend seams, final smooth) to soften sharp transitions.

---

## M

**Multi-axis**
Secondary motion axes beyond the primary stroke (L0). Includes surge (L1), sway (L2), twist (R0), roll (R1), and pitch (R2). Generated algorithmically from the primary funscript based on per-phrase position styles. Supported by OSR2 and SR6 devices.

---

## N

**NeoStim**
A protocol-based estim device. Like FOC-Stim, it generates stimulation signals in firmware and does not use audio files. Uses restim for real-time device control.

**Next Steps**
The final tab in FunscriptForge. Shows device-specific playback instructions, community links, credits, and attribution.

---

## O

**Oscillation count**
The total number of up-down pairs in a phrase.

---

## P

**Passthrough**
A transform that makes no changes. Used to explicitly mark a phrase as reviewed and accepted as-is.

**Pattern**
A group of cycles with similar direction sequence and timing. The building block of a phrase.

**Pattern Editor**
The tab in FunscriptForge where you batch-edit all phrases that share the same behavioral tag. Apply one transform to all matching phrases at once.

**Phase**
The smallest unit of motion. A single continuous movement in one direction — either upward, downward, or flat.

**Phrase**
A meaningful section of a funscript — the level at which FunscriptForge lets you work. Defined by a start time, end time, BPM, cycle count, amplitude characteristics, and a behavioral tag.

**Phrase Editor**
The tab in FunscriptForge where you edit one phrase at a time. Shows an original chart, a live preview chart, and transform controls.

**Plateau**
A behavioral tag. Assigned to phrases with a moderate amplitude span (20-40) centered in the middle of the range. Some motion, but lacking full range.

**Position (pos)**
A device position value from 0 (fully retracted / bottom) to 100 (fully extended / top). The unit all actions and transforms operate in.

**Position style**
A Multi-axis setting assigned per phrase that simulates a physical position (e.g., missionary, riding, doggy). Each style derives the secondary axes differently from the primary stroke data.

**Prostate channel**
A secondary set of estim channels (alpha-prostate, beta-prostate) generated by funscript-tools for dual-zone stimulation. When present, FunscriptForge also renders prostate-specific WAV files.

**Pulse waveform**
One of two audio synthesis modes. Produces a duty-cycled pulse train with cosine envelope, suitable for stereostim devices (Tingler, EstimHero, ZC95). Output file: `{stem}.stereostim.wav`.

---

## R

**Recenter**
A transform that shifts all positions in a phrase so the midpoint lands at a target value. Used to fix drift and half-stroke phrases.

**restim**
An open-source electrostim control application by diglet48 (MIT license). FunscriptForge extracted its 3-phase synthesis math for audio rendering. Protocol devices (FOC-Stim, NeoStim) use restim as their real-time player.

---

## S

**Seam**
The boundary between two adjacent phrases. A point where one transform's output meets another's. Can produce velocity spikes if adjacent transforms move the device in different directions at their endpoints.

**Split**
Dividing a phrase at a cycle boundary into two sub-phrases, each with its own transform. Useful when a phrase has two distinct characters.

**Stereostim (device)**
A pulse-based estim device class including the Tingler, EstimHero, and ZC95. Uses pulse train waveforms with cosine envelope. FunscriptForge renders a `{stem}.stereostim.wav` file for these devices.

**Stim character (preset)**
A creative preset on the Stim tab that controls how funscript-tools generates estim channels. Five built-in characters: Gentle, Reactive, Scene Builder, Unpredictable, and Balanced. Each produces a different electrode movement pattern.

**Stingy**
A behavioral tag. Assigned to phrases with full amplitude span, high velocity, and high BPM — intense, demanding, no variation.

---

## T

**T-Code**
The naming convention for multi-axis funscript files. L0 = stroke, L1 = surge, L2 = sway, R0 = twist, R1 = roll, R2 = pitch. T-Code players (MultiFunPlayer, XTP) auto-discover files by the `.axis.funscript` naming pattern.

**Tone**
One of six emotional presets that shape the overall feel of your output. Applied globally on the Tone tab. The six tones: Tender, Build, Tease, Edge, Climax, Dominant. Each changes how transforms are suggested and applied without altering the underlying phrase structure.

**Transform**
An operation applied to a phrase that changes how it feels — stroke depth, velocity profile, centering, smoothing, or tempo. Does not change action timestamps. 25 built-in transforms are available.

---

## V

**Velocity**
The rate of position change between two consecutive actions. Measured in positions per second (pos/s). Device safety thresholds: warning at 200 pos/s, error at 300 pos/s.

---

## W

**Workflow template**
A `.forgetmpl` file that records your workflow decisions (tone, device targets, transform strategy) without project-specific data. Drop it into a new project to reuse the same settings.
