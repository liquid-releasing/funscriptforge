# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""export_panel.py — Export tab: transform change log + download.

Two sections
------------
1. Completed transforms  — manually applied in Phrase Editor or Pattern Editor.
   Each row has a 🗑 reject button.
2. Recommended transforms — auto-suggested for phrases that have no manual transform.
   Each row has a ✏ edit button (opens Phrase Editor) and a 🗑 reject button.

The Download button applies all non-rejected entries from both lists.
"""

from __future__ import annotations

import copy
import json
import os
from datetime import datetime
from typing import TYPE_CHECKING, Dict, List, Optional

import streamlit as st

from utils import ms_to_timestamp

if TYPE_CHECKING:
    from ui.common.project import Project

# Column widths / headers for each table
_COL_W_DONE    = [0.4, 2.8, 1.0, 2.8, 1.8, 2.0, 1.5, 0.6]
_HEADERS_DONE  = ["#", "Time", "Dur (s)", "Transform", "Source", "BPM", "Cycles", ""]

_COL_W_REC     = [0.4, 2.8, 1.0, 3.2, 2.0, 1.5, 0.5, 0.5, 0.5]
_HEADERS_REC   = ["#", "Time", "Dur (s)", "Transform", "BPM", "Cycles", "", "", ""]


def _get_funscript_path(project) -> str:
    """Get the best funscript path — chain if available, otherwise original."""
    _chain = st.session_state.get("chain_funscript_path")
    if _chain and os.path.isfile(_chain):
        return _chain
    return project.funscript_path


# ------------------------------------------------------------------
# Output integrity helpers (#9 position clamp, #10 dedup/sort)
# ------------------------------------------------------------------

def _clamp_sort_dedup(actions: list) -> int:
    """Sort by timestamp, deduplicate (last pos wins for same `at`), clamp pos to [0, 100].

    Mutates *actions* in-place.  Returns the number of actions that were clamped.
    """
    # Sort by timestamp
    actions.sort(key=lambda a: a["at"])
    # Deduplicate: keep last pos written for each timestamp
    seen: Dict[int, int] = {}
    for a in actions:
        seen[a["at"]] = a["pos"]
    actions[:] = [{"at": t, "pos": p} for t, p in seen.items()]
    # Clamp
    clamp_count = 0
    for a in actions:
        clamped = max(0, min(100, a["pos"]))
        if clamped != a["pos"]:
            clamp_count += 1
            a["pos"] = clamped
    return clamp_count


# ------------------------------------------------------------------
# Quality gate (#13)
# ------------------------------------------------------------------

def _check_quality(actions: list) -> List[dict]:
    """Run device-awareness checks on a final action list.

    Checks
    ------
    * Velocity > 200 pos/s  — warning (may exceed device limits)
    * Velocity > 300 pos/s  — error   (likely exceeds device limits)
    * Interval < 50 ms      — warning (some devices ignore short gaps)

    Returns a list of issue dicts: ``{level, message, at}``.
    """
    issues: List[dict] = []
    for i in range(1, len(actions)):
        a0, a1 = actions[i - 1], actions[i]
        dt_ms = a1["at"] - a0["at"]
        if dt_ms <= 0:
            continue
        dp = abs(a1["pos"] - a0["pos"])
        velocity = dp / dt_ms * 1000  # pos per second

        if velocity > 300:
            issues.append({
                "level": "error",
                "message": f"Velocity {velocity:.0f} pos/s — likely exceeds device limit",
                "at": a0["at"],
            })
        elif velocity > 200:
            issues.append({
                "level": "warning",
                "message": f"Velocity {velocity:.0f} pos/s — may exceed device limit",
                "at": a0["at"],
            })

        if dt_ms < 50:
            issues.append({
                "level": "warning",
                "message": f"Short interval {dt_ms} ms — some devices ignore gaps < 50 ms",
                "at": a0["at"],
            })

    return issues


def _render_quality_gate(project, plan: List[dict]) -> None:
    """Collapsible quality check section — runs on the proposed export output."""
    with st.expander("Quality check", expanded=False):
        st.caption(
            "Analyses the proposed export (all accepted transforms applied) for "
            "velocity spikes and short intervals that may cause device issues."
        )
        if st.button("Run quality check", key="quality_run_btn"):
            with st.spinner("Checking…"):
                with open(_get_funscript_path(project), encoding="utf-8") as _f:
                    _fs = json.load(_f)
                _rej = st.session_state.get("export_rejected", set())
                _acc = st.session_state.get("export_accepted", set())
                _actions = _apply_plan_transforms(_fs.get("actions", []), plan, _rej, _acc)
                _issues  = _check_quality(_actions)
                st.session_state["quality_gate_result"] = {
                    "issues":       _issues,
                    "action_count": len(_actions),
                    "source_file":  _get_funscript_path(project),
                }
            st.rerun()

        qr = st.session_state.get("quality_gate_result")
        if qr and qr.get("source_file") == _get_funscript_path(project):
            issues   = qr["issues"]
            errors   = [i for i in issues if i["level"] == "error"]
            warnings = [i for i in issues if i["level"] == "warning"]

            if not issues:
                st.success(f"✅ All checks passed — {qr['action_count']} actions")
            elif errors:
                st.error(
                    f"❌ {len(errors)} error{'s' if len(errors) != 1 else ''}, "
                    f"{len(warnings)} warning{'s' if len(warnings) != 1 else ''} "
                    f"— {qr['action_count']} actions"
                )
            else:
                st.warning(
                    f"⚠️ {len(warnings)} warning{'s' if len(warnings) != 1 else ''} "
                    f"— {qr['action_count']} actions"
                )

            if issues:
                _hdr = st.columns([1.0, 1.2, 6.0])
                _hdr[0].caption("Level")
                _hdr[1].caption("Time")
                _hdr[2].caption("Issue")
                for issue in issues[:50]:
                    _row = st.columns([1.0, 1.2, 6.0])
                    _row[0].markdown("🔴 Error" if issue["level"] == "error" else "🟡 Warn")
                    _row[1].caption(ms_to_timestamp(issue["at"]))
                    _row[2].caption(issue["message"])
                if len(issues) > 50:
                    st.caption(f"… and {len(issues) - 50} more issues not shown")
                st.caption(
                    "Device awareness is applied on the Device tab. "
                    "Go back to the Device tab to adjust limits if needed."
                )


# ------------------------------------------------------------------
# Public entry point
# ------------------------------------------------------------------

def render(project: "Project") -> None:
    """Render the Export tab — simplified MVP layout."""
    if project is None or not project.is_loaded:
        st.info("Load a funscript first.")
        return

    assessment_dict = project.assessment.to_dict()
    phrases: List[dict] = assessment_dict.get("phrases", [])
    if not phrases:
        st.info("No phrases detected — run the assessment first.")
        return

    bpm_threshold: float = st.session_state.get("bpm_threshold", 120.0)

    if "export_rejected" not in st.session_state:
        st.session_state.export_rejected = set()
    if "export_accepted" not in st.session_state:
        st.session_state.export_accepted = set()

    tag_to_idxs: Dict[str, List[int]] = {}
    for i, ph in enumerate(phrases):
        for tag in ph.get("tags", []):
            tag_to_idxs.setdefault(tag, []).append(i)

    completed_plan, recommended_plan = _build_plans(phrases, tag_to_idxs, bpm_threshold)
    full_plan = completed_plan + recommended_plan

    # ── 1. Preview chart ────────────────────────────────────────────
    _render_export_preview(project, assessment_dict, full_plan)

    st.divider()

    # ── 2. Export options (collapsed) ───────────────────────────────
    with st.expander("Export options", expanded=False):
        st.checkbox(
            "Add blended seams to reduce abrupt style changes",
            value=True,
            key="export_blend_seams",
        )
        st.checkbox(
            "Conduct final smooth for post process finishing",
            value=True,
            key="export_final_smooth",
        )
        st.checkbox(
            "Apply device awareness",
            value=True,
            key="export_device_awareness",
            help="Apply device limits from the Device tab to the exported funscript.",
        )

    st.divider()

    # ── 3. Transform details (collapsed) ────────────────────────────
    rejected = st.session_state.export_rejected
    accepted = st.session_state.export_accepted
    done_active = sum(1 for e in completed_plan if e["phrase_idx"] not in rejected)
    rec_active  = sum(
        1 for e in recommended_plan
        if e["phrase_idx"] in accepted and e["phrase_idx"] not in rejected
    )

    with st.expander(
        f"Completed transforms — {done_active} applied" if done_active
        else "Completed transforms — none applied",
        expanded=False,
    ):
        _render_completed(completed_plan)

    with st.expander(
        f"Recommended transforms — {rec_active} accepted" if rec_active
        else "Recommended transforms — none accepted",
        expanded=False,
    ):
        _render_recommended(recommended_plan)

    st.divider()

    # ── 5. Quality gate (collapsed) ─────────────────────────────────
    _render_quality_gate(project, full_plan)

    st.divider()

    # ── 6. Export All + Open folder (at the bottom) ─────────────────
    _render_export_to_folder(project)

    # Clamp warning
    clamp_count = st.session_state.get("export_clamp_count", 0)
    if clamp_count > 0:
        st.warning(
            f"⚠️ {clamp_count} action{'s' if clamp_count != 1 else ''} were clamped to "
            f"the valid range [0, 100] after transforms. "
            f"Check amplitude settings if this is unexpected."
        )


# ------------------------------------------------------------------
# Plan building
# ------------------------------------------------------------------

def _build_plans(
    phrases: List[dict],
    tag_to_idxs: Dict[str, List[int]],
    bpm_threshold: float,
) -> tuple:
    """Return (completed_plan, recommended_plan) — two separate lists."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG, suggest_transform

    completed: List[dict] = []
    recommended: List[dict] = []

    for idx, phrase in enumerate(phrases):
        old_bpm    = phrase.get("bpm", 0.0)
        old_cycles = phrase.get("cycle_count") or 0

        def _make_entry(key, params, src, chain=None):
            has_halve  = (key == "halve_tempo") or any(
                t.get("transform_key") == "halve_tempo" for t in (chain or [])
            )
            new_bpm    = old_bpm / 2    if has_halve else None
            new_cycles = old_cycles // 2 if has_halve else None
            spec       = TRANSFORM_CATALOG.get(key)
            entry = {
                "phrase_idx":   idx,
                "start_ms":     phrase["start_ms"],
                "end_ms":       phrase["end_ms"],
                "tx_key":       key,
                "tx_name":      spec.name if spec else key,
                "param_values": params,
                "source":       src,
                "old_bpm":      old_bpm,
                "new_bpm":      new_bpm,
                "old_cycles":   old_cycles,
                "new_cycles":   new_cycles,
            }
            if chain:
                entry["chain"] = chain
            return entry

        # 1. Phrase Editor — accepted chain (new format)
        _chain = st.session_state.get(f"phrase_transform_chain_{idx}", [])
        _non_pt = [t for t in _chain if t.get("transform_key", "passthrough") != "passthrough"]
        if _non_pt:
            _last   = _non_pt[-1]
            _specs  = [TRANSFORM_CATALOG.get(t["transform_key"]) for t in _non_pt]
            _names  = [s.name if s else t["transform_key"] for s, t in zip(_specs, _non_pt)]
            _tx_name = _names[0] if len(_names) == 1 else " → ".join(_names)
            _entry  = _make_entry(_last["transform_key"], _last.get("param_values", {}),
                                  "Phrase Editor", chain=_non_pt)
            _entry["tx_name"] = _tx_name
            completed.append(_entry)
            continue

        # 2. Pattern Editor
        tx_key: Optional[str] = None
        param_values: dict = {}
        source: Optional[str] = None
        for tag in phrase.get("tags", []):
            tag_idxs = tag_to_idxs.get(tag, [])
            try:
                i = tag_idxs.index(idx)
            except ValueError:
                continue
            pe_tx = st.session_state.get(f"pe_transform_{tag}_{i}", {})
            if pe_tx.get("transform_key") and pe_tx["transform_key"] != "passthrough":
                tx_key       = pe_tx["transform_key"]
                param_values = pe_tx.get("param_values", {})
                source       = "Pattern Editor"
                break

        if tx_key:
            completed.append(_make_entry(tx_key, param_values, source))
        else:
            # Untouched — build recommended entry
            rec, rec_params = suggest_transform(phrase, bpm_threshold)
            if rec and rec != "passthrough":
                recommended.append(_make_entry(rec, rec_params, "Recommended"))

    return completed, recommended


