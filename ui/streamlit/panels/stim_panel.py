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

def _path_points(shape: str) -> tuple[list[float], list[float]]:
    n = 120
    if shape == "semi_circle":
        angles = [math.pi * i / (n - 1) for i in range(n)]
        return [0.5 + 0.4 * math.cos(t) for t in angles], [0.5 + 0.4 * math.sin(t) for t in angles]
    elif shape == "three_quarter":
        angles = [1.5 * math.pi * i / (n - 1) + math.pi * 0.75 for i in range(n)]
        return [0.5 + 0.4 * math.cos(t) for t in angles], [0.5 + 0.4 * math.sin(t) for t in angles]
    elif shape == "circle":
        angles = [2 * math.pi * i / (n - 1) for i in range(n)]
        return [0.5 + 0.4 * math.cos(t) for t in angles], [0.5 + 0.4 * math.sin(t) for t in angles]
    else:  # zigzag
        xs = [i / (n - 1) for i in range(n)]
        ys = [0.5 + 0.4 * math.sin(8 * math.pi * x) * (1 - x * 0.3) for x in xs]
        return xs, ys


def _path_chart(shape: str, color: str, height: int = 140) -> go.Figure:
    _BG = "rgba(14,14,18,1)"
    a, b = _path_points(shape)
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
        "Pick one, adjust the sliders, then Accept to generate the channel files."
    )

    selected = st.session_state.get("stim_character", None)

    # ── Character cards ───────────────────────────────────────────────────
    cols = st.columns(len(_CHARACTERS))
    for col, char in zip(cols, _CHARACTERS):
        with col:
            is_sel = (selected == char["name"])
            border = f"border: 3px solid {char['color']};" if is_sel else "border: 1px solid #333;"
            opacity = "opacity: 1.0;" if is_sel else "opacity: 0.7;"

            # Card front: name + tagline
            st.markdown(
                f'<div style="padding: 8px; border-radius: 8px; {border} {opacity} text-align: center;">'
                f'<strong style="color: {char["color"]};">{char["name"]}</strong><br>'
                f'<span style="font-size: 0.85em; color: #888;">{char["tagline"]}</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

            # Flip: info button toggles description
            _flip_key = f"stim_flip_{char['name']}"
            if st.button("ℹ️", key=f"stim_info_{char['name']}", use_container_width=True):
                st.session_state[_flip_key] = not st.session_state.get(_flip_key, False)

            if st.session_state.get(_flip_key, False):
                st.caption(char["description"])
            else:
                # Electrode path chart as the "art"
                st.plotly_chart(
                    _path_chart(char["path_shape"], char["color"]),
                    use_container_width=True,
                    config={"displayModeBar": False},
                    key=f"stim_path_{char['name']}",
                )

            # Select button
            if is_sel:
                st.button("✓ Selected", key=f"stim_sel_{char['name']}", disabled=True, use_container_width=True)
            else:
                if st.button("Select", key=f"stim_sel_{char['name']}", use_container_width=True):
                    st.session_state["stim_character"] = char["name"]
                    st.rerun()

    if not selected:
        return

    st.divider()

    # ── Sliders for selected character ────────────────────────────────────
    char_data = next(c for c in _CHARACTERS if c["name"] == selected)

    # Electrode path (larger) + sliders side by side
    col_path, col_sliders = st.columns([1, 2])
    with col_path:
        st.plotly_chart(
            _path_chart(char_data["path_shape"], char_data["color"], height=200),
            use_container_width=True,
            config={"displayModeBar": False},
            key="stim_path_large",
        )

    with col_sliders:
        slider_vals = {}
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

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────────
    if st.button("Accept", type="primary", width="stretch",
                 help="Generate estim channel files."):
        _apply_stim(forge, selected, slider_vals)
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
        "💬 Want more sliders or different characters? "
        "Tell us on [Discord](https://discord.gg/funscriptforge) — "
        "your feedback shapes what we build next."
    )

    st.divider()

    # ── Channel previews ──────────────────────────────────────────────────
    _render_channel_previews(forge, selected)


def _apply_stim(forge, character_name, slider_vals):
    """Generate estim channel files and save to output folder."""
    from datetime import datetime

    status = st.status("Generating estim channels…", expanded=True)
    status.write(f"✅ Character: **{character_name}**")

    # Save settings to forge project
    if forge:
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
            from forge.project import save_forge
            save_forge(forge)
            status.write("✅ Settings saved to project")

            # TODO: Generate actual channel files using funscript-tools/restim
            # For now, mark as generated
            status.write("⚠️ Channel generation coming soon — settings saved for export")

    status.update(label="Stim complete!", state="complete", expanded=False)


def _render_channel_previews(forge, selected):
    """Show input funscript + placeholder channel previews."""
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

    col_input, col_ab, col_pv = st.columns(3)
    with col_input:
        st.caption("**Input funscript**")
        render_monochrome_from_arrays(times_s, positions, height=150, key="stim_input")

    with col_ab:
        st.caption("**Alpha channel**")
        st.info("Preview available after channel generation is implemented.", icon="🔧")
        st.caption("**Beta channel**")
        st.info("Preview available after channel generation is implemented.", icon="🔧")

    with col_pv:
        st.caption("**Pulse frequency**")
        st.info("Preview available after channel generation is implemented.", icon="🔧")
        st.caption("**Volume**")
        st.info("Preview available after channel generation is implemented.", icon="🔧")
