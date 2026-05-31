"""Character-drift phrase splitter (Step 2 of phrase detection).

Consumes Step 1 chapter-scoped phrases from `cmd_assess` and subdivides each
phrase at points where the funscript's motion character drifts. Four signals
fire splits:

  - top_drift      — local max position (per 3s window) shifts ≥10 units
  - bottom_drift   — local min position shifts ≥10 units
  - density_drift  — actions-per-window ratio falls below 0.65 between adjacent
                     windows (with absolute floor) — catches "wall of red"
                     sparsity changes that top/bottom miss
  - velocity_drift — stroke SPEED flips between a sustained calm run and a
                     sustained loud run (the blue↔orange transition the user
                     sees in the heat ribbon). Speed is normalized to the
                     chapter's own velocity scale (p95 of 2s-window means),
                     exactly mirroring how the ribbon colors each stroke
                     relative to a local max — so "loud" means fast *for this
                     chapter*, not fast absolutely. This is the only signal
                     keyed on velocity; top/bottom/density/amplitude all key
                     on position or count, so a pure speed change (same stroke
                     range, faster strokes) was previously invisible.

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
# Floors lowered 2026-05-31 for the "~10s phrase" sharpening pass: phrases as
# short as ~20s become splittable, and sub-phrases can reach ~10s so the grain
# can follow the velocity contour the user edits by. Was 40k / 20k.
MIN_SPLITTABLE_MS = 18_000
MIN_SUBPHRASE_MS = 9_000
UNIFORM_RANGE = 12

# Drone-grid: finer (was 45k min / 35k segment) so uniform stretches get a
# ~12s editable grid instead of ~35s — the floor of the "10 second phrases"
# request. Velocity seams (below) are applied first; the grid only subdivides
# whatever uniform span is left between them.
DRONE_MIN_PHRASE_MS = 20_000
DRONE_TARGET_SEGMENT_MS = 12_000
DRONE_DOWNBEAT_TOLERANCE_MS = 4_000

DOWNBEAT_SNAP_TOLERANCE_MS = 3_000

# ── Velocity-drift (blue↔orange) ──────────────────────────────────────────
# Stroke speed = |Δpos/Δt| in pos-units/ms (same quantity the heat ribbon
# colors by). Per-window means are normalized to the chapter's p95 so the
# scale matches what the user sees locally. A seam fires where a sustained
# CALM run meets a sustained LOUD run (split on a single mid threshold with
# run-length hysteresis — the "~5s blue then ~5s orange" rule).
VEL_WINDOW_MS = 2_000
VEL_HOP_MS = 1_000
VEL_MID = 0.45          # normalized speed below = calm, above = loud
VEL_MIN_RUN = 4         # windows a state must hold (~5s) to count as sustained


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


def _stroke_vels(actions):
    """[(at_ms, speed)] per stroke; speed = |Δpos/Δt| in pos-units/ms."""
    out = []
    for i in range(1, len(actions)):
        dt = max(1, actions[i]["at"] - actions[i - 1]["at"])
        out.append((actions[i]["at"], abs(actions[i]["pos"] - actions[i - 1]["pos"]) / dt))
    return out


def _vel_window_means(svels, start_ms, end_ms):
    """Mean stroke speed per VEL_WINDOW_MS/VEL_HOP_MS window over [start,end)."""
    out = []
    t = start_ms
    while t + VEL_WINDOW_MS <= end_ms:
        v = [s for (at, s) in svels if t <= at < t + VEL_WINDOW_MS]
        if v:
            out.append((t + VEL_WINDOW_MS // 2, sum(v) / len(v)))
        t += VEL_HOP_MS
    return out


def chapter_vel_scale(svels, start_ms, end_ms):
    """p95 of per-window mean speed over a chapter span — the local 'max' the
    heat ribbon normalizes against. Returns None when there's too little data."""
    wm = _vel_window_means(svels, start_ms, end_ms)
    if len(wm) < VEL_MIN_RUN:
        return None
    vals = sorted(v for _, v in wm)
    scale = vals[int(0.95 * (len(vals) - 1))]
    return scale or None


