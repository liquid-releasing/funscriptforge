"""generate_doc_charts.py — Generate documentation chart images for the user guide.

Outputs PNG files to docs/guide/media/ with companion .caption.md files.

Usage:
    python docs/generate_doc_charts.py

Requires: matplotlib
"""

import json
import os
import sys

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    import matplotlib.ticker as ticker
except ImportError:
    print("matplotlib required: pip install matplotlib")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA_DIR = os.path.join(ROOT, "docs", "guide", "media")
os.makedirs(MEDIA_DIR, exist_ok=True)


# ── Colour palette (matches dark app theme, readable on white too) ────────────
BPM_LOW_COLOR   = "#888888"   # ambient / break / slow  (< 60 BPM)
BPM_MID_COLOR   = "#6c63ff"   # moderate rhythmic       (60–110 BPM)
BPM_HIGH_COLOR  = "#e0a055"   # energetic / frantic     (> 110 BPM)
WAVEFORM_COLOR  = "#4a9eff"
PHRASE_ALPHA    = 0.18


def bpm_color(bpm: float) -> str:
    if bpm < 60:
        return BPM_LOW_COLOR
    if bpm < 110:
        return BPM_MID_COLOR
    return BPM_HIGH_COLOR


def fmt_ms(ms: float) -> str:
    ms = int(ms)
    m = ms // 60_000
    s = (ms % 60_000) // 1_000
    return f"{m}:{s:02d}"


def ms_ticker(x, _):
    return fmt_ms(x)


# ── Chart 1: full phrase overview ─────────────────────────────────────────────

