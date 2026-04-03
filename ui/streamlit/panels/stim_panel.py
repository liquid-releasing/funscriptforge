# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""stim_panel.py — Stim tab: estim character selection and channel generation.

Layout (top to bottom):
  1. Info text (or unavailable message if funscript-tools missing)
  2. Character cards (flippable: static electrode path front, description back)
  3. Sliders for selected character (from funscript-tools presets)
  4. Preview → calls funscript-tools process() to temp dir
  5. Accept → calls funscript-tools process() to output folder
  6. Channel previews: reads generated files from disk

Pipeline boundary:
  FunscriptForge (shape) → funscript-tools process() (channels) → restim (audio)
  All funscript-tools interaction goes through forge.funscript_tools adapter.
"""

from __future__ import annotations

import json
import math
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import streamlit as st

from forge_ui_components.funscript_chart.streamlit import render_static_from_arrays

# ── Check if funscript-tools is available ─────────────────────────────

from forge.funscript_tools import AVAILABLE as _FT_AVAILABLE

# Card colors and electrode path shapes per character.
# These are presentation-only — the algorithm config comes from
# funscript-tools BUILTIN_PRESETS via the adapter.
_CARD_STYLE = {
    "Gentle":       {"color": "#4a90d9", "path_shape": "semi_circle", "tagline": "Soft, slow-building"},
    "Reactive":     {"color": "#e74c3c", "path_shape": "three_quarter", "tagline": "Sharp, tracks every stroke"},
    "Scene Builder": {"color": "#2ecc71", "path_shape": "circle", "tagline": "Builds gradually over the scene"},
    "Unpredictable": {"color": "#f39c12", "path_shape": "zigzag", "tagline": "Random direction changes"},
    "Balanced":     {"color": "#9b59b6", "path_shape": "circle", "tagline": "Middle of everything"},
}


# ── Electrode path rendering (static matplotlib, no Plotly) ───────────

def _path_points(shape: str, radius: float = 0.4) -> tuple[list[float], list[float]]:
    """Generate electrode path points for static rendering."""
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


@st.cache_data(show_spinner=False)
def _render_path_png(shape: str, color: str, radius: float = 0.4,
                     width_px: int = 200, height_px: int = 140) -> bytes:
    """Render electrode path as static PNG bytes (cached, no Plotly).

    Cached by (shape, color, radius, size) — only re-renders when
    slider value changes, not on every Streamlit rerun.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import io

    fig, ax = plt.subplots(figsize=(width_px / 100, height_px / 100), dpi=100)
    fig.patch.set_facecolor("#0e0e12")
    ax.set_facecolor("#0e0e12")

    xs, ys = _path_points(shape, radius)
    ax.plot(xs, ys, color=color, linewidth=2.5)
    ax.plot(xs[0], ys[0], "o", color="#2ecc71", markersize=7)   # start
    ax.plot(xs[-1], ys[-1], "o", color="#e74c3c", markersize=7)  # end

    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.tight_layout(pad=0.1)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=0.02)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ── Helpers ───────────────────────────────────────────────────────────

def _get_input_funscript_path() -> str | None:
    """Resolve the best input funscript — chain (toned/phrased) or original."""
    chain = st.session_state.get("chain_funscript_path", "")
    original = st.session_state.get("funscript_path", "")
    if chain and Path(chain).exists():
        return chain
    if original and Path(original).exists():
        return original
    return None


def _get_presets() -> dict:
    """Load presets from funscript-tools, cached in session state."""
    if "stim_presets" not in st.session_state:
        from forge.funscript_tools import get_presets
        st.session_state["stim_presets"] = get_presets()
    return st.session_state["stim_presets"]


def _collect_slider_cv_values(preset_name: str, presets: dict) -> dict:
    """Read current slider values from session state using CV keys."""
    preset = presets.get(preset_name, {})
    slider_defs = preset.get("sliders", [])
    vals = {}
    for sl in slider_defs:
        cv = sl["cv"]
        # Read from session state (set by slider widget)
        val = st.session_state.get(f"stim_slider_{preset_name}_{cv}")
        if val is not None:
            vals[cv] = val
    return vals


# ── Channel generation via funscript-tools ────────────────────────────

def _run_process(funscript_path: str, preset_name: str, slider_overrides: dict,
                 output_dir: str, status) -> dict | None:
    """Call funscript-tools process() and report progress.

    Returns the result dict or None on failure.
    """
    from forge.funscript_tools import build_config, process

    config = build_config(preset_name, slider_overrides, output_dir=output_dir)

    def _progress(pct, msg):
        if pct >= 0:
            status.update(label=f"{msg} ({pct}%)")

    status.update(label=f"Running funscript-tools pipeline ({preset_name})…")
    result = process(funscript_path, config, _progress)

    if not result["success"]:
        status.update(label=f"Error: {result['error']}", state="error")
        return None

    for out in result["outputs"]:
        size_kb = out["size_bytes"] / 1024
        status.write(f"✅ {out['suffix']} ({size_kb:.1f} KB)")

    return result


