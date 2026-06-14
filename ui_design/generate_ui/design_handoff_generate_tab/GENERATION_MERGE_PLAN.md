# Generation merge — wiring FSF's Generate tab to videoflow's real engine

> Status: **PLAN** (2026-06-14). The Generate tab UI + actionable diagnosis +
> Passages symmetry are built and committed (on `channels-character-2d`) against
> a STAND-IN generator (`data/generate.js::generateFromLanes`). This document is
> the roadmap for replacing that stand-in with videoflow's real generator.
> Companion to DESIGN_DECISIONS.md. Decision to plan-not-build: user, 2026-06-14.

## What's already true (de-risked this session)

- **videoflow is directly importable from FSF's venv** — `import videoflow`
  resolves to `…/videoflow/src/videoflow/__init__.py`, and FSF's `cli.py` already
  imports `videoflow.sidecar`, `videoflow.chapters`. **No subprocess/shelling and
  no separate install needed** — `cli.py` can `from videoflow.generate import
  generate_from_beats` today. This is the single biggest de-risker.
- **The engine is real and rich.** `videoflow/src/videoflow/generate.py`:
  `generate_from_beats(beat_map, output, *, low, high, center, center_trajectory,
  tone_per_stanza, energy_normalize, stroke_density, density_arc, title,
  progress_callback)`. Crucially `density_arc` accepts **`list[float] | str |
  None`** — a per-position arc list, not just the CLI's `default|none` toggle.
- The videoflow CLI `generate` subcommand exists (`--center-trajectory START,END`,
  `--density-arc default|none`, `--stroke-density half|full|2|4|8`, `--low/--high`)
  but its flags are **narrower than the Python API** — wire through the API, not
  the CLI flags.

## The two hard problems (why this isn't mechanical)

### 1. Curve → engine-parameter mapping (the product fork)
Our UI authors two arbitrary **curves** (Range = how far, Pace = how busy).
videoflow's amplitude model is different:

| UI curve | videoflow input | Maps cleanly? |
|---|---|---|
| **Pace** (how busy) | `density_arc: list[float]` | **Yes** — sample the Pace curve to a list. |
| **Range** (how far) | `low`/`high` (constant bounds) + energy-driven amplitude + `center_trajectory` (start,end) | **No** — videoflow has no *time-varying* amplitude input. A "grow to rails" Range can only be approximated. |

