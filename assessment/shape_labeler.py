# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""shape_labeler.py — Per-phrase structural shape classification.

Where ``classifier.py`` answers *"what's wrong with this phrase"*
(behavior tags: stingy / drone / drift / lazy / ...), this module answers
*"what shape is this phrase"* — one of 8 canonical structural patterns:

    steady     regular up/down strokes, even spacing  (default)
    pulse      alternating motion and rest segments
    three_one  3 strokes followed by a hold, periodic
    tide       fast strokes riding a slow amplitude oscillation
    drift      motion confined to top or bottom third of the range
    burst      short concentrated bursts inside otherwise calm phrase
    taper      amplitude shrinks across the phrase
    swell      amplitude grows across the phrase

These are the IDs the Tauri PatternsTab consumes via the phrases sidecar
(`<stem>.phrases.json`'s `label` field). Until this module shipped, that
field was hardcoded to "steady".

v1 detects: steady, drift, swell, taper, pulse, burst.
Deferred:   tide, three_one (need finer cycle-level + envelope analysis).

DESIGN NOTE — why not reuse classifier metrics?
The classifier produces aggregate metrics (mean_pos, span, ramp_delta)
that wash out within-phrase shape:
  - span is almost always 100 (any full-range action saturates it)
  - mean_pos sits near 50 for most non-drift content
  - ramp_delta tracks position center-of-mass, not amplitude envelope
So this module recomputes its own window-stats inside the phrase.

Patterns vs behavior tags — two parallel vocabularies. A phrase carries
ONE pattern (shape_label, this module) and ZERO-OR-MORE tags (classifier).
The pattern says "what shape is this" — Steady, Swell, Burst, etc. The
tags say "what's wrong with this" — stingy, drone, drift, etc. Same
phrase, two lenses; PhrasesTab shows the tag view, PatternsTab shows
the pattern view.
"""

from __future__ import annotations

from typing import Dict, List


# Thresholds for v1 — tuned on Prisoner + LongandCut + VictoriaOaks.
# Refine on real-data feedback.

# drift: a phrase whose positions sit in the top or bottom third
DRIFT_LOWER_MAX_POS = 35     # if max_pos < this, motion is in bottom zone
DRIFT_UPPER_MIN_POS = 65     # if min_pos > this, motion is in top zone
DRIFT_MIN_RANGE     = 15     # need real motion, not a held position

# swell / taper: amplitude envelope grows / shrinks across the phrase
SWELL_TAPER_MIN_DELTA = 20   # last-third span vs first-third span, in pos units
SWELL_TAPER_MIN_SPAN  = 30   # phrase must have meaningful amplitude to begin with

# burst: one third of the phrase has 1.8x+ the velocity of the others
BURST_RATIO        = 1.8
BURST_MIN_DURATION = 6_000   # too-short phrases shouldn't be "burst"

# pulse: action stream has multiple rest periods within the phrase window
PULSE_GAP_MS       = 1_500   # action gap exceeding this counts as a rest
PULSE_MIN_GAPS     = 2       # need at least N rest periods to be "pulse"
PULSE_MIN_DURATION = 8_000   # short phrases can't really be "pulse"


def label_phrase_shape(
    phrase_dict: dict,
    all_actions: List[dict],
) -> str:
    """Return one of the 8 PATTERN_TYPES IDs for this phrase.

    Detection order is priority: first match wins. "steady" is the
    fallback when nothing else fires.
    """
    start_ms = int(phrase_dict.get("start_ms", 0))
    end_ms   = int(phrase_dict.get("end_ms", 0))
    duration_ms = max(1, end_ms - start_ms)

    window = [a for a in all_actions if start_ms <= a.get("at", -1) <= end_ms]
    if len(window) < 4:
        # Not enough data to classify — call it steady.
        return "steady"

    positions = [a["pos"] for a in window]
    min_pos = min(positions)
    max_pos = max(positions)
    pos_range = max_pos - min_pos

    # 1. drift — wrong-zone motion. Highest priority because it's the most
    # visually obvious. Uses min/max (not mean) so a phrase that lives
    # entirely in the top or bottom third is caught even if it has motion.
    if pos_range >= DRIFT_MIN_RANGE:
        if max_pos < DRIFT_LOWER_MAX_POS or min_pos > DRIFT_UPPER_MIN_POS:
            return "drift"

    # 2. pulse — rest periods inside the phrase. Detected via gaps in
    # the action stream.
    if duration_ms >= PULSE_MIN_DURATION:
        gap_count = _count_rest_gaps(window, PULSE_GAP_MS)
        if gap_count >= PULSE_MIN_GAPS:
            return "pulse"

    # 3/4. swell / taper — amplitude envelope grows or shrinks across
    # the phrase. Split phrase into thirds and compare per-third
    # positional span. Span (max-min) inside each third tracks
    # within-segment amplitude — unlike whole-phrase span which is
    # always 100 once any single full-range action exists.
    thirds = _split_into_n_segments(window, start_ms, end_ms, n=3)
    third_spans = [_span_of_window(t) for t in thirds]
    if all(s is not None for s in third_spans):
        delta_late_vs_early = third_spans[2] - third_spans[0]
        overall_span = max(third_spans)
        if overall_span >= SWELL_TAPER_MIN_SPAN:
            if delta_late_vs_early >= SWELL_TAPER_MIN_DELTA:
                return "swell"
            if delta_late_vs_early <= -SWELL_TAPER_MIN_DELTA:
                return "taper"

    # 5. burst — one third of the phrase has much higher mean velocity
    # than the others. This captures "calm-calm-burst" or "burst-calm-calm".
    if duration_ms >= BURST_MIN_DURATION:
        third_vels = [_mean_velocity_of_window(t) for t in thirds]
        if all(v is not None for v in third_vels):
            max_v = max(third_vels)
            others = [v for v in third_vels if v != max_v]
            if others:
                rest_avg = sum(others) / len(others)
                if rest_avg > 0.01 and max_v / rest_avg >= BURST_RATIO:
                    return "burst"

    # 6/7. tide, three_one — DEFERRED. Need cycle-level envelope analysis.
    # When these ship, slot them before steady.

    # 8. steady — default for everything that didn't match above.
    return "steady"


def _count_rest_gaps(window: List[dict], gap_threshold_ms: int) -> int:
    """Count action-to-action gaps inside ``window`` that exceed
    ``gap_threshold_ms``. Used by pulse detection."""
    if len(window) < 2:
        return 0
    gaps = 0
    for i in range(1, len(window)):
        if window[i]["at"] - window[i - 1]["at"] > gap_threshold_ms:
            gaps += 1
    return gaps


def _split_into_n_segments(
    window: List[dict],
    start_ms: int,
    end_ms: int,
    n: int,
) -> List[List[dict]]:
    """Split ``window`` into ``n`` time-equal segments. Empty segments
    are returned as empty lists (callers should check)."""
    if n <= 0 or end_ms <= start_ms:
        return [window]
    seg_len = (end_ms - start_ms) / n
    segments: List[List[dict]] = [[] for _ in range(n)]
    for a in window:
        offset = a["at"] - start_ms
        idx = min(n - 1, max(0, int(offset / seg_len)))
        segments[idx].append(a)
    return segments


def _span_of_window(window: List[dict]) -> float | None:
    """Max - min position in ``window``. Returns None if the window is
    too small to be meaningful."""
    if len(window) < 2:
        return None
    positions = [a["pos"] for a in window]
    return max(positions) - min(positions)


def _mean_velocity_of_window(window: List[dict]) -> float | None:
    """Mean of |Δpos / Δt| across consecutive actions in ``window``.
    Returns None if the window can't yield at least one velocity sample."""
    if len(window) < 2:
        return None
    vels = []
    for i in range(1, len(window)):
        dt = max(1, window[i]["at"] - window[i - 1]["at"])
        dp = abs(window[i]["pos"] - window[i - 1]["pos"])
        vels.append(dp / dt)
    return sum(vels) / len(vels) if vels else None


def label_phrases(
    phrase_dicts: List[dict],
    all_actions: List[dict],
) -> None:
    """Mutate each phrase dict in-place, adding a ``shape_label`` key."""
    for ph in phrase_dicts:
        ph["shape_label"] = label_phrase_shape(ph, all_actions)