def chart_phrase_overview(funscript_path: str, assessment_path: str, out_path: str) -> dict:
    """Full waveform with phrase bounding boxes colour-coded by BPM."""

    with open(funscript_path, encoding="utf-8") as f:
        actions = json.load(f)["actions"]
    with open(assessment_path, encoding="utf-8") as f:
        assessment = json.load(f)

    times = [a["at"] for a in actions]
    positions = [a["pos"] for a in actions]
    phrases = assessment["phrases"]
    duration_ms = assessment["meta"]["duration_ms"]
    avg_bpm = assessment["meta"]["bpm"]
    n_phrases = len(phrases)

    fig, ax = plt.subplots(figsize=(16, 4.5))
    fig.patch.set_facecolor("#0d0d0f")
    ax.set_facecolor("#0d0d0f")

    # Phrase boxes
    y_min, y_max = -3, 103
    for i, p in enumerate(phrases):
        color = bpm_color(p["bpm"])
        rect = mpatches.FancyBboxPatch(
            (p["start_ms"], y_min),
            p["end_ms"] - p["start_ms"],
            y_max - y_min,
            boxstyle="round,pad=0",
            linewidth=0.8,
            edgecolor=color,
            facecolor=color,
            alpha=PHRASE_ALPHA,
            zorder=1,
        )
        ax.add_patch(rect)
        # Phrase number label at top
        mid = (p["start_ms"] + p["end_ms"]) / 2
        ax.text(mid, 97, str(i + 1), ha="center", va="top",
                fontsize=6, color=color, alpha=0.9, zorder=4)

    # Waveform
    ax.plot(times, positions, color=WAVEFORM_COLOR, linewidth=0.6, zorder=3, alpha=0.9)

    # Axes
    ax.xaxis.set_major_formatter(ticker.FuncFormatter(ms_ticker))
    ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=16))
    plt.setp(ax.get_xticklabels(), rotation=0, ha="center", fontsize=8, color="#aaaaaa")
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_yticklabels(["0", "25", "50", "75", "100"], fontsize=8, color="#aaaaaa")
    ax.set_xlim(0, duration_ms)
    ax.set_ylim(y_min, y_max + 4)
    ax.tick_params(axis="both", colors="#444444")
    for spine in ax.spines.values():
        spine.set_edgecolor("#222222")

    # Legend
    legend_patches = [
        mpatches.Patch(color=BPM_HIGH_COLOR, alpha=0.7, label="High BPM (>110)"),
        mpatches.Patch(color=BPM_MID_COLOR,  alpha=0.7, label="Mid BPM (60–110)"),
        mpatches.Patch(color=BPM_LOW_COLOR,  alpha=0.7, label="Low BPM (<60)"),
    ]
    ax.legend(handles=legend_patches, loc="upper right", fontsize=8,
              facecolor="#161618", edgecolor="#333333", labelcolor="#aaaaaa")

    ax.set_title(
        f"Timeline1.funscript  ·  {n_phrases} phrases  ·  {avg_bpm:.0f} BPM avg  ·  {fmt_ms(duration_ms)}",
        fontsize=10, color="#e8eaf0", pad=8,
    )
    ax.set_xlabel("Time", fontsize=9, color="#888888")
    ax.set_ylabel("Position (0–100)", fontsize=9, color="#888888")

    plt.tight_layout(pad=1.2)
    plt.savefig(out_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close()
    print(f"  Saved: {out_path}")

    return {
        "image": os.path.basename(out_path),
        "page": "docs/guide/01-getting-started/your-first-funscript.md",
        "task": "Load your script",
        "type": "chart",
        "tags": "phrase chart, assessment, color coding, BPM, waveform",
        "description": (
            f"The FunscriptForge phrase overview chart for Timeline1.funscript. "
            f"The full waveform runs left to right across {fmt_ms(duration_ms)}. "
            f"{n_phrases} phrase bounding boxes are overlaid on the chart, numbered 1–{n_phrases}. "
            f"Box color indicates BPM: orange/warm = high BPM (energetic sections), "
            f"purple/blue = moderate BPM (rhythmic sections), grey = low BPM (ambient or break). "
            f"The waveform shows a relatively flat section from 0:00–1:26 (phrases 1–4, low activity), "
            f"a dense high-BPM peak from 1:26–2:10 (phrases 5–28, energetic), "
            f"and a tapering section from 2:10–3:13 (phrases 29–34). "
            f"Average BPM: {avg_bpm:.0f}. Total actions: {len(actions)}."
        ),
    }


# ── Chart 2: single phrase detail ─────────────────────────────────────────────

def chart_single_phrase(funscript_path: str, assessment_path: str,
                        phrase_index: int, out_path: str) -> dict:
    """Zoom into one phrase showing cycle-level detail."""

    with open(funscript_path, encoding="utf-8") as f:
        actions = json.load(f)["actions"]
    with open(assessment_path, encoding="utf-8") as f:
        assessment = json.load(f)

    phrase = assessment["phrases"][phrase_index]
    start, end = phrase["start_ms"], phrase["end_ms"]
    bpm = phrase["bpm"]
    cycles = phrase["cycle_count"]

    # Filter actions to phrase window
    window = [a for a in actions if start <= a["at"] <= end]
    times = [a["at"] for a in window]
    positions = [a["pos"] for a in window]

    fig, ax = plt.subplots(figsize=(10, 3.5))
    fig.patch.set_facecolor("#0d0d0f")
    ax.set_facecolor("#0d0d0f")

    color = bpm_color(bpm)

    # Shade the phrase
    ax.axvspan(start, end, alpha=0.12, color=color, zorder=1)

    # Waveform
    ax.plot(times, positions, color=WAVEFORM_COLOR, linewidth=1.2, zorder=3)
    ax.scatter(times, positions, color=color, s=8, zorder=4, alpha=0.7)

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(ms_ticker))
    ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=10))
    plt.setp(ax.get_xticklabels(), rotation=0, ha="center", fontsize=8, color="#aaaaaa")
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_yticklabels(["0", "25", "50", "75", "100"], fontsize=8, color="#aaaaaa")
    ax.set_xlim(start - (end - start) * 0.02, end + (end - start) * 0.02)
    ax.set_ylim(-5, 112)
    ax.tick_params(axis="both", colors="#444444")
    for spine in ax.spines.values():
        spine.set_edgecolor("#222222")

    dur_s = (end - start) / 1000
    ax.set_title(
        f"Phrase {phrase_index + 1}  ·  {fmt_ms(start)}–{fmt_ms(end)}  "
        f"·  {dur_s:.1f}s  ·  {bpm:.0f} BPM  ·  {cycles} cycles",
        fontsize=10, color="#e8eaf0", pad=8,
    )
    ax.set_xlabel("Time", fontsize=9, color="#888888")
    ax.set_ylabel("Position (0–100)", fontsize=9, color="#888888")

    plt.tight_layout(pad=1.2)
    plt.savefig(out_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close()
    print(f"  Saved: {out_path}")

    return {
        "image": os.path.basename(out_path),
        "page": "docs/guide/02-understand-your-script/reading-the-assessment.md",
        "task": "Read your assessment",
        "type": "chart",
        "tags": f"phrase detail, single phrase, phrase {phrase_index + 1}, cycles, BPM",
        "description": (
            f"Close-up chart of Phrase {phrase_index + 1} from Timeline1.funscript. "
            f"Time range: {fmt_ms(start)} to {fmt_ms(end)} ({dur_s:.1f} seconds). "
            f"BPM: {bpm:.0f}. Cycle count: {cycles}. "
            f"Individual action dots are visible, showing the up-down oscillation pattern. "
            f"The waveform shows {'full-range strokes (0–100)' if max(positions) > 80 and min(positions) < 20 else 'partial-range strokes'}. "
            f"Box color is {'orange (high BPM, energetic)' if bpm > 110 else 'purple (moderate BPM)' if bpm >= 60 else 'grey (low BPM, ambient)'}."
        ),
    }


def write_caption(meta: dict, out_dir: str) -> None:
    name = os.path.splitext(meta["image"])[0]
    caption_path = os.path.join(out_dir, f"{name}.caption.md")
    lines = [
        "---",
        f'image: {meta["image"]}',
        f'page: {meta["page"]}',
        f'task: {meta["task"]}',
        f'type: {meta["type"]}',
        f'tags: {meta["tags"]}',
        "---",
        "",
        meta["description"],
        "",
    ]
    with open(caption_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  Caption: {caption_path}")


if __name__ == "__main__":
    funscript = os.path.join(ROOT, "test_funscript", "Timeline1.original.funscript")
    assessment = os.path.join(ROOT, "output", "Timeline1.original.assessment.json")

    print("Generating documentation charts...")

    # Chart 1: full phrase overview
    out1 = os.path.join(MEDIA_DIR, "your-first-funscript--phrase-overview.png")
    meta1 = chart_phrase_overview(funscript, assessment, out1)
    write_caption(meta1, MEDIA_DIR)

    # Chart 2: phrase 28 — 6.7s, 14 cycles, 125 BPM — good oscillation visibility
    out2 = os.path.join(MEDIA_DIR, "reading-assessment--phrase-detail.png")
    meta2 = chart_single_phrase(funscript, assessment, 27, out2)
    write_caption(meta2, MEDIA_DIR)

    print("\nDone. Files written to docs/guide/media/")
