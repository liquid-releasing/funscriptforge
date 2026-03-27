# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""phrase_detail.py — Detailed view for a selected phrase.

Layout (when a phrase is selected)
------------------------------------
  ┌─────────────────────────────────┬──────────────┐
  │  P{N} — Phrase Detail           │              │
  │  Original chart (fixed x-axis)  │  Transform   │
  ├─────────────────────────────────│  controls    │
  │  Preview — {Transform Name}     │              │
  │  Preview chart (fixed x-axis)   │              │
  │  [preview stats table]          │              │
  │  *(not saved)*                  │              │
  └─────────────────────────────────┴──────────────┘
                                    ┌──────────────┐
                                    │  ⏮ Prev      │
                                    │     Next ⏭   │
                                    │  ✓ Accept     │
                                    │  ✕ Cancel    │
                                    └──────────────┘

Both charts share the same fixed-width x-axis viewport (centered on the
selected phrase, sized to show the longest phrase in the funscript so that
BPM and velocity are visually comparable across all phrase views).

Areas outside the selected phrase are dimmed with a semi-transparent overlay
so context is visible but focus stays on the phrase being edited.

Nav and Save/Cancel are rendered OUTSIDE the @st.fragment so that transform
slider reruns (fragment-only) never cause button echo or flicker.
"""

from __future__ import annotations

import copy
import json
from typing import Any, Dict, List, Optional

import streamlit as st  # needed at module level for @st.fragment

from utils import ms_to_timestamp


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

def render(
    phrases: list,
    view_state,
    duration_ms: int,
    bpm_threshold: float = 120.0,
) -> None:
    if not phrases:
        return

    if view_state.has_selection():
        sel_start = view_state.selection_start_ms
        sel_end   = view_state.selection_end_ms
    else:
        # Default to P1 locally — do NOT write to view_state so the Phrase
        # Selector chart is not polluted with a phantom P1 highlight.
        sel_start = phrases[0]["start_ms"]
        sel_end   = phrases[0]["end_ms"]

    phrase_idx = next(
        (i for i, ph in enumerate(phrases)
         if ph["start_ms"] == sel_start and ph["end_ms"] == sel_end),
        None,
    )
    if phrase_idx is None:
        return

    phrase = phrases[phrase_idx]

    # Snapshot the chain on entry so Cancel can revert to this state
    _snapshot_key = f"_phrase_chain_snapshot_{phrase_idx}"
    if _snapshot_key not in st.session_state:
        _chain_key = f"phrase_transform_chain_{phrase_idx}"
        st.session_state[_snapshot_key] = list(st.session_state.get(_chain_key, []))

    win_start, win_end = _fixed_viewport(phrases, phrase, duration_ms)
    # Use chain funscript if available (device-fixed + tone-applied)
    import os as _os
    _chain_path = st.session_state.get("chain_funscript_path")
    funscript_path = _chain_path if (_chain_path and _os.path.isfile(_chain_path)) else st.session_state.project.funscript_path

    _detail_fragment(
        funscript_path=funscript_path,
        phrases=phrases,
        phrase_idx=phrase_idx,
        win_start=win_start,
        win_end=win_end,
        bpm_threshold=bpm_threshold,
        duration_ms=duration_ms,
    )


# ------------------------------------------------------------------
# Detail fragment — charts, transform controls, and action buttons.
# Slider/selectbox interactions rerun only this section.
# Nav/save buttons live here too so they stay visually aligned with
# the controls column rather than appearing below the charts.
# ------------------------------------------------------------------

def _detail_fragment(
    funscript_path: str,
    phrases: list,
    phrase_idx: int,
    win_start: int,
    win_end: int,
    bpm_threshold: float,
    duration_ms: int,
) -> None:
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG, TRANSFORM_ORDER, suggest_transform

    view_state = st.session_state.view_state
    phrase     = phrases[phrase_idx]

    try:
        with open(funscript_path) as f:
            original_actions = json.load(f)["actions"]
    except (FileNotFoundError, PermissionError) as _e:
        st.error(f"Funscript file not found: {funscript_path}\n\n{_e}")
        return
    except (json.JSONDecodeError, KeyError) as _e:
        st.error(f"Could not parse funscript: {_e}")
        return

    split_mode     = st.session_state.get(f"split_mode_{phrase_idx}", False)
    concat_preview = st.session_state.get(f"concat_preview_{phrase_idx}", False)
    next_phrase    = phrases[phrase_idx + 1] if phrase_idx < len(phrases) - 1 else None

    # Derive split_ms from the cycle slider before the chart renders
    split_ms = None
    if split_mode:
        _split_cycle = st.session_state.get(f"split_cycle_{phrase_idx}")
        if _split_cycle is not None:
            try:
                _project = st.session_state.project
                _ph_cycles = sorted(
                    [cy for cy in _project.assessment.cycles
                     if phrase["start_ms"] <= cy.start_ms and cy.end_ms <= phrase["end_ms"]],
                    key=lambda cy: cy.start_ms,
                )
                if _split_cycle < len(_ph_cycles):
                    split_ms = _ph_cycles[_split_cycle].start_ms
            except (AttributeError, KeyError, TypeError):
                split_ms = None  # assessment not ready or phrase dict missing keys

    # ------------------------------------------------------------------
    # Build baseline: apply accepted transform chain to original_actions
    # ------------------------------------------------------------------
    _chain = st.session_state.get(f"phrase_transform_chain_{phrase_idx}", [])
    if _chain:
        baseline_actions = copy.deepcopy(original_actions)
        for _ts in _chain:
            _spec = TRANSFORM_CATALOG.get(_ts.get("transform_key", "passthrough"),
                                          TRANSFORM_CATALOG["passthrough"])
            baseline_actions = _apply_transform_to_window(
                baseline_actions, phrase, _spec, _ts.get("param_values", {})
            )
    else:
        baseline_actions = original_actions

    # When previewing a concat, extend win_end to cover the next phrase too
    if concat_preview and next_phrase:
        win_end = min(duration_ms, max(win_end, next_phrase["end_ms"] + 5_000))

    # ------------------------------------------------------------------
    # Resolve pending transform (only needed when not in split/concat mode)
    # ------------------------------------------------------------------
    if not split_mode and not concat_preview:
        from ui.streamlit.transform_picker import get_picker_key
        transform_key = get_picker_key(f"txpick_{phrase_idx}")

        spec = TRANSFORM_CATALOG.get(transform_key, TRANSFORM_CATALOG["passthrough"])

        param_values: Dict[str, Any] = {}
        for pk, param in spec.params.items():
            sv = st.session_state.get(f"param_{phrase_idx}_{pk}")
            param_values[pk] = sv if sv is not None else param.default

        # Preview applies pending transform on top of the accepted baseline
        # Device awareness is already applied globally on the Device tab —
        # no per-phrase device checks needed here.
        preview_actions = _apply_transform_to_window(baseline_actions, phrase, spec, param_values)

    # ------------------------------------------------------------------
    # Layout:
    #   Row 1: [stats table] [show/hide player toggle]
    #   Row 2: [charts (2 or 3/4)] [player (1/4, optional)] [transform (1/4)]
    # ------------------------------------------------------------------
    import pandas as pd
    from utils import ms_to_timestamp as _mts

    has_media  = bool(st.session_state.get("media_path"))
    _show_key  = "show_player_col"
    show_player = has_media and st.session_state.get(_show_key, False)

    # Row 1 — stats + player toggle
    col_stats, col_toggle = st.columns([4, 1])
    with col_stats:
        _acts = [a for a in baseline_actions
                 if phrase["start_ms"] <= a["at"] <= phrase["end_ms"]]
        _pos  = [a["pos"] for a in _acts] if _acts else []
        _lo, _hi = (min(_pos), max(_pos)) if _pos else (0, 0)
        _dur = phrase["end_ms"] - phrase["start_ms"]
        _stat_row = {
            "Start":    _mts(phrase["start_ms"]),
            "End":      _mts(phrase["end_ms"]),
            "Duration": f"{_dur / 1000:.1f} s",
            "BPM":      f"{phrase.get('bpm', 0):.1f}",
            "Pattern":  phrase.get("pattern_label", "—"),
            "Cycles":   phrase.get("cycle_count", "—"),
            "Min":      _lo,
            "Max":      _hi,
            "Range":    _hi - _lo,
            "Mean":     f"{sum(_pos) / len(_pos):.1f}" if _pos else "—",
            "Actions":  len(_acts),
        }
        st.dataframe(pd.DataFrame([_stat_row]), hide_index=True, width="stretch")
    with col_toggle:
        if has_media:
            _btn_label = "📹 Hide player" if show_player else "📹 Show player"
            if st.button(_btn_label, key="toggle_player_col", use_container_width=True):
                st.session_state[_show_key] = not show_player
                st.rerun()

    # Row 2 (optional) — full-width player.
    # Always render the st.empty() placeholder so Streamlit's widget tree has a
    # stable node here regardless of show/hide state — prevents the component
    # from being reconciled into the wrong column on toggle.
    _player_slot = st.empty()
    if show_player:
        with _player_slot.container():
            _render_phrase_player(phrase, phrase_idx, baseline_actions)

    # Row 3 — charts | transform panel (always 2-col)
    col_content, col_transform = st.columns([3, 1])

    with col_content:
        _chain_label = f" ({len(_chain)} accepted)" if _chain else ""
        if concat_preview and next_phrase:
            combined_end_ms = next_phrase["end_ms"]
            st.subheader(f"P{phrase_idx + 1} + P{phrase_idx + 2} — Combined preview")
            st.caption(
                f"Combined span: {_mts(phrase['start_ms'])} → {_mts(combined_end_ms)} "
                f"({(combined_end_ms - phrase['start_ms']) / 1000:.1f} s)"
            )
        else:
            combined_end_ms = None
            st.subheader(f"P{phrase_idx + 1} — Baseline{_chain_label}")
            st.caption(_phrase_description(phrase))

        _render_chart(
            actions=baseline_actions,
            phrases=phrases,
            phrase_idx=phrase_idx,
            win_start=win_start,
            win_end=win_end,
            view_state=view_state,
            chart_key=f"detail_orig_{phrase_idx}_{win_start}",
            split_ms=split_ms,
            extra_phrase_end_ms=combined_end_ms,
        )

        if not split_mode and not concat_preview:
            st.subheader(f"Preview — {spec.name}")
            st.caption(_phrase_description(phrase))
            _render_chart(
                actions=preview_actions,
                phrases=phrases,
                phrase_idx=phrase_idx,
                win_start=win_start,
                win_end=win_end,
                view_state=view_state,
                chart_key=f"detail_prev_{phrase_idx}_{win_start}_{transform_key}",
            )
            _render_preview_stats(preview_actions, phrase)
            st.caption("*(not saved)*")

    with col_transform:
        # Nav always at the top — matches Pattern Editor layout
        _render_nav_buttons(phrases, phrase_idx, view_state, duration_ms)
        st.write("")
        if concat_preview and next_phrase:
            _render_concat_preview_controls(phrase_idx, phrase, next_phrase, view_state, duration_ms)
        elif split_mode:
            confirmed_split_ms = _render_split_controls(
                phrase_idx, phrase, original_actions, view_state, duration_ms
            )
            if confirmed_split_ms is not None:
                _split_phrase(phrase_idx, confirmed_split_ms, view_state, duration_ms)
        else:
            _render_transform_controls(phrase, bpm_threshold, phrase_idx)
            st.write("")
            _render_save_cancel(phrase_idx, view_state)
            _render_edit_phrase(phrases, phrase_idx, view_state, duration_ms)


# ------------------------------------------------------------------
# Phrase media player (own column, phrase-restricted)
# ------------------------------------------------------------------

def _render_phrase_player(phrase: dict, phrase_idx: int, actions: list) -> None:
    """Render the phrase-restricted media player in its dedicated column.

    Shows a video (or audio) player scoped to [start_ms, end_ms], with a
    waveform chart, ±1 s / frame-step controls, volume, speed, and a
    real-time position readout (⏸ MM:SS.mmm  pos NN).

    Does nothing if no media file is loaded in session state.
    """
    from ui.streamlit.panels.media_player import render_player

    media_path = st.session_state.get("media_path")
    if not media_path:
        st.caption("No media loaded.\nAdd a media file in the sidebar.")
        return

    import os
    st.caption(
        f"📹 {media_path}\n\n"
        f"{ms_to_timestamp(phrase['start_ms'])} → {ms_to_timestamp(phrase['end_ms'])}"
    )

    phrase_actions = [
        a for a in actions
        if phrase["start_ms"] <= a["at"] <= phrase["end_ms"]
    ]

    render_player(
        start_ms=phrase["start_ms"],
        end_ms=phrase["end_ms"],
        actions=phrase_actions,
        key_suffix=f"detail_{phrase_idx}",
    )


# ------------------------------------------------------------------
# Phrase description (rule-based, no LLM required)
# ------------------------------------------------------------------

def _phrase_description(phrase: dict) -> str:
    """Return a short descriptor like 'Fast, wide regular pattern — 145 BPM · 12 cycles · 32 s'."""
    bpm   = phrase.get("bpm", 0)
    span  = phrase.get("amplitude_span", 0)
    label = phrase.get("pattern_label", "").strip() or "pattern"
    cycles = phrase.get("cycle_count")
    dur_s  = (phrase.get("end_ms", 0) - phrase.get("start_ms", 0)) / 1000

    if bpm < 80:
        tempo = "Slow"
    elif bpm < 120:
        tempo = "Moderate"
    elif bpm < 160:
        tempo = "Fast"
    else:
        tempo = "Very fast"

    if span < 30:
        amplitude = "narrow"
    elif span < 60:
        amplitude = "moderate"
    else:
        amplitude = "wide"

    parts = [f"{tempo}, {amplitude} {label}"]
    parts.append(f"{bpm:.0f} BPM")
    if cycles is not None:
        parts.append(f"{cycles} cycles")
    parts.append(f"{dur_s:.0f} s")

    return f"{parts[0]} — " + " · ".join(parts[1:])


# ------------------------------------------------------------------
# Fixed viewport calculation
# ------------------------------------------------------------------

def _fixed_viewport(phrases: list, phrase: dict, duration_ms: int):
    """Return (win_start, win_end) identical width for all phrases."""
    max_phrase_dur = max(
        (ph["end_ms"] - ph["start_ms"]) for ph in phrases
    ) if phrases else 60_000

    side_pad  = max(max_phrase_dur // 3, 10_000)
    half_win  = max_phrase_dur // 2 + side_pad

    center    = (phrase["start_ms"] + phrase["end_ms"]) // 2
    win_start = max(0, center - half_win)
    win_end   = min(duration_ms, center + half_win)

    total_width = 2 * half_win
    if win_start == 0:
        win_end   = min(duration_ms, total_width)
    if win_end == duration_ms:
        win_start = max(0, duration_ms - total_width)

    return win_start, win_end


# ------------------------------------------------------------------
# Chart renderer (fixed viewport, no modebar, dimmed outside phrase)
# ------------------------------------------------------------------

def _render_chart(
    actions: list,
    phrases: list,
    phrase_idx: int,
    win_start: int,
    win_end: int,
    view_state,
    chart_key: str,
    split_ms: Optional[int] = None,
    extra_phrase_end_ms: Optional[int] = None,
) -> None:
    from forge_ui_components.funscript_chart.core import compute_chart_data, AnnotationBand

    sel_phrase = phrases[phrase_idx]
    highlight_end = extra_phrase_end_ms if extra_phrase_end_ms else sel_phrase["end_ms"]
    label_text = (
        f"P{phrase_idx + 1} + P{phrase_idx + 2}" if extra_phrase_end_ms
        else f"P{phrase_idx + 1}"
    )

    # Build a selected band for the highlighted phrase
    selected_band = AnnotationBand(
        kind="phrase",
        start_ms=sel_phrase["start_ms"],
        end_ms=highlight_end,
        label=label_text,
        color="rgba(255,220,50,1.0)",
        name=label_text,
    )

    # Only get actions in the visible window
    window_actions = [a for a in actions if win_start <= a["at"] <= win_end]

    # Render as static PNG — fast, vibrant color with highlighted phrase
    from forge_ui_components.funscript_chart.static import render_static_chart
    series = compute_chart_data(window_actions)
    png = render_static_chart(
        series, [selected_band],
        color_mode="velocity",
        height_px=260,
        width_px=1000,
        show_labels=True,
        selected_band=selected_band,
    )
    st.image(png, use_container_width=True)


# ------------------------------------------------------------------
# Preview stats table
# ------------------------------------------------------------------

def _render_preview_stats(preview_actions: list, phrase: dict) -> None:
    """Show phrase metadata + position stats for the transformed phrase slice."""
    import pandas as pd

    phrase_start = phrase["start_ms"]
    phrase_end   = phrase["end_ms"]
    slice_acts   = [a for a in preview_actions if phrase_start <= a["at"] <= phrase_end]
    if not slice_acts:
        return

    positions = [a["pos"] for a in slice_acts]
    lo, hi    = min(positions), max(positions)
    mean_pos  = sum(positions) / len(positions)
    dur_ms    = phrase_end - phrase_start

    row = {
        "Start":    ms_to_timestamp(phrase_start),
        "End":      ms_to_timestamp(phrase_end),
        "Duration": f"{dur_ms / 1000:.1f} s",
        "BPM":      f"{phrase.get('bpm', 0):.1f}",
        "Pattern":  phrase.get("pattern_label", "—"),
        "Cycles":   phrase.get("cycle_count", "—"),
        "Min":      lo,
        "Max":      hi,
        "Range":    hi - lo,
        "Mean":     f"{mean_pos:.1f}",
        "Actions":  len(slice_acts),
    }
    st.dataframe(pd.DataFrame([row]), hide_index=True, width="stretch")


# ------------------------------------------------------------------
# Transform application
# ------------------------------------------------------------------

def _apply_transform_to_window(
    original_actions: list,
    phrase: dict,
    spec,
    param_values: dict,
) -> list:
    """Deep-copy original_actions, apply spec only to the phrase slice.
    Re-clamps to device limits after transform."""
    phrase_start = phrase["start_ms"]
    phrase_end   = phrase["end_ms"]

    result       = copy.deepcopy(original_actions)
    phrase_slice = [a for a in result if phrase_start <= a["at"] <= phrase_end]
    transformed  = spec.apply(phrase_slice, param_values)

    if spec.structural:
        # Timestamps changed — replace the phrase slice wholesale.
        outside = [a for a in result if not (phrase_start <= a["at"] <= phrase_end)]
        result = sorted(outside + transformed, key=lambda a: a["at"])
    else:
        t_to_pos = {a["at"]: a["pos"] for a in transformed}
        for a in result:
            if a["at"] in t_to_pos:
                a["pos"] = t_to_pos[a["at"]]

    # Re-clamp to device limits after transform
    result = _reclamp_actions_to_device_limits(result)
    return result


def _reclamp_actions_to_device_limits(actions: list) -> list:
    """Re-clamp actions to device limits. Reads device settings from session state."""
    forge = st.session_state.get("forge_project")
    if not forge:
        return actions
    targets = forge.get("output_targets", [])
    if not targets:
        return actions

    from forge.device_specs import combined_limits, apply_minimum_fix, INTENSITY_SPIKE_PRESETS
    limits = combined_limits(targets)
    if limits is None:
        return actions

    spike_name = forge.get("intensity_spikes", "None")
    spike_fraction = INTENSITY_SPIKE_PRESETS.get(spike_name, 0.0)
    fixed, _ = apply_minimum_fix(actions, limits, intensity_spikes=spike_fraction)
    return fixed


# ------------------------------------------------------------------
# Transform controls
# ------------------------------------------------------------------

def _clear_picker_state(phrase_idx: int) -> None:
    """Clear all session-state keys owned by the two-step transform picker."""
    for k in list(st.session_state):
        if k.startswith(f"txpick_{phrase_idx}_") or k.startswith(f"param_{phrase_idx}_"):
            del st.session_state[k]


def _render_transform_controls(phrase: dict, bpm_threshold: float, phrase_idx: int) -> None:
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG, suggest_transform
    from ui.streamlit.transform_picker import render_transform_picker

    suggested_key, _ = suggest_transform(phrase, bpm_threshold)

    st.markdown("**Transform**")
    st.caption(f"Suggested: **{TRANSFORM_CATALOG[suggested_key].name}**")

    phrase_duration_ms = phrase["end_ms"] - phrase["start_ms"]

    chosen_key = render_transform_picker(
        prefix             = f"txpick_{phrase_idx}",
        param_prefix       = f"param_{phrase_idx}",
        current_key        = "passthrough",
        transform_overrides = {
            "beat_accent": {
                "start_at_ms": {"max_value": phrase_duration_ms, "step": 500},
                "max_accents": {"max_value": 60},
            },
        },
    )

    spec = TRANSFORM_CATALOG[chosen_key]
    param_values = {
        pk: st.session_state.get(f"param_{phrase_idx}_{pk}", p.default)
        for pk, p in spec.params.items()
    }
    st.session_state[f"phrase_transform_{phrase_idx}"] = {
        "transform_key": chosen_key,
        "param_values":  param_values,
    }


# ------------------------------------------------------------------
# Split phrase controls
# ------------------------------------------------------------------

def _render_split_controls(
    phrase_idx: int,
    phrase: dict,
    original_actions: list,
    view_state,
    duration_ms: int,
) -> Optional[int]:
    """Render split mode UI: cycle slider + confirm/cancel buttons.

    The slider selects a cycle boundary (split *after* cycle N).
    The white split-line on the chart updates on each slider move.

    Returns split_ms (int) when the user clicks the Split confirm button,
    or None otherwise.
    """
    phrase_start = phrase["start_ms"]
    phrase_end   = phrase["end_ms"]

    st.markdown("**Split phrase**")

    def _cancel():
        st.session_state.pop(f"split_mode_{phrase_idx}", None)
        _clear_split_state(phrase_idx)
        st.rerun()

    # Fetch cycles within this phrase from the live assessment
    try:
        _project = st.session_state.project
        ph_cycles = sorted(
            [cy for cy in _project.assessment.cycles
             if phrase_start <= cy.start_ms and cy.end_ms <= phrase_end],
            key=lambda cy: cy.start_ms,
        )
    except (AttributeError, TypeError):
        ph_cycles = []  # assessment not yet loaded

    n_cycles = len(ph_cycles)

    if n_cycles < 2:
        st.warning(
            "Not enough cycle data to split by cycle. "
            "This phrase may have been manually split or has no detected cycles."
        )
        if st.button("Cancel split", key=f"split_cancel_{phrase_idx}", width="stretch"):
            _cancel()
        return None

    split_cycle_key = f"split_cycle_{phrase_idx}"

    if split_cycle_key not in st.session_state:
        st.session_state[split_cycle_key] = n_cycles // 2

    split_after = st.slider(
        f"Split on cycle (1–{n_cycles - 1})",
        min_value=1,
        max_value=n_cycles - 1,
        key=split_cycle_key,
    )

    # Split point = start of the cycle immediately after the selected one
    split_ms = ph_cycles[split_after].start_ms
    st.caption(
        f"Splits between cycle {split_after} and {split_after + 1} · **{ms_to_timestamp(split_ms)}**"
    )

    col_split, col_cancel = st.columns(2)
    do_split = col_split.button(
        "✂ Split", key=f"split_confirm_{phrase_idx}",
        type="primary", width="stretch",
    )
    if col_cancel.button("Cancel split", key=f"split_cancel_{phrase_idx}", width="stretch"):
        _cancel()

    return split_ms if do_split else None


def _split_phrase(
    phrase_idx: int,
    split_ms: int,
    view_state,
    duration_ms: int,
) -> None:
    """Split the phrase at split_ms into two new Phrase objects in-place."""
    from models import Phrase as PhraseModel

    project = st.session_state.project
    phrases = project.assessment.phrases
    orig    = phrases[phrase_idx]

    phrase_start = orig.start_ms
    phrase_end   = orig.end_ms
    total_dur    = phrase_end - phrase_start

    if total_dur <= 0 or not (phrase_start < split_ms < phrase_end):
        return

    frac_a = (split_ms - phrase_start) / total_dur
    osc_a  = max(1, round(orig.oscillation_count * frac_a))
    osc_b  = max(1, orig.oscillation_count - osc_a)
    cyc_a  = max(1, round(orig.cycle_count * frac_a))
    cyc_b  = max(1, orig.cycle_count - cyc_a)

    phrase_a = PhraseModel(
        start_ms=phrase_start,
        end_ms=split_ms,
        pattern_label=orig.pattern_label,
        cycle_count=cyc_a,
        description=orig.description + " (A)",
        oscillation_count=osc_a,
    )
    phrase_a.tags    = list(orig.tags)
    phrase_a.metrics = dict(orig.metrics)

    phrase_b = PhraseModel(
        start_ms=split_ms,
        end_ms=phrase_end,
        pattern_label=orig.pattern_label,
        cycle_count=cyc_b,
        description=orig.description + " (B)",
        oscillation_count=osc_b,
    )
    phrase_b.tags    = list(orig.tags)
    phrase_b.metrics = dict(orig.metrics)

    phrases[phrase_idx : phrase_idx + 1] = [phrase_a, phrase_b]

    # Clear ALL split state — indices shift after a split so stale keys
    # would mis-trigger split mode on the wrong phrases.
    _clear_all_split_state()

    view_state.set_selection(phrase_a.start_ms, phrase_a.end_ms)
    st.rerun()


def _clear_split_state(phrase_idx: int) -> None:
    st.session_state.pop(f"split_cycle_{phrase_idx}", None)


def _clear_all_split_state() -> None:
    """Remove every split_mode_* and split_cycle_* key from session state.

    Called on navigation so that index-shifted keys from earlier splits
    never accidentally activate split mode on the wrong phrase.
    """
    for k in [k for k in st.session_state
              if k.startswith("split_mode_") or k.startswith("split_cycle_")]:
        st.session_state.pop(k, None)


# ------------------------------------------------------------------
# Phrase navigation buttons
# ------------------------------------------------------------------

def _accept_pending(phrase_idx: int) -> None:
    """Auto-accept any non-passthrough pending transform before navigating.
    Device awareness is handled globally on the Device tab."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG
    _pending_key = st.session_state.get(f"txpick_{phrase_idx}_key", "passthrough")
    _chain_key = f"phrase_transform_chain_{phrase_idx}"
    _cur_chain = list(st.session_state.get(_chain_key, []))
    _changed = False

    if _pending_key != "passthrough":
        _pv = {
            pk: st.session_state.get(f"param_{phrase_idx}_{pk}", p.default)
            for pk, p in TRANSFORM_CATALOG[_pending_key].params.items()
        }
        _cur_chain.append({"transform_key": _pending_key, "param_values": _pv})
        _changed = True

    if _changed:
        st.session_state[_chain_key] = _cur_chain
        st.session_state["project_dirty"] = True
    # Clear snapshot — changes are being kept
    st.session_state.pop(f"_phrase_chain_snapshot_{phrase_idx}", None)
    _clear_picker_state(phrase_idx)


