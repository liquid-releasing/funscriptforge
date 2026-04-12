# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus 4.6).

"""
Tab — Multi-axis

Per-phrase position style assignment for secondary axes (roll, pitch,
twist, surge, sway). Generates axis funscripts at export time from
algorithmic presets derived from the L0 stroke data.
"""

import streamlit as st

from forge.multiaxis_presets import MULTIAXIS_PRESETS, STYLE_NAMES, AXIS_SUFFIXES
from utils import ms_to_timestamp


def render(project=None):
    forge = st.session_state.get("forge_project")

    st.info(
        "**Multi-axis** generates roll, pitch, twist, surge, and sway funscripts "
        "from your primary stroke data. Pick a position style per phrase — "
        "the secondary axes are derived algorithmically at export time. "
        "No video or hand-scripting needed."
    )

    # Need assessment with phrases
    if not project or not project.is_loaded:
        st.caption("Load a funscript on the **Project** tab first.")
        return

    assessment_dict = project.assessment.to_dict()
    phrases = assessment_dict.get("phrases", [])
    if not phrases:
        st.caption("No phrases detected — run through **Tone** first.")
        return

    # ── Funscript reference chart (so user sees what they're styling) ──
    from forge_ui_components.funscript_chart.cache import ChartCache
    cache = ChartCache.from_session_state()
    _latest_series, _stage = cache.get_latest_series()
    if _latest_series:
        st.caption("**Your funscript** — reference while assigning styles")
        from forge_ui_components.funscript_chart.streamlit import render_static
        bands = cache.get_bands()
        png = cache.render_png(_stage, with_bands=True, height_px=180, width_px=1400)
        if png:
            st.image(png, use_container_width=True)

    st.divider()

    # ── Style descriptions (above the table for reference) ───────────
    with st.expander("Style descriptions", expanded=False):
        for name in STYLE_NAMES:
            if name == "None":
                st.caption("**None** — No secondary axes. Device stays centered.")
                continue
            preset = MULTIAXIS_PRESETS.get(name, {})
            desc = preset.get("_description", "")
            axes_used = [k for k in preset if not k.startswith("_")]
            st.caption(
                f"**{name}** — {desc} "
                f"Axes: {', '.join(axes_used) if axes_used else 'none'}."
            )

    # ── Apply-to-all ──────────────────────────────────────────────────
    st.subheader("Position styles")
    st.caption(
        "Assign a position style to each phrase. The style determines "
        "how the secondary axes (roll, pitch, twist, surge, sway) "
        "relate to the primary stroke. Different styles simulate "
        "different physical positions."
    )

    col_apply, col_style = st.columns([1, 2])
    with col_style:
        _bulk_style = st.selectbox(
            "Apply to all phrases",
            STYLE_NAMES,
            index=0,
            key="multiaxis_bulk_style",
            label_visibility="collapsed",
        )
    with col_apply:
        if st.button("Apply to all", use_container_width=True):
            for i in range(len(phrases)):
                st.session_state[f"multiaxis_style_{i}"] = _bulk_style
            st.rerun()

    st.divider()

    # ── Phrase table with style dropdown ──────────────────────────────
    # Read current assignments from session state or project
    saved_styles = (forge or {}).get("multiaxis_styles", {})

    # Header row
    cols = st.columns([0.4, 1.2, 0.8, 0.6, 1.5, 2.0])
    cols[0].caption("**#**")
    cols[1].caption("**Time**")
    cols[2].caption("**Duration**")
    cols[3].caption("**BPM**")
    cols[4].caption("**Tag**")
    cols[5].caption("**Multi-axis style**")

    style_assignments: dict[int, str] = {}

    for i, phrase in enumerate(phrases):
        start_ms = phrase.get("start_ms", 0)
        end_ms = phrase.get("end_ms", 0)
        dur_s = (end_ms - start_ms) / 1000.0
        bpm = phrase.get("bpm", 0)
        tags = phrase.get("tags", [])
        if tags:
            tag_str = ", ".join(tags[:2])
        else:
            # Derive a brief descriptor from BPM + amplitude when no tags
            tag_str = _describe_phrase(phrase)

        # Get saved style for this phrase
        saved = saved_styles.get(str(i), "None")
        session_key = f"multiaxis_style_{i}"
        if session_key not in st.session_state:
            st.session_state[session_key] = saved

        cols = st.columns([0.4, 1.2, 0.8, 0.6, 1.5, 2.0])
        cols[0].caption(f"{i + 1}")
        cols[1].caption(ms_to_timestamp(start_ms))
        cols[2].caption(f"{dur_s:.1f}s")
        cols[3].caption(f"{bpm:.0f}" if bpm else "—")
        cols[4].caption(tag_str)
        with cols[5]:
            chosen = st.selectbox(
                f"Style for phrase {i + 1}",
                STYLE_NAMES,
                index=STYLE_NAMES.index(st.session_state[session_key])
                if st.session_state[session_key] in STYLE_NAMES else 0,
                key=f"multiaxis_sel_{i}",
                label_visibility="collapsed",
            )
            st.session_state[session_key] = chosen

        if chosen and chosen != "None":
            style_assignments[i] = chosen

    st.divider()

    # ── Summary ──────────────────────────────────────────────────────
    if not style_assignments:
        st.caption(
            "All phrases set to **None** — no multi-axis files will be generated. "
            "Pick a style for at least one phrase to enable multi-axis export."
        )
    else:
        # Count styles
        style_counts: dict[str, int] = {}
        for s in style_assignments.values():
            style_counts[s] = style_counts.get(s, 0) + 1
        summary = ", ".join(f"{s}: {c}" for s, c in sorted(style_counts.items()))
        st.caption(f"**{len(style_assignments)}** of {len(phrases)} phrases styled ({summary})")

        # Show which axes will be generated
        needed_axes: set[str] = set()
        for style_name in style_assignments.values():
            preset = MULTIAXIS_PRESETS.get(style_name, {})
            for axis_name, cfg in preset.items():
                if not axis_name.startswith("_") and isinstance(cfg, dict) and cfg.get("algorithm", "none") != "none":
                    needed_axes.add(axis_name)
        if needed_axes:
            axis_files = [f"`{AXIS_SUFFIXES[a]}`" for a in sorted(needed_axes) if a in AXIS_SUFFIXES]
            st.caption(f"Axes to generate: {', '.join(axis_files)}")

    st.divider()

    # ── Preview ──────────────────────────────────────────────────────
    if style_assignments:
        if st.button("Preview", type="secondary", use_container_width=True,
                     help="Generate and preview the secondary axis signals."):
            _generate_preview(project, phrases, style_assignments)

        _render_preview()

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────
    if st.button("Accept", type="primary", use_container_width=True,
                 help="Save multi-axis assignments. Files are generated at Export time."):
        if forge:
            # Save as string-keyed dict for JSON serialization
            forge["multiaxis_styles"] = {str(k): v for k, v in style_assignments.items()}
            forge.setdefault("progress", {})["multiaxis_assigned"] = bool(style_assignments)
            from forge.project import save_forge
            try:
                save_forge(forge)
            except OSError:
                pass  # folder may not exist yet
        st.session_state["multiaxis_accepted"] = True
        st.rerun()

    if st.session_state.get("multiaxis_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        if style_assignments:
            success_guidance(
                f"Multi-axis styles saved ({len(style_assignments)} phrases). "
                "Files will be generated when you **Export**."
            )
        else:
            success_guidance(
                "No multi-axis styles assigned. Export will skip secondary axis files."
            )


# ── Phrase description helper ─────────────────────────────────────────


def _describe_phrase(phrase: dict) -> str:
    """Derive a brief behavioral label from BPM and amplitude when no
    assessment tags are available. Gives the user a sense of what's
    happening in each phrase to help them pick a style."""
    bpm = phrase.get("bpm", 0)
    amp = phrase.get("amplitude", phrase.get("pos_range", 0))
    # pos_range may not exist; fall back to estimating from min/max
    pos_min = phrase.get("pos_min", 0)
    pos_max = phrase.get("pos_max", 100)
    if not amp:
        amp = pos_max - pos_min

    if bpm <= 0:
        return "quiet"
    elif bpm < 60:
        return "slow" if amp > 40 else "gentle"
    elif bpm < 100:
        return "steady" if amp > 30 else "subtle"
    elif bpm < 140:
        return "active" if amp > 50 else "moderate"
    elif bpm < 180:
        return "fast" if amp > 40 else "driven"
    else:
        return "intense" if amp > 50 else "rapid"


# ── Preview helpers ──────────────────────────────────────────────────


def _generate_preview(project, phrases, style_assignments):
    """Generate multi-axis signals and cache for preview rendering."""
    from forge.multiaxis import generate_multiaxis
    from forge.funscript import load_funscript

    funscript_path = st.session_state.get("funscript_path", "")
    chain_path = st.session_state.get("chain_funscript_path", "")
    path = chain_path or funscript_path
    if not path:
        return

    data = load_funscript(path)
    if not data:
        return

    actions = data.get("actions", [])
    with st.status("Generating multi-axis preview…", expanded=True) as status:
        result = generate_multiaxis(
            actions, phrases, style_assignments, MULTIAXIS_PRESETS,
        )
        active = result.active_axes()
        status.write(f"✅ {len(active)} axes generated")
        for axis_name in sorted(active.keys()):
            sig = active[axis_name]
            status.write(f"  • {axis_name}: {len(sig.times_ms):,} points")
        status.update(label="Preview ready", state="complete", expanded=False)

    # Cache the result for rendering
    st.session_state["_multiaxis_preview"] = result
    st.session_state["_multiaxis_preview_actions"] = actions
    st.rerun()


def _render_preview():
    """Render cached multi-axis preview as monochrome charts."""
    result = st.session_state.get("_multiaxis_preview")
    actions = st.session_state.get("_multiaxis_preview_actions")
    if result is None or actions is None:
        return

    from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays

    active = result.active_axes()
    if not active:
        return

    st.subheader("Multi-axis preview")

    # Row 1: L0 stroke (the input)
    _times_s = [a["at"] / 1000.0 for a in actions]
    _pos = [a["pos"] for a in actions]

    _CH_H = 120
    _CH_W = 400

    # Arrange: funscript first, then axes 3-across
    st.caption("**L0 Stroke (input)**")
    render_monochrome_from_arrays(_times_s, _pos, height=_CH_H)

    # Secondary axes in rows of 3
    axis_names = sorted(active.keys())
    _DISPLAY_NAMES = {
        "roll": "R1 Roll (tilt L/R)",
        "pitch": "R2 Pitch (tilt F/B)",
        "twist": "R0 Twist (rotation)",
        "surge": "L1 Surge (fwd/back)",
        "sway": "L2 Sway (left/right)",
    }

    for row_start in range(0, len(axis_names), 3):
        row_axes = axis_names[row_start:row_start + 3]
        cols = st.columns(3)
        for col, axis_name in zip(cols, row_axes):
            sig = active[axis_name]
            t_s = [t / 1000.0 for t in sig.times_ms]
            with col:
                st.caption(f"**{_DISPLAY_NAMES.get(axis_name, axis_name)}**")
                render_monochrome_from_arrays(t_s, sig.positions,
                                              height=_CH_H)
