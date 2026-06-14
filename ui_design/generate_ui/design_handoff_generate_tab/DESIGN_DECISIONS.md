# Generate-into-FunscriptForge — resolved design model

> Companion to `README.md` (the designer's prototype handoff). The README describes
> what was *built*; this file records what we *decided* after dogfooding it, including
> the vocabulary fixes, the passages resolution, and the user-facing explanation.
> When the two disagree, **this file wins** — it's the build spec.

Date: 2026-06-13. Source of truth for the conversation that produced it.

---

## ★ NORTH STAR (read before building anything)

**If the generation is right, the layers are optional — and the oracle is what proves it.**

The whole point is that the default path is **"generate → it's already good → done."** The
fine-tuning layers (tones, phrases, passages, events) exist for when a user *wants* control,
never as a tax for getting a usable script. So the highest-leverage investment is always
**generation quality first**, then the **diagnosis oracle** — because the oracle is what lets
a user *trust* the output enough to skip the knobs (without a quality readout, people fiddle
out of doubt). Great generation makes fine-tuning optional; the oracle makes "optional"
believable. Build in that order.

The longer arc this points to: **near-real-time generate-and-play** (the player becomes the
generator — already true under "funscript = live derivation of intent") + **video event
extraction** that flips Events from author-from-scratch → confirm-and-nudge (the moonshot
leg; imperfect extraction + human confirm still beats a blank canvas). Generation quality is
the foundation all of it rests on. *(This vision is worthy of Edger's thoughts —
[[project_edger_licensing]].)*

---

## TL;DR

A great haptic script makes several **genuinely independent** decisions. We tried to
collapse them into fewer controls and it lied to the user (one knob can't say "deep"
*and* "busy"; the arc isn't loudness). So the model is layered — but **progressively
disclosed**: sensible defaults, free-roam navigation, you can stop after Generate and
have a real script. Each later tab is optional refinement, never a gate.

The whole thing is **one idea repeated at two altitudes**:

- **Generate** shapes the **main** funscript (position) with two macro curves.
- **Channels** shapes the **secondary** dimensions (e-stim, mechanical, body) with the
  same kind of macro curves — those are **Passages**.

---

## The pipeline (tab map)

| Tab | Job | Stage | Primary control |
|---|---|---|---|
| **Library** | pick source | — | *frozen, no change* |
| **Project** | confirm "yes, this is what I'm working on" → Accept | — | *frozen*; source lens picker defaults to **Intensity** |
| **Generate** | **create** the main funscript | before it exists | **Range + Pace** curves (the two lanes) |
| **Chapters** | **re-flavor** chapters | after, on top | **Tone** per chapter (Build/Climax/Tease…) |
| **Phrases** | slice-and-dice local texture | after | transforms (skip every-other-beat, flourish in breaks…) |
| **Events** | discrete moments | after | startle/reaction on the Edger catalog |
| **Channels** | secondary dimensions | per device | **Passages** (macro) over E-stim / Mechanical / Body |
| **Polish** | clamp to device specs | last | device stations |
| **Export** | package `.forge` | last | — |

Generate has a **player** (correct). Project does **not** — Project is confirm-only.

---

## The core symmetry (the whole design in two lines)

```
Generate:  depth/density (macro) → MAIN funscript      → phrases/events (local detail)
Channels:  passages       (macro) → e-stim/mechanical/body (local detail)
```

`depth/density : main funscript  ::  passages : secondary dimensions`

Same role (set the overall direction across the whole landscape), different target.
The symmetry is the tell that the model is right.

---

## Passages — the resolution (this was the hard one)

Passages are **the depth/density of the *secondary* world.** They set the **overall
direction across the whole video** for the dimensions that aren't the main motion:

```
 ▸ PASSAGES        ← overall direction across the landscape (lane curves, depth/density feel)
   ├ E-stim        volume · frequency · pulse-frequency   — its own detail
   ├ Mechanical    twists & turns                          — its own detail
   └ Body          how HARD the haptic responds            — its own detail
```

**Body — the clearest proof of why passages are a separate axis.** Body is *how hard the
haptic responds*, and it is **decoupled from the position funscript.** Early: easy/gentle
response **even with a full up-down funscript.** Over time the passage ramps it — the
**same full-range strokes** start landing harder, up to "knock you across the room" if the
user wants. The motion never changed; the *force* did. Depth/density can't express this —
they shape the **motion**, Body shapes **how hard it lands.** This is why perceived
intensity ≠ the funscript, and why passages can't be folded into Generate.

- **One shared arc, preset-selected** (not one arc per layer). The user picks a *single*
  passage arc (preset, in beta); each secondary layer renders that same overall direction
  its own way (e-stim as volume/freq/pulse, body as response-hardness, mechanical as twists).
  "Same arc for passages with selected presets."
- A passage is **not** a control on the main funscript. It does not touch position.
- A passage shows up **per layer**: in e-stim it's volume/frequency/pulse-frequency; in
  mechanical it's the twist/turn envelope; in body it's body's own params. The passage is
  the **shared macro intent**; each layer is the **local performance** of it.
- This is **Edger's whole model, broken into chapters.**
- **Home: Channels, as the top layer** above Character/Mechanical/Body — where it stops
  being "almost overlooked" and becomes the headline.
- **Same UI and same suggestions as depth/density** — this is a hard requirement, not just
  a nicety. Passages reuse the **same `LaneEditor`** (drag handles, double-click add/remove,
  "Set here" playhead capture), the **same preset-pill pattern**, and the **same "what to
  fix" suggestion treatment** — just with their own preset vocabulary per layer (e.g.
  e-stim: *Warm hum / Build the charge / Edge & release*; body: *Ease in / Build to brutal /
  Hold steady*). **A user who learns depth/density on Generate already knows how to author
  passages on Channels** — nothing new to learn. One widget, two homes, two targets.
- **Not** in Generate: Generate is device-agnostic main motion that every device derives
  from; passages are device-dimension feel. They go with their kin in Channels.

Rationale also lives in the unified-score-model direction: Character / Mechanical / Body /
Events / **Passages** are layers of one modality-agnostic score, rendered per device.

---

## Vocabulary decisions (the prototype's words confused the user — these replace them)

| Prototype word | Problem | New word / treatment |
|---|---|---|
| **Depth** | "deep" reads as down / bass | **Range** — "how far each stroke goes" (shallow tease → full rail-to-rail) |
| **Density** | jargony | **Pace** / "how busy it is" — how close together the strokes are |
| **strokes** | fine | **keep** — it's the funscript word, users know it |
| **Deciles** | nobody knows what a decile is | **"Where the strokes land"** (or "Range spread") — bunched mid-range = weak, spread across full Range = strong |
| **Dynamics** | "I may need to fix it but it's not clear how" | rename **Contrast** (or Variety) **and wire the number to its one fix** — a low score *lights up* "Add an arc"; never diagnose without offering the button |
| **Character** | overloads **Tone** (already on chapters) | **drop it** — there is no separate Character axis; the per-chapter personality is **Tone** |

Range × Pace = "how far × how fast." Their product is **Intensity** — which you don't set,
you **watch** (the heatmap). Intensity is emergent, not a third curve.

---

## The seeding correction (don't reintroduce this)

The SourceCard says *"the lanes are seeded from this source"* over an **audio waveform** —
implying loud → busy. The forgegen density-dynamics work **refuted** that:
corr(music energy, gold stroke rate) ≈ **0.17**. The good arc is an **authored narrative
choice** (build-in / flat body / climax bump / comedown), not loudness.

Split the seed:

- **Audio → the beat grid / tempo** (legit — strokes land on beats; octave-guarded).
- **Audio energy → the density arc** (**refuted — do not**). Seed the *arc* from a default
  build→peak→comedown shape (or chapter structure), never from loudness.

Honest helper copy: *"Strokes snap to the beat from this audio. The arc starts from a
standard build-and-release — drag to make it yours."*

---

## BETA SCOPE — presets only (movable lines deferred)

**For beta, the lane curves are NOT draggable. Authoring is by preset pill only.** Pick a
named shape ("Slow burn", "Build to brutal") → it loads that curve → live regen. The curve
renders **read-only** so you see the shape. This applies to **all** lanes — depth/density on
Generate *and* passages on Channels.

Why it's the right cut: it ships the **whole model** at a fraction of the build (no drag,
no pointer-capture, no curve editing), and the **named presets ARE the vocabulary** — the
user learns "this is what a slow burn looks like" before ever fine-tuning one. Cascades:

