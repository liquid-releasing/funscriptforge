# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""pattern_editor.py — Behavioral pattern editor.

Phrases are classified into behavioral tags (stingy, giggle, drone, …)
by assessment/classifier.py.  This tab lets you:
  1. Select a tag to see all matching phrases.
  2. Pick one phrase instance and apply a transform (with live preview).
  3. Split an instance into sub-segments, each with its own transform.
  4. Apply the same split structure + transforms to all matching phrases at once.
  5. Download the fully edited funscript.

Split support
-------------
Each phrase instance can be divided into contiguous non-overlapping segments
by adding split points (absolute timestamps within the instance bounds).
Each segment carries its own transform choice and parameters.  Split points are
stored as ``pe_splits_{label}_{i}`` (sorted list of ms ints).  Per-segment
transforms are stored as ``pe_split_transform_{label}_{i}_{seg}``.  The old
single-instance key ``pe_transform_{label}_{i}`` is kept in sync for seg 0 so
the instance table and backward-compat code continue to work.

Layout
------
[Left 1/5]: Behavioral tag buttons with match counts + suggested transform
[Right 4/5]:
  - Subheader + tag description
  - Selector chart: full funscript, matching phrases highlighted
  - Instance table (Apply checkbox, Transform column shows segment info)
  - Three-column detail:
      [original (2)] | [preview (2)] | [splits + transform controls (1.5)]

