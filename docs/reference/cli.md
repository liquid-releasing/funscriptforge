# CLI Reference

Every FunscriptForge pipeline stage is available from the command line. Use the CLI for batch processing, automation, or when you want to run specific stages without the UI.

---

## Setup

The CLI requires Python and the project dependencies:

```bash
pip install -r requirements.txt
```

All commands are run via `cli.py` from the project root:

```bash
python cli.py <command> [options]
```

---

## Quick start — full pipeline

Run the complete pipeline on a single funscript in one command:

```bash
python cli.py pipeline myvideo.funscript --output-dir output/
```

This runs all stages and writes:

- `output/myvideo.assessment.json` — structural analysis
- `output/myvideo.transformed.funscript` — BPM-threshold baseline transforms applied
- `output/myvideo.customized.funscript` — window customization applied (if windows provided)

---

## Commands

### `assess`

Analyze a funscript and write the assessment JSON.

```bash
python cli.py assess input.funscript --output output/assessment.json
```

**Options:**

| Option | Description |
| --- | --- |
| `--output PATH` | Where to write the assessment JSON (required) |
| `--min-phrase-ms N` | Minimum phrase duration in ms (default: 5000) |
| `--amplitude-sensitivity N` | Amplitude change threshold for phrase detection (default: 15) |

**Example — re-assess with tighter phrase detection:**

```bash
python cli.py assess myscript.funscript \
    --output output/myscript.assessment.json \
    --min-phrase-ms 3000 \
    --amplitude-sensitivity 10
```

---

### `transform`

Apply BPM-threshold baseline transforms to a funscript.

```bash
python cli.py transform input.funscript \
    --assessment output/assessment.json \
    --output output/transformed.funscript
```

**Options:**

| Option | Description |
| --- | --- |
| `--assessment PATH` | Assessment JSON from `assess` (required) |
| `--output PATH` | Output funscript path (required) |
| `--bpm-threshold N` | BPM above which high-energy transforms are used (default: 120) |

---

### `phrase-transform`

Apply a specific transform to one or more phrases.

```bash
# Apply smooth to phrases 4 and 5
python cli.py phrase-transform input.funscript \
    --assessment output/assessment.json \
    --transform smooth \
    --phrase 4 --phrase 5 \
    --output output/edited.funscript

# Apply normalize to all phrases
python cli.py phrase-transform input.funscript \
    --assessment output/assessment.json \
    --transform normalize \
    --all \
    --output output/edited.funscript
```

**Options:**

| Option | Description |
| --- | --- |
| `--assessment PATH` | Assessment JSON (required) |
| `--transform KEY` | Transform key (e.g. `smooth`, `amplitude_scale`, `halve_tempo`) |
| `--phrase N` | Phrase index to transform (repeatable) |
| `--all` | Apply to all phrases |
| `--param KEY=VALUE` | Transform parameter (repeatable) |
| `--output PATH` | Output funscript path (required) |
| `--dry-run` | Preview the result without writing output |

**Example — scale all phrases with a custom parameter:**

```bash
python cli.py phrase-transform myscript.funscript \
    --assessment output/myscript.assessment.json \
    --transform amplitude_scale \
    --all \
    --param scale=1.4 \
    --output output/myscript.scaled.funscript
```

**Example — dry run to preview a transform:**

```bash
python cli.py phrase-transform myscript.funscript \
    --assessment output/myscript.assessment.json \
    --transform halve_tempo \
    --all \
    --dry-run
```

Dry run prints a summary of what would change (BPM before/after, cycle count, etc.) without writing any file.

---

### `customize`

Apply user-defined time windows to a funscript.

```bash
python cli.py customize transformed.funscript \
    --assessment output/assessment.json \
    --perf performance.json \
    --break break.json \
    --raw raw.json \
    --beats beats.json \
    --output output/customized.funscript
```

**Options:**

| Option | Description |
| --- | --- |
| `--assessment PATH` | Assessment JSON (required) |
| `--perf PATH` | Performance window JSON |
| `--break PATH` | Break window JSON |
| `--raw PATH` | Raw (bypass) window JSON |
| `--beats PATH` | Beats window JSON |
| `--output PATH` | Output funscript path (required) |

**Window JSON format:**

```json
[
  {"start": "00:01:24.300", "end": "00:02:10.000"},
  {"start": "00:02:45.000", "end": "00:03:30.500"}
]
```

---

### `visualize`

Generate a matplotlib visualization of the funscript structure.

```bash
python cli.py visualize input.funscript \
    --assessment output/assessment.json \
    --output output/motion.png
```

**Options:**

| Option | Description |
| --- | --- |
| `--assessment PATH` | Assessment JSON (required) |
| `--output PATH` | Output image path (.png) |
| `--width N` | Image width in pixels (default: 1920) |
| `--height N` | Image height in pixels (default: 400) |

---

### `list-transforms`

List all available transforms.

```bash
# Brief list
python cli.py list-transforms

# With parameter details
python cli.py list-transforms --verbose

# JSON output for scripting
python cli.py list-transforms --format json
```

**Example brief output:**