- **"Set here" playhead-capture defers too** — it existed to place a handle in time; presets
  place no handles. (Originally to replace the bad Begin/End sliders; with presets-only there
  are no time handles to set, so the whole interaction is post-beta.)
- **"What to fix" FixCards still work** — they already apply a preset shape; unchanged.
- Beta lane = **preset pills + rendered read-only curve + live regen on pick.** That's it.

**Post-beta:** movable handles (drag value, drag time, double-click add/remove) + "Set here"
playhead-capture for hand-tuning. The `LaneEditor` in `lanes.jsx` already implements all of
this — beta just hides the handles and exposes the preset row.

## Time-setting interaction (POST-BETA — see Beta scope above)

When movable handles land: replace the Begin/End sliders with **capture-from-playhead** —
while editing a handle, **play the video, stop on the moment, hit "Set here"** → the handle's
time snaps to the playhead. The video *is* the time picker. (Reuse the Events-tab
begin/end-from-playhead pattern.) Not in beta.

---

## Diagnosis ("What to fix") — make it actionable (build target)

The panel is the moat — a **measured** definition of good, not vibes. Hard rule:
**never show a problem without the button that fixes it.** Runs live on the generated
script; metrics flip to green ✓ as fixes apply, so the user *watches the script improve*.

Three parts, each = **verdict → evidence → one-click fix → (located on the timeline):**

