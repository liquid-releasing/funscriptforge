# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""stim_panel.py — Stim tab: estim character selection and channel generation.

Layout (top to bottom):
  1. Info text
  2. Character cards (flippable: electrode path front, description back)
  3. Sliders for selected character
  4. Accept → generate channels → green bar
  5. Channel previews: [Input] | [Alpha + Beta] | [Pulse + Volume]
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List

import plotly.graph_objects as go
import streamlit as st

from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays


# ---------------------------------------------------------------------------
# Character definitions (same as retransforms.py, cleaned up)
# ---------------------------------------------------------------------------

_CHARACTERS: List[Dict[str, Any]] = [
    {
        "name": "Gentle",
        "tagline": "Soft, slow-building",
        "description": (
            "Sensation stays close to center and builds gradually — no sharp onset. "
            "Good for warming up, slow content, or winding down."
        ),
        "sliders": [
            {"key": "min_dist",  "label": "Softness",     "hint": "How far sensation moves from center.", "min": 0.05, "max": 0.4,  "default": 0.15, "step": 0.01},
            {"key": "pr_max",    "label": "Pulse onset",  "hint": "How gently pulses start.",             "min": 0.0,  "max": 1.0,  "default": 0.8,  "step": 0.05},
        ],
        "path_shape": "semi_circle",
        "color": "#4a90d9",
    },
    {
        "name": "Reactive",
        "tagline": "Sharp, tracks every stroke",
        "description": (
            "Sensation follows the action instantly — wide sweep, no lag. "
            "Good for fast, intense content."
        ),
        "sliders": [
            {"key": "freq_ramp", "label": "Reactivity",      "hint": "How tightly sensation follows each stroke.", "min": 0.5, "max": 5.0, "default": 1.2, "step": 0.1},
            {"key": "pf_max",    "label": "Peak intensity",  "hint": "Maximum pulse rate during peak action.",     "min": 0.5, "max": 1.0, "default": 0.9, "step": 0.05},
        ],
        "path_shape": "three_quarter",
        "color": "#e74c3c",
    },
    {
        "name": "Scene Builder",
        "tagline": "Builds gradually over the scene",
        "description": (
            "Sensation expands as the scene develops. Rewards patience. "
            "Works well for longer content with a slow arc."
        ),
        "sliders": [
            {"key": "freq_ramp", "label": "Build speed", "hint": "How gradually sensation builds.",    "min": 3.0, "max": 10.0, "default": 7.0, "step": 0.5},
            {"key": "min_dist",  "label": "Arc width",   "hint": "How far the sensation sweeps.",       "min": 0.1, "max": 0.6,  "default": 0.35, "step": 0.01},
        ],
        "path_shape": "circle",
        "color": "#2ecc71",
    },
    {
        "name": "Unpredictable",
        "tagline": "Random direction changes",
        "description": (
            "Direction changes without warning. Pulse rate varies widely. "
            "Keeps you guessing. Good for surprise content."
        ),
        "sliders": [
            {"key": "min_dist",        "label": "Wildness", "hint": "How wide the random movement ranges.", "min": 0.1, "max": 0.6, "default": 0.4, "step": 0.01},
            {"key": "pulse_freq_ratio","label": "Variety",  "hint": "How varied the pulse rate is.",        "min": 1.0, "max": 8.0, "default": 5.0, "step": 0.5},
        ],
        "path_shape": "zigzag",
        "color": "#f39c12",
    },
    {
        "name": "Balanced",
        "tagline": "Middle of everything",
        "description": (
            "Moderate sweep, steady build, neither too sharp nor too soft. "
            "A good starting point for any content."
        ),
        "sliders": [
            {"key": "min_dist",  "label": "Sweep width",    "hint": "Width of the sensation sweep.",           "min": 0.05, "max": 0.6, "default": 0.3, "step": 0.01},
            {"key": "freq_ramp", "label": "Speed / build",  "hint": "More reactive (low) vs. more gradual.",   "min": 1.0,  "max": 8.0, "default": 4.0, "step": 0.5},
        ],
        "path_shape": "circle",
        "color": "#9b59b6",
    },
]


