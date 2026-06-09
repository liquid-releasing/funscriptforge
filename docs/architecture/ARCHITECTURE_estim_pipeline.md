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

The remaining channels (pulse_width, pulse_rise, E1-E4, prostate) are texture for specialist hardware.

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
