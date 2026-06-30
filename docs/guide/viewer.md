# Viewer

The Viewer is the last stop in the FunscriptForge workflow — a review surface for what generation actually *produced*. Everywhere else in the app you author intent; here you see the finished device channels laid out across the whole timeline, so inconsistencies pop: a soft intro against a hot body, a channel that went flat, a device that never got busy.

The Viewer **reads exported output** — it does not edit. To change something you saw here, open the project and work on it (see [To edit what you see](#to-edit-what-you-see) below).

---

## What it reads

The Viewer loads, in order of preference:

1. The loose **`<stem>.output/`** folder written by Export (the live, most-recent render).
2. The **`<stem>.forge`** bundle (the shipped snapshot) when only that was kept.

Because a folder often holds several renders of the same title (1080p / 4K / VR) but generation runs for just one, the Viewer applies a **sibling fallback**: open *any* of those files and it adopts the one output set that exists. The **footer** always shows exactly which output folder (or bundle) you are looking at, so there is never any doubt.

If nothing is found, the Viewer tells you where it looked and points you to the Export tab.

---

## Layout

Three columns under a device picker:

| Column | What it shows |
| --- | --- |
| **Left — stats** | Whole-device headline numbers (Liveliness, Channels, Actions, Density, Usable range, Avg velocity, Avg stroke), the selected channel's stats, and the **per-chapter liveliness** readout. |
| **Center — lane stack** | The star. Every context lane + every device channel stacked on one shared time axis: audio, spectrogram, intensity arc, events, then each channel as a velocity-coloured curve. |
| **Right — monitor** | A reference player (Video / Audio / Funscript) tied to the same playhead, so you can watch the source frame while reading the curves. |

### Device picker

The header chips switch devices (E-Stim, Handy, Lovense, MultiFunPlayer, OSR2, SR6, …). Each chip shows its channel count. E-Stim sorts first and is selected by default.

### The lane stack

Reading **down** the stack is what surfaces problems — "the audio is loud here but my channels are pale." Click any channel lane to select it; its curve thickens, the left panel switches to that channel's stats, and the per-chapter readout re-scopes to it. Click anywhere on the chart to move the playhead.

Lanes only appear when their data exists:

- **Audio** — peak envelope with beat ticks.
- **Spectro** — the shipped spectrogram PNG (what's in the audio: bass, vocal, percussive bands).
- **Intensity** — the felt-intensity arc (the `volume` channel, or a velocity envelope when there's no volume channel).
- **Events** — coloured Edger event bands with labels.
- **Channels** — every device channel, coloured blue→red by stroke velocity.

### The monitor

A narrow player on the right, synced to the same playhead by one shared baton. The **Funscript** mode shows the selected channel at full resolution (real strokes, not the lane's decimated envelope). The **Audio** mode shows a high-resolution waveform with the energy / tempo readout. Spectro mode only appears when raw spectrogram cells are available (an exported project ships only the PNG, so the monitor's live Spectro tab is hidden there — the center stack still shows the full image).

---

## Liveliness

**Liveliness** is a single **0–100** "how energetic is this output" headline, so you don't have to read four numbers to get a feel. It blends four normalized metrics:

| Component | Weight | What it rewards |
| --- | --- | --- |
| **Avg velocity** | 40% | Fast motion — what you feel most. |
| **Avg stroke** | 25% | Big moves rather than tiny wiggles. |
| **Usable range** | 20% | Using more of the 0–100 span (p5→p95). |
| **Density** | 15% | More actions per second. |

Each metric is capped at a reference maximum (tuned on a known-good test clip), weighted, summed, and scaled to 0–100. So **fast, full-range, dense motion scores high; slow, shallow, sparse motion scores low.** Velocity dominates because it's the dimension you perceive most strongly.

Two things to keep in mind:

- **The device headline averages every channel.** For E-Stim that's the mean of all nine — so flatter channels like `volume` pull it down. Click a single channel to read *its* liveliness, which is often the more meaningful number.
- **The headline covers the whole timeline.** It tells you *whether* the output is alive overall, not *where* it sags. For that, use the per-chapter readout and the intensity arc.

---

## Per-chapter liveliness

Below the stats, each chapter gets its own liveliness bar and number. This is what turns "the intro feels too soft" into a measurement: a quiet opening reads as a short, cool bar (e.g. `28`) against a warm body (e.g. `77`).

- The bars are **warm where lively, cool where the output sags**, scaled to the busiest chapter.
- The readout **re-scopes to the selected channel** when you pick one (header reads `Per chapter · alpha`), else it's the whole device.
- **Click a chapter** to jump the playhead to its start and inspect it in the monitor.

Use it to spot uneven energy — a build-up that never builds, a comedown that drops too early, or an intro running at half the body's intensity — then fix it in **Passages**.

---

## To edit what you see

The Viewer is read-only by design. The editable project is the working `.forge` — so when you find something to change:

> **Project tab → "Import a `.forge` bundle…"** → pick the project's `<stem>.forge`.

The bundle carries everything needed to re-edit (the motion funscript plus the `characters`, `phrases`, `chapters`, audio and beats sidecars), so importing it reconstructs a fully editable project. Then make the change where it belongs — e.g. lift a soft intro in **Passages** — and re-export.

---

## Related

- [Export →](export.md) — produces the output the Viewer reviews
- [Generating Funscripts →](generating-funscripts.md) — where the channels come from
- [Media Player →](media-player.md) — the shared monitor component