# ------------------------------------------------------------------
# Completed transforms table
# ------------------------------------------------------------------

def _render_completed(plan: List[dict]) -> None:
    rejected: set = st.session_state.export_rejected

    if not plan:
        st.caption("No transforms applied yet — edit phrases in the Phrase Editor or Pattern Editor.")
        return

    active  = sum(1 for e in plan if e["phrase_idx"] not in rejected)
    rej_cnt = len(plan) - active
    summary = f"{active} transform{'s' if active != 1 else ''} will be applied"
    if rej_cnt:
        summary += f" &nbsp;·&nbsp; {rej_cnt} rejected"
    st.caption(summary + " — click 🗑 to reject, ↩ to restore")

    hcols = st.columns(_COL_W_DONE)
    for hc, lbl in zip(hcols, _HEADERS_DONE):
        hc.caption(lbl)

    for entry in plan:
        idx      = entry["phrase_idx"]
        is_rej   = idx in rejected
        time_str = f"{ms_to_timestamp(entry['start_ms'])} → {ms_to_timestamp(entry['end_ms'])}"
        dur_s    = f"{(entry['end_ms'] - entry['start_ms']) / 1000:.1f}"
        bpm_str  = (
            f"{entry['old_bpm']:.1f} → {entry['new_bpm']:.1f}"
            if entry["new_bpm"] is not None else f"{entry['old_bpm']:.1f}"
        )
        cyc_str  = (
            f"{entry['old_cycles']} → {entry['new_cycles']}"
            if entry["new_cycles"] is not None else str(entry["old_cycles"])
        )

        rc = st.columns(_COL_W_DONE)
        if is_rej:
            _dim = lambda s: f"<span style='opacity:0.35'>{s}</span>"
            # sr-only span ensures screen readers announce "Rejected" (WCAG C2).
            rc[0].markdown(
                "<span class='sr-only'>Rejected — </span>" + _dim(f"<s>{idx + 1}</s>"),
                unsafe_allow_html=True,
            )
            rc[1].markdown(_dim(time_str),             unsafe_allow_html=True)
            rc[2].markdown(_dim(dur_s),                unsafe_allow_html=True)
            rc[3].markdown(_dim(f"<s>{entry['tx_name']}</s>"), unsafe_allow_html=True)
            rc[4].markdown(_dim(entry["source"]),      unsafe_allow_html=True)
            rc[5].markdown(_dim(bpm_str),              unsafe_allow_html=True)
            rc[6].markdown(_dim(cyc_str),              unsafe_allow_html=True)
            if rc[7].button("↩", key=f"done_restore_{idx}", help="Restore"):
                st.session_state.export_rejected.discard(idx)
                st.rerun()
        else:
            rc[0].markdown(
                f"<span style='white-space:nowrap'>{idx + 1}</span>",
                unsafe_allow_html=True,
            )
            rc[1].write(time_str)
            rc[2].write(dur_s)
            rc[3].write(entry["tx_name"])
            rc[4].write(entry["source"])
            rc[5].write(bpm_str)
            rc[6].write(cyc_str)
            if rc[7].button("🗑", key=f"done_reject_{idx}", help="Reject"):
                st.session_state.export_rejected.add(idx)
                st.rerun()


