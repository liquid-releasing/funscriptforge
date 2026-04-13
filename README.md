# FunscriptForge

![FunscriptForge](media/funscriptforge-logo-wide.png)

A structure-aware post-processor for funscripts. It analyzes the motion
structure of an existing script, lets you review and tag sections through an
interactive UI, and generates an improved script with smoother defaults,
expressive performance sections, and gentle breaks.

---

## eTransforms — Estim Character

FunscriptForge now includes an **eTransforms** tab — the bridge between funscript editing and estim output generation.

Pick a character for the estim output. Each one controls how sensation moves and builds over time.

| Character | What it means |
|---|---|
| **Gentle** | Soft, slow-building. Narrow arc, soft pulse onset. Good for intimate or slow content. |
| **Reactive** | Sharp, tracks action closely. Wide arc, instant response. Good for fast, intense content. |
| **Scene Builder** | Builds gradually over the scene. Circular arc, slow ramp. Rewards patience. |
| **Unpredictable** | Random direction changes, varied character. Keeps you guessing. |
| **Balanced** | Middle of everything. Good starting point for any content. |

Each character shows 1–2 contextual sliders most relevant to its personality, a live electrode path preview, and a plain-English "What you'll feel" summary.

### Integration with funscript-tools

The eTransforms tab connects directly to [funscript-tools](https://github.com/liquid-releasing/funscript-tools). The same five characters appear in both tools — pick a character in FunscriptForge, and funscript-tools applies it to generate the alpha / beta / pulse_frequency estim outputs.

The **character name is the API** between all three tools: Explorer analysis → FunscriptForge transforms → funscript-tools eTransform → restim playback.

> **Current scope:** eTransforms apply globally to the full funscript. Per-section (phrase-level) character support is the next milestone.

---

## Features

### Workflow — 9 Tabs

FunscriptForge guides you through a structured workflow. Each tab builds on the previous one:

| Tab | Purpose |
|-----|---------|
| **Project** | Load funscript, set output folder, add media (video/audio/captions), author info |
| **Device** | Select target devices (Handy, OSR2, E-Stim FOC/Stereo, Generic/Intiface), apply device awareness |
| **Tone** | Apply a global mood — 6 tones from Tender to Dominant, with contextual sliders |
| **Phrases** | Per-phrase editing with transforms, live preview, Before/After charts |
| **Patterns** | Batch transforms by behavioral tag across all matching phrases |
| **Catalogs** | Reference guide: Behavior, Structural, Replacement, Tone, Stim, and Tag catalogs |
| **Stim** | E-stim character selection (Gentle, Reactive, Scene Builder, Unpredictable, Balanced) |
| **Export** | Quality gate, transform plan, device-specific folder export |
| **Next Steps** | Playback guides per device, credits, license |

State flows through the chain: **Original → Device → Tone → Phrases → Export**

### Project Tab

- Load `.funscript` file, set output folder, optional media (video, audio, captions)
- Author and credits metadata
- Project summary with Accept button to initialize the pipeline
- `.forge` project files for save/resume — pick up where you left off

### Device Tab

- Select target devices: Handy, OSR2, E-Stim FOC, E-Stim Stereo, Generic/Intiface
- Device limits table shows combined constraints and which device is the bottleneck
- Minimum-fix algorithm: analyzes violations, clamps only what exceeds limits, preserves the rest
- Side-by-side preview: Original vs Device Aware, plus full-width result chart with stats
- Intensity spikes slider for estim: None / Rare / Moderate / Frequent — allows occasional full-range cycles
- Everything downstream (Tone, Phrases) works on the device-aware baseline

### Tone Tab

- 6 tones ordered by intensity: Tender → Build → Tease → Edge → Climax → Dominant
- Dual suggestions: "Best match" and "Most variety" based on funscript analysis
- Variable slider count per tone (2–4 contextual sliders from sensitivity matrix)
- Impact slider (0–1) scales the overall tone effect
- Before/After preview reads from the device-aware chain
- Credit to [Edger's Funscript-Tools](https://github.com/edger477/funscript-tools)

### Analysis

- Structural analysis: phases → cycles → patterns → phrases → BPM transitions
- Behavioral classification into 10 tags (stingy, giggle, plateau, drift, half-stroke, drone, lazy, frantic, ramp, ambient)
- Duration-based phrase splitting for uniform-tempo funscripts
- Real-time progress indicator shows each pipeline stage as it runs
- Cross-funscript pattern catalog — accumulates stats across all analysed files

### Phrase Editor

- Full-funscript colour-coded chart with white phrase bounding boxes; click any phrase to edit
- **Tone category first** in transform picker — all 6 tones available per-phrase with Impact slider
- Behavior, Structural, and Plugin categories follow
- Auto-accept workflow: Prev/Next/Done navigation auto-accepts the current transform
- Cancel reverts all changes for the phrase to entry state
- Phrases Accept button saves all edits to chain with green guidance for next steps
- Cycle-based phrase split and Concat with Next Phrase
- **Large-file phrase highlight** — selected phrase renders with full velocity colour over grey background

### Pattern Editor

- Select phrases by behavioral tag; view all matching instances at once
- Per-instance transform + per-segment split with independent transforms per sub-range
- "Suggested transform" shown per tag; Apply to all copies to every matching instance
- Selector chart reflects accepted transforms in real time

### Audio / Video Player

- Phrase-restricted HTML5 player — plays only the currently selected phrase window
- Animated red playhead overlaid on the waveform chart; Back 5 s / Forward 5 s controls
- **Set split here** — click during playback to send timestamp to Pattern Editor as a split point
- Local mode: media streams from disk at full quality (no upload, no size limit)
- Magic-byte validation on 9 supported types (MP3, MP4, M4A, MOV, WAV, OGG, WebM, MKV, AAC)

### Catalogs Tab

Six catalog sections in one reference tab:

- **Behavior** — amplitude shaping, position adjustment, smoothing, break/recovery, performance, rhythmic patterns
- **Structural / Tempo** — tempo reduction transforms
- **Replacement** — generated shapes (stroke, drift, tide)
- **Tone Catalog** — all 6 tones with intensity levels, slider descriptions, summary table
- **Stim Catalog** — all 5 e-stim characters with path shapes, slider descriptions, summary table
- **Tag Catalog** — all 10 behavioral tags with characteristics, suggested transforms, before/after charts

Each entry includes live interactive sliders and preview charts.

### Export

- Device-specific folder export (e.g. `output/handy/`, `output/estim-foc/`)
- Before/After overlay — toggle to see what transforms changed
- Quality gate — velocity and short-interval checks; pass/fail badge
- Export log — `_forge_log` key records every transform for reproducibility
- Media copy — input video/audio/captions copied to output folder
- Open folder button (platform-native file explorer)

### Undo / Redo

- 50-level undo/redo stack for accepted transforms
- Keyboard shortcuts: `Ctrl+Z` undo, `Ctrl+Y` / `Ctrl+Shift+Z` redo, `Ctrl+S` save
- Sidebar ↩ Undo / ↪ Redo buttons with operation-label tooltips

### Privacy

- Runs entirely on your machine — no account, no cloud sync, no telemetry
- Your funscripts, media files, and edits never leave your computer

### Accessibility

- WCAG 2.1 Level AA — all Critical items and five of seven Major items resolved
- Keyboard shortcut support throughout; screen-reader labels on all interactive elements

### CLI

- `assess`, `transform`, `customize`, `pipeline` — full analysis and transform pipeline
- `phrase-transform` — apply any catalog transform to individual phrases from the command line
- `finalize` — blend seams + final smooth as standalone post-processing
- `export-plan` — mirror of the UI Export tab; supports `--apply` to write output directly
- `catalog` — query and manage the cross-funscript pattern catalog
- `validate-plugins` — validate JSON recipe files and report Python plugin gate status without starting the app
- `meta` — auto-derive pace, intensity, arc, mood, Hub tags, and tone suggestion from a funscript
- `suggest-tone` — print the auto-suggested Tone label and rationale
- `beats` — extract beat timestamps from a video file; writes `_beats.json` + `_beats.csv`
- `parse-captions` — parse SRT or WebVTT captions; writes `_captions.json`
- `test` — run all tests

---

## User workflow

### 1 — Analyze

The analyzer reads a `.funscript` file and detects its motion structure,
working through five stages:

```text
actions → phases → cycles → patterns → phrases → BPM transitions
```

- **Phases** — individual up, down, or flat direction segments
- **Cycles** — one complete oscillation (one up + one down phase)
- **Patterns** — cycles with the same direction sequence and similar duration
- **Phrases** — consecutive runs of the same pattern, each with a BPM value
- **BPM transitions** — points where tempo changes significantly between phrases

The output is a single JSON file capturing the full structural picture.

### 2 — Review in the UI

Open the Streamlit app and load your funscript. The **Assessment** tab shows
the full pipeline output — a colour-coded phrase timeline, BPM transitions
table, and drill-down detail for patterns and phases.

The **Phrase Editor** tab shows the full funscript as a colour-coded chart
with phrase bounding boxes.  Click any phrase to open its detail panel where
you can select a transform, tune its parameters with live sliders, and see a
Before / After preview.  Use **Apply to all** to copy the same transform to
every instance of the same behavioral tag.

The **Pattern Editor** tab lets you fix behavioral issues phrase by phrase.
Each phrase instance shows an original chart and a live preview as you adjust
transforms.  For phrases that span a long section (e.g. a single pattern
covering most of the file), you can **split** the phrase into non-overlapping
sub-ranges and apply a different transform to each one.  Split boundaries
are shown as dashed lines on both charts.  Use **Apply to all** to copy the
split structure — scaled proportionally — to every other instance of the same
behavioral tag.

The **Catalogs** tab has six sections:

- **Behavior** — transforms that reshape amplitude, position, smoothing, rhythm
- **Structural / Tempo** — tempo reduction transforms
- **Replacement** — generated shapes (stroke, drift, tide)
- **Tone Catalog** — all 6 tones with intensity, sliders, summary table
- **Stim Catalog** — all 5 e-stim characters with path shapes, sliders, summary table
- **Tag Catalog** — all 10 behavioral tags with characteristics, suggested transforms, before/after charts

### 3 — Export

The **Export** tab aggregates every transform applied across the workflow.
Device-specific folders are created automatically (e.g. `output/handy/`, `output/estim-foc/`).

**Tag-aware auto-suggestions** (`suggest_transform`, checked in priority order):

| Tag | Suggested transform | Notes |
| --- | --- | --- |
| `frantic` | `halve_tempo` | BPM > 200 |
| `giggle`, `plateau`, `lazy` | `amplitude_scale` | Amplify; scale computed to target peak hi ≈ 65 |
| `stingy` | `amplitude_scale` | Reduce; scale computed to target peak hi ≈ 65 |
| `drift`, `half_stroke` | `recenter` | `target_center = 50` |
| `drone` | `beat_accent` | Adds rhythmic variation |
| `ramp` | `funnel` | Progressive center shift + amplitude scaling for energy arc shaping |
| `ambient` | `waiting` | Low BPM + shallow amplitude + long duration |

Post-processing: blend seams (bilateral LPF at style boundaries) and final smooth (light global LPF).

### 4 — Transform and customize

After reviewing in the UI, run the full pipeline to produce the final funscript.

#### Option A — in the browser (Export tab)

Open the **Export** tab and expand **"Run full pipeline — BPM Transformer + Window Customizer"**.
Adjust the BPM threshold and amplitude scale sliders, toggle whether to apply your Work Item
windows, then click **▶ Run Pipeline**. Download the result with
**⬇ Download pipeline result**.  This is independent of any phrase-editor transforms and
produces a `_pipeline.funscript` file with an embedded `_forge_log`.

#### Option B — command line

```bash
# Step 1 — analyze (or use the UI; it saves a cached JSON automatically)
python cli.py assess input.funscript --output output/assessment.json

# Step 2 — transform (BPM-threshold baseline)
python cli.py transform input.funscript \
    --assessment output/assessment.json \
    --output output/transformed.funscript

# Step 3 — customize (apply your tagged windows)
python cli.py customize output/transformed.funscript \
    --assessment output/assessment.json \
    --perf output/input.performance.json \
    --break output/input.break.json \
    --raw output/input.raw.json \
    --output output/final.funscript

# Or run both steps at once
python cli.py pipeline input.funscript --output-dir output/
```

---

## System requirements

> **Privacy first.** FunscriptForge runs entirely on your machine.
> Your funscripts, media files, and edits never leave your computer — no account,
> no cloud sync, no telemetry.  The app opens in your local browser but only
> talks to itself.

These requirements apply whether you install the **packaged app** (Windows `.exe` / macOS `.dmg`) or run from source.

### Minimum

| | Windows | macOS |
| --- | --- | --- |
| **OS** | Windows 10 64-bit (build 1903+) | macOS 11 Big Sur |
| **CPU** | Any 64-bit dual-core x86 | Intel Core i5 or Apple Silicon (M1+) |
| **RAM** | 4 GB | 4 GB |
| **Free disk** | 500 MB (app only) | 500 MB (app only) |
| **Browser** | Chrome 90+, Edge 90+, Firefox 88+ | Chrome 90+, Firefox 88+, Safari 15+ |
| **Display** | 1920 × 1080 (1080p) minimum | Functional but requires scrolling in the Phrase Editor — QHD strongly recommended |

> **Safari note:** Safari cannot play MKV files. Use Chrome or Firefox if your media is `.mkv`.

### Recommended (production funscripts)

| Resource | Recommendation | Why |
| --- | --- | --- |
| **RAM** | 8 GB+ | Long funscripts (1+ hour) load the full action list into memory |
| **CPU** | 4-core, 3 GHz+ | Assessment runs single-threaded; faster clock speed = faster analysis |
| **Free disk** | 10 GB+ | Media files stay on disk during editing and are never modified — allow room for originals plus exports |
| **Display** | 2560 × 1440 (QHD) or larger | The Phrase Editor and Pattern Editor use a 3-column layout with an embedded media player. QHD (1440p) provides enough vertical space to show the player, waveform chart, action chart, and transform panel without scrolling. 1080p screens will require scrolling and are not recommended. |

### Internet connection

An internet connection is **only required once, during installation**.
After that the app runs **completely offline** — no calls home, no updates in the background.

#### Packaged installer (Windows `.exe` / macOS `.dmg`)

Download one file from the release page. Everything is bundled — no Python, no pip, no further setup.
The installer itself is the only download required.

#### Running from source

| What is downloaded | From | Approx. size |
| --- | --- | --- |
| Python packages via `pip` | [pypi.org](https://pypi.org) | ~150 MB total |
| ↳ `streamlit` (UI framework) | pypi.org/project/streamlit | ~50 MB with dependencies |
| ↳ `pandas`, `plotly`, `matplotlib` (data + charts) | pypi.org | ~75 MB combined |
| Plotly JS bundle (media player waveform chart) | [cdn.plot.ly](https://cdn.plot.ly) | ~3.5 MB |

**Troubleshooting source install failures:**

- `pip install` fails → check that `pypi.org` is reachable; if you are behind a proxy try `pip install --index-url https://pypi.org/simple/ -r requirements.txt`
- Python version error → requires Python 3.10–3.13 **64-bit**; run `python --version` to confirm
- pip itself is outdated → run `python -m pip install --upgrade pip` first
- Plotly JS download fails → check that `cdn.plot.ly` is reachable; or download `plotly-2.27.0.min.js` manually from `https://cdn.plot.ly/plotly-2.27.0.min.js` and copy it to `ui/streamlit/components/audio_player/frontend/`

---

## Getting started (running from source)

### Install

```bash
pip install -r requirements.txt
pip install -r ui/streamlit/requirements.txt
```

Download the bundled Plotly JS library (one-time, ~3.5 MB):

```bash
python -c "
import urllib.request
urllib.request.urlretrieve(
    'https://cdn.plot.ly/plotly-2.27.0.min.js',
    'ui/streamlit/components/audio_player/frontend/plotly-2.27.0.min.js'
)
print('Plotly downloaded.')
"
```

After this step the app runs fully offline — no internet connection required.

### Launch the UI

```bash
# Desktop launcher (recommended) — starts local HTTP media server for audio/video streaming
python launcher.py

# Or run directly (web/upload mode)
streamlit run ui/streamlit/app.py
```

Opens at `http://localhost:8501`. Select a funscript from the sidebar and
click **Load / Analyse** to see the assessment results immediately.

The desktop launcher enables local mode: file paths are entered directly, recent files are
remembered across sessions, and audio/video streams from disk with no upload or size limit.
The launcher also works correctly as a PyInstaller frozen executable — writable data
(`output/`, pattern catalog) is stored beside the executable, not in the read-only bundle.

### Analyze from the command line

```bash
python cli.py assess path/to/file.funscript --output output/assessment.json
```

---

## Demo resources

**Big Buck Bunny** (Blender Foundation, 2008) is a recommended safe-for-work test video for
trying the audio/video player feature.  Community funscript sites carry demo scripts that pair
with it, making it easy to exercise the Phrase Editor, Pattern Editor, and media player without
needing private content.

The Blender Foundation released the video under the
[Creative Commons Attribution 2.5](https://creativecommons.org/licenses/by/2.5/) license,
so you can use, modify, and share it freely as long as you credit the creators.

> *© 2008 Blender Foundation | [www.bigbuckbunny.org](https://www.bigbuckbunny.org)*

---

## Project structure

```text
funscriptforge/
├── assessment/               # Step 1: structural analysis + behavioral classification
│   ├── analyzer.py           #   FunscriptAnalyzer
│   ├── classifier.py         #   BehavioralTag, TAGS registry, annotate_phrases
│   └── readme.md
├── catalog/                  # Cross-funscript pattern catalog
│   └── pattern_catalog.py    #   PatternCatalog (persistent JSON)
├── pattern_catalog/          # Step 2: BPM-threshold baseline transform
│   ├── transformer.py        #   FunscriptTransformer
│   ├── phrase_transforms.py  #   TRANSFORM_CATALOG (22 named transforms incl. funnel)
│   └── config.py             #   TransformerConfig
├── user_customization/       # Step 3: window-based fine-tuning
│   ├── customizer.py         #   WindowCustomizer
│   └── config.py             #   CustomizerConfig
├── visualizations/           # Plotly + matplotlib motion chart components
├── ui/                       # All UI code
│   ├── common/               #   Framework-agnostic models and logic
│   │   ├── work_items.py     #   WorkItem + ItemType
│   │   ├── project.py        #   Project session state
│   │   ├── pipeline.py       #   run_pipeline / run_pipeline_in_memory
│   │   └── tests/
│   ├── streamlit/            #   Streamlit app (local + cloud deployable)
│   │   ├── app.py
│   │   └── panels/
│   └── web/                  #   FastAPI + frontend (planned)
├── forge/                    # Forge-layer modules (project, metadata, media analysis)
│   ├── metadata.py           #   derive_metadata() — auto-derive pace/intensity/arc/mood/tags/tone
│   ├── beats.py              #   extract_beats() — PyAV + librosa beat detection
│   ├── captions.py           #   parse_captions() — SRT + WebVTT parser
│   ├── video.py              #   video_stats(), analyze_motion()
│   └── tabs/                 #   Streamlit tab modules (project_tab, tone_tab, export_tab)
├── docs/                     # MkDocs user documentation site (in progress)
├── internal/                 # Internal planning docs (gap analysis, backlogs, build notes)
├── media/                    # App images, logos, icons
├── tests/                    # Core pipeline unit tests
├── models.py                 # Shared dataclasses (Phrase now carries tags + metrics)
├── utils.py                  # Timestamp helpers, low-pass filter, writable_base_dir
├── cli.py                    # CLI entry point
└── requirements.txt
```

---

## CLI reference

```bash
# Assess
python cli.py assess <funscript> [--output <path>] [--config <json>]
                     [--min-phrase-duration SECONDS] [--amplitude-tolerance FRACTION]

# Transform (BPM-threshold baseline)
python cli.py transform <funscript> --assessment <path>
                        [--output <path>] [--config <json>]

# Customize (window-based fine-tuning)
python cli.py customize <funscript> --assessment <path>
                        [--output <path>] [--config <json>]
                        [--perf <json>] [--break <json>] [--raw <json>] [--beats <json>]

# Full pipeline (assess → transform → customize in one step)
python cli.py pipeline <funscript> --output-dir <dir>
                       [--perf <json>] [--break <json>] [--raw <json>] [--beats <json>]
                       [--transformer-config <json>] [--customizer-config <json>]

# Phrase-level transform (applies a catalog transform to individual phrases)
python cli.py phrase-transform <funscript> --assessment <path>
                               --transform smooth --phrase 3 [--param strength=0.25]
                               --transform normalize --all
                               --suggest [--bpm-threshold 120]   # tag-aware auto-pick
                               [--output <path>] [--dry-run]

# Finalize (blend seams + final smooth as post-processing)
python cli.py finalize <funscript> [--output <path>]
                       [--param seam_max_velocity=0.3] [--param smooth_strength=0.05]
                       [--skip-seams] [--skip-smooth]

# Export plan (mirror of the UI Export tab)
python cli.py export-plan <funscript> [--assessment <path>]
                          [--transforms overrides.json] [--no-recommended]
                          [--bpm-threshold BPM] [--format table|json]
                          [--apply] [--output <path>] [--dry-run]

# Catalog
python cli.py catalog [--catalog <path>] [--tag TAG] [--remove FUNSCRIPT] [--clear]

# Validate user-transform plugins (JSON schema check + Python plugin gate status)
python cli.py validate-plugins [--verbose] [--recipes-dir <path>] [--plugins-dir <path>]

# Auto-derive metadata (pace, intensity, arc, mood, Hub tags, tone suggestion)
python cli.py meta <funscript> [--assessment <path>] [--output <json>] [--format table|json]

# Print tone label + rationale only
python cli.py suggest-tone <funscript>

# Extract beat timestamps from video  (requires: pip install av librosa)
python cli.py beats <video> [--audio <override>] [--output-dir <dir>]
# Writes: _beats.json, _beats.csv

# Parse SRT or WebVTT captions
python cli.py parse-captions <file.srt|.vtt> [--output-dir <dir>] [--print]
# Writes: _captions.json

# Utilities
python cli.py visualize <funscript> --assessment <path> [--output <path>]
python cli.py config    [--customizer] [--analyzer] [--output <path>]
python cli.py test
```

---

## Running tests

```bash
# Core pipeline + integration + UI tests
python -m unittest discover -s tests -v

# UI layer
python -m unittest discover -s ui/common/tests -v

# All at once (741 tests)
python cli.py test
```

---

## Documentation

| README | Description |
| --- | --- |
| [assessment/readme.md](assessment/readme.md) | Structural analysis pipeline — phases, cycles, patterns, phrases, BPM transitions (Step 1) |
| [pattern_catalog/README.md](pattern_catalog/README.md) | BPM-threshold baseline transformer (Step 2) |
| [pattern_catalog/EXTENDING_TRANSFORMS.md](pattern_catalog/EXTENDING_TRANSFORMS.md) | Adding custom transforms via JSON recipes or Python plugins; security model |
| [user_customization/README.md](user_customization/README.md) | Window-based fine-tuning customizer (Step 3) |
| [ui/README.md](ui/README.md) | Streamlit UI overview — launcher, local mode, sidebar controls, all four tabs |
| [ui/streamlit/README.md](ui/streamlit/README.md) | Detailed Streamlit panel reference — Phrase Editor, Pattern Editor, Export |
| [ui/streamlit/UNDO.md](ui/streamlit/UNDO.md) | Undo/redo — what is captured, how to use it, architecture, extending it |
| [ui/common/README.md](ui/common/README.md) | Framework-agnostic business logic: `Project`, `WorkItem`, `ViewState` |
| [user_transforms/README.md](user_transforms/README.md) | Adding custom transforms via JSON recipe files |
| [plugins/README.md](plugins/README.md) | Adding custom transforms via Python plugins |
| [visualizations/README.md](visualizations/README.md) | Matplotlib motion chart components |
| [tests/README.md](tests/README.md) | Test suite structure and coverage |
| [internal/ACCESSIBILITY.md](internal/ACCESSIBILITY.md) | WCAG 2.1 AA accessibility assessment — issues, severity, recommended fixes |
| [docs/TONE_TAB_SPEC.md](docs/TONE_TAB_SPEC.md) | Tone tab design spec — the 6 tones, card UI, beat envelopes, caption emotion, data model |
| [docs/AUTO_METADATA_SPEC.md](docs/AUTO_METADATA_SPEC.md) | Auto-derived metadata spec — pace/intensity/arc/mood/tags/tone suggestion |
| [docs/HAPTIC_COMPOSITION_SPEC.md](docs/HAPTIC_COMPOSITION_SPEC.md) | Three-layer haptic composition — base funscript + beats + caption emotion |
| [docs/INSTALL.md](docs/INSTALL.md) | End-user installation guide (Windows) |
| [internal/BUILD.md](internal/BUILD.md) | Building a standalone installer on Windows and macOS |
| [internal/SECURITY.md](internal/SECURITY.md) | Threat analysis (T1–T5), mitigations implemented, Python plugin roadmap decision |

---

![Liquid Releasing](media/liquid-releasing-Color-Logo.svg)

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](LICENSE).  Written by human and Claude AI (Claude Sonnet).*

**FunscriptForge™** is a trademark of Liquid Releasing.
The `.funscript` file format is a community standard not owned by Liquid Releasing.
