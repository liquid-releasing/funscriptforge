# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""phrase_transforms.py — Catalog of per-phrase funscript transforms.

Each PhraseTransform describes one named transform that can be applied to
the actions within a phrase window.  The catalog is used by both the CLI
pipeline and the Streamlit UI phrase-detail panel.

Usage::

    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG, suggest_transform

    spec = TRANSFORM_CATALOG["amplitude_scale"]
    new_actions = spec.apply(phrase_actions)

    key, params = suggest_transform(phrase_dict, bpm_threshold=120.0)

User extensions
---------------
Two directories in the project root allow users to extend the catalog without
editing this file:

* ``user_transforms/`` — JSON recipe files.  Each file defines one or more
  transforms as an ordered list of existing catalog steps::

      {
        "key": "my_fix",
        "name": "My Fix",
        "description": "Recenter then amplify",
        "steps": [
          {"transform": "recenter",        "params": {"target_center": 50}},
          {"transform": "amplitude_scale", "params": {"scale": 2.5}}
        ]
      }

* ``plugins/`` — Python plugin files.  Each file must expose a module-level
  ``TRANSFORM`` (one ``PhraseTransform`` instance) or ``TRANSFORMS`` (list).
  See ``plugins/example_plugin.py`` for a template.

Both directories are scanned automatically at import time.  Keys must be
unique; user-defined keys that clash with built-ins are skipped with a
warning.
"""

from __future__ import annotations

import copy
import glob
import importlib.util
import json
import math
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from utils import low_pass_filter


# ------------------------------------------------------------------
# Parameter descriptor
# ------------------------------------------------------------------

@dataclass
class TransformParam:
    """Metadata for one tuneable parameter of a transform."""
    label: str
    type: str           # "float" | "int" | "bool"
    default: Any
    min_val: Any = None
    max_val: Any = None
    step: Any = None
    help: str = ""


# ------------------------------------------------------------------
# Transform base
# ------------------------------------------------------------------

@dataclass
class PhraseTransform:
    """A named, parameterised transform that modifies a slice of actions.

    Attributes
    ----------
    key:         Short machine-readable identifier.
    name:        Human-readable display name.
    description: One-sentence explanation of what the transform does.
    params:      Dict of parameter name → TransformParam descriptor.
    structural:  If True, the transform may return a different number of
                 actions with different timestamps (not just modified pos).
                 Callers must replace the phrase slice rather than patching
                 positions in-place.
    """
    key: str
    name: str
    description: str
    params: Dict[str, TransformParam] = field(default_factory=dict)
    structural: bool = False
    category: str = ""          # Optional grouping label for the dropdown (user transforms)
    hidden: bool = False        # Kept in the catalog (recipes / suggest_transform
                                # still resolve the key) but omitted from the
                                # picker UI — used for consolidated aliases.

    def apply(self, actions: list, param_values: Optional[Dict[str, Any]] = None) -> list:
        """Return a new action list with the transform applied.

        Parameters
        ----------
        actions:
            Slice of funscript actions (``[{"at": ms, "pos": 0-100}, …]``).
            The originals are not mutated.
        param_values:
            Override values for any parameter keys.  Missing keys fall back
            to the param's default.
        """
        p = {k: v.default for k, v in self.params.items()}
        if param_values:
            p.update({k: v for k, v in param_values.items() if k in p})
        result = copy.deepcopy(actions)
        return self._transform(result, p)

    def _transform(self, actions: list, p: dict) -> list:
        raise NotImplementedError


# ------------------------------------------------------------------
# Concrete transforms
# ------------------------------------------------------------------

class _Passthrough(PhraseTransform):
    def _transform(self, actions, p):
        return actions


class _AmplitudeScale(PhraseTransform):
    """Scale positions around the midpoint (50)."""
    def _transform(self, actions, p):
        scale = p["scale"]
        for a in actions:
            centered = a["pos"] - 50
            a["pos"] = max(0, min(100, int(50 + centered * scale)))
        return actions


class _Normalize(PhraseTransform):
    """Expand positions to fill the full 0-100 range."""
    def _transform(self, actions, p):
        if not actions:
            return actions
        lo = min(a["pos"] for a in actions)
        hi = max(a["pos"] for a in actions)
        span = hi - lo
        if span == 0:
            return actions
        target_lo = p["target_lo"]
        target_hi = p["target_hi"]
        target_span = target_hi - target_lo
        for a in actions:
            a["pos"] = max(0, min(100, int(target_lo + (a["pos"] - lo) / span * target_span)))
        return actions


class _Smooth(PhraseTransform):
    """Apply a low-pass filter to reduce rapid position changes."""
    def _transform(self, actions, p):
        strength = p["strength"]
        positions = [a["pos"] for a in actions]
        smoothed = low_pass_filter(positions, [strength] * len(positions))
        for a, pos in zip(actions, smoothed):
            a["pos"] = int(pos)
        return actions


class _ClampRange(PhraseTransform):
    """Compress positions into a sub-range (e.g. upper or lower half)."""
    def _transform(self, actions, p):
        lo = p["range_lo"]
        hi = p["range_hi"]
        span = hi - lo
        for a in actions:
            a["pos"] = max(0, min(100, int(lo + a["pos"] / 100.0 * span)))
        return actions


class _RangeRemap(PhraseTransform):
    """Remap positions into a target band [target_lo, target_hi].

    Unifies the old Normalize Range + Clamp Upper/Lower Half — all three are
    linear range remaps that differ only in the SOURCE span:

    - ``fit_to_content`` True  → source is the phrase's actual min..max, so
      the existing motion is *stretched* to fill the band (the old
      Normalize: expand/amplify narrow content).
    - ``fit_to_content`` False → source is the nominal 0..100, so the full
      scale is *compressed* into the band (the old Clamp: e.g. [50,100] =
      upper half, [0,50] = lower half).

    When content already spans 0..100 the two modes coincide.
    """
    def _transform(self, actions, p):
        if not actions:
            return actions
        lo = p["target_lo"]
        hi = p["target_hi"]
        if bool(p.get("fit_to_content", True)):
            s_lo = min(a["pos"] for a in actions)
            s_hi = max(a["pos"] for a in actions)
        else:
            s_lo, s_hi = 0, 100
        src_span = s_hi - s_lo
        if src_span == 0:
            return actions
        tgt_span = hi - lo
        for a in actions:
            a["pos"] = max(0, min(100, int(lo + (a["pos"] - s_lo) / src_span * tgt_span)))
        return actions


class _Invert(PhraseTransform):
    """Mirror positions around 50 (pos = 100 - pos)."""
    def _transform(self, actions, p):
        for a in actions:
            a["pos"] = 100 - a["pos"]
        return actions


class _BoostEnds(PhraseTransform):
    """Push positions toward the extremes (0 or 100), increasing contrast."""
    def _transform(self, actions, p):
        strength = p["strength"]   # 0.0 = no change, 1.0 = full push to 0/100
        for a in actions:
            pos = a["pos"] / 100.0
            # Sigmoid-like push: values > 0.5 go toward 1, values < 0.5 go toward 0
            if pos >= 0.5:
                pushed = 0.5 + (pos - 0.5) * (1.0 + strength)
            else:
                pushed = 0.5 - (0.5 - pos) * (1.0 + strength)
            a["pos"] = max(0, min(100, int(pushed * 100)))
        return actions


class _Shift(PhraseTransform):
    """Translate all positions by a fixed offset, clamping to 0–100.

    Amplitude span is preserved unless the shifted range hits a boundary.
    Use a positive offset to shift motion upward (more intense), negative
    to shift downward (gentler).
    """
    def _transform(self, actions, p):
        offset = p["offset"]
        for a in actions:
            a["pos"] = max(0, min(100, int(a["pos"] + offset)))
        return actions


class _Recenter(PhraseTransform):
    """Shift all positions so that the phrase midpoint lands at *target_center*.

    The midpoint is computed as (min + max) / 2 of the phrase.  All positions
    are translated by the same amount so the amplitude span is unchanged,
    clamped to 0–100 if the shifted range would exceed the boundaries.
    """
    def _transform(self, actions, p):
        if not actions:
            return actions
        target = p["target_center"]
        lo = min(a["pos"] for a in actions)
        hi = max(a["pos"] for a in actions)
        current_center = (lo + hi) / 2.0
        offset = target - current_center
        for a in actions:
            a["pos"] = max(0, min(100, int(round(a["pos"] + offset))))
        return actions


def _lerp_pos(actions: list, at_ms: int) -> float:
    """Linear-interpolate the original pos at an arbitrary timestamp."""
    if not actions:
        return 50.0
    if at_ms <= actions[0]["at"]:
        return float(actions[0]["pos"])
    if at_ms >= actions[-1]["at"]:
        return float(actions[-1]["pos"])
    for i in range(len(actions) - 1):
        a, b = actions[i], actions[i + 1]
        if a["at"] <= at_ms <= b["at"]:
            if b["at"] == a["at"]:
                return float(a["pos"])
            t = (at_ms - a["at"]) / (b["at"] - a["at"])
            return a["pos"] + t * (b["pos"] - a["pos"])
    return float(actions[-1]["pos"])


class _Waiting(PhraseTransform):
    """Replace a phrase with a slow oscillating stroke, optionally blended with the original.

    BPM is the output cycle rate (one complete up+down = 1 cycle).
    Waypoints are placed at each half-stroke boundary; the phrase always ends
    at an interpolated position continuing the oscillation.
    """

    def _transform(self, actions, p):
        if not actions:
            return actions
        start_ms  = actions[0]["at"]
        end_ms    = actions[-1]["at"]
        start_pos = int(p["start_pos"])
        end_pos   = int(p["end_pos"])
        bpm       = max(1e-6, float(p["bpm"]))
        influence = float(p["influence"]) / 100.0

        half_ms = 60_000 / (bpm * 2)

        waypoints: List[tuple] = []
        half = 0
        while True:
            at_ms = start_ms + int(half * half_ms)
            if at_ms > end_ms:
                break
            lin_pos = float(start_pos if half % 2 == 0 else end_pos)
            waypoints.append((at_ms, lin_pos))
            half += 1

        if not waypoints or waypoints[-1][0] < end_ms:
            if waypoints:
                last_at, last_pos = waypoints[-1]
                last_half = len(waypoints) - 1
                next_at   = start_ms + int((last_half + 1) * half_ms)
                next_pos  = float(start_pos if (last_half + 1) % 2 == 0 else end_pos)
                seg_dur   = next_at - last_at
                frac      = (end_ms - last_at) / seg_dur if seg_dur > 0 else 1.0
                end_lin   = last_pos + frac * (next_pos - last_pos)
            else:
                end_lin = float(start_pos)
            waypoints.append((end_ms, end_lin))

        result = []
        for at, lin_pos in waypoints:
            orig_pos = _lerp_pos(actions, at) if influence > 0 else lin_pos
            pos = lin_pos * (1.0 - influence) + orig_pos * influence
            result.append({"at": at, "pos": max(0, min(100, round(pos)))})
        return result


class _Break(PhraseTransform):
    """Amplitude reduction toward centre followed by smoothing — for rest/break sections.

    Mirrors the ``TASK 3 BREAK MODE`` from ``six_task_transformer.py``:

    1. **Amplitude reduce** — each position is pulled toward 50 (the centre)
       by ``reduce`` fraction:
       ``new_pos = pos + (50 - pos) * reduce``
       Equivalent to ``amplitude_scale`` with ``scale = 1 - reduce``, but
       expressed as a fractional pull toward centre so the default (0.40)
       reads naturally as "reduce to 60% of full stroke".

    2. **LPF smoothing** — a low-pass filter (``lpf_strength``) is applied
       after the amplitude step to soften any remaining rapid movements.

    Default values match the original ``BREAK_AMPLITUDE_REDUCE = 0.40`` and
    ``LPF_BREAK = 0.30`` constants.
    """

    def _transform(self, actions, p):
        reduce      = p["reduce"]
        lpf_strength = p["lpf_strength"]

        # Pass 1: pull positions toward centre (50)
        for a in actions:
            a["pos"] = int(a["pos"] + (50 - a["pos"]) * reduce)

        # Pass 2: LPF smoothing
        if lpf_strength > 0.0:
            positions = [a["pos"] for a in actions]
            smoothed  = low_pass_filter(positions, [lpf_strength] * len(positions))
            for a, pos in zip(actions, smoothed):
                a["pos"] = int(pos)

        return actions


class _Performance(PhraseTransform):
    """Velocity-capped, reversal-softened stroke shaping for intense phrases.

    Applies three successive passes (all positional — timestamps unchanged):

    1. **Velocity cap** — if the position change per millisecond between
       consecutive actions exceeds ``max_velocity``, the target position is
       pulled back toward the previous position so the cap is just met.

    2. **Reversal softening** — at each direction change (sign flip in the
       per-action velocity), the new position is blended:
       ``softened = prev + Δ × (1 − reversal_soften)``
       then further blended toward the original target:
       ``blended = softened × (1 − height_blend) + target × height_blend``
       This rounds off the hard edges at stroke reversals.

    3. **Range compress + LPF** — positions are clamped to
       ``[range_lo, range_hi]`` and a light low-pass filter (``lpf_strength``)
       is applied to smooth any remaining jitter.

    Default values match the ``TASK 2 PERFORMANCE MODE`` settings from the
    original ``six_task_transformer.py``.
    """

    def _transform(self, actions, p):
        if len(actions) < 3:
            return actions

        max_vel      = p["max_velocity"]
        rev_soften   = p["reversal_soften"]
        height_blend = p["height_blend"]
        range_lo     = p["range_lo"]
        range_hi     = p["range_hi"]
        lpf_strength = p["lpf_strength"]

        # --- Pass 1: velocity cap ---
        for i in range(1, len(actions)):
            p0 = actions[i - 1]["pos"]
            p1 = actions[i]["pos"]
            t0 = actions[i - 1]["at"]
            t1 = actions[i]["at"]
            dt = max(1, t1 - t0)
            vel = (p1 - p0) / dt
            if abs(vel) > max_vel:
                capped = p0 + math.copysign(max_vel * dt, vel)
                actions[i]["pos"] = max(range_lo, min(range_hi, int(capped)))

        # --- Pass 2: reversal softening ---
        for i in range(2, len(actions)):
            p_prev2 = actions[i - 2]["pos"]
            p_prev  = actions[i - 1]["pos"]
            p_curr  = actions[i]["pos"]
            dir1 = p_prev - p_prev2
            dir2 = p_curr - p_prev
            if dir1 * dir2 < 0:  # direction change
                softened = p_prev + dir2 * (1.0 - rev_soften)
                blended  = softened * (1.0 - height_blend) + p_curr * height_blend
                blended  = max(range_lo, min(range_hi, blended))
                actions[i]["pos"] = int(blended)

        # --- Pass 3: range compress + LPF ---
        for a in actions:
            a["pos"] = max(range_lo, min(range_hi, a["pos"]))

        if lpf_strength > 0.0:
            positions = [a["pos"] for a in actions]
            smoothed  = low_pass_filter(positions, [lpf_strength] * len(positions))
            for a, pos in zip(actions, smoothed):
                a["pos"] = max(range_lo, min(range_hi, int(pos)))

        return actions


class _ThreeOne(PhraseTransform):
    """Three strokes then one flat hold, repeating across the phrase.

    Groups detected beats (extrema) into blocks of four:
    - Beats 1–3: strokes, amplitude-scaled around the group's centre.
    - Beat 4: flat hold — every action in that time window is set to
              the group's centre position (midpoint of min/max).

    The centre is recalculated per 4-beat group so it tracks local
    signal changes rather than the global phrase midpoint.  A partial
    last group (fewer than 4 remaining beats) is left unchanged.

    Optional ``range_lo`` / ``range_hi`` caps hard-limit the output
    positions after scaling; the centre itself is also clamped.
    """

    def _transform(self, actions, p):
        if len(actions) < 4:
            return actions

        amp_scale = p["amplitude_scale"]
        range_lo  = p["range_lo"]
        range_hi  = p["range_hi"]

        extrema_idx = _find_extrema(actions, min_prominence=10)
        n_ext = len(extrema_idx)

        i = 0  # index into extrema_idx for the current group's first beat
        while i + 3 < n_ext:
            # Centre of this 4-beat group
            group_pos = [actions[extrema_idx[i + k]]["pos"] for k in range(4)]
            lo = min(group_pos)
            hi = max(group_pos)
            center = (lo + hi) / 2.0
            center_int = max(range_lo, min(range_hi, int(round(center))))

            for beat_num in range(4):
                beat_idx = i + beat_num
                a_start = extrema_idx[beat_idx]
                a_end = (extrema_idx[beat_idx + 1]
                         if beat_idx + 1 < n_ext else len(actions))

                if beat_num < 3:
                    # Amplitude-scale strokes around the group centre
                    for k in range(a_start, a_end):
                        orig = actions[k]["pos"]
                        new_pos = center + (orig - center) * amp_scale
                        actions[k]["pos"] = max(range_lo, min(range_hi,
                                                               int(round(new_pos))))
                else:
                    # Flat hold at centre for the 4th beat
                    for k in range(a_start, a_end):
                        actions[k]["pos"] = center_int

            i += 4

        # Final pass: apply range cap to ALL actions (including partial groups)
        if range_lo > 0 or range_hi < 100:
            for a in actions:
                a["pos"] = max(range_lo, min(range_hi, a["pos"]))

        return actions


# ------------------------------------------------------------------
# Helpers for structural transforms
# ------------------------------------------------------------------

def _find_extrema(actions: list, min_prominence: int = 10) -> list:
    """Return indices of local peaks and troughs in *actions*.

    Always includes index 0 and len(actions)-1 so phrase boundaries are
    preserved.  A point qualifies only if it differs from both neighbours
    by at least *min_prominence* (filters noise).
    """
    n = len(actions)
    if n < 3:
        return list(range(n))

    indices = [0]
    for i in range(1, n - 1):
        prev_pos = actions[i - 1]["pos"]
        curr_pos = actions[i]["pos"]
        next_pos = actions[i + 1]["pos"]
        is_peak   = curr_pos >= prev_pos and curr_pos >= next_pos
        is_trough = curr_pos <= prev_pos and curr_pos <= next_pos
        if is_peak or is_trough:
            prominence = min(abs(curr_pos - prev_pos), abs(curr_pos - next_pos))
            if prominence >= min_prominence:
                # Skip flat plateaux: don't add if same pos as previous extremum
                if actions[indices[-1]]["pos"] != curr_pos:
                    indices.append(i)
    if indices[-1] != n - 1:
        indices.append(n - 1)
    return indices


class _BlendSeams(PhraseTransform):
    """Smooth sharp transitions where adjacent phrase transforms create abrupt jumps.

    Computes local velocity (|Δpos / Δt| in pos/ms) between consecutive actions.
    Actions near high-velocity jumps receive a stronger LPF blend; low-velocity
    regions are left almost unchanged.  Smoothing concentrates automatically at
    the seams between differently-styled sections without disturbing normal strokes.

    Uses a **bilateral** (forward + backward) LPF so the seam is softened
    symmetrically — approaching actions are blended, not just departing ones.

    When applied via the ``finalize`` command to the full action list, it catches
    both intra-phrase spikes and inter-phrase boundary jumps.  When applied
    phrase-by-phrase via ``phrase-transform --all`` it softens internal spikes only.
    """

    def _transform(self, actions, p):
        if len(actions) < 2:
            return actions

        max_vel      = p["max_velocity"]
        max_strength = p["max_strength"]

        # Velocity at each action (transition INTO this action from the previous one)
        velocities = [0.0]
        for i in range(1, len(actions)):
            dt = max(1, actions[i]["at"] - actions[i - 1]["at"])
            dp = abs(actions[i]["pos"] - actions[i - 1]["pos"])
            velocities.append(dp / dt)
        velocities[0] = velocities[1] if len(actions) > 1 else 0.0

        # Per-action blend strength: proportional to how far velocity exceeds threshold
        strengths = [
            min(1.0, v / max_vel) * max_strength if max_vel > 0 else 0.0
            for v in velocities
        ]

        # Bilateral LPF: average forward and backward passes for symmetric blending
        positions = [a["pos"] for a in actions]
        fwd = low_pass_filter(positions, strengths)
        rev_pos = list(reversed(positions))
        rev_str = list(reversed(strengths))
        bwd = list(reversed(low_pass_filter(rev_pos, rev_str)))
        smoothed = [int((f + b) / 2.0) for f, b in zip(fwd, bwd)]

        for a, pos in zip(actions, smoothed):
            a["pos"] = pos
        return actions


class _BeatAccent(PhraseTransform):
    """Boost positions away from centre at regular beat intervals.

    Detects the funscript's own stroke reversals (extrema) as beats, then
    accents every Nth one — pushing peaks up and troughs down by
    ``accent_amount`` position units.  Any action within ``radius_ms`` of
    an accented beat time receives the same boost.

    Parameters
    ----------
    every_nth : int
        Stride through the detected beat list.  1 = every beat,
        2 = every other, 4 = every 4th, 8 = every 8th, etc.
    accent_amount : int
        How many position units to push away from centre (≥50 → up, <50 → down).
        Matches ``BEAT_ACCENT_AMOUNT = 4`` from *six_task_transformer.py*.
    radius_ms : int
        Time window (±ms) around each accented beat.  Actions within this
        window all receive the boost.  Matches ``BEAT_ACCENT_RADIUS_MS = 40``.
    start_at_ms : int
        Absolute timestamp (ms) of the beat to treat as beat 0.
        0 = use the first detected extremum in the phrase.
        In the UI, hover over the desired first beat and enter its timestamp here.
    max_accents : int
        Maximum number of beats to accent.  0 = no limit (accent until
        the phrase ends).
    """

    def _transform(self, actions, p):
        if not actions:
            return actions

        every_nth    = max(1, int(p["every_nth"]))
        accent_amt   = int(p["accent_amount"])
        radius_ms    = int(p["radius_ms"])
        start_at_ms  = int(p["start_at_ms"])
        max_accents  = int(p["max_accents"])

        # --- detect beats (extrema) ---
        extrema_idx  = _find_extrema(actions, min_prominence=5)
        beat_times   = [actions[i]["at"] for i in extrema_idx]

        if not beat_times:
            return actions

        # --- find starting beat ---
        if start_at_ms > 0:
            # Nearest extremum at or after start_at_ms
            start_beat = next(
                (j for j, bt in enumerate(beat_times) if bt >= start_at_ms), 0
            )
        else:
            start_beat = 0

        # --- collect accented beat times ---
        accented = []
        j = start_beat
        while j < len(beat_times):
            accented.append(beat_times[j])
            j += every_nth
            if max_accents > 0 and len(accented) >= max_accents:
                break

        if not accented:
            return actions

        # --- apply boost to actions near each accented beat ---
        for a in actions:
            t = a["at"]
            if any(abs(t - bt) <= radius_ms for bt in accented):
                pos = a["pos"]
                boost = accent_amt if pos >= 50 else -accent_amt
                a["pos"] = max(0, min(100, pos + boost))

        return actions


class _HeroBeat(PhraseTransform):
    """8-step groove sequencer over the funscript's OWN beats.

    Detects stroke reversals (extrema) as beats, assigns each to one of eight
    repeating steps, and scales that beat's stroke DEPTH (distance from the
    midpoint 50) by the step's emphasis percent:

        100 = full depth (kept)   ·   0 = flat to centre   ·   50 = half depth

    Set the hero beats to 100 and the rest lower to carve a groove out of an
    even wall of strokes (your "wall of red, 100% emphasised, smaller for
    deemphasised"). All-100 (the default) is identity, so simply selecting
    the transform changes nothing until you pull steps down.

    Self-contained by design: it sequences the script's own reversals, not an
    external beat grid — editing uses the beats a script already has
    (generation is where you align to the music). v1 "shape existing": it
    scales existing strokes; it does not synthesise new ones.

    Each action is scaled by the emphasis of the nearest beat in time, so a
    whole stroke shrinks or stays with its beat. Depth scales around 50 (like
    Amplitude Scale), so peaks and troughs both ease toward centre as their
    step's emphasis drops.
    """

    def _transform(self, actions, p):
        if len(actions) < 2:
            return actions

        steps = [
            max(0.0, min(1.0, float(p.get(f"beat{i}", 100)) / 100.0))
            for i in range(1, 9)
        ]
        if all(s == 1.0 for s in steps):
            return actions  # identity — nothing pulled down

        extrema_idx = _find_extrema(actions, min_prominence=5)
        beat_times = [actions[i]["at"] for i in extrema_idx]
        if len(beat_times) < 1:
            return actions

        import bisect
        for a in actions:
            t = a["at"]
            # Nearest beat (in time) owns this action.
            j = bisect.bisect_left(beat_times, t)
            if j <= 0:
                nb = 0
            elif j >= len(beat_times):
                nb = len(beat_times) - 1
            else:
                nb = j if (beat_times[j] - t) < (t - beat_times[j - 1]) else j - 1
            scale = steps[nb % 8]
            a["pos"] = max(0, min(100, int(round(50 + (a["pos"] - 50) * scale))))

        return actions


class _HalveTempo(PhraseTransform):
    """Halve the BPM by keeping every other stroke cycle.

    Algorithm:
    1. Detect local extrema (peaks / troughs).
    2. Group as stroke pairs (beat-up + beat-down).
    3. Keep every other pair, discard interleaved pairs.
    4. Retime kept points evenly across the original phrase duration.
    5. Optionally scale amplitude around midpoint (50).

    Result: same phrase duration, same amplitude, ~half the BPM.
    This is a *structural* transform — it returns fewer actions with
    different timestamps, so callers must replace the phrase slice.
    """

    def _transform(self, actions, p):
        if len(actions) < 4:
            return actions  # too short to halve

        amp_scale = p["amplitude_scale"]
        extrema_idx = _find_extrema(actions, min_prominence=10)
        extrema = [(actions[i]["at"], actions[i]["pos"]) for i in extrema_idx]

        # Keep every other pair: keep [0,1], skip [2,3], keep [4,5], …
        kept = []
        i = 0
        while i < len(extrema):
            kept.append(extrema[i])
            if i + 1 < len(extrema):
                kept.append(extrema[i + 1])
            i += 4  # stride 4 = keep pair, skip pair

        # Always preserve last extremum so phrase ends at the right position
        if kept[-1] != extrema[-1]:
            kept.append(extrema[-1])

        if len(kept) < 2:
            return actions

        # Retime evenly across original phrase duration
        t_start  = actions[0]["at"]
        t_end    = actions[-1]["at"]
        duration = t_end - t_start
        n = len(kept)

        new_actions = []
        for j, (_, pos) in enumerate(kept):
            new_at = t_start + round(j / (n - 1) * duration) if n > 1 else t_start
            if amp_scale != 1.0:
                centered = pos - 50
                pos = max(0, min(100, int(50 + centered * amp_scale)))
            new_actions.append({"at": int(new_at), "pos": pos})

        return new_actions


class _Tame(PhraseTransform):
    """Device-aware softening — humanize a too-relentless section.

    One stage, one slider: **Groove (humanize).** Adds velocity variation to
    monotone sections via `forge.device_specs.apply_humanize` (target
    CV = groove), so a wall of uniform fast strokes reads as device-aware
    and less relentless WITHOUT dropping a single beat or reshaping
    amplitude. `apply_humanize` preserves beat count and position values and
    only nudges cycle timing in low-variance windows.

    History: Tame once also had a Max-BPM "cycle-drop" stage that capped
    stroke rate by *dropping* actions. That was removed 2026-06-01 — the
    runaway BPM that motivated it was a metric bug (since fixed), and
    dropping strokes kills the beat, which is never what you want. To
    *reduce intensity* (not just soften feel) the right move is to CENTER
    amplitude toward 50, which the recenter / amplitude-reduce transforms
    already do with every beat intact. So Tame is purely the groove pass.

    Non-structural — preserves count + amplitude, only shifts timing.
    """

    def _transform(self, actions, p):
        if len(actions) < 2:
            return actions
        groove = float(p.get("groove", 0.2))
        if groove <= 0:
            return actions
        # Lazy import to avoid load-order coupling with forge.device_specs
        # (mirrors apply_device_awareness's inline imports).
        from forge.device_specs import apply_humanize
        out, _ = apply_humanize(actions, target_cv=groove)
        return out


# ------------------------------------------------------------------
# Replacement transforms
# ------------------------------------------------------------------


@dataclass
class _Stroke(PhraseTransform):
    """Replace a phrase with a regular oscillating stroke at a set BPM.

    Oscillates 0 ↔ 100, centered at 50.  No influence — pure replacement.
    """
    def _transform(self, actions: list, p: dict) -> list:
        if not actions:
            return actions
        start_ms = actions[0]["at"]
        end_ms   = actions[-1]["at"]
        bpm      = min(100.0, max(10.0, float(p["bpm"])))
        half_ms  = 60_000 / (bpm * 2)

        waypoints: list = []
        half = 0
        while True:
            at_ms = start_ms + int(half * half_ms)
            if at_ms > end_ms:
                break
            waypoints.append((at_ms, 0 if half % 2 == 0 else 100))
            half += 1

        if not waypoints or waypoints[-1][0] < end_ms:
            if waypoints:
                last_at, last_pos = waypoints[-1]
                last_half = len(waypoints) - 1
                next_at  = start_ms + int((last_half + 1) * half_ms)
                next_pos = 0 if (last_half + 1) % 2 == 0 else 100
                seg_dur  = next_at - last_at
                frac     = (end_ms - last_at) / seg_dur if seg_dur > 0 else 1.0
                end_pos  = int(last_pos + frac * (next_pos - last_pos))
            else:
                end_pos = 0
            waypoints.append((end_ms, end_pos))

        return [{"at": at, "pos": max(0, min(100, pos))} for at, pos in waypoints]


@dataclass
class _Drift(PhraseTransform):
    """High plateau with small fast oscillations and one slow dip.

    Structure:
      1. Regular small oscillations: center ± wobble at wobble_bpm (~80 BPM)
      2. One dip event: slow descent to dip_to, then slow recovery back to center
    """
    def _transform(self, actions: list, p: dict) -> list:
        if not actions:
            return actions
        start_ms       = actions[0]["at"]
        end_ms         = actions[-1]["at"]
        duration       = end_ms - start_ms

        center         = int(p["center"])
        wobble         = int(p["wobble"])
        wobble_bpm     = max(1.0, float(p["wobble_bpm"]))
        dip_to         = int(p["dip_to"])
        dip_timing     = float(p["dip_timing"])
        dip_duration   = float(p["dip_duration"]) * 1000  # s → ms

        half_ms   = 60_000 / (wobble_bpm * 2)
        dip_start = start_ms + int(dip_timing * duration)
        dip_mid   = dip_start + int(dip_duration * 0.4)
        dip_end   = dip_start + int(dip_duration)

        def _dip_envelope(at_ms: int, base: float) -> float:
            if at_ms < dip_start or at_ms > dip_end:
                return base
            if at_ms <= dip_mid:
                seg = dip_mid - dip_start
                t   = (at_ms - dip_start) / seg if seg > 0 else 1.0
                return base + t * (dip_to - base)
            else:
                seg = dip_end - dip_mid
                t   = (at_ms - dip_mid) / seg if seg > 0 else 1.0
                return dip_to + t * (base - dip_to)

        result = []
        half = 0
        while True:
            at_ms = start_ms + int(half * half_ms)
            if at_ms > end_ms:
                break
            base_pos = float(center if half % 2 == 0 else center - wobble)
            pos = _dip_envelope(at_ms, base_pos)
            result.append({"at": at_ms, "pos": max(0, min(100, round(pos)))})
            half += 1

        if not result or result[-1]["at"] < end_ms:
            pos = _dip_envelope(end_ms, float(center))
            result.append({"at": end_ms, "pos": max(0, min(100, round(pos)))})

        return result


@dataclass
class _Tide(PhraseTransform):
    """Fast oscillations riding a slow sine-wave center.

    The fast stroke BPM alternates between center(t) and center(t)+span.
    The center follows a cosine wave from center_high down to center_low
    and back over wave_period seconds — like a tide.
    """
    def _transform(self, actions: list, p: dict) -> list:
        if not actions:
            return actions
        start_ms    = actions[0]["at"]
        end_ms      = actions[-1]["at"]

        center_high = int(p["center_high"])
        center_low  = int(p["center_low"])
        span        = int(p["span"])
        bpm         = min(300.0, max(10.0, float(p["bpm"])))
        wave_period = max(1.0, float(p["wave_period"])) * 1000  # s → ms

        half_ms = 60_000 / (bpm * 2)

        def _center_at(at_ms: int) -> float:
            t = (at_ms - start_ms) / wave_period
            return center_low + (center_high - center_low) * (1 + math.cos(2 * math.pi * t)) / 2

        result = []
        half = 0
        while True:
            at_ms = start_ms + int(half * half_ms)
            if at_ms > end_ms:
                break
            c   = _center_at(at_ms)
            pos = c if half % 2 == 0 else c + span
            result.append({"at": at_ms, "pos": max(0, min(100, round(pos)))})
            half += 1

        if not result or result[-1]["at"] < end_ms:
            c   = _center_at(end_ms)
            pos = c + (span if (len(result) % 2 == 1) else 0)
            result.append({"at": end_ms, "pos": max(0, min(100, round(pos)))})

        return result


class _Ramp(PhraseTransform):
    """Funnel-shaped energy ramp: progressive center shift + amplitude scaling.

    Each action is re-expressed around a linearly interpolated center that
    travels from ``start_center`` to ``end_center`` across the phrase.
    At the same time, the distance from the center is scaled linearly from
    ``start_scale`` to ``end_scale``, creating a funnel shape.

    Ramp up (small → large): start_scale < end_scale, start_center < end_center
    Ramp down (large → small): start_scale > end_scale, start_center > end_center

    If the phrase already has apparent motion the funnel exaggerates it;
    if motion is minimal a visible increasing/decreasing oscillation is produced.
    """

    def _transform(self, actions: list, p: dict) -> list:
        if not actions:
            return actions

        start_center = float(p.get("start_center", 30))
        end_center   = float(p.get("end_center",   70))
        start_scale  = float(p.get("start_scale",  0.2))
        end_scale    = float(p.get("end_scale",    1.0))

        start_ms = actions[0]["at"]
        end_ms   = actions[-1]["at"]
        total_ms = max(1, end_ms - start_ms)

        # Current phrase center (mean position)
        positions      = [a["pos"] for a in actions]
        current_center = sum(positions) / len(positions)

        result = []
        for a in actions:
            frac   = (a["at"] - start_ms) / total_ms
            target = start_center + (end_center  - start_center) * frac
            scale  = start_scale  + (end_scale   - start_scale)  * frac
            # Re-express position around the interpolated center at this scale
            deviation = (a["pos"] - current_center) * scale
            pos = max(0, min(100, round(target + deviation)))
            result.append({"at": a["at"], "pos": pos})

        return result


class _Nudge(PhraseTransform):
    """Advance (or delay) a phrase in time to sync with video or audio.

    Shifts every action timestamp forward by ``nudge_ms`` milliseconds.
    The phrase window (start / end) is preserved:

    * **Gap fill** — the leading gap created by a positive nudge is bridged
      with a linear interpolation from the phrase's original start position
      to the first shifted action.  This keeps the seam smooth without
      requiring a separate blend step.
    * **Tail truncation** — any shifted actions that fall past the original
      phrase end are dropped.  The phrase boundary does not grow.

    A negative ``nudge_ms`` shifts the phrase earlier: the first action
    is pulled back (clamped to the phrase start if it would go before it),
    and the trailing gap is filled with a hold at the last action's position.

    ``transition_ms`` controls how long the gap-fill interpolation runs.
    Set it to 0 to use a hard cut instead of a linear blend.
    """

    def _transform(self, actions: list, p: dict) -> list:
        if not actions:
            return actions

        nudge_ms      = int(p.get("nudge_ms", 0))
        transition_ms = int(p.get("transition_ms", 0))

        if nudge_ms == 0:
            return actions

        phrase_start = actions[0]["at"]
        phrase_end   = actions[-1]["at"]

        if nudge_ms > 0:
            # ── Shift forward ─────────────────────────────────────────────
            # 1. Shift all timestamps
            shifted = [{"at": a["at"] + nudge_ms, "pos": a["pos"]} for a in actions]

            # 2. Drop anything past the original phrase end
            shifted = [a for a in shifted if a["at"] <= phrase_end]

            if not shifted:
                # Entire phrase shifted out of window — return passthrough
                return actions

            # 3. Build gap-fill transition from phrase_start to first shifted action
            gap_end_ms  = shifted[0]["at"]
            start_pos   = actions[0]["pos"]          # position before the nudge
            first_pos   = shifted[0]["pos"]

            fill: list = []
            if transition_ms > 0 and gap_end_ms > phrase_start:
                # Linear interpolation anchor at phrase_start
                fill.append({"at": phrase_start, "pos": start_pos})
                # Mid-point of transition if there is room
                blend_end = min(phrase_start + transition_ms, gap_end_ms)
                if blend_end < gap_end_ms:
                    t = (blend_end - phrase_start) / max(1, gap_end_ms - phrase_start)
                    mid_pos = int(round(start_pos + t * (first_pos - start_pos)))
                    fill.append({"at": blend_end, "pos": mid_pos})
            else:
                # Hard cut: hold start_pos then jump
                if phrase_start < gap_end_ms:
                    fill.append({"at": phrase_start, "pos": start_pos})
                    fill.append({"at": gap_end_ms - 1, "pos": start_pos})

            return fill + shifted

        else:
            # ── Shift backward ────────────────────────────────────────────
            nudge_abs = abs(nudge_ms)

            # 1. Shift timestamps back, clamp first action to phrase_start
            shifted = []
            for a in actions:
                new_at = max(phrase_start, a["at"] - nudge_abs)
                shifted.append({"at": new_at, "pos": a["pos"]})

            # 2. De-duplicate timestamps (clamp can cause collisions)
            seen: set = set()
            deduped = []
            for a in shifted:
                if a["at"] not in seen:
                    deduped.append(a)
                    seen.add(a["at"])
            shifted = deduped

            # 3. Fill tail: hold last action's position to original phrase end
            last = shifted[-1]
            if last["at"] < phrase_end:
                shifted.append({"at": phrase_end, "pos": last["pos"]})

            return shifted


# ------------------------------------------------------------------
# Tone transforms — same logic as Tone tab, applied per-phrase
# ------------------------------------------------------------------

class _ToneTransform(PhraseTransform):
    """Apply a tone shape to a phrase. Uses the same preview logic as the
    global Tone tab but scoped to the phrase actions."""

    _tone_name: str = ""

    def _transform(self, actions: list, p: dict) -> list:
        import numpy as np

        positions = [a["pos"] for a in actions]
        pos = np.array(positions, dtype=float)
        n = len(pos)
        if n < 2:
            return actions
        t_norm = np.linspace(0, 1, n)
        center = 50.0

        # Impact blending
        impact = p.get("impact", 1.0)

        # Slider values in order (s1, s2, s3, s4)
        sv = [p.get(f"s{i}", 0.5) for i in range(1, 5)]
        s = lambda i: sv[i] if i < len(sv) else 0.5

        tone = self._tone_name
        original = pos.copy()

        if tone == "Tender":
            compression = 0.2 + 0.6 * (1.0 - s(0))
            pos = center + (pos - center) * compression
        elif tone == "Build":
            floor = s(1) * 0.5
            scale = floor + (1.0 - floor) * (t_norm ** (0.5 + s(0) * 1.5))
            arc_width = 0.7 + s(2) * 0.6
            pos = center + (pos - center) * scale * arc_width
        elif tone == "Tease":
            cycles = 2 + s(1) * 6
            depth = 0.2 + s(0) * 0.6
            envelope = (1.0 - depth) + depth * np.abs(np.sin(t_norm * np.pi * cycles))
            if s(2) > 0.1:
                noise = np.random.RandomState(42).uniform(-s(2) * 0.2, s(2) * 0.2, n)
                envelope = np.clip(envelope + noise, 0.1, 1.0)
            pos = center + (pos - center) * envelope
        elif tone == "Edge":
            envelope = np.ones(n) * (0.5 + s(0) * 0.5)
            drop_start = int(n * s(1))
            if drop_start < n:
                envelope[drop_start:] = np.linspace(
                    envelope[min(drop_start, n - 1)], 0.3, n - drop_start
                )
            pos = center + (pos - center) * envelope
        elif tone == "Climax":
            expansion = 1.0 + s(0) * 0.5
            urgency_env = 1.0 + s(1) * 0.2 * t_norm
            pos = center + (pos - center) * expansion * urgency_env
        elif tone == "Dominant":
            exponent = 1.0 - s(0) * 0.3
            width = 0.8 + s(1) * 0.6
            diff = pos - center
            pos = center + np.sign(diff) * np.abs(diff) ** exponent * width
            if s(2) > 0.3:
                min_level = s(2) * 30
                below = pos < (center - min_level)
                above = pos > (center + min_level)
                pos = np.where(below, np.maximum(pos, center - min_level), pos)
                pos = np.where(above, np.minimum(pos, center + min_level), pos)

        # Impact blending: output = original + impact * (toned - original)
        pos = original + impact * (pos - original)
        pos = np.clip(pos, 0, 100)

        for i, a in enumerate(actions):
            a["pos"] = int(round(pos[i]))
        return actions


def _make_tone_transform(tone_name: str, tone_data: dict) -> _ToneTransform:
    """Build a PhraseTransform for one tone with its slider params."""
    # Slider definitions from tone_tab._TONE_SLIDERS
    _TONE_SLIDER_DEFS = {
        "Tender": [("Softness", "s1", 0.7, "How much to compress the cycle range."),
                   ("Pulse onset", "s2", 0.3, "How gradually pulses rise.")],
        "Build": [("Build rate", "s1", 0.5, "How fast intensity ramps up."),
                  ("Starting intensity", "s2", 0.3, "Where the ramp begins."),
                  ("Arc width", "s3", 0.5, "How wide the sweep pattern is.")],
        "Tease": [("Retreat depth", "s1", 0.6, "How far intensity pulls back at peaks."),
                  ("Oscillation speed", "s2", 0.5, "How fast the rise-and-retreat cycles."),
                  ("Pulse variety", "s3", 0.5, "How much the pulse pattern varies.")],
        "Edge": [("Hold intensity", "s1", 0.7, "The sustained plateau level."),
                 ("Drop point", "s2", 0.85, "How late the intensity drops.")],
        "Climax": [("Peak intensity", "s1", 0.9, "How far to push the range."),
                   ("Urgency", "s2", 0.7, "How aggressive the pacing feels."),
                   ("Pulse sharpness", "s3", 0.6, "How sharp the pulse edges are."),
                   ("Frequency push", "s4", 0.8, "How high the pulse frequency goes.")],
        "Dominant": [("Drive", "s1", 0.8, "How assertive the device pace is."),
                     ("Sweep width", "s2", 0.7, "How wide the cycle range."),
                     ("Relentlessness", "s3", 0.7, "How little the intensity dips.")],
    }

    params: Dict[str, TransformParam] = {
        "impact": TransformParam(
            label="Impact", type="float", default=1.0,
            min_val=0.0, max_val=1.0, step=0.05,
            help="How much of the tone to apply (0 = no change, 1 = full tone).",
        ),
    }
    for label, key, default, help_text in _TONE_SLIDER_DEFS.get(tone_name, []):
        params[key] = TransformParam(
            label=label, type="float", default=default,
            min_val=0.0, max_val=1.0, step=0.05, help=help_text,
        )

    t = _ToneTransform(
        key=f"tone_{tone_name.lower()}",
        name=f"{tone_name}",
        description=tone_data.get("feel", ""),
        params=params,
        category="Tone",
    )
    t._tone_name = tone_name
    return t


# Tone data (subset of tone_tab._TONES — just what we need for transforms)
_TONE_DEFS = [
    {"name": "Tender", "feel": "Soft, slow, shallow strokes. Intimate and present."},
    {"name": "Build", "feel": "Intensity increases steadily. No release until the end."},
    {"name": "Tease", "feel": "Rises toward a peak then retreats. Reward withheld."},
    {"name": "Edge", "feel": "Sustained plateau. High intensity maintained, no release."},
    {"name": "Climax", "feel": "Maximum intensity, full range, urgent pacing."},
    {"name": "Dominant", "feel": "Fast, wide, assertive. The device takes charge."},
]

_TONE_TRANSFORMS = [_make_tone_transform(td["name"], td) for td in _TONE_DEFS]


# ------------------------------------------------------------------
# Catalog
# ------------------------------------------------------------------

TRANSFORM_CATALOG: Dict[str, PhraseTransform] = {
    t.key: t for t in [
        _Passthrough(
            key="passthrough",
            name="Passthrough",
            description="Keep original positions unchanged.",
        ),
        _AmplitudeScale(
            key="amplitude_scale",
            name="Amplitude Scale",
            description="Scale stroke depth around the midpoint — use >1 to amplify, <1 to reduce.",
            params={
                "scale": TransformParam(
                    label="Scale factor", type="float", default=2.0,
                    min_val=0.1, max_val=5.0, step=0.1,
                    help="1.0 = no change. 2.0 = double stroke depth.",
                ),
            },
        ),
        _RangeRemap(
            key="range",
            name="Range",
            description="Remap stroke positions into a target band [low, high]. Fit-to-content stretches the existing motion to fill the band (amplify); off compresses the full 0–100 scale into it (e.g. upper/lower half).",
            params={
                "fit_to_content": TransformParam(
                    label="Fit to content", type="bool", default=True,
                    help="On: stretch the phrase's actual range to fill the band (the old Normalize). Off: compress the full 0–100 scale into the band (the old Clamp Upper/Lower).",
                ),
                "target_lo": TransformParam(
                    label="Low", type="int", default=0,
                    min_val=0, max_val=100, step=5,
                    help="Bottom of the target band.",
                ),
                "target_hi": TransformParam(
                    label="High", type="int", default=100,
                    min_val=0, max_val=100, step=5,
                    help="Top of the target band.",
                ),
            },
        ),
        # Consolidated into `range` (2026-06-01). Kept as a hidden alias so
        # suggest_transform output + saved recipes still resolve.
        _Normalize(
            key="normalize",
            name="Normalize Range",
            description="Expand positions to fill a target range (default: full 0–100).",
            hidden=True,
            params={
                "target_lo": TransformParam(
                    label="Target low", type="int", default=0,
                    min_val=0, max_val=49, step=5,
                ),
                "target_hi": TransformParam(
                    label="Target high", type="int", default=100,
                    min_val=51, max_val=100, step=5,
                ),
            },
        ),
        _Smooth(
            key="smooth",
            name="Smooth",
            description="Apply a low-pass filter to reduce jitter and rapid micro-movements.",
            params={
                "strength": TransformParam(
                    label="Smoothing strength", type="float", default=0.15,
                    min_val=0.01, max_val=0.5, step=0.01,
                    help="Higher = more smoothing. 0.15 is a light touch.",
                ),
            },
        ),
        # clamp_upper / clamp_lower consolidated into `range` (fit_to_content
        # off, target band = [50,100] / [0,50]). Hidden aliases so recipes
        # still resolve.
        _ClampRange(
            key="clamp_upper",
            name="Clamp Upper Half",
            description="Compress positions into the upper half (50–100) — keeps motion in the intense zone.",
            hidden=True,
            params={
                "range_lo": TransformParam(label="Range low",  type="int", default=50, min_val=0,  max_val=60),
                "range_hi": TransformParam(label="Range high", type="int", default=100, min_val=70, max_val=100),
            },
        ),
        _ClampRange(
            key="clamp_lower",
            name="Clamp Lower Half",
            description="Compress positions into the lower half (0–50) — for gentler or break-style sections.",
            hidden=True,
            params={
                "range_lo": TransformParam(label="Range low",  type="int", default=0, min_val=0,  max_val=30),
                "range_hi": TransformParam(label="Range high", type="int", default=50, min_val=40, max_val=70),
            },
        ),
        _Invert(
            key="invert",
            name="Invert",
            description="Mirror positions around 50 — flips the stroke direction.",
        ),
        _BoostEnds(
            key="boost_contrast",
            name="Boost Contrast",
            description="Push positions toward 0 and 100 to increase the dynamic range.",
            params={
                "strength": TransformParam(
                    label="Strength", type="float", default=0.5,
                    min_val=0.1, max_val=2.0, step=0.1,
                    help="How hard positions are pushed toward the extremes.",
                ),
            },
        ),
        # Consolidated into `recenter` (2026-06-01) — both are pure
        # translations; recenter is the friendlier "land the midpoint here"
        # form. Hidden alias so recipes using a raw offset still resolve.
        _Shift(
            key="shift",
            name="Shift",
            description="Translate all positions by a fixed offset — moves the center up or down while keeping amplitude.",
            hidden=True,
            params={
                "offset": TransformParam(
                    label="Offset", type="int", default=0,
                    min_val=-50, max_val=50, step=5,
                    help="Positive = shift upward (more intense), negative = shift downward (gentler).",
                ),
            },
        ),
        _Recenter(
            key="recenter",
            name="Recenter",
            description="Move the whole phrase up or down so its midpoint lands at a target value — preserves amplitude span. (Use this to shift/lift motion; it replaces the separate Shift.)",
            params={
                "target_center": TransformParam(
                    label="Target center", type="int", default=50,
                    min_val=0, max_val=100, step=5,
                    help="Where the midpoint between the phrase's min and max should land (0–100).",
                ),
            },
        ),
        _Break(
            key="break",
            name="Break",
            description="Pull positions toward centre (reduce amplitude) then smooth — for rest or recovery sections.",
            params={
                "reduce": TransformParam(
                    label="Amplitude reduce", type="float", default=0.40,
                    min_val=0.0, max_val=1.0, step=0.05,
                    help="Fraction to pull each position toward centre 50. 0 = no change, 1 = collapse to 50.",
                ),
                "lpf_strength": TransformParam(
                    label="LPF strength", type="float", default=0.30,
                    min_val=0.0, max_val=0.5, step=0.01,
                    help="Low-pass filter strength applied after amplitude reduction. 0 = off.",
                ),
            },
        ),
        _Waiting(
            key="waiting",
            name="Waiting",
            description="Replace phrase with a slow oscillating stroke — default 1 cycle per minute.",
            structural=True,
            params={
                "start_pos": TransformParam(
                    label="Start position", type="int", default=100,
                    min_val=0, max_val=100, step=5,
                    help="Position at phrase start (100 = top).",
                ),
                "end_pos": TransformParam(
                    label="End position", type="int", default=0,
                    min_val=0, max_val=100, step=5,
                    help="Position at each stroke end (0 = bottom).",
                ),
                "bpm": TransformParam(
                    label="BPM", type="float", default=1.0,
                    min_val=0.0, max_val=5.0, step=0.1,
                    help="Complete up+down cycles per minute. 1.0 = one full stroke per minute.",
                ),
                "influence": TransformParam(
                    label="Original influence %", type="int", default=0,
                    min_val=0, max_val=100, step=5,
                    help="Blend original phrase into the stroke (0 = pure stroke, 20 = subtle shaping).",
                ),
            },
        ),
        _Performance(
            key="performance",
            name="Performance",
            description="Velocity-capped, reversal-softened strokes with range compression — smooths intense phrases for realistic device movement.",
            params={
                "max_velocity": TransformParam(
                    label="Max velocity (pos/ms)", type="float", default=0.32,
                    min_val=0.05, max_val=1.0, step=0.01,
                    help="Maximum position change per millisecond. Lower = slower, gentler movements.",
                ),
                "reversal_soften": TransformParam(
                    label="Reversal soften", type="float", default=0.62,
                    min_val=0.0, max_val=1.0, step=0.05,
                    help="How much to pull back at direction changes. 0 = no change, 1 = hold at reversal point.",
                ),
                "height_blend": TransformParam(
                    label="Height blend", type="float", default=0.75,
                    min_val=0.0, max_val=1.0, step=0.05,
                    help="After softening, blend back toward the original target position. 1.0 = full target.",
                ),
                "range_lo": TransformParam(
                    label="Range low", type="int", default=15,
                    min_val=0, max_val=40, step=5,
                    help="Minimum output position (hard floor).",
                ),
                "range_hi": TransformParam(
                    label="Range high", type="int", default=92,
                    min_val=60, max_val=100, step=5,
                    help="Maximum output position (hard ceiling).",
                ),
                "lpf_strength": TransformParam(
                    label="LPF strength", type="float", default=0.16,
                    min_val=0.0, max_val=0.5, step=0.01,
                    help="Low-pass filter strength applied after shaping. 0 = off.",
                ),
            },
        ),
        # Superseded by `hero_beat` (2026-06-01): a 3+1 pulse is just the
        # 8-step pattern [100,100,100,0,100,100,100,0]. Hidden so recipes
        # still resolve; dropped from the picker to trim the Behavior list.
        _ThreeOne(
            key="three_one",
            name="Three-One Pulse",
            hidden=True,
            description="Three strokes then one flat hold at the group centre, repeating — creates a 3+1 pulse pattern at the original beat timing.",
            params={
                "amplitude_scale": TransformParam(
                    label="Amplitude scale", type="float", default=1.0,
                    min_val=0.1, max_val=3.0, step=0.1,
                    help="Scale stroke depth around the group centre. 1.0 = unchanged.",
                ),
                "range_lo": TransformParam(
                    label="Range low", type="int", default=0,
                    min_val=0, max_val=49, step=5,
                    help="Hard minimum position after scaling.",
                ),
                "range_hi": TransformParam(
                    label="Range high", type="int", default=100,
                    min_val=51, max_val=100, step=5,
                    help="Hard maximum position after scaling.",
                ),
            },
        ),
        _BlendSeams(
            key="blend_seams",
            name="Blend Seams",
            description="Detect high-velocity transitions between differently-styled sections and smooth them — concentrates blending at seams, leaves normal strokes untouched.",
            params={
                "max_velocity": TransformParam(
                    label="Max velocity (pos/ms)", type="float", default=0.50,
                    min_val=0.05, max_val=2.0, step=0.05,
                    help="Velocity threshold above which full blending is applied. Lower = catch more transitions.",
                ),
                "max_strength": TransformParam(
                    label="Max blend strength", type="float", default=0.70,
                    min_val=0.0, max_val=1.0, step=0.05,
                    help="LPF strength applied at peak-velocity seams. 0 = off, 1 = maximum smoothing.",
                ),
            },
        ),
        # Same uniform LPF as `smooth`, just a lighter default — consolidated
        # into `smooth` (2026-06-01). Hidden alias so the `finalize` command
        # (which applies it as a global finishing pass) still resolves.
        _Smooth(
            key="final_smooth",
            name="Final Smooth",
            description="Light global LPF finishing pass — takes off residual harsh edges after all phrase transforms have been applied.",
            hidden=True,
            params={
                "strength": TransformParam(
                    label="Smoothing strength", type="float", default=0.10,
                    min_val=0.01, max_val=0.5, step=0.01,
                    help="0.10 is a very light pass (matches LPF_DEFAULT from six_task_transformer). Increase for more smoothing.",
                ),
            },
        ),
        _BeatAccent(
            key="beat_accent",
            name="Beat Accent",
            description="Boost positions away from centre at every Nth stroke reversal — adds rhythmic emphasis at regular beat intervals.",
            params={
                "every_nth": TransformParam(
                    label="Every Nth beat", type="int", default=1,
                    min_val=1, max_val=16, step=1,
                    help="1 = every beat, 2 = every other, 4 = every 4th, 8 = every 8th.",
                ),
                "accent_amount": TransformParam(
                    label="Accent amount", type="int", default=4,
                    min_val=1, max_val=30, step=1,
                    help="Position units to boost peaks up / troughs down. Matches BEAT_ACCENT_AMOUNT=4 from six_task_transformer.",
                ),
                "radius_ms": TransformParam(
                    label="Radius (ms)", type="int", default=40,
                    min_val=5, max_val=200, step=5,
                    help="Time window around each accented beat. Actions within ±radius_ms receive the boost.",
                ),
                "start_at_ms": TransformParam(
                    label="Start at (ms)", type="int", default=0,
                    min_val=0, max_val=9999999, step=1,
                    help="Absolute timestamp of beat 0. 0 = first detected stroke reversal in the phrase. In the UI, hover a beat to find its timestamp.",
                ),
                "max_accents": TransformParam(
                    label="Max accents", type="int", default=0,
                    min_val=0, max_val=999, step=1,
                    help="Stop after this many accented beats. 0 = no limit (accent until phrase ends).",
                ),
            },
        ),
        _HeroBeat(
            key="hero_beat",
            name="Hero Beat",
            description="8-step groove sequencer over the script's own beats. Each slider sets how much depth that beat keeps (100 = full, 0 = flat). Set the hero beats high and the rest lower to carve a groove out of an even wall of strokes. All-100 = no change.",
            params={
                f"beat{i}": TransformParam(
                    label=f"Beat {i}", type="int", default=100,
                    min_val=0, max_val=100, step=5,
                    help=(f"Emphasis for step {i} of the repeating 8-beat cycle. "
                          "100 = full depth (kept), 0 = flat to centre."),
                )
                for i in range(1, 9)
            },
        ),
        _HalveTempo(
            key="halve_tempo",
            name="Halve Tempo",
            description="Keep every other stroke cycle to halve the BPM over the same phrase duration.",
            structural=True,
            params={
                "amplitude_scale": TransformParam(
                    label="Amplitude scale", type="float", default=1.0,
                    min_val=0.1, max_val=3.0, step=0.1,
                    help="Scale stroke depth around 50 after tempo reduction. 1.0 = unchanged.",
                ),
            },
        ),
        _Tame(
            key="tame",
            name="Tame",
            description="Device-aware softening: humanizes a relentless wall of fast strokes so it feels less mechanical — every beat kept, amplitude untouched. To reduce intensity (not just feel), center amplitude with Recenter / Amplitude Scale instead.",
            structural=False,
            # Grouped under Tone (not Behavior) in the picker: Tame is the
            # one corrective tone, and it ships as a Tone card on the
            # Chapters tab — keep the category consistent across surfaces.
            category="tone",
            params={
                "groove": TransformParam(
                    label="Groove", type="float", default=0.2,
                    min_val=0.0, max_val=1.0, step=0.05,
                    help="Humanize strength — subtle velocity variation in monotone sections (needs ~60s+ to bite). 0 = off. 0.2 = gentle; 0.35 ≈ natural.",
                ),
            },
        ),
        # Timing / Sync
        _Nudge(
            key="nudge",
            name="Nudge",
            category="Timing",
            description="Advance or delay a phrase to sync with video or audio. Fills the leading gap with a transition and truncates the tail.",
            structural=True,
            params={
                "nudge_ms": TransformParam(
                    label="Nudge (ms)", type="int", default=0,
                    min_val=-2000, max_val=2000, step=10,
                    help="Milliseconds to shift the phrase. Positive = later (advance to match video). Negative = earlier.",
                ),
                "transition_ms": TransformParam(
                    label="Transition (ms)", type="int", default=100,
                    min_val=0, max_val=500, step=10,
                    help="Length of the gap-fill blend at the seam. 0 = hard cut.",
                ),
            },
        ),
        # Replacement
        _Stroke(
            key         = "stroke",
            name        = "Stroke",
            description = "Replace phrase with a regular oscillating stroke from 0 to 100, centered at 50.",
            structural  = True,
            category    = "Replacement",
            params      = {
                "bpm": TransformParam(
                    label   = "BPM",
                    type    = "float",
                    default = 60.0,
                    min_val = 10.0,
                    max_val = 100.0,
                    step    = 1.0,
                    help    = "Strokes per minute (complete up+down cycles). 100 BPM = practical device limit.",
                ),
            },
        ),
        _Drift(
            key         = "drift",
            name        = "Drift",
            description = "High plateau with small oscillations and one slow dip — mimics drift behavioral pattern.",
            structural  = True,
            category    = "Replacement",
            params      = {
                "center": TransformParam(
                    label="Plateau position", type="int", default=85,
                    min_val=50, max_val=100, step=5,
                    help="The resting high position (top of small oscillations).",
                ),
                "wobble": TransformParam(
                    label="Wobble depth", type="int", default=10,
                    min_val=0, max_val=30, step=5,
                    help="Amplitude of small oscillations below plateau (plateau - wobble = low point).",
                ),
                "wobble_bpm": TransformParam(
                    label="Wobble BPM", type="float", default=80.0,
                    min_val=20.0, max_val=150.0, step=5.0,
                    help="Rate of small oscillations in cycles per minute.",
                ),
                "dip_to": TransformParam(
                    label="Dip bottom", type="int", default=30,
                    min_val=0, max_val=70, step=5,
                    help="Lowest position reached during the dip.",
                ),
                "dip_timing": TransformParam(
                    label="Dip timing", type="float", default=0.2,
                    min_val=0.0, max_val=0.9, step=0.05,
                    help="When in the phrase the dip starts (0=start, 0.5=middle, 0.9=near end).",
                ),
                "dip_duration": TransformParam(
                    label="Dip duration (s)", type="float", default=4.0,
                    min_val=0.5, max_val=15.0, step=0.5,
                    help="Total time for the dip descent + recovery, in seconds.",
                ),
            },
        ),
        _Tide(
            key         = "tide",
            name        = "Tide",
            description = "Fast oscillations on a slow sine-wave center — center ebbs down and back over wave_period seconds.",
            structural  = True,
            category    = "Replacement",
            params      = {
                "center_high": TransformParam(
                    label="Center high", type="int", default=70,
                    min_val=20, max_val=90, step=5,
                    help="The center position at the top of the slow wave.",
                ),
                "center_low": TransformParam(
                    label="Center low", type="int", default=41,
                    min_val=0, max_val=80, step=5,
                    help="The center position at the bottom of the slow wave.",
                ),
                "span": TransformParam(
                    label="Stroke span", type="int", default=30,
                    min_val=5, max_val=60, step=5,
                    help="How far each fast stroke reaches above the current center.",
                ),
                "bpm": TransformParam(
                    label="BPM", type="float", default=252.0,
                    min_val=10.0, max_val=300.0, step=10.0,
                    help="Fast oscillation rate in cycles per minute.",
                ),
                "wave_period": TransformParam(
                    label="Wave period (s)", type="float", default=135.0,
                    min_val=10.0, max_val=600.0, step=5.0,
                    help="Seconds for one complete slow center cycle (down and back up).",
                ),
            },
        ),
        _Ramp(
            key         = "funnel",
            name        = "Funnel",
            description = "Funnel-shaped energy ramp — progressively shifts the center and scales stroke amplitude from start to end, creating a visually ordered ramp-up or ramp-down.",
            structural  = False,
            params      = {
                "start_center": TransformParam(
                    label   = "Start center",
                    type    = "int",
                    default = 30,
                    min_val = 0,
                    max_val = 100,
                    step    = 5,
                    help    = "Center of gravity at the beginning of the phrase (0=bottom, 100=top).",
                ),
                "end_center": TransformParam(
                    label   = "End center",
                    type    = "int",
                    default = 70,
                    min_val = 0,
                    max_val = 100,
                    step    = 5,
                    help    = "Center of gravity at the end of the phrase. Higher than start = ramp up; lower = ramp down.",
                ),
                "start_scale": TransformParam(
                    label   = "Start amplitude scale",
                    type    = "float",
                    default = 0.2,
                    min_val = 0.0,
                    max_val = 2.0,
                    step    = 0.05,
                    help    = "Stroke amplitude multiplier at the start of the phrase. 0.2 = compressed; 1.0 = original size.",
                ),
                "end_scale": TransformParam(
                    label   = "End amplitude scale",
                    type    = "float",
                    default = 1.0,
                    min_val = 0.0,
                    max_val = 2.0,
                    step    = 0.05,
                    help    = "Stroke amplitude multiplier at the end of the phrase. Values > 1 expand beyond original amplitude.",
                ),
            },
        ),
    ]
}


# ------------------------------------------------------------------
# Canonical display order (matches Transform Catalog UI groups)
# ------------------------------------------------------------------

TRANSFORM_ORDER: List[str] = [
    # Passthrough
    "passthrough",
    # Amplitude Shaping
    "amplitude_scale", "range", "boost_contrast",
    # Position Adjustment
    "recenter", "invert", "funnel",
    # Consolidated aliases (hidden from the picker; kept resolvable). Listed
    # last so they don't reorder the visible groups above.
    "normalize", "clamp_upper", "clamp_lower", "shift", "final_smooth", "three_one",
    # Smoothing & Filtering
    "smooth", "blend_seams",
    # Structural — Tempo
    "halve_tempo",
    # Break / Recovery
    "break", "waiting",
    # Performance / Device Realism
    "performance", "tame",
    # Rhythmic Patterns
    "beat_accent", "hero_beat",
    # Timing / Sync
    "nudge",
    # Replacement
    "stroke", "drift", "tide",
]


# ------------------------------------------------------------------
# Suggestion logic
# ------------------------------------------------------------------

def suggest_transform(phrase: dict, bpm_threshold: float = 120.0):
    """Return ``(catalog_key, param_values)`` for the most appropriate transform.

    Tag-based rules are checked first (priority order); BPM-based fallbacks
    apply only when no recognised tag is present.

    Tag rules:
    1.  transition (pattern_label) → smooth
    2.  frantic   → halve_tempo
    3.  giggle    → amplitude_scale, amplify to peak hi ≈ 65
    4.  plateau   → amplitude_scale, amplify to peak hi ≈ 65
    5.  lazy      → amplitude_scale, amplify to peak hi ≈ 65
    6.  stingy    → amplitude_scale, reduce to peak hi ≈ 65
    7.  drift     → recenter, target_center = 50
    8.  half_stroke → recenter, target_center = 50
    9.  drone     → beat_accent
    10. ramp      → funnel (start/end center + amplitude scale from detected delta)
    11. ambient   → waiting

    BPM fallbacks (no tag match):
    10. bpm < bpm_threshold                 → passthrough
    11. bpm >= bpm_threshold, span < 40     → normalize
    12. bpm >= bpm_threshold                → amplitude_scale

    The amplitude_scale factor for tag-based recommendations is computed from
    the phrase's actual ``mean_pos`` and ``span`` so the output peak position
    lands at ~65.  Users can adjust the value in the UI after the suggestion.
    """
    bpm   = phrase.get("bpm", 0.0)
    label = (phrase.get("pattern_label") or "").lower()
    tags  = phrase.get("tags") or []

    if "transition" in label:
        return ("smooth", {})

    # Helper: compute amplitude_scale factor targeting peak hi = 65
    metrics  = phrase.get("metrics", {})
    span     = metrics.get("span", 0)
    mean_pos = metrics.get("mean_pos", 50)
    hi       = mean_pos + span / 2.0

    def _scale_to_65(clamp_min: float, clamp_max: float) -> dict:
        half_target  = 65.0 - 50.0          # 15 units from midpoint
        half_current = max(hi - 50.0, 1.0)
        scale = round(half_target / half_current, 2)
        scale = max(clamp_min, min(clamp_max, scale))
        return {"scale": scale}

    if "frantic" in tags:
        return ("halve_tempo", {})

    if "giggle" in tags or "plateau" in tags:
        return ("amplitude_scale", _scale_to_65(1.0, 10.0))   # amplify only

    if "lazy" in tags:
        return ("amplitude_scale", _scale_to_65(1.0, 10.0))   # amplify only

    if "stingy" in tags:
        return ("amplitude_scale", _scale_to_65(0.1, 1.0))    # reduce only

    if "drift" in tags or "half_stroke" in tags:
        return ("recenter", {"target_center": 50})

    if "drone" in tags:
        return ("beat_accent", {})

    if "ramp" in tags:
        ramp_delta = metrics.get("ramp_delta", 0.0)
        if ramp_delta > 0:
            # ramp up: start low, end high
            return ("funnel", {"start_center": max(0, round(mean_pos - abs(ramp_delta) / 2)),
                               "end_center":   min(100, round(mean_pos + abs(ramp_delta) / 2)),
                               "start_scale":  0.2, "end_scale": 1.0})
        else:
            # ramp down: start high, end low
            return ("funnel", {"start_center": min(100, round(mean_pos + abs(ramp_delta) / 2)),
                               "end_center":   max(0, round(mean_pos - abs(ramp_delta) / 2)),
                               "start_scale":  1.0, "end_scale": 0.2})

    if "ambient" in tags:
        return ("waiting", {})

    # BPM-based fallbacks when no tag matched
    if bpm < bpm_threshold:
        return ("passthrough", {})

    amp_span = phrase.get("amplitude_span", 100)  # 0-100; default assumes full range
    if amp_span < 40:
        # `range` with fit_to_content (default) == the old normalize:
        # stretch the narrow span to fill 0–100.
        return ("range", {})

    return ("amplitude_scale", {})


# ------------------------------------------------------------------
# Recipe transform (user-defined multi-step pipelines)
# ------------------------------------------------------------------

@dataclass
class _RecipeTransform(PhraseTransform):
    """A transform defined as an ordered sequence of existing catalog steps.

    Each step is ``{"transform": <key>, "params": {...}}``.  Steps are
    applied left-to-right; the output of each step is the input of the next.
    Unknown step keys are skipped with a stderr warning.

    Set ``"structural": true`` in the JSON definition if any step produces a
    different number of actions (e.g. ``halve_tempo``).
    """
    steps: List[dict] = field(default_factory=list)

    def _transform(self, actions: list, p: dict) -> list:
        result = actions
        for step in self.steps:
            key  = step.get("transform", "")
            spec = TRANSFORM_CATALOG.get(key)
            if spec is None:
                print(
                    f"[recipe:{self.key}] unknown step transform {key!r} — skipped",
                    file=sys.stderr,
                )
                continue
            result = spec.apply(result, step.get("params") or None)
        return result


# ------------------------------------------------------------------
# User-transform loader (recipes + plugins)
# ------------------------------------------------------------------

# ---------------------------------------------------------------------------
# JSON recipe schema validation
# ---------------------------------------------------------------------------

_KEY_RE = re.compile(r'^[a-z][a-z0-9_]{0,63}$')
_SCALAR_TYPES = (int, float, str, bool)


def _validate_recipe_entry(entry: object) -> Optional[str]:
    """Return an error string if *entry* fails schema checks, else None.

    A valid recipe entry is a JSON object with:
    - ``key``   : non-empty string matching ``^[a-z][a-z0-9_]{0,63}$``
    - ``name``  : string
    - ``steps`` : non-empty list of step objects, each with:
        - ``transform`` : string key present in ``_BUILTIN_KEYS``
        - ``params``    : optional dict; all values must be scalars

    Restricting step transforms to ``_BUILTIN_KEYS`` prevents a recipe from
    chaining into user-supplied or unknown transforms, closing an indirect
    code-execution path.
    """
    if not isinstance(entry, dict):
        return "entry must be a JSON object"

    key = entry.get("key", "")
    if not isinstance(key, str) or not _KEY_RE.match(key):
        return (
            f"key {key!r} must be a non-empty lowercase string matching "
            r"^[a-z][a-z0-9_]{0,63}$"
        )

    name = entry.get("name", "")
    if not isinstance(name, str):
        return "name must be a string"

    steps = entry.get("steps")
    if not isinstance(steps, list) or len(steps) == 0:
        return "steps must be a non-empty array"

    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            return f"steps[{i}] must be a JSON object"
        transform = step.get("transform", "")
        if not isinstance(transform, str):
            return f"steps[{i}].transform must be a string"
        if transform not in _BUILTIN_KEYS:
            return (
                f"steps[{i}].transform {transform!r} is not a known built-in key; "
                "only built-in step keys are allowed in recipes"
            )
        params = step.get("params", {})
        if not isinstance(params, dict):
            return f"steps[{i}].params must be a JSON object"
        for pk, pv in params.items():
            if not isinstance(pk, str):
                return f"steps[{i}].params: key {pk!r} must be a string"
            if not isinstance(pv, _SCALAR_TYPES):
                return (
                    f"steps[{i}].params[{pk!r}] must be a scalar "
                    "(number, string, or boolean); nested objects are not allowed"
                )

    return None


def load_user_transforms(
    recipes_dir: Optional[str] = None,
    plugins_dir: Optional[str] = None,
) -> Dict[str, PhraseTransform]:
    """Scan *recipes_dir* and *plugins_dir* and return a dict of user transforms.

    Defaults to ``<project_root>/user_transforms/`` and
    ``<project_root>/plugins/`` relative to this file's package parent.

    Keys that clash with built-in catalog keys are skipped with a warning.
    """
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if recipes_dir is None:
        recipes_dir = os.path.join(_root, "user_transforms")
    if plugins_dir is None:
        plugins_dir = os.path.join(_root, "plugins")

    result: Dict[str, PhraseTransform] = {}

    # ---- JSON recipes ----
    if os.path.isdir(recipes_dir):
        for path in sorted(glob.glob(os.path.join(recipes_dir, "*.json"))):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
                entries = data if isinstance(data, list) else [data]
                for entry in entries:
                    err = _validate_recipe_entry(entry)
                    if err:
                        print(
                            f"[user_transforms] {os.path.basename(path)}: "
                            f"invalid entry — {err} (skipped)",
                            file=sys.stderr,
                        )
                        continue
                    key = entry["key"]
                    if key in _BUILTIN_KEYS:
                        print(
                            f"[user_transforms] {os.path.basename(path)}: "
                            f"key {key!r} clashes with a built-in — skipped",
                            file=sys.stderr,
                        )
                        continue
                    t = _RecipeTransform(
                        key=key,
                        name=entry.get("name", key),
                        description=entry.get("description", ""),
                        structural=bool(entry.get("structural", False)),
                        steps=entry.get("steps", []),
                    )
                    result[key] = t
            except Exception as exc:
                print(
                    f"[user_transforms] skipping {os.path.basename(path)}: {exc}",
                    file=sys.stderr,
                )

    # ---- Python plugins (disabled by default) ----
    # Python files run with unrestricted OS access.  They must be explicitly
    # opted-in via the environment variable below.  When .py files are present
    # but the flag is not set, a warning is printed so the user knows why their
    # plugin was not loaded.
    _PLUGINS_ENABLED = os.environ.get("FUNSCRIPT_PLUGINS_ENABLED", "").lower() in (
        "1", "true", "yes",
    )
    if os.path.isdir(plugins_dir):
        py_files = sorted(glob.glob(os.path.join(plugins_dir, "*.py")))
        # Skip example/template files (committed to the repo for reference)
        py_files = [p for p in py_files if not os.path.basename(p).startswith("example_")]
        if py_files and not _PLUGINS_ENABLED:
            print(
                f"[plugins] {len(py_files)} Python plugin file(s) found but NOT loaded. "
                "Python plugins run with full system access (file system, network, "
                "subprocesses). Set FUNSCRIPT_PLUGINS_ENABLED=1 to enable them only "
                "if you trust the source. JSON recipes in user_transforms/ are safe "
                "and do not require this flag.",
                file=sys.stderr,
            )
        if _PLUGINS_ENABLED:
            py_files_all = sorted(glob.glob(os.path.join(plugins_dir, "*.py")))
        else:
            py_files_all = []
        for path in py_files_all:
            try:
                spec = importlib.util.spec_from_file_location(
                    f"_plugin_{os.path.splitext(os.path.basename(path))[0]}", path
                )
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)

                candidates: List[PhraseTransform] = []
                if hasattr(mod, "TRANSFORMS"):
                    candidates = list(mod.TRANSFORMS)
                elif hasattr(mod, "TRANSFORM"):
                    candidates = [mod.TRANSFORM]

                for t in candidates:
                    if not isinstance(t, PhraseTransform):
                        continue
                    if t.key in _BUILTIN_KEYS:
                        print(
                            f"[plugins] {os.path.basename(path)}: "
                            f"key {t.key!r} clashes with a built-in — skipped",
                            file=sys.stderr,
                        )
                        continue
                    result[t.key] = t
            except Exception as exc:
                print(
                    f"[plugins] skipping {os.path.basename(path)}: {exc}",
                    file=sys.stderr,
                )

    return result


# ------------------------------------------------------------------
# Freeze built-in keys BEFORE merging user transforms so the
# TRANSFORM_ORDER completeness test only checks built-ins.
# ------------------------------------------------------------------

# Register tone transforms
for _tt in _TONE_TRANSFORMS:
    TRANSFORM_CATALOG[_tt.key] = _tt

_BUILTIN_KEYS: frozenset = frozenset(TRANSFORM_CATALOG)

# Merge user-defined transforms (silent no-op when directories are absent)
TRANSFORM_CATALOG.update(load_user_transforms())


def get_transform_options() -> tuple[list[str], list[str]]:
    """Return (keys, labels) for the transform dropdown.

    Built-ins appear first (in TRANSFORM_ORDER).  User-defined transforms
    follow, grouped by their ``category`` field.  Each non-empty category gets
    a "── Category ──" separator row (key ``"__sep_<category>__"``), which
    resolves to passthrough if accidentally selected.  Uncategorised user
    transforms are collected under "── My Transforms ──".
    """
    builtin_keys   = [k for k in TRANSFORM_ORDER if k in TRANSFORM_CATALOG]
    builtin_labels = [TRANSFORM_CATALOG[k].name for k in builtin_keys]

    user_keys = [k for k in TRANSFORM_CATALOG if k not in _BUILTIN_KEYS and not k.startswith("__sep_")]
    if not user_keys:
        return builtin_keys, builtin_labels

    # Group user transforms by category (preserving insertion order)
    groups: dict[str, list[str]] = {}
    for k in user_keys:
        cat = getattr(TRANSFORM_CATALOG[k], "category", "") or "My Transforms"
        groups.setdefault(cat, []).append(k)

    all_keys   = list(builtin_keys)
    all_labels = list(builtin_labels)
    pt = TRANSFORM_CATALOG["passthrough"]
    for cat, keys in groups.items():
        sep_key = f"__sep_{cat.lower().replace(' ', '_')}__"
        if sep_key not in TRANSFORM_CATALOG:
            TRANSFORM_CATALOG[sep_key] = pt
        all_keys.append(sep_key)
        all_labels.append(f"── {cat} ──")
        for k in keys:
            all_keys.append(k)
            all_labels.append(TRANSFORM_CATALOG[k].name)

    return all_keys, all_labels


def get_transforms_by_category() -> dict[str, list[tuple[str, str]]]:
    """Return {category_name: [(key, label), ...]} for the two-step picker.

    Categories (order matters — Tone first)
    ----------
    'Tone'       — per-phrase tone shaping (same logic as global Tone tab)
    'Behavior'   — built-in non-structural transforms (amplitude, smoothing, …)
    'Structural' — built-in structural transforms (tempo, replacement)
    'Plugins'    — user-defined transforms (omitted when none are loaded)
    """
    tone:       list[tuple[str, str]] = []
    behavior:   list[tuple[str, str]] = []
    structural: list[tuple[str, str]] = []
    plugins:    list[tuple[str, str]] = []

    # Tone transforms (registered from _TONE_TRANSFORMS)
    for tt in _TONE_TRANSFORMS:
        tone.append((tt.key, tt.name))

    for k in TRANSFORM_ORDER:
        if k not in TRANSFORM_CATALOG:
            continue
        spec = TRANSFORM_CATALOG[k]
        if spec.hidden:
            continue  # consolidated alias — resolvable but not shown
        pair = (k, spec.name)
        if spec.category == "tone":
            tone.append(pair)
        elif spec.structural:
            structural.append(pair)
        else:
            behavior.append(pair)

    user_keys = [
        k for k in TRANSFORM_CATALOG
        if k not in _BUILTIN_KEYS and not k.startswith("__sep_")
    ]
    for k in user_keys:
        plugins.append((k, TRANSFORM_CATALOG[k].name))

    result: dict[str, list[tuple[str, str]]] = {
        "Tone":       tone,
        "Behavior":   behavior,
        "Structural": structural,
    }
    if plugins:
        result["Plugins"] = plugins
    return result
