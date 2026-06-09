# Changelog

All notable changes to FunscriptForge are recorded here.

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