# ------------------------------------------------------------------
# Recommended transforms table
# ------------------------------------------------------------------

def _render_recommended(plan: List[dict]) -> None:
    rejected: set = st.session_state.export_rejected
    accepted: set = st.session_state.export_accepted

    if not plan:
        st.caption("All phrases have manual transforms — nothing to recommend.")
        return

    active  = sum(
        1 for e in plan
        if e["phrase_idx"] in accepted and e["phrase_idx"] not in rejected
    )
    rej_cnt    = sum(1 for e in plan if e["phrase_idx"] in rejected)
    pending    = len(plan) - active - rej_cnt
    summary    = f"{active} recommendation{'s' if active != 1 else ''} accepted and will be applied"
    if pending:
        summary += f" &nbsp;·&nbsp; {pending} pending (✓ to accept)"
    if rej_cnt:
        summary += f" &nbsp;·&nbsp; {rej_cnt} rejected"
    st.caption(summary + " — click ✓ to accept, ✏ to edit, 🗑 to reject")

    hcols = st.columns(_COL_W_REC)
    for hc, lbl in zip(hcols, _HEADERS_REC):
        hc.caption(lbl)

    for entry in plan:
        idx      = entry["phrase_idx"]
        is_rej   = idx in rejected
        is_acc   = idx in accepted
        time_str = f"{ms_to_timestamp(entry['start_ms'])} → {ms_to_timestamp(entry['end_ms'])}"
        dur_s    = f"{(entry['end_ms'] - entry['start_ms']) / 1000:.1f}"
        bpm_str  = (
            f"{entry['old_bpm']:.1f} → {entry['new_bpm']:.1f}"
            if entry["new_bpm"] is not None else f"{entry['old_bpm']:.1f}"
        )
        cyc_str  = (
            f"{entry['old_cycles']} → {entry['new_cycles']}"
            if entry["new_cycles"] is not None else str(entry["old_cycles"])
        )
        param_caption = None
        if entry.get("param_values"):
            param_caption = "  ".join(f"{k}={v}" for k, v in entry["param_values"].items())

        rc = st.columns(_COL_W_REC)
        if is_rej:
            _dim = lambda s: f"<span style='opacity:0.35'>{s}</span>"
            # sr-only span ensures screen readers announce "Rejected" (WCAG C2).
            rc[0].markdown(
                "<span class='sr-only'>Rejected — </span>" + _dim(f"<s>{idx + 1}</s>"),
                unsafe_allow_html=True,
            )
            rc[1].markdown(_dim(time_str),             unsafe_allow_html=True)
            rc[2].markdown(_dim(dur_s),                unsafe_allow_html=True)
            rc[3].markdown(_dim(f"<s>{entry['tx_name']}</s>"), unsafe_allow_html=True)
            rc[4].markdown(_dim(bpm_str),              unsafe_allow_html=True)
            rc[5].markdown(_dim(cyc_str),              unsafe_allow_html=True)
            # cols 6, 7 empty; col 8 = restore
            if rc[8].button("↩", key=f"rec_restore_{idx}", help="Restore"):
                st.session_state.export_rejected.discard(idx)
                st.rerun()
        else:
            rc[0].markdown(
                f"<span style='white-space:nowrap'>{idx + 1}</span>",
                unsafe_allow_html=True,
            )
            rc[1].write(time_str)
            rc[2].write(dur_s)
            rc[3].write(entry["tx_name"])
            if param_caption:
                rc[3].caption(param_caption)
            rc[4].write(bpm_str)
            rc[5].write(cyc_str)
            # col 6 = accept (✓ / ✅)
            if is_acc:
                if rc[6].button("✅", key=f"rec_unaccept_{idx}", help="Un-accept"):
                    st.session_state.export_accepted.discard(idx)
                    st.rerun()
            else:
                if rc[6].button("✓", key=f"rec_accept_{idx}", help="Accept — include in export"):
                    st.session_state.export_accepted.add(idx)
                    st.rerun()
            # col 7 = edit
            if rc[7].button("✏", key=f"rec_edit_{idx}", help="Edit in Phrase Editor"):
                st.session_state.view_state.set_selection(entry["start_ms"], entry["end_ms"])
                st.session_state.goto_tab = 0
                st.rerun()
            # col 8 = reject
            if rc[8].button("🗑", key=f"rec_reject_{idx}", help="Reject"):
                st.session_state.export_rejected.add(idx)
                st.rerun()