# ---------------------------------------------------------------------------
# Electrode path chart
# ---------------------------------------------------------------------------

def _path_points(shape: str, radius: float = 0.4) -> tuple[list[float], list[float]]:
    """Generate electrode path points. radius controls sweep width (from slider)."""
    n = 120
    r = max(0.05, min(0.48, radius))
    if shape == "semi_circle":
        angles = [math.pi * i / (n - 1) for i in range(n)]
        return [0.5 + r * math.cos(t) for t in angles], [0.5 + r * math.sin(t) for t in angles]
    elif shape == "three_quarter":
        angles = [1.5 * math.pi * i / (n - 1) + math.pi * 0.75 for i in range(n)]
        return [0.5 + r * math.cos(t) for t in angles], [0.5 + r * math.sin(t) for t in angles]
    elif shape == "circle":
        angles = [2 * math.pi * i / (n - 1) for i in range(n)]
        return [0.5 + r * math.cos(t) for t in angles], [0.5 + r * math.sin(t) for t in angles]
    else:  # zigzag
        xs = [i / (n - 1) for i in range(n)]
        ys = [0.5 + r * math.sin(8 * math.pi * x) * (1 - x * 0.3) for x in xs]
        return xs, ys


def _path_chart(shape: str, color: str, height: int = 140, radius: float = 0.4) -> go.Figure:
    _BG = "rgba(14,14,18,1)"
    a, b = _path_points(shape, radius)
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=a, y=b, mode="lines",
                             line=dict(color=color, width=2.5),
                             showlegend=False, hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=[a[0]], y=[b[0]], mode="markers",
                             marker=dict(color="#2ecc71", size=9),
                             showlegend=False, hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=[a[-1]], y=[b[-1]], mode="markers",
                             marker=dict(color="#e74c3c", size=9),
                             showlegend=False, hoverinfo="skip"))
    fig.update_layout(
        paper_bgcolor=_BG, plot_bgcolor=_BG,
        margin=dict(l=2, r=2, t=2, b=2),
        xaxis=dict(visible=False, range=[-0.05, 1.05]),
        yaxis=dict(visible=False, range=[-0.05, 1.05], scaleanchor="x"),
        height=height,
    )
    return fig


# ---------------------------------------------------------------------------
# Public render
# ---------------------------------------------------------------------------

