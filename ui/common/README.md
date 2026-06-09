# ui/common — Framework-agnostic UI business logic

This package contains shared domain logic used by the FunscriptForge backend
across deployment targets (the Tauri desktop app via `cli.py`, and a future
HTTP/web server).  It has **no dependency on any UI framework** — only the
project's own core modules.

## Contents

| Module | Purpose |
|---|---|
| `work_items.py` | `WorkItem` model + `ItemType` enum; factory helpers to create items from assessment output |
| `project.py` | `Project` session state — loads assessment, manages work items, exports window JSONs |
| `tests/` | Unit tests for both modules (stdlib `unittest`) |

## Key concepts

### WorkItem
A tagged time window in a funscript.  Properties:

| Field | Description |
|---|---|
| `id` | UUID (auto-generated) |
| `start_ms / end_ms` | Window bounds in milliseconds |
| `item_type` | `PERFORMANCE`, `BREAK`, `RAW`, or `NEUTRAL` |
| `bpm` | Representative BPM (informational) |
| `config` | Type-specific customizer settings (pre-filled with defaults) |
| `source` | How it was created: `"phrase"`, `"bpm_transition"`, `"manual"` |
| `status` | Lifecycle state: `"todo"` → `"in_progress"` → `"done"` |

`WorkItem.to_window_dict()` returns a dict compatible with the
`WindowCustomizer`'s JSON window-file format.

### Project
One editing session.  Workflow:

```python
# Create from a funscript (runs assessment automatically)
project = Project.from_funscript("path/to/file.funscript")

# Or load a cached assessment
project = Project.from_funscript(
    "path/to/file.funscript",
    existing_assessment_path="output/file.assessment.json",
)

# Tag a section
project.set_item_type(item_id, ItemType.PERFORMANCE)

# Adjust timing
project.update_item_times(item_id, start_ms=60_000, end_ms=90_000)

# Fine-tune config
project.update_item_config(item_id, "max_velocity", 0.28)

# Export window JSONs for the customizer
written = project.export_windows("output/")
# → {"performance": "output/file.performance.json", ...}

# Save / restore project state
project.export_project("output/file.project.json")
project2 = Project.load_project("output/file.project.json")
```

## Running the tests

```bash
python -m unittest discover -s ui/common/tests -v
```

All 60 tests run in < 0.1 s with no external dependencies.

## Deployment targets

| Target | Location | Imports from here |
|---|---|---|
| Tauri desktop app (via `cli.py` / frozen `forge-cli`) | `ui/web/` + `cli.py` | ✓ |
| HTTP/web server (SaaS) | `ui/web/` | ✓ (planned) |

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).  Written by human and Claude AI (Claude Sonnet).*
