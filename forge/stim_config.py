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


# ── Virtual characters (route B) ───────────────────────────────────────
# Characters we provide WITHOUT editing the vendored Edger engine: generate
# from a base Edger preset, then post-process the channels at our layer.
# Edger's volume ramp is hard-coded RISING (``make_volume_ramp`` builds a
# 0→peak envelope), so a "winds down" character can't be a pure config —
# we generate with a base, then scale the intensity (volume) channels by a
# descending taper across the assigned span.
#
# Scene Closer = the reverse Scene Builder: same texture, but the intensity
# eases OFF over the scene instead of building up. Builder opens, Closer
# closes — the arc's finale.

VIRTUAL_CHARACTERS: dict[str, dict] = {
    "scene_closer": {
        "label": "Scene Closer",
        "description": (
            "Winds the scene down — eases off and de-escalates over its span. "
            "The reverse of Scene Builder: Builder opens, Closer closes."
        ),
        "base": "Scene Builder",       # Edger preset to generate from
        "envelope": "descending",      # scale volume 1.0 → floor across the span
        "envelope_floor": 0.2,         # intensity at the end of the span (0..1)
    },
}

# Channels whose amplitude carries "intensity" — the descending envelope
# scales these; motion/frequency/pulse channels are left untouched.
_VOLUME_CHANNELS = ("volume", "volume-prostate")


def _slug(s: str) -> str:
    """Slugify a character label/id (``Scene Builder`` -> ``scene_builder``)."""
    return (s or "").lower().replace(" ", "_").replace("-", "_")


def resolve_character(cid_or_label: str) -> tuple[str, Optional[dict]]:
    """Resolve a character id/label to ``(base_label, virtual_spec_or_None)``.

    Virtual characters (e.g. ``scene_closer``) resolve to their base Edger
    preset label plus a post-process spec. Real presets pass through
    unchanged with ``None`` — callers keep their existing label lookup.
    """
    spec = VIRTUAL_CHARACTERS.get(_slug(cid_or_label))
    if spec:
        return spec["base"], spec
    return cid_or_label, None


def virtual_character_records() -> list[dict]:
    """Catalog records for the forge-level virtual characters.

    Inherits the base preset's sliders/config so the UI has knobs. Skipped
    when the base preset is unavailable (funscript-tools missing) so the
    catalog stays consistent — no virtual characters without real ones.
    """
    presets, _ = merged_presets()
    out: list[dict] = []
    for key, spec in VIRTUAL_CHARACTERS.items():
        base = presets.get(spec["base"])
        if not base:
            continue
        out.append({
            "id": key,
            "label": spec["label"],
            "description": spec["description"],
            "sliders": base.get("sliders", []),
            "config": base.get("config", {}),
            "virtual": True,
            "base": spec["base"],
        })
    return out


def apply_virtual_envelope(
    channel_name: str,
    actions: list[dict],
    window_lo: int,
    window_hi: int,
    spec: Optional[dict],
) -> list[dict]:
    """Apply a virtual character's post-process to one channel's actions.

    ``descending``: scale the volume channels by a linear taper from 1.0 at
    ``window_lo`` down to ``envelope_floor`` at ``window_hi`` — the unbuild.
    Non-volume channels and non-descending specs pass through unchanged.
    """
    if not spec or spec.get("envelope") != "descending":
        return actions
    if channel_name not in _VOLUME_CHANNELS:
        return actions
    floor = float(spec.get("envelope_floor", 0.2))
    span = max(1, window_hi - window_lo)
    out: list[dict] = []
    for a in actions:
        frac = (a["at"] - window_lo) / span
        frac = 1.0 if frac > 1.0 else (0.0 if frac < 0.0 else frac)
        factor = 1.0 - (1.0 - floor) * frac
        out.append({"at": a["at"], "pos": int(round(a["pos"] * factor))})
    return out
