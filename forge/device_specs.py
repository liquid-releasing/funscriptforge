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


def apply_minimum_fix(
    actions: list[dict],
    limits: DeviceSpec,
    *,
    intensity_spikes: float = 0.0,
    spike_seed: int = 42,
) -> list[dict]:
    """Apply minimum corrections to bring actions within device limits.

    Only modifies actions that violate limits. Preserves timing,
    adjusts positions to stay within max_speed and max_delta constraints.

    Args:
        actions: Funscript actions list.
        limits: Combined device limits.
        intensity_spikes: Fraction of cycles (0.0–0.5) allowed to use full
            delta instead of clamped delta. Only applies to estim devices
            where max_delta < 100. 0.0 = smooth (all clamped),
            0.5 = every other cycle can spike.
        spike_seed: Random seed for reproducible spike placement.

    Returns:
        Tuple of (fixed_actions, fix_stats) where fix_stats is a dict with
        actions_clamped, spike_cycles, total_cycles.
    """
    import copy
    import random

    result = copy.deepcopy(actions)

    if len(result) < 2:
        return result, {"actions_clamped": 0, "spike_cycles": 0, "total_cycles": 0}

    # Identify cycles (direction changes) for spike selection
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

        # Track cycles (direction changes)
        if direction != 0 and direction != _prev_direction:
            _cycle_idx += 1
            _prev_direction = direction

        # Determine if this cycle is a spike cycle
        _is_spike = _use_spikes and _rng.random() < intensity_spikes
        if _is_spike:
            _spike_count += 1

        # Delta clamp (estim comfort — max position change per action)
        # Spike cycles skip the delta clamp (allowed full range)
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

        # Speed clamp (mechanical devices — max position change per time)
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

    _fix_stats = {
        "actions_clamped": _clamp_count,
        "spike_cycles": _spike_count,
        "total_cycles": _cycle_idx,
    }
    return result, _fix_stats
