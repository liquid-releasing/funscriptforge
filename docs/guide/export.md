# Export

The Export tab is where you review every transform and write the final funscript — plus any estim channel files — to your output folder. It is the last stop in the FunscriptForge workflow.

---

## Layout

<!-- SCREENSHOT: Export tab overview. Top: export preview chart. Middle: collapsed Export options + Completed/Recommended transform expanders. Bottom: Export to folder section with Export All + Open folder buttons. Caption: "The Export tab. Review the preview, expand any details, then Export All." -->

The tab is laid out top-to-bottom in the order you read it:

1. **Export preview chart** — what the final funscript will look like with every accepted transform applied.
2. **Export options** *(collapsed)* — three optional passes: blend seams, final smooth, device awareness.
3. **Completed transforms** *(collapsed)* — every transform you applied in the Phrase Editor or Pattern Editor.
4. **Recommended transforms** *(collapsed)* — auto-suggested transforms for phrases you have not edited.
5. **Export to folder** — the **Export All** button and the **Open folder** button.

---

## Export preview chart

A static visualization of your funscript with every transform applied. This is what will be written to disk. The chart updates automatically as you accept, reject, or edit transforms in the expanders below it.

---

## Export options

Three checkboxes, all on by default:

| Option | What it does |
|---|---|
| **Blend seams** | Detects high-velocity jumps at phrase boundaries and applies targeted smoothing only at those seams. Recommended when adjacent phrases use different transform styles. |
| **Final smooth** | A light global smoothing pass that removes residual sharp edges. |
| **Device awareness** | Applies the velocity caps and fix strategies you set on the Device tab. Off when you want a raw waveform (e.g., for estim-only routing). |

---

## Completed transforms

Every transform you applied in the Phrase Editor or Pattern Editor, in order.

| Column | What it shows |
|---|---|
| # | Phrase number |
| Time | Start time of the phrase |
| Dur (s) | Phrase duration |
| Transform | The transform applied |
| Source | PE (Phrase Editor) or PP (Pattern Editor) |
| BPM | BPM if relevant |
| Cycles | Cycle count if relevant |
| 🗑 | Reject this transform from the export |

Rejecting a completed transform does **not** undo your editing work — it just excludes it from this export. You can restore it with the ↩ button.

---

## Recommended transforms

FunscriptForge suggests transforms for every phrase you have not manually edited, based on the phrase's behavioral tag and BPM.

| Suggestion logic | Transform suggested |
|---|---|
| Pattern label contains "transition" | Smooth |
| BPM below the BPM threshold | Passthrough (no change) |
| BPM at or above threshold, amplitude span < 40 | Normalize Range |
| BPM at or above threshold | Amplitude Scale |

You can accept all recommendations at once, or review each one. Clicking **✏ Edit** on a recommendation opens that phrase in the Phrase Editor so you can choose something different.

!!! tip "BPM threshold"
    The BPM threshold used for auto-suggestions (default 120) comes from the assessment. Adjust it on the Tone tab if it does not match the source material.

---

## Export to folder

Click **Export All** and FunscriptForge writes everything into the output folder you set on the Project tab.

### What gets written

For a project named `myscript`:

| File | What it is |
|---|---|
| `myscript.funscript` | The main funscript with every accepted transform applied. Restim-compatible naming. |
| `myscript.alpha.funscript` | Alpha (left/right) channel — *only if a stim preset is configured* |
| `myscript.beta.funscript` | Beta (up/down) channel |
| `myscript.pulse_frequency.funscript` | Pulse frequency channel |
| `myscript.frequency.funscript` | Frequency channel |
| `myscript.volume.funscript` | Volume channel |
| `myscript.pulse_rise.funscript` | Pulse rise (attack) channel |
| `myscript.alpha_prostate.funscript` | Alpha prostate channel (3-phase only) |
| `myscript.beta_prostate.funscript` | Beta prostate channel (3-phase only) |
| `myscript.volume_prostate.funscript` | Volume prostate channel (3-phase only) |
| Source video / audio / captions | Copied next to the funscript so the output folder is self-contained |
| `myscript.forgetmpl` | Workflow template — your decisions without project-specific data, reusable on other projects |

### Estim channel generation

If you set a character preset on the Stim tab, Export generates the estim channel files via [funscript-tools](https://github.com/edger477/funscript-tools) automatically. You no longer have to leave FunscriptForge to run a separate channel-generation step.

There are two paths:

- **Reuse from Stim Accept** — if you clicked **Accept** on the Stim tab with the same preset, those channel files are reused as-is. Fast.
- **Generate at export time** — if you only previewed (or skipped the Stim tab entirely but configured a preset earlier), Export runs the funscript-tools pipeline against the just-written main funscript. Takes seconds for 2D presets, minutes for 3-phase.

You will see a status panel showing each file as it is written:

```text
✅ myscript.funscript (main)
⏳ Generating estim channels (Unpredictable)…
✅ myscript.alpha.funscript (12.3 KB)
✅ myscript.beta.funscript (11.8 KB)
✅ myscript.pulse_frequency.funscript (9.4 KB)
…
```

If `funscript-tools` is not installed alongside FunscriptForge, the channel step is skipped with a warning and the main funscript still writes correctly.

### Open folder

Once Export All completes, **Open folder** opens the output folder in your OS file manager so you can drag the funscripts into your player.

---

## The forge log

The main funscript includes a `_forge_log` key in its JSON metadata recording every transform that was applied:

```json
"_forge_log": {
  "version": "0.1.0",
  "exported_at": "2026-04-11T10:23:45",
  "source": "myscript.funscript",
  "transforms": [
    {
      "phrase_index": 3,
      "at_ms": 84300,
      "transform": "amplitude_scale",
      "params": {"scale": 1.4},
      "source": "phrase_editor"
    }
  ],
  "blend_seams": true,
  "final_smooth": true,
  "clamp_count": 0
}
```

This log travels with the file so you always know what was done to it.

---

## Workflow templates

The `.forgetmpl` file written next to your funscript is a re-usable record of the *decisions* you made — tone settings, output targets, device fix strategies, history — without any project-specific data (no paths, no timestamps). Drop it into a new project to start with the same workflow.

---

## Related

- Stim tab — choose a character preset; channel files are generated at Export time
- [Phrase Editor →](phrase-editor.md) — fix individual phrases
- [Pattern Editor →](pattern-editor.md) — fix all phrases of a given type
- [Device Safety →](../reference/device-safety.md) — velocity caps, device types, estim routing
- [Transforms →](transforms.md) — what every transform does
