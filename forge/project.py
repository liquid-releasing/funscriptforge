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
