# Changelog

All notable changes to FunscriptForge are recorded here.

## v0.3.17-alpha — 2026-09-05

FOC-Stim support, and the fixes from dogfooding the v0.2.16-alpha installer.

### Added

- **FOC-Stim, as two Polish stations.** "FOC-Stim · Direct current control"
  drives the three-phase device from the same channel set as E-Stim, and
  "FOC-Stim · 4-phase" exports four per-electrode channels (`.e1`–`.e4`)
  instead of alpha/beta positions. Both appear in Polish between E-Stim and
  Handy, both export into the `.forge` bundle, and both are listed in the
  Viewer. The position→electrode transform is ported from restim
  (`stim_math/transforms_4.py`, MIT) and verified against it.
  **Both are marked experimental: neither has been run on hardware yet.**
- **Try a transform before you use it.** The Catalog tab's long-stubbed
  sandbox is real: pick any transform, move its sliders, and see before/after
  on a canned 24-second signal (steady strokes, a fast burst, an off-centre
  passage, a swelling finish). It drives the same preview pipeline the Phrases
  and Stanzas tabs use, against a synthetic signal — your project is never
  touched. Transforms that are neutral at their defaults say so instead of
  showing two identical curves.
- **Skipping Polish now means accepting its defaults.** Every station is
  generated, not a hardcoded two — so skipping the tab no longer silently
  drops FOC-Stim and the shaker. Experimental stations are generated
  conservatively: FOC-Stim auto-generates at the proven 0.55 rate ceiling
  rather than its own unverified 0.65 (stamp it deliberately for 0.65).
