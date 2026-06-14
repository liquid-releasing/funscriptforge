# Generation merge — wiring FSF's Generate tab to videoflow's real engine

> Status: **SHIPPED** (updated 2026-06-14). The roadmap below is **done** — the
> Generate tab calls videoflow's REAL engine in-process (Pace→`density_arc`,
> Range→`gain_arc`), with chunked analysis, the measured `texture` lever, the
> band/speed diagnosis, and an in-tab player. The original PLAN text is preserved
> in git history (`channels-character-2d`). What remains is a small **tail** (the
> "generated-funscript home" §) — tracked under "Remaining" at the bottom.
> Companion to DESIGN_DECISIONS.md.

## What shipped (the six-step sequence is complete)

1. **Pace → `density_arc` list** — ✅ the proven core (authored narrative arc, the
   refuted-energy finding). `cli.py generate` builds it via `_pace_to_density_arc`.
2. **Range → per-position amplitude-GAIN arc** — ✅ `_curve_to_beat_arc` →
   `generate_from_beats(gain_arc=…)`; scales the fixed mode depth so reach can
   rise over the track WITHOUT reintroducing the refuted energy→amplitude law.
   The depth law (fixed-depth→bimodal) is preserved; energy→bell is not re-added.
3. **Oracle → the band** — ✅ `cmd_generate` reports rateCoV/velCoV vs the proven
   band (`_RATE_COV_BAND` / `_VELOCITY_COV_BAND`); the GenerateTab `BandChips`
   render "pace in band / intensity in band". Octave guard runs on the
   analyze→generate path (`videoflow.audio._correct_tempo_octave`).
4. **Rust command + forge.js bridge** — ✅ `generate_funscript` (commands.rs,
   resolves bundled forge-cli, streams `ff:progress`) ↔ `generateFunscript(opts)`
   (forge.js), sibling to `analyzeChaptersWithVideoflow`.
5. **GenerateTab: real-engine path + stand-in fallback** — ✅ runs the real engine
   when `isTauri() && mediaPath`; falls back to `generateFromLanes` only for the
   no-engine browser/sample case. Session result-persistence (App owns
   `genResult={sig,payload}`) + sig-gating so it re-runs only when a setting
   changes; an honest **"Calculating…"** placeholder during a real run instead of
   the misleading stand-in.
6. **Beat-map strategy** — ✅ `_load_or_analyze_beatmap` persists the **full**
   `AudioBeatMap` (`<stem>.beatmap.json`, energies+stanzas) during analyze and
   reuses it on generate; **chunked** per-chunk HPSS (`--chunk-secs`, default 180)
   so long files emit per-chunk progress + per-chunk energy normalization.

### Levers added beyond the original plan (all measured, not faith)
- **`texture` (Texture/Life)** — bounded amplitude variation; quiet beats ease off
  the rails for gold's mid shoulder. Default 0.2, **hard-capped 0.35** (sweep:
  ≥0.4 collapses the bimodal backbone into the refuted centre bell).
- **`liftStart` (per-lane START height)** — `v' = v + lift·(top−v)`, toward the
  rail (NOT the mean). Same lever Passages already used (floor=start, ceiling=rail).
- **Speed ceiling 600** (was 450) + flash clause dropped — measured gold avgV runs
  350–664 and hits 50–58% flash as a genre trait, not a defect.
- **In-tab player** — `MediaViewer` (Overview | Play) + DepthMeter; Play view wired
  to the real waveform/spectrogram/beats sidecars.

## Open / regretful findings still being worked (2026-06-14 dogfood)

These are the live-dogfood items in flight — see memory
`project_generator_into_funscriptforge`.

### A. Generate ≠ Chapters mismatch — DIAGNOSED
Not one bug, three stacked effects:
1. **Different funscripts.** Chapters renders `project.actions` (the funscript
   already loaded — the gold/original). Generate renders `gen.actions` (the freshly
   generated draft). Until "Continue with this funscript" adopts it, they are
   genuinely different files — so "Chapters looked better" = it was showing the
   better *original*, not the generation. (ChaptersTab.jsx ~L302 vs
   GenerateTab.jsx ~L374.)
2. **Stale analysis** (item C) compounds it: even after adopting, phrases come from
   the *original* funscript's `phrases.json` until re-analysis.
3. **Color-normalization asymmetry** (secondary): Generate normalizes stroke color
   against the **whole-track** p98; Chapters normalizes per-chapter-local p98 — so
   a gentle section is blue in Generate, golden in Chapters, for identical data.
   The p98 fix (FunscriptChart) helped flash outliers but can't equalize
   whole-track vs per-chapter windowing.

### B. Disk sidecar for the generate result — IN PROGRESS
The generated funscript already persists (`.<stem>.forge/<stem>.generated.funscript`)
so the *actions* survive restart; the **settings** (curves/start/texture) and
**result metadata** (band/speed/bpm/sig) do not. Add `<stem>.generate.json`
(small: settings blob + result + sig + output pointer), written at generate time
and read on mount so a return — or an app restart — restores the picked presets +
the real funscript instead of re-running the 3–10-min analyze+generate.

### C. Re-analysis after adopting a generated funscript — IN PROGRESS
Root cause confirmed: **only `phrases.json` is funscript-derived** and it is
path-keyed cache-if-exists with **no freshness check** — adopting new actions never
invalidates it (chapters/audio/spectro/beats are media-derived and correctly stay
valid; characters/passages are chapter-keyed). Fix: invalidate `phrases.json` at
the persistence point (when a new working funscript is saved) + force the Phrases/
Analysis tabs to rebuild. Adoption must also actually persist (today
`handleActionsPatch` is in-memory only).

### D. Video-only project gate — OPEN
A bare video can't open a project ("project requires a funscript"), and the Project
tab's "pick an alternative funscript" affordance is weak. This is the original
plan's "Where does a generated funscript live?" §: Generate CREATES the main
funscript, so a video-only project must be openable and the generated file adopted
as its working funscript.

## Pointers
- Engine: `videoflow/src/videoflow/generate.py` (`generate_from_beats`,
  `density_arc_curve`, `density_arc_from_levels`), `videoflow/src/videoflow/audio.py`
  (`AudioBeatMap`, `analyze_beats`, `_correct_tempo_octave`).
- FSF: `cli.py::cmd_generate` (~L3592) + `_load_or_analyze_beatmap` (~L3499);
  `ui/web/src/screens/GenerateTab.jsx`; `ui/web/src/data/generate.js`
  (`generateFromLanes` stand-in, `diagnose`/`verdictFor`/`topFix`, `liftStart`).
- Keystone: memory `project_generator_into_funscriptforge` (the merge thesis).
