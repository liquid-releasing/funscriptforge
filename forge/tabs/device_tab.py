"""
Tab — Device Awareness

Select output devices, see what needs fixing, apply minimum corrections.
Everything downstream (Tone, Phrases) works on the device-aware baseline.
"""

from pathlib import Path

import streamlit as st

from forge.project import save_forge, save_chain_funscript
from forge.device_specs import load_device_specs, combined_limits, analyze_violations, apply_minimum_fix
from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays, render_static_from_arrays, render_static, render_cv_strip

# Device targets
_TARGETS = [
    ("handy",        "The Handy",          "Linear stroker. Industry standard."),
    ("osr2",         "OSR2",               "Multi-axis servo stroker. Twist + stroke."),
    ("estim_foc",    "Estim — FOC",        "Single-channel estim. Classic waveform."),
    ("estim_stereo", "Estim — Stereo",     "Dual-channel estim. Left/right separation."),
    ("generic",      "Generic / Intiface", "Conservative limits for Bluetooth devices (Lovense, Kiiroo, etc)."),
]


def render():
    project = st.session_state.get("forge_project")

    st.info(
        "**Device Awareness** ensures your funscript works within your device's limits. "
        "Select your output devices — Forge analyzes the funscript and applies the "
        "minimum correction needed. Most of your original script is preserved."
    )

    # ── Device selection ──────────────────────────────────────────────────
    st.subheader("Output devices")
    st.caption("Select all devices you want to export for.")

    saved_targets = (project or {}).get("output_targets", ["estim_foc", "estim_stereo"])
    selected_targets = []
    cols = st.columns(len(_TARGETS))
    for col, (key, label, desc) in zip(cols, _TARGETS):
        with col:
            if col.checkbox(label, value=key in saved_targets, help=desc,
                            key=f"device_target_{key}"):
                selected_targets.append(key)

    if project and selected_targets != saved_targets:
        project["output_targets"] = selected_targets

    if not selected_targets:
        st.caption("Select at least one device to continue.")
        return

    st.divider()

    # ── Limits table ──────────────────────────────────────────────────────
    specs = load_device_specs()
    limits = combined_limits(selected_targets)
    if limits is None:
        return

    st.subheader("Device limits")
    if len(selected_targets) > 1:
        st.caption("Combined limits — the most restrictive device wins for each parameter.")

    # Build table showing which device constrains each parameter
    _selected_specs = [specs[k] for k in selected_targets if k in specs]

    def _bottleneck(attr, use_max=False):
        """Find which device is the bottleneck for a given attribute."""
        if len(_selected_specs) == 1:
            return ""
        vals = [(getattr(s, attr), s.name) for s in _selected_specs]
        if use_max:
            limiting = max(vals, key=lambda x: x[0])
        else:
            limiting = min(vals, key=lambda x: x[0])
        return f"({limiting[1]})"

    import pandas as pd
    _limits_data = [
        {"Parameter": "Max speed", "Value": f"{limits.max_speed:.0f} pos/s", "Limited by": _bottleneck("max_speed")},
        {"Parameter": "Max BPM", "Value": f"{limits.max_bpm:.0f}", "Limited by": _bottleneck("max_bpm")},
        {"Parameter": "Max delta", "Value": f"{limits.max_delta}" + (" (no limit)" if limits.max_delta >= 100 else ""), "Limited by": _bottleneck("max_delta")},
        {"Parameter": "Min cycle", "Value": f"{limits.min_cycle_ms} ms", "Limited by": _bottleneck("min_cycle_ms", use_max=True)},
    ]
    st.dataframe(pd.DataFrame(_limits_data), hide_index=True, use_container_width=True)

    st.divider()

    # ── Analysis ──────────────────────────────────────────────────────────
    from forge.funscript import load_funscript, parse_actions

    funscript_path = st.session_state.get("funscript_path", "")
    if not funscript_path or not Path(funscript_path).exists():
        st.caption("Load a funscript on the Project tab first.")
        return

    data = load_funscript(funscript_path)
    if not data:
        return

    actions = data.get("actions", [])
    times, positions = parse_actions(data)
    if not times:
        return

    times_s = [t / 1000.0 for t in times]

    from forge.device_specs import detect_stingy, apply_device_awareness as _apply_da

    with st.spinner(f"Analyzing {len(actions):,} actions…"):
        analysis = analyze_violations(actions, limits)
        stingy = detect_stingy(actions)

    # ── Status ────────────────────────────────────────────────────────────
    _status_cols = st.columns([3, 2])
    with _status_cols[0]:
        if analysis["violation_count"] == 0:
            st.success(
                f"✅ All {analysis['total_actions']:,} actions within speed limits."
            )
        else:
            st.warning(
                f"⚠️ {analysis['violation_count']:,} of {analysis['total_actions']:,} "
                f"actions exceed speed limits ({analysis['percent_ok']:.0f}% OK)."
            )
    with _status_cols[1]:
        if stingy["is_stingy"]:
            st.error(
                f"⚠️ **Monotone detected** — {stingy['monotone_pct']:.0f}% of sections "
                f"have mechanical timing. Groove will add natural variation."
            )
        elif stingy["monotone_pct"] > 30:
            st.info(
                f"ℹ️ {stingy['monotone_pct']:.0f}% monotone sections "
                f"(Build={stingy['build_ratio']:.1f}x, {stingy['quiet_windows']}m quiet). "
                f"Groove can improve feel."
            )
        else:
            st.success("✅ Good timing variation — natural feel.")

    _already_aware = analysis["violation_count"] == 0 and stingy["monotone_pct"] < 5

    st.divider()

    # ── Device-aware preview (before Groove) ──────────────────────────────
    from forge_ui_components.funscript_chart.cache import ChartCache
    cache = ChartCache.from_session_state()

    _saved_groove = (project or {}).get("groove", 0.35)

    if _already_aware and _saved_groove == 0:
        st.subheader("Device-aware")
        st.caption("Your funscript already has good variation and is within device limits.")
        png = cache.render_png("original", height_px=200, width_px=1400)
        if png:
            st.image(png, use_container_width=True)
        _groove = 0.0
        _fixed_actions = actions
        _fix_stats = {"humanize": {}, "clamp": {}}
    else:
        # Apply full device awareness (humanize + backstop)
        _groove = _saved_groove
        _fixed_actions, _fix_stats = _apply_da(actions, limits, groove=_groove)
        # Only set device stage if not already cached (avoids wiping tone/phrases)
        if not cache.has_stage("device"):
            cache.set_stage("device", _fixed_actions)

        st.subheader("Device-aware")
        col_before, col_after = st.columns(2)
        with col_before:
            st.caption("**Original**")
            png_orig = cache.render_png("original", height_px=180, width_px=700)
            if png_orig:
                st.image(png_orig, use_container_width=True)
        with col_after:
            h_stats = _fix_stats.get("humanize", {})
            _cv_before = h_stats.get("original_cv", 0)
            _cv_after = h_stats.get("result_cv", 0)
            _win_mod = h_stats.get("windows_modified", 0)
            st.caption(
                f"**Device Aware** — CV {_cv_before:.2f} → {_cv_after:.2f}, "
                f"{_win_mod} sections humanized"
            )
            png_dev = cache.render_png("device", height_px=180, width_px=700)
            if png_dev:
                st.image(png_dev, use_container_width=True)

    st.divider()

    # ── Groove (timing variation) ──────────────────────────────────────────
    st.subheader("Groove — timing variation")
    st.caption(
        "Same beat, same intensity — cycles arrive at slightly different speeds "
        "so your body can't predict the exact moment. Like a live drummer vs a drum machine."
    )

    _groove = st.slider(
        "Groove",
        min_value=0.0,
        max_value=0.50,
        value=float(_saved_groove),
        step=0.05,
        key="groove_slider",
        help="0.0 = mechanical (no variation). 0.35 = natural (like expert scripts). 0.45 = jazzy.",
    )
    _groove_labels = {
        0.0: "Mechanical — every cycle identical",
        0.05: "Minimal variation",
        0.10: "Subtle variation",
        0.15: "Light groove",
        0.20: "Moderate groove",
        0.25: "Noticeable groove",
        0.30: "Natural feel",
        0.35: "Natural — like expert-crafted scripts",
        0.40: "Expressive",
        0.45: "Jazzy — loose, unpredictable",
        0.50: "Maximum variation",
    }
    st.caption(_groove_labels.get(_groove, f"Groove: {_groove:.2f}"))

    if project:
        project["groove"] = _groove

    # CV heatmap strips (before/after groove)
    col_cv_before, col_cv_after = st.columns(2)
    with col_cv_before:
        render_cv_strip(actions, title="Before")
    with col_cv_after:
        render_cv_strip(_fixed_actions, title="After groove")

    st.divider()

    # ── Device-aware and groove preview (full width) ──────────────────────
    st.subheader("Device-aware and groove preview")
    from forge.funscript import funscript_stats as _fs_stats
    png_result = cache.render_png("device", height_px=180, width_px=1400)
    if png_result:
        st.image(png_result, use_container_width=True)
    h_stats = _fix_stats.get("humanize", {})
    _stats = _fs_stats({"actions": _fixed_actions})
    c_stats = _fix_stats.get("clamp", {})
    _stats_cols = st.columns(5)
    _stats_cols[0].metric("Duration", _stats.get("duration_fmt", "—"))
    _stats_cols[1].metric("Actions", f"{_stats.get('action_count', 0):,}")
    _stats_cols[2].metric("Avg speed", f"{_stats.get('avg_speed', 0):.0f}")
    _stats_cols[3].metric("Humanized", f"{h_stats.get('windows_modified', 0)} sections")
    _stats_cols[4].metric("Speed-clamped", f"{c_stats.get('actions_clamped', 0):,}")

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────────
    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        help="Apply device awareness and continue to Tone.",
    ):
        with st.spinner("Applying device awareness…"):
            _apply_device_awareness_to_chain(project, selected_targets, actions, limits, _already_aware, _groove)
        st.session_state["device_accepted"] = True
        st.rerun()

    if st.session_state.get("device_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            "Scroll to top to select your next tab: **Tone** or **Export**."
        )


