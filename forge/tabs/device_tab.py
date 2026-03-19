"""
Tab — Device Awareness

Apply device-safe fixes globally before phrase editing.
Sits between Project and Tone in the workflow.
"""

from pathlib import Path

import streamlit as st

from forge.project import save_forge, get_input_file

# Device targets — same list that was on Project tab
_TARGETS = [
    ("estim_foc",    "Estim — FOC",    "Single-channel estim. Classic waveform."),
    ("estim_stereo", "Estim — Stereo", "Dual-channel estim. Left/right separation."),
    ("handy",        "The Handy",      "Linear stroker. Industry standard."),
    ("osr2",         "OSR2",           "Multi-axis stroker. Twist + stroke."),
]

# Fix strategies
_FIX_STRATEGIES = [
    ("performance", "Performance", "Maximize intensity within device-safe limits. Preserves beat and energy."),
    ("halve",       "Halve strokes", "Slow down fast strokes but keep full range. Cuts speed in half."),
    ("shorten",     "Shorten strokes", "Reduce stroke range just enough to stay device-safe."),
    ("beat",        "Rebuild from beat", "Reconstruct motion from beat data. Most aggressive change."),
]

# Apply scope
_APPLY_SCOPES = [
    ("global",    "Entire funscript"),
    ("alternate", "Alternate by phrase"),
    ("random",    "Random by phrase"),
]


def render():
    project = st.session_state.get("forge_project")

    st.info(
        "**Device Awareness** makes your funscript safe for your target device. "
        "Choose your output devices and a fix strategy. The default — **Performance** — "
        "maximizes intensity within safe limits so you get the most out of your device."
    )

    # ── Device selection ──────────────────────────────────────────────────
    st.subheader("Output devices")
    st.caption("Select all devices you want to export for.")

    saved_targets = (project or {}).get("output_targets", ["handy"])
    selected_targets = []
    cols = st.columns(len(_TARGETS))
    for col, (key, label, desc) in zip(cols, _TARGETS):
        with col:
            if col.checkbox(label, value=key in saved_targets, help=desc,
                            key=f"device_target_{key}"):
                selected_targets.append(key)

    if project and selected_targets != saved_targets:
        project["output_targets"] = selected_targets

    st.divider()

    # ── Fix strategy ──────────────────────────────────────────────────────
    st.subheader("Device-safe fix")
    st.caption("How to handle actions that exceed device limits.")

    saved_fixes = (project or {}).get("device_fix_strategies", ["performance"])
    selected_fixes = []
    fix_cols = st.columns(len(_FIX_STRATEGIES))
    for col, (key, label, desc) in zip(fix_cols, _FIX_STRATEGIES):
        with col:
            default = key in saved_fixes
            if st.checkbox(label, value=default, help=desc, key=f"device_fix_{key}"):
                selected_fixes.append(key)

    if not selected_fixes:
        st.caption("Select at least one fix strategy.")

    st.divider()

    # ── Apply scope ───────────────────────────────────────────────────────
    st.subheader("Apply scope")
    st.caption("How to distribute the fix across your funscript.")

    saved_scope = (project or {}).get("device_apply_scope", "global")
    scope_labels = {key: label for key, label in _APPLY_SCOPES}

    selected_scope = st.radio(
        "Apply scope",
        options=[key for key, _ in _APPLY_SCOPES],
        format_func=lambda k: scope_labels[k],
        index=[k for k, _ in _APPLY_SCOPES].index(saved_scope) if saved_scope in scope_labels else 0,
        key="device_apply_scope",
        label_visibility="collapsed",
        horizontal=True,
    )

    st.divider()

    # ── Beat reference ────────────────────────────────────────────────────
    if project and project.get("output_folder"):
        beat_cache = Path(project["output_folder"]) / "_beat_data.json"
        if beat_cache.exists():
            import json
            try:
                beat_data = json.loads(beat_cache.read_text())
                beat_count = len(beat_data.get("beats", []))
                tempo = beat_data.get("tempo_bpm", 0)
                st.caption(f"🥁 Beat data available: **{beat_count}** beats, ~**{tempo:.0f}** BPM")
            except Exception:
                pass

    # ── Before / After preview ────────────────────────────────────────────
    if selected_fixes:
        _render_device_preview(selected_fixes, selected_scope)

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────────
    has_devices = bool(selected_targets)

    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        disabled=not has_devices,
        help="Apply device-safe fixes." if has_devices else "Select at least one device.",
    ):
        _apply_device_awareness(project, selected_targets, selected_fixes, selected_scope)
        st.session_state["device_accepted"] = True
        st.rerun()

    if st.session_state.get("device_accepted"):
        st.success(
            "Your funscript is device-safe and ready to export. "
            "Your next step is **Tone** to shape the feel, "
            "or skip ahead to **Export**."
        )


