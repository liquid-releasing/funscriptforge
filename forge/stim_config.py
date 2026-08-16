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
        # Fraction of the span held at FULL intensity before the taper starts.
        # 0.75 = the wind-down happens in the closing quarter. Tapering from the
        # very first beat made the chapter read as already-ending the moment it
        # began; a closer should hold the scene and then let it go (user, 2026-08-16).
        "envelope_hold": 0.75,
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


# Characters whose volume shape IS the point — a deliberate ramp that opens or
# closes a scene. Seam-matching would flatten exactly what they exist to do, so
# a chapter assigned one of these is never lifted (its NEIGHBOURS still are, and
# they lift toward it, which is what keeps the arc continuous).
SHAPED_CHARACTERS = frozenset({"scene_builder", "scene_closer"})

# How long the lifted head takes to ease back to the chapter's own curve.
DEFAULT_SEAM_DECAY_MS = 12_000


def match_chapter_volumes(
    channel_name: str,
    actions: list[dict],
    windows: list[tuple],
    *,
    decay_ms: int = DEFAULT_SEAM_DECAY_MS,
) -> list[dict]:
    """Remove the volume STEP at each chapter seam.

    Channels are generated one chapter at a time and concatenated, and Edger's
    volume ramp is hard-coded rising from 0 — so every chapter restarts near
    silence and each boundary lands as an audible drop. This repairs the seam
    without touching how any chapter is generated: the incoming chapter is
    lifted to the level the outgoing one ended at, then eased back to its own
    curve over ``decay_ms``. Only the HEAD of a chapter moves; the body keeps
    its character exactly.

    ``windows`` is the per-chapter ``(lo_ms, hi_ms, character_id, ...)`` list
    used to generate the channels. Chapters assigned a shaped character
    (Scene Builder / Scene Closer) are left alone — see SHAPED_CHARACTERS.

    Non-volume channels pass through unchanged.
    """
    if channel_name not in _VOLUME_CHANNELS:
        return actions
    if not actions or len(windows) < 2:
        return actions

    out = [{"at": int(a["at"]), "pos": int(a["pos"])} for a in
           sorted(actions, key=lambda a: a["at"])]

    for i in range(1, len(windows)):
        wlo, whi = windows[i][0], windows[i][1]
        cid = windows[i][2] if len(windows[i]) > 2 else None
        if wlo is None or whi is None:
            continue
        if _slug(cid or "") in SHAPED_CHARACTERS:
            continue

        prev_level = next((a["pos"] for a in reversed(out) if a["at"] < wlo), None)
        head_idx = next((j for j, a in enumerate(out) if a["at"] >= wlo), None)
        if prev_level is None or head_idx is None:
            continue
        delta = prev_level - out[head_idx]["pos"]
        if delta == 0:
            continue

        # Never spend more than half a chapter recovering — on a short chapter a
        # fixed 12s ramp would shift most of it and read as a different scene.
        span = min(decay_ms, max(1, (whi - wlo) // 2))
        for a in out[head_idx:]:
            offset = a["at"] - wlo
            if offset > span:
                break
            lifted = a["pos"] + delta * (1.0 - offset / span)
            a["pos"] = int(round(0 if lifted < 0 else (100 if lifted > 100 else lifted)))

    return out


def apply_virtual_envelope(
    channel_name: str,
    actions: list[dict],
    window_lo: int,
    window_hi: int,
    spec: Optional[dict],
) -> list[dict]:
    """Apply a virtual character's post-process to one channel's actions.

    ``descending``: hold the volume channels at full for the first
    ``envelope_hold`` of the span, then taper linearly to ``envelope_floor`` at
    ``window_hi`` — the unbuild. With the default hold of 0.75 the wind-down
    lives entirely in the closing quarter, which is what "closing a scene"
    means: the scene runs at strength and then releases, rather than fading
    from its first beat. A hold of 0.0 restores the original full-span taper.
    Non-volume channels and non-descending specs pass through unchanged.
    """
    if not spec or spec.get("envelope") != "descending":
        return actions
    if channel_name not in _VOLUME_CHANNELS:
        return actions
    floor = float(spec.get("envelope_floor", 0.2))
    # Clamped below 1.0: a hold of exactly 1.0 would leave no room to taper in
    # and make the closer a no-op that silently stops closing anything.
    hold = float(spec.get("envelope_hold", 0.0))
    hold = 0.0 if hold < 0.0 else (0.99 if hold > 0.99 else hold)
    span = max(1, window_hi - window_lo)
    out: list[dict] = []
    for a in actions:
        frac = (a["at"] - window_lo) / span
        frac = 1.0 if frac > 1.0 else (0.0 if frac < 0.0 else frac)
        if frac <= hold:
            factor = 1.0
        else:
            factor = 1.0 - (1.0 - floor) * ((frac - hold) / (1.0 - hold))
        out.append({"at": a["at"], "pos": int(round(a["pos"] * factor))})
    return out