def _render_nav_buttons(phrases: list, phrase_idx: int, view_state, duration_ms: int) -> None:
    n = len(phrases)
    _chain_count = len(st.session_state.get(f"phrase_transform_chain_{phrase_idx}", []))

    st.caption(f"P{phrase_idx + 1} of {n}")
    if _chain_count:
        st.caption(f"✓ {_chain_count} transform{'s' if _chain_count > 1 else ''} applied")

    col_p, col_n, col_done = st.columns(3)
    with col_p:
        if st.button("⏮ Prev", key="pd_phrase_prev",
                     disabled=(phrase_idx == 0),
                     width="stretch"):
            _accept_pending(phrase_idx)
            _clear_all_split_state()
            _select_and_zoom(phrases[phrase_idx - 1], view_state, duration_ms)
            st.session_state["phrase_table_ver"] = st.session_state.get("phrase_table_ver", 0) + 1
            st.rerun()

    with col_n:
        if st.button("Next ⏭", key="pd_phrase_next",
                     disabled=(phrase_idx >= n - 1),
                     width="stretch"):
            _accept_pending(phrase_idx)
            _clear_all_split_state()
            _select_and_zoom(phrases[phrase_idx + 1], view_state, duration_ms)
            st.session_state["phrase_table_ver"] = st.session_state.get("phrase_table_ver", 0) + 1
            st.rerun()

    with col_done:
        if st.button("✓ Done", key="pd_done",
                     width="stretch", type="primary",
                     help="Save all phrase edits and return to overview"):
            _accept_pending(phrase_idx)
            _save_phrase_edits_to_chain(phrases)
            view_state.clear_selection()
            view_state.reset_zoom()
            st.session_state["phrase_table_ver"] = st.session_state.get("phrase_table_ver", 0) + 1
            st.session_state.phrase_sel_chart_instance = (
                st.session_state.get("phrase_sel_chart_instance", 0) + 1
            )
            st.rerun()