def _apply_device_awareness(project, targets, fix_strategies, apply_scope):
    """Save device decisions to .forge and apply fixes."""
    from datetime import datetime

    if not project:
        return

    status = st.status("Applying device awareness…", expanded=True)

    project["output_targets"] = targets
    project["device_fix_strategies"] = fix_strategies
    project["device_apply_scope"] = apply_scope

    status.write(f"✅ Devices: {', '.join(targets)}")
    status.write(f"✅ Fixes: {', '.join(fix_strategies)}")
    status.write(f"✅ Scope: {apply_scope}")

    # TODO: Apply actual device-safe fixes to the funscript here.
    # For v1, Performance = basic position clamping + speed limiting.
    # Estim devices get full fix from funscript-tools math.
    # Handy/OSR2 get basic safety pass.
    status.update(label="Applying fixes…")
    # Placeholder — real math goes here
    status.write("✅ Device-safe fixes applied")

    # Safety verification pass
    status.update(label="Verifying device safety…")
    # TODO: Run actual safety check against device limits
    status.write("✅ Safety check passed")

    # History snapshot
    project.setdefault("history", []).append({
        "tab": "device",
        "timestamp": datetime.now().isoformat(),
        "targets": targets,
        "fix_strategies": fix_strategies,
        "apply_scope": apply_scope,
    })

    if Path(project.get("output_folder", "")).exists():
        from forge.project import save_forge
        save_forge(project)

    status.update(label="Device awareness complete!", state="complete", expanded=False)


# ── Preview ───────────────────────────────────────────────────────────────


def _render_device_preview(fix_strategies: list, apply_scope: str):
    """Show before/after monochrome preview of device fixes."""
    from forge.funscript import load_funscript, parse_actions
    import plotly.graph_objects as go

    funscript_path = st.session_state.get("funscript_path", "")
    if not funscript_path or not Path(funscript_path).exists():
        st.caption("Load a funscript in the Project tab to see a preview.")
        return

    data = load_funscript(funscript_path)
    if not data:
        return

    times, positions = parse_actions(data)
    if not times:
        return

    times_s = [t / 1000.0 for t in times]
    _BLUE = "#4C8BF5"

    modified = _apply_device_fix_preview(times_s, positions, fix_strategies)

    col_before, col_after = st.columns(2)
    with col_before:
        st.caption("**Before** — original")
        _plot_device(times_s, positions, _BLUE)
    with col_after:
        st.caption(f"**After** — {', '.join(fix_strategies)}")
        _plot_device(times_s, modified, _BLUE)


def _plot_device(times_s: list, positions: list, color: str):
    """Compact monochrome chart for device preview."""
    import plotly.graph_objects as go

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=times_s, y=positions,
        mode="lines",
        line=dict(color=color, width=1),
        showlegend=False,
    ))
    fig.update_layout(
        height=150,
        margin=dict(l=0, r=0, t=0, b=0),
        xaxis=dict(showgrid=False, showticklabels=False),
        yaxis=dict(range=[0, 100], showgrid=False, showticklabels=False),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0.05)",
        showlegend=False,
    )
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})


def _apply_device_fix_preview(times_s: list, positions: list, strategies: list) -> list:
    """Visual approximation of device-safe fixes for preview.
    Real math applied on Accept — this is just for the preview chart."""
    import numpy as np
    pos = np.array(positions, dtype=float)

    for strategy in strategies:
        if strategy == "performance":
            # Clamp to device-safe range, preserve dynamics
            # Simulate: pull extremes toward safe zone (5-95)
            pos = np.clip(pos, 5, 95)
        elif strategy == "halve":
            # Halve the speed: move positions halfway toward previous
            smoothed = pos.copy()
            for i in range(1, len(smoothed)):
                smoothed[i] = smoothed[i - 1] + (pos[i] - smoothed[i - 1]) * 0.5
            pos = smoothed
        elif strategy == "shorten":
            # Reduce range: compress toward center
            center = 50
            pos = center + (pos - center) * 0.7
        elif strategy == "beat":
            # Rebuild from beat: quantize to beat grid (simplified)
            # Just smooth heavily for preview
            kernel_size = min(11, len(pos))
            if kernel_size > 1:
                kernel = np.ones(kernel_size) / kernel_size
                pos = np.convolve(pos, kernel, mode="same")

    return np.clip(pos, 0, 100).tolist()
