"""Step 2 viewer — compare Step 1 vs (Step 1 + Step 2 character-drift).

For each chapter: two stacked rows.
  Top   = Step 1 (purple label)
  Bottom= Step 1 + Step 2 (orange label, with evidence-color borders on new splits)

Color encoding inside boundaries: phrase-bg colored by amplitude range (same as
funscript_viewer.py). Bottom-row boundary lines are color-coded by evidence:
  white     = unchanged Step 1 boundary (no drift, no snap)
  cyan      = snap_only (Step 1 boundary moved to downbeat)
  yellow    = bottom_drift split
  magenta   = top_drift split
  orange    = both top + bottom drift
"""

import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from character_drift_v1 import split_phrases as step2_split_phrases
from funscript_viewer import (
    color_for_amp, downsample, fmt_dur, load_chapters_meta, run,
)
from videoflow.sidecar import forge_dir


def load_downbeats(funscript_path: str) -> list:
    """Load downbeats from <stem>.beats.json sidecar if present."""
    stem = Path(funscript_path).stem
    p = forge_dir(funscript_path) / f"{stem}.beats.json"
    if not p.exists():
        return []
    with open(p) as f:
        d = json.load(f)
    return d.get("downbeats_ms") or []


def evidence_color(evidence) -> str:
    if not evidence:
        return "#ffffff"
    s = set(evidence or [])
    if s == {"seed"}:
        return "#ffffff"
    if s == {"snap_only"}:
        return "#60d0e0"  # cyan
    if s == {"drone_grid"}:
        return "#a0a0a0"  # grey (editing grid in drone)
    if "density_drift" in s and len(s) == 1:
        return "#60ff60"  # green (density-only drift)
    if "top_drift" in s and "bottom_drift" in s:
        return "#ff9020"  # orange (top+bottom)
    if "top_drift" in s:
        return "#ff60d0"  # magenta
    if "bottom_drift" in s:
        return "#ffd020"  # yellow
    return "#60ff60"  # density mixed


class _PhraseShim:
    """Minimal phrase-like object accepted by character_drift.split_phrases."""
    def __init__(self, p_dict, chapter_id):
        self.start_ms = p_dict["start_ms"]
        self.end_ms = p_dict["end_ms"]
        self.tags = [p_dict["tag"]] if p_dict.get("tag") else []
        self.tag = p_dict.get("tag")
        self.action_count = p_dict.get("action_count", 0)
        self.pos_min = p_dict.get("pos_min", 0)
        self.pos_max = p_dict.get("pos_max", 100)
        self.pos_mean = p_dict.get("pos_mean", 50)
        self.evidence = []
        self.chapter_id = chapter_id


def step2_for_chapter(ch_step1_dict, actions, downbeats_ms):
    """Run Step 2 on one chapter's Step 1 phrases. Returns enriched dict list."""
    shims = [_PhraseShim(p, chapter_id=ch_step1_dict["id"]) for p in ch_step1_dict["phrases"]]
    new_phrases = step2_split_phrases(shims, actions, downbeats_ms=downbeats_ms)
    out = []
    for s in new_phrases:
        ph_acts = [a for a in actions if s.start_ms <= a["at"] < s.end_ms]
        positions = [a["pos"] for a in ph_acts]
        out.append({
            "start_ms": s.start_ms,
            "end_ms": s.end_ms,
            "tag": s.tag,
            "evidence": getattr(s, "evidence", []),
            "action_count": len(ph_acts),
            "pos_min": min(positions) if positions else 0,
            "pos_max": max(positions) if positions else 0,
            "pos_mean": (sum(positions) / len(positions)) if positions else 0,
        })
    return out


def render_track(phrases, actions, ch_start_ms, ch_dur_ms, width, plot_h, label_color, label, evidence_colored_lines=False):
    margin_left = 70
    plot_w = width - margin_left - 8

    def y_for_pos(pos):
        return (1 - pos / 100) * plot_h

    def x_for_ms(ms):
        rel = (ms - ch_start_ms) / ch_dur_ms
        return margin_left + rel * plot_w

    parts = [f'<rect x="{margin_left}" y="0" width="{plot_w}" height="{plot_h}" fill="#0a0a0a"/>']
    for p in phrases:
        x1 = x_for_ms(p["start_ms"])
        x2 = x_for_ms(p["end_ms"])
        amp = p["pos_max"] - p["pos_min"]
        fill = color_for_amp(amp)
        ev = p.get("evidence", [])
        ev_str = ",".join(ev) if ev else "-"
        dur_s = (p["end_ms"] - p["start_ms"]) / 1000.0
        title = (f"{fmt_dur(p['start_ms']-ch_start_ms)}-{fmt_dur(p['end_ms']-ch_start_ms)} "
                 f"({dur_s:.0f}s) n={p['action_count']} "
                 f"pos {p['pos_min']}-{p['pos_max']} (d{amp}) mean={p['pos_mean']:.0f} "
                 f"tag={p['tag'] or '-'} ev={ev_str}")
        parts.append(
            f'<rect x="{x1:.1f}" y="0" width="{max(1, x2-x1):.1f}" height="{plot_h}" fill="{fill}" opacity="0.92">'
            f'<title>{html.escape(title)}</title></rect>'
        )

    if actions:
        path_pts = [f"{x_for_ms(a['at']):.1f},{y_for_pos(a['pos']):.1f}" for a in downsample(actions, target_n=2000)]
        parts.append(
            f'<polyline points="{" ".join(path_pts)}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.9"/>'
        )

    for idx, p in enumerate(phrases):
        x = x_for_ms(p["start_ms"])
        if evidence_colored_lines and idx > 0:
            color = evidence_color(p.get("evidence"))
            sw = "1.6" if p.get("evidence") and "seed" not in p["evidence"] else "1.0"
        else:
            color = "#fff"
            sw = "1.0"
        parts.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{plot_h}" stroke="{color}" stroke-width="{sw}" opacity="0.95"/>')

    parts.append(f'<text x="6" y="{plot_h/2 - 4:.1f}" fill="{label_color}" font-size="12" font-family="monospace" font-weight="700">{label}</text>')
    parts.append(f'<text x="6" y="{plot_h/2 + 12:.1f}" fill="{label_color}" font-size="12" font-family="monospace" font-weight="700">n={len(phrases)}</text>')
    return "".join(parts)