def render(project=None) -> None:
    forge = st.session_state.get("forge_project")

    st.info(
        "**Stim** shapes how your funscript translates to electrical stimulation. "
        "Each character controls the electrode sweep path, pulse timing, and intensity curve. "
        "Pick one, adjust the sliders, preview the channels, then Accept."
    )

    selected = st.session_state.get("stim_character", None)

    # ── Character cards ───────────────────────────────────────────────────
    cols = st.columns(len(_CHARACTERS))
    for col, char in zip(cols, _CHARACTERS):
        with col:
            is_sel = (selected == char["name"])
            border = f"border: 3px solid {char['color']};" if is_sel else "border: 1px solid #333;"
            opacity = "opacity: 1.0;" if is_sel else "opacity: 0.7;"

            # Card: name + tagline
            st.markdown(
                f'<div style="padding: 8px; border-radius: 8px; {border} {opacity} text-align: center;">'
                f'<strong style="color: {char["color"]};">{char["name"]}</strong><br>'
                f'<span style="font-size: 0.85em; color: #888;">{char["tagline"]}</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

            # Electrode path chart as the "art"
            st.plotly_chart(
                _path_chart(char["path_shape"], char["color"]),
                use_container_width=True,
                config={"displayModeBar": False},
                key=f"stim_path_{char['name']}",
            )

            # Select button (always enabled — can re-select after Accept)
            if is_sel:
                st.button("✓ Selected", key=f"stim_sel_{char['name']}", disabled=True, use_container_width=True)
            else:
                if st.button("Select", key=f"stim_sel_{char['name']}", use_container_width=True):
                    st.session_state["stim_character"] = char["name"]
                    # Clear cached channels on character change
                    for k in ["stim_alpha", "stim_beta", "stim_pulse", "stim_accepted"]:
                        st.session_state.pop(k, None)
                    st.rerun()

            # Description in expander (flip replacement)
            with st.expander("Details"):
                st.caption(char["description"])

    if not selected:
        return

    st.divider()

    # ── Sliders + dynamic path ────────────────────────────────────────────
    char_data = next(c for c in _CHARACTERS if c["name"] == selected)

    col_path, col_sliders = st.columns([1, 2])

    # Read slider values first so path can respond
    slider_vals = {}
    with col_sliders:
        for sl in char_data["sliders"]:
            val = st.slider(
                sl["label"],
                min_value=sl["min"],
                max_value=sl["max"],
                value=sl["default"],
                step=sl["step"],
                help=sl["hint"],
                key=f"stim_slider_{selected}_{sl['key']}",
            )
            slider_vals[sl["key"]] = val

    # Dynamic path — radius responds to min_dist / arc_width slider
    _radius = slider_vals.get("min_dist", 0.3)
    with col_path:
        st.plotly_chart(
            _path_chart(char_data["path_shape"], char_data["color"], height=200, radius=_radius),
            use_container_width=True,
            config={"displayModeBar": False},
            key="stim_path_large",
        )

    st.divider()

    # ── Preview (blue) — generates channels ──────────────────────────────
    if st.button("👁 Preview channels", type="secondary", use_container_width=True,
                 help="Generate channel previews from current settings."):
        with st.spinner("Generating channels…"):
            _apply_stim(forge, selected, slider_vals, save_to_disk=False)
        st.rerun()

    st.divider()

    # ── Channel previews ─────────────────────────────────────────────────
    _render_channel_previews(forge, selected)

    st.divider()

    # ── Accept (red) at bottom — saves to disk ───────────────────────────
    if st.button("Accept", type="primary", use_container_width=True,
                 help="Save estim channel files to output folder."):
        _apply_stim(forge, selected, slider_vals, save_to_disk=True)
        st.session_state["stim_accepted"] = True
        st.rerun()

    if st.session_state.get("stim_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            f"**{selected}** estim channels generated (alpha, beta, pulse_frequency). "
            "Your next step is **Export**."
        )

    # Feedback prompt
    st.caption(
        "💬 Want more sliders or different stim shapes? "
        "Tell us on [Discord](https://discord.gg/funscriptforge) — "
        "your feedback shapes what we build next."
    )

    # ── Channel previews ──────────────────────────────────────────────────
    _render_channel_previews(forge, selected)


def _character_to_algorithm_params(character_name: str, slider_vals: dict) -> dict:
    """Map our character + slider values to funscript-tools algorithm parameters."""
    _MAP = {
        "Gentle": {
            "algorithm": "circular",
            "min_distance_from_center": slider_vals.get("min_dist", 0.15),
            "points_per_second": 25,
            "speed_threshold_percent": 80,
            "direction_change_probability": 0.0,
        },
        "Reactive": {
            "algorithm": "circular",
            "min_distance_from_center": 0.05,
            "points_per_second": int(25 * slider_vals.get("freq_ramp", 1.2)),
            "speed_threshold_percent": 30,
            "direction_change_probability": 0.0,
        },
        "Scene Builder": {
            "algorithm": "circular",
            "min_distance_from_center": slider_vals.get("min_dist", 0.35),
            "points_per_second": 25,
            "speed_threshold_percent": int(slider_vals.get("freq_ramp", 7.0) * 10),
            "direction_change_probability": 0.0,
        },
        "Unpredictable": {
            "algorithm": "restim-original",
            "min_distance_from_center": slider_vals.get("min_dist", 0.4),
            "points_per_second": 25,
            "speed_threshold_percent": 50,
            "direction_change_probability": min(slider_vals.get("pulse_freq_ratio", 5.0) / 10.0, 0.8),
        },
        "Balanced": {
            "algorithm": "circular",
            "min_distance_from_center": slider_vals.get("min_dist", 0.3),
            "points_per_second": 25,
            "speed_threshold_percent": 50,
            "direction_change_probability": 0.0,
        },
    }
    return _MAP.get(character_name, _MAP["Balanced"])


def _generate_channels(times_ms: list, positions: list, params: dict):
    """Generate alpha/beta channels using funscript-tools adapter.

    Returns (alpha_times_s, alpha_positions, beta_times_s, beta_positions,
             pulse_times_s, pulse_positions) — all in seconds / 0-100 scale.
    """
    import sys
    import numpy as np
    _ft_root = str(Path(__file__).resolve().parents[3].parent / "funscript-tools")
    if _ft_root not in sys.path:
        sys.path.insert(0, _ft_root)

    from funscript import Funscript
    from processing.funscript_1d_to_2d import generate_alpha_beta_from_main

    # Convert our format to funscript-tools format
    times_s = [t / 1000.0 for t in times_ms]
    positions_01 = [p / 100.0 for p in positions]
    fs = Funscript(times_s, positions_01)

    algorithm = params.get("algorithm", "circular")
    alpha_fs, beta_fs = generate_alpha_beta_from_main(
        fs,
        speed_funscript=None,
        points_per_second=params.get("points_per_second", 25),
        algorithm=algorithm,
        min_distance_from_center=params.get("min_distance_from_center", 0.1),
        speed_threshold_percent=params.get("speed_threshold_percent", 50),
        direction_change_probability=params.get("direction_change_probability", 0.1),
    )

    # Convert back to our format (seconds, 0-100)
    alpha_t = list(alpha_fs.x)
    alpha_p = [float(v) * 100.0 for v in alpha_fs.y]
    beta_t = list(beta_fs.x)
    beta_p = [float(v) * 100.0 for v in beta_fs.y]

    # Generate simple pulse frequency from speed (derivative of position)
    pos_arr = np.array(positions_01)
    time_arr = np.array(times_s)
    if len(pos_arr) > 1:
        dt = np.diff(time_arr)
        dp = np.abs(np.diff(pos_arr))
        speed = np.where(dt > 0, dp / dt, 0)
        # Normalize speed to 0-100 for pulse frequency
        max_speed = np.percentile(speed, 95) if len(speed) > 0 else 1.0
        pulse_p = list(np.clip(speed / max(max_speed, 0.001) * 100, 0, 100))
        pulse_t = list(time_arr[:-1])
    else:
        pulse_t, pulse_p = times_s, [50.0] * len(times_s)

    return alpha_t, alpha_p, beta_t, beta_p, pulse_t, pulse_p


def _apply_stim(forge, character_name, slider_vals, save_to_disk: bool = True):
    """Generate estim channel files. If save_to_disk=False, only cache for preview."""
    from datetime import datetime
    import json

    status = st.status("Generating estim channels…", expanded=True)
    status.write(f"✅ Character: **{character_name}**")

    # Load the chain funscript
    from forge.funscript import load_funscript, parse_actions
    chain_path = st.session_state.get("chain_funscript_path", "")
    funscript_path = st.session_state.get("funscript_path", "")
    _path = chain_path if (chain_path and Path(chain_path).exists()) else funscript_path

    if not _path or not Path(_path).exists():
        status.update(label="No funscript loaded", state="error")
        return

    data = load_funscript(_path)
    times, positions = parse_actions(data)
    if not times:
        status.update(label="Empty funscript", state="error")
        return

    # Map character to algorithm params
    params = _character_to_algorithm_params(character_name, slider_vals)
    status.write(f"⚙️ Algorithm: **{params['algorithm']}**")

    # Generate channels
    status.update(label=f"Generating {character_name} channels for {len(times):,} actions…")
    alpha_t, alpha_p, beta_t, beta_p, pulse_t, pulse_p = _generate_channels(
        times, positions, params
    )
    status.write(f"✅ Alpha: {len(alpha_t):,} points")
    status.write(f"✅ Beta: {len(beta_t):,} points")
    status.write(f"✅ Pulse frequency: {len(pulse_t):,} points")

    # Cache for preview and bump version for unique keys
    st.session_state["stim_alpha"] = (alpha_t, alpha_p)
    st.session_state["stim_beta"] = (beta_t, beta_p)
    st.session_state["stim_pulse"] = (pulse_t, pulse_p)
    st.session_state["stim_preview_ver"] = st.session_state.get("stim_preview_ver", 0) + 1

    # Save settings and channel files to forge project (only on Accept)
    if forge and save_to_disk:
        forge["stim_character"] = character_name
        forge["stim_sliders"] = slider_vals
        forge.setdefault("progress", {})["stim_generated"] = True
        forge.setdefault("history", []).append({
            "tab": "stim",
            "timestamp": datetime.now().isoformat(),
            "character": character_name,
            "sliders": slider_vals,
        })

        output_folder = forge.get("output_folder", "")
        if output_folder and Path(output_folder).exists():
            # Save channel funscripts
            def _save_channel(name, t_arr, p_arr):
                actions = [{"at": int(t * 1000), "pos": int(round(max(0, min(100, p))))}
                           for t, p in zip(t_arr, p_arr)]
                out = {"actions": actions}
                path = Path(output_folder) / f"{Path(_path).stem}.{name}.funscript"
                path.write_text(json.dumps(out, indent=2), encoding="utf-8")
                return str(path)

            _save_channel("alpha", alpha_t, alpha_p)
            _save_channel("beta", beta_t, beta_p)
            _save_channel("pulse_frequency", pulse_t, pulse_p)
            status.write("✅ Channel files saved to output folder")

            from forge.project import save_forge
            save_forge(forge)
            status.write("✅ Settings saved to project")

    _label = "Stim complete!" if save_to_disk else "Preview ready"
    status.update(label=_label, state="complete", expanded=False)


def _render_channel_previews(forge, selected):
    """Show input funscript + channel previews."""
    _ver = st.session_state.get("stim_preview_ver", 0)
    st.subheader("Channel previews")

    # Input funscript
    from forge.funscript import load_funscript, parse_actions
    funscript_path = st.session_state.get("funscript_path", "")
    chain_path = st.session_state.get("chain_funscript_path", "")
    _path = chain_path if (chain_path and Path(chain_path).exists()) else funscript_path

    if not _path or not Path(_path).exists():
        st.caption("No funscript loaded.")
        return

    data = load_funscript(_path)
    if not data:
        return

    times, positions = parse_actions(data)
    if not times:
        return
    times_s = [t / 1000.0 for t in times]

    # Check for cached channel data
    _alpha = st.session_state.get("stim_alpha")
    _beta = st.session_state.get("stim_beta")
    _pulse = st.session_state.get("stim_pulse")

    col_input, col_ab, col_pv = st.columns(3)
    with col_input:
        st.caption("**Input funscript**")
        render_monochrome_from_arrays(times_s, positions, height=150, key=f"stim_input_{_ver}")

    with col_ab:
        st.caption("**Alpha channel**")
        if _alpha:
            render_monochrome_from_arrays(_alpha[0], _alpha[1], height=150, key=f"stim_alpha_preview_{_ver}")
        else:
            st.caption("_Select a character and click Accept to generate._")
        st.caption("**Beta channel**")
        if _beta:
            render_monochrome_from_arrays(_beta[0], _beta[1], height=150, key=f"stim_beta_preview_{_ver}")
        else:
            st.caption("_Select a character and click Accept to generate._")

    with col_pv:
        st.caption("**Pulse frequency**")
        if _pulse:
            render_monochrome_from_arrays(_pulse[0], _pulse[1], height=150, key=f"stim_pulse_preview_{_ver}")
        else:
            st.caption("_Select a character and click Accept to generate._")
        st.caption("**Volume**")
        st.caption("_Volume channel coming soon._")
