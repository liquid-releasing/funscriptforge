# Tone Scope — applying a tone only where the script is quiet (or loud)

**Status:** designed, not built. Targeted at the release after v0.5.19-alpha.
**Origin:** dogfood 2026-09-23, `hovixag935_-_milky_muscle_mommy_Katie_v2`.

One sentence: let a tone apply to **part** of a chapter, selected by a
condition on the script itself, instead of to the whole chapter.

---

## 1. The problem, in the user's words

> "The green bands were essentially quiet on my estim. What I want to do is
> take the green areas and apply the climax tone to them, but leave the
> existing orange and red intact, so as not to create a total wall of red."

and, refining it:

> "Interleaving is actually wanted of red and green. It is the texture. The
> issue is where it goes blank for an undetermined amount of time where you can
> hear the beat and nothing is happening. The music gets quiet and the stim
> should be reduced, but **not totally gone**. And what I learned was that green
> means **gone**."

The last sentence is the whole feature. Not "quieter" — *gone*. That
nonlinearity is what makes this worth a control rather than a slider nudge.

---

## 2. What was measured

All numbers from `hovixag935_-_milky_muscle_mommy_Katie_v2.funscript`
(6864 actions, 29.0 min) and its generated `polish/estim3p/` channels.
**Keep these — they are the evidence base and they were expensive to get.**

### 2.1 Bands are defined by the chart's velocity colormap

`VELOCITY_STOPS` in forgemoment `Charts.jsx`: 0.0 blue → 0.25 cyan → 0.5 green
→ 0.75 yellow → 1.0 red, applied to `velocity / p98(velocity over the track)`.
For this file **p98 = 377 u/s**.

### 2.2 The green bands are shallower, not slower

| band | median depth | median gap | implied rate | share of track |
|---|---|---|---|---|
| blue | 40 | 488 ms | 2.0/s | 2.0% (33.9 s) |
| green | **54** | **255 ms** | **3.9/s** | 35.1% (609.5 s) |
| yellow | 78 | 255 ms | 3.9/s | 10.4% (181.3 s) |
| red | 88 | 255 ms | 3.9/s | 52.6% (913.7 s) |

★ **Green, yellow and red share an identical 255 ms spacing.** The tempo never
changes. Only depth differs — 54 against 88. So the complaint is a *depth*
problem, and `climax` is an amplitude expander. Right tool, for a reason.

Chapter 1 (0–159 s) is 383 green segments against 242 red, which is why it is
the chapter the user noticed.

### 2.3 What the device signal actually does

Channels resampled onto a fixed 10 Hz grid; median per-second value and median
per-second peak-to-peak:

| channel | green level | red level | green p2p | red p2p |
|---|---|---|---|---|
| volume | 86.0 | 87.9 | **0.2** | **0.0** |
| frequency | 92.5 | 97.5 | 0.2 | 0.0 |
| pulse_frequency | 60.7 | 75.2 | 7.0 | 6.7 |
| alpha | 50.3 | 55.1 | 60.0 | 73.8 |
| **beta** | **93.2** | **81.3** | **15.0** | **41.0** |

★ **Volume and frequency do not modulate anywhere.** Flat plateaus across the
whole track, in both bands. There is no volume beat to lose and no volume knob
that can restore one.

★ **Beta is the difference.** 15 units of swing in green against 41 in red
(0.37×), while parked up at 93 near the top of its range. Alpha is 0.81×.
Combined positional excursion in green is ≈0.73× of red.

So the sensation in a green section sits near one electrode pair and shuffles
in place at a constant level. Constant position + constant level = constant
stimulus, and the body stops registering a constant. That is the best available
explanation for "gone" rather than "quiet" — it is consistent with every
measurement, but it is an inference about perception, not a proven mechanism.

---

## 3. Ruled out — do not re-litigate these

**The alpha/beta speed gate.** `convert_funscript_radial` has
`speed_threshold_percent = 50`, which scales the radius down toward
`min_distance_from_center = 0.1` below the threshold. A hard gate would have
explained the nonlinearity neatly. It does not apply: the gate saturates at
~100 u/s and green runs at 212 u/s, so **green gets full radius (1.0),
identical to red**. Only blue is touched at all (speed_pct 41 → radius 0.838).
Corollary: `min_distance_from_center` cannot fix this — the radius is not the
constraint, the *path* is.

**`combine_funscripts`' rest_level.** `is_rest = (y_left == 0) | (y_right == 0)`
multiplies by `rest_level = 0.4`, which could have produced beat-like dips only
where strokes reverse hard. Measured: low volume samples sit **44% (green) vs
43% (red)** within 60 ms of a stroke reversal — no discrimination — and their
median ratios are 0.61/0.56, not 0.4.

**⚠ A retracted finding.** An earlier pass reported volume movement of 1.3
(green) vs 44.0 (red) and concluded "green is flat, red is pulsing." **That was
an artifact.** It measured mean absolute delta between consecutive *stored*
samples within each second, but `polish.apply_pass` thins redundant points, so
volume averages **0.8 stored samples per second** (green 1.18/s, red 0.46/s).
Only seconds holding two or more samples contributed — exactly the seconds
where volume moves fastest. The statistic selected for what it was measuring.
Resampled on a fixed grid, volume p2p is ~0 in **both** bands. Any future
measurement of a polished channel must resample first.

---

## 4. Design

### 4.1 A scope, not a second slider

The user's first proposal was a second slider ("emphasize quiet") mirroring
`impact` but applying only to green/blue. What is actually being described is
**where the tone applies** — which is a scope, not an intensity. As a scope it:

- composes with **every** existing tone for free, instead of needing a new
  slider added to each one;