Performance notes
-----------------
- original_actions cached in session state (no re-read on every slider tick)
- Preview computed on window slices only (no deepcopy of full action list)
- Instance charts use minimal raw Plotly lines (no FunscriptChart overhead)
- Download bytes only built when user clicks "Build download"
"""

from __future__ import annotations

import copy
import json
import os
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

import streamlit as st

if TYPE_CHECKING:
    from ui.common.project import Project


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------


def render(project: "Project") -> None:
    """Render the Pattern Editor tab."""
    from assessment.classifier import TAGS

    if project is None or not project.is_loaded:
        st.info("Load and analyse a funscript first.")
        return

    assessment_dict = project.assessment.to_dict()
    phrases: List[dict] = assessment_dict.get("phrases", [])

    if not phrases:
        st.info("No phrases detected — run the assessment first.")
        return

    # Group phrases by behavioral tag
    tag_to_phrases: Dict[str, List[dict]] = {}
    for ph in phrases:
        for tag in ph.get("tags", []):
            tag_to_phrases.setdefault(tag, []).append(ph)

    # Order tags by count descending; preserve TAGS registry order within same count
    tag_order = sorted(
        [t for t in TAGS if t in tag_to_phrases],
        key=lambda t: -len(tag_to_phrases[t]),
    )
    # Phrases with no tags at all → show an "unclassified" group
    unclassified = [ph for ph in phrases if not ph.get("tags")]
    if unclassified:
        tag_to_phrases["unclassified"] = unclassified
        tag_order.append("unclassified")

    if not tag_order:
        st.success("No behavioral issues detected in any phrase.")
        return

    # Session state
    valid_tags = tag_order
    if "pe_selected_label" not in st.session_state or st.session_state.pe_selected_label not in valid_tags:
        st.session_state.pe_selected_label = valid_tags[0]
    if "pe_selected_instance" not in st.session_state:
        st.session_state.pe_selected_instance = 0

    selected_tag: str  = st.session_state.pe_selected_label
    # Use chain funscript if available (device-aware + toned)
    import os as _os
    _chain_path = st.session_state.get("chain_funscript_path")
    funscript_path: str = _chain_path if (_chain_path and _os.path.isfile(_chain_path)) else project.funscript_path
    duration_ms: int   = project.assessment.duration_ms

    col_tags, col_detail = st.columns([1, 4])

    # Catalog stats (best-effort — catalog may be empty)
    catalog = st.session_state.get("pattern_catalog")
    catalog_stats = catalog.get_tag_stats() if catalog else {}

    with col_tags:
        st.markdown("**Behavioral tags**")
        for tag in tag_order:
            meta  = TAGS.get(tag)
            count = len(tag_to_phrases[tag])
            label = meta.label if meta else tag.replace("_", " ").title()
            cat   = catalog_stats.get(tag, {})
            total = cat.get("count", 0)
            files = cat.get("funscripts", 0)
            hint_parts = []
            if meta:
                hint_parts.append(f"Suggested: {meta.suggested_transform}")
            if total:
                hint_parts.append(f"Catalog: {total} phrases in {files} file{'s' if files != 1 else ''}")
            is_active = (tag == selected_tag)
            if st.button(
                f"{label}  ·  {count}",
                key=f"pe_tag_{tag}",
                type="primary" if is_active else "secondary",
                width="stretch",
                help="  |  ".join(hint_parts) if hint_parts else None,
            ):
                if tag != selected_tag:
                    st.session_state.pe_selected_label    = tag
                    st.session_state.pe_selected_instance = 0
                    st.rerun(scope="app")

    with col_detail:
        matching  = tag_to_phrases[selected_tag]
        phrase_idx = min(st.session_state.pe_selected_instance, len(matching) - 1)
        st.session_state.pe_selected_instance = phrase_idx

        _detail_fragment(
            funscript_path=funscript_path,
            selected_label=selected_tag,
            cycles=matching,
            phrase_idx=phrase_idx,
            duration_ms=duration_ms,
        )


# ------------------------------------------------------------------
# Split management helpers
# ------------------------------------------------------------------


def _get_splits(label: str, i: int) -> List[int]:
    """Return sorted list of split points (ms) for instance i."""
    return sorted(st.session_state.get(f"pe_splits_{label}_{i}", []))


def _get_segments(label: str, i: int, cycle: dict) -> List[Tuple[int, int]]:
    """Return list of (start_ms, end_ms) tuples for instance i."""
    splits = _get_splits(label, i)
    points = [cycle["start_ms"]] + splits + [cycle["end_ms"]]
    return [(points[j], points[j + 1]) for j in range(len(points) - 1)]


def _get_active_seg(label: str, i: int, n_segs: int) -> int:
    """Return the active segment index, clamped to the valid range."""
    return min(st.session_state.get(f"pe_active_seg_{label}_{i}", 0), max(0, n_segs - 1))


def _get_seg_transform(label: str, i: int, seg: int) -> dict:
    """Return the stored transform dict for segment *seg* of instance *i*.

    Falls back to the legacy ``pe_transform_{label}_{i}`` key for seg 0 so
    that instances set up before split support was added continue to work.
    """
    key = f"pe_split_transform_{label}_{i}_{seg}"
    if key in st.session_state:
        return st.session_state[key]
    if seg == 0:
        return st.session_state.get(f"pe_transform_{label}_{i}", {})
    return {}


def _set_seg_transform(label: str, i: int, seg: int, data: dict) -> None:
    """Persist the transform dict for segment *seg* of instance *i*."""
    st.session_state[f"pe_split_transform_{label}_{i}_{seg}"] = data
    # Keep the legacy key in sync for seg 0 (instance table reads it)
    if seg == 0:
        st.session_state[f"pe_transform_{label}_{i}"] = data


def _add_split_point(label: str, i: int, cycle: dict, new_ms: int) -> bool:
    """Insert a split point at *new_ms* and renumber segment transforms.

    The segment containing *new_ms* is split in two; the right half inherits
    the left half's transform.  All subsequent transforms are renumbered +1.
    Returns True on success, False if the split is invalid.
    """
    from ui.streamlit.undo_helpers import push_undo
    push_undo(f"Add split at {new_ms // 1000 // 60}:{(new_ms // 1000) % 60:02d}")
    splits = _get_splits(label, i)
    if new_ms <= cycle["start_ms"] or new_ms >= cycle["end_ms"]:
        return False
    if new_ms in splits:
        return False

    segments = _get_segments(label, i, cycle)
    split_seg_idx = next(
        (j for j, (s, e) in enumerate(segments) if s < new_ms < e), None
    )
    if split_seg_idx is None:
        return False

    # Snapshot all transforms before touching state
    old_tx = {j: _get_seg_transform(label, i, j) for j in range(len(segments))}

    # Commit the new split point
    st.session_state[f"pe_splits_{label}_{i}"] = sorted(splits + [new_ms])

    # Renumber segment transforms
    new_n = len(segments) + 1
    for j in range(new_n):
        if j <= split_seg_idx:
            tx = old_tx.get(j, {})
        elif j == split_seg_idx + 1:
            tx = copy.deepcopy(old_tx.get(split_seg_idx, {}))  # inherit left
        else:
            tx = old_tx.get(j - 1, {})
        if tx:
            _set_seg_transform(label, i, j, tx)

    return True


def _remove_split_boundary(label: str, i: int, cycle: dict, split_idx: int) -> bool:
    """Remove the split boundary at ``splits[split_idx]``.

    Merges segments *split_idx* and *split_idx+1*; the merged segment keeps
    the left segment's transform.  Subsequent segments renumbered -1.
    Returns True on success.
    """
    from ui.streamlit.undo_helpers import push_undo
    push_undo("Remove split")

    splits = _get_splits(label, i)
    if not splits or split_idx >= len(splits):
        return False

    segments = _get_segments(label, i, cycle)
    n = len(segments)
    old_tx = {j: _get_seg_transform(label, i, j) for j in range(n)}

    new_splits = [s for j, s in enumerate(splits) if j != split_idx]
    st.session_state[f"pe_splits_{label}_{i}"] = new_splits

    new_n = n - 1
    for j in range(new_n):
        tx = old_tx.get(j, {}) if j <= split_idx else old_tx.get(j + 1, {})
        if tx:
            _set_seg_transform(label, i, j, tx)

    return True


def _build_combined_preview(
    original_actions: List[dict],
    cycle: dict,
    label: str,
    i: int,
) -> List[dict]:
    """Return the combined preview for all segments of instance *i*."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    segments = _get_segments(label, i, cycle)
    result: List[dict] = []
    for seg_idx, (seg_s, seg_e) in enumerate(segments):
        window = [a for a in original_actions if seg_s <= a["at"] <= seg_e]
        stored = _get_seg_transform(label, i, seg_idx)
        tx_key = stored.get("transform_key", "passthrough")
        if tx_key and tx_key != "passthrough":
            param_values = stored.get("param_values", {})
            spec = TRANSFORM_CATALOG.get(tx_key, TRANSFORM_CATALOG["passthrough"])
            result.extend(_apply_transform_to_window(window, cycle, spec, param_values))
        else:
            result.extend(window)
    return sorted(result, key=lambda a: a["at"])