# ------------------------------------------------------------------
# Save / Cancel buttons
# ------------------------------------------------------------------

def _render_save_cancel(phrase_idx: int, view_state) -> None:
    """Apply accepts current transform and lets you add another.
    Cancel discards ALL changes for this phrase (entire chain)."""

    # Show green guidance if a transform was just applied
    _last_applied = st.session_state.pop(f"_phrase_last_applied_{phrase_idx}", None)
    _chain_count = len(st.session_state.get(f"phrase_transform_chain_{phrase_idx}", []))
    if _last_applied:
        from forge.tabs._ui_helpers import success_guidance
        if _chain_count > 1:
            success_guidance(f"P{phrase_idx + 1}: {_chain_count} transforms applied.")
        else:
            success_guidance(f"**{_last_applied}** applied to P{phrase_idx + 1}.")

    col_apply, col_cancel = st.columns(2)
    with col_apply:
        if st.button(
            "✓ Apply",
            key="pd_apply",
            width="stretch",
            type="primary",
            help="Accept this transform and add another",
        ):
            # Store what was applied for the green bar after rerun
            _pending_key = st.session_state.get(f"txpick_{phrase_idx}_key", "passthrough")
            if _pending_key != "passthrough":
                from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG
                _name = TRANSFORM_CATALOG.get(_pending_key, None)
                st.session_state[f"_phrase_last_applied_{phrase_idx}"] = _name.name if _name else _pending_key
            _accept_pending(phrase_idx)
            st.rerun()

    _chain_count = len(st.session_state.get(f"phrase_transform_chain_{phrase_idx}", []))
    if _chain_count:
        st.caption(f"✓ {_chain_count} transform{'s' if _chain_count > 1 else ''} applied")

    with col_cancel:
        if st.button(
            "✕ Cancel",
            key="pd_cancel",
            width="stretch",
            help="Discard all changes to this phrase",
        ):
            # Restore chain to snapshot taken on entry
            _chain_key = f"phrase_transform_chain_{phrase_idx}"
            _snapshot_key = f"_phrase_chain_snapshot_{phrase_idx}"
            _snapshot = st.session_state.get(_snapshot_key)
            if _snapshot is not None:
                st.session_state[_chain_key] = list(_snapshot)
            else:
                st.session_state.pop(_chain_key, None)
            st.session_state.pop(_snapshot_key, None)
            _clear_picker_state(phrase_idx)
            st.rerun()


