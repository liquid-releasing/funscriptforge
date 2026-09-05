# Forging legacy scripts

You already have scripts — a funscript you made years ago, a restim channel set
someone shared, a folder of files from another tool. This page is about
bringing those into FunscriptForge.

The short version: **your files are safe, but forging is a regeneration, not an
edit.** Read the two sections below before you start, then follow the steps.

---

## Your existing files are never modified

FunscriptForge does not write over anything you already have. Everything it
produces goes somewhere new:

| What | Where it lands |
|---|---|
| Working artifacts (analysis, Polish stations) | `.<name>.forge/` — a hidden folder beside your script |
| Your edits | `<name>.work.funscript` — a **new** file; your original is never touched |
| The bundle | `<name>.forge` |
| Playable outputs | `<name>.output/` |

Even if you change the export folder, the output still lands in a
`<name>.output` sub-folder inside the folder you picked — it never writes
loose files into a folder you chose.

So forging a legacy set is safe to try. The worst case is some new files you
can delete.

---

## What is *not* carried over

**Existing channel funscripts are ignored.** If your folder contains
`Scene.alpha.funscript`, `Scene.volume.funscript` and friends, FunscriptForge
does not read them, merge them, or carry them into the bundle.

It regenerates the whole channel set from two things:

1. your **main** funscript (the stroke track), and
2. the **Characters** you assign to each chapter.

That means the result is a **new set**, not an updated version of your old one.
The old files stay on disk, untouched and unused.

This matters because the two sets may not match channel-for-channel. A real
example — a restim set from 2025 compared against what FunscriptForge
generates from the same scene:

| | |
|---|---|
| **Gained** | `beta-prostate` — the legacy set had `alpha-prostate` and `volume-prostate` but not this one |
| **Lost** | `pulse_width` — FunscriptForge does not generate this channel |

Neither set is strictly better. Which is why the last step below is *compare*,
not *replace*.

---

## Step by step

### 1. Open the **main** funscript, not a channel file

Open `Scene.funscript` — the stroke track. Do **not** open
`Scene.alpha.funscript` or any other channel file: those are generated output,
not motion, and FunscriptForge would treat one as if it were a stroke script.

If you are not sure which is the main one, it is usually the smallest of the
`.funscript` files and the one whose name has no channel suffix.

### 2. Attach the media

Point the project at the video or audio the script was made for. Analysis reads
the media, so this has to come first.

### 3. Analyze

Let the analysis finish — it detects chapters, beats, and structure, and every
tab after it reads what it produces. The footer holds the chain until it is
done.

### 4. Assign Characters — this one is required

Go to **Channels** and give every chapter a Character.

This is the step people miss. The e-stim channel set is generated *from* the
Characters, so with none assigned the export produces **no e-stim files at
all** — and it does so silently, because there is nothing to report. If you
forge a legacy set and the e-stim folder comes out empty, this is why.

### 5. Decide about Polish

Optional. Skipping it means accepting each station's defaults, and you still
get every device — E-Stim, both FOC-Stim stations, the strokers and the shaker.

Stamp a station when you want to tune it, or when you want to be certain what
a particular device is getting.

### 6. Export

Write the bundle. Your legacy files are still sitting exactly where they were.

### 7. Compare before you switch

Open `<name>.output/` next to your old files and compare them:

- Which channels does each set have? (See the example above — the lists may
  differ in both directions.)
- Play both. The regenerated set is derived from your motion track and your
  Characters, so it should *feel* related, but it is not the same file.

Keep whichever you prefer. There is no need to delete the old set — nothing
depends on it, and it costs only disk space.

---

## Frequently hit snags

**"I exported and got no e-stim files."** No Characters assigned — see step 4.

**"The channels are different from my old ones."** Expected. Forging
regenerates rather than edits; see *What is not carried over*.

**"Can I just add one channel to my existing set?"** Not today. Channels come
out of a single generation run, so producing one in isolation would give you a
set that is part legacy and part newly-derived, with no guarantee the two
agree. Regenerating the whole set is both simpler and more trustworthy.

**"Is FOC-Stim ready?"** Both FOC-Stim stations are marked experimental and
have not been verified on hardware. See [Polish](polish.md).