1. **Headline verdict** — one word read in half a second (**Flat / Decent / Dynamic**) +
   the **single highest-impact fix** as the primary button ("Biggest win: Add an arc →").
2. **"Where the strokes land"** (the histogram) — ghost the **target spread** behind the
   bars so "good" is visible; plain verdict; attached fix.
   > *"82% of your strokes hug the middle — they barely touch the rails."* **[Fill the rails →]**
3. **Contrast** (was "dynamics") — over-time sparkline; **highlight the flat span on the
   timeline** so the fix is *located*, not vague.
   > *"3:00–7:00 runs at one level — no build."* **[Add an arc →]**

`diagnose()` (deciles / dynamics / rails / coverage / avgDepth) already produces the data.
The work is: actionable copy, ghost target overlay, coupling each metric to its preset fix,
and **localizing weak spans on the timeline** (aggregate → "fix *this* span").

## The nits, consolidated (what changes from the prototype)

1. **Left "What to fix" panel → more prominent.** It's the quality oracle — the thing no
   competitor has. Make it loud: wider, bold dynamics/Contrast readout, FixCards that look
   like the primary action they are.
2. **Drop the "Selected section" card from Generate.** Its *span* job is the curves; its
   *character* job is Tone in Chapters. It's the old passages-of-the-main-script editor,
   redundant. Generate = viewer + two curves + "what to fix." Nothing competing.
3. **No chapters/sections authored on Generate.** Chapters are carved later, in Chapters,
   over the finished funscript.
4. **Generate top panel = same chrome as other tabs, but content = Intensity + Beats +
   Range** (the things you change here), not a raw position line.
