# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""viewer.py — Phrase Selector panel.

Shows the full funscript as a fixed chart with phrase bounding boxes.

Interaction
-----------
* Click a point    — selects the enclosing phrase; shows phrase info below.
* Phrase buttons   — P1, P2, … below the chart jump directly to a phrase.
* Color toggle     — switch between velocity and amplitude colour mode.

Selected phrase info (start, end, duration, BPM, pattern, cycle count) is
displayed below.  A phrase editor will appear here in the next version.
"""

from __future__ import annotations

from typing import List, Optional

import streamlit as st

from utils import ms_to_timestamp, parse_timestamp


# ------------------------------------------------------------------
# Selector fragment — the chart + controls as a Streamlit fragment so
# that scroll/zoom interactions rerun only this section of the page,
# not the entire app.  Phrase selection triggers a full app rerun via
# st.rerun(scope="app") to switch into phrase detail mode.
# ------------------------------------------------------------------

@st.fragment
def _selector_fragment(
    funscript_path: str,
    assessment_dict: dict,
    duration_ms: int,
    large_funscript_threshold: int,
) -> None:
    import json
    import time as _time
    from forge_ui_components.funscript_chart.cache import ChartCache
    from forge_ui_components.funscript_chart.core import compute_annotation_bands

    cache = ChartCache.from_session_state()

    with open(funscript_path) as f:
        original_actions = json.load(f)["actions"]

    phrases = assessment_dict.get("phrases", [])

    # Always sync bands with current assessment (may have changed via re-analyse)
    _current_bands = compute_annotation_bands(assessment_dict)
    _n_phrase_bands = sum(1 for b in _current_bands if b.kind == "phrase")
    _n_cached_bands = sum(1 for b in cache.get_bands() if b.kind == "phrase")
    if _n_phrase_bands != _n_cached_bands or not cache.get_bands():
        cache.set_bands(_current_bands)

    # Ensure latest chain data is in cache
    if not cache.has_stage("original"):
        cache.set_stage("original", original_actions)

    # Show edited version if any phrase transforms have been accepted
    from ui.streamlit.panels.phrase_detail import build_edited_actions
    has_edits = any(
        k.startswith("phrase_transform_chain_") and bool(st.session_state[k])
        for k in st.session_state
    )
    if has_edits:
        display_actions = build_edited_actions(phrases, original_actions)
        st.info(
            "These edits have not been saved — ready for export.",
            icon="💾",
        )
        # Phrase edits need fresh render (can't use stage cache)
        _t0 = _time.time()
        with st.spinner(f"Rendering {len(display_actions):,} edited actions…"):
            from forge_ui_components.funscript_chart.static import render_vibrant_static
            png = render_vibrant_static(
                display_actions, cache.get_bands(),
                height_px=380, width_px=1600, show_labels=True,
            )
            st.image(png, use_container_width=True)
        st.caption(f"Chart built in {_time.time()-_t0:.1f}s")
    else:
        # Use cache — latest stage with phrase bands
        _t0 = _time.time()
        _stage = "tone" if cache.has_stage("tone") else ("device" if cache.has_stage("device") else "original")
        png = cache.render_png(_stage, with_bands=True, height_px=380, width_px=1600, show_labels=True)
        if png:
            st.image(png, use_container_width=True)
            st.caption(f"Chart (cached) built in {_time.time()-_t0:.1f}s")
        else:
            # No cache — compute from file
            with st.spinner(f"Rendering {len(original_actions):,} actions…"):
                cache.set_stage("original", original_actions)
                png = cache.render_png("original", with_bands=True, height_px=380, width_px=1600, show_labels=True)
                if png:
                    st.image(png, use_container_width=True)
            st.caption(f"Chart built in {_time.time()-_t0:.1f}s")


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

def render(
    project,
    view_state,
    proposed_actions: Optional[List[dict]] = None,
    large_funscript_threshold: int = 10_000,
) -> None:
    """Render the Phrase Selector.

    Parameters
    ----------
    project:
        Loaded :class:`~ui.common.project.Project`.
    view_state:
        Shared :class:`~ui.common.view_state.ViewState`.
    proposed_actions:
        Reserved for future editing workflow.
    """
    if not project or not project.is_loaded:
        st.info("Load a funscript to use the Phrase Selector.")
        return

    try:
        import plotly  # noqa: F401
    except ImportError:
        st.error("plotly is required.  Run: pip install plotly")
        return

    assessment_dict = project.assessment.to_dict()
    phrases         = assessment_dict.get("phrases", [])
    duration_ms     = project.assessment.duration_ms

    # Use chain funscript if available (device-fixed + tone-applied),
    # otherwise fall back to the original.
    _chain_path = st.session_state.get("chain_funscript_path")
    _fs_path = _chain_path if (_chain_path and __import__("os").path.isfile(_chain_path)) else project.funscript_path

    # Ensure phrases are always shown even if view_state has them toggled off.
    view_state.show_phrases = True

    # Heatmap: compact motion-intensity strip above the main chart.
    # Uses edited actions if phrase transforms have been applied.
    st.markdown("**Funscript Heatmap**")
    _has_phrase_edits = any(
        k.startswith("phrase_transform_chain_") and bool(st.session_state[k])
        for k in st.session_state
    )
    if _has_phrase_edits:
        import json as _json
        from ui.streamlit.panels.phrase_detail import build_edited_actions
        with open(_fs_path) as _f:
            _orig = _json.load(_f)["actions"]
        _edited = build_edited_actions(phrases, _orig)
        _render_heatmap_from_actions(_edited, phrases, duration_ms)
    else:
        _render_heatmap(_fs_path, phrases, duration_ms)

    st.markdown("**Funscript Visualization**")
    # Full-funscript chart always visible (fragment keeps scroll/zoom cheap).
    _selector_fragment(
        funscript_path=_fs_path,
        assessment_dict=assessment_dict,
        duration_ms=duration_ms,
        large_funscript_threshold=large_funscript_threshold,
    )

    # Phrase table always visible below the chart.
    _render_phrase_table(phrases, view_state)


# ------------------------------------------------------------------
# Controls bar
# ------------------------------------------------------------------

def _render_controls(view_state, duration_ms: int, phrases: list) -> None:
    """Colour mode + time range display + scroll/zoom controls."""
    zoom_start = view_state.zoom_start_ms or 0
    zoom_end   = view_state.zoom_end_ms   or duration_ms
    span       = zoom_end - zoom_start
    scroll_step = max(span // 3, 1_000)

    col_mode, col_t0, col_t1, col_left, col_right, col_all, col_zin, col_zout = st.columns(
        [2, 2, 2, 1, 1, 1, 1, 1]
    )

    with col_mode:
        view_state.color_mode = st.radio(
            "Color mode",
            ["velocity", "amplitude"],
            index=0 if view_state.color_mode == "velocity" else 1,
            horizontal=True,
            key="viewer_color_mode",
        )

    # Keys include the current zoom values so the widgets re-initialize
    # (with the correct default) whenever a scroll/zoom button changes the viewport.
    with col_t0:
        t0_val = st.text_input(
            "From", value=ms_to_timestamp(zoom_start),
            key=f"ctrl_t0_{zoom_start}",
            placeholder="M:SS",
        )

    with col_t1:
        t1_val = st.text_input(
            "To", value=ms_to_timestamp(zoom_end),
            key=f"ctrl_t1_{zoom_end}",
            placeholder="M:SS",
        )

    # Apply typed timestamps only if both parse cleanly and differ from current viewport.
    try:
        t0_ms = parse_timestamp(t0_val)
        t1_ms = parse_timestamp(t1_val)
        if t0_ms != zoom_start or t1_ms != zoom_end:
            view_state.set_zoom(t0_ms, t1_ms)
            st.rerun()   # fragment rerun — just updates the chart
    except Exception:
        pass

    with col_left:
        if st.button("◀", key="scroll_left", help="Scroll left", width="stretch"):
            new_start = max(0, zoom_start - scroll_step)
            view_state.set_zoom(new_start, new_start + span)
            st.rerun()   # fragment rerun

    with col_right:
        if st.button("▶", key="scroll_right", help="Scroll right", width="stretch"):
            new_end = min(duration_ms, zoom_end + scroll_step)
            view_state.set_zoom(new_end - span, new_end)
            st.rerun()   # fragment rerun

    with col_all:
        if st.button("All", key="reset_zoom", help="Show full funscript", width="stretch"):
            view_state.reset_zoom()
            st.rerun()   # fragment rerun

    with col_zin:
        if st.button("＋", key="zoom_in", help="Zoom in (halve window)", width="stretch"):
            mid  = (zoom_start + zoom_end) // 2
            half = max(span // 4, 5_000)
            view_state.set_zoom(max(0, mid - half), min(duration_ms, mid + half))
            st.rerun()   # fragment rerun

    with col_zout:
        if st.button("－", key="zoom_out", help="Zoom out (double window)", width="stretch"):
            mid  = (zoom_start + zoom_end) // 2
            half = min(span, duration_ms)
            view_state.set_zoom(max(0, mid - half), min(duration_ms, mid + half))
            st.rerun()   # fragment rerun


# ------------------------------------------------------------------
# Chart event handling
# ------------------------------------------------------------------

def _handle_chart_event(event, view_state, phrases: list) -> None:
    """Point click → select the enclosing phrase (full app rerun to open editor).
    Box-drag → zoom the viewport (fragment rerun)."""
    if not event:
        return
    sel = getattr(event, "selection", None)
    if not sel:
        return

    # Point click → find enclosing phrase and select it
    points = getattr(sel, "points", None) or []
    if points:
        try:
            x_ms = int(points[0].get("x", -1))
            phrase = _find_phrase_at(x_ms, phrases)
            if phrase:
                view_state.set_selection(phrase["start_ms"], phrase["end_ms"])
                st.rerun(scope="app")   # full rerun — switches Phrases tab to Editor view
        except Exception:
            pass
        return   # don't process box on same event

    # Box drag → zoom the chart to the selected time range
    box = getattr(sel, "box", None) or []
    if box:
        try:
            x_range = box[0].get("x", [])
            if len(x_range) == 2:
                view_state.set_zoom(int(x_range[0]), int(x_range[1]))
                st.rerun()   # fragment rerun — just updates the chart viewport
        except Exception:
            pass


# ------------------------------------------------------------------
# Phrase table
# ------------------------------------------------------------------

def _render_phrase_table(phrases: list, view_state) -> None:
    """Compact dataframe of all phrases; click a row to open the editor."""
    if not phrases:
        return

    import pandas as pd
    from assessment.classifier import TAGS

    st.markdown("**Funscript Selection Details**")
    st.caption(
        f"{len(phrases)} phrase{'s' if len(phrases) != 1 else ''} — "
        "click a row or a phrase on the chart above to open the editor"
    )

    rows = []
    for i, ph in enumerate(phrases):
        raw_tags = ph.get("tags", []) or []
        if raw_tags:
            behavior = ", ".join(TAGS[t].label if t in TAGS else t for t in raw_tags)
        else:
            behavior = (ph.get("pattern_label", "") or "—").replace("->", "→")
        rows.append({
            "Phrase":   f"P{i + 1}",
            "Start":    ms_to_timestamp(ph["start_ms"]),
            "End":      ms_to_timestamp(ph["end_ms"]),
            "Dur":      ms_to_timestamp(max(0, ph["end_ms"] - ph["start_ms"])),
            "BPM":      round(ph.get("bpm", 0.0), 1),
            "Behavior": behavior,
            "Cycles":   ph.get("cycle_count", "—"),
        })

    df = pd.DataFrame(rows, index=range(1, len(rows) + 1))
    # Use a versioned key so that after a row is processed we can bump the
    # version and get a completely fresh widget (no stale selection in the
    # browser or Streamlit's reconciliation cache).
    _tver = st.session_state.get("phrase_table_ver", 0)
    ev = st.dataframe(
        df,
        on_select="rerun",
        selection_mode="single-row",
        width="stretch",
        key=f"phrase_table_{_tver}",
    )

    # Navigation is handled at the top of _render_phrase_tab (app.py) by reading
    # the widget's session-state key before choosing Selector vs Editor view.
    # Nothing to do here — on_select="rerun" is enough to trigger the rerun.


# ------------------------------------------------------------------
# Selected phrase info panel
# ------------------------------------------------------------------

def _render_phrase_info(view_state, phrases: list) -> None:
    """Show a compact table row for the selected phrase."""
    start = view_state.selection_start_ms
    end   = view_state.selection_end_ms

    phrase_idx = next(
        (i for i, ph in enumerate(phrases)
         if ph["start_ms"] == start and ph["end_ms"] == end),
        None,
    )
    if phrase_idx is None:
        return
    phrase = phrases[phrase_idx]

    duration_ms = end - start
    col_label, col_a, col_b = st.columns([1, 10, 1])
    with col_label:
        st.markdown(f"### P{phrase_idx + 1}")
    with col_a:
        import pandas as pd
        from assessment.classifier import TAGS
        raw_tags = phrase.get("tags") or []
        if raw_tags:
            behavior = ", ".join(TAGS[t].label if t in TAGS else t for t in raw_tags)
        else:
            behavior = (phrase.get("pattern_label") or "—").replace("->", "→")
        row = {
            "Start":    ms_to_timestamp(start),
            "End":      ms_to_timestamp(end),
            "Duration": f"{duration_ms / 1000:.1f} s",
            "BPM":      f"{phrase.get('bpm', 0):.1f}",
            "Behavior": behavior,
            "Cycles":   phrase.get("cycle_count", "—"),
        }
        st.dataframe(pd.DataFrame([row]), hide_index=True, width="stretch")
    with col_b:
        if st.button("✕", key="clear_sel", help="Clear selection"):
            view_state.clear_selection()
            st.rerun()


# ------------------------------------------------------------------
# Motion-intensity heatmap
# ------------------------------------------------------------------

def _render_heatmap(funscript_path: str, phrases: list, duration_ms: int) -> None:
    """Compact motion-intensity strip — loads from file path."""
    import json
    if duration_ms <= 0 or not phrases:
        return
    try:
        with open(funscript_path) as f:
            actions = json.load(f)["actions"]
    except Exception:
        return
    _render_heatmap_from_actions(actions, phrases, duration_ms)


def _render_heatmap_from_actions(actions: list, phrases: list, duration_ms: int) -> None:
    """Compact motion-intensity strip above the main chart.

    Bins action velocity (sum of |pos_diff|) into N_BINS buckets across the
    full timeline and renders a single-row Plotly heatmap.  White vertical
    lines mark phrase boundaries so the strip doubles as a phrase map.
    """
    import plotly.graph_objects as go

    _BG = "rgba(14,14,18,1)"

    if duration_ms <= 0 or not phrases:
        return
    if len(actions) < 2:
        return

    N_BINS    = 400
    bin_width = max(duration_ms / N_BINS, 1.0)
    activity  = [0.0] * N_BINS

    for i in range(1, len(actions)):
        a0, a1   = actions[i - 1], actions[i]
        mid_ms   = (a0["at"] + a1["at"]) / 2.0
        b        = min(N_BINS - 1, int(mid_ms / bin_width))
        activity[b] += abs(a1["pos"] - a0["pos"])

    max_val  = max(activity) if any(v > 0 for v in activity) else 1.0
    activity = [v / max_val for v in activity]

    bin_centers = [(i + 0.5) * bin_width for i in range(N_BINS)]

    # White vertical lines at every phrase boundary except the timeline start.
    shapes = [
        dict(
            type="line",
            x0=ph["start_ms"], x1=ph["start_ms"],
            y0=0, y1=1,
            xref="x", yref="paper",
            line=dict(color="rgba(255,255,255,0.85)", width=1),
        )
        for ph in phrases
        if ph["start_ms"] > 0
    ]

    fig = go.Figure(go.Heatmap(
        z=[activity],
        x=bin_centers,
        colorscale="Turbo",
        showscale=False,
        zmin=0,
        zmax=1,
        hovertemplate="activity: %{z:.2f}<extra></extra>",
    ))
    fig.update_layout(
        height=52,
        margin=dict(l=45, r=10, t=2, b=2),  # match FunscriptChart margins
        paper_bgcolor=_BG,
        plot_bgcolor=_BG,
        shapes=shapes,
        xaxis=dict(
            showgrid=False, zeroline=False, showticklabels=False,
            range=[0, duration_ms],
        ),
        yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
    )
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
    st.caption("Motion intensity · white lines = phrase boundaries")


# ------------------------------------------------------------------
# Utilities
# ------------------------------------------------------------------

def _find_phrase_at(time_ms: int, phrases: list):
    for ph in phrases:
        if ph["start_ms"] <= time_ms <= ph["end_ms"]:
            return ph
    return None


def _select_phrase(phrase: dict, view_state) -> None:
    view_state.selection_start_ms = phrase["start_ms"]
    view_state.selection_end_ms = phrase["end_ms"]


def _zoom_to_phrase(phrase: dict, view_state, duration_ms: int) -> None:
    """Scroll the viewport to show the phrase with a small padding on each side."""
    start = phrase["start_ms"]
    end   = phrase["end_ms"]
    pad   = max((end - start) // 5, 2_000)
    view_state.set_zoom(max(0, start - pad), min(duration_ms, end + pad))
