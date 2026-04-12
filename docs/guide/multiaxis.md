# Multi-axis

The Multi-axis tab generates secondary axis funscripts — roll, pitch, twist, surge, and sway — from your primary stroke data. You assign a position style to each phrase, and FunscriptForge derives the secondary axes algorithmically at export time. No video analysis, no GPU, no hand-scripting.

The result: your single-axis funscript becomes a full multi-axis experience for OSR2 and SR6 users. Every phrase can have its own physical position style, so the secondary axes change character across the scene arc — just like the real thing.

---

## The six axes

Funscripts use the T-Code convention for naming axes. Your primary funscript is always L0 (stroke). The Multi-axis tab generates the other five:

| Axis | Code | Motion | File | Devices |
| --- | --- | --- | --- | --- |
| Stroke | L0 | Up/down | `{stem}.funscript` | All |
| Surge | L1 | Forward/back | `{stem}.surge.funscript` | SR6 |
| Sway | L2 | Left/right | `{stem}.sway.funscript` | SR6 |
| Twist | R0 | Rotation | `{stem}.twist.funscript` | OSR2+, SR6 |
| Roll | R1 | Tilt left/right | `{stem}.roll.funscript` | OSR2, OSR2+, SR6 |
| Pitch | R2 | Tilt forward/back | `{stem}.pitch.funscript` | OSR2, OSR2+, SR6 |

FunscriptForge generates all axes that the assigned styles use. Devices ignore the files for axes they don't support. T-Code players (MultiFunPlayer, XTP) auto-discover files by the `.axis.funscript` naming convention — no configuration needed.

---

## How it works

1. **Load a funscript** and walk through at least Device and Tone so phrases are detected.
2. **Open the Multi-axis tab.** Your funscript is shown at the top with phrase labels (P1, P2, ...) as a visual reference.
3. **Assign a position style** to each phrase using the dropdown in the table. Each style simulates a different physical position by deriving the secondary axes differently from the stroke data.
4. **Preview** to see monochrome charts of each generated axis. The charts show the full script with active and neutral regions clearly visible at phrase boundaries.
5. **Accept** to save your assignments. The actual funscript files are generated at **Export** time, not here — Accept just saves the decisions.
6. **Export** with a mechanical device selected. The `mechanical/` subfolder will contain the primary funscript plus one `.axis.funscript` per active secondary axis.

---

## Position styles

Five presets are available. Each one maps the secondary axes to algorithms that derive motion from your L0 stroke data.

### Which axes does each style use?

| Style | Roll (R1) | Pitch (R2) | Twist (R0) | Surge (L1) | Sway (L2) |
| --- | --- | --- | --- | --- | --- |
| **Cowgirl** | Gentle sway | Follows stroke | Slight random | — | — |
| **Missionary** | Stroke-speed driven | Gentle sine | — | — | — |
| **Doggy** | — | Strong forward thrust | — | — | — |
| **Riding** | Wide sway | Anti-correlated | Random walk | Slow drift | Slow drift |
| **Random** | Random walk | Random walk | Random walk | Random walk | Random walk |

**Surge and sway** (L1, L2) are translational movements that only the SR6 supports. The simpler styles (Cowgirl, Missionary, Doggy) stick to rotational axes that work on all multi-axis devices. Riding and Random go full SR6.

### Style descriptions

**Cowgirl** — Rocking motion. Pitch follows the stroke direction (forward on up-stroke, back on down-stroke). Roll is a gentle left-right sway whose amplitude grows with stroke speed. Twist is a subtle random walk for variety.

**Missionary** — Side-to-side emphasis. Roll is dominant, driven by stroke velocity — fast strokes create pronounced side-to-side tilt. Pitch is a gentle sine wave. No twist.

**Doggy** — Forward-thrust emphasis. Pitch is the only active axis, strongly correlated with stroke and biased forward. The device tilts forward on every stroke. Minimal other motion.

**Riding** — Full circular motion. All five secondary axes are active. Roll and pitch work together with wide amplitude. Twist is a random walk. Surge and sway add slow translational drift. This is the "everything moves" style — most immersive on an SR6.

