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
    existing = list(folder.glob("*.forge"))
    if existing:
        return existing[0]
    return folder / f"{folder.name}.forge"


def load_forge(output_folder: str) -> Optional[dict]:
    path = forge_path(output_folder)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def save_forge(project: dict) -> None:
    path = forge_path(project["output_folder"])
    Path(project["output_folder"]).mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(project, indent=2), encoding="utf-8")


def add_input_file(project: dict, role: str, path: str) -> dict:
    # remove existing entry for same role
    project["input_files"] = [f for f in project["input_files"] if f["role"] != role]
    project["input_files"].append({"role": role, "path": path, "readonly": True})
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


def save_chain_funscript(project: dict, stage: str, data: dict) -> str:
    """Save a funscript state to the output folder at the given chain stage.
    Returns the path to the saved file."""
    folder = Path(project.get("output_folder", ""))
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"_funscript_{stage}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return str(path)


def load_chain_funscript(project: dict, stage: str) -> Optional[dict]:
    """Load a funscript state from the chain. Returns None if not saved yet."""
    folder = Path(project.get("output_folder", ""))
    path = folder / f"_funscript_{stage}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
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
