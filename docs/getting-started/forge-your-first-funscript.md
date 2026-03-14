# Forge Your First Funscript

Load a script, read what the analyzer found, apply your first transform, and export an improved funscript. The whole process takes about five minutes.

---

## Before you start

- FunscriptForge is installed and open in your browser ([Install →](install.md))
- You have a `.funscript` file on your computer

---

## Step 1 — Load your funscript

In the sidebar, find the **Funscript file** input at the top. Paste the full path to your file and press **Enter**.

**How to get the path:**

=== "Windows"
    Hold **Shift** and right-click your file in Explorer → **Copy as path**.
    The path looks like: `C:\Users\YourName\Videos\myscript.funscript`

=== "macOS"
    Right-click in Finder → **Get Info** and copy the path from the **Where** field.
    Or drag the file onto a Terminal window to paste its path.

=== "Linux"
    Right-click → Properties, or drag the file to a terminal.

<!-- SCREENSHOT: Sidebar with the funscript file path input highlighted and a path pasted in. Caption: "Paste the full path to your .funscript file in the sidebar input and press Enter." -->

---

## Step 2 — Watch the analysis run

A progress bar appears as FunscriptForge works through the pipeline:

```
Parsing → Phases → Cycles → Patterns → Phrases → BPM transitions
```

For most scripts this finishes in 2–5 seconds. A 90-minute script may take up to 20 seconds.

---

## Step 3 — Read the chart

When analysis finishes you see the **Phrase Selector** — the heart of FunscriptForge.

<!-- SCREENSHOT: Phrase Selector tab fully loaded. Full-funscript heatmap chart visible with phrase bands overlaid, BPM labels on each band, a few BPM transition markers as vertical lines, and the phrase table below. Caption: "The Phrase Selector shows your entire funscript as a map. Each colored band is one phrase. The brightness shows motion intensity — brighter means faster and higher-amplitude." -->

**What you are looking at:**

- **The heatmap** — every action in your script rendered as colored strips. Bright warm colors are high-energy; dark cool colors are quiet.
- **Phrase bands** — semi-transparent rectangles overlaid on the chart. Each band is one phrase, labeled with its number and BPM.
- **BPM transition markers** — thin vertical lines where the tempo changes significantly. These often mark scene cuts.

The sidebar now shows your script's stats: phrase count, BPM range, patterns found.

---

## Step 4 — Click a phrase

Click any phrase band on the chart, or click a row in the phrase table below. The app switches to the **Phrase Editor**.

<!-- SCREENSHOT: Phrase Editor open. Left two-thirds shows the original action chart and a preview chart below it (both showing the same phrase before any transform is applied). Right third shows the transform dropdown and parameter sliders. Caption: "The Phrase Editor. Original on top, preview below. Choose a transform and the preview updates live." -->

The Phrase Editor has three columns:

- **Left — Original chart:** The phrase exactly as it is in your funscript
- **Left — Preview chart:** What the phrase will look like after the transform
- **Right — Transform controls:** A dropdown to choose the transform, sliders to tune it

---

## Step 5 — Apply a transform

If you are not sure what to do, start with **Amplitude Scale**.

1. In the transform dropdown, select **Amplitude Scale**
2. Move the **Scale** slider — watch the preview chart update in real time
3. Find a setting that looks better than the original
4. Click **Accept**

<!-- SCREENSHOT: Phrase Editor with Amplitude Scale selected. Scale slider is set to 1.4. Preview chart shows wider strokes than the original. Caption: "Amplitude Scale stretches stroke depth around the midpoint. Move the slider and the preview updates instantly." -->

The phrase is now marked as edited. You can undo at any time with **Ctrl+Z**.

---

## Step 6 — Export

Click the **Export** tab. You will see:

- A **Completed transforms** table listing every phrase you edited
- A **Recommended transforms** table with auto-suggestions for phrases you have not touched yet
- Two download tabs: **Device** and **Estim**

<!-- SCREENSHOT: Export tab. Completed transforms table at top shows one row (the phrase just edited). Recommended transforms table below shows several auto-suggested rows. The Device/Estim download tabs are visible at the bottom. Caption: "The Export tab. Your manual edits are at the top; auto-suggestions fill the rest. Accept, edit, or reject each recommendation before downloading." -->

Click **Download** under the **Device** tab to get your improved funscript.

The file is saved as `{original-name}.device.funscript`. Load it in your player.

---

## What just happened

You loaded a funscript, saw its motion structure for the first time, applied a transform to one phrase, and exported an improved file. That is the core loop.

From here:

- **Fix more phrases** — work through the phrase table, phrase by phrase
- **Fix all phrases of a type at once** — use the [Pattern Editor](../guide/pattern-editor.md)
- **Review all auto-suggestions at once** — use the [Export tab](../guide/export.md) to accept or reject them in bulk

---

## Troubleshooting

Something unexpected? [Troubleshoot loading a script →](../troubleshooting/loading-a-script.md)
