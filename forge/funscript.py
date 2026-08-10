"""
Funscript parsing and stats.
"""

import json
import numpy as np
from pathlib import Path
from typing import Optional


def load_funscript(path: str) -> Optional[dict]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def load_funscript_strict(path: str) -> dict:
    """Load a funscript, raising an actionable error instead of returning None.

    :func:`load_funscript` swallows every failure into ``None``, which suits
    callers that treat "absent" as an ordinary case. It does NOT suit a command
    handed a bad path: the ``None`` flows onward and surfaces as
    ``AttributeError: 'NoneType' object has no attribute 'get'`` — a stack trace
    that names no file and tells the user nothing they can act on (D34).

    This raises ``FileNotFoundError`` / ``ValueError`` instead, naming the path.
    Those are exactly the two exceptions ``cli._cli_command`` renders as a clean
    one-line ``Error: …`` message, so the diagnosis reaches the user intact.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Funscript not found: {path}")
    if p.is_dir():
        raise ValueError(f"Expected a funscript file but got a directory: {path}")
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Could not read funscript {path}: {exc}") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Funscript is not valid JSON ({path}): line {exc.lineno}, "
            f"column {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(data, dict):
        raise ValueError(
            f"Funscript must be a JSON object with an 'actions' array, "
            f"got {type(data).__name__}: {path}"
        )
    return data


def parse_actions(data: dict) -> tuple[list, list]:
    """Return (times_ms, positions) arrays."""
    actions = data.get("actions", [])
    if not actions:
        return [], []
    times = [a["at"] for a in actions]
    positions = [a["pos"] for a in actions]
    return times, positions


def funscript_stats(data: dict) -> dict:
    times, positions = parse_actions(data)
    if not times:
        return {}

    times_s = np.array(times) / 1000.0
    positions = np.array(positions)
    duration_s = times_s[-1] - times_s[0]

    # speed between consecutive actions
    dt = np.diff(times_s)
    dp = np.diff(positions)
    speeds = np.abs(dp / np.where(dt > 0, dt, 1e-6))

    return {
        "duration": duration_s,
        "duration_s": duration_s,
        "duration_fmt": _fmt_duration(duration_s),
        "action_count": len(times),
        "avg_speed": float(np.mean(speeds)),
        "max_speed": float(np.max(speeds)),
        "min_pos": int(np.min(positions)),
        "max_pos": int(np.max(positions)),
        "avg_pos": float(np.mean(positions)),
    }


def _fmt_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
