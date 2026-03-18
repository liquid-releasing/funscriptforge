"""
Auto-derive project metadata from funscript analysis.

derive_metadata(stats, phrases) -> dict
  Computes pace, intensity, stroke depth, duration category, dominant mood,
  arc type, variety, auto-generated Hub tags, and a tone suggestion with rationale.
  All inputs come from existing funscript_stats() + assessment phrases.
  No additional analysis required.
"""

from collections import Counter


# ── Tag → Tone vocabulary mapping ───────────────────────────────────────────
# Assessment tags map to the 6 Tone vocabulary labels.
_TAG_TO_TONE = {
    "frantic":      "Dominant",
    "giggle":       "Tease",
    "plateau":      "Edge",
    "lazy":         "Tender",
    "stingy":       "Tease",
    "drift":        "Tender",
    "half_stroke":  "Build",
    "drone":        "Build",
}

_TONE_LABELS = {"Dominant", "Tease", "Edge", "Tender", "Build", "Climax"}


def derive_metadata(stats: dict, phrases: list) -> dict:
    """Derive rich metadata from funscript_stats() output and assessment phrases.

    Parameters
    ----------
    stats:   dict from forge.funscript.funscript_stats()
    phrases: list of phrase dicts from assessment.to_dict()["phrases"]

    Returns
    -------
    dict with keys:
        pace, intensity, depth, duration_category, dominant_mood,
        arc_type, variety, auto_tags, tone_suggestion, tone_rationale
    """
    pace         = _derive_pace(phrases)
    intensity    = _derive_intensity(stats)
    depth        = _derive_depth(stats)
    duration_cat = _derive_duration(stats)
    dominant_mood, variety = _derive_mood_variety(phrases)
    arc_type     = _derive_arc(phrases)
    tone, rationale = _suggest_tone(dominant_mood, intensity, arc_type, pace)

    auto_tags = _build_tags(pace, intensity, depth, duration_cat,
                             dominant_mood, arc_type, variety)

    return {
        "pace":              pace,
        "intensity":         intensity,
        "depth":             depth,
        "duration_category": duration_cat,
        "dominant_mood":     dominant_mood,
        "arc_type":          arc_type,
        "variety":           variety,
        "auto_tags":         auto_tags,
        "tone_suggestion":   tone,
        "tone_rationale":    rationale,
    }


# ── Derivation helpers ────────────────────────────────────────────────────────

def _derive_pace(phrases: list) -> str:
    bpms = [p["bpm"] for p in phrases if p.get("bpm")]
    if not bpms:
        return "Unknown"
    avg = sum(bpms) / len(bpms)
    if avg < 40:   return "Slow"
    if avg < 80:   return "Medium"
    if avg < 140:  return "Fast"
    return "Intense"


def _derive_intensity(stats: dict) -> str:
    s = stats.get("avg_speed", 0) or 0
    if s < 20:  return "Low"
    if s < 50:  return "Medium"
    if s < 80:  return "High"
    return "Extreme"


def _derive_depth(stats: dict) -> str:
    try:
        lo = int(str(stats.get("min_pos", 0)).replace("%", ""))
        hi = int(str(stats.get("max_pos", 100)).replace("%", ""))
    except (ValueError, TypeError):
        return "Unknown"
    span = hi - lo
    if span < 30:  return "Shallow"
    if span < 60:  return "Mid"
    if span < 85:  return "Deep"
    return "Full"


def _derive_duration(stats: dict) -> str:
    s = stats.get("duration_s") or 0
    if s < 300:   return "Short"
    if s < 900:   return "Medium"
    if s < 1800:  return "Long"
    return "Feature"


def _derive_mood_variety(phrases: list) -> tuple[str, str]:
    """Returns (dominant_mood, variety)."""
    raw_tags = []
    for p in phrases:
        tags = p.get("tags") or []
        for t in tags:
            mapped = _TAG_TO_TONE.get(t)
            if mapped:
                raw_tags.append(mapped)

    if not raw_tags:
        dominant = "Unknown"
    else:
        dominant = Counter(raw_tags).most_common(1)[0][0]

    distinct = len(set(raw_tags)) if raw_tags else 0
    if distinct <= 1:   variety = "Focused"
    elif distinct <= 3: variety = "Varied"
    else:               variety = "Complex"

    return dominant, variety