def _read_channel_from_file(output_dir: str, stem: str,
                            suffix: str) -> tuple[list[float], list[float]] | None:
    """Read a generated channel .funscript file back as (times_s, positions)."""
    path = Path(output_dir) / f"{stem}.{suffix}.funscript"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    actions = data.get("actions", [])
    if not actions:
        return None
    times_s = [a["at"] / 1000.0 for a in actions]
    positions = [a["pos"] for a in actions]
    return times_s, positions


# ── Public render ─────────────────────────────────────────────────────

def render(project=None) -> None:
    forge = st.session_state.get("forge_project")

    # Graceful fallback if funscript-tools is not available
    if not _FT_AVAILABLE:
        st.warning(
            "**Stim tab requires funscript-tools.**\n\n"
            "Clone it as a sibling directory:\n"
            "```\ngit clone https://github.com/liquid-releasing/funscript-tools ../funscript-tools\n```\n\n"
            "Incorporates the significant work of "
            "[Edger's funscript-tools](https://github.com/edger477/funscript-tools)."
        )
        return

    presets = _get_presets()
    if not presets:
        st.error("No presets found in funscript-tools.")
        return

    st.info(
        "**Stim** shapes how your funscript translates to electrical stimulation. "
        "Each character controls the electrode sweep path, pulse timing, and intensity curve. "
        "Pick one, adjust the sliders, preview the channels, then Accept."
    )

    selected = st.session_state.get("stim_character", None)

    # ── Character cards ───────────────────────────────────────────────
    preset_names = list(presets.keys())
    cols = st.columns(len(preset_names))
    for col, name in zip(cols, preset_names):
        with col:
            style = _CARD_STYLE.get(name, {"color": "#888", "path_shape": "circle", "tagline": ""})
            is_sel = (selected == name)
            border = f"border: 3px solid {style['color']};" if is_sel else "border: 1px solid #333;"
            opacity = "opacity: 1.0;" if is_sel else "opacity: 0.7;"

            # Title card: name + tagline
            st.markdown(
                f'<div style="padding: 8px; border-radius: 8px 8px 0 0; {border} {opacity} text-align: center;">'
                f'<strong style="color: {style["color"]};">{name}</strong><br>'
                f'<span style="font-size: 0.85em; color: #888;">{style["tagline"]}</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

            # Flip button
            _flip_key = f"stim_flip_{name}"
            _is_flipped = st.session_state.get(_flip_key, False)
            _flip_icon = "🖼️" if _is_flipped else "ℹ️"
            if st.button(_flip_icon, key=f"stim_flip_btn_{name}", use_container_width=True):
                st.session_state[_flip_key] = not _is_flipped
                st.rerun()

            # Flip area: electrode path art OR description
            if _is_flipped:
                desc = presets[name].get("description", "")
                st.markdown(
                    f'<div style="padding: 8px; {border} border-radius: 0 0 8px 8px; {opacity}">'
                    f'<span style="font-size: 0.75em; color: #ccc; line-height: 1.4;">'
                    f'{desc}</span></div>',
                    unsafe_allow_html=True,
                )
            else:
                png = _render_path_png(style["path_shape"], style["color"])
                st.image(png, use_container_width=True)

            # Select button
            if is_sel:
                st.button("✓ Selected", key=f"stim_sel_{name}", disabled=True, use_container_width=True)
            else:
                if st.button("Select", key=f"stim_sel_{name}", use_container_width=True):
                    st.session_state["stim_character"] = name
                    st.session_state.pop("stim_accepted", None)
                    st.session_state.pop("stim_result", None)
                    st.rerun()

    if not selected or selected not in presets:
        return

    st.divider()

    # ── Sliders from preset definitions ───────────────────────────────
    preset = presets[selected]
    slider_defs = preset.get("sliders", [])
    style = _CARD_STYLE.get(selected, {"color": "#888", "path_shape": "circle"})

    col_path, col_sliders = st.columns([1, 2])

    slider_vals = {}
    with col_sliders:
        for sl in slider_defs:
            cv = sl["cv"]
            val = st.slider(
                sl["label"],
                min_value=float(sl["from_"]),
                max_value=float(sl["to_"]),
                value=float(sl["from_"] + sl["to_"]) / 2.0,
                help=sl.get("hint", ""),
                key=f"stim_slider_{selected}_{cv}",
            )
            slider_vals[cv] = val

    # Dynamic electrode path — responds to sweep width slider
    # Round to 2 decimals so cache isn't busted by float precision
    _radius = round(slider_vals.get("cv_min_dist", 0.3), 2)
    with col_path:
        png = _render_path_png(style["path_shape"], style["color"], radius=_radius, height_px=200)
        st.image(png, use_container_width=True)

    st.divider()

    # ── Preview button — generates to temp dir ────────────────────────
    _input_path = _get_input_funscript_path()
    if not _input_path:
        st.warning("Load a funscript on the Project tab first.")
        return

    if st.button("👁 Preview channels", type="secondary", use_container_width=True,
                 help="Generate channel previews from current settings."):
        with st.status("Generating preview…", expanded=True) as status:
            _tmp = tempfile.mkdtemp(prefix="stim_preview_")
            # Copy input funscript to temp dir so process() can find it
            _tmp_input = Path(_tmp) / Path(_input_path).name
            _tmp_input.write_text(Path(_input_path).read_text(encoding="utf-8"), encoding="utf-8")

            result = _run_process(str(_tmp_input), selected, slider_vals, _tmp, status)
            if result:
                st.session_state["stim_preview_dir"] = _tmp
                st.session_state["stim_preview_stem"] = _tmp_input.stem
                status.update(label="Preview ready", state="complete", expanded=False)
        st.rerun()

    st.divider()

    # ── Channel previews — read from generated files ──────────────────
    _render_channel_previews()

    st.divider()

    # ── Accept — generates to real output folder ──────────────────────
    if st.button("Accept", type="primary", use_container_width=True,
                 help="Generate estim channel files in your output folder."):
        if not forge or not forge.get("output_folder"):
            st.error("Accept on the Project tab first.")
        else:
            output_folder = forge["output_folder"]
            Path(output_folder).mkdir(parents=True, exist_ok=True)

            # Write the shaped funscript to output as the main .funscript
            project_name = forge.get("name", Path(_input_path).stem)
            main_output = Path(output_folder) / f"{project_name}.funscript"
            main_output.write_text(
                Path(_input_path).read_text(encoding="utf-8"), encoding="utf-8"
            )

            with st.status("Generating estim channels…", expanded=True) as status:
                status.write(f"✅ Character: **{selected}**")
                status.write(f"✅ Input: {main_output.name}")

                result = _run_process(str(main_output), selected, slider_vals,
                                      output_folder, status)
                if result:
                    # Save settings to forge project
                    forge["stim_character"] = selected
                    forge["stim_sliders"] = slider_vals
                    forge.setdefault("progress", {})["stim_generated"] = True
                    forge.setdefault("history", []).append({
                        "tab": "stim",
                        "timestamp": datetime.now().isoformat(),
                        "character": selected,
                        "sliders": slider_vals,
                    })
                    from forge.project import save_forge
                    save_forge(forge)
                    status.write("✅ Settings saved to project")

                    # Store for preview
                    st.session_state["stim_preview_dir"] = output_folder
                    st.session_state["stim_preview_stem"] = project_name
                    st.session_state["stim_accepted"] = True
                    st.session_state["stim_result"] = result

                    n_files = len(result["outputs"])
                    status.update(label=f"Stim complete — {n_files} channel files generated",
                                  state="complete", expanded=False)
            st.rerun()

    if st.session_state.get("stim_accepted"):
        result = st.session_state.get("stim_result", {})
        n_files = len(result.get("outputs", []))
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            f"**{selected}** estim channels generated ({n_files} files). "
            "Your next step is **Export**."
        )

    # Credit
    st.caption(
        "Incorporates the significant work of "
        "[Edger's funscript-tools](https://github.com/edger477/funscript-tools). "
        "💬 Feedback? [Discord](https://discord.gg/funscriptforge)"
    )


