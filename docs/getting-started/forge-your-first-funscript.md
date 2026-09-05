# Forge Your First Funscript

This walks the whole path once, start to finish, so you know what the app is
asking of you and why. Ten minutes, most of it waiting on analysis.

---

## Before you start

You need **one funscript and the video or audio it was made for**, sitting in
the same folder with matching names (`scene.funscript` next to `scene.mp4`).

No material of your own? Open the **Project** tab and choose **Load sample** —
you can walk every step below on the built-in *Big Buck Bunny* project.

!!! info "Your originals are never modified"
    FunscriptForge writes alongside your files, never over them. Edits go to a
    separate `<name>.work.funscript`; everything else lands in a hidden
    `.<name>.forge/` folder or in `<name>.output/`.

---

## The shape of it

The tabs run left to right, and that order *is* the workflow. Each tab ends
with a red **Accept and chain to…** button in the footer — that is the app's
one consistent gesture for "this step is done, take me to the next".

```
Library → Project → Generate → Analysis → Chapters → Phrases → Stanzas
        → Events → Channels → Polish → Export → Viewer
```

You do not have to visit all of them. The short path is **Project → Analysis →
Channels → Export**, and the rest are there when you want them.

---

## Step 1 — Open your project

**Library** scans folders you point it at and shows what it found, pairing each
script with its media. Click a card to open it.

Or use **Open** in the title bar and pick a file directly — a `.funscript`, or a
bare video if you have no script yet.

---

## Step 2 — Generate, if you have no funscript yet

Opening a **video with no funscript** lands you on Project with one door:
**Generate new funscript**. Generate builds a script from the media by shaping
two macro curves — Range (how far each stroke travels) and Pace (how busy it
is).

If you already have a funscript, skip this. Project offers **Edit this
funscript** for exactly that, and it writes nothing.

---

## Step 3 — Let Analysis run

Analysis is where the app learns the shape of your scene: chapters, beats,
energy, and structure. It starts on its own and streams its progress in the
footer.

**Let it finish.** The chain button stays grey and reads *"chain can advance
when complete"* until it does — everything downstream reads what Analysis
writes.

---

## Step 4 — Review the structure (optional)

**Chapters**, **Phrases** and **Stanzas** let you check and adjust what Analysis
found — chapter boundaries, repeated shapes, rhythm-aligned spans. **Events**
is where you mark specific moments you want the output to react to.

All optional on a first pass. Skipping them keeps what Analysis detected.

---

## Step 5 — Assign Characters

**This is the one step people miss, and it matters.**

On **Channels**, give each chapter a Character. A Character decides how
electrical stimulation moves and builds — the difference between a scene that
holds steady and one that escalates.

The e-stim channel set is generated *from* these. **With no Character assigned,
your export contains no e-stim files at all** — silently, because there is
nothing to report. If you only care about strokers, you can skip this; if you
want e-stim, you cannot.

---

## Step 6 — Polish, or skip it

**Polish** renders your one edited script into device-ready files, one station
per piece of hardware — E-Stim, both FOC-Stim variants, The Handy, OSSM,
OSR2/SR6, Lovense, Vacuglide, Bass Shaker.

**Skipping is a real option.** It means *accepting the defaults*, and you still
get every device. Stamp a station when you want to tune it, or when you want to
be certain what a particular device is getting.

See [Polish →](../guide/polish.md) for what each station does.

---

## Step 7 — Export

Choose what to include and write it out. You get a `<name>.output/` folder
organised one folder per device, with a `README.txt` that lists what was
actually written — and optionally a `.forge` bundle, which is the re-openable
snapshot of the whole project.

See [Export →](../guide/export.md).

---

## Step 8 — Play it

**Viewer** shows the finished result. To feel it, open the export in
**ForgePlayer**, or load the e-stim channels in restim.

---

## What just happened

You took one funscript, let the app find the structure inside it, said how it
should feel, and rendered that into a set of files for each device you own —
without editing a single stroke by hand, and without touching your original.

---

## Going deeper

| You want to… | Go to |
|---|---|
| Understand the vocabulary | [Concepts](../concepts.md) |
| Reshape motion with transforms | [Transforms](../guide/transforms.md) — try one first in the **Catalog** tab |
| Work on one phrase at a time | [Phrase editor](../guide/phrase-editor.md) |
| Tune a specific device | [Polish](../guide/polish.md) |
| Bring in an older script or channel set | [Forging legacy scripts](../guide/forging-legacy-scripts.md) |

---

## Troubleshooting

| Symptom | Page |
|---|---|
| The app will not start | [Installation](../troubleshooting/install.md) |
| A script will not load | [Loading a script](../troubleshooting/loading-a-script.md) |
| Export produced nothing, or the wrong thing | [Export](../troubleshooting/export.md) |
| Video will not play | [Media player](../troubleshooting/media-player.md) |
