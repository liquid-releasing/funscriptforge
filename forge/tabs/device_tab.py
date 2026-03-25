"""
Tab — Device Awareness

Select output devices, see what needs fixing, apply minimum corrections.
Everything downstream (Tone, Phrases) works on the device-aware baseline.
"""

from pathlib import Path

import streamlit as st

from forge.project import save_forge, save_chain_funscript
from forge.device_specs import load_device_specs, combined_limits, analyze_violations, apply_minimum_fix
from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays

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

    # ── Intensity spikes (estim only) ─────────────────────────────────────
    _has_estim = any("estim" in t for t in selected_targets)
    _spike_fraction = 0.0

    if _has_estim:
        from forge.device_specs import INTENSITY_SPIKE_PRESETS

        st.divider()
        st.subheader("Intensity spikes")
        st.caption(
            "Estim can deliver occasional sharp intensity spikes for variety. "
            "Most cycles stay smooth — the selected percentage can spike to full range randomly."
        )

        _saved_spike = (project or {}).get("intensity_spikes", "None")
        _preset_names = list(INTENSITY_SPIKE_PRESETS.keys())
        _spike_choice = st.select_slider(
            "Spike frequency",
            options=_preset_names,
            value=_saved_spike if _saved_spike in _preset_names else "None",
            key="intensity_spikes",
            help="None = all smooth. Frequent = up to every other cycle can spike.",
        )
        _spike_fraction = INTENSITY_SPIKE_PRESETS[_spike_choice]

        _labels = {
            "None": "All cycles smooth — no spikes",
            "⅛ Rare": "~1 in 8 cycles may spike",
            "¼ Moderate": "~1 in 4 cycles may spike",
            "½ Frequent": "~1 in 2 cycles may spike",
        }
        st.caption(_labels.get(_spike_choice, ""))

        if project:
            project["intensity_spikes"] = _spike_choice

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

    # Analyze current state
    with st.spinner(f"Analyzing {len(actions):,} actions against device limits…"):
        analysis = analyze_violations(actions, limits)

    # ── Status ────────────────────────────────────────────────────────────
    if analysis["violation_count"] == 0:
        st.success(
            f"✅ **Already device aware!** All {analysis['total_actions']:,} actions "
            f"are within {limits.name} limits. No corrections needed."
        )
        _already_aware = True
    else:
        st.warning(
            f"⚠️ **{analysis['violation_count']:,}** of **{analysis['total_actions']:,}** "
            f"actions exceed device limits "
            f"({analysis['percent_ok']:.0f}% OK). "
            f"Max speed found: {analysis['max_speed_found']:.0f} "
            f"(limit: {limits.max_speed:.0f})."
        )
        _already_aware = False

    st.divider()

    # ── Side-by-side preview ──────────────────────────────────────────────
    st.subheader("Preview")

    if _already_aware:
        st.caption("Your funscript is already within device limits.")
        render_monochrome_from_arrays(times_s, positions, height=200, key="device_original")
    else:
        # Apply minimum fix (with intensity spikes if estim selected)
        fixed_actions, fix_stats = apply_minimum_fix(actions, limits, intensity_spikes=_spike_fraction)
        fixed_positions = [a["pos"] for a in fixed_actions]

        # Re-analyze to confirm
        post_analysis = analyze_violations(fixed_actions, limits)

        col_before, col_after = st.columns(2)
        with col_before:
            st.caption("**Original**")
            render_monochrome_from_arrays(times_s, positions, key="device_before")
        with col_after:
            st.caption(
                f"**Device Aware** — {post_analysis['percent_ok']:.0f}% preserved"
            )
            render_monochrome_from_arrays(times_s, fixed_positions, key="device_after")

        # Full-width device-aware chart + stats (same layout as Project tab)
        st.write("")
        st.subheader("Device-aware result")
        from forge_ui_components.funscript_chart.streamlit import render_monochrome, render_stats_row
        from forge.funscript import funscript_stats as _fs_stats
        _fixed_data = {"actions": fixed_actions}
        render_monochrome(fixed_actions, height=180)
        _stats = _fs_stats(_fixed_data)
        # Add spike info to stats row
        _stats_cols = st.columns(6)
        _stats_cols[0].metric("Duration", _stats.get("duration_fmt", "—"))
        _stats_cols[1].metric("Actions", f"{_stats.get('action_count', 0):,}")
        _stats_cols[2].metric("Avg speed", f"{_stats.get('avg_speed', 0):.0f}")
        _stats_cols[3].metric("Clamped", f"{fix_stats['actions_clamped']:,}")
        _stats_cols[4].metric("Spike cycles", f"{fix_stats['spike_cycles']:,}")
        _stats_cols[5].metric("Total cycles", f"{fix_stats['total_cycles']:,}")
        if fix_stats["spike_cycles"] > 0:
            st.caption("Spike cycles can be edited in the Phrases tab.")

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────────
    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        help="Apply device awareness and continue to Tone.",
    ):
        with st.spinner("Applying device awareness…"):
            _apply_device_awareness(project, selected_targets, actions, limits, _already_aware, _spike_fraction)
        st.session_state["device_accepted"] = True
        st.rerun()

    if st.session_state.get("device_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            "Scroll to top to select your next tab: **Tone** or **Export**."
        )


def _apply_device_awareness(project, targets, actions, limits, already_aware, spike_fraction=0.0):
    """Apply minimum fix and save to chain."""
    from datetime import datetime

    if not project:
        return

    status = st.status("Applying device awareness…", expanded=True)

    project["output_targets"] = targets
    status.write(f"✅ Devices: {', '.join(targets)}")

    if already_aware:
        status.write("✅ No corrections needed — already within limits")
        from forge.funscript import load_funscript
        funscript_path = st.session_state.get("funscript_path", "")
        fs_data = load_funscript(funscript_path)
        if fs_data:
            chain_path = save_chain_funscript(project, "device", fs_data)
            st.session_state["chain_funscript_path"] = chain_path
    else:
        status.update(label=f"Applying minimum fix to {len(actions):,} actions…")

        fixed_actions, fix_stats = apply_minimum_fix(actions, limits, intensity_spikes=spike_fraction)
        analysis = analyze_violations(fixed_actions, limits)

        # Build funscript data with fixed actions
        from forge.funscript import load_funscript
        funscript_path = st.session_state.get("funscript_path", "")
        fs_data = load_funscript(funscript_path)
        if fs_data:
            for i, action in enumerate(fs_data.get("actions", [])):
                if i < len(fixed_actions):
                    action["pos"] = fixed_actions[i]["pos"]

            chain_path = save_chain_funscript(project, "device", fs_data)
            st.session_state["chain_funscript_path"] = chain_path
            status.write(
                f"✅ {analysis['percent_ok']:.0f}% of original preserved — "
                f"{analysis['violation_count']} actions corrected"
            )

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