# ------------------------------------------------------------------
# Edit Phrase section — structural phrase edits (split, concat)
# ------------------------------------------------------------------

def _render_edit_phrase(
    phrases: list,
    phrase_idx: int,
    view_state,
    duration_ms: int,
) -> None:
    """Render the Edit Phrase section: Split and Concat with Next Phrase.

    Concat is a two-step flow:
      1. Click "Concat with next phrase" → accepts pending transform, enters preview mode.
      2. Chart shows combined bounding box; user clicks Confirm or Cancel.
    """
    n = len(phrases)

    st.write("")
    st.markdown("**Edit Phrase**")

    # Split this phrase into two at a chosen cycle boundary
    if st.button(
        "✂ Split phrase",
        key=f"split_start_{phrase_idx}",
        help="Split this phrase into two at a chosen cycle boundary",
        width="stretch",
    ):
        st.session_state[f"split_mode_{phrase_idx}"] = True
        _clear_split_state(phrase_idx)
        st.rerun()

    # Concat with the next phrase — not shown on the last phrase
    if phrase_idx < n - 1:
        if st.button(
            "⊕ Concat with next phrase",
            key=f"concat_next_{phrase_idx}",
            help=(
                "Preview the combined bounding box of this phrase and the next. "
                "Useful for applying long-form transforms (e.g. Tide) across a bigger window."
            ),
            width="stretch",
        ):
            # Step 1: accept any pending transform, enter preview mode
            _accept_pending(phrase_idx)
            st.session_state[f"concat_preview_{phrase_idx}"] = True
            st.rerun()


