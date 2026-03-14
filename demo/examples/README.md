# Demo Funscripts — Big Buck Bunny

Two example funscripts built to the length and rhythm of Big Buck Bunny (9:56).
Use these for screenshots, the getting-started guide, and walkthrough videos.

Big Buck Bunny is [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) — Blender Foundation.
These funscripts are synthetic (generated for documentation purposes) and are MIT licensed.

---

## Files

| File | Purpose |
| --- | --- |
| `big_buck_bunny.raw.funscript` | The "before" — all the typical problems visible |
| `big_buck_bunny.forged.funscript` | The "after" — improved output, same structure |

---

## big_buck_bunny.raw.funscript — annotated

This file is deliberately broken in all the ways a raw funscript can be broken.
Each section demonstrates a specific behavioral tag.

| Timestamp | Duration | BPM | Tag | What's wrong |
| --- | --- | --- | --- | --- |
| 0:00 – 0:30 | 30 s | 45 | **lazy** | Slow and shallow — low BPM, narrow amplitude. Barely perceptible. |
| 0:30 – 0:50 | 20 s | 80 | **giggle** | Tiny amplitude (span ~15) centered at 50. Device trembles rather than strokes. |
| 0:50 – 1:15 | 25 s | 120 | **stingy** | Full-range hammering — high velocity, no variation. Demanding and relentless. |
| 1:15 – 1:55 | 40 s | 95 | **drift** | Motion displaced into the top third (center ~72). Bottom half wasted. |
| 1:55 – 2:25 | 30 s | 110 | **drift** | Motion displaced into the bottom third (center ~25). Top half wasted. |
| 2:25 – 3:25 | 60 s | 125 | **plateau** | Moderate BPM but narrow amplitude span (~35). Correct center, shallow strokes. |
| 3:25 – 3:40 | 15 s | 240 | **frantic** | 240 BPM — above mechanical device limits. Will skip or stutter on most hardware. |
| 3:40 – 5:10 | 90 s | 118 | **drone** | Perfectly uniform 90-second section. No tempo variation, no dynamics. Machine-like. |
| 5:10 – 5:35 | 25 s | 50 | **lazy** | Slow and shallow again — recovery section that's too quiet. |
| 5:35 – 6:10 | 35 s | 130 | **stingy** | Second stingy section — full-range high-velocity hammering. |
| 6:10 – 6:30 | 20 s | 85 | **half_stroke** | Real stroke depth but confined to the top half (center ~68). |
| 6:30 – 7:20 | 50 s | 105 | *(normal)* | Well-formed section — amplitude and centering are fine. |
| 7:20 – 7:50 | 30 s | 220 | **frantic** | Second frantic section — 220 BPM. |
| 7:50 – 9:10 | 60 s | 115 | **plateau** | Second plateau — moderate BPM, narrow span. |
| 9:10 – 9:50 | 40 s | 90 | *(normal)* | Normal section — correctly formed. |
| 9:50 – 9:56 | 26 s | 60 | **lazy** | Outro — slow and shallow. |

**BPM transitions detected:** 6 (at 0:29, 0:49, 5:09, 5:35, 7:19, 7:50)

---

## big_buck_bunny.forged.funscript — what changed

The same 16 sections after applying appropriate transforms in FunscriptForge:

| Timestamp | Tag → Fix | Transform applied |
| --- | --- | --- |
| 0:00 – 0:30 | lazy → boosted | Amplitude Scale 1.5× |
| 0:30 – 0:50 | giggle → full range | Amplitude Scale 2.0× |
| 0:50 – 1:15 | stingy → reduced | Amplitude Scale 0.78× |
| 1:15 – 1:55 | drift → centered | Recenter (target 50) |
| 1:55 – 2:25 | drift → centered | Recenter (target 50) |
| 2:25 – 3:25 | plateau → boosted | Amplitude Scale 1.45× |
| 3:25 – 3:40 | frantic → reduced | Amplitude Scale 0.6× |
| 3:40 – 5:10 | drone → dynamics | Smooth 0.35 |
| 5:10 – 5:35 | lazy → boosted | Amplitude Scale 1.5× |
| 5:35 – 6:10 | stingy → reduced | Amplitude Scale 0.8× |
| 6:10 – 6:30 | half_stroke → centered | Recenter (target 50) |
| 6:30 – 7:20 | normal | Amplitude Scale 1.2× (light polish) |
| 7:20 – 7:50 | frantic → reduced | Amplitude Scale 0.55× |
| 7:50 – 9:10 | plateau → boosted | Amplitude Scale 1.35× |
| 9:10 – 9:50 | normal | Amplitude Scale 1.1× |
| 9:50 – 9:56 | lazy → light boost | Amplitude Scale 1.1× |

---

## Using these files

**Getting-started guide:** Load `big_buck_bunny.raw.funscript` to walk through the Forge Your First Funscript tutorial.

**Screenshots:** Both files produce consistent, reproducible charts — use the raw file for "before" screenshots and the forged file for "after" comparisons.

**Walkthrough video:** The raw file's 16 sections cover every behavioral tag in order, making it a complete product demo in under 10 minutes.

**"Load demo" button:** The app can load `big_buck_bunny.raw.funscript` directly via the sidebar's **Load demo** button (planned feature — see backlog).
