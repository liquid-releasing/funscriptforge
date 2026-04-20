# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Append-only event log for debug-mode bug reports.

Design
------
- Events live in `st.session_state["_debug_events"]` — a list of dicts.
- Each event: `{n, ts, kind, summary, extra}` where `extra` may include
  content hashes (funscript actions hash, file sizes, etc).
- Call sites sprinkle `log_event(kind, summary, **extra)` around key
  actions. Cheap no-op when debug is off — the `is_debug_enabled()`
  check runs first so unused event construction doesn't happen.
- When a user sees a bug, they click "⚑ Mark this" in the sidebar,
  which appends a `marker` event and prompts to export the log.
- Export writes JSONL (one event per line) to a per-session file
  under the user's data dir.

Non-goals
---------
- NOT replay. Just observability. Rebuilding a project from the log
  is a separate, explicitly-deferred feature (see
  `project_funscriptforge_cli_replay.md` in memory).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import streamlit as st

_EVENTS_KEY = "_debug_events"
_ENABLED_KEY = "_debug_enabled"
_SESSION_STARTED_KEY = "_debug_session_started"


# ── Core toggle ───────────────────────────────────────────────────────
def is_debug_enabled() -> bool:
    """True when debug mode is on (sidebar toggle or ?debug=1 URL param)."""
    if st.session_state.get(_ENABLED_KEY):
        return True
    # Respect URL param on first call; cache the result so flipping the
    # sidebar toggle still wins.
    try:
        qp = st.query_params
        if qp.get("debug") in ("1", "true", "on"):
            st.session_state[_ENABLED_KEY] = True
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


# ── Event log ─────────────────────────────────────────────────────────
def _events() -> list[dict]:
    if _EVENTS_KEY not in st.session_state:
        st.session_state[_EVENTS_KEY] = []
    return st.session_state[_EVENTS_KEY]


def log_event(kind: str, summary: str, **extra: Any) -> None:
    """Append an event to the session log.

    No-op when debug is off. Safe to call from any path — never raises.
    Large values in `extra` should be pre-hashed by the caller;
    this module does not prune.
    """
    if not is_debug_enabled():
        return
    try:
        events = _events()
        events.append({
            "n": len(events) + 1,
            "ts": time.time(),
            "kind": kind,
            "summary": summary,
            "extra": extra,
        })
    except Exception:  # noqa: BLE001
        # Instrumentation must never break the app.
        pass


def hash_actions(actions: list[dict] | None) -> str:
    """Short content hash of a funscript actions array, for event extras.

    Returns '' when actions is None/empty. Stable across equivalent
    lists (same order, same fields).
    """
    if not actions:
        return ""
    try:
        blob = json.dumps(actions, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        return ""
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:10]


def snapshot_session() -> dict[str, Any]:
    """Return a small, pickle-safe snapshot of key session_state values.

    Used when the user clicks "⚑ Mark this" so the marker event
    carries enough context to diagnose WHY the glitch happened.
    Avoids large binary blobs (PNGs, raw waveforms).
    """
    ss = st.session_state
    snap: dict[str, Any] = {
        "funscript_path": ss.get("funscript_path"),
        "chain_funscript_path": ss.get("chain_funscript_path"),
        "media_path": ss.get("media_path"),
        "video_path": ss.get("video_path"),
        "project_name": (
            ss.get("forge_project", {}).get("name")
            if isinstance(ss.get("forge_project"), dict) else None
        ),
        "project_ver": ss.get("project_ver"),
        "has_undo": bool(ss.get("_last_action_tab")),
        "phrase_chain_counts": {
            k: len(ss[k])
            for k in ss
            if k.startswith("phrase_transform_chain_")
            and isinstance(ss[k], list)
        },
        "pending_accept_flags": sorted(
            k for k in ss
            if k.startswith("pe_apply_") and ss[k] is True
        ),
    }
    # Hash file contents if present (helps diagnose "disk ≠ UI").
    for label, path_key in (("funscript_hash", "funscript_path"),
                            ("chain_hash", "chain_funscript_path")):
        p = ss.get(path_key)
        if p and os.path.exists(p):
            try:
                with open(p, "rb") as fh:
                    snap[label] = hashlib.sha1(fh.read()).hexdigest()[:10]
                snap[label.replace("_hash", "_size")] = os.path.getsize(p)
            except OSError:
                pass
    return snap