5. **Project source lens picker** = `Frames · Waveform · Spectrogram · Intensity · Beats`,
   default **Intensity**. Same shared lane set, different default per tab.
6. **Vocabulary + seeding + time-picker** per the sections above.

---

## Channels tab — layout nits

- **Narrow the CHAPTERS left rail.** It's currently far too wide; it only needs room for the
  color bar + `ch#` + the `m:ss–m:ss` range. Narrowing it **pulls the nine e-stim funscripts
  left, closer to where the user sets them**, and lifts the funscript rows ~two scrolls
  higher (reclaimed horizontal space). Cuts the reach between "which chapter" and "the nine
  channels."
- (Recall: **Passages** is the new top layer above Character/Mechanical/Body here — one
  shared arc, preset-selected, driving e-stim/mechanical/body. See the Passages section.)

## USER-FACING EXPLANATION (put a version of this in the app / docs)

### How to think about it
Authoring a script answers a few **independent** questions. Each tab owns one:

- **Generate — how does it move?** Two dials: **Range** (how far each stroke goes —
  shallow tease to full) and **Pace** (how busy — slow and spaced to fast and packed).
  Drag them to tell the whole story: start small and slow, build bigger and faster, peak,
  ease off. You watch **Intensity** (the colorful heatmap) light up as you go — that's
  Range and Pace combined; you don't set it directly.
- **Chapters — what's the feeling of each part?** Give each chapter a **Tone** (Build,
  Tease, Climax, Tame…). The motion you already made stays; the tone leans it.
- **Phrases — fix the rough patches.** A stingy stretch can skip every other beat; a quiet
  break can get a flourish.
- **Events — punctuate moments.** Something startling exactly when she smiles at you.
- **Channels — the deeper feel.** **Passages** set the overall direction of the e-stim,
  mechanical, and body layers across the whole video — the same way Range/Pace shape the
  main motion. Underneath, each layer adds its own life.
- **Polish — make it fit your device.** Then Export.

### Why it's this layered ("why so damned complicated")
Because a great haptic script makes several decisions that are **genuinely independent**,
and one or two knobs can't express them — so collapsing them produces boring, samey
output (the failure mode our own research proved: fixed-depth scripts go bimodal and
flat). Specifically:

- **Range and Pace are independent.** A slow-deep grind and a fast-shallow flutter are
  *both* good — one number can't say both. → two dials.
- **The arc is independent of the moment.** You can be full-depth the whole time and still
  build from sparse to dense. → Tone, per chapter.
- **Local texture is independent of the arc.** "This stretch is stingy" is a different
  decision than "the scene is building." → Phrases.
- **Moments are independent of everything continuous.** → Events.
- **The secondary feel has its own arc** that needn't match the main motion. → Passages.

So the layer count is just **the count of independent decisions a good script makes.** We
keep it humane with **progressive disclosure**: every layer has a sensible default, the
tabs are always free to skip (no hard gates), and **you can stop after Generate and have a
real, playable script.** You descend a layer only when you want *that* dimension's control.
The competitors ship "vibes"; we ship a model — and the model is the reason our output
doesn't feel generated.

---

## Open threads

- **Master "overall intensity" handle** (one knob that moves Range + Pace together, then
  breaks apart) — deferred convenience, only if authoring two curves feels heavy.
- **Build order** (cheapest first): **beta = presets only** (preset pills + read-only curve
  + live regen, no drag — see Beta scope). Ship the **Pace lane** alone (`--density-arc`,
  wired end-to-end), then the **Range lane** (`--center-trajectory`), then the diagnosis
  classifier (`diagnose()` → "where strokes land" + Contrast) against real engine output.
  Movable handles + "Set here" are post-beta.
- **Passages engine mapping** per layer: e-stim = volume/frequency/pulse-freq; **body =
  response hardness/force** (decoupled from position — gentle→brutal over time); mechanical
  = twist/turn envelope (exact params TBD).
