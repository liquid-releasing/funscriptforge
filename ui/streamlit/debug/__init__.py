# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Debug-mode instrumentation for FunscriptForge.

Off by default. Toggled on from the sidebar (or via `?debug=1` URL
param). When on, `log_event` appends to an in-session event log that
the user can mark and export as a JSONL click trail — used to file
precise bug reports ("I noticed the glitch at click 37; here's the
log").

Stays completely inert when debug is off: `log_event` is cheap no-op
guarded by `is_debug_enabled()`.
"""

from .events import (
    hash_actions,
    is_debug_enabled,
    log_event,
    mark_issue,
    render_debug_sidebar,
    snapshot_session,
)

__all__ = [
    "hash_actions",
    "is_debug_enabled",
    "log_event",
    "mark_issue",
    "render_debug_sidebar",
    "snapshot_session",
]