def mark_issue(note: str) -> dict:
    """Record a marker event with full session snapshot. Returns it."""
    snap = snapshot_session()
    evt = {
        "n": len(_events()) + 1,
        "ts": time.time(),
        "kind": "marker",
        "summary": f"⚑ {note}" if note else "⚑ Issue noticed here",
        "extra": {"snapshot": snap},
    }
    _events().append(evt)
    return evt


# ── Export ────────────────────────────────────────────────────────────
def _debug_log_dir() -> Path:
    """Where exported debug logs go. Under the app's writable dir."""
    env = os.environ.get("FUNSCRIPT_FORGE_DATA_DIR")
    if env:
        base = Path(env)
    else:
        try:
            from utils import writable_base_dir
            base = Path(writable_base_dir())
        except Exception:  # noqa: BLE001
            base = Path.home() / ".funscriptforge"
    d = base / "debug_logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _session_stem() -> str:
    """Stable filename stem for this Streamlit session's log export."""
    stem = st.session_state.get(_SESSION_STARTED_KEY)
    if not stem:
        stem = time.strftime("%Y%m%d-%H%M%S")
        st.session_state[_SESSION_STARTED_KEY] = stem
    return stem


def export_log() -> Path:
    """Write the event log to a JSONL file and return the path."""
    path = _debug_log_dir() / f"debug_{_session_stem()}.jsonl"
    with open(path, "w", encoding="utf-8") as fh:
        for evt in _events():
            fh.write(json.dumps(evt, default=str) + "\n")
    return path


def clear_log() -> None:
    st.session_state[_EVENTS_KEY] = []


# ── Sidebar panel ─────────────────────────────────────────────────────
def render_debug_sidebar() -> None:
    """Render the debug-mode toggle + panel in the sidebar.

    Always renders the toggle (so users can turn it ON). Only renders
    the event panel when debug is enabled — keeps the sidebar quiet
    for casual users.
    """
    st.sidebar.markdown("---")
    st.sidebar.checkbox(
        "🔧 Debug mode",
        key=_ENABLED_KEY,
        help=(
            "Record a click trail of significant actions so issues "
            "can be reported with precise repro steps. OFF by default."
        ),
    )
    if not is_debug_enabled():
        return

    events = _events()
    st.sidebar.caption(f"**Click {len(events)}** · session `{_session_stem()}`")

    cols = st.sidebar.columns([3, 2])
    with cols[0]:
        if st.button(
            "⚑ Mark this", key="_debug_mark",
            help="Stamp the current moment as an issue. Adds a marker "
                 "event with a full session snapshot.",
            use_container_width=True,
        ):
            mark_issue("Issue noticed here")
            st.toast("Marked. Export the log to share.")
            st.rerun()
    with cols[1]:
        if st.button(
            "Export", key="_debug_export",
            use_container_width=True,
        ):
            try:
                path = export_log()
                st.toast(f"Saved: {path.name}")
                st.sidebar.caption(f"📄 `{path}`")
            except Exception as exc:  # noqa: BLE001
                st.sidebar.error(f"Export failed: {exc}")

    if st.sidebar.button(
        "Clear log", key="_debug_clear",
        help="Drop all recorded events (start the trail fresh).",
    ):
        clear_log()
        st.rerun()

    with st.sidebar.expander(
        f"Recent events ({min(len(events), 20)} of {len(events)})",
        expanded=False,
    ):
        if not events:
            st.caption("No events yet.")
        else:
            # Most-recent-first, last 20 only.
            for evt in reversed(events[-20:]):
                kind_badge = "⚑" if evt["kind"] == "marker" else "·"
                st.markdown(
                    f"`#{evt['n']:03d}` {kind_badge} **{evt['kind']}** "
                    f"— {evt['summary']}",
                )
