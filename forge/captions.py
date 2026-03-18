"""
Caption parser for SRT and WebVTT files.

parse_captions(caption_path) -> list[dict]
  Parses .srt or .vtt file, returns list of dicts:
    {"index": int, "start_ms": int, "end_ms": int, "text": str}

save_captions_json(captions, output_folder) -> str
  Serialises captions as human-readable JSON (timestamp strings + text)
  to _captions.json.  Returns the path written.

load_captions(output_folder) -> list[dict] | None
  Loads cached _captions.json if it exists.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


CAPTIONS_JSON = "_captions.json"

# ── Timestamp regex ─────────────────────────────────────────────────────────
# Matches  HH:MM:SS,mmm  (SRT)  or  HH:MM:SS.mmm  (VTT)
_TS_RE = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})"
)
# VTT cue position line:  START --> END [optional settings]
_CUE_RE = re.compile(
    r"(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})"
)


# ── Public API ──────────────────────────────────────────────────────────────

def parse_captions(caption_path: str) -> list[dict]:
    """Parse an .srt or .vtt file.

    Returns list of dicts, each with:
        index     – 1-based integer
        start_ms  – int
        end_ms    – int
        text      – str (multi-line joined with space)
    """
    path = Path(caption_path)
    if not path.exists():
        raise FileNotFoundError(f"Caption file not found: {caption_path}")

    text = path.read_text(encoding="utf-8-sig")   # utf-8-sig strips BOM

    ext = path.suffix.lower()
    if ext == ".vtt":
        return _parse_vtt(text)
    # Default to SRT (also handles .srt, .txt exports from some tools)
    return _parse_srt(text)


def save_captions_json(captions: list[dict], output_folder: str) -> str:
    """Write captions to _captions.json with human-readable timestamps.

    Returns the path written.
    """
    out = Path(output_folder)
    out.mkdir(parents=True, exist_ok=True)
    dest = out / CAPTIONS_JSON

    # Add human-readable timestamp strings alongside ms values
    serialised = []
    for c in captions:
        serialised.append({
            "index":      c["index"],
            "start":      _ms_to_ts(c["start_ms"]),
            "end":        _ms_to_ts(c["end_ms"]),
            "start_ms":   c["start_ms"],
            "end_ms":     c["end_ms"],
            "text":       c["text"],
        })

    with open(dest, "w", encoding="utf-8") as f:
        json.dump(serialised, f, indent=2, ensure_ascii=False)

    return str(dest)


def load_captions(output_folder: str) -> list[dict] | None:
    """Return cached caption data or None."""
    p = Path(output_folder) / CAPTIONS_JSON
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ── Parsers ─────────────────────────────────────────────────────────────────

def _parse_srt(text: str) -> list[dict]:
    """Parse SubRip (.srt) format."""
    captions = []
    # Split on blank lines; each block is one cue
    blocks = re.split(r"\n\s*\n", text.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue

        # First non-empty line that is purely digits is the sequence number
        idx = 0
        seq_line = lines[0].strip()
        if seq_line.isdigit():
            idx = int(seq_line)
            lines = lines[1:]

        if not lines:
            continue

        m = _CUE_RE.match(lines[0])
        if not m:
            continue

        start_ms = _ts_to_ms(m.group(1))
        end_ms   = _ts_to_ms(m.group(2))
        body     = " ".join(l.strip() for l in lines[1:] if l.strip())

        if not body:
            continue

        captions.append({
            "index":    idx or len(captions) + 1,
            "start_ms": start_ms,
            "end_ms":   end_ms,
            "text":     _strip_tags(body),
        })

    return captions


def _parse_vtt(text: str) -> list[dict]:
    """Parse WebVTT (.vtt) format."""
    captions = []
    # Strip the WEBVTT header
    text = re.sub(r"^WEBVTT.*?\n", "", text, count=1)

    blocks = re.split(r"\n\s*\n", text.strip())
    idx = 0
    for block in blocks:
        lines = block.strip().splitlines()
        if not lines:
            continue

        # Optional cue identifier (non-arrow line before timing)
        cue_id = None
        if lines and "-->" not in lines[0]:
            cue_id = lines[0].strip()
            lines  = lines[1:]

        if not lines:
            continue

        m = _CUE_RE.match(lines[0])
        if not m:
            continue

        idx += 1
        start_ms = _ts_to_ms(m.group(1))
        end_ms   = _ts_to_ms(m.group(2))
        body     = " ".join(l.strip() for l in lines[1:] if l.strip())

        if not body:
            continue

        # Honour numeric cue identifiers when present
        cue_num = idx
        if cue_id and cue_id.isdigit():
            cue_num = int(cue_id)

        captions.append({
            "index":    cue_num,
            "start_ms": start_ms,
            "end_ms":   end_ms,
            "text":     _strip_tags(body),
        })

    return captions


# ── Timestamp helpers ────────────────────────────────────────────────────────

def _ts_to_ms(ts: str) -> int:
    """Convert  HH:MM:SS,mmm  or  HH:MM:SS.mmm  to milliseconds."""
    m = _TS_RE.match(ts.strip())
    if not m:
        return 0
    h, mn, s, ms = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    return (h * 3600 + mn * 60 + s) * 1000 + ms


def _ms_to_ts(ms: int) -> str:
    """Convert milliseconds to  HH:MM:SS,mmm  string."""
    h   = ms // 3_600_000;  ms %= 3_600_000
    mn  = ms // 60_000;     ms %= 60_000
    s   = ms // 1_000;      ms %= 1_000
    return f"{h:02d}:{mn:02d}:{s:02d},{ms:03d}"


def _strip_tags(text: str) -> str:
    """Remove HTML/VTT markup tags like <b>, <i>, <c.color>."""
    return re.sub(r"<[^>]+>", "", text).strip()
