# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""User-editable stim presets stored in the OS app-config directory.

The user can hand-edit a JSON file to override built-in stim presets
(Gentle, Reactive, Scene Builder, etc.) without touching the code.
On first run we write the BUILTIN_PRESETS as the defaults; on subsequent
runs we merge user overrides over the built-ins.

  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │ BUILTIN_PRESETS  │ ─► │ user JSON file   │ ─► │ merged_presets() │
  │ (funscript-tools)│    │ (app config dir) │    │  used by stim UI │
  └──────────────────┘    └──────────────────┘    └──────────────────┘

Pipeline:
- ensure_user_config() — write defaults if file missing (idempotent)
- load_user_config()   — parse JSON, return ({}, error) on corruption
- merged_presets()     — return ({preset_name: preset_dict}, error|None)

The error string is a courtesy alert: the stim panel renders it as a
warning banner so the user knows their hand-edited file was ignored.
Falling back to built-ins is silent at the data level.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional


_APP_NAME = "funscriptforge"
_CONFIG_FILENAME = "stim_presets.json"


def app_config_dir() -> Path:
    """Return the per-user app config directory for the current platform.

    Windows:  %APPDATA%\\funscriptforge
    macOS:    ~/Library/Application Support/funscriptforge
    Linux:    $XDG_CONFIG_HOME/funscriptforge or ~/.config/funscriptforge
    """
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / _APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / _APP_NAME
    # Linux / other Unix
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / _APP_NAME


def user_config_path() -> Path:
    """Return the absolute path to the user's stim_presets.json file."""
    return app_config_dir() / _CONFIG_FILENAME


def _builtin_presets() -> dict:
    """Fetch BUILTIN_PRESETS from funscript-tools (lazy import).

    Returns an empty dict if funscript-tools is not available — callers
    should treat that case as "no presets at all" and skip stim entirely.
    """
    from forge.funscript_tools import AVAILABLE, get_builtin_presets
    if not AVAILABLE:
        return {}
    return get_builtin_presets()


def ensure_user_config() -> Path:
    """Write the built-in defaults to the user config file if missing.

    Idempotent: if the file already exists we leave it alone.

    Raises:
        OSError: if the directory or file cannot be created.
    """
    path = user_config_path()
    if path.exists():
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    defaults = _builtin_presets()
    path.write_text(json.dumps(defaults, indent=2), encoding="utf-8")
    return path


def load_user_config() -> tuple[dict, Optional[str]]:
    """Read the user config file.

    Returns:
        (data, error_message) — error_message is None on success or when
        the file simply does not exist (treated as "no overrides"). It
        is a human-readable string when the file exists but is unreadable
        or contains invalid JSON, so the UI can show a courtesy banner.
    """
    path = user_config_path()
    if not path.is_file():
        return {}, None

    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return {}, f"Could not read {path}: {exc.strerror or exc}"

    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return {}, f"{path} is not valid JSON: {exc.msg} (line {exc.lineno})"

    if not isinstance(data, dict):
        return {}, f"{path} must contain a JSON object at the top level"

    return data, None


def merged_presets() -> tuple[dict, Optional[str]]:
    """Return BUILTIN_PRESETS with user overrides applied.

    Strategy: deep-merge user values on top of built-ins. Unknown preset
    names from the user file are kept (so users can add their own custom
    characters that funscript-tools didn't ship with).

    Returns:
        (presets, error_message) — error_message is propagated from
        load_user_config so the UI can warn when a broken file was
        ignored. The presets dict is always usable even on error.
    """
    builtins = _builtin_presets()
    user, err = load_user_config()
    if not user:
        return builtins, err

    merged = {k: dict(v) for k, v in builtins.items()}
    for name, override in user.items():
        if name in merged and isinstance(override, dict):
            _deep_merge(merged[name], override)
        else:
            # User-defined custom preset
            merged[name] = override
    return merged, err


# ── Internal helpers ──────────────────────────────────────────────────


def _deep_merge(base: dict, override: dict) -> None:
    """Merge override into base recursively (mutates base)."""
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