def _render_concat_preview_controls(
    phrase_idx: int,
    phrase: dict,
    next_phrase: dict,
    view_state,
    duration_ms: int,
) -> None:
    """Controls shown during concat preview: combined info + Confirm / Cancel."""
    from utils import ms_to_timestamp as _mts

    combined_dur = (next_phrase["end_ms"] - phrase["start_ms"]) / 1000

    st.markdown("**Concat preview**")
    st.caption(
        f"P{phrase_idx + 1}: {_mts(phrase['start_ms'])} → {_mts(phrase['end_ms'])}\n\n"
        f"P{phrase_idx + 2}: {_mts(next_phrase['start_ms'])} → {_mts(next_phrase['end_ms'])}\n\n"
        f"Combined: **{combined_dur:.1f} s**"
    )

    st.write("")

    if st.button(
        "✓ Confirm concat",
        key=f"concat_confirm_{phrase_idx}",
        type="primary",
        width="stretch",
        help="Merge these two phrases into one",
    ):
        _do_concat_phrases(phrase_idx, view_state, duration_ms)

    if st.button(
        "✕ Cancel",
        key=f"concat_cancel_{phrase_idx}",
        width="stretch",
        help="Cancel — keep the phrases separate",
    ):
        st.session_state.pop(f"concat_preview_{phrase_idx}", None)
        st.rerun()