- expresses "tone down the loud parts" as well, which was the user's own
  immediate reaction and is not reachable from an "emphasize quiet" slider;
- generalises to other conditions later (see §7).

**Shape:** a selector beside the existing `impact` slider in the tone panel.

> **Apply to:**  Everywhere · Only the quiet parts · Only the loud parts

The motivating case becomes **Climax · quiet only · impact 50%**.

### 4.2 Select on absolute stroke depth, NOT on colour

The colormap is normalised to the p98 of **that track's own** velocities.
Defining the feature as "the green parts" therefore breaks three ways:

1. **Not idempotent** — boosting the quiet parts moves p98, so a second pass
   selects a different set of regions.
2. **Not portable** — the same passage in another file is a different colour.
3. **Already ambiguous** — per-chapter views scale locally while Overview uses
   track p98. See the comment at `FunscriptChart.jsx:93`. "Green" is not one
   thing inside the app today.

Key off **absolute stroke depth** (peak-to-trough in position units). Stable,
reproducible across files, and it is the quantity actually being fixed. The UI
can still say "the quiet parts"; at default settings they will be the regions
the user is pointing at.

### 4.3 Suggested default

To bring this file's green median (54) up to its red median (88):
`54 × (1 + contrast × 0.85) = 88` → **contrast ≈ 0.74**.

Because the rate is unchanged, depth and velocity rise together: green would
land near 0.85 × p98, i.e. orange. That is precisely "a beat, even one not as
strong as before." Treat 0.74 as a starting point to audition, not a constant —
matching red exactly across 35% of the track is the wall-of-red risk the user
named, and only their ear can settle it.

### 4.4 ★ Boundaries — the part that must not be skipped

Chapter 1 alone has **383 green and 242 red segments interleaved**. A hard
on/off at every band edge would create hundreds of discontinuities — the same
class of artifact removed from chapter boundaries in `45d0e2c`
(see `DESIGN`/commit "Stop generating a fade at every chapter boundary").

Required:

- **Minimum region length.** Ignore sub-second dips; they are texture, not
  quiet passages. The user is explicit that the interleaving is *wanted*.
- **Ramp the impact across each edge** rather than switching. Blend 0 → full
  over a few hundred ms so the treated region meets the untreated one
  continuously.

Getting this wrong reintroduces, at much higher frequency, the exact bug we
spent 2026-09-23 removing.

---

## 5. Placement: Chapters, not Channels

**Chapters owns tone**, and a tone rewrites the motion funscript (into
`<stem>.work.funscript`). **Channels assigns a character** per chapter, which
drives e-stim *generation from* the funscript and changes nothing in it.

This control changes stroke depth. It is a tone. It belongs beside `impact` in
the Chapters tone panel, at the per-chapter granularity the user wants.

**Why Channels would be actively wrong:** a tone changes the *shared* motion
funscript, which the Handy, OSSM and FOC-Stim all play. Sitting in the e-stim
tab, users would reasonably expect it to affect e-stim only. It would not.

**The real alternative, named so the choice is deliberate:** since the carrier
is alpha/beta excursion, this could instead be fixed in the *derivation* —
expand the radial path where source strokes are shallow, e-stim only, funscript
untouched. That would genuinely belong in Channels. Rejected because (a) no
existing knob reaches it — radius is already 1.0 in green, so it needs a new
transform inside vendored funscript-tools; (b) the tone path already exists and
`climax` is already the right math; (c) scope generalises to "tone down the
loud parts" and to the all-talk case, and neither is an e-stim concern.

**The UI must state** that this changes the motion every device plays. That is
a feature — the user is authoring a livelier script, not compensating for one
device — but unstated it will be filed as a bug by the first person who runs it
and then plays on a Handy.

---

## 6. Verification

★ **Measure success on beta excursion, not on volume.** Volume reads 86 before
and 86 after; a tester watching volume will conclude nothing happened.

Target: green-band beta p2p moves from ~15 toward red's ~41, and combined
alpha/beta excursion from ~0.73× of red toward ~1.0×.

Method: resample channels to a fixed grid (§3, retracted finding) and compare
per-second peak-to-peak by band, using the same p98 banding as §2.1. The
scratch scripts that produced every table here were throwaway; rebuild them
from this doc rather than hunting for them.

---

## 7. Open questions

- **What other conditions earn a place in the selector?** "All talk" was raised
  and not explored. If the condition list is going to grow, design the
  condition as a first-class object now rather than hardcoding quiet/loud.
- **Is depth the right selector, or should it be beta excursion?** Depth is
  what the user edits and sees; beta excursion is what they feel. They are
  strongly correlated here but not identical, and excursion is only computable
  after generation.
- **Does contrast 0.74 across 35% of a track read as a wall?** Only auditioning
  answers this.
- **Should the scope be visible on the chart** — the treated regions shaded —
  so the selection is inspectable before Accept? Probably yes, given the
  selection is computed rather than authored.

---

## 8. Principle this feature serves

> "I can imagine a user doing customized scripts. Just because we CAN write
> them all does not mean the user should not customize as needed."

Phrases, stanzas and events are all **span authoring**: pick a region, then say
what happens there. That is why they are tedious here and why events did not
clean it up — the work scales with the number of regions, and this file has 383
green segments in one chapter.

Tone Scope is a different shape: **one decision, applied by condition.**
"Climax, quiet parts only, 50%" is a sentence about a whole chapter that the
engine expands into hundreds of regions. It is the first control in the app
where the *selection* is computed rather than authored, and that is what makes
it a gross-scale editing tool rather than another authoring surface.

It does not replace per-span authoring. It gets the user to 90% in one gesture
so the remaining 10% is worth their attention.