# ------------------------------------------------------------------
# Export preview chart
# ------------------------------------------------------------------

def _render_export_preview(project, assessment_dict: dict, plan: List[dict]) -> None:
    """Render a static vibrant PNG chart of the proposed export actions."""
    from forge_ui_components.funscript_chart.cache import ChartCache

    cache = ChartCache.from_session_state()

    # If no transforms applied, use the latest cached stage directly
    rejected: set = st.session_state.get("export_rejected", set())
    accepted: set = st.session_state.get("export_accepted", set())
    n_active = sum(
        1 for e in plan
        if e["phrase_idx"] not in rejected
        and (e.get("source") != "Recommended" or e["phrase_idx"] in accepted)
    )

    if n_active == 0:
        # No transforms — use latest cache without phrase boundaries
        series, stage = cache.get_latest_series()
        if series:
            png = cache.render_png(stage, with_bands=False, height_px=280, width_px=1600)
            if png:
                st.image(png, use_container_width=True)
                st.caption(
                    f"Export preview: {len(series.times_ms):,} actions (cached). "
                    "Colour represents stroke velocity (blue = slow, red = fast)."
                )
                return

    # Transforms applied — need fresh render with applied transforms
    _chain_path = st.session_state.get("chain_funscript_path")
    _fs_path = _chain_path if (_chain_path and os.path.isfile(_chain_path)) else _get_funscript_path(project)
    with open(_fs_path, encoding="utf-8") as f:
        fs_data = json.load(f)

    original_actions = fs_data.get("actions", [])
    preview_actions = _apply_plan_transforms(original_actions, plan, rejected, accepted)

    with st.spinner(f"Rendering export preview ({len(preview_actions):,} actions)…"):
        from forge_ui_components.funscript_chart.static import render_vibrant_static
        png = render_vibrant_static(
            preview_actions, cache.get_bands(),
            height_px=280, width_px=1600,
            show_labels=True,
        )
    st.image(png, use_container_width=True)

    n_actions = len(preview_actions)
    st.caption(
        f"Export preview: {n_actions:,} actions after applying selected transforms. "
        "Colour represents stroke velocity (blue = slow, red = fast)."
    )

    n_active = sum(
        1 for e in plan
        if e["phrase_idx"] not in rejected
        and (e.get("source") != "Recommended" or e["phrase_idx"] in accepted)
    )
    st.caption(
        f"Preview: {n_active} transform{'s' if n_active != 1 else ''} applied · "
        "blend seams and final smooth (if checked below) will also be applied on download"
    )