def _copy_instance_to_all(
    label: str,
    from_i: int,
    from_cycle: dict,
    cycles: List[dict],
) -> None:
    """Copy the split structure (proportionally) and transforms of *from_i* to all others."""
    from_splits   = _get_splits(label, from_i)
    from_start    = from_cycle["start_ms"]
    from_duration = from_cycle["end_ms"] - from_cycle["start_ms"]
    from_segments = _get_segments(label, from_i, from_cycle)

    for i, dest_cycle in enumerate(cycles):
        if i == from_i:
            continue
        dest_start    = dest_cycle["start_ms"]
        dest_duration = dest_cycle["end_ms"] - dest_cycle["start_ms"]

        if from_splits and from_duration > 0:
            dest_splits = []
            for sp in from_splits:
                rel    = (sp - from_start) / from_duration
                new_sp = int(dest_start + rel * dest_duration)
                new_sp = max(dest_cycle["start_ms"] + 1,
                             min(dest_cycle["end_ms"] - 1, new_sp))
                dest_splits.append(new_sp)
            st.session_state[f"pe_splits_{label}_{i}"] = sorted(dest_splits)
        else:
            st.session_state[f"pe_splits_{label}_{i}"] = []

        for seg_idx in range(len(from_segments)):
            stored = _get_seg_transform(label, from_i, seg_idx)
            if stored:
                _set_seg_transform(label, i, seg_idx, copy.deepcopy(stored))


# ------------------------------------------------------------------
# Detail fragment — selector chart, instance table, editor
# ------------------------------------------------------------------


