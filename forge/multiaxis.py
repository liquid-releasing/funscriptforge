# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus 4.6).

"""multiaxis.py — Generate secondary axis funscripts from L0 stroke data.

Derives roll, pitch, twist, surge, and sway from the primary stroke
funscript using phrase-aware algorithms. Each phrase can have its own
position style (Cowgirl, Missionary, Doggy, Riding, Random) that
determines how the secondary axes relate to the stroke.

The generation is deterministic: same input + same style assignment
always produces the same output (random walks use per-phrase seeds
derived from phrase index).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Optional


# ── Data types ────────────────────────────────────────────────────────


@dataclass
class AxisSignal:
    """A generated signal for one secondary axis over a time range."""
    times_ms: list[int]
    positions: list[float]  # 0-100 range, 50 = neutral


@dataclass
class MultiAxisResult:
    """Full multi-axis generation result for one funscript."""
    roll: Optional[AxisSignal] = None
    pitch: Optional[AxisSignal] = None
    twist: Optional[AxisSignal] = None
    surge: Optional[AxisSignal] = None
    sway: Optional[AxisSignal] = None

    def active_axes(self) -> dict[str, AxisSignal]:
        """Return only axes that have non-None signals."""
        out = {}
        for name in ("roll", "pitch", "twist", "surge", "sway"):
            sig = getattr(self, name)
            if sig is not None and sig.times_ms:
                out[name] = sig
        return out


# ── Algorithm implementations ─────────────────────────────────────────


def algo_none(times_ms: list[int], stroke_pos: list[float],
              **_kwargs) -> AxisSignal:
    """Constant neutral position (50). Device doesn't move on this axis."""
    return AxisSignal(
        times_ms=list(times_ms),
        positions=[50.0] * len(times_ms),
    )


def algo_sine(times_ms: list[int], stroke_pos: list[float],
              amplitude: float = 0.3, freq_hz: float = 0.5,
              phase_offset: float = 0.0,
              modulate_by: str = "", mod_strength: float = 0.4,
              **_kwargs) -> AxisSignal:
    """Sinusoidal oscillation, optionally modulated by stroke velocity.

    Args:
        amplitude: 0.0-1.0, maps to 0-50 position units from center.
        freq_hz: oscillation frequency.
        phase_offset: radians.
        modulate_by: "stroke_velocity" to scale amplitude by speed.
        mod_strength: 0.0-1.0, how much velocity scales amplitude.
    """
    amp_units = amplitude * 50.0  # max deviation from center
    velocities = _compute_velocities(times_ms, stroke_pos) if modulate_by == "stroke_velocity" else None

    positions = []
    for i, t_ms in enumerate(times_ms):
        t_s = t_ms / 1000.0
        base = math.sin(2 * math.pi * freq_hz * t_s + phase_offset)

        if velocities is not None:
            # Scale amplitude by normalized velocity
            vel_scale = 1.0 - mod_strength + mod_strength * velocities[i]
            val = 50.0 + base * amp_units * vel_scale
        else:
            val = 50.0 + base * amp_units

        positions.append(_clamp(val))

    return AxisSignal(times_ms=list(times_ms), positions=positions)


def algo_correlate_stroke(times_ms: list[int], stroke_pos: list[float],
                          correlation: float = 0.7, amplitude: float = 0.6,
                          phase_offset: float = 0.0, bias: float = 0.0,
                          **_kwargs) -> AxisSignal:
    """Derive axis value from L0 stroke position.

    Args:
        correlation: -1.0 to 1.0 (1.0 = same direction, -1.0 = inverted).
        amplitude: 0.0-1.0.
        phase_offset: not used for position correlation (reserved for future).
        bias: -1.0 to 1.0, shifts output center (0.3 = biased forward).
    """
    amp_units = amplitude * 50.0
    bias_units = bias * 50.0
    positions = []
    for pos in stroke_pos:
        # Normalize stroke to -1..1
        normalized = (pos - 50.0) / 50.0
        val = 50.0 + bias_units + normalized * correlation * amp_units
        positions.append(_clamp(val))

    return AxisSignal(times_ms=list(times_ms), positions=positions)


