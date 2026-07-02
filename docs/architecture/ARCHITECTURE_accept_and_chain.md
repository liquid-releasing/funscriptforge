# Architecture: Accept Pattern & Cascading Funscript Chain

## Overview

FunscriptForge uses a tab-based workflow where each tab transforms the funscript
and passes its output to the next tab. The user commits changes by clicking **Accept**
on each tab. Nothing is written to disk until Accept is clicked.

## Tab Order

```
Project → Device → Tone → Phrases → Stim → Export
```

Each tab reads from the previous tab's output, not from the original funscript.

## Cascading Funscript Chain

The chain stores intermediate funscript states in the output folder:

```
output/my-project/
├── my-project.forge              ← project config (all decisions, history)
├── _funscript_original.json      ← raw input (never modified)
├── _funscript_device.json        ← after Device Accept
├── _funscript_tone.json          ← after Tone Accept
├── _funscript_phrases.json       ← after Phrases Accept
├── _assessment.json              ← phrase/pattern/BPM analysis
├── _beat_data.json               ← videoflow AudioBeatMap (BPM, beats, downbeats, phrases, energy)
└── _video_motion.json            ← OpenCV motion heatmap
```

### Chain Rules

1. **Each tab reads from the previous stage.** `get_chain_funscript_for(project, stage)`
   walks backward through the chain to find the most recent saved state.
2. **Each Accept writes to its stage.** `save_chain_funscript(project, stage, data)`
   saves the modified funscript.
3. **Fallback to original.** If no chain state exists (user skipped a tab), the
   original funscript is used.
4. **Re-running a tab overwrites its stage.** The user can go back, change settings,
   and Accept again. Downstream stages are not automatically invalidated (backlog item).

### API

```python
from forge.project import (
    save_chain_funscript,     # Save modified funscript at a stage
    load_chain_funscript,     # Load a specific stage
    get_latest_funscript,     # Get the most recent state in the chain
    get_chain_funscript_for,  # Get the INPUT for a given stage
)
```

## Accept Pattern

Every tab that modifies data follows the same pattern:

### 1. User makes selections (no disk writes)

The React UI collects choices — character, sliders, device settings — in component
state. Nothing is saved. The user can experiment freely.

### 2. Preview updates in real time

Before/after charts show the effect of current selections. Preview recalculates as
the user adjusts controls. No Accept needed to see the preview.

### 3. User clicks Accept

A single **Accept** button (no arrow, no auto-navigation). On click, the tab calls
the corresponding `cli.py` subcommand through the Rust bridge (`forge.js` →
`commands.rs`), then marks the tab accepted in component state.

### 4. Progress with step-by-step status

Long operations stream stage labels back from the Python backend via
`tauri::Emitter` events, which the footer/progress UI renders as they arrive.

**Progress for long operations:** the backend emits callbacks that update the status
label with counts (e.g., `frame 42 / 300`, `23,710 actions`). The user sees exactly
what's happening and knows whether to wait or get coffee.

### 5. Advisory text (no auto-navigation)