@st.fragment
def _detail_fragment(
    funscript_path: str,
    selected_label: str,
    cycles: List[dict],
    phrase_idx: int,
    duration_ms: int,
) -> None:
    from assessment.classifier import TAGS

    n_instances  = len(cycles)
    meta         = TAGS.get(selected_label)
    display_name = meta.label if meta else selected_label.replace("_", " ").title()
    st.subheader(f"{display_name}  ·  {n_instances} phrase{'s' if n_instances != 1 else ''}")
    if meta:
        st.caption(meta.description)
        st.caption(f"Suggested transform: **{meta.suggested_transform}** — {meta.fix_hint}")

    # Catalog context for this tag
    catalog = st.session_state.get("pattern_catalog")
    if catalog:
        cs = catalog.get_tag_stats().get(selected_label, {})
        if cs.get("count", 0) > 0:
            st.caption(
                f"Catalog: **{cs['count']}** phrases tagged *{display_name}* "
                f"across **{cs['funscripts']}** file{'s' if cs['funscripts'] != 1 else ''} — "
                f"typical BPM {cs['bpm_min']}–{cs['bpm_max']} "
                f"· span {cs['span_min']}–{cs['span_max']}"
            )

    # Cache original actions — read once per funscript path
    cache_key = f"pe_actions_{funscript_path}"
    if cache_key not in st.session_state:
        with open(funscript_path) as f:
            st.session_state[cache_key] = json.load(f)["actions"]
    original_actions: List[dict] = st.session_state[cache_key]

    # Show edited version in selector chart if phrase editor transforms exist
    from ui.streamlit.panels.phrase_detail import build_edited_actions
    has_edits = any(
        k.startswith("phrase_transform_chain_")
        and isinstance(st.session_state[k], list)
        and len(st.session_state[k]) > 0
        and any(t.get("transform_key", "passthrough") != "passthrough" for t in st.session_state[k])
        for k in st.session_state
    )
    if has_edits:
        proj = st.session_state.get("project")
        if proj and proj.is_loaded:
            _all_phrases = proj.assessment.to_dict().get("phrases", [])
            selector_actions = build_edited_actions(_all_phrases, original_actions)
        else:
            selector_actions = original_actions
        st.info("These edits have not been saved — ready for export.", icon="💾")
    else:
        selector_actions = original_actions

    # Selector chart
    _draw_selector_chart(
        actions=selector_actions,
        cycles=cycles,
        selected_idx=phrase_idx,
        duration_ms=duration_ms,
        selected_label=selected_label,
    )

    # Instance table
    _render_instance_table(
        cycles=cycles,
        selected_label=selected_label,
        phrase_idx=phrase_idx,
    )

    st.divider()

    cycle    = cycles[phrase_idx]
    start_ms = cycle["start_ms"]
    end_ms   = cycle["end_ms"]
    inst_idx = phrase_idx

    # Original window — full instance, untransformed
    original_window = [a for a in original_actions if start_ms <= a["at"] <= end_ms]

    # Preview — transform applied to this instance
    preview_window = _build_combined_preview(original_actions, cycle, selected_label, inst_idx)

    # Stable preview key — changes when transform changes
    _tx_state   = str(_get_seg_transform(selected_label, inst_idx, 0))
    preview_key = f"pe_prev_{selected_label}_{inst_idx}_{hash(_tx_state) % 1_000_000}"

    col_orig, col_prev, col_ctrl = st.columns([2, 2, 1.5])

    with col_orig:
        st.caption(f"**Original — #{inst_idx + 1}**")
        _draw_instance_chart(
            actions=original_window,
            start_ms=start_ms,
            end_ms=end_ms,
            key=f"pe_orig_{selected_label}_{inst_idx}",
            height=220,
            split_points=[],
        )

    with col_prev:
        st.caption("**Preview**")
        _draw_instance_chart(
            actions=preview_window,
            start_ms=start_ms,
            end_ms=end_ms,
            key=preview_key,
            height=220,
            split_points=[],
        )
        st.caption("*(not saved)*")

    with col_ctrl:
        _render_controls(
            selected_label=selected_label,
            inst_idx=inst_idx,
            cycle=cycle,
            cycles=cycles,
            n_instances=n_instances,
            original_actions=original_actions,
            funscript_path=funscript_path,
        )

    # Phrase-restricted audio player — restricted to [start_ms, end_ms]
    _media_path = st.session_state.get("media_path")
    if _media_path and os.path.exists(_media_path):
        from ui.streamlit.panels.media_player import AUDIO_EXTS
        _ext = os.path.splitext(_media_path)[1].lower()
        if _ext in AUDIO_EXTS:
            from utils import ms_to_timestamp

            _show_key = f"pe_show_player_{selected_label}_{inst_idx}"
            _show_player = st.checkbox(
                "Show audio player",
                value=st.session_state.get(_show_key, False),
                key=_show_key,
            )
            if _show_player:
                import base64
                from ui.streamlit.components.audio_player import phrase_audio_player
                from ui.streamlit.panels.media_player import _read_media_bytes

                st.caption(
                    f"**{_media_path}**\n\n"
                    f"{ms_to_timestamp(start_ms)} → {ms_to_timestamp(end_ms)}"
                )

                _mime_map = {
                    ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
                    ".wav": "audio/wav",  ".ogg": "audio/ogg", ".aac": "audio/aac",
                }
                _mime       = _mime_map.get(_ext, "audio/mpeg")
                _audio_hash = f"{_media_path}:{os.path.getmtime(_media_path)}"
                _raw        = _read_media_bytes(_media_path, os.path.getmtime(_media_path))
                _b64        = base64.b64encode(_raw).decode()
                _split_pts  = _get_splits(selected_label, inst_idx)

                _player_result = phrase_audio_player(
                    audio_b64=_b64,
                    audio_mime=_mime,
                    audio_hash=_audio_hash,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    actions=[{"at": a["at"], "pos": a["pos"]} for a in original_window],
                    split_points=_split_pts,
                    key=f"ap_{selected_label}_{inst_idx}",
                )
                if _player_result and "split_ms" in _player_result:
                    _split_ms = int(_player_result["split_ms"])
                    if _add_split_point(selected_label, inst_idx, cycle, _split_ms):
                        st.rerun(scope="app")