# ------------------------------------------------------------------
# Export log (#12)
# ------------------------------------------------------------------

def _build_export_log(
    project,
    plan: List[dict],
    rejected: set,
    accepted: set,
    blend_seams: bool,
    final_smooth: bool,
    clamp_count: int,
) -> dict:
    """Build a structured log of what was applied, for embedding in the export JSON."""
    applied = []
    for entry in plan:
        idx = entry["phrase_idx"]
        if idx in rejected:
            continue
        if entry.get("source") == "Recommended" and idx not in accepted:
            continue
        applied.append({
            "phrase_idx": idx,
            "time":       f"{ms_to_timestamp(entry['start_ms'])} → {ms_to_timestamp(entry['end_ms'])}",
            "transform":  entry["tx_key"],
            "parameters": entry.get("param_values") or {},
            "source":     entry["source"],
        })
    return {
        "forge_version":  "0.5.0",
        "exported_at":    datetime.now().isoformat(),
        "source_file":    os.path.basename(_get_funscript_path(project)),
        "transforms":     applied,
        "blend_seams":    blend_seams,
        "final_smooth":   final_smooth,
        "clamp_warnings": clamp_count,
    }


# ------------------------------------------------------------------
# Download builder
# ------------------------------------------------------------------

def _apply_plan_transforms(
    original_actions: list,
    plan: List[dict],
    rejected: set,
    accepted: set,
) -> list:
    """Apply all non-rejected plan transforms to a copy of original_actions."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    result = copy.deepcopy(original_actions)
    for entry in plan:
        idx = entry["phrase_idx"]
        if idx in rejected:
            continue
        if entry.get("source") == "Recommended" and idx not in accepted:
            continue
        start_ms = entry["start_ms"]
        end_ms   = entry["end_ms"]

        # Multi-transform chain (Phrase Editor) or single transform (Pattern Editor)
        chain = entry.get("chain") or [
            {"transform_key": entry["tx_key"], "param_values": entry.get("param_values") or {}}
        ]
        for t_entry in chain:
            spec = TRANSFORM_CATALOG.get(t_entry["transform_key"])
            if not spec:
                continue
            param_values = t_entry.get("param_values") or {}
            phrase_slice = [a for a in result if start_ms <= a["at"] <= end_ms]
            transformed  = spec.apply(phrase_slice, param_values if param_values else None)
            if not transformed:
                continue
            if spec.structural:
                outside = [a for a in result if not (start_ms <= a["at"] <= end_ms)]
                result  = sorted(outside + transformed, key=lambda a: a["at"])
            else:
                t_to_pos = {a["at"]: a["pos"] for a in transformed}
                for a in result:
                    if a["at"] in t_to_pos:
                        a["pos"] = t_to_pos[a["at"]]

    # #9 clamp to [0, 100]  +  #10 sort and deduplicate timestamps
    clamp_count = _clamp_sort_dedup(result)
    st.session_state["export_clamp_count"] = clamp_count
    return result


def _build_download_bytes(
    project,
    phrases: List[dict],
    plan: List[dict],
    *,
    blend_seams: bool = False,
    final_smooth: bool = False,
) -> bytes:
    """Apply all non-rejected transforms in plan order and return JSON bytes."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    with open(_get_funscript_path(project), encoding="utf-8") as f:
        fs_data = json.load(f)

    rejected: set = st.session_state.get("export_rejected", set())
    accepted: set = st.session_state.get("export_accepted", set())
    result = _apply_plan_transforms(fs_data.get("actions", []), plan, rejected, accepted)

    if blend_seams:
        spec = TRANSFORM_CATALOG.get("blend_seams")
        if spec:
            result = spec.apply(result, None) or result

    if final_smooth:
        spec = TRANSFORM_CATALOG.get("final_smooth")
        if spec:
            result = spec.apply(result, None) or result

    # blend_seams / final_smooth are post-plan — clamp again after them
    if blend_seams or final_smooth:
        _clamp_sort_dedup(result)

    # #12 embed export log so the file is self-documenting
    log = _build_export_log(
        project, plan, rejected, accepted, blend_seams, final_smooth,
        st.session_state.get("export_clamp_count", 0),
    )
    out = dict(fs_data)
    out["actions"]    = result
    out["_forge_log"] = log
    return json.dumps(out, indent=2).encode()