- **`scripts/bump_version.py`** — one command sets the version in all five
  places it is written down (package.json, Cargo.toml, Cargo.lock,
  tauri.conf.json, and the website's download note), knows tauri.conf.json
  must stay numeric for the MSI bundler, and has a `--check` mode.

### Fixed

- **The version note on funscriptforge.com lagged the release.** The download
  buttons point at `releases/latest`, so the site served v0.2.16 binaries
  under a v0.2.15 label. The dispatch that was supposed to update it had no
  listener on the receiving repo.
- **Test builds were indistinguishable from releases.** A build-only dispatch
  produced binaries reporting the same version as the last tag, so an
  installed build could not be identified — and was not, costing a round of
  "this feature is missing" against a build that never contained it. Dispatch
  builds now stamp the short SHA into the displayed version and mark the
  installer filename `-TEST-<sha>`.
- **"Generate new funscript" never went red.** The footer treated incomplete
  analysis as a chain-blocker on every tab, including Project and Generate,
  which run *before* analysis exists — so their primary button stayed white
  and tentative even when the step was ready. The gate now applies only from
  Analysis onward.
- **Opening media kept the previous project on screen.** Title, media, and
  funscript from the last project stayed visible for the whole probe, because
  the media path seeded no placeholder the way the funscript path does.
- **Stim audio was rendered for devices that cannot play it.** The stereo
  WAV/mp3 is how restim is driven — FOC-Stim speaks its own protocol and reads
  the channel funscripts directly. Stamping only FOC-Stim rendered a stim mp3
  its hardware can never use; now no audio is rendered for it, and the Export
  card says so rather than promising files that never arrive.
- **Scene Closer wound down for a quarter of the scene.** The taper was a
  fraction of the span, so a 30-minute chapter faded for seven and a half
  minutes. It is now about a minute of absolute time regardless of chapter
  length, capped on short chapters so it still holds before releasing.
- **A vertical video stretched the whole library row.** The cover is no longer
  able to resize its own 16/9 box, and covers letterbox instead of cropping —
  a portrait thumbnail keeps its whole frame.
- **The Polish conveyor pushed Bass Shaker off the edge** once FOC-Stim took
  it to nine stations. The columns can now share the row evenly.
- **The Export card could not show what a station contributes.** It now names
  each stamped e-stim station with its real file count, so a stamped FOC-Stim
  is visibly covered by the E-stim target.

## v0.2.16-alpha — 2026-09-04

Analysis-tab fixes, all found by dogfooding the v0.2.15-alpha installer.

### Fixed

- **The chain button was offered while analysis was still running.** The
  footer showed a red ✓ "Accept and chain to Chapters" and the summary
  "ready to chain" over panels that still read "Detecting chapters…". Red +
  ✓ is the app's grammar for a completed step, so it is now withheld for
  every incomplete analysis state, and the Analysis tab is gated outright
  while the pipeline runs.
- **Analysis progress vanished from the footer.** Long operations each set the
  shared busy banner and cleared it with an unconditional reset in a `finally`,
  which cleared whichever banner was current rather than their own. An open,
  attach or import finishing after analysis started wiped the analysis banner
  and its step list. The banner is now token-scoped, so one operation cannot
  clear another's.
- **A project that had not been analyzed offered no way to start.** With media
  attached the state machine reports "loading" on the assumption the
  auto-trigger is about to run; when it did not, the tab showed no banner, a
  generic subtitle, and a single control labelled "Re-analyze". There is now
  an explicit not-started banner with an **Analyze** button.

## v0.2.15-alpha — 2026-09-04

Two defects found by dogfooding the shipped v0.2.14-alpha installer. Both were
invisible in development — neither reproduces in a dev run, which is why they
reached a release.

### Fixed

- **Export, Import, Events and Polish all failed in installed builds** with
  `ModuleNotFoundError: No module named 'yaml'`. PyYAML was never declared in
  `requirements.txt`. The development environment has it transitively, so dev
  runs and locally-produced freezes worked, while every CI-built release froze
  without it. `cli.py` reaches yaml from twelve places, so this covered the
  whole back half of the pipeline — not just the Events save that reported it.
- **A console window appeared on every click** that reached the backend.
  Windows gives each console child process its own window unless asked not to,
  and both backends are console programs. `CREATE_NO_WINDOW` was set on the
  launch prewarm but missing from the shared builder behind every analyze,
  generate, assess, export and preview. The two ffmpeg spawns and the
  ForgePlayer hand-off are covered too.

### Changed

- The release workflow's forge-cli smoke test now also runs
  `list-event-recipes`, which reads the vendored Edger catalog through PyYAML.
  The previous check ran only `list-characters`, which touches no YAML — which
  is how a freeze with no yaml module passed CI and shipped.
- Linux builds install `libtbb12`, so the portable AppImage bundles. numba
  ships a TBB backend whose library was absent from the runner; PyInstaller
  warned and continued, but linuxdeploy treats an unresolvable dependency as
  fatal and aborted the whole AppImage.

## v0.2.14-alpha — 2026-09-04

**macOS and Linux builds ship for the first time.** Previous releases were
Windows-only, and the download page advertised macOS and Linux buttons that
pointed at files the pipeline never produced.

Version numbering also changes here: the patch number now climbs with each
release and the middle number marks a minor release, so this follows v0.2.0
directly rather than continuing the old 0.0.x line.

### Added

- macOS build (Apple Silicon) — `FunscriptForge-macos-arm64.dmg`, with an
  arm64-native static ffmpeg and an `.icns` generated at build time from the
  source PNG.
- Linux build (x86-64) — `FunscriptForge-linux-x86_64.AppImage` and
  `FunscriptForge-linux-amd64.deb`, built on Ubuntu 22.04 so the AppImage
  inherits a glibc old enough to be portable.
- `workflow_dispatch` on the release workflow, so a build path can be
  exercised end to end without spending a version tag on it.

### Fixed

- The Discord invite compiled into the About dialog had expired. All six
  references across the app and docs now point at the live invite.
- Every FunscriptForge download link on funscriptforge.com returned 404 —
  they pointed at zip/tarball names the pipeline stopped producing. The site
  now links the real installers, and its system requirements no longer claim
  macOS and Linux support that had not shipped.

### Changed

- The release publishes whatever platforms actually built. A failure in the
  new macOS or Linux job no longer holds back a working Windows release.

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
