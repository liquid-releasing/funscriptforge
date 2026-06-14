# Generating Funscripts

The Generate tab creates a funscript **from a video or audio file** — it listens to the beat, lays down strokes, and hands you a draft you can feel, grade, and refine. You shape it with two simple curves; everything else is measured against real hand-made scripts so the result reads like something a person made, not a metronome.

This page explains the controls and — just as important — *why they work the way they do*, so the dials make sense instead of feeling arbitrary.

---

## The two curves: Range and Pace

You author the main funscript with two macro curves, drawn across the whole track:

| Curve | Question it answers | Low → High |
|-------|--------------------|-----------|
| **Range** | *How far does each stroke travel?* | shallow teasing → full rail-to-rail |
| **Pace** | *How busy is it?* | sparse, breathing room → packed, driving |

You don't set "intensity" directly. **Intensity is what you feel when Range and Pace combine** — it's the heatmap you watch, not a third dial. A wide Range at a busy Pace feels intense; a wide Range at a slow Pace feels deep and deliberate. Watch the live result and the heatmap; adjust the two curves until it looks right.

Pick a curve shape from the **preset pills** (Shallow tease, Full range, Grow to rails; Gentle build, Slow burn, Edge & release). The presets *are* the teaching — pick one and you can see what "a slow burn" looks like.

---

## Start height — "same rail, start higher"

Each curve has a **Start** lever next to its presets. It raises where the arc *begins* while keeping its destination — the rail — exactly where it is. With the top pinned, raising the start is the same as flattening the slope.

Reach for it when a preset like **Grow to rails** starts too timid: you want the full reach, just *sooner*, without the long shallow lead-in. Drag Start up and the curve begins higher; the number shows the resulting starting height.

> **Why it's "Start," not a "% strength" knob.** An earlier version blended the curve toward its *average*, which muddied a strong shape toward the middle — not what anyone actually wants. "Where does it begin, and it always reaches the rail" is the control you're really after, and it can never accidentally cap your reach. (It's the same model the [Channels → Passages](multiaxis.md) arc uses, one altitude up.)

---

## Texture — making it feel alive

A funscript where every stroke hits the exact same depth feels like a wall — mechanically perfect and lifeless. Real hand-made scripts aren't like that: most strokes reach the rails, but a meaningful slice land *partway*, giving the motion texture and breath.

The **Texture** lever adds that life. It eases the *quietest* beats off the rails (the loud, driving beats still hit full), so the script gains a middle "shoulder" of partial strokes — and, as a bonus, runs a little gentler, because shorter strokes are slower strokes.

**Texture is capped on purpose.** Push it too far and the rails collapse — the script turns into a timid, middle-bunched blob with no punch. We measured exactly where that happens and set the cap just below it. Inside the cap, you get life; you can't dial it into mush. The default (a light amount) matches what hand-made scripts carry.

---

## Why generated scripts "hit the rails"

You'll notice the generator reaches full depth a lot, with some partial strokes mixed in — rather than hovering politely in the middle. **This is deliberate, and it's measured.**

Hand-made scripts that people love are *bimodal*: most strokes go nearly rail-to-rail, with a minority landing partway for texture. A script whose strokes all bunch in the middle reads as timid and unsatisfying. So the generator builds a full-depth backbone first, then adds the partial-stroke texture on top — it never scales depth up and down with the music's loudness, because that produces exactly the mushy, middle-bunched result we want to avoid.

In short: **the music's energy decides *when* and *how busy* the strokes are — not how deep.** Depth is yours to shape with Range and Texture.

---

## Quiet intros and "dead air"

The generator follows the *pulse*, not just the bass drum — so a soft, beatless intro still gets gentle strokes that build as the real beat arrives, the way a hand scripter would. It will **not invent motion the audio doesn't justify**: if a long stretch has genuinely nothing to lock onto, the diagnosis flags it as **dead air** rather than papering over it with filler.

Those gaps are where *you* come in. The honest fix for dead air isn't a louder algorithm — it's a human watching the video. Drop [events](stim.md) on what you see, and continue editing in the rest of FunscriptForge.

---

## What to fix — the diagnosis panel

Alongside the live result, the **What to fix** panel grades your draft against the same measurements taken from real gold scripts:

- **Verdict** — a one-word read (Flat / Decent / Dynamic) with the single highest-impact fix as a button. The fix isn't just a complaint — clicking it *applies* the change.
- **Where the strokes land** — the depth histogram, with the healthy target shape ghosted behind it. You want weight at the rails with a middle shoulder, not a central spike.
- **Movement speed** — the speed distribution (slow → flash).
- **Dead air** — any long beatless stretch, so you can author events there.

### "Too fast" is calibrated against real scripts

If the panel flags a script as **too fast**, that line isn't arbitrary — it's set just above the speed of the most intense *hand-made* scripts. Gentle gold scripts run around 350–390 units/sec; hot ones reach ~600. So the flag only fires on output that's faster than anything a person shipped, not on a legitimately energetic scene.

If "Ease the pace" doesn't clear it, the panel escalates to **Shorten the range** — because once the pace is already gentle, it's the long strokes that are fast, and shorter strokes are the only lever left.

---

## Playing it back

Switch the live result to **Play** to watch the generated funscript run against your video, with a **depth-now** meter showing where the stroke is at each moment. Reading the histogram tells you the shape; pressing Play tells you how it *feels*. Trust the second one.

---

## Long files

Big files (multi-hour videos) are analyzed in **time chunks** — you'll see "chunk 4/12" tick by in the footer instead of a frozen-looking wait. Each chunk also balances its own loudness, so a quiet opening scene isn't crushed by a loud finale.

---

## Nothing is overwritten

The generated draft lives in a hidden cache next to your media — your original file is never touched. When a draft is good:

- **Set as working funscript** rolls it into your editing session, where Phrases, Tone, and Transforms can refine it.
- **[Export](export.md)** writes the permanent, device-ready files.

---

## Workflow

1. Open a project on a video or audio file.
2. Let the analysis run (it doubles as the generation pass — long files show chunk progress).
3. Pick a **Range** and a **Pace** preset; nudge **Start** and **Texture** to taste.
4. Read **What to fix** and click the suggested fix if you want it.
5. Press **Play** to feel the draft against the video.
6. **Set as working funscript**, then refine in Phrases / Tone / Transforms, or go straight to **Export**.

---

## Related

- [Concepts](00-overview/concepts.md) — phrases, behavioral tags, the shared vocabulary
- [Tone](tone.md) — reshape the feel of a script you already have
- [Transforms](transforms.md) — targeted repairs (fill the rails, add an arc, tame a wall)
- [Phrase Editor](phrase-editor.md) — fine-tune individual sections
- [Export](export.md) — write the device-ready files