def _build_download_bytes_device(
    project,
    phrases: List[dict],
    plan: List[dict],
    *,
    blend_seams: bool = False,
    final_smooth: bool = False,
    apply_awareness: bool = True,
) -> bytes:
    """Apply transforms and optionally enforce device awareness limits."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    with open(_get_funscript_path(project), encoding="utf-8") as f:
        fs_data = json.load(f)

    rejected: set = st.session_state.get("export_rejected", set())
    accepted: set = st.session_state.get("export_accepted", set())
    result = _apply_plan_transforms(fs_data.get("actions", []), plan, rejected, accepted)

    if blend_seams:
        spec = TRANSFORM_CATALOG.get("blend_seams")
        if spec:
            result = spec.apply(result, None) or result

    if final_smooth:
        spec = TRANSFORM_CATALOG.get("final_smooth")
        if spec:
            result = spec.apply(result, None) or result

    if blend_seams or final_smooth:
        _clamp_sort_dedup(result)

    if apply_awareness:
        issues = _check_quality(result)
        if issues:
            perf_spec = TRANSFORM_CATALOG.get("performance")
            if perf_spec:
                perf_params = {pk: p.default for pk, p in perf_spec.params.items()}
                perf_params["max_velocity"] = 0.20
                fix_ats = {i["at"] for i in issues}
                affected: set = set()
                for at in fix_ats:
                    for pi, ph in enumerate(phrases):
                        if ph["start_ms"] <= at <= ph["end_ms"]:
                            affected.add(pi)
                            break
                for pi in affected:
                    ph = phrases[pi]
                    _slice = [a for a in result if ph["start_ms"] <= a["at"] <= ph["end_ms"]]
                    _fixed = perf_spec.apply(_slice, perf_params)
                    if _fixed:
                        t2p = {a["at"]: a["pos"] for a in _fixed}
                        for a in result:
                            if a["at"] in t2p:
                                a["pos"] = t2p[a["at"]]
                _clamp_sort_dedup(result)

    log = _build_export_log(
        project, plan, rejected, accepted, blend_seams, final_smooth,
        st.session_state.get("export_clamp_count", 0),
    )
    out = dict(fs_data)
    out["actions"]    = result
    out["_forge_log"] = log
    return json.dumps(out, indent=2).encode()


# ------------------------------------------------------------------
# Full pipeline section (#4 — BPM Transformer + Window Customizer)
# ------------------------------------------------------------------

def _render_pipeline_section(project) -> None:
    """Expander section: run the full backend pipeline and offer a download."""
    from pattern_catalog.config import TransformerConfig

    with st.expander("Run full pipeline — BPM Transformer", expanded=False):
        st.caption(
            "Applies a BPM-threshold amplitude transform to every phrase. "
            "The result is independent of the phrase-editor transforms above."
        )

        st.caption("**BPM Transformer**")
        col_a, col_b = st.columns(2)
        with col_a:
            bpm_threshold = st.slider(
                "BPM threshold", min_value=60.0, max_value=200.0,
                value=float(st.session_state.get("bpm_threshold", 120.0)),
                step=5.0, key="pipeline_bpm_threshold",
                help="Phrases at or above this BPM receive the amplitude transform.",
            )
        with col_b:
            amplitude_scale = st.slider(
                "Amplitude scale", min_value=0.1, max_value=3.0,
                value=2.0, step=0.1, key="pipeline_amplitude_scale",
                help="Positions are scaled around the midpoint (50) by this factor.",
            )

        st.caption("**Device-aware fix**")
        _pfc1, _pfc2 = st.columns(2)
        pl_fix_errors   = _pfc1.checkbox("Fix errors (> 300 pos/s)",   value=True, key="pipeline_fix_errors")
        pl_fix_warnings = _pfc2.checkbox("Fix warnings (> 200 pos/s)", value=True, key="pipeline_fix_warnings")
        # velocity cap: 0.20 clears everything; 0.28 clears errors only
        pl_max_vel = 200 if pl_fix_warnings else 280

        if st.button("▶ Run Pipeline", key="pipeline_run_btn", type="primary"):
            from ui.common.pipeline import run_pipeline_in_memory
            tcfg = TransformerConfig(
                bpm_threshold=bpm_threshold,
                amplitude_scale=amplitude_scale,
            )
            try:
                actions, pipe_log = run_pipeline_in_memory(
                    funscript_path=_get_funscript_path(project),
                    assessment=project.assessment,
                    transformer_config=tcfg,
                )
                # Device-aware fix
                if pl_fix_errors or pl_fix_warnings:
                    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG as _TC
                    _perf_spec = _TC.get("performance")
                    if _perf_spec:
                        _perf_params = {pk: p.default for pk, p in _perf_spec.params.items()}
                        _perf_params["max_velocity"] = round(pl_max_vel / 1000, 4)
                        _issues = _check_quality(actions)
                        _fix_ats: set = set()
                        for _iss in _issues:
                            if _iss["level"] == "error" and pl_fix_errors:
                                _fix_ats.add(_iss["at"])
                            elif _iss["level"] == "warning" and pl_fix_warnings:
                                _fix_ats.add(_iss["at"])
                        if _fix_ats:
                            _ph_list = project.assessment.to_dict().get("phrases", [])
                            _affected: set = set()
                            for _at in _fix_ats:
                                for _pi, _ph in enumerate(_ph_list):
                                    if _ph["start_ms"] <= _at <= _ph["end_ms"]:
                                        _affected.add(_pi)
                                        break
                            for _pi in _affected:
                                _ph = _ph_list[_pi]
                                _slice = [a for a in actions if _ph["start_ms"] <= a["at"] <= _ph["end_ms"]]
                                _fixed = _perf_spec.apply(_slice, _perf_params)
                                if _fixed:
                                    _t2p = {a["at"]: a["pos"] for a in _fixed}
                                    for a in actions:
                                        if a["at"] in _t2p:
                                            a["pos"] = _t2p[a["at"]]
                            _clamp_sort_dedup(actions)
                # Clean up result
                clamp_count = _clamp_sort_dedup(actions)
                st.session_state["pipeline_result"] = {
                    "actions":     actions,
                    "log":         pipe_log,
                    "clamp_count": clamp_count,
                    "source_file": _get_funscript_path(project),
                }
                st.rerun()
            except Exception as exc:
                st.error(f"Pipeline error: {exc}")

        # Show result if available
        pipe_res = st.session_state.get("pipeline_result")
        if pipe_res and pipe_res.get("source_file") == _get_funscript_path(project):
            actions     = pipe_res["actions"]
            pipe_log    = pipe_res["log"]
            clamp_count = pipe_res.get("clamp_count", 0)

            st.success(
                f"Pipeline complete — {len(actions)} actions. "
                f"BPM threshold: {pipe_log['transformer']['bpm_threshold']} · "
                f"Amplitude scale: {pipe_log['transformer']['amplitude_scale']} · "
                f"Customizer: {'yes' if pipe_log['customizer_applied'] else 'no'}"
            )
            if clamp_count:
                st.warning(f"{clamp_count} action(s) clamped to [0, 100].")

            # Build download bytes
            with open(_get_funscript_path(project), encoding="utf-8") as f:
                fs_data = json.load(f)
            out = dict(fs_data)
            out["actions"]    = actions
            out["_forge_log"] = {
                "forge_version":  "0.5.0",
                "exported_at":    datetime.now().isoformat(),
                "source_file":    os.path.basename(_get_funscript_path(project)),
                "pipeline":       pipe_log,
                "clamp_warnings": clamp_count,
            }
            dl_bytes = json.dumps(out, indent=2).encode()

            col_dl, col_clr = st.columns([3, 1])
            col_dl.download_button(
                "⬇ Download pipeline result",
                data=dl_bytes,
                file_name=f"{project.name}_pipeline.funscript",
                mime="application/json",
                type="primary",
                key="pipeline_download_btn",
            )
            if col_clr.button("✕ Clear", key="pipeline_clear_btn"):
                del st.session_state["pipeline_result"]
                st.rerun()


# ------------------------------------------------------------------
# Export to device subfolders
# ------------------------------------------------------------------

def _render_export_to_folder(project) -> None:
    """Export funscripts to device-specific subfolders in the output directory."""
    forge_project = st.session_state.get("forge_project")
    if not forge_project:
        return

    output_folder = forge_project.get("output_folder", "")
    if not output_folder:
        st.caption("Set an export location in the **Project** tab first.")
        return

    targets = forge_project.get("output_targets", [])
    if not targets:
        st.caption("Select output devices in the **Device** tab first.")
        return

    st.subheader("Export to folder")
    st.caption(f"Output location: `{output_folder}`")
    for target in targets:
        st.caption(f"  → `{target}/` — device-specific funscript")

    col_export, col_open = st.columns(2)
    with col_export:
        if st.button("Export All", type="primary", width="stretch"):
            _do_export_to_folders(forge_project, project)
    with col_open:
        if os.path.isdir(output_folder):
            if st.button("Open folder", width="stretch"):
                import subprocess, sys
                if sys.platform == "win32":
                    subprocess.Popen(["explorer", output_folder.replace("/", "\\")])
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", output_folder])
                else:
                    subprocess.Popen(["xdg-open", output_folder])
        else:
            st.button("Open folder", width="stretch", disabled=True,
                      help="Export first to create the folder.")

    if st.session_state.get("export_complete"):
        st.success(
            f"Export complete. Files written to `{output_folder}`. "
            "Click **Open folder** to view."
        )


def _do_export_to_folders(forge_project: dict, project) -> None:
    """Write funscripts to device subfolders."""
    from forge.project import get_latest_funscript, save_forge

    output_folder = forge_project.get("output_folder", "")
    targets = forge_project.get("output_targets", [])

    status = st.status("Exporting…", expanded=True)

    # Get the latest funscript from the chain
    fs_data, stage = get_latest_funscript(forge_project)
    if not fs_data:
        status.write("⚠️ No funscript data found in chain. Run through the workflow first.")
        status.update(label="Export failed", state="error")
        return

    status.write(f"✅ Using funscript from **{stage}** stage")

    actions = fs_data.get("actions", [])
    status.write(f"✅ {len(actions):,} actions to export")

    for target in targets:
        device_folder = os.path.join(output_folder, target)
        os.makedirs(device_folder, exist_ok=True)

        # Write the funscript
        out_path = os.path.join(device_folder, f"{forge_project['name']}.funscript")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(fs_data, f, indent=2)
        status.write(f"✅ `{target}/{forge_project['name']}.funscript`")

    # Copy input media to top-level output folder
    from forge.project import get_input_file
    for role in ("video", "audio", "captions"):
        src = get_input_file(forge_project, role)
        if src and os.path.isfile(src):
            import shutil
            dest = os.path.join(output_folder, os.path.basename(src))
            if not os.path.exists(dest):
                shutil.copy2(src, dest)
                status.write(f"✅ Copied {os.path.basename(src)}")

    # Export workflow template (.forgetmpl)
    _export_template(forge_project, output_folder, status)

    # Update progress
    forge_project["progress"]["exported"] = True
    from datetime import datetime
    forge_project.setdefault("history", []).append({
        "tab": "export",
        "timestamp": datetime.now().isoformat(),
        "targets": targets,
        "stage": stage,
        "action_count": len(actions),
    })
    save_forge(forge_project)

    st.session_state["export_complete"] = True
    status.update(label=f"Exported to {len(targets)} device(s)!", state="complete", expanded=False)


def _export_template(forge_project: dict, output_folder: str, status) -> None:
    """Export a .forgetmpl file — workflow decisions without project-specific data."""
    template = {
        "template_version": "1",
        "description": f"Template from {forge_project.get('name', 'project')}",
        # Tone decisions
        "tone": forge_project.get("tone"),
        "tone_sliders": forge_project.get("tone_sliders", {}),
        # Device decisions
        "output_targets": forge_project.get("output_targets", []),
        "device_fix_strategies": forge_project.get("device_fix_strategies", []),
        "device_apply_scope": forge_project.get("device_apply_scope", "global"),
        # Workflow history (decisions only, no timestamps/paths)
        "decisions": [
            {k: v for k, v in entry.items() if k not in ("timestamp",)}
            for entry in forge_project.get("history", [])
        ],
    }

    tmpl_path = os.path.join(output_folder, f"{forge_project.get('name', 'project')}.forgetmpl")
    with open(tmpl_path, "w", encoding="utf-8") as f:
        json.dump(template, f, indent=2)
    status.write(f"✅ Template: `{os.path.basename(tmpl_path)}`")
