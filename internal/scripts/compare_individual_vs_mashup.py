"""Compare per-clip phrase detection against mashup phrase detection.

For each of the 16 VictoriaOaks source clips:
  1. Read the clip's `.phrases.json` (run cmd_assess first).
  2. Shift each phrase's at_ms/end_ms by the cumulative offset (clip's
     start position in the mashup).
  3. Look for an overlapping phrase in the mashup's `.phrases.json`.
  4. Score boundary alignment and tag agreement.
"""
from __future__ import annotations

import json
from pathlib import Path

FA_DIR = Path(r"C:\Users\bruce\Projects\_lqr\forgeassembler\test_media\victoriaoats")
FF_DIR = Path(r"C:\Users\bruce\Projects\_lqr\funscriptforge\test_funscript")
MASHUP_PHRASES = FF_DIR / ".VictoriaOaks_stingy.original.forge" / "VictoriaOaks_stingy.original.phrases.json"

# Same numbers used for the ground-truth chapter scoring.
DURATIONS_S = [
    211.241995, 320.200000, 355.206009, 454.076009, 373.155011, 289.656009,
    345.267007, 409.470998, 373.572993, 385.766667, 391.666667, 259.539002,
    351.100000, 279.766667, 403.433333, 389.600000,
]


def cumulative_offsets_ms() -> list[int]:
    offsets = [0]
    acc = 0.0
    for d in DURATIONS_S[:-1]:
        acc += d * 1000
        offsets.append(int(round(acc)))
    return offsets


def load_phrases(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    return d.get("slices", [])


def find_overlaps(target: dict, candidates: list[dict]) -> list[dict]:
    return [
        c for c in candidates
        if c["at_ms"] < target["end_ms"] and c["end_ms"] > target["at_ms"]
    ]


def main() -> None:
    offsets = cumulative_offsets_ms()
    mashup = load_phrases(MASHUP_PHRASES)
    if not mashup:
        print(f"Mashup phrases not found at {MASHUP_PHRASES}")
        return

    print(f"Mashup phrases: {len(mashup)}")
    print(f"Mashup duration: {mashup[-1]['end_ms']/1000:.1f}s")
    print()

    headers = "clip n_ind  shifted_range          mashup_overlaps  boundary_drift  tag_match"
    print(headers)
    print("-" * len(headers))

    total_boundary_drift = []
    matched_count = 0
    mismatch_count = 0

    for clip_idx in range(16):
        offset = offsets[clip_idx]
        ind_path = FA_DIR / f".{clip_idx}.forge" / f"{clip_idx}.phrases.json"
        ind_phrases = load_phrases(ind_path)
        if not ind_phrases:
            print(f"  {clip_idx:>2}    --   (no phrases sidecar found)")
            continue

        shifted = []
        for p in ind_phrases:
            shifted.append({
                **p,
                "at_ms":  p["at_ms"] + offset,
                "end_ms": p["end_ms"] + offset,
            })

        clip_start = offset
        clip_end = offset + int(DURATIONS_S[clip_idx] * 1000)
        mashup_in_clip = [m for m in mashup if m["at_ms"] < clip_end and m["end_ms"] > clip_start]

        for sp in shifted:
            overlaps = find_overlaps(sp, mashup)
            best = None
            best_overlap = 0
            for o in overlaps:
                overlap_ms = min(o["end_ms"], sp["end_ms"]) - max(o["at_ms"], sp["at_ms"])
                if overlap_ms > best_overlap:
                    best, best_overlap = o, overlap_ms
            if best:
                start_drift = best["at_ms"] - sp["at_ms"]
                end_drift = best["end_ms"] - sp["end_ms"]
                total_boundary_drift.extend([abs(start_drift), abs(end_drift)])
                ind_tags = set(sp["metrics"].get("tags") or [])
                mash_tags = set(best["metrics"].get("tags") or [])
                tag_match = "=" if ind_tags == mash_tags else "≠"
                if ind_tags == mash_tags:
                    matched_count += 1
                else:
                    mismatch_count += 1

        # Per-clip line: count + extents.
        sp_first = shifted[0]
        sp_last = shifted[-1]
        print(
            f"  {clip_idx:>2}  {len(ind_phrases):>3}   "
            f"[{sp_first['at_ms']/1000:>7.1f}, {sp_last['end_ms']/1000:>7.1f}]s   "
            f"mashup phrases in range: {len(mashup_in_clip)}"
        )

    print()
    print("Summary")
    print("-------")
    if total_boundary_drift:
        avg = sum(total_boundary_drift) / len(total_boundary_drift)
        mx = max(total_boundary_drift)
        print(f"  Boundary drift (per-end, ms): avg={avg:.0f}  max={mx}  n={len(total_boundary_drift)}")
        print(f"  Tag agreement: {matched_count} match / {mismatch_count} mismatch")


if __name__ == "__main__":
    main()
