# Export tab — SHIPPED 2026-04-11

The export folder restructure landed. The Export tab now owns device
selection (two groups: Mechanical + Estim) and writes a self-contained
folder with a top-level base + `mechanical/` + `estim/` subfolders.

Audio synthesis is **deferred** to its own PR. See
`memory/project_funscriptforge_audio.md` for the audio plan.

## What shipped

### Device selection moved to Export tab

Two checkbox groups instead of the old single flat list on the Device tab:

- **Mechanical** — single checkbox covering Handy, OSR2, generic/Intiface.
  All three load the same single 1D funscript so one checkbox enables
  the whole group. Limits driven by The Handy (most restrictive).
- **Estim** — five separate checkboxes:
  - Audio 3-phase — continuous (legacy 2b/312)
  - Audio 3-phase — pulse (Tingler/ZC) *(default)*
  - FOC-Stim — 3-phase
  - FOC-Stim — 4-phase
  - NeoStim — 3-phase

For this PR the contents of `estim/` are identical regardless of which
estim device is checked. The per-device checkboxes become load-bearing
in the future audio PR.

### Folder layout

```text
{output_folder}/
  {stem}.funscript            ← top-level base (always)
  {stem}.heatmap.png          ← velocity-colored heatmap (always)
  {stem}.<media>              ← copied media + audio + captions
  {stem}.forgetmpl            ← workflow template
  mechanical/                 ← only if mechanical device selected
    {stem}.funscript
  estim/                      ← only if any estim device selected
    {stem}.funscript
    {stem}.alpha.funscript
    … all channel files funscript-tools produces …
```

Mechanical-only export skips funscript-tools entirely (fast).
Estim-only export omits `mechanical/`.

### Three sources for `estim/` channel files

The first that exists wins:

1. **Stim Accept files** at the output root → moved into `estim/` as-is.
2. **Stim character preset configured** → run `funscript_tools.process()`
   with the preset against the base funscript.
3. **No Stim preset** → run `funscript_tools.process_with_default_config()`
   (edger's defaults). User skips Stim tab entirely and still gets full
   channel set.

### Heatmap PNG

Velocity-colored heatmap of the main funscript written to
`{stem}.heatmap.png` at the top level using
`forge_ui_components.funscript_chart.static.render_static_chart`.

### Device tab simplification

Device tab no longer owns device selection — it shows a read-only
summary of what was picked on the Export tab and computes limits +
device-aware fixes from there.

## Tests

13 new tests in `tests/test_export_layout.py` and
`tests/test_funscript_tools_adapter.py`. Total: 951 passed, 3 skipped.

Coverage:

- `_split_targets()` for empty / mechanical-only / estim-only / mixed /
  unknown-keys / all-five-estim cases
- `MECHANICAL_KEYS` constant lock
- `ESTIM_DEVICES` ordering
- `_write_heatmap_png()` produces a valid PNG (header check + size)
- `_write_heatmap_png()` handles empty actions list
- `process_with_default_config` is callable + signature compatible

## Backlog (deferred)

### Audio generation

Owns its own planning doc: `memory/project_funscriptforge_audio.md`.
Three integration paths considered (shell out to restim CLI / extract
synthesis into FunscriptForge module / defer). C chosen for now.

### Pipeline-script feature

PowerShell or bash script generated alongside `.forgetmpl` that
reproduces the export with the same settings. Use case: rinse-and-repeat
on similar funscripts. Likely extends `.forgetmpl` or generates a sibling
file. Not started.

### Multi-axis mechanical

Today the mechanical folder has one funscript. When a multi-axis pipeline
exists, additional files like `{stem}.roll.funscript`, `{stem}.pitch.funscript`,
etc. land in `mechanical/` naturally. Layout supports it; nothing to build
yet.

### Update internal/diagrams.md

The original spec called this out as a TODO. Still TODO.

### Per-channel heatmaps

Considered. Decided against — heatmap on the main funscript only.
Channel files are intermediate artifacts, not user-facing.
