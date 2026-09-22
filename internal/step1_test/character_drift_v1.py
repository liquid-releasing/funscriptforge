"""Step 2 v1 — character-drift splitter.

Subdivides Step 1 phrases at points where the TOPS (local max position) or
BOTTOMS (local min position) drift over time. Preserves uniform "drone"
sections via a hysteresis rule.

Standalone for testing — not yet wired into cli.py. Validate against user's
hand-drawn boxes on VictoriaOaks chapters first, then promote.

Algorithm (in plain English):
  1. For each Step 1 phrase, slide a 5s window with 2.5s hop across the actions.
  2. In each window, compute top = max(pos), bottom = min(pos).
  3. Smooth with 3-window median.
  4. Mark a candidate split where |Δtop| ≥ TOP_DELTA or |Δbottom| ≥ BOTTOM_DELTA
     vs the previous window.
  5. Accept candidates greedily, requiring ≥ MIN_SUBPHRASE_MS between splits.
  6. Hysteresis: reject candidate if the next MIN_SUBPHRASE_MS of actions has
     position range < UNIFORM_RANGE (too uniform to be a real new section).
  7. Optional downbeat snap (within ±3s of accepted ms).
  8. Each new sub-phrase carries evidence: ['top_drift'] / ['bottom_drift'].
"""

from dataclasses import dataclass
from typing import Optional

# Tunable constants — v1.2 adds density signal + recursive drone-grid
WINDOW_MS = 3_000
HOP_MS = 1_500
TOP_DELTA = 10            # max-position drift between adjacent windows (units 0..100)
BOTTOM_DELTA = 10         # min-position drift between adjacent windows
DENSITY_RATIO = 0.65      # action-count ratio between adjacent windows; <ratio or >1/ratio = drift
DENSITY_MIN_DELTA = 4     # absolute delta in actions/window required (avoids tiny-window false-fires)
MIN_SPLITTABLE_MS = 40_000  # phrases shorter than this aren't subdivided by drift
MIN_SUBPHRASE_MS = 20_000   # min duration of any resulting sub-phrase
UNIFORM_RANGE = 12          # hysteresis: if next sub-phrase position range < this, skip the drift split

# Drone-grid subdivision: applied AFTER drift to any sub-phrase ≥DRONE_MIN_PHRASE_MS.
DRONE_MIN_PHRASE_MS = 45_000          # phrases shorter than this stay whole
DRONE_TARGET_SEGMENT_MS = 35_000      # aim for ~35s segments
DRONE_DOWNBEAT_TOLERANCE_MS = 6_000   # snap each grid tick to nearest downbeat within ±6s


@dataclass
class CharacterDriftSplit:
    ms: int
    evidence: list  # e.g. ['top_drift'], ['bottom_drift'], or ['top_drift', 'bottom_drift']


