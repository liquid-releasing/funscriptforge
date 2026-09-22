"""Step 1 only — single track per chapter, taller for detail.

For each chapter: one plot area showing Step 1 phrases as colored backgrounds
with the funscript line on top. No baseline comparison row. Use this when you
want to annotate where you'd change something.
"""

import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from funscript_viewer import (
    color_for_amp, downsample, fmt_dur, load_chapters_meta, run,
)


def render_track(phrases, actions, ch_start_ms, ch_dur_ms, width, plot_h):
    margin_left = 70
    plot_w = width - margin_left - 8

    def y_for_pos(pos):
        return (1 - pos / 100) * plot_h

    def x_for_ms(ms):
        rel = (ms - ch_start_ms) / ch_dur_ms
        return margin_left + rel * plot_w

    parts = [f'<rect x="{margin_left}" y="0" width="{plot_w}" height="{plot_h}" fill="#0a0a0a"/>']

    # Phrase backgrounds
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
            f'<rect x="{x1:.1f}" y="0" width="{max(1, x2-x1):.1f}" height="{plot_h}" fill="{fill}" opacity="0.92">'
            f'<title>{html.escape(title)}</title></rect>'
        )

    # Funscript polyline (thicker for visibility in tall row)
    if actions:
        path_pts = [f"{x_for_ms(a['at']):.1f},{y_for_pos(a['pos']):.1f}" for a in downsample(actions, target_n=2000)]
        parts.append(
            f'<polyline points="{" ".join(path_pts)}" fill="none" stroke="#fff" stroke-width="0.9" opacity="0.9"/>'
        )

    # Boundary verticals
    for p in phrases:
        x = x_for_ms(p["start_ms"])
        parts.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{plot_h}" stroke="#fff" stroke-width="1.2" opacity="0.95"/>')

    # Phrase count label (left side, vertical center)
    parts.append(f'<text x="6" y="{plot_h/2 + 4:.1f}" fill="#c060c0" font-size="14" font-family="monospace" font-weight="700">step1</text>')
    parts.append(f'<text x="6" y="{plot_h/2 + 22:.1f}" fill="#c060c0" font-size="14" font-family="monospace" font-weight="700">n={len(phrases)}</text>')

    return "".join(parts)


def render_chapter(ch_step1, ch_dur_ms, width=1500, plot_h=160):
    parts = [f'<svg viewBox="0 0 {width} {plot_h}" width="{width}" height="{plot_h}" style="background:#000; display:block;">']
    parts.append(render_track(ch_step1["phrases"], ch_step1["actions"], ch_step1["start_ms"], ch_dur_ms, width, plot_h))
    parts.append("</svg>")
    return "".join(parts)


def render_html(label, step1_chs, out_path):
    total_step1 = sum(len(c["phrases"]) for c in step1_chs)
    rows = []
    for ch_s in step1_chs:
        dur = ch_s["end_ms"] - ch_s["start_ms"]
        if dur <= 0:
            continue
        ct = ch_s.get("meta", {}).get("content_type", "?")
        vl = ch_s.get("meta", {}).get("voice_label", "?")
        svg = render_chapter(ch_s, dur)
        rows.append(
            f'<div style="margin:12px 0; padding:10px; background:#181818; border-radius:3px;">'
            f'<div style="color:#ddd; font-family:monospace; font-size:13px; margin-bottom:6px;">'
            f'<b>Chapter {ch_s["id"]:>2}</b> &nbsp; {fmt_dur(ch_s["start_ms"])} -&gt; {fmt_dur(ch_s["end_ms"])} '
            f'&nbsp; {dur/1000:.0f}s '
            f'&nbsp; <span style="color:#888;">{ct} / {vl}</span> '
            f'&nbsp; <span style="color:#c060c0">step1={len(ch_s["phrases"])} phrases</span>'
            f'</div>'
            f'{svg}'
            f'</div>'
        )
    html_doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html.escape(label)} - Step 1 only</title></head>
<body style="background:#0a0a0a; color:#ddd; font-family:system-ui; margin:18px;">
<h2 style="font-family:monospace; margin:0 0 4px;">{html.escape(label)} - Step 1 only (tall view)</h2>
<div style="color:#aaa; font-size:13px; margin-bottom:14px;">
One row per chapter showing only Step 1 phrases.
Phrase background colors by amplitude:
<span style="background:#1a2540; color:#fff; padding:1px 6px;">very quiet</span>
<span style="background:#1a4a40; color:#fff; padding:1px 6px;">teal</span>
<span style="background:#3a6a25; color:#fff; padding:1px 6px;">green</span>
<span style="background:#806620; color:#fff; padding:1px 6px;">amber</span>
<span style="background:#a83820; color:#fff; padding:1px 6px;">orange</span>
<span style="background:#c01818; color:#fff; padding:1px 6px;">wide red</span>.
White line = funscript pos (0 bottom -&gt; 100 top). White verticals = phrase boundaries. Hover any phrase for stats.
Total: {total_step1} phrases.
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
            print(f"skip (missing): {name}")
            continue
        chapters, _ = load_chapters_meta(path)
        if not chapters:
            print(f"skip (no chapters): {name}")
            continue
        step1 = run(path, auto_scale=False)
        out_html = out_dir / f"{name.replace(' ', '_').replace('-', '_')}_step1_only.html"
        render_html(name, step1, out_html)


if __name__ == "__main__":
    main()
