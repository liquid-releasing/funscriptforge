# Phrase Editor

The Phrase Editor is where you improve individual phrases. Every phrase in your funscript can be opened here, given a transform, tuned with live sliders, and accepted or rejected before anything changes in your output.

---

## Opening the Phrase Editor

From the **Phrases** tab:

- Click any phrase band on the chart
- Or click any row in the phrase table

The tab switches from Phrase Selector view to Phrase Editor view.

<!-- SCREENSHOT: Phrase Selector with the cursor hovering over a phrase band on the chart. The phrase is highlighted/outlined. Caption: "Click any phrase band on the chart to open it in the Phrase Editor." -->

---

## Layout

The Phrase Editor has three columns:

```
[ Original chart (2/4) ] [ Transform controls (1/4) ]
[ Preview chart  (2/4) ]
```

<!-- SCREENSHOT: Full Phrase Editor layout. Left two-thirds: stacked original and preview charts showing a phrase. Right third: transform dropdown at top, parameter sliders below, Accept/Cancel/Prev/Next buttons at bottom. Caption: "The Phrase Editor. Original on top, live preview below. Controls on the right." -->

**Original chart** — the phrase exactly as it exists in your funscript, with a brief window of context on either side so you can see the surrounding motion.

**Preview chart** — updates live as you move sliders. Shows what the phrase will look like after the transform is applied. The context windows on either side use the same surrounding actions, so you can see how the edited phrase will blend with its neighbors.

**Transform controls** — dropdown to select a transform, parameter sliders for that transform, and the action buttons.

---

## Choosing a transform

Open the transform dropdown and select any of the 25 built-in transforms. The sliders below update to show the parameters for that transform with their default values.

Start with the auto-suggestion if one is shown — FunscriptForge recommends a transform based on the phrase's behavioral tag and BPM. You can always override it.

See [Transforms →](transforms.md) for a full description of every transform and what it does.

---

## Tuning with sliders

Move any slider and the preview chart updates in real time. There is no Apply button for sliders — changes are reflected immediately.

If the preview looks wrong, move the slider back or choose a different transform.

---

## Device safety

The **Device safety** checkbox (below the sliders) applies a velocity cap of 200 pos/s to the preview. Enable it if you are editing for a mechanical device and want to see exactly what the device output will look like.

This is purely a preview setting — the cap is always applied independently at export time when you use the Device download tab.

---

## Accept, Cancel, and navigation

| Button | What it does |
|---|---|
| **Accept** | Applies the transform. Phrase is marked as edited. Returns to Phrase Selector. |
| **Cancel** | Discards the current transform selection. Returns to Phrase Selector without changing anything. |
| **← Prev** | Saves the current selection and opens the previous phrase. |
| **→ Next** | Saves the current selection and opens the next phrase. |
| **✕** | Closes the Phrase Editor and returns to Phrase Selector (same as Cancel). |

!!! tip "Undo"
    After accepting a transform, press **Ctrl+Z** (or **Cmd+Z** on Mac) to undo it. FunscriptForge keeps 50 levels of undo history.

---

## Apply to all phrases of this type

If the current phrase has a behavioral tag, you will see an **Apply to all** option below the controls. This copies your current transform settings to every phrase that shares the same tag.

Use this after you have found a good transform for, say, all your `stingy` phrases — apply once, propagate everywhere. You can still review individual phrases afterward using the [Pattern Editor](pattern-editor.md).

---

## Media player (optional)

If you have loaded a media file (audio or video) in the sidebar, a player column appears to the right of the charts. It plays only the current phrase — automatically looping within the phrase boundaries so you can hear or see what you are editing in context.

<!-- SCREENSHOT: Phrase Editor with the media player column visible. The player shows a waveform or video thumbnail. Caption: "With a media file loaded, the player restricts playback to the current phrase so you can edit in context." -->

Use the **📹 Hide/Show player** toggle above the charts to collapse the player column if you need more space.

---

## Splitting a phrase

Sometimes a phrase covers two distinct sections — a buildup and a plateau, for example — and you want to apply a different transform to each half.

Use the **Split** button (visible when the phrase is long enough to split) to divide it at any cycle boundary. The split creates two sub-phrases, each with its own transform controls.

The split boundary is shown as a vertical line on both charts. Drag it to adjust the cut point, or click **📌** in the media player to drop the boundary at the current playback position.

---

## Phrase information

At the top of the Phrase Editor you can see:

- Phrase number and time range (`1:24.3 – 1:51.7`)
- Duration
- BPM
- Behavioral tag(s)
- Cycle count and oscillation count

This tells you what kind of phrase you are working with before you choose a transform.

---

## Related

- [Transforms →](transforms.md) — what every transform does
- [Pattern Editor →](pattern-editor.md) — edit all phrases of a given tag at once
- [Export →](export.md) — review all transforms and download
- [Behavioral Tags →](../reference/behavioral-tags.md) — what the tags mean and what to do about them
