"""Compare phrase splits vs pattern-label splits across the 16 VictoriaOaks clips.

A *Pattern* in the analyzer is a category, not a segment: it groups
all similar-shape cycles. To compare against phrase boundaries we have
to derive segments — sort all cycles by time, group contiguous cycles
with the same pattern_label, and call those "pattern runs".

For each phrase boundary, we then ask: does a pattern run boundary
land within tolerance? If most do, phrases are essentially aggregations
of pattern runs. If many don't, phrases are split by character drift
(duration/velocity/amplitude tolerance), capturing a distinct dimension.
"""
from __future__ import annotations

import json
from pathlib import Path

FA_DIR = Path(r"C:\Users\bruce\Projects\_lqr\forgeassembler\test_media\victoriaoats")
TOLERANCE_MS = 200  # how close a pattern-run change has to be to count as "explaining" a phrase boundary


def load_assessment(clip_idx: int) -> dict | None:
    path = FA_DIR / f"{clip_idx}_assessment.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def collect_cycles_sorted(assessment: dict) -> list[dict]:
    """Flatten all cycles across all patterns and sort by start_ms.

    Each Cycle in models.py carries its own ``label`` (the cycle's own
    pattern label). Cycles are grouped under their parent Pattern in the
    JSON, but we want them temporally ordered.
    """
    cycles: list[dict] = []
    for pat in assessment.get("patterns", []):
        for c in pat.get("cycles", []):
            cycles.append({
                "start_ms":      c["start_ms"],
                "end_ms":        c["end_ms"],
                "pattern_label": pat.get("pattern_label", ""),
            })
    cycles.sort(key=lambda c: c["start_ms"])
    return cycles


def pattern_run_boundaries(cycles: list[dict]) -> list[int]:
    """Timestamps where the cycle's pattern_label transitions.

    Returned as the start_ms of the cycle that begins the new run.
    """
    boundaries: list[int] = []
    last_label: str | None = None
    for c in cycles:
        if last_label is not None and c["pattern_label"] != last_label:
            boundaries.append(c["start_ms"])
        last_label = c["pattern_label"]
    return boundaries


def phrase_internal_boundaries(phrases: list[dict]) -> list[int]:
    """Internal phrase boundaries (start_ms of every phrase except the first)."""
    return [p["start_ms"] for p in phrases[1:]]


def nearest_distance(target: int, candidates: list[int]) -> int:
    if not candidates:
        return 10**9
    return min(abs(c - target) for c in candidates)


def main() -> None:
    print(f"Tolerance: {TOLERANCE_MS} ms (boundary 'explained' if a pattern-run change lies within this distance)\n")
    headers = "clip  phrases  phr_bnd  pat_runs  explained  unexplained  median_drift_ms"
    print(headers)
    print("-" * len(headers))

    total_explained = 0
    total_unexplained = 0
    total_phr_bnd = 0
    drift_all: list[int] = []

    for clip_idx in range(16):
        a = load_assessment(clip_idx)
        if a is None:
            print(f"  {clip_idx:>2}  (assessment.json missing)")
            continue

        phrases = a.get("phrases", [])
        cycles = collect_cycles_sorted(a)
        pat_bnd = pattern_run_boundaries(cycles)
        phr_bnd = phrase_internal_boundaries(phrases)

        explained = sum(1 for b in phr_bnd if nearest_distance(b, pat_bnd) <= TOLERANCE_MS)
        unexplained = len(phr_bnd) - explained
        drifts = [nearest_distance(b, pat_bnd) for b in phr_bnd]
        med = sorted(drifts)[len(drifts) // 2] if drifts else 0

        total_explained += explained
        total_unexplained += unexplained
        total_phr_bnd += len(phr_bnd)
        drift_all.extend(drifts)

        # Count pattern runs (= boundaries + 1, if any cycles exist).
        n_pat_runs = len(pat_bnd) + 1 if cycles else 0

        print(
            f"  {clip_idx:>2}    {len(phrases):>5}    {len(phr_bnd):>5}    "
            f"{n_pat_runs:>5}    {explained:>5}        {unexplained:>3}            {med:>5}"
        )

    print()
    print("Summary")
    print("-------")
    if total_phr_bnd:
        pct_explained = total_explained / total_phr_bnd * 100
        print(f"  Phrase boundaries: {total_phr_bnd}")
        print(f"  Coincide with pattern-run change ({TOLERANCE_MS}ms tol): {total_explained} ({pct_explained:.1f}%)")
        print(f"  NOT coinciding (split by other criteria): {total_unexplained} ({100-pct_explained:.1f}%)")
        if drift_all:
            drift_all_sorted = sorted(drift_all)
            mid = len(drift_all_sorted) // 2
            print(f"  Distance to nearest pattern-run change: median={drift_all_sorted[mid]} ms, max={drift_all_sorted[-1]} ms")


if __name__ == "__main__":
    main()