def algo_correlate_stroke_velocity(times_ms: list[int], stroke_pos: list[float],
                                   amplitude: float = 0.7,
                                   smoothing: float = 0.6,
                                   **_kwargs) -> AxisSignal:
    """Derive axis value from stroke velocity (speed of L0 changes).

    Fast strokes produce large axis motion; slow strokes stay near center.

    Args:
        amplitude: 0.0-1.0.
        smoothing: 0.0-1.0 (higher = smoother, less jitter).
    """
    velocities = _compute_velocities(times_ms, stroke_pos)
    amp_units = amplitude * 50.0
    alpha = smoothing

    positions = []
    smoothed = 0.0
    for i, vel in enumerate(velocities):
        smoothed = alpha * smoothed + (1.0 - alpha) * vel
        # Direction: positive velocity → positive displacement
        direction = 1.0
        if i > 0 and stroke_pos[i] < stroke_pos[i - 1]:
            direction = -1.0
        val = 50.0 + direction * smoothed * amp_units
        positions.append(_clamp(val))

    return AxisSignal(times_ms=list(times_ms), positions=positions)


def algo_random_walk(times_ms: list[int], stroke_pos: list[float],
                     amplitude: float = 0.5, smoothing: float = 0.6,
                     modulate_by: str = "", mod_strength: float = 0.5,
                     seed: int = 42,
                     **_kwargs) -> AxisSignal:
    """Brownian motion with smoothing. Deterministic via seed.

    Args:
        amplitude: 0.0-1.0.
        smoothing: 0.0-1.0 (higher = smoother drift).
        modulate_by: "stroke_velocity" to scale by speed.
        mod_strength: 0.0-1.0.
        seed: deterministic seed for reproducibility.
    """
    rng = random.Random(seed)
    velocities = _compute_velocities(times_ms, stroke_pos) if modulate_by == "stroke_velocity" else None
    amp_units = amplitude * 50.0

    positions = []
    current = 0.0  # deviation from center, range -1..1
    for i in range(len(times_ms)):
        step = rng.gauss(0, 0.1)
        current = smoothing * current + (1.0 - smoothing) * (current + step)
        current = max(-1.0, min(1.0, current))

        if velocities is not None:
            vel_scale = 1.0 - mod_strength + mod_strength * velocities[i]
            val = 50.0 + current * amp_units * vel_scale
        else:
            val = 50.0 + current * amp_units

        positions.append(_clamp(val))

    return AxisSignal(times_ms=list(times_ms), positions=positions)


# ── Algorithm registry ────────────────────────────────────────────────

ALGORITHMS = {
    "none": algo_none,
    "sine": algo_sine,
    "correlate_stroke": algo_correlate_stroke,
    "correlate_stroke_velocity": algo_correlate_stroke_velocity,
    "random_walk": algo_random_walk,
}


# ── Per-phrase generation ─────────────────────────────────────────────


def generate_axis_for_phrase(
    axis_config: dict,
    times_ms: list[int],
    stroke_pos: list[float],
    phrase_index: int,
    axis_name: str,
) -> AxisSignal:
    """Generate one axis signal for one phrase.

    Args:
        axis_config: {"algorithm": "sine", "amplitude": 0.3, ...}
        times_ms: action timestamps within the phrase.
        stroke_pos: L0 positions within the phrase.
        phrase_index: for deterministic random seed.
        axis_name: for deterministic random seed.
    """
    algo_name = axis_config.get("algorithm", "none")
    algo_fn = ALGORITHMS.get(algo_name, algo_none)

    # Deterministic seed from phrase index + axis name
    seed = hash(f"{phrase_index}_{axis_name}") & 0x7FFFFFFF
    params = {k: v for k, v in axis_config.items() if k != "algorithm"}
    params["seed"] = seed

    return algo_fn(times_ms, stroke_pos, **params)


# ── Full-script generation with stitching ─────────────────────────────