def _do_concat_phrases(phrase_idx: int, view_state, duration_ms: int) -> None:
    """Merge phrase_idx and phrase_idx+1 into a single phrase in the assessment."""
    from models import Phrase as PhraseModel

    project = st.session_state.project
    phrases = project.assessment.phrases
    if phrase_idx >= len(phrases) - 1:
        return

    a = phrases[phrase_idx]
    b = phrases[phrase_idx + 1]

    osc   = a.oscillation_count + b.oscillation_count
    cyc   = a.cycle_count + b.cycle_count
    label = a.pattern_label if a.pattern_label == b.pattern_label else f"{a.pattern_label}+{b.pattern_label}"

    merged = PhraseModel(
        start_ms=a.start_ms,
        end_ms=b.end_ms,
        pattern_label=label,
        cycle_count=cyc,
        description=f"{a.description} + {b.description}",
        oscillation_count=osc,
    )
    merged.tags    = list(set(list(a.tags) + list(b.tags)))
    merged.metrics = dict(a.metrics)  # keep first phrase metrics as baseline

    phrases[phrase_idx : phrase_idx + 2] = [merged]

    _clear_all_split_state()
    # Clear all concat preview state — indices shift after merge
    for k in [k for k in st.session_state if k.startswith("concat_preview_")]:
        st.session_state.pop(k, None)
    view_state.set_selection(merged.start_ms, merged.end_ms)
    st.session_state["phrase_table_ver"] = st.session_state.get("phrase_table_ver", 0) + 1
    st.rerun()


