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
├── _beat_data.json               ← librosa beat detection
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

The UI collects choices — tone, sliders, device settings — in `st.session_state`.
Nothing is saved. The user can experiment freely.

### 2. Preview updates in real time

Before/after charts show the effect of current selections. Preview recalculates
on slider release (Streamlit rerun). No Accept needed to see the preview.

### 3. User clicks Accept

A single **Accept** button (no arrow, no auto-navigation):

```python
if st.button("Accept", type="primary", width="stretch"):
    _apply(...)
    st.session_state["tab_accepted"] = True
    st.rerun()
```

### 4. Progress spinner with step-by-step status

`st.status()` shows each step as it runs:

```python
status = st.status("Applying...", expanded=True)
status.update(label="Saving project file…")
save_forge(project)
status.write("✅ Saved to my-project.forge")

status.update(label="Analyzing beats…")
# ... long operation with progress callback ...
status.write("✅ Beat data: 142 beats, ~128 BPM")

status.update(label="Project ready!", state="complete", expanded=False)
```

**Progress for long operations:** Use callbacks that update the status label
with counts (e.g., `frame 42 / 300`, `23,710 actions`). The user sees exactly
what's happening and knows whether to wait or get coffee.

### 5. Advisory text (no auto-navigation)

After Accept completes, a success message advises the next step:

```python
if st.session_state.get("tab_accepted"):
    st.success("Your next step is the **Tone** tab.")
```

The user clicks the tab themselves. No auto-navigation — it's disorienting
and prevents the user from reviewing the completed state.

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
3. Clears the accepted flag in session state
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

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