After Accept completes, a success message advises the next step (e.g., "Your next
step is the **Phrases** tab"). The user clicks the tab themselves. No auto-navigation
— it's disorienting and prevents the user from reviewing the completed state.

### 6. History snapshot for undo

Each Accept appends to the `.forge` history array:

```python
project["history"].append({
    "tab": "tone",
    "timestamp": datetime.now().isoformat(),
    "tone": tone_name,
    "tone_sliders": {...},
})
save_forge(project)
```

## Funscript flow between tabs

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Project  │────▶│  Device  │────▶│   Tone   │────▶│ Phrases  │────▶│  Export  │
│          │     │          │     │          │     │          │     │          │
│ original │     │ device-  │     │ tone-    │     │ phrase-  │     │ final    │
│ funscript│     │ aware    │     │ applied  │     │ edited   │     │ output   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │                │
     ▼                ▼                ▼                ▼                ▼
  _funscript_     _funscript_     _funscript_     _funscript_      device/
  original.json   device.json     tone.json       phrases.json    subfolders
```

Each tab reads from the **previous tab's output**, not the original funscript.
This is the cascading chain — changes accumulate through the workflow.

**Key rule:** The "Before" chart on any tab shows the previous tab's output.
The "After" chart shows what this tab will change. The user always sees the
delta, not the full transformation from original.

**Fallback:** If a chain stage doesn't exist (user skipped a tab), the system
walks backward to find the most recent saved state.

## What each Accept does

| Tab | Reads from | Writes to | Key operations |
|---|---|---|---|
| **Project** | User input | `.forge` + analysis files | Create output folder, save .forge, run beat/motion/assessment analysis |
| **Device** | Original funscript | `_funscript_device.json` | Apply device-aware fixes, safety verification, save to chain |
| **Tone** | `_funscript_device.json` | `_funscript_tone.json` | Apply tone + impact + sliders, save to chain, cache Plotly |
| **Phrases** | `_funscript_tone.json` | `_funscript_phrases.json` | Per-phrase transforms, save to chain |
| **Stim** | `_funscript_phrases.json` | Estim channel files | Generate alpha/beta/pulse channels (estim only) |
| **Export** | Latest chain state | Device subfolders | Write final funscripts per device, copy media |

## Undo

The sidebar shows the last Accept action and an **Undo** button. Undo:

1. Pops the last entry from the `.forge` history array
2. Removes the chain funscript file for that stage
3. Clears the accepted flag in the tab's component state
4. Saves the updated `.forge`

One level deep per tab — undoes the last Accept, not individual slider changes.

The sidebar also shows **Next step** guidance: the next incomplete tab in the
workflow with a description of what it does.

## Workflow Templates

On Export, a `.forgetmpl` file is written alongside the funscripts. The template
captures all workflow decisions (tone, sliders, device settings) without
project-specific data (paths, timestamps).

v1: export only. v2: import templates to pre-fill all tabs, ship starter
presets (Driving Beat, Hypnotic Mix, Romance), CLI batch processing.

## Footer accept grammar (2026-07)

> The tab order and chain-file sections above are historical. The current tab
> chain is **Project → Generate → Analysis → Chapters → Phrases → Stanzas →
> Events → Channels → Polish → Export → Viewer**, and several tabs now
> **write through** as you work (Events → `feel.yml`, Channels →
> `characters.json`, the working funscript on every transform Apply) rather
> than only on Accept.

The sticky footer (`AcceptBar`) is the canonical commit surface. One grammar
runs across every tab:

- **Red + ✓ = leave the tab.** Only the terminal `Accept and chain to <next>`
  is red with a checkmark. Everything else completes work in place.
- **Tentative (white, no ✓) = a step, not the commit.** A gated tab still being
  walked shows its walk action as a quiet white primary (`AcceptBar`
  `primaryTentative`); the red ✓ chain returns only once the tab's completion
  predicate is satisfied. Export's `Export` button is white until the write
  succeeds, then flips to red ✓ `Chain to Viewer`.
- **Per-tab completion gates.** A chapter-scoped tab reports
  `{ complete, considered, total }`; until `complete`, the footer shows the
  walk and the chain stays tentative.
  - *Chapters / Phrases / Stanzas* — every chapter considered (walk
    `Accept and next chapter`, or **Accept all as-is / as untoned** above the
    ribbon). Channels reads its completion from persisted `characters.json`, so
    it **survives leaving and re-entering the tab**.
  - *Channels (two passes)* — reports `passes: [character, mechanical]`, which
    the footer renders as two white walk buttons (`AcceptBar`
    `secondaryActions`). Complete when **every chapter has both** a character
    and a mechanical; **Apply to all chapters** in each section header
    broadcasts the staged pick.
  - *Polish (per device)* — walk `Accept and next device` stamps the focused
    device (identical to the bench Stamp) and advances; **Accept all defaults**
    stamps the rest. Complete when every device is stamped.
- **Bulk buttons never chain.** They fill gaps in place (preserving anything
  already set) and live above the unit list, keeping the footer uncluttered.
- **Carry-forward fills gaps only.** Accepting a chapter's tone carries it onto
  the next chapter *only if that chapter is still untoned* — it never replaces a
  tone already there.

`AcceptBar` disables the primary on `error || busy || gate`; `ready` and
`primaryTentative` only affect the lead icon / button styling, not whether it
fires. See `ui/web/src/App.jsx` (footer fork) and forgemoment
`src/AppShell.jsx` (`AcceptBar`).

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