# ------------------------------------------------------------------
# Instance table
# ------------------------------------------------------------------


def _render_instance_table(
    cycles: List[dict],
    selected_label: str,
    phrase_idx: int,
) -> None:
    """Render a selectable data-editor of all phrase instances for the active tag."""
    import pandas as pd
    from assessment.classifier import TAGS
    from utils import ms_to_timestamp

    meta      = TAGS.get(selected_label)
    suggested = meta.suggested_transform if meta else "—"

    rows = []
    for i, cy in enumerate(cycles):
        m      = cy.get("metrics", {})
        splits = _get_splits(selected_label, i)
        n_segs = len(splits) + 1

        if n_segs > 1:
            tx_display = f"{n_segs} segments"
        else:
            stored = _get_seg_transform(selected_label, i, 0)
            tx_key = stored.get("transform_key", "")
            tx_display = tx_key if (tx_key and tx_key != "passthrough") else suggested

        apply = st.session_state.get(f"pe_apply_{selected_label}_{i}", False)
        rows.append({
            "Apply":     apply,
            "#":         i + 1,
            "Pattern":   cy.get("pattern_label", "—"),
            "Start":     ms_to_timestamp(cy["start_ms"]),
            "End":       ms_to_timestamp(cy["end_ms"]),
            "Duration":  ms_to_timestamp(cy["end_ms"] - cy["start_ms"]),
            "BPM":       round(cy.get("bpm", 0), 1),
            "Span":      round(m.get("span", 0), 1),
            "Centre":    round(m.get("mean_pos", 50), 1),
            "Velocity":  round(m.get("mean_velocity", 0), 3),
            "CV BPM":    round(m.get("cv_bpm", 0), 3),
            "Transform": tx_display,
        })

    df = pd.DataFrame(rows)

    _READ_ONLY = ["#", "Pattern", "Start", "End", "Duration",
                  "BPM", "Span", "Centre", "Velocity", "CV BPM", "Transform"]

    edited = st.data_editor(
        df,
        hide_index=True,
        key=f"pe_instance_table_{selected_label}",
        disabled=_READ_ONLY,
        column_config={
            "Apply":     st.column_config.CheckboxColumn("✓", default=False, width="small"),
            "#":         st.column_config.NumberColumn(width="small"),
            "Pattern":   st.column_config.TextColumn(width="medium"),
            "Start":     st.column_config.TextColumn(width="small"),
            "End":       st.column_config.TextColumn(width="small"),
            "Duration":  st.column_config.TextColumn(width="small"),
            "BPM":       st.column_config.NumberColumn(width="small"),
            "Span":      st.column_config.NumberColumn(width="small"),
            "Centre":    st.column_config.NumberColumn(width="small"),
            "Velocity":  st.column_config.NumberColumn(width="small", format="%.3f"),
            "CV BPM":    st.column_config.NumberColumn(width="small", format="%.3f"),
            "Transform": st.column_config.TextColumn(width="medium"),
        },
    )

    # Persist Apply states and detect selection changes
    _prev_selected = st.session_state.get("pe_selected_instance", 0)
    _new_selected = _prev_selected
    for i, row in edited.iterrows():
        _was_applied = st.session_state.get(f"pe_apply_{selected_label}_{i}", False)
        _now_applied = bool(row["Apply"])
        st.session_state[f"pe_apply_{selected_label}_{i}"] = _now_applied
        # If user just checked this row, select it for editing
        if _now_applied and not _was_applied:
            _new_selected = i

    if _new_selected != _prev_selected:
        st.session_state.pe_selected_instance = _new_selected
        st.rerun()


