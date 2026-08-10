# Changelog

All notable changes to FunscriptForge are recorded here.

## v0.2.0-alpha — 2026-08-10

Two months of editing work on top of the first alpha. The headline is that
the editing loop got faster and more honest: analysis stopped re-doing work it
had already done, long waits now say what they're doing, and every tab's
footer tells you what it wants next instead of letting you skip past it.

Windows only, as with v0.1.0-alpha. macOS and Linux still follow.

### Added

- **Viewer stage** — review a device's generated output across the whole
  timeline, with all channels, a shared baton, audio/events lanes and a
  spectrogram. Reads a `.forge` bundle when no loose `.output/` folder exists.
- **Markers** — place and step through named points; they travel through
  `chapters.json` into the exported bundle and show up in ForgePlayer.
- **Bass Shaker** Polish station (experimental) — renders the scene's
  intensity as sub-bass rather than as a position, since a transducer has no
  travel. Stamps both an envelope funscript and a 40 Hz LFE audio track.
  The envelope follows stroke *speed*, so stillness goes quiet and bursts hit.
- **Short Beats** transform — a centre-anchored twin of Hero Beat.
- **Undo** for transforms on the script-editing tabs, with a stacked count.
- **Multi-select** of phrases and stanzas via Ctrl/Shift-click.
- **Flash-safety cap** on generated e-stim channels, plus a screech sidecar
  recording what was tamed.

### Changed

- **Footer accept-grammar across every tab.** The red primary is always the
  encouraged next action, never the skip: it walks you chapter by chapter and
  only becomes "chain to the next tab" once every chapter has been considered.
- **Chapters** — compact header, header-level collapse, marker stepper, and a
  16:9 viewer that the other editing tabs now match.
- **Analysis resumes instead of recomputing.** Landing on Analysis after
  generating a funscript no longer re-extracts audio the generate pass just
  extracted.
- **One audio decode per source.** Generation and chapter analysis now share
  their extracted WAV, so the same track is never decoded twice.
- **1440p / 2.5K sources stream directly** instead of transcoding a clip per
  chapter — minutes of work per analysis removed rather than made faster. 4K
  and above still pre-extract 720p clips.
- **Chapter clips report progress** while encoding, and name the clip's length,
  instead of going silent for minutes.
- Clip encodes moved from `-preset ultrafast` to `veryfast`, roughly halving
  clip size at unchanged quality.
- Backend prewarms the scientific stack at launch, so the first analysis
  doesn't pay the import cost.

### Fixed

- A missing or malformed funscript now names the file it could not read
  instead of failing with an internal attribute error.
- Events: a chapter counts as reviewed once you leave it, so navigating by
  clicking chapter bands no longer strands the chain to Channels — while the
  last chapter still gets a deliberate accept.
- Chapters resolve against the project's media rather than the funscript stem,
  fixing chapters that went missing on reopen.
- Assessment reuses a fresh phrases sidecar, ending a double-analyze.
- Near-CFR sources (HandBrake reports a frame rate a hair under nominal) count
  as constant-rate and skip the clip pipeline.
- Recents rows no longer show a chapter count, which was structurally always
  "0 ch" and made analyzed projects look like they had lost their chapters.
- Numerous viewer and strip fixes: the Channels baton, long-file deep seeking,
  a dark funscript from an undefined tone, and a red bar in the Phrases and
  Stanzas selection strip.

## v0.1.0-alpha — 2026-06-09

First Tauri desktop alpha cut through the bundled-backend release pipeline:
the app ships its own frozen Python backend (forge-cli) + ffmpeg, so there
is no separate install. Windows-first; macOS/Linux follow.

### Added

- Self-contained Windows installer (MSI + NSIS) that bundles a PyInstaller
  freeze of `forge-cli` (cli.py + librosa/numba/scipy/videoflow + vendored
  funscript-tools) and a static ffmpeg — no Python or ffmpeg prerequisite.
- `.forge` bundle export/import: round-trip a project to a portable,
  device-organized snapshot and re-open it as an editable project.
- Selectable export output folder, snapshot versioning (project_id +
  monotonic version, never-overwrite `(N)`), and media lean-default with
  `--include-media` opt-in.
- Export enrichment: beats/audio sidecars, audio + spectrogram preview
  images (media-free from sidecars), assessment summary in the manifest,
  and a non-black hero frame.

### Changed

- CI release pipeline replaces the legacy streamlit workflow; the Rust
  shell resolves the bundled `forge-cli` resource (with a dev `.venv`
  fallback) and a bundled ffmpeg on PATH.
