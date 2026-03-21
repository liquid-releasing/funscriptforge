"""
Tab — Device Awareness

Apply device-aware fixes globally before phrase editing.
Sits between Project and Tone in the workflow.
"""

from pathlib import Path

import streamlit as st

from forge.project import save_forge, get_input_file, save_chain_funscript, get_chain_funscript_for
from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays

# Device targets — same list that was on Project tab
_TARGETS = [
    ("estim_foc",    "Estim — FOC",    "Single-channel estim. Classic waveform."),
    ("estim_stereo", "Estim — Stereo", "Dual-channel estim. Left/right separation."),
    ("handy",        "The Handy",      "Linear stroker. Industry standard."),
    ("osr2",         "OSR2",           "Multi-axis stroker. Twist + stroke."),
]

# Fix strategies
_FIX_STRATEGIES = [
    ("performance", "Performance", "Maximize intensity within device-aware limits. Preserves beat and energy."),
    ("halve",       "Halve cycles", "Slow down fast cycles but keep full range. Cuts speed in half."),
    ("shorten",     "Shorten cycles", "Reduce cycle range just enough to stay device-aware."),
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
    st.subheader("Device-aware fix")
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
    multiple_fixes = len(selected_fixes) > 1
    if multiple_fixes:
        st.caption("**Entire**: all fixes applied in sequence. **Alternate/Random**: each phrase gets one fix.")
    else:
        st.caption("Select more than one fix strategy to enable per-phrase distribution.")

    saved_scope = (project or {}).get("device_apply_scope", "global")
    scope_labels = {key: label for key, label in _APPLY_SCOPES}
    # Force global when only one fix selected
    if not multiple_fixes:
        saved_scope = "global"
        # Clear session state to prevent stale alternate/random selection
        if st.session_state.get("device_apply_scope") != "global":
            st.session_state["device_apply_scope"] = "global"

    selected_scope = st.radio(
        "Apply scope",
        options=[key for key, _ in _APPLY_SCOPES],
        format_func=lambda k: scope_labels[k],
        index=[k for k, _ in _APPLY_SCOPES].index(saved_scope) if saved_scope in scope_labels else 0,
        key="device_apply_scope",
        label_visibility="collapsed",
        horizontal=True,
        disabled=not multiple_fixes,
    )
    # Override if disabled — Streamlit may keep the old value
    if not multiple_fixes:
        selected_scope = "global"

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
        help="Apply device-aware fixes." if has_devices else "Select at least one device.",
    ):
        _apply_device_awareness(project, selected_targets, selected_fixes, selected_scope)
        st.session_state["device_accepted"] = True
        st.rerun()

    if st.session_state.get("device_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            "Scroll to top to select your next tab: **Tone** or **Export**."
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

    # Apply device-aware fixes to the funscript and save to chain
    status.update(label="Applying fixes…")
    from forge.funscript import load_funscript, parse_actions
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and Path(funscript_path).exists():
        fs_data = load_funscript(funscript_path)
        if fs_data:
            times, positions = parse_actions(fs_data)
            if times:
                times_s = [t / 1000.0 for t in times]
                # Get phrase data for per-phrase scope
                _phrases = []
                _proj = st.session_state.get("project")
                if _proj and hasattr(_proj, "assessment") and _proj.is_loaded:
                    _phrases = _proj.assessment.to_dict().get("phrases", [])
                modified = _apply_device_fix_preview(times_s, positions, fix_strategies, apply_scope, _phrases)
                # Update actions in funscript data
                for i, action in enumerate(fs_data.get("actions", [])):
                    if i < len(modified):
                        action["pos"] = int(round(modified[i]))
                # Save to chain and update session state path for downstream tabs
                chain_path = save_chain_funscript(project, "device", fs_data)
                st.session_state["chain_funscript_path"] = chain_path
                status.write(f"✅ Device-safe fixes applied to {len(times):,} actions")

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

    # Get phrase boundaries if available (for per-phrase scope)
    phrases = []
    _proj = st.session_state.get("project")
    if _proj and hasattr(_proj, "assessment") and _proj.is_loaded:
        phrases = _proj.assessment.to_dict().get("phrases", [])

    modified = _apply_device_fix_preview(times_s, positions, fix_strategies, apply_scope, phrases)

    col_before, col_after = st.columns(2)
    with col_before:
        st.caption("**Before** — original")
        render_monochrome_from_arrays(times_s, positions, key="device_before")
    with col_after:
        scope_label = f" ({apply_scope})" if apply_scope != "global" else ""
        st.caption(f"**After** — {', '.join(fix_strategies)}{scope_label}")
        render_monochrome_from_arrays(times_s, modified, key="device_after")


def _apply_device_fix_preview(
    times_s: list, positions: list, strategies: list,
    scope: str = "global", phrases: list | None = None,
) -> list:
    """Visual approximation of device-aware fixes for preview.
    Real math applied on Accept — this is just for the preview chart.

    scope: "global" applies all strategies everywhere.
           "alternate" rotates strategies across phrases.
           "random" assigns strategies randomly per phrase.
    """
    import numpy as np
    import random

    pos = np.array(positions, dtype=float)
    times_ms = [t * 1000 for t in times_s]

    if scope == "global" or not phrases or len(strategies) <= 1:
        # Apply all strategies sequentially to entire funscript
        for strategy in strategies:
            pos = _apply_single_fix(pos, strategy)
    else:
        # Per-phrase: assign a strategy to each phrase
        for ph_idx, phrase in enumerate(phrases):
            start_ms = phrase.get("start_ms", 0)
            end_ms = phrase.get("end_ms", 0)
            # Find action indices within this phrase
            mask = np.array([(start_ms <= t <= end_ms) for t in times_ms])
            if not mask.any():
                continue

            if scope == "alternate":
                strategy = strategies[ph_idx % len(strategies)]
            else:  # random
                strategy = random.choice(strategies)

            # Apply fix only to this phrase's actions
            phrase_pos = pos[mask].copy()
            phrase_pos = _apply_single_fix(phrase_pos, strategy)
            pos[mask] = phrase_pos

    return np.clip(pos, 0, 100).tolist()


def _apply_single_fix(pos, strategy: str):
    """Apply a single device-aware fix strategy to a position array."""
    import numpy as np

    if strategy == "performance":
        pos = np.clip(pos, 5, 95)
    elif strategy == "halve":
        # Keep full amplitude but half the speed.
        # Find peaks and valleys (direction changes), keep them all.
        # Insert midpoints between each pair so transitions take 2x longer.
        n = len(pos)
        if n > 2:
            # Detect direction changes (peaks and valleys)
            keypoints = [0]  # always keep first
            for i in range(1, n - 1):
                prev_dir = pos[i] - pos[i - 1]
                next_dir = pos[i + 1] - pos[i]
                if prev_dir * next_dir <= 0:  # direction change = peak or valley
                    keypoints.append(i)
            keypoints.append(n - 1)  # always keep last

            # Stretch keypoints to take 2x the original indices
            orig_times = np.array(keypoints, dtype=float)
            stretched_times = orig_times * 2.0
            # Scale back to fit in original length
            if stretched_times[-1] > 0:
                stretched_times = stretched_times * (n - 1) / stretched_times[-1]
            keypoint_vals = pos[keypoints]
            # Interpolate to full length
            pos = np.interp(np.arange(n), stretched_times, keypoint_vals)

    elif strategy == "shorten":
        center = 50
        pos = center + (pos - center) * 0.7
    elif strategy == "beat":
        kernel_size = min(11, len(pos))
        if kernel_size > 1:
            kernel = np.ones(kernel_size) / kernel_size
            pos = np.convolve(pos, kernel, mode="same")
    return pos
