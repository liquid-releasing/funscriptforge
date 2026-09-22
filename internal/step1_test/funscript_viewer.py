"""Funscript viewer with phrases-as-colored-background + boundary lines.

For each chapter, render two stacked rows (baseline vs step1). Each row has its
own plot area: funscript line in foreground, per-phrase backgrounds colored by
amplitude range (your "wall of red -> yellow = transition" intuition).

Run on:
  - VictoriaOaks (mashup)
  - IPZZ-125 iris3
  - VO components compared against the matching mashup chapter (mashup_vs_components.html)
"""

import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from assessment.analyzer import AnalyzerConfig, FunscriptAnalyzer
from videoflow.sidecar import forge_dir


def load_chapters_meta(funscript_path: str) -> tuple[list, dict]:
    """Return (chapters list, raw chapters.json dict)."""
    stem = Path(funscript_path).stem
    p = forge_dir(funscript_path) / f"{stem}.chapters.json"
    if not p.exists():
        return [], {}
    with open(p) as f:
        d = json.load(f)
    return d.get("chapters") or [], d


def run(funscript_path: str, auto_scale: bool):
    analyzer = FunscriptAnalyzer(config=AnalyzerConfig())
    analyzer.load(funscript_path)
    _ = analyzer.analyze(progress_callback=None)
    chapters, raw = load_chapters_meta(funscript_path)
    out = []
    for ch_idx, ch in enumerate(chapters):
        ch_start = int(ch.get("at_ms", 0))
        ch_end = int(ch.get("end_ms", 0))
        ch_actions = [a for a in analyzer._actions if ch_start <= a["at"] < ch_end]
        if not ch_actions:
            out.append({"id": ch_idx, "start_ms": ch_start, "end_ms": ch_end, "phrases": [], "actions": [], "meta": ch})
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
            "meta": ch,
        })
    return out


def fmt_dur(ms: int) -> str:
    s = ms / 1000
    return f"{int(s // 60)}:{int(s % 60):02d}"


def color_for_amp(amp: int) -> str:
    """Saturated phrase-background colors keyed to amplitude range."""
    if amp < 15: return "#1a2540"   # deep blue (very quiet)
    if amp < 30: return "#1a4a40"   # teal
    if amp < 45: return "#3a6a25"   # green
    if amp < 60: return "#806620"   # yellow-amber
    if amp < 75: return "#a83820"   # orange-red
    return "#c01818"                # full red (wide motion)


def downsample(actions, target_n=1400):
    if len(actions) <= target_n:
        return actions
    stride = max(1, len(actions) // target_n)
    return actions[::stride]


def render_track(phrases, actions, ch_start_ms, ch_dur_ms, width, plot_h, x_offset, label_color):
    """Render one phrase track: phrase bg colors + funscript polyline + boundary verticals."""
    margin_left = 60
    plot_w = width - margin_left - 8

    def y_for_pos(pos):
        return (1 - pos / 100) * plot_h

    def x_for_ms(ms):
        rel = (ms - ch_start_ms) / ch_dur_ms
        return margin_left + rel * plot_w

    parts = [f'<g transform="translate(0, {x_offset})">']
    # Plot area background (so empty areas don't look broken)
    parts.append(f'<rect x="{margin_left}" y="0" width="{plot_w}" height="{plot_h}" fill="#0a0a0a"/>')

    # Phrase backgrounds (colored by amplitude range)
    for p in phrases:
        x1 = x_for_ms(p["start_ms"])
        x2 = x_for_ms(p["end_ms"])
        amp = p["pos_max"] - p["pos_min"]
        fill = color_for_amp(amp)
        dur_s = (p["end_ms"] - p["start_ms"]) / 1000.0
        title = (f"{fmt_dur(p['start_ms']-ch_start_ms)}-{fmt_dur(p['end_ms']-ch_start_ms)} "
                 f"({dur_s:.0f}s) n={p['action_count']} "
                 f"pos {p['pos_min']}-{p['pos_max']} (d{amp}) mean={p['pos_mean']:.0f} tag={p['tag'] or '-'}")
        parts.append(
            f'<rect x="{x1:.1f}" y="0" width="{max(1, x2-x1):.1f}" height="{plot_h}" fill="{fill}" opacity="0.85">'
            f'<title>{html.escape(title)}</title></rect>'
        )

    # Funscript polyline ON TOP of phrase backgrounds
    if actions:
        path_pts = [f"{x_for_ms(a['at']):.1f},{y_for_pos(a['pos']):.1f}" for a in downsample(actions)]
        parts.append(
            f'<polyline points="{" ".join(path_pts)}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.85"/>'
        )

    # Boundary verticals (bright, prominent)
    for p in phrases:
        x = x_for_ms(p["start_ms"])
        parts.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{plot_h}" stroke="#fff" stroke-width="1" opacity="0.9"/>')

    # Side label
    parts.append(f'<text x="2" y="{plot_h/2 + 3:.1f}" fill="{label_color}" font-size="11" font-family="monospace" font-weight="600">{len(phrases)}</text>')

    parts.append('</g>')
    return "".join(parts)


def render_chapter(ch_base, ch_step1, ch_dur_ms, width=1400, plot_h=80, gap=4):
    """Two stacked tracks per chapter."""
    total_h = 2 * plot_h + gap
    parts = [f'<svg viewBox="0 0 {width} {total_h}" width="{width}" height="{total_h}" style="background:#000; display:block;">']
    parts.append(render_track(ch_base["phrases"], ch_base["actions"], ch_base["start_ms"], ch_dur_ms, width, plot_h, 0, "#4090c0"))
    parts.append(render_track(ch_step1["phrases"], ch_step1["actions"], ch_step1["start_ms"], ch_dur_ms, width, plot_h, plot_h + gap, "#c060c0"))
    parts.append("</svg>")
    return "".join(parts)


def render_html(label, baseline_chs, step1_chs, out_path):
    total_base = sum(len(c["phrases"]) for c in baseline_chs)
    total_step1 = sum(len(c["phrases"]) for c in step1_chs)
    rows = []
    for ch_b, ch_s in zip(baseline_chs, step1_chs):
        dur = ch_b["end_ms"] - ch_b["start_ms"]
        if dur <= 0:
            continue
        delta = len(ch_s["phrases"]) - len(ch_b["phrases"])
        accent = "#c60" if delta > 5 else ("#a90" if delta > 2 else "#444")
        ct = ch_b.get("meta", {}).get("content_type", "?")
        vl = ch_b.get("meta", {}).get("voice_label", "?")
        evidence = ch_b.get("meta", {}).get("evidence", [])
        svg = render_chapter(ch_b, ch_s, dur)
        rows.append(
            f'<div style="margin:10px 0; padding:8px; background:#181818; border-left:3px solid {accent}; border-radius:3px;">'
            f'<div style="color:#ccc; font-family:monospace; font-size:12px; margin-bottom:4px;">'
            f'<b>Chapter {ch_b["id"]:>2}</b> &nbsp; {fmt_dur(ch_b["start_ms"])} -&gt; {fmt_dur(ch_b["end_ms"])} '
            f'&nbsp; {dur/1000:.0f}s '
            f'&nbsp; <span style="color:#888;">{ct} / {vl}</span> '
            f'&nbsp; <span style="color:#4090c0">base={len(ch_b["phrases"])}</span> '
            f'<span style="color:#c060c0">step1={len(ch_s["phrases"])}</span> '
            f'<span style="color:{accent}">delta={"+" if delta>=0 else ""}{delta}</span>'
            f'</div>'
            f'{svg}'
            f'</div>'
        )
    html_doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html.escape(label)} - funscript viewer</title></head>
