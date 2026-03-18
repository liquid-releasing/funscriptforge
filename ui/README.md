# ui — Streamlit UI

Interactive local app for the FunscriptForge pipeline.

## Quick start

```bash
# Install dependencies (once, from the project root)
pip install -r ui/streamlit/requirements.txt

# Desktop launcher (recommended) — opens browser automatically
python launcher.py

# Or run Streamlit directly
streamlit run ui/streamlit/app.py
```

The desktop launcher starts a local media file server alongside Streamlit,
enabling large audio/video files to stream directly without base64 encoding.
The app can also be deployed to Streamlit Community Cloud (web mode).

---

## Welcome screen

Before any funscript is loaded the app shows an onboarding screen with:

- Wide wordmark logo + cinematic banner
- Icon row showing the three main workflow tabs (Phrase Selector, Pattern Editor, Transform Catalog)
- "How to get started" steps and "What the assessment detects" table

---

## Sidebar

The sidebar is always visible.

### File picker

**Local (desktop) mode** — a dropdown lists recently used `.funscript` files.
Type any absolute path to load a file not in the recents list.
The last 20 paths are remembered across sessions in `output/recent_funscripts.json`.

**Web mode** — `st.file_uploader` widget for `.funscript` files.

Selecting a different file or changing any setting triggers an automatic re-assessment.

### Media file

**Local mode** — a path input for the matching audio or video file.
The local media server streams it directly to the browser with no file size limit.
File integrity is checked against magic-byte signatures before loading.

**Web mode** — `st.file_uploader` for audio/video.

### Phrase detection settings

| Control | Default | Effect |
| --- | --- | --- |
| Min phrase length (s) | 20 s | Phrases shorter than this are merged into a neighbour |
| Amplitude sensitivity | Medium (0.30) | How much stroke-depth change triggers a new phrase boundary |

A **Re-analyse** button forces a fresh assessment.

### Chart settings

| Control | Default | Effect |
| --- | --- | --- |
| Fast rendering threshold (actions) | 10,000 | Funscripts above this count use a grey line for speed |
| Transform BPM threshold | 120 | Phrases at/above this BPM receive the Amplitude Scale suggestion |

### Session summary

Once a funscript is loaded, the sidebar shows the file name, duration, average
BPM, phrase count, and BPM-transition count.

### Undo / Redo

**↩ Undo** and **↪ Redo** buttons appear once a project is loaded.
50-level history. Tooltip shows the label of the operation being undone/redone.
See [streamlit/UNDO.md](streamlit/UNDO.md) for full details.

### Add manual item

An expander lets you define a work item by typing start/end times (ms),
choosing a type, and optionally adding a label.

### Export

- **Export window JSONs** — writes `performance.json`, `break.json`, and
  `raw.json` to `output/`, ready for the customizer.
- **Save project** — writes a full project snapshot to `output/<name>.project.json`.

---

## Tabs

### Project (forge tab)

The Project tab is the entry point for creating or resuming a forge project:
upload a funscript, set the export location, attach media (video + audio + captions),
fill in author credits, and click **Continue** to proceed to the Tone tab.

Auto-derived metadata (pace, intensity, arc type, mood, Hub tags, tone suggestion)
is shown in the Author & Credits section once a funscript is loaded.

### 0. Phrase Selector

Full-funscript interactive chart with phrase bounding boxes. Click any phrase
to open the detail panel for transform editing. An **Assessment details**
expander below the chart shows full pipeline output: summary metrics, phrases
table, BPM transitions, behavioral patterns, and phases.

### 1. Pattern Editor

Behavioral pattern batch-fix workspace. Phrases are pre-classified into 8 tags.
A **Pattern Behaviors catalog** expander at the top shows the cross-funscript
catalog (Gantt timeline, tag stats, library aggregate). Below it, the editor
lets you select a tag, navigate instances, apply transforms individually or to
all instances, and split instances into sub-segments.

### 2. Transform Catalog

Reference guide for all 17 phrase transforms grouped by capability.
Each entry shows description, best-fit tags, a parameter table, and
live Before/After charts with interactive sliders.

### 3. Export

Transform change log showing every planned transform with start/end time,
duration, transform name, source, and before → after BPM/cycle count.
Each row has a 🗑 reject button. A **Download edited funscript** button
builds and streams the result. Also accessible via `python cli.py export-plan`.

---

## Subdirectories

| Directory | Contents |
| --- | --- |
| `common/` | Framework-agnostic business logic: `Project`, `WorkItem`, `ViewState`. No Streamlit dependency. See [`common/README.md`](common/README.md). |
| `streamlit/` | Streamlit app entry point (`app.py`) and panel modules. See [`streamlit/README.md`](streamlit/README.md). |

## Tests

```bash
# UI common-layer tests
python -m unittest discover -s ui/common/tests -v

# Full test suite
python cli.py test
```

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).  Written by human and Claude AI (Claude Sonnet).*
