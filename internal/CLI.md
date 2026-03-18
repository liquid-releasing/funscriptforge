# CLI Reference

All pipeline stages and utilities are available through `cli.py`.

```
python cli.py <command> [options]
```

---

## Quick start — full pipeline in one command

```bash
python cli.py pipeline input.funscript --output-dir output/
```

Runs all three stages (assess -> transform -> customize) and writes:

| File | Description |
| --- | --- |
| `output/<name>.assessment.json` | Structural analysis |
| `output/<name>.transformed.funscript` | BPM-threshold transformed |
| `output/<name>.customized.funscript` | Final output |

Optional flags for the pipeline command:

| Flag | Description |
| --- | --- |
| `--output-dir DIR` | Output directory (default: `./output/`) |
| `--perf FILE` | Performance windows JSON |
| `--break FILE` | Break windows JSON |
| `--raw FILE` | Raw-preserve windows JSON |
| `--beats FILE` | Beats JSON (enables beat accents in Stage 3) |
| `--transformer-config FILE` | Custom transformer settings |
| `--customizer-config FILE` | Custom customizer settings |

---

## Individual stage commands

### Step 1 — Assess

Analyze the funscript structure and produce an assessment JSON.

```bash
python cli.py assess input.funscript
python cli.py assess input.funscript --output assessment.json
python cli.py assess input.funscript --config analyzer_config.json
```

Output includes: duration, BPM, action count, phases, cycles, patterns,
phrases, and BPM transitions.

---

### Step 2 — Review (human step)

Open `assessment.json` and inspect `bpm_transitions` and per-phrase BPMs.
Use this to decide which sections need performance, break, or raw windows.

The Streamlit UI (`streamlit run ui/streamlit/app.py`) provides an
interactive way to review and tag sections.

---

### Step 3 — Transform

Apply BPM-threshold transformation.

```bash
python cli.py transform input.funscript --assessment assessment.json
python cli.py transform input.funscript \
    --assessment assessment.json \
    --output transformed.funscript \
    --config transformer_config.json
```

---

### Step 4 — Customize

Apply user-defined performance, break, and raw windows.

```bash
python cli.py customize transformed.funscript --assessment assessment.json
python cli.py customize transformed.funscript \
    --assessment assessment.json \
    --output customized.funscript \
    --config customizer_config.json \
    --perf performance.json \
    --break break.json \
    --raw raw.json \
    --beats beats.json
```

Window JSON format (the `"config"` key is optional):

```json
[
  {
    "start": "00:01:10.000",
    "end": "00:01:25.000",
    "label": "chorus",
    "config": { "max_velocity": 0.28 }
  }
]
```

---

## Visualization

Requires `matplotlib` (`pip install matplotlib`).

```bash
python cli.py visualize input.funscript --assessment assessment.json
python cli.py visualize input.funscript \
    --assessment assessment.json \
    --output motion.png
```

---

## Config — dump default settings to JSON

```bash
# Transformer config (Stage 3)
python cli.py config --output transformer_config.json

# Customizer config (Stage 4)
python cli.py config --customizer --output customizer_config.json

# Analyzer config (Stage 1)
python cli.py config --analyzer --output analyzer_config.json
```

Edit the generated JSON, then pass it back with `--config` (or
`--transformer-config` / `--customizer-config` for the `pipeline` command).

---

## Forge metadata

### `meta` — auto-derive project metadata

```bash
python cli.py meta input.funscript
python cli.py meta input.funscript --format json
python cli.py meta input.funscript --output metadata.json
python cli.py meta input.funscript --assessment assessment.json   # reuse cached assessment
```

Derives from the funscript + assessment (runs a fresh assessment if none provided):

| Field | Source | Values |
| --- | --- | --- |
| Pace | Average BPM across phrases | Slow / Medium / Fast / Intense |
| Intensity | `avg_speed` from stats | Low / Medium / High / Extreme |
| Stroke depth | `max_pos − min_pos` position range | Shallow / Mid / Deep / Full |
| Duration category | `duration_s` | Short / Medium / Long / Feature |
| Dominant mood | Most frequent phrase tone tag | Build / Climax / Tease / Edge / Tender / Dominant |
| Arc type | BPM shape across thirds of the script | Climactic / Building / Episodic / Flat / Short |
| Variety | Count of distinct tone tags | Focused / Varied / Complex |
| Auto Hub tags | All of the above combined | e.g. `pace:fast`, `mood:tease`, `arc:building` |
| Tone suggestion | Derived from arc + mood + intensity | One of the 6 Tone labels |
| Tone rationale | Human-readable explanation | e.g. "Suggested based on: dominant mood tease" |

### `suggest-tone` — tone label only

```bash
python cli.py suggest-tone input.funscript
```

Prints two lines, e.g.:
```
Tone suggestion: Tease
Rationale:       Suggested based on: dominant mood tease
```

---

## Media analysis

### `beats` — beat detection from video

Requires `av` and `librosa`:

```bash
pip install av librosa
```

```bash
python cli.py beats path/to/video.mp4
python cli.py beats path/to/video.mp4 --output-dir output/
python cli.py beats path/to/video.mp4 --audio path/to/override.wav
```

Extracts audio from the video via PyAV (no external FFmpeg binary required), runs
`librosa.beat.beat_track()`, and writes two files to the output directory:

| File | Contents |
| --- | --- |
| `_beats.json` | `source_path`, `bpm_estimate`, `beat_times` (seconds), `beat_count` |
| `_beats.csv` | `beat_index`, `time_s`, `bpm_estimate` — one row per beat |

### `parse-captions` — SRT / WebVTT parser

```bash
python cli.py parse-captions path/to/captions.srt
python cli.py parse-captions path/to/captions.vtt --output-dir output/
python cli.py parse-captions path/to/captions.srt --print       # also print all cues to stdout
```

Supports `.srt` (SubRip) and `.vtt` (WebVTT). Strips HTML/VTT markup tags.
Writes `_captions.json` — an array of objects with `index`, `start`, `end`
(human-readable timestamps), `start_ms`, `end_ms`, and `text`.

---

## Tests

Run all tests (core pipeline + CLI + UI common layer):

```bash
python cli.py test
```

Or via unittest directly:

```bash
# Core + CLI tests
python -m unittest discover -s tests -v

# UI common-layer tests only
python -m unittest discover -s ui/common/tests -v
```

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](LICENSE).  Written by human and Claude AI (Claude Sonnet).*