**Random** — All axes get independent random walks, amplitude modulated by stroke velocity. Fast sections get more motion; slow sections stay calm. The "surprise me" option. Good for content where you don't know what position fits.

---

## Per-phrase assignment

The table shows every phrase with its time, duration, BPM, and behavioral tag. The **Multi-axis style** dropdown lets you pick a different style per phrase.

This is powerful because real scenes change position. A funscript that starts gentle and builds to intense benefits from different secondary axes in each phase:

| Phrase | Character | Suggested style | Why |
| --- | --- | --- | --- |
| Slow build | Low BPM, wide amplitude | Cowgirl | Gentle rocking that builds |
| Steady rhythm | Medium BPM | Missionary | Side-to-side adds variety to a steady stroke |
| Transition | Low activity | None | Let the device rest — contrast makes the next style hit harder |
| Intense | High BPM, full range | Riding or Random | Full motion for the peak |
| Cooldown | Slowing down | Cowgirl or None | Wind down gracefully |

**Apply to all** sets every phrase to the same style. Use this when you want a uniform feel, or as a starting point before customizing individual phrases.

**None** means no secondary axes for that phrase. The device stays centered on all non-stroke axes during that phrase. Use None for transitions, quiet moments, or phrases where the primary stroke is enough.

---

## Preview

Click **Preview** after assigning styles to see monochrome charts of each generated axis:

- **L0 Stroke (input)** — your primary funscript, full width
- **Secondary axes** — shown 3-across below the stroke. Each chart shows the derived motion for that axis across the full script duration.

Active phrases show motion; None phrases show flat lines at the neutral position (50). Phrase boundaries are visible as transitions between active and flat regions — a raised-cosine crossfade smooths the transitions so the device doesn't jump.

The preview is generated in memory and doesn't write any files. It's fast — typically under a second for a 90-minute funscript.

---

## What gets exported

When you click **Export All** with a mechanical device selected and multi-axis styles assigned, the `mechanical/` subfolder contains:

```text
mechanical/
  {stem}.funscript              ← L0 stroke (always present)
  {stem}.roll.funscript         ← R1 (if any style uses roll)
  {stem}.pitch.funscript        ← R2 (if any style uses pitch)
  {stem}.twist.funscript        ← R0 (if any style uses twist)
  {stem}.surge.funscript        ← L1 (if any style uses surge)
  {stem}.sway.funscript         ← L2 (if any style uses sway)
```

Only axes that at least one phrase uses are written. If no phrase uses twist, no `.twist.funscript` is generated.

To play: load the `mechanical/` folder in MultiFunPlayer, XTP, or any T-Code player. The player auto-discovers all axis files by filename convention.

---

## Deterministic output

The generation is deterministic. The same funscript with the same style assignments always produces the exact same multi-axis output. Random-walk algorithms use per-phrase seeds derived from the phrase index and axis name, not from system time. This means:

- Re-exporting produces identical files
- Sharing a `.forgetmpl` template with someone else and applying it to the same funscript produces the same result
- You can trust the preview — what you see is what you get

---

## What this is NOT

- **Not a manual multi-axis editor.** FunscriptForge generates secondary axes from presets. If you need hand-placed keyframes on specific axes, use OpenFunscripter.
- **Not AI video tracking.** FunscriptForge derives from the L0 stroke data, not from video. For video-based multi-axis generation, see FunGen.
- **Not real-time playback.** Files are generated at export time. MultiFunPlayer handles playback.

FunscriptForge is the **fastest path from a single-axis funscript to a multi-axis experience**. For most scripts, the preset styles produce results that feel authored, not random — because they're phrase-aware and derived from the actual stroke data.

---

## Related

- [Export →](export.md) — where multi-axis files are written to the mechanical/ subfolder
- Device tab — select your mechanical device targets
- Stim tab — estim channel generation (separate from multi-axis)
- [Device Limits →](../reference/device-limits.md) — axis support per device