def generate_multiaxis(
    actions: list[dict],
    phrases: list[dict],
    style_assignments: dict[int, str],
    presets: dict[str, dict],
    crossfade_ms: int = 200,
) -> MultiAxisResult:
    """Generate all secondary axes for a full funscript.

    Args:
        actions: full funscript actions [{at, pos}, ...].
        phrases: phrase dicts with start_ms, end_ms.
        style_assignments: {phrase_index: style_name} for non-None phrases.
        presets: {style_name: {axis_name: {algorithm, params...}}}.
        crossfade_ms: crossfade duration at phrase boundaries.

    Returns:
        MultiAxisResult with signals for each active axis.
    """
    if not actions or not phrases:
        return MultiAxisResult()

    all_times = [a["at"] for a in actions]
    all_pos = [a["pos"] for a in actions]
    total_duration_ms = all_times[-1] if all_times else 0

    # Determine which axes are needed (any phrase uses them)
    needed_axes: set[str] = set()
    for pi, style_name in style_assignments.items():
        if style_name and style_name in presets:
            for axis_name, cfg in presets[style_name].items():
                if axis_name.startswith("_") or not isinstance(cfg, dict):
                    continue
                if cfg.get("algorithm", "none") != "none":
                    needed_axes.add(axis_name)

    if not needed_axes:
        return MultiAxisResult()

    # Generate per-axis, per-phrase, then stitch
    axis_signals: dict[str, AxisSignal] = {}
    for axis_name in needed_axes:
        full_times: list[int] = []
        full_positions: list[float] = []

        for pi, phrase in enumerate(phrases):
            p_start = phrase["start_ms"]
            p_end = phrase["end_ms"]

            # Extract actions within this phrase
            p_times = []
            p_pos = []
            for t, p in zip(all_times, all_pos):
                if p_start <= t <= p_end:
                    p_times.append(t)
                    p_pos.append(p)

            if not p_times:
                continue

            style_name = style_assignments.get(pi)
            if style_name and style_name in presets:
                axis_cfg = presets[style_name].get(axis_name, {"algorithm": "none"})
            else:
                axis_cfg = {"algorithm": "none"}

            seg = generate_axis_for_phrase(axis_cfg, p_times, p_pos, pi, axis_name)

            # Crossfade with previous segment
            if full_times and seg.times_ms:
                _apply_crossfade(full_times, full_positions,
                                 seg.times_ms, seg.positions, crossfade_ms)

            full_times.extend(seg.times_ms)
            full_positions.extend(seg.positions)

        if full_times:
            axis_signals[axis_name] = AxisSignal(
                times_ms=full_times,
                positions=full_positions,
            )

    return MultiAxisResult(**axis_signals)


def multiaxis_to_funscript_actions(signal: AxisSignal) -> list[dict]:
    """Convert an AxisSignal to funscript actions format."""
    return [
        {"at": t, "pos": int(round(max(0, min(100, p))))}
        for t, p in zip(signal.times_ms, signal.positions)
    ]


# ── Internal helpers ──────────────────────────────────────────────────


def _compute_velocities(times_ms: list[int], positions: list[float]) -> list[float]:
    """Compute normalized velocity (0-1) for each action."""
    if len(times_ms) < 2:
        return [0.0] * len(times_ms)

    raw = [0.0]
    for i in range(1, len(times_ms)):
        dt = times_ms[i] - times_ms[i - 1]
        dp = abs(positions[i] - positions[i - 1])
        raw.append(dp / max(dt, 1) * 1000.0)  # pos/s

    # Normalize to 0-1
    max_vel = max(raw) if max(raw) > 0 else 1.0
    return [v / max_vel for v in raw]


def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


def _apply_crossfade(
    prev_times: list[int], prev_pos: list[float],
    next_times: list[int], next_pos: list[float],
    fade_ms: int,
) -> None:
    """Apply a raised-cosine crossfade at the boundary between two segments.

    Modifies prev_pos tail and next_pos head in-place to blend through
    neutral (50) at the boundary.
    """
    if not prev_times or not next_times:
        return

    boundary_ms = next_times[0]
    half_fade = fade_ms // 2

    # Fade out: prev segment's tail → neutral
    for i in range(len(prev_times) - 1, -1, -1):
        dt = boundary_ms - prev_times[i]
        if dt > half_fade:
            break
        if half_fade > 0:
            t = dt / half_fade  # 0 at boundary, 1 at fade start
            weight = 0.5 * (1.0 + math.cos(math.pi * (1.0 - t)))
            prev_pos[i] = prev_pos[i] * weight + 50.0 * (1.0 - weight)

    # Fade in: next segment's head → from neutral
    for i in range(len(next_times)):
        dt = next_times[i] - boundary_ms
        if dt > half_fade:
            break
        if half_fade > 0:
            t = dt / half_fade  # 0 at boundary, 1 at fade end
            weight = 0.5 * (1.0 + math.cos(math.pi * (1.0 - t)))
            next_pos[i] = next_pos[i] * weight + 50.0 * (1.0 - weight)
