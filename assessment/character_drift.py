"""Character-drift phrase splitter (Step 2 of phrase detection).

Consumes Step 1 chapter-scoped phrases from `cmd_assess` and subdivides each
phrase at points where the funscript's motion character drifts. Three signals
fire splits:

  - top_drift     — local max position (per 3s window) shifts ≥10 units
  - bottom_drift  — local min position shifts ≥10 units
  - density_drift — actions-per-window ratio falls below 0.65 between adjacent
                    windows (with absolute floor) — catches "wall of red"
                    sparsity changes that top/bottom miss

After drift detection, each resulting sub-phrase of duration ≥45s also gets
beat-aligned drone-grid subdivision (~35s segments snapped to nearest downbeat
when a beats sidecar is available; even time-ticks otherwise). This ensures
long uniform "drone" stretches receive an editable grid even in absence of
character change.

Finally, all interior boundaries within a chapter are snapped to the nearest
downbeat within ±3s, respecting min-phrase-duration guards on both sides.
Cross-chapter boundaries are never touched (those belong to the chapter
detector, not phrase detection).

Each output sub-phrase carries an `evidence` attribute:
  ['seed']         — unchanged head of a parent phrase
  ['top_drift']    — split fired on upper-envelope change
  ['bottom_drift'] — split fired on lower-envelope change
  ['density_drift']— split fired on actions/sec change
  any combo of the above
  ['drone_grid']   — beat-aligned grid tick in a uniform stretch
  ['snap_only']    — Step 1 boundary repositioned to nearest downbeat

Wired into `cmd_assess` at funscriptforge/cli.py after `_split_long_phrases`.
"""

from dataclasses import dataclass
from typing import Optional


WINDOW_MS = 3_000
HOP_MS = 1_500
TOP_DELTA = 10
BOTTOM_DELTA = 10
DENSITY_RATIO = 0.65
DENSITY_MIN_DELTA = 4
MIN_SPLITTABLE_MS = 40_000
MIN_SUBPHRASE_MS = 20_000
UNIFORM_RANGE = 12

DRONE_MIN_PHRASE_MS = 45_000
DRONE_TARGET_SEGMENT_MS = 35_000
DRONE_DOWNBEAT_TOLERANCE_MS = 6_000

DOWNBEAT_SNAP_TOLERANCE_MS = 3_000


@dataclass
class CharacterDriftSplit:
    ms: int
    evidence: list


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
    t = span_start_ms
    out = []
    while t + WINDOW_MS <= span_end_ms:
        positions = [a["pos"] for a in actions if t <= a["at"] < t + WINDOW_MS]
        if positions:
            out.append({
                "center_ms": t + WINDOW_MS // 2,
                "top": max(positions),
                "bottom": min(positions),
                "density": len(positions),
            })
        t += HOP_MS
    return out


def find_splits(actions, span_start_ms, span_end_ms,
                downbeats_ms: Optional[list] = None) -> list:
    span_dur = span_end_ms - span_start_ms
    if span_dur < MIN_SPLITTABLE_MS:
        return []
    windows = _windows_for_span(actions, span_start_ms, span_end_ms)
    if len(windows) < 4:
        return []

    tops = _smooth_median([w["top"] for w in windows])
    bottoms = _smooth_median([w["bottom"] for w in windows])
    densities = _smooth_median([w["density"] for w in windows])

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
        if d_prev > 0 and d_now > 0:
            ratio = min(d_now, d_prev) / max(d_now, d_prev)
            if ratio <= DENSITY_RATIO and abs(d_now - d_prev) >= DENSITY_MIN_DELTA:
                ev.append("density_drift")
        if ev:
            raw.append({"ms": windows[i]["center_ms"], "evidence": ev})

    if not raw:
        return []

    accepted = []
    last_split_ms = span_start_ms
    for cand in raw:
        if cand["ms"] - last_split_ms < MIN_SUBPHRASE_MS:
            continue
        if span_end_ms - cand["ms"] < MIN_SUBPHRASE_MS:
            continue
        next_end = min(cand["ms"] + MIN_SUBPHRASE_MS, span_end_ms)
        next_positions = [a["pos"] for a in actions if cand["ms"] <= a["at"] < next_end]
        if len(next_positions) >= 5:
            next_range = max(next_positions) - min(next_positions)
            if next_range < UNIFORM_RANGE:
                continue
        snapped_ms = cand["ms"]
        if downbeats_ms:
            best = min(downbeats_ms, key=lambda db: abs(db - cand["ms"]))
            if abs(best - cand["ms"]) <= DOWNBEAT_SNAP_TOLERANCE_MS:
                if best - last_split_ms >= MIN_SUBPHRASE_MS and span_end_ms - best >= MIN_SUBPHRASE_MS:
                    snapped_ms = best
        accepted.append(CharacterDriftSplit(ms=snapped_ms, evidence=cand["evidence"]))
        last_split_ms = snapped_ms

    return accepted


def _snap_to_downbeat(ms: int, downbeats_ms: list,
                      prev_boundary_ms: int, next_boundary_ms: int,
                      tolerance_ms: int = DOWNBEAT_SNAP_TOLERANCE_MS) -> int:
    if not downbeats_ms:
        return ms
    best = min(downbeats_ms, key=lambda db: abs(db - ms))
    if abs(best - ms) > tolerance_ms:
        return ms
    if best - prev_boundary_ms < MIN_SUBPHRASE_MS:
        return ms
    if next_boundary_ms - best < MIN_SUBPHRASE_MS:
        return ms
    return best


def _drone_grid_splits(span_start_ms: int, span_end_ms: int,
                       downbeats_ms: Optional[list] = None) -> list:
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
        if snapped - prev_accepted < MIN_SUBPHRASE_MS:
            continue
        if span_end_ms - snapped < MIN_SUBPHRASE_MS:
            continue
        ticks.append(snapped)
        prev_accepted = snapped
    return ticks


def split_phrases(phrases, actions, downbeats_ms: Optional[list] = None) -> list:
    """Subdivide phrases via character-drift + recursive drone-grid + downbeat-snap.

    Returns a new list; input phrases are not mutated. Each output sub-phrase is
    a shallow copy of its parent with start_ms/end_ms updated and an `evidence`
    attribute set. `chapter_id` is propagated explicitly.
    """
    import copy as _copy

    def _apply_drone_grid(start_ms: int, end_ms: int, seed_evidence: list):
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

    if downbeats_ms and len(out) > 1:
        for i in range(len(out) - 1):
            if getattr(out[i], "chapter_id", None) != getattr(out[i + 1], "chapter_id", None):
                continue
            if out[i].end_ms != out[i + 1].start_ms:
                continue
            prev_b = out[i].start_ms
            next_b = out[i + 1].end_ms
            snapped = _snap_to_downbeat(out[i].end_ms, downbeats_ms, prev_b, next_b)
            if snapped != out[i].end_ms:
                out[i].end_ms = snapped
                out[i + 1].start_ms = snapped
                if getattr(out[i + 1], "evidence", None) == ["seed"]:
                    out[i + 1].evidence = ["snap_only"]

    return out