def build_edited_actions(phrases: list, original_actions: list) -> list:
    """Apply all accepted transform chains to original_actions."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    result = copy.deepcopy(original_actions)
    for idx, phrase in enumerate(phrases):
        chain = st.session_state.get(f"phrase_transform_chain_{idx}", [])
        for transform_state in chain:
            transform_key = transform_state.get("transform_key")
            if not transform_key or transform_key == "passthrough":
                continue
            spec = TRANSFORM_CATALOG.get(transform_key)
            if not spec:
                continue
            param_values = transform_state.get("param_values", {})
            phrase_start = phrase["start_ms"]
            phrase_end   = phrase["end_ms"]
            phrase_slice = [a for a in result if phrase_start <= a["at"] <= phrase_end]
            transformed  = spec.apply(phrase_slice, param_values)
            if spec.structural:
                outside = [a for a in result if not (phrase_start <= a["at"] <= phrase_end)]
                result = sorted(outside + transformed, key=lambda a: a["at"])
            else:
                t_to_pos = {a["at"]: a["pos"] for a in transformed}
                for a in result:
                    if a["at"] in t_to_pos:
                        a["pos"] = t_to_pos[a["at"]]
    return result


def _save_phrase_edits_to_chain(phrases: list) -> None:
    """Build the fully edited funscript and save it to the chain."""
    import json as _json
    from pathlib import Path
    from forge.project import save_chain_funscript, get_chain_funscript_for, save_forge

    project = st.session_state.get("forge_project")
    if not project:
        return

    # Read from chain (tone stage or earlier)
    chain_data = get_chain_funscript_for(project, "phrases")
    if not chain_data:
        import os as _os
        _chain_path = st.session_state.get("chain_funscript_path")
        if _chain_path and _os.path.isfile(_chain_path):
            chain_data = _json.loads(Path(_chain_path).read_text(encoding="utf-8"))
    if not chain_data:
        return

    original_actions = chain_data.get("actions", [])
    edited_actions = build_edited_actions(phrases, original_actions)

    # Save to chain
    chain_data["actions"] = edited_actions
    chain_path = save_chain_funscript(project, "phrases", chain_data)
    st.session_state["chain_funscript_path"] = chain_path

    # Update progress
    project["progress"]["phrases_edited"] = True
    if Path(project.get("output_folder", "")).exists():
        save_forge(project)



# ------------------------------------------------------------------
# Shared helpers
# ------------------------------------------------------------------

def _select_and_zoom(phrase: dict, view_state, duration_ms: int) -> None:
    view_state.set_selection(phrase["start_ms"], phrase["end_ms"])
    start = phrase["start_ms"]
    end   = phrase["end_ms"]
    pad   = max((end - start) // 5, 2_000)
    view_state.set_zoom(max(0, start - pad), min(duration_ms, end + pad))