# ------------------------------------------------------------------
# Controls column — splits management + per-segment transform
# ------------------------------------------------------------------


def _render_controls(
    selected_label: str,
    inst_idx: int,
    cycle: dict,
    cycles: List[dict],
    n_instances: int,
    original_actions: List[dict],
    funscript_path: str,
) -> None:
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG
    from ui.streamlit.transform_picker import render_transform_picker
    from utils import ms_to_timestamp

    # Always single segment (no splits)
    active_seg = 0

    # ------------------------------------------------------------------
    # Prev / Next navigation — top of controls
    # ------------------------------------------------------------------
    st.caption(f"#{inst_idx + 1} of {n_instances}")
    col_p, col_n = st.columns(2)
    with col_p:
        if st.button(
            "◀ Prev",
            key=f"pe_prev_{selected_label}_{inst_idx}",
            disabled=(inst_idx == 0),
            width="stretch",
        ):
            st.session_state.pe_selected_instance = inst_idx - 1
            st.rerun(scope="app")
    with col_n:
        if st.button(
            "Next ▶",
            key=f"pe_next_{selected_label}_{inst_idx}",
            disabled=(inst_idx >= n_instances - 1),
            width="stretch",
        ):
            st.session_state.pe_selected_instance = inst_idx + 1
            st.rerun(scope="app")

    st.divider()

    # ------------------------------------------------------------------
    # Transform
    # ------------------------------------------------------------------
    st.markdown("**Transform**")

    stored     = _get_seg_transform(selected_label, inst_idx, active_seg)
    stored_key = stored.get("transform_key", "passthrough")

    _pe_prefix      = f"pe_txpick_{selected_label}_{inst_idx}_{active_seg}"
    _pe_param_pfx   = f"pe_tx_{selected_label}_{inst_idx}_{active_seg}"
    cycle_duration_ms = cycle["end_ms"] - cycle["start_ms"]

    chosen_key = render_transform_picker(
        prefix             = _pe_prefix,
        param_prefix       = _pe_param_pfx,
        current_key        = stored_key,
        transform_overrides = {
            "beat_accent": {
                "start_at_ms": {"max_value": cycle_duration_ms, "step": 500},
                "max_accents": {"max_value": 60},
            },
        },
    )
    spec = TRANSFORM_CATALOG[chosen_key]
    param_values: Dict[str, Any] = {
        pk: st.session_state.get(f"{_pe_param_pfx}_{pk}", p.default)
        for pk, p in spec.params.items()
    }

    # Persist transform for this instance
    _set_seg_transform(selected_label, inst_idx, active_seg, {
        "transform_key": chosen_key,
        "param_values":  param_values,
    })

    st.divider()

    # Apply to this instance only
    if st.button(
        "Apply",
        key=f"pe_apply_{selected_label}_{inst_idx}_single",
        width="stretch",
        type="primary",
        help="Mark this instance as done and go to Export.",
    ):
        proj = st.session_state.get("project")
        if proj and proj.is_loaded:
            for wi in proj.work_items:
                if wi.start_ms == cycle["start_ms"]:
                    proj.set_item_status(wi.id, "done")
        st.session_state.goto_tab = 3
        st.rerun(scope="app")

    # Apply this instance's transform to all other instances of the same behavior
    if st.button(
        f"Apply to all {n_instances} '{selected_label}' patterns",
        key=f"pe_apply_all_{selected_label}_{inst_idx}",
        width="stretch",
        help=f"Copy this transform to every instance of '{selected_label}' ({n_instances} total).",
    ):
        from ui.streamlit.undo_helpers import push_undo
        push_undo(f"Apply transform to all '{selected_label}'")
        _copy_instance_to_all(selected_label, inst_idx, cycle, cycles)
        # Mark every matching work item as done
        proj = st.session_state.get("project")
        if proj and proj.is_loaded:
            cycle_starts = {cy["start_ms"] for cy in cycles}
            for wi in proj.work_items:
                if wi.start_ms in cycle_starts:
                    proj.set_item_status(wi.id, "done")
        st.session_state.goto_tab = 3
        st.rerun(scope="app")

    # Save to catalog, Replace with saved pattern, and Build download
    # removed — use the Export tab for final output. Catalog save belongs
    # in a future cycle-level editor.


