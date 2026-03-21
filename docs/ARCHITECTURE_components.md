# Architecture: Shared Component Library

## Overview

FunScriptForge uses [forge-ui-components](https://github.com/liquid-releasing/forge-ui-components) as a shared component library. Components follow a two-layer pattern: framework-agnostic `core.py` (pure Python, testable without Streamlit) and thin `streamlit.py` render layer.

This separation enables:
- Reuse across FunScriptForge, SyncPlayer, forgegen, and future apps
- Migration to React/Tauri v2 by replacing only the render layer
- Testing core logic without UI framework dependencies

## Dependency Graph

```
FunScriptForge (ui/streamlit/app.py)
│
├── forge-ui-components          ← shared UI components
│   ├── funscript_chart          ← Plotly charts (mono + vibrant)
│   ├── file_picker              ← upload, guard, clear, stats
│   ├── beat_bar                 ← wraps videoflow AudioBeatMap
│   └── project_status           ← sidebar dashboard
│
├── videoflow (xolvco)           ← beat analysis, scene detection
│   └── audio.AudioBeatMap       ← BPM, beats, downbeats, phrases, energy
│
├── media-tools (xolvco)         ← ffmpeg probe, audio extraction, video ops
│   └── probe.ProbeResult        ← (future: replace pymediainfo)
│
└── visualizations/              ← backward-compat shims → forge-ui-components
    ├── chart_data.py            ← re-exports from funscript_chart.core
    └── funscript_chart.py       ← FunscriptChart wrapper → vibrant_figure()
```

## What Moved Where

### funscript_chart

| Before (FunScriptForge) | After (forge-ui-components) |
|---|---|
| `project_tab._funscript_chart()` | `funscript_chart.streamlit.render_monochrome()` |
| `project_tab._funscript_stats_row()` | `funscript_chart.streamlit.render_stats_row()` |
| `device_tab._plot_device()` | `funscript_chart.streamlit.render_monochrome_from_arrays()` |
| `tone_tab._plot_funscript()` | `funscript_chart.streamlit.render_monochrome_from_arrays()` |
| `visualizations/chart_data.py` (274 lines) | `funscript_chart.core` (PointSeries, colors, slicing) |
| `visualizations/funscript_chart.py` (315 lines) | `funscript_chart.core.vibrant_figure()` |

FunScriptForge's `visualizations/` directory is now thin backward-compat shims that re-export from the component library.

### file_picker

All 4 file uploaders in `project_tab.py` (funscript, video, audio, captions) now use `render_upload()` with `on_upload`/`on_clear` callbacks for context-specific behavior.

### beat_bar

Beat detection moved from inline librosa in `project_tab._analyze_beats()` to `forge_ui_components.beat_bar.core.analyze_beats()` which delegates to `videoflow.audio.analyze_beats()`. Cache format upgraded from simple `{tempo_bpm, beats}` to full `AudioBeatMap` JSON (BPM, beats, downbeats, phrases, per-beat energy).

### project_status

Sidebar display logic extracted from `app.py._sidebar()` into `ProjectStatus` dataclass + render functions. The app builds a snapshot from session state; render code never touches session state directly.

## Adding a New Component

1. Create `forge_ui_components/<name>/core.py` — pure logic, no UI imports
2. Create `forge_ui_components/<name>/streamlit.py` — thin render layer
3. Create `forge_ui_components/<name>/__init__.py` — public API exports
4. Add tests in `tests/test_<name>.py`
5. Wire consumer app to import from `forge_ui_components.<name>`

## Session State Contract

Components never read from `st.session_state` directly. Instead:
- The calling tab/panel builds a data object (e.g., `ProjectStatus`, `FilePickerConfig`)
- Passes it to the render function
- Render function returns results via return values, not side effects
- Interactive callbacks (`on_upload`, `on_clear`) are passed in by the caller

This keeps components stateless and testable.