```text
passthrough          Passthrough — no change
amplitude_scale      Amplitude Scale — stretch/compress stroke depth
range                Range — remap into a target band (fit or compress)
smooth               Smooth — low-pass filter
halve_tempo          Halve Tempo — keep every other cycle
hero_beat            Hero Beat — 8-step per-beat depth sequencer
nudge                Nudge — shift phrase forward/backward in time
...
```

---

### `config`

Dump the default configuration for a pipeline stage.

```bash
# Transformer config
python cli.py config --output output/transformer_config.json

# Analyzer config
python cli.py config --analyzer --output output/analyzer_config.json
```

Edit the output file and pass it back to override defaults.

---

### `refresh`

Re-render a project's outputs — every device station you stamped in Polish,
then the `.forge` bundle — without re-authoring anything. Use it after
updating FunscriptForge, or after editing a chapter/tone/event without
re-exporting.

```bash
# What in this library needs updating? (changes nothing)
python cli.py refresh "D:/my-library" --check

# Update one project
python cli.py refresh "D:/my-library/scene/scene.funscript"

# Update everything that needs it
python cli.py refresh "D:/my-library"
```

| Option | What it does |
| --- | --- |
| `--check` | Report state as JSON and exit. Changes nothing. |
| `--all` | Include projects that are already current (with `--check`), or re-render them anyway. |
| `--export-only` | Skip re-stamping the stations and only rebuild the bundle. See the warning below. |
| `--out PATH` | Write the bundle somewhere other than in place. |
| `--media PATH` | Override the media file used for thumbnails. |

The bundle is replaced **in place**, keeping its filename, and inherits the
options that built the previous one — so a refresh cannot ship less than it
replaced. Your funscript and authoring sidecars are read, never rewritten.

!!! warning "`--export-only` does not pick up generation changes"
    Export is a packager: stamped station files are copied from disk as-is.
    `--export-only` therefore produces a new bundle containing old channel
    files. Use it only when the packaging step itself changed. The default
    (no flag) re-stamps each station first, which is what you want after an
    app update.

Accepts a single `.funscript` path or a folder to walk.

---

### `project-status`

Report one project's output state as JSON. This is what the app's
"your device files are out of date" prompt reads.

```bash
python cli.py project-status "D:/my-library/scene/scene.funscript"
```

`state` is one of:

| Value | Meaning |
| --- | --- |
| `current` | Outputs match this build **and** your latest edits. |
| `stale` | A newer version would produce different files. |
| `behind` | Right version, but the outputs predate your own edits. |
| `never-exported` | No bundle yet. Normal while authoring — not a problem. |

`reasons` carries the user-facing explanation for each item, so a caller can
show why it matters rather than just reporting a version mismatch.

---

### `validate-plugins`

Validate all JSON recipes in `user_transforms/` and report the plugin gate status.

```bash
python cli.py validate-plugins
```

**Example output:**

```text
JSON recipe validation
  user_transforms/my_recipe.json        OK
  user_transforms/broken_recipe.json    ERROR: unknown transform key 'frobulate'

Python plugin gate: DISABLED
  Set FUNSCRIPT_PLUGINS_ENABLED=1 to enable plugins/
  Plugins found: plugins/my_plugin.py (skipped)
```

---

### `test`

Run the full test suite.

```bash
python cli.py test
```

Runs all unit tests against the core pipeline. Use this after changing transform code or assessment logic to catch regressions.

---

## Batch processing

Process an entire directory of funscripts:

```bash
for f in scripts/*.funscript; do
    name=$(basename "$f" .funscript)
    python cli.py assess "$f" --output "output/${name}.assessment.json"
    python cli.py phrase-transform "$f" \
        --assessment "output/${name}.assessment.json" \
        --transform amplitude_scale \
        --all \
        --param scale=1.3 \
        --output "output/${name}.improved.funscript"
done
```

---

## Transform keys

Use these keys with `--transform` in `phrase-transform`:

| Key | Name |
| --- | --- |
| `passthrough` | Passthrough |
| `amplitude_scale` | Amplitude Scale |
| `range` | Range |
| `recenter` | Recenter |
| `invert` | Invert |
| `smooth` | Smooth |
| `blend_seams` | Blend Seams |
| `beat_accent` | Beat Accent |
| `funnel` | Ramp |
| `performance` | Performance |
| `halve_tempo` | Halve Tempo |
| `hero_beat` | Hero Beat |
| `nudge` | Nudge |
| `stroke` | Stroke |
| `waiting` | Waiting |
| `tide` | Tide |
| `drift` | Drift |
| `tame` | Tame |

**Consolidated aliases** — still accepted by `--transform` (so older scripts and saved recipes keep working) but no longer shown in the picker: `normalize`, `clamp_upper`, `clamp_lower` → use `range`; `boost_contrast` → `amplitude_scale`; `shift` → `recenter`; `final_smooth` → `smooth`; `break` → `amplitude_scale` + `smooth`; `three_one` → `hero_beat`.

---

## Related

- [Updating a Project →](../guide/updating-a-project.md) — the `refresh` workflow in the app
- [Transforms →](../guide/transforms.md) — what every transform does
- [Concepts →](../concepts.md) — pipeline vocabulary