# ------------------------------------------------------------------
# Selector chart
# ------------------------------------------------------------------


def _draw_selector_chart(
    actions: List[dict],
    cycles: List[dict],
    selected_idx: int,
    duration_ms: int,
    selected_label: str,
) -> None:
    import plotly.graph_objects as go

    if not actions:
        return

    times_all = [a["at"] for a in actions]
    pos_all   = [a["pos"] for a in actions]

    fig = go.Figure()

    # Base layer: full funscript in dark grey
    fig.add_trace(go.Scatter(
        x=times_all, y=pos_all,
        mode="lines",
        line=dict(color="rgba(100,100,100,0.30)", width=1),
        showlegend=False, hoverinfo="skip",
    ))

    # Overlay each instance — white for selected, orange for others
    for i, cy in enumerate(cycles):
        seg = [(a["at"], a["pos"]) for a in actions
               if cy["start_ms"] <= a["at"] <= cy["end_ms"]]
        if not seg:
            continue
        sx, sy  = zip(*seg)
        is_sel  = (i == selected_idx)
        color   = "rgba(255,255,255,0.95)" if is_sel else "rgba(255,165,0,0.60)"
        width   = 2 if is_sel else 1.5
        fig.add_trace(go.Scatter(
            x=sx, y=sy,
            mode="lines",
            line=dict(color=color, width=width),
            showlegend=False, hoverinfo="skip",
        ))

    # Label only the selected instance
    sel_cy = cycles[selected_idx]
    fig.add_annotation(
        x=sel_cy["start_ms"], y=95,
        text=f"#{selected_idx + 1}",
        showarrow=False, xanchor="left", yanchor="top",
        font=dict(size=10, color="rgba(255,255,255,0.9)"),
        bgcolor="rgba(0,0,0,0)",
    )

    _BG = "rgba(14,14,18,1)"
    fig.update_layout(
        height=150,
        margin=dict(l=0, r=0, t=4, b=24),
        paper_bgcolor=_BG, plot_bgcolor=_BG,
        xaxis=dict(
            range=[0, duration_ms], autorange=False,
            showgrid=False, zeroline=False,
            tickfont=dict(color="rgba(180,180,180,0.6)", size=9),
        ),
        yaxis=dict(
            range=[0, 100], showgrid=False, zeroline=False,
            showticklabels=False,
        ),
    )

    st.plotly_chart(
        fig,
        key=f"pe_sel_chart_{selected_label}_{selected_idx}",
        config={"displayModeBar": False},
    )


# ------------------------------------------------------------------
# Instance chart (window only) — minimal raw Plotly, no FunscriptChart
# ------------------------------------------------------------------


def _draw_instance_chart(
    actions: List[dict],
    start_ms: int,
    end_ms: int,
    key: str,
    height: int = 220,
    split_points: Optional[List[int]] = None,
) -> None:
    import plotly.graph_objects as go

    if not actions:
        st.caption("*(no actions in window)*")
        return

    xs = [a["at"] for a in actions]
    ys = [a["pos"] for a in actions]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=xs, y=ys,
        mode="lines+markers",
        line=dict(color="rgba(200,200,200,0.85)", width=1.5),
        marker=dict(size=3, color="rgba(200,200,200,0.7)"),
        showlegend=False, hoverinfo="skip",
    ))

    # Draw split boundaries as dashed orange vertical lines
    if split_points:
        for sp in split_points:
            if start_ms < sp < end_ms:
                fig.add_vline(
                    x=sp,
                    line_dash="dash",
                    line_color="rgba(255,165,0,0.65)",
                    line_width=1.5,
                )

    _BG = "rgba(14,14,18,1)"
    fig.update_layout(
        height=height,
        margin=dict(l=0, r=0, t=4, b=24),
        paper_bgcolor=_BG, plot_bgcolor=_BG,
        xaxis=dict(
            range=[start_ms, end_ms], autorange=False,
            showgrid=False, zeroline=False,
            tickfont=dict(color="rgba(180,180,180,0.6)", size=9),
        ),
        yaxis=dict(
            range=[0, 100], showgrid=False, zeroline=False,
            showticklabels=False,
        ),
    )

    st.plotly_chart(fig, key=key, config={"displayModeBar": False})


