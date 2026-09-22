"""Inspect IPZZ-125 phrase boundaries: baseline vs Step 1, per-chapter.

For each chapter, show baseline and Step 1 phrases side-by-side with per-phrase
motion stats so you can judge whether new boundaries land on real change vs
arbitrary 20s splits.

Outputs an HTML file with one row per chapter, baseline phrases stacked above
Step 1 phrases, both on the same time axis, colored by amplitude range. Click
a phrase to see its stats. Also dumps a per-chapter text summary to stdout for
the chapters where Step 1 added the most phrases.
"""

import html
import json
import sys
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


def run(funscript_path: str, auto_scale: bool):
    """Run per-chapter detection; return list of dicts {chapter_id, phrases:[{start_ms, end_ms, tag, actions:[...]}]}."""
    analyzer = FunscriptAnalyzer(config=AnalyzerConfig())
    analyzer.load(funscript_path)
    _ = analyzer.analyze(progress_callback=None)
    chapters = load_chapters(funscript_path)
    out = []
    for ch_idx, ch in enumerate(chapters):
        ch_start = int(ch.get("at_ms", 0))
        ch_end = int(ch.get("end_ms", 0))
        ch_actions = [a for a in analyzer._actions if ch_start <= a["at"] < ch_end]
        if not ch_actions:
            out.append({"id": ch_idx, "start_ms": ch_start, "end_ms": ch_end, "phrases": [], "actions": []})
            continue
        cfg = AnalyzerConfig()
        cfg.auto_scale_phrases = auto_scale
        sub = FunscriptAnalyzer(config=cfg)
        sub._actions = ch_actions
        sub._source_file = analyzer._source_file
        sub_result = sub.analyze(progress_callback=None)
        phrases = []
        for p in sub_result.phrases:
            ph_actions = [a for a in ch_actions if p.start_ms <= a["at"] < p.end_ms]
            positions = [a["pos"] for a in ph_actions]
            tag = (p.tags[0] if getattr(p, 'tags', None) else None)
            phrases.append({
                "start_ms": p.start_ms,
                "end_ms": p.end_ms,
                "tag": tag,
                "action_count": len(ph_actions),
                "pos_min": min(positions) if positions else 0,
                "pos_max": max(positions) if positions else 0,
                "pos_mean": (sum(positions) / len(positions)) if positions else 0,
            })
        out.append({
            "id": ch_idx,
            "start_ms": ch_start,
            "end_ms": ch_end,
            "phrases": phrases,
            "actions": ch_actions,
        })
    return out


def fmt_dur(ms: int) -> str:
    s = ms / 1000
    return f"{int(s // 60)}:{int(s % 60):02d}"


def color_for_amp(amp: int) -> str:
    """Map amplitude range [0..100] to color. Wider = more saturated red."""
    if amp < 20:
        return "#3a4a5a"  # quiet blue-grey
    if amp < 40:
        return "#5a8a3a"  # green
    if amp < 60:
        return "#c0a020"  # yellow
    if amp < 80:
        return "#d06030"  # orange
    return "#c02020"  # full red


def render_chapter_svg(ch_base, ch_step1, ch_dur_ms, width_px=900):
    """Render one chapter's two phrase rows side-by-side as inline SVG."""
    parts = [f'<svg viewBox="0 0 {width_px} 100" width="{width_px}" height="100" style="background:#111">']
    row_h = 30

    def render_row(phrases, y_top, label):
        # label
        parts.append(f'<text x="2" y="{y_top + row_h/2 + 4}" fill="#888" font-size="10" font-family="monospace">{label}</text>')
        for p in phrases:
            rel_start = (p["start_ms"] - ch_base["start_ms"]) / ch_dur_ms
            rel_end = (p["end_ms"] - ch_base["start_ms"]) / ch_dur_ms
            x = 60 + rel_start * (width_px - 70)
            w = max(1, (rel_end - rel_start) * (width_px - 70))
            amp = p["pos_max"] - p["pos_min"]
            fill = color_for_amp(amp)
            title = (f"ch{ch_base['id']} {fmt_dur(p['start_ms']-ch_base['start_ms'])} → {fmt_dur(p['end_ms']-ch_base['start_ms'])} "
                     f"({(p['end_ms']-p['start_ms'])/1000:.0f}s) "
                     f"n={p['action_count']} pos={p['pos_min']}-{p['pos_max']} mean={p['pos_mean']:.0f} "
                     f"tag={p['tag'] or 'none'}")
            parts.append(
                f'<rect x="{x:.1f}" y="{y_top}" width="{w:.1f}" height="{row_h-2}" fill="{fill}" stroke="#000" stroke-width="0.5">'
                f'<title>{html.escape(title)}</title></rect>'
            )

    render_row(ch_base["phrases"], 5, f"base ({len(ch_base['phrases'])})")
    render_row(ch_step1["phrases"], 5 + row_h + 5, f"step1 ({len(ch_step1['phrases'])})")
    # Chapter duration label
    parts.append(f'<text x="{width_px-2}" y="100" fill="#666" font-size="9" font-family="monospace" text-anchor="end">{ch_dur_ms/1000:.0f}s</text>')
    parts.append("</svg>")
    return "".join(parts)