def velocity_seams(svels, span_start_ms, span_end_ms, vel_scale,
                   downbeats_ms: Optional[list] = None) -> list:
    """Split candidates where a sustained calm run meets a sustained loud run.

    Speed is normalized to `vel_scale` (the chapter p95) and thresholded at
    VEL_MID into calm/loud; a seam fires only when BOTH sides hold for
    ≥VEL_MIN_RUN windows (the run-length hysteresis that ignores per-stroke
    flicker). Fires in either direction — calm→loud (a build) and loud→calm
    (a drop, e.g. a chapter's dead-calm tail). Each carries ['velocity_drift'].
    """
    if not vel_scale or span_end_ms - span_start_ms < MIN_SPLITTABLE_MS:
        return []
    wm = _vel_window_means(svels, span_start_ms, span_end_ms)
    if len(wm) < VEL_MIN_RUN * 2:
        return []
    states = ['L' if (v / vel_scale) < VEL_MID else 'H' for _, v in wm]
    runs = []
    for i, s in enumerate(states):
        if runs and runs[-1][0] == s:
            runs[-1][2] = i
        else:
            runs.append([s, i, i])
    seams = []
    for k in range(1, len(runs)):
        a, b = runs[k - 1], runs[k]
        if (a[2] - a[1] + 1) >= VEL_MIN_RUN and (b[2] - b[1] + 1) >= VEL_MIN_RUN:
            seam_ms = (wm[a[2]][0] + wm[b[1]][0]) // 2
            if downbeats_ms:
                best = min(downbeats_ms, key=lambda db: abs(db - seam_ms))
                if abs(best - seam_ms) <= DOWNBEAT_SNAP_TOLERANCE_MS:
                    seam_ms = best
            seams.append(CharacterDriftSplit(ms=seam_ms, evidence=["velocity_drift"]))
    return seams


def _merge_spaced(splits, span_start_ms, span_end_ms, min_gap=MIN_SUBPHRASE_MS):
    """Greedy left-to-right accept of merged candidates with min_gap spacing.
    Candidates landing within min_gap of an accepted one fold their evidence
    into it rather than producing a too-short sub-phrase."""
    if not splits:
        return []
    out = []
    last = span_start_ms
    for s in sorted(splits, key=lambda c: c.ms):
        if s.ms - last < min_gap or span_end_ms - s.ms < min_gap:
            if out and abs(s.ms - out[-1].ms) < min_gap:
                for e in s.evidence:
                    if e not in out[-1].evidence:
                        out[-1].evidence.append(e)
            continue
        out.append(CharacterDriftSplit(ms=s.ms, evidence=list(s.evidence)))
        last = s.ms
    return out


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

    # Per-chapter velocity scale (p95 of window-mean speed over the whole
    # chapter span) so velocity_drift normalizes the same way the heat ribbon
    # colors strokes — locally, per chapter. Chapter span is derived from the
    # phrases that carry each chapter_id.
    svels = _stroke_vels(actions)
    by_chap = {}
    for p in phrases:
        by_chap.setdefault(getattr(p, "chapter_id", None), []).append(p)
    chap_scale = {}
    for cid, plist in by_chap.items():
        c0 = min(pp.start_ms for pp in plist)
        c1 = max(pp.end_ms for pp in plist)
        chap_scale[cid] = chapter_vel_scale(svels, c0, c1)

    out = []
    for p in phrases:
        ph_actions = [a for a in actions if p.start_ms <= a["at"] < p.end_ms]
        drift_splits = find_splits(ph_actions, p.start_ms, p.end_ms, downbeats_ms=downbeats_ms)
        vel_splits = velocity_seams(
            svels, p.start_ms, p.end_ms,
            chap_scale.get(getattr(p, "chapter_id", None)),
            downbeats_ms=downbeats_ms,
        )
        # Merge both signal sets under one spacing pass so a velocity seam and
        # a position-drift seam that land close don't create a too-short stub.
        splits = _merge_spaced(drift_splits + vel_splits, p.start_ms, p.end_ms)

        if splits:
            cut_points = [p.start_ms]
            evidence_per_seg = [["seed"]]
            for s in splits:
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
            # oscillation_count / cycle_count are span totals on the parent;
            # a shallow copy that only retimes start/end would leave the FULL
            # parent counts on a fraction of the span, so phrase.bpm (= osc ·
            # 60000/dur) inflates by 1/ratio (a 127s→10s split read 12× too
            # hot — Prisoner showed 1641 for a real ~135 BPM). Scale both by
            # the duration fraction, matching cli._split_long_phrases.
            parent_dur = max(1, p.end_ms - p.start_ms)
            for sub_start, sub_end, sub_ev in sub_segs:
                sub = _copy.copy(p)
                sub.start_ms = sub_start
                sub.end_ms = sub_end
                ratio = (sub_end - sub_start) / parent_dur
                sub.oscillation_count = int(round((p.oscillation_count or 0) * ratio))
                sub.cycle_count = int(round((p.cycle_count or 0) * ratio))
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
