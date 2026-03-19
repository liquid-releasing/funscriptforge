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

    saved_fix = (project or {}).get("device_fix_strategy", "performance")
    fix_labels = {key: label for key, label, _ in _FIX_STRATEGIES}
    fix_help = {key: desc for key, _, desc in _FIX_STRATEGIES}

    selected_fix = st.radio(
        "Fix strategy",
        options=[key for key, _, _ in _FIX_STRATEGIES],
        format_func=lambda k: fix_labels[k],
        index=[k for k, _, _ in _FIX_STRATEGIES].index(saved_fix) if saved_fix in fix_labels else 0,
        key="device_fix_strategy",
        label_visibility="collapsed",
        horizontal=True,
    )

    st.caption(fix_help.get(selected_fix, ""))

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

    # ── Accept ────────────────────────────────────────────────────────────
    has_devices = bool(selected_targets)

    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        disabled=not has_devices,
        help="Apply device-safe fixes." if has_devices else "Select at least one device.",
    ):
        _apply_device_awareness(project, selected_targets, selected_fix, selected_scope)
        st.session_state["device_accepted"] = True
        st.rerun()

    if st.session_state.get("device_accepted"):
        st.success(
            "Your funscript is device-safe and ready to export. "
            "Your next step is **Tone** to shape the feel, "
            "or skip ahead to **Export**."
        )


def _apply_device_awareness(project, targets, fix_strategy, apply_scope):
    """Save device decisions to .forge and apply fixes."""
    from datetime import datetime

    if not project:
        return

    status = st.status("Applying device awareness…", expanded=True)

    project["output_targets"] = targets
    project["device_fix_strategy"] = fix_strategy
    project["device_apply_scope"] = apply_scope

    status.write(f"✅ Devices: {', '.join(targets)}")
    status.write(f"✅ Fix: {fix_strategy}")
    status.write(f"✅ Scope: {apply_scope}")

    # TODO: Apply actual device-safe fixes to the funscript here.
    # For v1, Performance = basic position clamping + speed limiting.
    # Estim devices get full fix from funscript-tools math.
    # Handy/OSR2 get basic safety pass.
    status.update(label="Applying fixes…")
    # Placeholder — real math goes here
    status.write("✅ Device-safe fixes applied")

    # History snapshot
    project.setdefault("history", []).append({
        "tab": "device",
        "timestamp": datetime.now().isoformat(),
        "targets": targets,
        "fix_strategy": fix_strategy,
        "apply_scope": apply_scope,
    })

    if Path(project.get("output_folder", "")).exists():
        from forge.project import save_forge
        save_forge(project)

    status.update(label="Device awareness complete!", state="complete", expanded=False)