def _smooth_median(values, win=3):
    out = []
    half = win // 2
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        chunk = sorted(values[lo:hi])
        out.append(chunk[len(chunk) // 2])
    return out


def _windows_for_span(actions, span_start_ms, span_end_ms):
    """Yield {'center_ms', 'top', 'bottom', 'mean', 'density'} for each window in [span_start, span_end).

    density = action count in the window (proxy for actions/sec since window width is fixed).
    """
    t = span_start_ms
    out = []
    while t + WINDOW_MS <= span_end_ms:
        positions = [a["pos"] for a in actions if t <= a["at"] < t + WINDOW_MS]
        if positions:
            out.append({
                "center_ms": t + WINDOW_MS // 2,
                "top": max(positions),
                "bottom": min(positions),
                "mean": sum(positions) / len(positions),
                "range": max(positions) - min(positions),
                "density": len(positions),
            })
        t += HOP_MS
    return out


def find_splits(actions, span_start_ms, span_end_ms,
                downbeats_ms: Optional[list] = None) -> list[CharacterDriftSplit]:
    """Return candidate split times (ms, absolute) inside [span_start_ms, span_end_ms)."""
    span_dur = span_end_ms - span_start_ms
    if span_dur < MIN_SPLITTABLE_MS:
        return []
    windows = _windows_for_span(actions, span_start_ms, span_end_ms)
    if len(windows) < 4:
        return []

    tops = _smooth_median([w["top"] for w in windows])
    bottoms = _smooth_median([w["bottom"] for w in windows])
    densities = _smooth_median([w["density"] for w in windows])

    # Step a: find raw change-point candidates window-over-window
    raw = []
    for i in range(1, len(windows)):
        dtop = abs(tops[i] - tops[i - 1])
        dbot = abs(bottoms[i] - bottoms[i - 1])
        d_now, d_prev = densities[i], densities[i - 1]
        ev = []
        if dtop >= TOP_DELTA:
            ev.append("top_drift")
        if dbot >= BOTTOM_DELTA:
            ev.append("bottom_drift")
        # Density drift — catches wall-of-red sparsity changes that top/bottom miss
        # (individual actions still go full-range but count per window changes).
        # Trigger when ratio between adjacent windows falls outside DENSITY_RATIO,
        # with an absolute-delta floor to avoid noise on tiny windows.
        if d_prev > 0 and d_now > 0:
            ratio = min(d_now, d_prev) / max(d_now, d_prev)
            if ratio <= DENSITY_RATIO and abs(d_now - d_prev) >= DENSITY_MIN_DELTA:
                ev.append("density_drift")
        if ev:
            raw.append({"i": i, "ms": windows[i]["center_ms"], "evidence": ev,
                        "dtop": dtop, "dbot": dbot})

    if not raw:
        return []

    # Step b: greedy non-overlapping with hysteresis check
    accepted = []
    last_split_ms = span_start_ms
    for cand in raw:
        # Min sub-phrase before
        if cand["ms"] - last_split_ms < MIN_SUBPHRASE_MS:
            continue
        # Min sub-phrase remaining after
        if span_end_ms - cand["ms"] < MIN_SUBPHRASE_MS:
            continue
        # Hysteresis: the next MIN_SUBPHRASE_MS of actions should NOT be a tight drone
        # (if it is, the split is creating a uniform sub-phrase that doesn't help editability beyond Step 1's grid)
        next_end = min(cand["ms"] + MIN_SUBPHRASE_MS, span_end_ms)
        next_positions = [a["pos"] for a in actions if cand["ms"] <= a["at"] < next_end]
        if len(next_positions) >= 5:
            next_range = max(next_positions) - min(next_positions)
            if next_range < UNIFORM_RANGE:
                continue  # next section is too uniform; skip this boundary
        # Optional downbeat snap
        snapped_ms = cand["ms"]
        if downbeats_ms:
            best = min(downbeats_ms, key=lambda db: abs(db - cand["ms"]))
            if abs(best - cand["ms"]) <= 3_000:
                # ensure snap doesn't violate min sub-phrase
                if best - last_split_ms >= MIN_SUBPHRASE_MS and span_end_ms - best >= MIN_SUBPHRASE_MS:
                    snapped_ms = best
        accepted.append(CharacterDriftSplit(ms=snapped_ms, evidence=cand["evidence"]))
        last_split_ms = snapped_ms

    return accepted


def _snap_to_downbeat(ms: int, downbeats_ms: list,
                      prev_boundary_ms: int, next_boundary_ms: int,
                      tolerance_ms: int = 3_000) -> int:
    """Snap ms to nearest downbeat within ±tolerance, respecting min-phrase guards."""
    if not downbeats_ms:
        return ms
    best = min(downbeats_ms, key=lambda db: abs(db - ms))
    if abs(best - ms) > tolerance_ms:
        return ms
    # Don't snap if it would violate min-phrase-duration on either side
    if best - prev_boundary_ms < MIN_SUBPHRASE_MS:
        return ms
    if next_boundary_ms - best < MIN_SUBPHRASE_MS:
        return ms
    return best


def _drone_grid_splits(span_start_ms: int, span_end_ms: int,
                       downbeats_ms: Optional[list] = None) -> list:
    """Generate beat-aligned editing-grid splits inside a drone phrase.

    Aim for ~DRONE_TARGET_SEGMENT_MS segments, snapped to nearest downbeats when
    available. When no downbeats available, fall back to even time-ticks.
    """
    span_dur = span_end_ms - span_start_ms
    if span_dur < DRONE_MIN_PHRASE_MS:
        return []
    n_segments = max(2, round(span_dur / DRONE_TARGET_SEGMENT_MS))
    ticks = []
    prev_accepted = span_start_ms
    for i in range(1, n_segments):
        target_ms = span_start_ms + (span_dur * i) // n_segments
        snapped = target_ms
        if downbeats_ms:
            best = min(downbeats_ms, key=lambda db: abs(db - target_ms))
            if abs(best - target_ms) <= DRONE_DOWNBEAT_TOLERANCE_MS:
                snapped = best
        # Enforce min sub-phrase since previous accepted tick + remaining span
        if snapped - prev_accepted < MIN_SUBPHRASE_MS:
            continue
        if span_end_ms - snapped < MIN_SUBPHRASE_MS:
            continue
        ticks.append(snapped)
        prev_accepted = snapped
    return ticks


def split_phrases(phrases, actions, downbeats_ms: Optional[list] = None) -> list:
    """Subdivide each phrase via character-drift detection + downbeat-snap.

    For each input phrase:
      1. Find character-drift split candidates (top/bottom envelope changes).
      2. Build new boundary list = original (start, end) + accepted drift points.
      3. Snap each interior boundary to nearest downbeat (±3s tolerance), respecting
         min-phrase-duration on both sides.
      4. Emit sub-phrases with evidence: ['seed'] for the unchanged head,
         ['top_drift'] / ['bottom_drift'] / ['top_drift','bottom_drift'] for
         drift-detected, ['snap_only'] when a Step 1 boundary was simply
         beat-snapped (no character drift, just musical alignment).
    """
    import copy as _copy

    def _apply_drone_grid(start_ms: int, end_ms: int, seed_evidence: list):
        """Subdivide [start_ms, end_ms) into (sub_start, sub_end, evidence) triples.

        First emitted segment inherits seed_evidence; later segments get ['drone_grid'].
        Returns at least one segment (the whole span unchanged) if no grid splits fit.
        """
        ticks = _drone_grid_splits(start_ms, end_ms, downbeats_ms=downbeats_ms)
        if not ticks:
            return [(start_ms, end_ms, seed_evidence)]
        cuts = [start_ms] + ticks + [end_ms]
        out_segs = []
        for i in range(len(cuts) - 1):
            ev = seed_evidence if i == 0 else ["drone_grid"]
            out_segs.append((cuts[i], cuts[i + 1], ev))
        return out_segs

    out = []
    for p in phrases:
        ph_actions = [a for a in actions if p.start_ms <= a["at"] < p.end_ms]
        drift_splits = find_splits(ph_actions, p.start_ms, p.end_ms, downbeats_ms=downbeats_ms)

        # Build drift-defined cut_points + evidence-per-segment
        if drift_splits:
            cut_points = [p.start_ms]
            evidence_per_seg = [["seed"]]
            for s in drift_splits:
                cut_points.append(s.ms)
                evidence_per_seg.append(s.evidence)
            cut_points.append(p.end_ms)
        else:
            cut_points = [p.start_ms, p.end_ms]
            evidence_per_seg = [["seed"]]

        # Apply drone-grid subdivision to EACH drift segment that's long enough.
        # This is the fix for ch0/1/2/3/4: drift creating one boundary shouldn't
        # block grid subdivision of the resulting halves.
        for i in range(len(cut_points) - 1):
            seg_start = cut_points[i]
            seg_end = cut_points[i + 1]
            seg_seed_ev = evidence_per_seg[i]
            sub_segs = _apply_drone_grid(seg_start, seg_end, seg_seed_ev)
            for sub_start, sub_end, sub_ev in sub_segs:
                sub = _copy.copy(p)
                sub.start_ms = sub_start
                sub.end_ms = sub_end
                sub.evidence = sub_ev
                sub.chapter_id = getattr(p, "chapter_id", None)
                out.append(sub)

    # Second pass: snap interior boundaries WITHIN a chapter to nearest downbeat.
    # Skip cross-chapter boundaries — those are sacred (chapter boundaries are owned
    # by the chapter detector, not by phrase detection).
    if downbeats_ms and len(out) > 1:
        for i in range(len(out) - 1):
            if getattr(out[i], "chapter_id", None) != getattr(out[i + 1], "chapter_id", None):
                continue  # cross-chapter — don't touch
            if out[i].end_ms != out[i + 1].start_ms:
                continue  # not adjacent
            prev_b = out[i].start_ms
            next_b = out[i + 1].end_ms
            snapped = _snap_to_downbeat(out[i].end_ms, downbeats_ms, prev_b, next_b)
            if snapped != out[i].end_ms:
                out[i].end_ms = snapped
                out[i + 1].start_ms = snapped
                if getattr(out[i + 1], "evidence", None) == ["seed"]:
                    out[i + 1].evidence = ["snap_only"]

    return out