def render_chapter(ch_step1, ch_step2_phrases, ch_dur_ms, ch_actions, width=1500, plot_h=140, gap=6):
    total_h = 2 * plot_h + gap
    parts = [f'<svg viewBox="0 0 {width} {total_h}" width="{width}" height="{total_h}" style="background:#000; display:block;">']
    parts.append(f'<g transform="translate(0, 0)">')
    parts.append(render_track(ch_step1["phrases"], ch_actions, ch_step1["start_ms"], ch_dur_ms, width, plot_h, "#c060c0", "step1"))
    parts.append('</g>')
    parts.append(f'<g transform="translate(0, {plot_h + gap})">')
    parts.append(render_track(ch_step2_phrases, ch_actions, ch_step1["start_ms"], ch_dur_ms, width, plot_h, "#ffa030", "step2", evidence_colored_lines=True))
    parts.append('</g>')
    parts.append("</svg>")
    return "".join(parts)


def render_html(label, step1_chs, step2_chs_phrases, out_path, n_downbeats):
    total_s1 = sum(len(c["phrases"]) for c in step1_chs)
    total_s2 = sum(len(p) for p in step2_chs_phrases)
    rows = []
    for ch_s1, s2_ph in zip(step1_chs, step2_chs_phrases):
        dur = ch_s1["end_ms"] - ch_s1["start_ms"]
        if dur <= 0:
            continue
        ct = ch_s1.get("meta", {}).get("content_type", "?")
        vl = ch_s1.get("meta", {}).get("voice_label", "?")
        delta = len(s2_ph) - len(ch_s1["phrases"])
        accent = "#fa3" if delta > 3 else ("#c70" if delta > 0 else "#444")
        # count evidence types in step2
        ev_counter = {}
        for p in s2_ph:
            for e in (p.get("evidence") or ["-"]):
                ev_counter[e] = ev_counter.get(e, 0) + 1
        ev_summary = " ".join(f"{k}={v}" for k, v in sorted(ev_counter.items()))
        svg = render_chapter(ch_s1, s2_ph, dur, ch_s1["actions"])
        rows.append(
            f'<div style="margin:10px 0; padding:8px; background:#181818; border-left:3px solid {accent}; border-radius:3px;">'
            f'<div style="color:#ccc; font-family:monospace; font-size:12px; margin-bottom:4px;">'
            f'<b>Chapter {ch_s1["id"]:>2}</b> &nbsp; {fmt_dur(ch_s1["start_ms"])} -&gt; {fmt_dur(ch_s1["end_ms"])} &nbsp; {dur/1000:.0f}s '
            f'&nbsp; <span style="color:#888;">{ct} / {vl}</span> '
            f'&nbsp; <span style="color:#c060c0">step1={len(ch_s1["phrases"])}</span> '
            f'<span style="color:#ffa030">step2={len(s2_ph)}</span> '
            f'<span style="color:{accent}">delta={"+" if delta>=0 else ""}{delta}</span> '
            f'&nbsp; <span style="color:#888;">[{ev_summary}]</span>'
            f'</div>'
            f'{svg}'
            f'</div>'
        )
    html_doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{html.escape(label)} - Step 2 A/B</title></head>
<body style="background:#0a0a0a; color:#ddd; font-family:system-ui; margin:18px;">
<h2 style="font-family:monospace; margin:0 0 4px;">{html.escape(label)} - Step 1 vs Step 2</h2>
<div style="color:#aaa; font-size:13px; margin-bottom:14px;">
Each chapter = two rows. Top = <span style="color:#c060c0">STEP 1</span> (auto_scale=False).
Bottom = <span style="color:#ffa030">STEP 2</span> = Step 1 + character-drift splitter + downbeat snap.
Bottom-row vertical line color = evidence of the boundary:
<span style="color:#fff">white = unchanged Step 1</span>,
<span style="color:#60d0e0">cyan = snap_only (beat-aligned)</span>,
<span style="color:#a0a0a0">grey = drone_grid (beat-aligned grid in drone)</span>,
<span style="color:#ffd020">yellow = bottom_drift</span>,
<span style="color:#ff60d0">magenta = top_drift</span>,
<span style="color:#ff9020">orange = top+bottom</span>,
<span style="color:#60ff60">green = density_drift (sparsity change)</span>.
Phrase bg color = amplitude range (blue=quiet -&gt; red=wide).
Downbeats available: {n_downbeats}. &nbsp; Totals: step1={total_s1}, step2={total_s2} (delta={"+" if total_s2-total_s1>=0 else ""}{total_s2-total_s1}).
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
        downbeats = load_downbeats(path)
        print(f"{name}: {len(downbeats)} downbeats")
        step1 = run(path, auto_scale=False)
        step2_per_chapter = []
        for ch in step1:
            s2 = step2_for_chapter(ch, ch["actions"], downbeats)
            step2_per_chapter.append(s2)
        out_html = out_dir / f"{name.replace(' ', '_').replace('-', '_')}_step2.html"
        render_html(name, step1, step2_per_chapter, out_html, len(downbeats))


if __name__ == "__main__":
    main()
