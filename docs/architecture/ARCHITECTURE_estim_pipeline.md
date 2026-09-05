# Architecture — Estim Pipeline

*Written 2026-03-14*

---

## The Big Picture

Three tools. One pipeline. One vocabulary.

```
FunscriptForge Explorer        — originate the funscript from video
FunscriptForge                 — edit and shape the funscript
funscript-tools                — apply estim character, generate outputs
restim                         — play
```

Each tool does one thing. The funscript is the connector between them.

---

## The Two Dimensions

Every piece of estim content has two independent dimensions:

| Dimension | Tool | What it controls |
|---|---|---|
| **Funscript quality** | FunscriptForge | Position over time — strokes, pacing, phrase structure |
| **Estim character** | funscript-tools | How sensation moves and builds — the electrode path, pulse rate, attack |

Before these tools existed, creators had one dimension. Now they have two. The combination produces something no other tool creates.

---

## The Character Vocabulary

The five eTransform characters are the **API between all three tools**. One intent word drives behavior at every layer.

| Character | Explorer analysis | FunscriptForge transforms | funscript-tools eTransform |
|---|---|---|---|
| Reactive | onset detection + optical flow | fast, sharp transforms | wide arc, low ramp, high peak |
| Scene Builder | phrase detection + downbeats | gradual building transforms | circular arc, high ramp |
| Gentle | slow beat grid, low motion | soften, smooth | narrow arc, soft onset |
| Unpredictable | high-variance optical flow | irregular transforms | restim-original, wild movement |
| Balanced | beat tracking, middle intensity | balanced transforms | circular, middle values |

The creator says "Scene Builder." Every tool responds appropriately. They never touch a parameter.

---

## The Output Channels

funscript-tools produces 10 output files from one input. Three matter for most creators:

| Channel | What it is | Plain label |
|---|---|---|
| `alpha.funscript` | Left-right electrode position | Where — left/right |
| `beta.funscript` | Up-down electrode position | Where — up/down |
| `pulse_frequency.funscript` | Pulse rate / intensity tracking | Intensity |

The remaining channels (pulse_rise, prostate) are texture for specialist
hardware. `pulse_width` is produced by upstream but **FunscriptForge does not
generate it** — see the gap noted at the end of this section.

The generated set is nine files: `alpha`, `beta`, `alpha-prostate`,
`beta-prostate`, `volume`, `volume-prostate`, `frequency`, `pulse_frequency`,
`pulse_rise_time`. `--mode 2d` narrows that to `alpha`/`beta` only.

---

## The Three E-Stim Stations

"E-stim" is not one target. Three Polish stations emit the channel set, and
they differ in **how the signal reaches the hardware** — which decides what
files an export has to produce.

| Station | Reaches the device via | Writes |
|---|---|---|
| `estim3p` — E-Stim · 3-phase | a stereo **audio** signal | position channels + `stim.wav` / `stim.mp3` |
| `focstim` — FOC-Stim · Direct current control | the device's **own protocol** | position channels |
| `focstim4p` — FOC-Stim · 4-phase | the device's **own protocol** | four per-electrode channels |

Both FOC-Stim stations are flagged `experimental` and have **not been verified
on hardware**.

### Branch on capability, never on id

`Station` carries two capability flags, and every consumer asks the catalog
rather than testing an id:

- **`stim_audio`** (true only for `estim3p`) — restim is driven *by sound*: it
  plays the alpha/beta pair out of the sound card. FOC-Stim speaks its own
  protocol and reads the channel funscripts directly, so a stim mp3 rendered
  for it is a file its hardware can never use. The export picks its audio
  source with `polish.uses_stim_audio()`; a FOC-Stim-only project renders no
  stim audio at all.
- **`electrodes`** (true only for `focstim4p`) — four-phase hardware wants a
  **power per electrode**, not a 2-D position. That station writes `e1`–`e4`
  and *drops* `alpha`/`beta` and the prostate position pair, which would be
  meaningless to a four-electrode driver.

This matters because it was learned the hard way: `sid == "estim3p"` appeared
in six places in `cli.py` and again in the Export UI, silently capping the app
at one e-stim station. `polish.is_estim_station()` (kind-based) and the two
flags above replaced all of them.

### Position → electrode conversion

`forge/focstim.py` ports restim's `stim_math/transforms_4.py` (MIT, © 2023
diglet48) and is verified identical to upstream across the authoring square.
Two properties are load-bearing:

- The input is **normalised into the unit ball first.** The transform reaches
  **1.303** at the corners of the alpha/beta square, so skipping this clamps a
  corner to full scale on every electrode.
- Conversion happens **after** rate clamping, so the ceiling applies to the
  authored motion rather than the derived signal.

Calibration (`AXIS_CALIBRATION_4_*`) is a **device setting, never script
content**, and is not written into any file.

### Known gap: `pulse_width`

Upstream emits a `pulse_width` channel; FunscriptForge never generates one (it
exists here only as an internal audio-synthesis parameter). A legacy restim set
forged through FunscriptForge therefore *gains* `beta-prostate` and *loses*
`pulse_width`. This is recorded, not resolved — see
`docs/guide/forging-legacy-scripts.md`.

---

## The Adapter Boundary

The front-end imports ONLY from `cli.py`. Zero upstream imports. This is the adapter boundary.

```
React app  →  Rust bridge  →  cli.py  →  upstream processor.py
   UI          commands.rs      API          implementation
```

The React desktop app (`ui/web/`) calls `cli.py` subcommands through the Tauri
Rust bridge (`src-tauri/src/commands.rs`) — it never touches Python directly. This means:
- The UI can be rebuilt without touching upstream code
- The CLI can be tested independently
- The desktop app, a future web server, and CI scripts all call the same CLI functions

---

## The Project Bundle

One folder = one restim session.

```
my-scene/
  my-scene.mp4
  my-scene.funscript
  my-scene.alpha.funscript
  my-scene.beta.funscript
  my-scene.pulse_frequency.funscript
  ... (all outputs)
```

No hunting for files. No noise in Downloads. Drop the folder into restim. Done.

---

## The Sensitivity Matrix (Planned)

Each eTransform exposes 1-2 contextual sliders chosen by educated guess. Before release, a brute-force script will validate these choices:

```
for each eTransform:
  for each parameter across its range:
    run process() on test fixtures
    measure delta in alpha/beta/pulse_frequency (np.linalg.norm)
    record (etransform, parameter, delta) to CSV
```

The parameter with the highest delta = the one worth surfacing. Near-zero delta = hide it.

This becomes the integration test suite. The sensitivity matrix blocks release.

---

## The Agent Loop (Future)

The `.forge-project.json` schema supports agent orchestration:

```json
{
  "next_action": { "type": "run_step", "step": "apply_etransform" },
  "agent_notes": "Chose Reactive based on BPM > 120 and high optical flow variance",
  "evaluation": {
    "checks": ["delta_alpha > 0.1", "no_flat_sections"]
  },
  "human_review": false
}
```

Agent reads `next_action` → runs step → writes `agent_notes` → evaluates output → escalates or continues.

---

## Deployment Targets

| Target | Status |
|---|---|
| Windows desktop (Tauri MSI + NSIS, bundled `forge-cli` + ffmpeg) | Published (`v0.1.0-alpha`) |
| macOS desktop (Tauri) | Post-beta follow-up |
| Linux desktop (Tauri) | Post-beta follow-up |
| SaaS (React → HTTP server wrapping `cli.py`) | Planned |
| `cli.py` command line | Working today |