def render_html(label, baseline_chs, step1_chs, out_path):
    rows = []
    for ch_b, ch_s in zip(baseline_chs, step1_chs):
        dur = ch_b["end_ms"] - ch_b["start_ms"]
        if dur <= 0:
            continue
        svg = render_chapter_svg(ch_b, ch_s, dur)
        delta = len(ch_s["phrases"]) - len(ch_b["phrases"])
        rows.append(
            f'<div style="margin:8px 0; padding:6px; background:#1a1a1a; border-left:3px solid {"#c00" if delta > 3 else "#444"};">'
            f'<div style="color:#aaa; font-family:monospace; font-size:11px; margin-bottom:2px;">'
            f'Chapter {ch_b["id"]:>2} · {fmt_dur(ch_b["start_ms"])} → {fmt_dur(ch_b["end_ms"])} · {dur/1000:.0f}s · '
            f'baseline={len(ch_b["phrases"])} step1={len(ch_s["phrases"])} (Δ={"+" if delta>=0 else ""}{delta})'
            f'</div>'
            f'{svg}'
            f'</div>'
        )
    html_doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html.escape(label)} — phrase A/B</title></head>
<body style="background:#0a0a0a; color:#ddd; font-family:system-ui;">
<h2 style="font-family:monospace;">{html.escape(label)} — Step 1 vs Baseline phrase boundaries</h2>
<p style="color:#aaa;">Top row: baseline (auto_scale=True). Bottom row: Step 1 (auto_scale=False). Hover for stats. Color = amplitude range (blue=quiet → red=wide).</p>
{"".join(rows)}
</body></html>"""
    Path(out_path).write_text(html_doc, encoding="utf-8")
    print(f"wrote: {out_path}")


def dump_text(label, baseline_chs, step1_chs, top_n=5):
    """Print text summary for top-N chapters where Step 1 adds the most phrases."""
    print(f"\n========== {label} ==========")
    pairs = list(zip(baseline_chs, step1_chs))
    pairs_with_delta = [(ch_b, ch_s, len(ch_s["phrases"]) - len(ch_b["phrases"])) for ch_b, ch_s in pairs]
    pairs_with_delta.sort(key=lambda t: -t[2])
    for ch_b, ch_s, delta in pairs_with_delta[:top_n]:
        print(f"\n--- chapter {ch_b['id']} ({fmt_dur(ch_b['start_ms'])} -> {fmt_dur(ch_b['end_ms'])}, {(ch_b['end_ms']-ch_b['start_ms'])/1000:.0f}s)  delta={delta:+d} ---")
        print(f"  BASELINE ({len(ch_b['phrases'])} phrases):")
        for p in ch_b["phrases"]:
            print(f"    {fmt_dur(p['start_ms']-ch_b['start_ms']):>5}-{fmt_dur(p['end_ms']-ch_b['start_ms']):>5} ({(p['end_ms']-p['start_ms'])/1000:>5.1f}s)  n={p['action_count']:>3}  pos={p['pos_min']:>3}-{p['pos_max']:>3} (d{p['pos_max']-p['pos_min']:>3}) mean={p['pos_mean']:>5.1f}  tag={p['tag'] or '-'}")
        print(f"  STEP 1   ({len(ch_s['phrases'])} phrases):")
        for p in ch_s["phrases"]:
            print(f"    {fmt_dur(p['start_ms']-ch_b['start_ms']):>5}-{fmt_dur(p['end_ms']-ch_b['start_ms']):>5} ({(p['end_ms']-p['start_ms'])/1000:>5.1f}s)  n={p['action_count']:>3}  pos={p['pos_min']:>3}-{p['pos_max']:>3} (d{p['pos_max']-p['pos_min']:>3}) mean={p['pos_mean']:>5.1f}  tag={p['tag'] or '-'}")


def main():
    cases = [
        ("IPZZ-125 iris3", r"c:/Users/bruce/Projects/_lqr/forgeassembler/test_media/ipzz125/IPZZ-125.molester.omfg_iris3.funscript"),
    ]
    out_dir = Path(__file__).parent
    for name, path in cases:
        baseline = run(path, auto_scale=True)
        step1 = run(path, auto_scale=False)
        out_html = out_dir / f"{name.replace(' ', '_').replace('-', '_')}_phrase_ab.html"
        render_html(name, baseline, step1, out_html)
        dump_text(name, baseline, step1, top_n=5)


if __name__ == "__main__":
    main()
