"""Device specifications — load limits from JSON, compute constraints."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


_SPECS_PATH = Path(__file__).parent / "device_specs.json"


@dataclass
class DeviceSpec:
    """Limits for a single output device."""

    key: str
    name: str
    device_type: str = ""     # "stroker" or "estim"
    max_speed: float = 400    # position-units/sec
    max_bpm: float = 120      # beats per minute
    min_cycle_ms: int = 250   # minimum cycle duration
    position_min: int = 0
    position_max: int = 100
    max_acceleration: float = 3000
    max_delta: int = 100      # max position change between consecutive actions
    notes: str = ""


def load_device_specs() -> dict[str, DeviceSpec]:
    """Load all device specs from JSON."""
    data = json.loads(_SPECS_PATH.read_text(encoding="utf-8"))
    specs = {}
    for key, d in data.get("devices", {}).items():
        specs[key] = DeviceSpec(
            key=key,
            name=d["name"],
            device_type=d.get("type", ""),
            max_speed=d["max_speed"],
            max_bpm=d["max_bpm"],
            min_cycle_ms=d["min_cycle_ms"],
            position_min=d["position_min"],
            position_max=d["position_max"],
            max_acceleration=d["max_acceleration"],
            max_delta=d.get("max_delta", 100),
            notes=d.get("notes", ""),
        )
    return specs


def combined_limits(selected_keys: list[str]) -> DeviceSpec | None:
    """Compute the most restrictive limits across selected devices.

    Returns a synthetic DeviceSpec representing the intersection of all
    selected device limits — the tightest constraint wins.
    """
    specs = load_device_specs()
    selected = [specs[k] for k in selected_keys if k in specs]
    if not selected:
        return None

    return DeviceSpec(
        key="_combined",
        name="Combined",
        device_type="mixed" if len(set(s.device_type for s in selected)) > 1 else selected[0].device_type,
        max_speed=min(s.max_speed for s in selected),
        max_bpm=min(s.max_bpm for s in selected),
        min_cycle_ms=max(s.min_cycle_ms for s in selected),
        position_min=max(s.position_min for s in selected),
        position_max=min(s.position_max for s in selected),
        max_acceleration=min(s.max_acceleration for s in selected),
        max_delta=min(s.max_delta for s in selected),
        notes=f"Combined limits for: {', '.join(s.name for s in selected)}",
    )


def analyze_violations(
    actions: list[dict],
    limits: DeviceSpec,
) -> dict:
    """Analyze which actions violate device limits.

    Returns:
        Dict with violation_count, total_actions, max_speed_found,
        max_bpm_found, violating_indices, and percent_ok.
    """
    if len(actions) < 2:
        return {
            "violation_count": 0,
            "total_actions": len(actions),
            "max_speed_found": 0,
            "violating_indices": [],
            "percent_ok": 100.0,
        }

    speed_violations = []
    delta_violations = []
    max_speed_found = 0.0
    max_delta_found = 0

    for i in range(1, len(actions)):
        dt_ms = actions[i]["at"] - actions[i - 1]["at"]
        dp = abs(actions[i]["pos"] - actions[i - 1]["pos"])

        # Delta check (estim comfort)
        if dp > limits.max_delta:
            delta_violations.append(i)
        if dp > max_delta_found:
            max_delta_found = dp

        # Speed check (mechanical devices)
        if dt_ms > 0:
            speed = dp / (dt_ms / 1000.0)
            if speed > max_speed_found:
                max_speed_found = speed
            if speed > limits.max_speed:
                speed_violations.append(i)

    all_violations = sorted(set(speed_violations + delta_violations))
    total = len(actions)
    ok_count = total - len(all_violations)

    return {
        "violation_count": len(all_violations),
        "speed_violations": len(speed_violations),
        "delta_violations": len(delta_violations),
        "total_actions": total,
        "max_speed_found": round(max_speed_found, 1),
        "max_delta_found": max_delta_found,
        "violating_indices": all_violations,
        "percent_ok": round(ok_count / total * 100, 1) if total > 0 else 100.0,
    }


# Intensity spike presets: name → fraction of cycles allowed at full delta
INTENSITY_SPIKE_PRESETS = {
    "None":           0.0,
    "1/16 Seldom":    0.0625,  # 1 in 16
    "⅛ Rare":         0.125,   # 1 in 8
    "¼ Moderate":     0.25,    # 1 in 4
    "½ Frequent":     0.50,    # 1 in 2
}


def detect_stingy(
    actions: list[dict],
    window_seconds: int = 60,
) -> dict:
    """Detect stingy characteristics using the three red flags model.

    A script is stingy when ALL THREE are present:
    1. Low velocity CV (< 0.15) — mechanically uniform cycles
    2. Flat Build ratio (≈ 1.0) — no escalation over time
    3. Zero quiet windows — no macro rest periods

    Returns dict with cv_median, build_ratio, quiet_windows, is_stingy,
    monotone_pct, and per-window cv values.
    """
    import numpy as np

    if len(actions) < 10:
        return {"cv_median": 0, "build_ratio": 1.0, "quiet_windows": 0,
                "is_stingy": False, "monotone_pct": 0, "windows": []}

    times = np.array([a["at"] for a in actions], dtype=float)
    pos = np.array([a["pos"] for a in actions], dtype=float)
    dt_ms = np.diff(times)
    dp_abs = np.abs(np.diff(pos))
    velocity = np.where(dt_ms > 0, dp_abs / dt_ms * 1000, 0)

    dur_s = (times[-1] - times[0]) / 1000
    dur_min = dur_s / 60
    window_ms = window_seconds * 1000

    # Windowed CV analysis
    windows = []
    for s_min in range(0, int(dur_min)):
        s_ms = s_min * 60000
        e_ms = s_ms + window_ms
        mask = (times[:-1] >= s_ms) & (times[:-1] < e_ms)
        v = velocity[mask]
        if len(v) > 5 and np.mean(v) > 0:
            cv = float(np.std(v) / np.mean(v))
            vel_mean = float(np.mean(v))
            windows.append({"min": s_min, "cv": cv, "vel_mean": vel_mean})

    if not windows:
        return {"cv_median": 0, "build_ratio": 1.0, "quiet_windows": 0,
                "is_stingy": False, "monotone_pct": 0, "windows": []}

    cv_vals = [w["cv"] for w in windows]
    vel_vals = [w["vel_mean"] for w in windows]
    cv_median = float(np.median(cv_vals))
    monotone_pct = sum(1 for c in cv_vals if c < 0.15) / len(cv_vals) * 100

    # Build ratio: last-quarter velocity / first-quarter velocity
    n_win = len(vel_vals)
    q_size = max(1, n_win // 4)
    q1_mean = float(np.mean(vel_vals[:q_size]))
    q4_mean = float(np.mean(vel_vals[-q_size:]))
    build_ratio = q4_mean / q1_mean if q1_mean > 0 else 1.0

    # Quiet windows (mean velocity < 50)
    quiet_windows = sum(1 for w in windows if w["vel_mean"] < 50)

    # Three red flags
    is_stingy = (cv_median < 0.15 and build_ratio < 1.2 and quiet_windows == 0)

    return {
        "cv_median": round(cv_median, 3),
        "build_ratio": round(build_ratio, 2),
        "quiet_windows": quiet_windows,
        "monotone_pct": round(monotone_pct, 1),
        "is_stingy": is_stingy,
        "total_windows": len(windows),
        "windows": windows,
    }


def apply_humanize(
    actions: list[dict],
    target_cv: float = 0.35,
    *,
    seed: int = 42,
) -> tuple[list[dict], dict]:
    """Apply velocity variation to monotone sections.

    Varies cycle timing to achieve target CV while preserving:
    - Beat pattern (same number of cycles)
    - Amplitude (same position values)
    - Overall pacing (timing shifts average to zero)

    Only affects windows with CV < 0.15. Leaves already-varied
    sections untouched.

    Args:
        actions: Funscript actions list.
        target_cv: Target velocity CV (0.0 = no change, ~0.35 = like RoD).
        seed: Random seed for reproducible variation.

    Returns:
        Tuple of (humanized_actions, stats) where stats has
        windows_modified, original_cv, result_cv.
    """
    import copy
    import numpy as np
    import random

    result = copy.deepcopy(actions)
    if len(result) < 10 or target_cv <= 0:
        return result, {"windows_modified": 0, "original_cv": 0, "result_cv": 0}

    times = np.array([a["at"] for a in result], dtype=float)
    pos = np.array([a["pos"] for a in result], dtype=float)
    dt_ms = np.diff(times)
    dp_abs = np.abs(np.diff(pos))
    velocity = np.where(dt_ms > 0, dp_abs / dt_ms * 1000, 0)

    dur_min = (times[-1] - times[0]) / 60000
    rng = random.Random(seed)
    windows_modified = 0

    # Pre-compute original CV
    orig_cv_vals = []
    for s_min in range(0, int(dur_min)):
        s_ms, e_ms = s_min * 60000, (s_min + 1) * 60000
        mask = (times[:-1] >= s_ms) & (times[:-1] < e_ms)
        v = velocity[mask]
        if len(v) > 5 and np.mean(v) > 0:
            orig_cv_vals.append(np.std(v) / np.mean(v))

    original_cv = float(np.median(orig_cv_vals)) if orig_cv_vals else 0

    # Apply timing variation to monotone sections
    # Strategy: shift action timestamps by ±variation_ms to create speed variation
    # A cycle with actions [t0, t1, t2] becomes [t0, t1±jitter, t2]
    # This changes the velocity of each half-cycle without changing positions

    for s_min in range(0, int(dur_min)):
        s_ms = s_min * 60000
        e_ms = (s_min + 1) * 60000

        # Find actions in this window
        indices = [i for i in range(len(result))
                   if s_ms <= result[i]["at"] < e_ms]
        if len(indices) < 6:
            continue

        # Compute window CV
        win_times = np.array([result[i]["at"] for i in indices], dtype=float)
        win_pos = np.array([result[i]["pos"] for i in indices], dtype=float)
        win_dt = np.diff(win_times)
        win_dp = np.abs(np.diff(win_pos))
        win_vel = np.where(win_dt > 0, win_dp / win_dt * 1000, 0)
        win_mean = np.mean(win_vel)
        win_cv = np.std(win_vel) / win_mean if win_mean > 0 else 0

        if win_cv >= 0.15:
            continue  # Already has enough variation

        # Calculate jitter needed to reach target CV
        # CV = std/mean, so std_target = target_cv * mean
        # Jitter in timing creates velocity variation
        mean_dt = np.mean(win_dt) if len(win_dt) > 0 else 500
        jitter_fraction = min(target_cv * 0.5, 0.25)  # Cap at 25% of interval

        # Apply jitter to interior actions (not first/last of window)
        for idx in indices[1:-1]:
            dt_prev = result[idx]["at"] - result[idx - 1]["at"]
            if dt_prev < 30:  # Skip very short intervals
                continue
            max_jitter_ms = dt_prev * jitter_fraction
            jitter = rng.uniform(-max_jitter_ms, max_jitter_ms)
            new_time = result[idx]["at"] + jitter

            # Ensure ordering is preserved
            if idx > 0 and new_time <= result[idx - 1]["at"] + 10:
                continue
            if idx < len(result) - 1 and new_time >= result[idx + 1]["at"] - 10:
                continue

            result[idx]["at"] = int(round(new_time))

        windows_modified += 1

    # Compute result CV
    r_times = np.array([a["at"] for a in result], dtype=float)
    r_dt = np.diff(r_times)
    r_dp = np.abs(np.diff(np.array([a["pos"] for a in result], dtype=float)))
    r_vel = np.where(r_dt > 0, r_dp / r_dt * 1000, 0)
    result_cv_vals = []
    for s_min in range(0, int(dur_min)):
        s_ms, e_ms = s_min * 60000, (s_min + 1) * 60000
        mask = (r_times[:-1] >= s_ms) & (r_times[:-1] < e_ms)
        v = r_vel[mask]
        if len(v) > 5 and np.mean(v) > 0:
            result_cv_vals.append(np.std(v) / np.mean(v))

    result_cv = float(np.median(result_cv_vals)) if result_cv_vals else 0

    stats = {
        "windows_modified": windows_modified,
        "original_cv": round(original_cv, 3),
        "result_cv": round(result_cv, 3),
    }
    return result, stats


def apply_device_awareness(
    actions: list[dict],
    limits: DeviceSpec,
    *,
    groove: float = 0.35,
    intensity_spikes: float = 0.0,
    spike_seed: int = 42,
) -> tuple[list[dict], dict]:
    """Apply full device awareness: humanize + speed backstop.

    1. Humanize — add velocity variation to monotone sections (CV-based)
    2. Speed backstop — clamp extreme velocities (high threshold, safety net)

    Args:
        actions: Funscript actions list.
        limits: Combined device limits.
        groove: Target velocity CV for humanize (0.0 = off, 0.35 = like RoD).
        intensity_spikes: Fraction of cycles allowed at full intensity.
        spike_seed: Random seed.

    Returns:
        Tuple of (fixed_actions, stats).
    """
    import copy

    result = copy.deepcopy(actions)
    if len(result) < 2:
        return result, {"humanize": {}, "clamp": {}}

    # Step 1: Humanize (add velocity variation)
    humanized, h_stats = apply_humanize(result, target_cv=groove, seed=spike_seed)

    # Step 2: Speed backstop (only for extreme violations)
    clamped, c_stats = apply_minimum_fix(
        humanized, limits,
        intensity_spikes=intensity_spikes,
        spike_seed=spike_seed,
    )

    stats = {
        "humanize": h_stats,
        "clamp": c_stats,
    }
    return clamped, stats


def apply_minimum_fix(
    actions: list[dict],
    limits: DeviceSpec,
    *,
    intensity_spikes: float = 0.0,
    spike_seed: int = 42,
) -> tuple[list[dict], dict]:
    """Apply minimum speed/delta corrections as a safety backstop.

    Only modifies actions that violate limits. Preserves timing,
    adjusts positions to stay within max_speed and max_delta constraints.

    Returns:
        Tuple of (fixed_actions, fix_stats).
    """
    import copy
    import random

    result = copy.deepcopy(actions)

    if len(result) < 2:
        return result, {"actions_clamped": 0, "spike_cycles": 0, "total_cycles": 0}

    _rng = random.Random(spike_seed)
    _use_spikes = intensity_spikes > 0
    _cycle_idx = 0
    _prev_direction = 0
    _spike_count = 0
    _clamp_count = 0

    for i in range(1, len(result)):
        dt_ms = result[i]["at"] - result[i - 1]["at"]
        dp = result[i]["pos"] - result[i - 1]["pos"]
        abs_dp = abs(dp)
        direction = 1 if dp > 0 else (-1 if dp < 0 else 0)

        if direction != 0 and direction != _prev_direction:
            _cycle_idx += 1
            _prev_direction = direction

        _is_spike = _use_spikes and _rng.random() < intensity_spikes
        if _is_spike:
            _spike_count += 1

        effective_delta = 100 if _is_spike else limits.max_delta
        _clamped_this = False
        if abs_dp > effective_delta:
            new_pos = result[i - 1]["pos"] + (1 if dp > 0 else -1) * effective_delta
            result[i]["pos"] = int(round(max(
                limits.position_min,
                min(limits.position_max, new_pos),
            )))
            dp = result[i]["pos"] - result[i - 1]["pos"]
            abs_dp = abs(dp)
            _clamped_this = True

        if dt_ms > 0:
            dt_s = dt_ms / 1000.0
            speed = abs_dp / dt_s
            if speed > limits.max_speed and not _is_spike:
                max_dp = limits.max_speed * dt_s
                new_pos = result[i - 1]["pos"] + (1 if dp > 0 else -1) * max_dp
                result[i]["pos"] = int(round(max(
                    limits.position_min,
                    min(limits.position_max, new_pos),
                )))
                _clamped_this = True

        if _clamped_this:
            _clamp_count += 1

    return result, {
        "actions_clamped": _clamp_count,
        "spike_cycles": _spike_count,
        "total_cycles": _cycle_idx,
    }