# ── Channel preview rendering ─────────────────────────────────────────

def _render_channel_previews() -> None:
    """Show input funscript + all generated channel previews.

    Reads channel files from disk (preview temp dir or output folder).
    """
    preview_dir = st.session_state.get("stim_preview_dir")
    preview_stem = st.session_state.get("stim_preview_stem")

    st.subheader("Channel previews")

    # Input funscript
    _input_path = _get_input_funscript_path()

    # Key channels to show (funscript-tools generates these)
    _CHANNELS = [
        ("alpha", "Alpha — electrode position L/R"),
        ("beta", "Beta — electrode position U/D"),
        ("pulse_frequency", "Pulse frequency — intensity tracking"),
        ("frequency", "Frequency — primary modulation"),
        ("volume", "Volume — overall level"),
    ]

    # Row 1: Input funscript (full width)
    st.caption("**Input funscript**")
    if _input_path:
        from forge.funscript import load_funscript, parse_actions
        _data = load_funscript(_input_path)
        _times, _pos = parse_actions(_data)
        if _times:
            _t_s = [t / 1000.0 for t in _times]
            render_static_from_arrays(_t_s, _pos, color_mode="velocity",
                                      height_px=150, width_px=1200)
    else:
        st.caption("_Load a funscript on the Project tab._")

    # Row 2+: Generated channels
    if not preview_dir or not preview_stem:
        st.caption("_Click **Preview** or **Accept** to generate channels._")
        return

    # Show all channels that exist
    for suffix, label in _CHANNELS:
        channel_data = _read_channel_from_file(preview_dir, preview_stem, suffix)
        if channel_data:
            st.caption(f"**{label}**")
            render_static_from_arrays(channel_data[0], channel_data[1],
                                      height_px=120, width_px=1200)