# ------------------------------------------------------------------
# Transform application — operates on window slice only
# ------------------------------------------------------------------


def _apply_transform_to_window(
    window_actions: List[dict],
    cycle: dict,
    spec,
    param_values: dict,
) -> List[dict]:
    """Apply *spec* to *window_actions* (already filtered to the window).

    Returns a list of actions with the transform applied.  Only the window
    slice is deep-copied — the full action list is never touched.
    """
    if not window_actions:
        return []
    slice_copy  = copy.deepcopy(window_actions)
    transformed = spec.apply(slice_copy, param_values)
    # Re-clamp to device limits after transform
    return _reclamp_actions(transformed)


def _reclamp_actions(actions: list) -> list:
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
# Finalize options + download
# ------------------------------------------------------------------


def _render_finalize_and_download(
    selected_label: str,
    cycles: List[dict],
    original_actions: List[dict],
    funscript_path: str,
) -> None:
    # Build download only on explicit request — not on every slider tick
    if st.button(
        "Build download",
        key=f"pe_build_{selected_label}",
        width="stretch",
        help="Compile all transforms into a downloadable funscript.",
    ):
        edited = _build_all_transforms(cycles, selected_label, original_actions)

        try:
            with open(funscript_path) as f:
                raw = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            raw = {}  # fall back to bare structure if source file is unavailable

        raw["actions"] = sorted(edited, key=lambda a: a["at"])
        st.session_state[f"pe_download_bytes_{selected_label}"] = json.dumps(raw, indent=2).encode()

    # Download button — shown once bytes have been built
    dl_bytes = st.session_state.get(f"pe_download_bytes_{selected_label}")
    if dl_bytes:
        stem = os.path.splitext(os.path.basename(funscript_path))[0]
        if stem.endswith(".original"):
            stem = stem[:-9]
        download_name = f"{stem}_pattern_edited.funscript"

        st.download_button(
            "Download",
            data=dl_bytes,
            file_name=download_name,
            mime="application/json",
            key=f"pe_download_{selected_label}",
            width="stretch",
            help=f"Download as {download_name}",
        )
    else:
        st.caption("Open *Finalize options* and click **Build download** to prepare the file.")


# ------------------------------------------------------------------
# Build edited actions — all instances, all segments
# ------------------------------------------------------------------


def _build_all_transforms(
    cycles: List[dict],
    selected_label: str,
    original_actions: List[dict],
) -> List[dict]:
    """Apply all stored per-instance, per-segment transforms to *original_actions*."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    result = copy.deepcopy(original_actions)

    for i, cycle in enumerate(cycles):
        if not st.session_state.get(f"pe_apply_{selected_label}_{i}", False):
            continue

        segments = _get_segments(selected_label, i, cycle)
        for seg_idx, (seg_s, seg_e) in enumerate(segments):
            stored  = _get_seg_transform(selected_label, i, seg_idx)
            tx_key  = stored.get("transform_key")
            if not tx_key or tx_key == "passthrough":
                continue
            param_values = stored.get("param_values", {})
            spec = TRANSFORM_CATALOG.get(tx_key)
            if not spec:
                continue

            seg_slice   = [a for a in result if seg_s <= a["at"] <= seg_e]
            transformed = _reclamp_actions(spec.apply(copy.deepcopy(seg_slice), param_values))

            if spec.structural:
                outside = [a for a in result if not (seg_s <= a["at"] <= seg_e)]
                result  = sorted(outside + transformed, key=lambda a: a["at"])
            else:
                t_to_pos = {a["at"]: a["pos"] for a in transformed}
                for a in result:
                    if a["at"] in t_to_pos:
                        a["pos"] = t_to_pos[a["at"]]

    return result
