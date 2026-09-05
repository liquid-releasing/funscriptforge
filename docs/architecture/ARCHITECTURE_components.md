# Architecture: Shared Component Library

## Overview

FunscriptForge is a Tauri 2 + React app (`ui/web/`). Its React UI imports shared
components from the sibling **forgemoment** library (AppShell, Charts, MediaViewer,
TransformPanel, primitives) by bare specifier, resolved via a Vite alias to the
sibling source tree.

The Python backend additionally uses
[forge-ui-components](https://github.com/liquid-releasing/forge-ui-components) for
the framework-agnostic side of chart/analysis logic. Historically those components
followed a two-layer pattern — framework-agnostic `core.py` (pure Python) plus a
thin render layer — and the predicted **migration to React/Tauri has happened**:
the render layer is now React, while the pure-`core.py` logic (chart data shaping,
beat analysis wrappers) is still reused by `cli.py` and its modules.

This separation enables:
- Reuse across FunscriptForge, ForgePlayer, and future apps
- A React render layer over the same framework-agnostic core logic
- Testing core logic without any UI-framework dependency

## Dependency Graph

```
FunscriptForge desktop app (ui/web/ — React + Vite)
│
├── forgemoment                  ← shared React UI library (Vite alias to sibling)
│   ├── AppShell / Charts        ← chart + layout primitives
│   ├── MediaViewer              ← video / audio / spectrogram / funscript modes
│   └── TransformPanel           ← before/after preview UI
│
└── Rust bridge (src-tauri/) ──► cli.py  (Python backend)
        │
        ├── forge-ui-components          ← framework-agnostic core logic
        │   ├── funscript_chart.core     ← chart data (PointSeries, colors, slicing)
        │   └── beat_bar.core            ← wraps videoflow AudioBeatMap
        │
        ├── videoflow (xolvco)           ← beat analysis, scene/chapter detection
        │   └── audio.AudioBeatMap       ← BPM, beats, downbeats, phrases, energy
        │
        └── visualizations/              ← backward-compat shims → forge-ui-components
            ├── chart_data.py            ← re-exports from funscript_chart.core
            └── funscript_chart.py       ← FunscriptChart wrapper → vibrant_figure()
```

## What the core layer provides

### funscript_chart

The chart data layer lives in `funscript_chart.core` (PointSeries, velocity colors,
slicing) — framework-agnostic and reusable by `cli.py`. FunscriptForge's
`visualizations/` directory is now thin backward-compat shims that re-export from
the component library:

| Shim | Re-exports |
|---|---|
| `visualizations/chart_data.py` | `funscript_chart.core` (PointSeries, colors, slicing) |
| `visualizations/funscript_chart.py` | `funscript_chart.core.vibrant_figure()` |

The React UI consumes the same `PointSeries` data shape (emitted as JSON by `cli.py`)
and renders it with forgemoment Charts.

### beat_bar

Beat detection delegates to `forge_ui_components.beat_bar.core.analyze_beats()`, which
in turn calls `videoflow.audio.analyze_beats()`. The cache is full `AudioBeatMap` JSON
(BPM, beats, downbeats, phrases, per-beat energy).

## Adding a New Component

For shared **React** UI, add it to the sibling forgemoment library and import it in
`ui/web/`. For framework-agnostic backend logic:

1. Create `forge_ui_components/<name>/core.py` — pure logic, no UI imports
2. Create `forge_ui_components/<name>/__init__.py` — public API exports
3. Add tests in `tests/test_<name>.py`
4. Expose it through a `cli.py` subcommand so the React UI can call it via the Rust bridge

## Extracting a rule out of a screen (`ui/web/src/lib/`)

**vitest never renders a screen component.** `App.jsx` and the `screens/*.jsx`
tabs are not mounted by any test, so a rule written inline in one of them is
effectively unguarded — and three separate bugs shipped that way before this
pattern existed.

So when a screen grows a *decision* (as opposed to layout), it moves into
`ui/web/src/lib/` as a pure function with tests, and the screen calls it:

| Module | The decision it owns | The bug that put it there |
|---|---|---|
| `busyOwner.js` | who may clear the shared footer busy banner | any producer's `finally` cleared whatever banner was current, so a late-resolving tab wiped the analysis progress mid-pipeline |
| `chainGate.js` | whether an incomplete analysis blocks the chain **on this tab** | the gate applied to Project and Generate, which run *before* analysis, leaving their primary permanently white |
| `analysisState.js` | partial / complete / loading, and when clips are optional | a single-chapter or direct-play project has zero clips by design and was perpetually "partial" |
| `coalescedWriter.js` | debouncing a write without ever losing the last one | one CLI process per authored event; chaining events is the designed workflow, so bursts were the normal case |

The test is the point, not the file move. `coalescedWriter` is the clearest
case: it is the only recent change that can **lose user data**, so its tests
pin the properties that would do it — the last payload wins, `flush()` resolves
so callers can await it before reading the file back, a fired timer is not
re-sent, and an empty list still reaches disk rather than being mistaken for
"nothing queued".

Two consumer obligations come with a coalesced write, and neither is
enforceable by the module: **every path that reads the file back must flush
first**, and **unmount must flush**. A pending write that never lands is the
same bug as a failed one.

## State Contract

Core components are pure and stateless:
- The caller builds a plain data object (e.g., `ProjectStatus`, `FilePickerConfig`)
- Passes it to the core function
- The function returns results via return values, not side effects

This keeps the core logic UI-framework agnostic and testable, and lets the React
front-end consume the same logic over JSON.
