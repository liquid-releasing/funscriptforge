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
# All selectable devices — mechanical and estim. The user picks which
# ones their script should target. Combined limits drive the device-aware fix.
_DEVICE_OPTIONS = {
    "mechanical": [
        ("handy",   "The Handy",          "Linear stroker. 400 pos/s. Industry standard."),
        ("osr2",    "OSR2 / SR6",         "Multi-axis servo. 500 pos/s. Depends on build."),
        ("generic", "Intiface (generic)",  "Conservative 300 pos/s for Bluetooth devices."),
    ],
    "estim": [
        ("legacy",     "Legacy (2b / 312)",      "Continuous waveform. 500 pos/s envelope rate."),
        ("stereostim", "Stereostim (pulse)",      "Pulse-based. 600 pos/s. Tingler / ZC."),
        ("foc3phase",  "FOC-Stim 3-phase",       "Direct current. 700 pos/s. Fastest response."),
        ("foc4phase",  "FOC-Stim 4-phase",       "Experimental. 700 pos/s. Same hardware as 3p."),
        ("neostim",    "NeoStim 3-phase",         "550 pos/s. Limited docs — estimate only."),
    ],
}


def render():
    project = st.session_state.get("forge_project")

    st.info(
        "**Device Awareness** ensures your funscript works within your device's limits. "
        "Select the devices you want to target — combined limits drive the "
        "device-aware fix below. The most restrictive device wins for each parameter."
    )

    # ── Device selection (multi-select) ──────────────────────────────────
    st.subheader("Target devices")
    st.caption(
        "Pick every device your script should work on. "
        "The combined limits show the tightest constraint across all selected devices."
    )

    saved_targets = (project or {}).get("output_targets", [])

    col_mech, col_estim = st.columns(2)
    selected_targets = []

    with col_mech:
        st.markdown("**Mechanical**")
        for key, label, desc in _DEVICE_OPTIONS["mechanical"]:
            checked = st.checkbox(
                label, value=(key in saved_targets),
                help=desc, key=f"device_sel_{key}",
            )
            if checked:
                selected_targets.append(key)

    with col_estim:
        st.markdown("**Estim**")
        for key, label, desc in _DEVICE_OPTIONS["estim"]:
            checked = st.checkbox(
                label, value=(key in saved_targets),
                help=desc, key=f"device_sel_{key}",
            )
            if checked:
                selected_targets.append(key)

    # Write back to project if changed — and clear the accepted state
    # so the device-aware computation re-runs with the new limits.
    if project and selected_targets != saved_targets:
        project["output_targets"] = selected_targets
        st.session_state.pop("device_accepted", None)
        st.session_state.pop("_device_analysis_key", None)

    if not selected_targets:
        st.caption("⚠️ Pick at least one device to see limits and apply device awareness.")
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
        if not _selected_specs:
            return ""
        if len(_selected_specs) == 1:
            return _selected_specs[0].name
        vals = [(getattr(s, attr), s.name) for s in _selected_specs]
        if use_max:
            limiting = max(vals, key=lambda x: x[0])
        else:
            limiting = min(vals, key=lambda x: x[0])
        return limiting[1]

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

    # Cache analysis results so we don't re-analyze on every Streamlit rerun
    _analysis_cache_key = f"_device_analysis_{len(actions)}_{id(limits)}"
    if st.session_state.get("_device_analysis_key") == _analysis_cache_key:
        analysis = st.session_state["_device_analysis"]
        stingy = st.session_state["_device_stingy"]
    else:
        with st.spinner(f"Analyzing {len(actions):,} actions…"):
            analysis = analyze_violations(actions, limits)
            stingy = detect_stingy(actions)
        st.session_state["_device_analysis_key"] = _analysis_cache_key
        st.session_state["_device_analysis"] = analysis
        st.session_state["_device_stingy"] = stingy

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

    # Read groove from the slider's session state if it exists (the slider
    # widget below uses key="groove_slider"). Falls back to the project's
    # saved groove on first render before the slider has been touched.
    # This avoids the off-by-one render bug where the chart computed
    # against the previous groove value while the slider visually showed
    # the new one.
    _saved_groove = st.session_state.get(
        "groove_slider",
        (project or {}).get("groove", 0.35),
    )

    _device_accepted = st.session_state.get("device_accepted", False)

    # If groove changed since last Accept, clear accepted state so the
    # computation re-runs with the new groove value.
    _last_accepted_groove = st.session_state.get("_device_last_groove")
    if _device_accepted and _last_accepted_groove is not None and _saved_groove != _last_accepted_groove:
        _device_accepted = False
        st.session_state.pop("device_accepted", None)

    if _already_aware and _saved_groove == 0:
        st.subheader("Device-aware")
        st.caption("Your funscript already has good variation and is within device limits.")
        png = cache.render_png("original", height_px=200, width_px=1400)
        if png:
            st.image(png, use_container_width=True)
        _groove = 0.0
        _fixed_actions = actions
        _fix_stats = {"humanize": {}, "clamp": {}}
    elif _device_accepted and cache.has_stage("device"):
        # Already accepted and cached — skip computation, just render from cache
        _groove = _saved_groove
        _fixed_actions = actions  # placeholder, not used for rendering
        _fix_stats = {"humanize": st.session_state.get("_device_h_stats", {}),
                      "clamp": st.session_state.get("_device_c_stats", {})}
    else:
        # First time or groove changed — compute device awareness
        _groove = _saved_groove
        _fixed_actions, _fix_stats = _apply_da(actions, limits, groove=_groove)
        cache.set_stage("device", _fixed_actions)
        # Cache stats for future reruns
        st.session_state["_device_h_stats"] = _fix_stats.get("humanize", {})
        st.session_state["_device_c_stats"] = _fix_stats.get("clamp", {})

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
        st.caption("**Groove — before**")
        render_cv_strip(actions, title="")
    with col_cv_after:
        st.caption("**Groove — after**")
        render_cv_strip(_fixed_actions, title="")

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

    # ── Verification: post-fix analysis + clamping ratio warning ────────
    _clamped = c_stats.get("actions_clamped", 0)
    _total = len(_fixed_actions) or 1
    _clamp_ratio = _clamped / _total

    _post_analysis = analyze_violations(_fixed_actions, limits)
    if _post_analysis["violation_count"] == 0 and _clamp_ratio < 0.25:
        st.success(
            f"✅ After device-awareness: all {_post_analysis['total_actions']:,} "
            f"actions are within {limits.name} limits "
            f"(max speed {_post_analysis['max_speed_found']:.0f} pos/s ≤ "
            f"{limits.max_speed:.0f} pos/s). "
            f"{_clamped:,} actions clamped ({_clamp_ratio:.0%})."
        )
    elif _clamp_ratio >= 0.50:
        # "Say no" rule: when more than half the script is clamped, the
        # result is a fundamentally different script. Warn loudly.
        st.error(
            f"⛔ **Heavy clamping** — {_clamped:,} of {_total:,} actions "
            f"({_clamp_ratio:.0%}) had to be clamped to fit "
            f"{limits.name}'s {limits.max_speed:.0f} pos/s limit. "
            f"This changes the character of the script significantly. "
            f"Consider removing the most restrictive device from your "
            f"targets, or accept that this script was authored for "
            f"faster hardware."
        )
    elif _clamp_ratio >= 0.25:
        st.warning(
            f"⚠️ Moderate clamping — {_clamped:,} of {_total:,} actions "
            f"({_clamp_ratio:.0%}) clamped to fit {limits.name}'s "
            f"{limits.max_speed:.0f} pos/s limit. The script will feel "
            f"noticeably different in the clamped sections."
        )
    elif _post_analysis["violation_count"] > 0:
        st.warning(
            f"⚠️ After device-awareness: {_post_analysis['violation_count']:,} of "
            f"{_post_analysis['total_actions']:,} actions still exceed limits "
            f"({_post_analysis['percent_ok']:.0f}% OK). "
            "Increase Groove or pick a more permissive device."
        )
    else:
        st.success(
            f"✅ All {_post_analysis['total_actions']:,} actions within "
            f"{limits.name} limits ({_clamped:,} clamped, {_clamp_ratio:.0%})."
        )

    st.divider()

    # ── Clamping opt-out ─────────────────────────────────────────────────
    # When the script is authored for faster hardware, the user may want to
    # keep the original instead of accepting heavy clamping. The checkbox
    # defaults ON (apply clamping) but the user can uncheck to skip.
    _apply_clamping = True
    if _clamp_ratio >= 0.25:
        _apply_clamping = st.checkbox(
            "Apply device-aware clamping",
            value=True,
            key="device_apply_clamping",
            help="Uncheck to keep the original funscript as-is and skip clamping. "
                 "The script will exceed the selected device limits but preserves "
                 "the original author's intent.",
        )
        if not _apply_clamping:
            st.caption(
                "Clamping skipped — the original funscript will be used as-is. "
                "It may exceed device limits for your selected targets."
            )

    # ── Accept ────────────────────────────────────────────────────────────
    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        help="Apply device awareness and continue to Tone." if _apply_clamping
             else "Keep original funscript and continue to Tone.",
    ):
        with st.spinner("Applying device awareness…" if _apply_clamping else "Saving original…"):
            _apply_device_awareness_to_chain(
                project, selected_targets, actions, limits,
                _already_aware if _apply_clamping else True,
                _groove if _apply_clamping else 0.0,
            )
        st.session_state["device_accepted"] = True
        st.session_state["_device_last_groove"] = _groove if _apply_clamping else 0.0
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
        status.write("✅ Keeping original funscript — no device-aware changes applied")
        from forge.funscript import load_funscript
        funscript_path = st.session_state.get("funscript_path", "")
        fs_data = load_funscript(funscript_path)
        if fs_data:
            chain_path = save_chain_funscript(project, "device", fs_data)
            st.session_state["chain_funscript_path"] = chain_path
            # Update chart cache so downstream tabs show the original,
            # not a stale clamped version from a previous Accept
            from forge_ui_components.funscript_chart.cache import ChartCache
            _cache = ChartCache.from_session_state()
            _cache.set_stage("device", fs_data.get("actions", []))
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
