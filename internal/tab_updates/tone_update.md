# Tone tab possible update

Add this if we need these or a faster stim tab.

May or may not apply as needed.

The bottleneck is process() — 30-60 seconds for a full-length funscript. Can't make that faster (it's Edger's code). But we can make it feel fast:

1. Separate "configure" from "generate"

Right now, every interaction risks a rerun. Split the page into two phases:

Top half: instant — card selection, sliders, electrode path art. No process() calls. Pure UI.
Bottom half: on-demand — Preview and Accept are the only things that call process(). User adjusts everything first, clicks once.

2. Don't regenerate what exists

Accept currently re-runs the full pipeline even if Preview already generated the same config. Fix: hash the config (preset + slider values), compare to last run. If identical, copy files from preview temp dir → output folder. Instant.

3. Cache the preview across tab switches

Store the preview result (output dir + file list) in session state. If user goes to Export and comes back, the channel charts are still there. No re-render, no re-generate.

4. Progress that doesn't lie

The 17% → 100% jump is because funscript-tools reports progress in phases. The prostate generation phase (17%) is the longest. Two options:

Show an honest message: "Generating channels — this takes 30-60 seconds for long funscripts"
Or use indeterminate spinner for the known-slow phase instead of a percentage that looks stuck

5. Pre-generate on tone Accept (background)

When the user accepts Tone, we know the shaped funscript is ready. We could kick off process() in the background with the last-used stim config. By the time they reach the Stim tab, it's done. This is speculative — only worth it if most users go Tone → Stim → Export.

My ranking:

| Fix	| Effort	| Impact |
| - | - | - |
|#2 Don't regenerate	|Small|	Huge — saves 30-60s on Accept|
|#3| Cache across tabs	|Small	|Medium — no re-render on return|
|#1 |Separate configure/generate	|Already done|	Just needs slider changes to not trigger process()|
|#4 |Honest progress	|Small	|Feels better even if same speed|
|#5 Background pre-generate	|Medium	|Speculative, nice-to-have|

The biggest win is #2 — Accept becomes instant when Preview already ran with the same settings.