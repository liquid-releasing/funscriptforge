# Export

The Export tab is where you review everything before downloading. It shows every transform you applied manually, auto-suggested transforms for phrases you have not touched, a quality check, and two download options — one for mechanical devices, one for estim routing.

---

## Layout

<!-- SCREENSHOT: Export tab overview. Top: export preview chart (full funscript with all transforms applied). Middle: two tables — Completed transforms and Recommended transforms. Bottom: Device/Estim download tabs. Caption: "The Export tab. Review every transform before downloading. The preview chart shows the proposed output in full." -->

**Export preview chart** — a static visualization of your funscript with every accepted transform applied. This is what you will download.

**Completed transforms table** — every transform you applied in the Phrase Editor or Pattern Editor, in order. Each row has a reject (🗑) button if you change your mind.

**Recommended transforms table** — auto-suggested transforms for phrases you have not edited. Each row has Accept (✓), Edit (✏), and Reject (🗑) buttons.

**Download tabs** — Device and Estim.

---

## Completed transforms

| Column | What it shows |
|---|---|
| # | Phrase number |
| Time | Start time of the phrase |
| Duration | Phrase duration |
| Transform | The transform applied |
| Source | PE (Phrase Editor) or PP (Pattern Editor) |
| Before BPM → After BPM | BPM change if the transform affected tempo |
| Reject | Remove this transform from the output |

Rejecting a completed transform does not undo your editing work — it just excludes it from this export. You can restore it with the ↩ button.

---

## Recommended transforms

FunscriptForge suggests transforms for every phrase you have not manually edited, based on the phrase's behavioral tag and BPM.

| Suggestion logic | Transform suggested |
|---|---|
| Pattern label contains "transition" | Smooth |
| BPM below the BPM threshold | Passthrough (no change) |
| BPM at or above threshold, amplitude span < 40 | Normalize Range |
| BPM at or above threshold | Amplitude Scale |

You can accept all recommendations at once, or review each one. Clicking **Edit** on a recommendation opens that phrase in the Phrase Editor so you can choose something different.

!!! tip "BPM threshold"
    The BPM threshold used for auto-suggestions (default 120) is set in the sidebar under **Chart settings**. Adjust it to match the source material.

---

## Quality gate

Expand the **Quality gate** section to see a full device-safety check before you download.

| Severity | Condition |
|---|---|
| ⚠ Warning | Velocity > 200 pos/s |
| ✗ Error | Velocity > 300 pos/s |
| ⚠ Warning | Action interval < 50 ms |

Each issue shows the timestamp so you can find it in the Phrase Editor and fix it.

The quality gate runs on the Device output. The Estim output has no velocity cap and no quality gate — estim devices handle the signal differently.

---

## Export options

Before downloading, two optional passes run on the output:

**Blend seams** — detects high-velocity jumps at phrase boundaries (where one transform style meets another) and applies targeted smoothing only at those seams. Recommended when you have mixed transforms across adjacent phrases.

**Final smooth** — a light global smoothing pass (default strength 0.10). Removes any residual sharp edges. Optional but recommended for most scripts.

---

## Device tab

Downloads `{name}.device.funscript`.

- All accepted transforms applied
- Velocity capped at 200 pos/s to protect mechanical devices (Handy, OSR2, SR6, etc.)
- Position clamped to [0, 100]
- Seam blending and final smooth applied if enabled
- Includes a `_forge_log` metadata block with the full transform history

<!-- SCREENSHOT: Device download tab. The Download button is visible. The quality gate is shown in a collapsed expander above. Caption: "The Device tab exports a velocity-capped funscript safe for mechanical devices." -->

---

## Estim tab

Downloads `{name}.estim.funscript`.

- All accepted transforms applied
- **No velocity cap** — the full waveform is preserved for electrostim routing
- Load into [funscript-tools](https://github.com/edger477/funscript-tools) or Restim to generate per-channel alpha/beta/pulse/volume files

<!-- SCREENSHOT: Estim download tab. Similar to Device tab but shows "No velocity cap" label. Caption: "The Estim tab exports a clean funscript for routing through Restim or funscript-tools." -->

See [Device Safety →](../reference/device-safety.md) for a full explanation of the difference.

---

## The forge log

Every exported funscript includes a `_forge_log` key in its JSON metadata:

```json
"_forge_log": {
  "version": "0.1.0",
  "exported_at": "2026-03-14T10:23:45",
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

## Related

- [Phrase Editor →](phrase-editor.md) — fix individual phrases
- [Pattern Editor →](pattern-editor.md) — fix all phrases of a given type
- [Device Safety →](../reference/device-safety.md) — velocity caps, device types, estim routing
- [Transforms →](transforms.md) — what every transform does