def _apply_device_awareness_to_chain(project, targets, actions, limits, already_aware, groove=0.35):
    """Apply humanize + speed backstop and save to chain."""
    from datetime import datetime
    from forge.device_specs import apply_device_awareness as _apply_da

    if not project:
        return

    status = st.status("Applying device awareness…", expanded=True)

    project["output_targets"] = targets
    project["groove"] = groove
    status.write(f"✅ Devices: {', '.join(targets)}")

    if already_aware and groove == 0:
        status.write("✅ No corrections needed — already within limits with good variation")
        from forge.funscript import load_funscript
        funscript_path = st.session_state.get("funscript_path", "")
        fs_data = load_funscript(funscript_path)
        if fs_data:
            chain_path = save_chain_funscript(project, "device", fs_data)
            st.session_state["chain_funscript_path"] = chain_path
    else:
        status.update(label=f"Humanizing + checking {len(actions):,} actions…")

        fixed_actions, fix_stats = _apply_da(actions, limits, groove=groove)
        h_stats = fix_stats.get("humanize", {})
        c_stats = fix_stats.get("clamp", {})

        # Build funscript data with fixed actions
        from forge.funscript import load_funscript
        funscript_path = st.session_state.get("funscript_path", "")
        fs_data = load_funscript(funscript_path)
        if fs_data:
            # Update timestamps (humanize changes timing)
            for i, action in enumerate(fs_data.get("actions", [])):
                if i < len(fixed_actions):
                    action["at"] = fixed_actions[i]["at"]
                    action["pos"] = fixed_actions[i]["pos"]

            chain_path = save_chain_funscript(project, "device", fs_data)
            st.session_state["chain_funscript_path"] = chain_path
            status.write(
                f"✅ CV {h_stats.get('original_cv', 0):.2f} → {h_stats.get('result_cv', 0):.2f} "
                f"({h_stats.get('windows_modified', 0)} sections humanized)"
            )
            if c_stats.get("actions_clamped", 0) > 0:
                status.write(f"✅ {c_stats['actions_clamped']:,} actions speed-clamped")

        # Pre-compute vibrant chart data for Phrases tab
        status.update(label="Building chart data…")
        from forge_ui_components.funscript_chart.core import compute_chart_data
        st.session_state["cached_vibrant_series"] = compute_chart_data(
            fs_data.get("actions", []) if fs_data else []
        )
        status.write("✅ Chart data cached for Phrases")

    # History snapshot
    project.setdefault("history", []).append({
        "tab": "device",
        "timestamp": datetime.now().isoformat(),
        "targets": targets,
        "fix": "minimum" if not already_aware else "none",
    })

    if Path(project.get("output_folder", "")).exists():
        save_forge(project)

    status.update(label="Device awareness complete!", state="complete", expanded=False)
