# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""funscript_tools.py — Adapter boundary for funscript-tools.

All FunscriptForge code imports funscript-tools through this module.
Zero direct imports from the funscript-tools repo elsewhere.

Resolution order for the funscript-tools location:
  1. ``FUNSCRIPT_TOOLS_ROOT`` env var — explicit override
  2. PyInstaller bundle: ``sys._MEIPASS/_vendored/funscript_tools/``
     (or same folder as executable in onefolder mode)
  3. Sibling clone at ``../funscript-tools`` — dev default

If none of those resolve, AVAILABLE is False and the stim tab should
be disabled gracefully.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable, Optional

# ── Locate funscript-tools (env override → bundle → sibling clone) ───


def _locate_funscript_tools() -> Path | None:
    # 1. Explicit env var override
    env = os.environ.get("FUNSCRIPT_TOOLS_ROOT")
    if env:
        p = Path(env).resolve()
        if (p / "cli.py").exists():
            return p

    # 2. PyInstaller bundle
    if getattr(sys, "frozen", False):
        meipass = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        for candidate in (
            meipass / "_vendored" / "funscript_tools",
            Path(sys.executable).parent / "_vendored" / "funscript_tools",
        ):
            if (candidate / "cli.py").exists():
                return candidate

    # 3. Sibling clone (dev default)
    sibling = Path(__file__).resolve().parents[1].parent / "funscript-tools"
    if (sibling / "cli.py").exists():
        return sibling

    return None


_FT_ROOT = _locate_funscript_tools()
AVAILABLE = _FT_ROOT is not None

# ── Lazy imports from funscript-tools cli.py ──────────────────────────

_cli = None


def _ensure_cli():
    """Import funscript-tools cli module on first use."""
    global _cli
    if _cli is not None:
        return _cli
    if not AVAILABLE or _FT_ROOT is None:
        raise ImportError(
            "funscript-tools not found. Set FUNSCRIPT_TOOLS_ROOT, "
            "clone it as a sibling (git clone <repo> ../funscript-tools), "
            "or install the bundled desktop app."
        )
    if str(_FT_ROOT) not in sys.path:
        sys.path.insert(0, str(_FT_ROOT))
    import cli as ft_cli
    _cli = ft_cli
    return _cli


# ── Public API (the adapter boundary) ────────────────────────────────


def get_builtin_presets() -> dict[str, dict]:
    """Return the raw BUILTIN_PRESETS from funscript-tools (no user overrides).

    Use this when you specifically want the upstream defaults — for example,
    when generating the user's stim_presets.json file. Most callers should
    use ``get_presets()`` instead, which honors user overrides.
    """
    cli = _ensure_cli()
    return dict(cli.BUILTIN_PRESETS)


def get_presets() -> dict[str, dict]:
    """Return character presets, merged with the user's stim_presets.json.

    First call writes the default config file if it does not yet exist.
    Errors are swallowed silently here — the stim panel calls into
    ``forge.stim_config.merged_presets`` directly when it needs to display
    a courtesy banner about a corrupt user file.

    Each preset has: description, config (dict), sliders (list of dicts).
    """
    from forge.stim_config import merged_presets
    presets, _err = merged_presets()
    return presets


def get_default_config() -> dict:
    """Return the default processing configuration."""
    cli = _ensure_cli()
    return cli.get_default_config()


def build_config(preset_name: str, slider_overrides: dict | None = None,
                 output_dir: str | None = None) -> dict:
    """Build a full config from a preset name + optional slider overrides.

    Args:
        preset_name: One of the BUILTIN_PRESETS keys.
        slider_overrides: Dict of {cv_key: value} to override preset defaults.
        output_dir: Output directory for generated files.

    Returns:
        Complete config dict ready for process().
    """
    cli = _ensure_cli()
    config = cli.get_default_config()

    # Apply preset config on top of defaults
    presets = cli.BUILTIN_PRESETS
    if preset_name in presets:
        preset = presets[preset_name]
        _deep_merge(config, preset["config"])

    # Apply slider overrides (CV keys map to config paths)
    if slider_overrides:
        _apply_slider_overrides(config, preset_name, slider_overrides)

    # Set output directory
    if output_dir:
        config.setdefault("advanced", {})["custom_output_directory"] = output_dir

    return config


def process(funscript_path: str, config: dict,
            on_progress: Optional[Callable[[int, str], None]] = None) -> dict:
    """Run the full funscript-tools processing pipeline.

    Args:
        funscript_path: Path to the input .funscript file.
        config: Full config dict (from build_config()).
        on_progress: Optional callback(percent, message).

    Returns:
        {success: bool, error: str|None, outputs: [{suffix, path, size_bytes}]}
    """
    cli = _ensure_cli()
    return cli.process(funscript_path, config, on_progress)


def process_with_default_config(funscript_path: str, output_dir: str,
                                on_progress: Optional[Callable[[int, str], None]] = None
                                ) -> dict:
    """Run funscript-tools with edger's default config (no preset overlay).

    Used by the Export tab when an estim device is selected but the user
    skipped the Stim tab. Produces whatever the upstream defaults yield.

    Args:
        funscript_path: Path to the input .funscript file.
        output_dir: Where to write generated files.
        on_progress: Optional callback(percent, message).

    Returns:
        Same shape as ``process()``.
    """
    cli = _ensure_cli()
    config = cli.get_default_config()
    config.setdefault("advanced", {})["custom_output_directory"] = output_dir
    return cli.process(funscript_path, config, on_progress)


def preview_output(source: dict, config: dict, output_type: str = "alpha") -> dict:
    """Preview a single channel without file I/O.

    Args:
        source: {x: list[float], y: list[float]} — the input funscript data.
        config: Full config dict (from build_config()).
        output_type: Channel to preview (alpha, beta, frequency, volume, speed).

    Returns:
        {output_x, output_y, label, available: bool}
    """
    cli = _ensure_cli()
    return cli.preview_output(source, config, output_type)


def list_outputs(directory: str, stem: str) -> list[dict]:
    """List generated output files for a stem in a directory.

    Returns: [{suffix, path, size_bytes}]
    """
    cli = _ensure_cli()
    return cli.list_outputs(directory, stem)


# ── Internal helpers ──────────────────────────────────────────────────


def _deep_merge(base: dict, override: dict) -> None:
    """Merge override into base recursively (mutates base)."""
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def _apply_slider_overrides(config: dict, preset_name: str,
                            overrides: dict) -> None:
    """Map slider CV keys to config paths and apply overrides.

    The CV key naming convention from funscript-tools presets:
      cv_min_dist        → alpha_beta_generation.min_distance_from_center
      cv_freq_ramp_ratio → frequency.frequency_ramp_combine_ratio
      cv_pf_max          → frequency.pulse_freq_max
      cv_pr_max          → pulse.pulse_rise_max
      cv_pulse_freq_ratio → frequency.pulse_frequency_combine_ratio
    """
    _CV_MAP = {
        "cv_min_dist": ("alpha_beta_generation", "min_distance_from_center"),
        "cv_freq_ramp_ratio": ("frequency", "frequency_ramp_combine_ratio"),
        "cv_pf_max": ("frequency", "pulse_freq_max"),
        "cv_pr_max": ("pulse", "pulse_rise_max"),
        "cv_pulse_freq_ratio": ("frequency", "pulse_frequency_combine_ratio"),
    }
    for cv_key, value in overrides.items():
        if cv_key in _CV_MAP:
            section, param = _CV_MAP[cv_key]
            config.setdefault(section, {})[param] = value