**Decision needed (the user's architecture call):**
- **(A) Beta-lossy:** Range → constant `low`/`high` from the curve's average, plus
  `center_trajectory` from its endpoints. Ships fast; loses the Range *shape*.
- **(B) Faithful:** extend `videoflow.generate` to accept a **per-position range/
  amplitude arc** (mirror how `density_arc` already works), so the Range curve is
  honored point-for-point. Cross-repo engine change; no information loss.

Recommendation: (B) is the "right" answer and small in spirit (it mirrors the
existing `density_arc` list plumbing), but it's a videoflow engine change — decide
deliberately.

**★ DATA-SCIENCE RESOLUTION (the findings settle this — see
[[project_forgegen_generation_correctness]]):**
- **Pace → `density_arc` is not a compromise, it's the proven core.** "energy→
  density REFUTED" (corr ≈ 0.17): busyness is an AUTHORED narrative arc, not
  loudness. The Pace curve = the user declaring that arc. Build it first.
- **The depth law resolves the Range fork.** amplitude ∝ energy is what makes the
  position distribution bell-shaped (good); fixed-depth goes bimodal (bad, proven
  3×). So energy-driven amplitude must be KEPT. Range is therefore NOT a competing
  amplitude source — it's a **time-varying GAIN/ceiling that scales the
  energy-driven depth** (shallow tease caps it early, opens to full later). So
  option (B) specifically = add a **per-position amplitude-gain arc that
  multiplies energy depth** (mirror `density_arc`), NOT a raw amplitude curve.
  Preserves energy→bell AND honors the user's reach intent.
- **Grade against the BAND, not a target.** Extend the oracle to report rateCoV
  (band 0.37–0.46) + velCoV (0.21–0.30) vs the gold band — don't overfit to one
  script. "Dynamic ✓" should mean "inside the proven band."
- **Guardrails:** apply the octave guard (`_correct_tempo_octave`) when generating
  from analyzed beats (BPM doubling → 2× density); analyze the **mp4** and beware
  the STIM-vs-music trap (a `.mp3` may be a 969 Hz e-stim render).

### 2. Beat-map acquisition (the data gap)
`generate_from_beats` needs a full **`AudioBeatMap`** (beats + **energies** +
**stanzas** + duration + bpm). FSF's cached `<stem>.beats.json` is a **reduced
sidecar** — `beats_ms / downbeats_ms / bpm / duration_ms` only, **no energies/
stanzas**. So generation can't run off the current sidecar. Options:
- **Persist the full AudioBeatMap** during the analyze pass (videoflow already
  builds it; FSF just needs to save it alongside the reduced sidecar), then
  generate reads it — fast, no re-analysis. *Preferred.*
- **Re-analyze at generate** (`videoflow.audio.analyze_beats(media)`) — simplest
  but slow on long files (librosa pass) and needs the media present.

This is also the "front door" the keystone DESIGN_BRIEF describes: generation rides
the analyze pass ([[feedback_hide_work_inside_existing_wait]]).

## The layers to build (once the two decisions are made)

1. **`cli.py generate`** (Python, testable without tauri) — `from
   videoflow.generate import generate_from_beats`; inputs: a beat-map (full
   AudioBeatMap json or media to analyze) + sampled Range/Pace curves + low/high;
   output: a funscript path + stats JSON. **Verifiable via `python cli.py
   generate …`** against a real analyzed source.
2. **Rust command** (`commands.rs`) — mirror `analyze_chapters_with_videoflow`'s
   pattern (it resolves bundled forge-cli, emits `ff:progress`). Needs
   `tauri:dev` recompile to verify.
3. **forge.js bridge** — `generateWithVideoflow(...)`, sibling to
   `analyzeChaptersWithVideoflow`.
4. **GenerateTab** — swap `generateFromLanes`'s body (the ENGINE SEAM) to call the
   bridge when a real analyzed media project is present; **keep the stand-in as
   fallback** so the verified UI never breaks (sample/video-less projects).

## Where does a generated funscript live? (blocks slice #3 too)
Generate CREATES the main funscript. For a funscript-backed project it's the
working copy (`saveWorkingFunscript`, already wired). For a **video-only** project
there is no funscript path yet — the merge must decide the generated file's home
(e.g. `<media-stem>.funscript` in the forge dir). This is why "persist / Set as
working funscript → chain" (slice #3) also waits on the merge.

## Verification reality
- **Python core (#1):** fully testable now — `python cli.py generate` + assert a
  plausible funscript (decile spread, action count, rails). Can even A/B against
  the diagnosis oracle.
- **Rust + UI (#2–#4):** need `tauri:dev` recompile + a **real analyzed media
  project** (sample/browser mode can't exercise it). User-driven dogfood.

## Recommended sequence (data-science-ordered)
1. **Pace → `density_arc` list** — the proven core (authored narrative arc, the
   refuted-energy finding). Build `cli.py generate` around this first; Python-CLI
   testable, finally produces "a funscript we generate" for real.
2. **Range gain-arc in videoflow** — add a per-position amplitude-gain arc that
   *scales* energy-driven depth (preserves the depth law's energy→bell). Decide
   beat-map strategy alongside (persist full AudioBeatMap in analyze vs re-analyze).
3. **Oracle → the band** — extend `diagnose` to report rateCoV/velCoV vs the gold
   band (0.37–0.46 / 0.21–0.30); add the octave guard on the analyze→generate path.
4. Rust command + forge.js bridge.
5. GenerateTab: real-engine path + stand-in fallback; verify under `tauri:dev`.
6. Then slice #3 (generated-funscript home + chain).

## Pointers
- Engine: `videoflow/src/videoflow/generate.py` (`generate_from_beats`,
  `density_arc_curve`, `density_arc_from_levels`), `videoflow/src/videoflow/cli.py`
  (generate subcommand ~L300–460, argparse ~L870–950), `videoflow/src/videoflow/
  audio.py` (`AudioBeatMap`, `analyze_beats`).
- FSF seam: `ui/web/src/data/generate.js::generateFromLanes`, the diagnosis
  (`diagnose`/`verdictFor`/`topFix`) runs unchanged against real output.
- Keystone: memory `project_generator_into_funscriptforge` (the merge thesis).
