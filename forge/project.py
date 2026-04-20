"""
.forge project file — read/write/create.
Lives in the output folder. It is the resume token.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Optional

FORGE_VERSION = "1"


def default_forge(name: str, output_folder: str) -> dict:
    return {
        "name": name,
        "version": FORGE_VERSION,
        "created": datetime.now().isoformat(),
        "output_folder": output_folder,
        "input_files": [],
        "author": "",
        "contributors": [],
        "website": "",
        "git_remote": "",
        # Default device targets — seed with the MOST PERMISSIVE device so
        # a fresh project doesn't clamp anything. The user picks their real
        # targets on the Device tab. FOC 3-phase has the highest headroom
        # (700 pos/s) in our specs, so scripts stay as-authored until the
        # user explicitly adds a more restrictive device.
        "output_targets": ["foc3phase"],
        "tone": None,
        "tone_sliders": {},
        "assessment": {},
        "phrases": [],
        "history": [],
        "current_version": 0,
        "progress": {
            "project_complete": False,
            "tone_applied": False,
            "phrases_edited": False,
            "exported": False,
        },
    }


def forge_path(output_folder: str) -> Path:
    folder = Path(output_folder)
    # use first .forge file found, or derive from folder name
    existing = [p for p in folder.glob("*.forge") if p.is_file()]
    if existing:
        return existing[0]
    return folder / f"{folder.name}.forge"


def load_forge(output_folder: str) -> Optional[dict]:
    path = forge_path(output_folder)
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _json_safe(obj):
    """Convert numpy/non-standard types to JSON-serializable Python types."""
    import numpy as np
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def save_forge(project: dict) -> None:
    path = forge_path(project["output_folder"])
    Path(project["output_folder"]).mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(project, indent=2, default=_json_safe), encoding="utf-8")


def add_input_file(project: dict, role: str, path: str) -> dict:
    # remove existing entry for same role
    project["input_files"] = [f for f in project["input_files"] if f["role"] != role]
    project["input_files"].append({"role": role, "path": path, "readonly": True})
    return project


def remove_input_file(project: dict, role: str) -> dict:
    """Remove an input file by role from the project config."""
    project["input_files"] = [f for f in project["input_files"] if f["role"] != role]
    return project


def get_input_file(project: dict, role: str) -> Optional[str]:
    for f in project.get("input_files", []):
        if f["role"] == role:
            return f["path"]
    return None


# ── Funscript state chain ─────────────────────────────────────────────────
# Each tab saves a modified funscript to the output folder.
# The next tab reads from the latest state in the chain.
#
# Chain: original → device_fixed → tone_applied → phrase_edited
# Files: _funscript_original.json, _funscript_device.json,
#        _funscript_tone.json, _funscript_phrases.json

_CHAIN_STAGES = ["original", "device", "tone", "phrases"]


def _chain_folder(project: dict) -> Path:
    """Internal working folder for chain state — hidden from user output."""
    folder = Path(project.get("output_folder", "")) / ".forge"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def save_chain_funscript(project: dict, stage: str, data: dict) -> str:
    """Save a funscript state to the .forge subfolder at the given chain stage.
    Returns the path to the saved file."""
    folder = _chain_folder(project)
    path = folder / f"_funscript_{stage}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    # Debug instrumentation: record what stage was written and the
    # content hash so a "heatmap ≠ funscript" log can compare
    # successive stages.
    try:
        from ui.streamlit.debug import is_debug_enabled, log_event, hash_actions
        if is_debug_enabled():
            log_event(
                "save_chain_funscript",
                f"Wrote {path.name}",
                stage=stage,
                path=str(path),
                actions_count=len(data.get("actions") or []),
                actions_hash=hash_actions(data.get("actions")),
                project_name=project.get("name"),
            )
    except Exception:  # noqa: BLE001
        pass
    return str(path)


def load_chain_funscript(project: dict, stage: str) -> Optional[dict]:
    """Load a funscript state from the chain. Returns None if not saved yet."""
    folder = _chain_folder(project)
    path = folder / f"_funscript_{stage}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    # Fallback: check old location (top-level output folder) and migrate
    old_path = Path(project.get("output_folder", "")) / f"_funscript_{stage}.json"
    if old_path.exists():
        data = json.loads(old_path.read_text(encoding="utf-8"))
        # Migrate: move to .forge/ subfolder and remove old file
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        old_path.unlink()
        return data
    return None


def get_latest_funscript(project: dict) -> tuple[Optional[dict], str]:
    """Walk the chain backwards and return the most recent saved funscript
    plus its stage name. Falls back to the original funscript file."""
    for stage in reversed(_CHAIN_STAGES):
        data = load_chain_funscript(project, stage)
        if data:
            return data, stage
    # Fall back to original funscript from input files
    fs_path = get_input_file(project, "funscript")
    if fs_path and Path(fs_path).exists():
        data = json.loads(Path(fs_path).read_text(encoding="utf-8"))
        return data, "original"
    return None, ""


def get_chain_funscript_for(project: dict, stage: str) -> Optional[dict]:
    """Get the funscript that should be the INPUT for a given stage.
    Each stage reads from the previous stage's output."""
    idx = _CHAIN_STAGES.index(stage) if stage in _CHAIN_STAGES else 0
    # Walk backwards from previous stage
    for prev_stage in reversed(_CHAIN_STAGES[:idx]):
        data = load_chain_funscript(project, prev_stage)
        if data:
            return data
    # Fall back to original funscript
    fs_path = get_input_file(project, "funscript")
    if fs_path and Path(fs_path).exists():
        return json.loads(Path(fs_path).read_text(encoding="utf-8"))
    return None