def _derive_arc(phrases: list) -> str:
    """Classify the overall shape of the funscript."""
    if not phrases:
        return "Unknown"

    bpms = [p.get("bpm") or 0 for p in phrases]
    n = len(bpms)
    if n < 3:
        return "Short"

    first_third  = sum(bpms[:n//3]) / (n//3)
    last_third   = sum(bpms[-n//3:]) / (n//3)
    middle_third = sum(bpms[n//3: 2*n//3]) / (n//3)

    # Climactic: clear build to peak then possible drop
    if last_third > first_third * 1.4 and last_third > middle_third:
        return "Climactic"

    # Building: steady increase
    if last_third > first_third * 1.2:
        return "Building"

    # Episodic: middle significantly higher than both ends
    if middle_third > first_third * 1.3 and middle_third > last_third * 1.3:
        return "Episodic"

    return "Flat"


def _suggest_tone(dominant_mood: str, intensity: str,
                  arc_type: str, pace: str) -> tuple[str, str]:
    """Return (tone_label, rationale_string)."""
    reasons = []

    # Arc is the strongest signal
    if arc_type == "Climactic":
        tone = "Climax"
        reasons.append("climactic arc")
    elif arc_type == "Building":
        tone = "Build"
        reasons.append("building arc")
    elif dominant_mood in _TONE_LABELS and dominant_mood != "Unknown":
        tone = dominant_mood
        reasons.append(f"dominant mood {dominant_mood.lower()}")
    elif intensity in ("High", "Extreme"):
        tone = "Dominant"
        reasons.append(f"{intensity.lower()} intensity")
    elif intensity == "Low" and pace == "Slow":
        tone = "Tender"
        reasons.append("slow pace and low intensity")
    else:
        tone = "Build"
        reasons.append("default")

    rationale = "Suggested based on: " + ", ".join(reasons)
    return tone, rationale


def _build_tags(pace, intensity, depth, duration_cat,
                dominant_mood, arc_type, variety) -> list[str]:
    tags = [
        f"pace:{pace.lower()}",
        f"intensity:{intensity.lower()}",
        f"depth:{depth.lower()}",
        f"duration:{duration_cat.lower()}",
        f"arc:{arc_type.lower()}",
        f"variety:{variety.lower()}",
    ]
    if dominant_mood and dominant_mood != "Unknown":
        tags.append(f"mood:{dominant_mood.lower()}")
    return tags


# ── Formatting helpers (for CLI output) ──────────────────────────────────────

def format_metadata_table(meta: dict) -> str:
    """Return a human-readable table string (ASCII-safe for all terminals)."""
    SEP = "+------------------------------------------+"
    lines = [
        SEP,
        "|          Auto-Derived Metadata            |",
        "+----------------------+--------------------+",
    ]
    rows = [
        ("Pace",              meta.get("pace", "-")),
        ("Intensity",         meta.get("intensity", "-")),
        ("Stroke depth",      meta.get("depth", "-")),
        ("Duration category", meta.get("duration_category", "-")),
        ("Dominant mood",     meta.get("dominant_mood", "-")),
        ("Arc type",          meta.get("arc_type", "-")),
        ("Variety",           meta.get("variety", "-")),
        ("Tone suggestion",   meta.get("tone_suggestion", "-")),
    ]
    for label, value in rows:
        lines.append(f"| {label:<20} | {value:<18} |")
    lines.append(SEP)
    rationale = meta.get("tone_rationale", "")
    lines.append(f"| {rationale:<40} |")
    lines.append(SEP)
    lines.append("| Auto tags:                               |")
    for tag in meta.get("auto_tags", []):
        lines.append(f"|   {tag:<39}|")
    lines.append(SEP)
    return "\n".join(lines)
