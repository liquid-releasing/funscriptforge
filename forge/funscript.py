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
