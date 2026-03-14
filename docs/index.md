# FunscriptForge

![FunscriptForge](assets/funscriptforge-logo-wide.png)

**The professional post-processor for haptic script creators.**

FunscriptForge takes a raw `.funscript` file and turns it into something that actually feels good. It analyzes the motion structure, identifies what's wrong, and gives you the tools to fix it — phrase by phrase, with a live before-and-after preview at every step.

---

## What does it do?

A raw funscript is a list of timestamps and positions. FunscriptForge reads that list and finds the *shape* inside it — the natural phrases, the tempo changes, the behavioral patterns. Then it gives you 25 precision transforms to fix whatever's wrong.

```
Your .funscript
      │
      ▼
  Structural analysis
  Phases → Cycles → Patterns → Phrases → BPM transitions
      │
      ▼
  Behavioral classification
  Each phrase labeled: stingy, giggle, plateau, drift, frantic...
      │
      ▼
  Interactive editing
  Click any phrase. Choose a transform. Tune with live sliders.
  See before and after in real time.
      │
      ▼
  Export
  Device funscript (velocity-capped for mechanical devices)
  Estim funscript (clean, no cap — for electrostim routing)
```

<!-- SCREENSHOT: full app overview — Phrase Selector tab loaded with a funscript, showing the heatmap chart with phrase bands, the sidebar with project stats, and the phrase table below. Caption: "FunscriptForge — the full motion structure of your script visible at a glance." -->

---

## Who is it for?

- **Script authors** who want to publish polished, professional work
- **Power users** who run scripts through Restim or MultiFunPlayer and need separate device and estim outputs
- **Batch processors** who want the CLI pipeline to run across a whole library

---

## Quick start

1. [Download and install FunscriptForge](getting-started/install.md)
2. [Forge your first funscript](getting-started/forge-your-first-funscript.md)

---

## Key features

**Structure-aware analysis** — not just waveform smoothing. FunscriptForge understands the grammar of motion: strokes, phrases, tempo changes, and why they happen.

**25 precision transforms** — amplitude scaling, recentering, tempo halving, beat accenting, contrast boosting, seam blending, and more. Each transform is tuned to fix a specific behavioral pattern.

**Live before/after preview** — see exactly what a transform will do before you accept it. Adjust sliders and watch the waveform change in real time.

**Pattern Editor** — fix every "drone" section in one step. Select the tag, apply the fix, click Apply to all.

**Dual export** — Device output (velocity-capped for Handy, OSR2, SR6) and Estim output (clean, for Restim/funscript-tools routing).

**CLI pipeline** — scriptable from start to finish for batch processing.

**Local-first** — runs entirely on your machine. No uploads. No accounts.

---

## Open source

FunscriptForge is MIT licensed. Source code and releases are on GitHub.

[View on GitHub →](https://github.com/liquid-releasing/funscriptforge)

---

## Not sure where to start?

→ [Concepts — the vocabulary FunscriptForge uses](concepts.md)
→ [Install FunscriptForge](getting-started/install.md)
→ [Troubleshooting](troubleshooting/index.md)