<body style="background:#0a0a0a; color:#ddd; font-family:system-ui; margin:18px;">
<h2 style="font-family:monospace; margin:0 0 4px;">{html.escape(label)}</h2>
<div style="color:#aaa; font-size:13px; margin-bottom:14px;">
Each chapter = two stacked rows. Top = <span style="color:#4090c0">BASELINE</span>
(auto_scale=True). Bottom = <span style="color:#c060c0">STEP 1</span> (auto_scale=False).<br/>
Each phrase fills its time span with a <b>background color</b> = amplitude range:
<span style="background:#1a2540; color:#fff; padding:1px 6px;">very quiet</span>
<span style="background:#1a4a40; color:#fff; padding:1px 6px;">teal</span>
<span style="background:#3a6a25; color:#fff; padding:1px 6px;">green</span>
<span style="background:#806620; color:#fff; padding:1px 6px;">amber</span>
<span style="background:#a83820; color:#fff; padding:1px 6px;">orange</span>
<span style="background:#c01818; color:#fff; padding:1px 6px;">wide red</span>.
White line = funscript position (0 bottom -&gt; 100 top). White vertical lines = phrase boundaries. Hover any phrase for stats.
&nbsp; Total: base={total_base}, step1={total_step1} (delta={"+" if total_step1-total_base>=0 else ""}{total_step1-total_base}).
</div>
{"".join(rows)}
</body></html>"""
    Path(out_path).write_text(html_doc, encoding="utf-8")
    print(f"wrote: {out_path}")


def main():
    cases = [
        ("VictoriaOaks", r"c:/Users/bruce/Projects/_lqr/funscriptforge/test_funscript/VictoriaOaks_stingy.original.funscript"),
        ("IPZZ-125 iris3", r"c:/Users/bruce/Projects/_lqr/forgeassembler/test_media/ipzz125/IPZZ-125.molester.omfg_iris3.funscript"),
    ]
    out_dir = Path(__file__).parent
    for name, path in cases:
        if not Path(path).exists():
            print(f"skip (missing): {name} -> {path}")
            continue
        chapters, _ = load_chapters_meta(path)
        if not chapters:
            print(f"skip (no chapters): {name}")
            continue
        baseline = run(path, auto_scale=True)
        step1 = run(path, auto_scale=False)
        out_html = out_dir / f"{name.replace(' ', '_').replace('-', '_')}_funscript_viewer.html"
        render_html(name, baseline, step1, out_html)


if __name__ == "__main__":
    main()
