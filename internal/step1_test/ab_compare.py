"""A/B Step 1 comparison: chapter-scoped phrase detection with auto_scale ON vs OFF.

Runs the same per-chapter loop twice on each test funscript with auto_scale_phrases
toggled. Reports phrase count + per-chapter distribution + duration stats for both.
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from assessment.analyzer import AnalyzerConfig, FunscriptAnalyzer
from videoflow.sidecar import forge_dir


def load_chapters(funscript_path: str) -> list:
    stem = Path(funscript_path).stem
    p = forge_dir(funscript_path) / f"{stem}.chapters.json"
    if not p.exists():
        return []
    with open(p) as f:
        return (json.load(f).get("chapters") or [])


def run_per_chapter(funscript_path: str, auto_scale: bool):
    analyzer = FunscriptAnalyzer(config=AnalyzerConfig())
    analyzer.load(funscript_path)
    # Suppress the global analyze stdout
    _ = analyzer.analyze(progress_callback=None)

    chapters = load_chapters(funscript_path)
    if not chapters:
        return None, None

    per_chapter_phrases = []
    per_ch_counts = []
    for ch_idx, ch in enumerate(chapters):
        ch_start = int(ch.get("at_ms", 0))
        ch_end = int(ch.get("end_ms", 0))
        ch_actions = [a for a in analyzer._actions if ch_start <= a["at"] < ch_end]
        if not ch_actions:
            per_ch_counts.append(0)
            continue
        cfg = AnalyzerConfig()
        cfg.auto_scale_phrases = auto_scale
        sub = FunscriptAnalyzer(config=cfg)
        sub._actions = ch_actions
        sub._source_file = analyzer._source_file
        sub_result = sub.analyze(progress_callback=None)
        for p in sub_result.phrases:
            p.chapter_id = ch_idx
        per_chapter_phrases.extend(sub_result.phrases)
        per_ch_counts.append(len(sub_result.phrases))
    return per_chapter_phrases, per_ch_counts


def summarize(label, phrases, per_ch_counts, n_chapters):
    print(f"--- {label} ---")
    print(f"  total phrases: {len(phrases)}")
    print(f"  chapters: {n_chapters}")
    print(f"  per-chapter counts: {per_ch_counts}")
    print(f"    min={min(per_ch_counts)} median={sorted(per_ch_counts)[len(per_ch_counts)//2]} max={max(per_ch_counts)} avg={sum(per_ch_counts)/len(per_ch_counts):.1f}")
    durs = [(p.end_ms - p.start_ms) / 1000.0 for p in phrases]
    if durs:
        durs.sort()
        print(f"  phrase duration s: min={durs[0]:.1f}  median={durs[len(durs)//2]:.1f}  max={durs[-1]:.1f}")
    tags = Counter(p.tags[0] if p.tags else "(none)" for p in phrases)
    print(f"  tag distribution: {dict(tags.most_common())}")
    print()


def main():
    cases = [
        ("VictoriaOaks", r"c:/Users/bruce/Projects/_lqr/funscriptforge/test_funscript/VictoriaOaks_stingy.original.funscript"),
        ("IPZZ-125 iris3", r"c:/Users/bruce/Projects/_lqr/forgeassembler/test_media/ipzz125/IPZZ-125.molester.omfg_iris3.funscript"),
    ]
    for name, path in cases:
        print(f"\n========== {name} ==========")
        chapters = load_chapters(path)
        print(f"chapters on disk: {len(chapters)}")
        # OLD baseline: auto_scale ON
        old_p, old_c = run_per_chapter(path, auto_scale=True)
        # NEW Step 1: auto_scale OFF
        new_p, new_c = run_per_chapter(path, auto_scale=False)
        summarize("BASELINE (auto_scale=True)", old_p, old_c, len(chapters))
        summarize("STEP 1  (auto_scale=False)", new_p, new_c, len(chapters))
        delta = len(new_p) - len(old_p)
        sign = "+" if delta >= 0 else ""
        print(f"  >>> Step 1 vs baseline: {sign}{delta} phrases ({sign}{100 * delta / max(1, len(old_p)):.0f}%)")


if __name__ == "__main__":
    main()
