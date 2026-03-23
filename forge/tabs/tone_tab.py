"""
Tab 2 — Tone

Easy Button. Pick a tone, apply globally.
Six tones ordered by intensity: Tender → Build → Tease → Edge → Climax → Dominant.
Card flip: icon on front, description on back.
"""

from pathlib import Path

import streamlit as st

from forge.funscript import load_funscript, parse_actions
from forge_ui_components.funscript_chart.streamlit import render_monochrome_from_arrays

_ASSETS = Path(__file__).parents[2] / "assets" / "tone_cards"

# Ordered by intensity: softest → hardest
_TONES = [
    {
        "name": "Tender",
        "tagline": "Slow and close",
        "feel": "Soft, slow, shallow strokes. Intimate and present.",
        "description": (
            "Everything slows down. Strokes become shorter and gentler — the device "
            "moves like it's breathing with you, not performing. Beat influence stays "
            "low so rhythm fades into the background. This is the tone for quiet "
            "moments, slow scenes, and anything that should feel close rather than intense."
        ),
        "color": "#4a90d9",
        "icon": _ASSETS / "tender_icon_forge_ae.png",
    },
    {
        "name": "Build",
        "tagline": "Tension grows",
        "feel": "Intensity increases steadily. No release until the end.",
        "description": (
            "A slow ramp. Intensity starts low and climbs phrase by phrase toward the end. "
            "Beat influence grows with it — early sections barely pulse, later sections drive hard. "
            "The effect is anticipation: the user feels momentum building but has to wait for it. "
            "Great for scenes that escalate or any content with a rising arc."
        ),
        "color": "#2ecc71",
        "icon": _ASSETS / "build_icon_forge_aes.png",
    },
    {
        "name": "Tease",
        "tagline": "Pull back at the peak",
        "feel": "Rises toward a peak then retreats. Reward withheld.",
        "description": (
            "The device follows your rhythm but never quite commits. Intensity rises "
            "toward a peak, then pulls back just before the payoff. Beat influence "
            "oscillates — you feel the rhythm arrive and disappear. The effect is "
            "frustration by design. You'll always want more. Perfect for edging content "
            "or scenes that play with denial."
        ),
        "color": "#9b59b6",
        "icon": _ASSETS / "tease_icon_forge_aes.png",
    },
    {
        "name": "Edge",
        "tagline": "Hold there",
        "feel": "Sustained plateau. High intensity maintained, no release.",
        "description": (
            "Intensity locks in at a high level and holds. No ramp, no retreat — "
            "just sustained pressure. Beat influence stays strong until the very end "
            "of each phrase, then drops. The effect is a plateau that demands endurance. "
            "Use this for scenes that hold a single state or content built around sustained tension."
        ),
        "color": "#f39c12",
        "icon": _ASSETS / "edge_icon_forge_aest.png",
    },
    {
        "name": "Climax",
        "tagline": "Everything, now",
        "feel": "Maximum intensity, full range, urgent pacing.",
        "description": (
            "Full power, no holding back. Every phrase runs at maximum intensity with "
            "full stroke range and urgent pacing. Beat influence is maxed — every beat "
            "hits hard. The effect is overwhelming and immediate. Use this for peak moments, "
            "finales, or any scene where restraint is the wrong answer."
        ),
        "color": "#e74c3c",
        "icon": _ASSETS / "climax_icon_forge_ae.png",
    },
    {
        "name": "Dominant",
        "tagline": "Driving, relentless",
        "feel": "Fast, wide, assertive. The device takes charge.",
        "description": (
            "The device leads. Strokes are fast, wide, and assertive — the pace is "
            "set and the user follows. Beat influence is high and relentless, driving "
            "a steady rhythm that never lets up. The effect is authority. This tone "
            "works for content where control belongs to the scene, not the viewer."
        ),
        "color": "#2c3e50",
        "icon": _ASSETS / "dominant_icon_forge.png",
    },
]


def render():
    # ── Tip ───────────────────────────────────────────────────────────────
    st.info(
        "**Tone shapes how your output feels** — from gentle to intense, left to right. "
        "Forge has analyzed your funscript and identified which tone best matches it, "
        "and which offers the most variety. Either choice sets your project on a "
        "device-aware workflow.\n\n"
        "Click a card to see what it does. Click again to flip back. "
        "Your choice applies globally. Nothing changes until you click **Accept**."
    )

    selected = st.session_state.get("tone_global", None)
    enhance, variety, is_monotone = _suggest_tone()
    show_suggestions = st.session_state.pop("show_tone_suggestions", False)

    # ── Dual suggestion bubbles (above cards) ─────────────────────────────
    if (enhance or variety) and (not selected or show_suggestions):
        _render_dual_bubbles(enhance, variety, is_monotone)

    # ── Six cards across ──────────────────────────────────────────────────
    # Highlighted cards: both suggestions glow when visible
    _highlighted = set()
    if not selected or show_suggestions:
        if enhance:
            _highlighted.add(enhance)
        if variety:
            _highlighted.add(variety)

    cols = st.columns(6, gap="small")
    for i, tone in enumerate(_TONES):
        with cols[i]:
            _render_card(tone, selected, tone["name"] if tone["name"] in _highlighted else None)

    # ── Sliders (between cards and preview) ───────────────────────────────
    if selected:
        st.divider()
        # Impact slider — always on top, scales the whole tone effect
        if f"tone_impact_{selected}" not in st.session_state:
            st.session_state[f"tone_impact_{selected}"] = 1.0
        st.slider(
            "Impact — how much of this tone to apply",
            min_value=0.0,
            max_value=1.0,
            key=f"tone_impact_{selected}",
            help="1.0 = full tone effect. 0.0 = no change (original funscript). "
                 "Dial back if the tone is too severe.",
        )
        _render_sliders(selected)

    st.divider()

    # ── Before / After preview ────────────────────────────────────────────
    _render_preview(selected)

    st.divider()

    # ── Show Tone Matches + Accept ──────────────────────────────────────
    col_suggest, col_accept = st.columns([1, 2])
    with col_suggest:
        if st.button("★ Show Tone Matches", width="stretch"):
            st.session_state["show_tone_suggestions"] = True
            st.rerun()
    with col_accept:
        if st.button(
            "Accept",
            type="primary",
            width="stretch",
            disabled=not selected,
            help="Apply this tone to your project." if selected else "Select a tone first.",
        ):
            _apply_tone(selected)
            st.session_state["tone_accepted"] = True
            st.rerun()

    if st.session_state.get("tone_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            "Scroll to top to select your next tab: **Phrases** or **Export**."
        )

    # ── Credit ────────────────────────────────────────────────────────────
    st.divider()
    st.caption(
        "Tone processing incorporates the significant work of "
        "[Edger's Funscript-Tools](https://github.com/edger477/funscript-tools). "
        "For advanced estim channel settings, see the **Stim** tab."
    )


# ── Card rendering ────────────────────────────────────────────────────────


def _render_card(tone: dict, selected: str | None, suggested: str | None = None):
    """Render a tone card: title/tagline always visible, fixed-height image
    area flips to description via ℹ️ button, Select button at bottom.
    Suggested card gets bold border and vibrant text."""
    name = tone["name"]
    is_selected = selected == name
    is_suggested = suggested == name and not selected  # only glow if nothing selected yet
    flip_key = f"tone_flip_{name}"
    is_flipped = st.session_state.get(flip_key, False)

    if is_selected:
        border_color = tone["color"]
        border_width = "3px"
        opacity = "1.0"
    elif is_suggested:
        border_color = tone["color"]
        border_width = "2px"
        opacity = "1.0"
    elif selected is None and suggested is None:
        border_color = "#444"
        border_width = "1px"
        opacity = "1.0"
    else:
        border_color = "#444"
        border_width = "1px"
        opacity = "0.5"

    badge = " ✓" if is_selected else (" ★" if is_suggested else "")
    tagline_color = "#ccc" if (is_selected or is_suggested) else "#888"

    # ── Title + tagline box ──
    st.markdown(
        f"<div style='border:{border_width} solid {border_color};border-radius:10px 10px 0 0;"
        f"padding:8px;text-align:center;opacity:{opacity};'>"
        f"<strong style='color:{tone['color']};font-size:0.85em'>{name}{badge}</strong>"
        f"<div style='font-size:0.7em;color:{tagline_color}'>{tone['tagline']}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

    # ── ℹ️ flip button (full width, no text) ──
    flip_icon = "🖼️" if is_flipped else "ℹ️"
    if st.button(flip_icon, key=f"flip_{name}", width="stretch"):
        st.session_state[flip_key] = not is_flipped
        st.rerun()

    # ── Flip area (icon or description) ──
    if is_flipped:
        st.markdown(
            f"<div style='border:{border_width} solid {border_color};border-radius:0 0 10px 10px;"
            f"padding:8px;opacity:{opacity};overflow-y:auto;'>"
            f"<div style='font-size:0.72em;color:#ccc;line-height:1.4'>"
            f"{tone['description']}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
    else:
        if tone["icon"].exists():
            st.image(str(tone["icon"]), width="stretch")

    # ── Select button ──
    if is_selected:
        st.button("✓ Selected", key=f"sel_{name}", disabled=True, width="stretch")
    else:
        if st.button("Select", key=f"sel_{name}", width="stretch"):
            st.session_state["tone_global"] = name
            st.rerun()


# ── Suggestion bubble ─────────────────────────────────────────────────────



def _render_dual_bubbles(enhance: str | None, variety: str | None, is_monotone: bool):
    """Render two suggestion bubbles above the card grid.
    Primary suggestion is bigger based on monotone analysis."""
    tone_names = [t["name"] for t in _TONES]

    bubble_cols = st.columns(6, gap="small")

    if enhance and enhance in tone_names:
        idx = tone_names.index(enhance)
        color = _TONES[idx]["color"]
        is_primary = not is_monotone  # match is primary for varied scripts
        label = "🎯 Best match"
        reason = _enhance_reason(enhance)
        _draw_bubble(bubble_cols[idx], color, label, reason, is_primary)

    if variety and variety in tone_names and variety != enhance:
        idx = tone_names.index(variety)
        color = _TONES[idx]["color"]
        is_primary = is_monotone  # variety is primary for monotone scripts
        label = "🔀 Most variety"
        reason = _variety_reason(variety)
        _draw_bubble(bubble_cols[idx], color, label, reason, is_primary)


def _draw_bubble(col, color: str, label: str, reason: str, is_primary: bool):
    """Draw a single suggestion bubble in a column."""
    border_w = "2px" if is_primary else "1px"
    opacity = "1.0" if is_primary else "0.7"
    font_size = "0.75em" if is_primary else "0.68em"
    with col:
        st.markdown(
            f"<div style='background:{color}22;border:{border_w} solid {color};"
            f"border-radius:8px;padding:6px 8px;text-align:center;"
            f"font-size:{font_size};color:#eee;line-height:1.3;margin-bottom:4px;"
            f"opacity:{opacity};'>"
            f"<strong>{label}</strong><br>"
            f"<span style='color:#bbb;font-size:0.9em'>{reason}</span>"
            f"</div>"
            f"<div style='width:0;height:0;margin:0 auto;"
            f"border-left:8px solid transparent;border-right:8px solid transparent;"
            f"border-top:8px solid {color};opacity:{opacity};'></div>",
            unsafe_allow_html=True,
        )


def _enhance_reason(tone_name: str) -> str:
    """Why this tone enhances what's already there."""
    reasons = {
        "Tender": "Already gentle — this intensifies the intimacy.",
        "Build": "Already rising — this sharpens the arc.",
        "Tease": "Already playful — this adds more push-pull.",
        "Edge": "Already sustained — this locks in the plateau.",
        "Climax": "Already intense — this pushes to the limit.",
        "Dominant": "Already driving — this adds authority.",
    }
    return reasons.get(tone_name, "Enhances your funscript's existing character.")


def _variety_reason(tone_name: str) -> str:
    """Why this tone adds something new."""
    reasons = {
        "Tender": "Adds quiet moments your funscript is missing.",
        "Build": "Adds a rising arc to give it direction.",
        "Tease": "Adds push-pull dynamics to break the pattern.",
        "Edge": "Adds sustained tension for contrast.",
        "Climax": "Adds peak intensity your funscript avoids.",
        "Dominant": "Adds assertive drive to shake things up.",
    }
    return reasons.get(tone_name, "Adds contrast your funscript doesn't have.")


# ── Suggestion engine ─────────────────────────────────────────────────────

# Target profiles for each tone: (bpm_norm, range_norm, speed_norm)
# 0.0 = low, 1.0 = high. These are what the tone "wants" the funscript to be.
_TONE_TARGETS = {
    "Tender":   (0.15, 0.20, 0.10),  # slow, small range, low speed
    "Build":    (0.40, 0.50, 0.40),  # moderate, growing
    "Tease":    (0.50, 0.55, 0.50),  # moderate with variation
    "Edge":     (0.65, 0.70, 0.60),  # sustained high
    "Climax":   (0.90, 0.95, 0.90),  # everything maxed
    "Dominant":  (0.85, 0.80, 0.95),  # fast, wide, relentless
}


def _suggest_tone() -> tuple[str | None, str | None, bool]:
    """Suggest two tones: enhance (match) and variety (complement).
    Returns (enhance_tone, variety_tone, is_monotone).
    is_monotone determines which suggestion is primary."""
    from forge.funscript import funscript_stats

    # Use chain funscript if available
    project = st.session_state.get("forge_project")
    data = None
    if project:
        from forge.project import get_chain_funscript_for
        data = get_chain_funscript_for(project, "tone")
    if not data:
        funscript_path = st.session_state.get("funscript_path", "")
        if not funscript_path or not Path(funscript_path).exists():
            return None, None, False
        data = load_funscript(funscript_path)
    if not data:
        return None, None, False

    stats = funscript_stats(data)
    if not stats:
        return None, None, False

    # Normalize the funscript's characteristics to 0–1
    bpm_norm = min(stats.get("avg_speed", 0) / 200.0, 1.0)
    range_norm = (stats.get("max_pos", 100) - stats.get("min_pos", 0)) / 100.0
    max_spd = stats.get("max_speed", 1)
    speed_norm = min(stats.get("avg_speed", 0) / max(max_spd, 1), 1.0)
    profile = (bpm_norm, range_norm, speed_norm)

    # Rank all tones by distance
    ranked = []
    for tone_name, target in _TONE_TARGETS.items():
        dist = sum((a - b) ** 2 for a, b in zip(profile, target)) ** 0.5
        ranked.append((dist, tone_name))
    ranked.sort()

    # Enhance = closest match
    enhance = ranked[0][1]
    # Variety = farthest that's not the enhance pick
    variety = ranked[-1][1]
    if variety == enhance and len(ranked) > 1:
        variety = ranked[-2][1]

    # Determine if monotone: check phrase behavioral tags
    is_monotone = _is_monotone()

    return enhance, variety, is_monotone


def _is_monotone() -> bool:
    """Check if >50% of phrases share the same behavioral tag."""
    _proj = st.session_state.get("project")
    if not _proj or not hasattr(_proj, "assessment") or not _proj.is_loaded:
        return False

    phrases = _proj.assessment.to_dict().get("phrases", [])
    if not phrases:
        return False

    # Count primary tags
    tag_counts: dict[str, int] = {}
    for ph in phrases:
        tags = ph.get("tags", [])
        if tags:
            primary = tags[0]
            tag_counts[primary] = tag_counts.get(primary, 0) + 1

    if not tag_counts:
        return False

    max_count = max(tag_counts.values())
    return max_count / len(phrases) > 0.5


# ── Sliders ───────────────────────────────────────────────────────────────

# Per-tone slider definitions: (label, session_key, min, max, default, help)
# Variable count per tone — only sliders with measurable sensitivity effect.
# Derived from funscript-tools sensitivity matrix testing.
_TONE_SLIDERS = {
    "Tender": [
        ("Softness", "tone_s1", 0.0, 1.0, 0.7,
         "How much to compress the cycle range. Higher = gentler."),
        ("Pulse onset", "tone_s2", 0.0, 1.0, 0.3,
         "How gradually pulses rise. Higher = softer entry."),
    ],
    "Build": [
        ("Build rate", "tone_s1", 0.0, 1.0, 0.5,
         "How fast intensity ramps up. Higher = steeper climb."),
        ("Starting intensity", "tone_s2", 0.0, 1.0, 0.3,
         "Where the ramp begins. Lower = more room to grow."),
        ("Arc width", "tone_s3", 0.0, 1.0, 0.5,
         "How wide the sweep pattern is. Higher = broader motion."),
    ],
    "Tease": [
        ("Retreat depth", "tone_s1", 0.0, 1.0, 0.6,
         "How far intensity pulls back at peaks. Higher = more denial."),
        ("Oscillation speed", "tone_s2", 0.0, 1.0, 0.5,
         "How fast the rise-and-retreat cycles. Higher = faster teasing."),
        ("Pulse variety", "tone_s3", 0.0, 1.0, 0.5,
         "How much the pulse pattern varies. Higher = less predictable."),
    ],
    "Edge": [
        ("Hold intensity", "tone_s1", 0.0, 1.0, 0.7,
         "The sustained plateau level. Higher = more demanding."),
        ("Drop point", "tone_s2", 0.0, 1.0, 0.85,
         "How late the intensity drops. Higher = longer hold."),
    ],
    "Climax": [
        ("Peak intensity", "tone_s1", 0.0, 1.0, 0.9,
         "How far to push the range. Higher = more extreme."),
        ("Urgency", "tone_s2", 0.0, 1.0, 0.7,
         "How aggressive the pacing feels. Higher = more relentless."),
        ("Pulse sharpness", "tone_s3", 0.0, 1.0, 0.6,
         "How sharp the pulse edges are. Higher = harder hits."),
        ("Frequency push", "tone_s4", 0.0, 1.0, 0.8,
         "How high the pulse frequency goes. Higher = more intense."),
    ],
    "Dominant": [
        ("Drive", "tone_s1", 0.0, 1.0, 0.8,
         "How assertive the device pace is. Higher = harder push."),
        ("Sweep width", "tone_s2", 0.0, 1.0, 0.7,
         "How wide the cycle range. Higher = bigger movements."),
        ("Relentlessness", "tone_s3", 0.0, 1.0, 0.7,
         "How little the intensity dips. Higher = no breaks."),
    ],
}


def _render_sliders(selected: str):
    """Render contextual sliders for the selected tone."""
    sliders = _TONE_SLIDERS.get(selected, [])
    if not sliders:
        return

    cols = st.columns(len(sliders))
    for i, (label, key, smin, smax, default, help_text) in enumerate(sliders):
        with cols[i]:
            # Initialize slider value if not set or if tone changed
            tone_key = f"{selected}_{key}"
            if tone_key not in st.session_state:
                st.session_state[tone_key] = default
            st.slider(
                label,
                min_value=smin,
                max_value=smax,
                key=tone_key,
                help=help_text,
            )


def _get_slider_values(tone_name: str) -> list[float]:
    """Return current slider values for a tone (variable count)."""
    sliders = _TONE_SLIDERS.get(tone_name, [])
    return [
        st.session_state.get(f"{tone_name}_{sl[1]}", sl[4])
        for sl in sliders
    ]


# ── Preview ───────────────────────────────────────────────────────────────


def _render_preview(selected: str | None):
    """Show before/after funscript preview.
    Before = device-fixed funscript (or original if no device step yet)."""
    from forge.project import get_chain_funscript_for

    # Load from chain: Tone reads from Device output (or original)
    project = st.session_state.get("forge_project")
    data = None
    source_label = "original"
    if project:
        data = get_chain_funscript_for(project, "tone")
        if data:
            source_label = "device-aware"

    # Fall back to raw funscript if chain has nothing
    if not data:
        funscript_path = st.session_state.get("funscript_path", "")
        if not funscript_path or not Path(funscript_path).exists():
            st.caption("Load a funscript in the Project tab to see a preview.")
            return
        data = load_funscript(funscript_path)

    if not data:
        return

    times, positions = parse_actions(data)
    if not times:
        return

    times_s = [t / 1000.0 for t in times]

    if selected:
        slider_vals = _get_slider_values(selected)
        impact = st.session_state.get(f"tone_impact_{selected}", 1.0)
        col_before, col_after = st.columns(2)
        with col_before:
            st.caption(f"**Before** — {source_label}")
            render_monochrome_from_arrays(times_s, positions, key="tone_before")
        with col_after:
            st.caption(f"**After** — {selected} (impact {impact:.0%})")
            toned = _apply_tone_preview(times_s, positions, selected, slider_vals)
            # Blend: output = original + impact * (toned - original)
            modified = [p + impact * (t - p) for p, t in zip(positions, toned)]
            render_monochrome_from_arrays(times_s, modified, key="tone_after")
    else:
        st.caption("**Your funscript** — select a tone to see the preview")
        render_monochrome_from_arrays(times_s, positions, key="tone_original")


def _apply_tone_preview(times_s: list, positions: list, tone_name: str,
                        sliders: list[float] | None = None) -> list:
    """Apply a tone simulation for preview, driven by slider values.
    sliders is a variable-length list of slider values (0.0–1.0).
    This is a visual approximation — the real transform runs on Accept."""
    import numpy as np
    pos = np.array(positions, dtype=float)
    n = len(pos)
    t_norm = np.linspace(0, 1, n)
    center = 50
    sv = sliders or [0.5] * 4  # safe defaults
    s = lambda i: sv[i] if i < len(sv) else 0.5  # safe accessor

    if tone_name == "Tender":
        # s(0) = Softness, s(1) = Pulse onset
        compression = 0.2 + 0.6 * (1.0 - s(0))
        pos = center + (pos - center) * compression
    elif tone_name == "Build":
        # s(0) = Build rate, s(1) = Starting intensity, s(2) = Arc width
        floor = s(1) * 0.5
        scale = floor + (1.0 - floor) * (t_norm ** (0.5 + s(0) * 1.5))
        arc_width = 0.7 + s(2) * 0.6  # 0.7–1.3x
        pos = center + (pos - center) * scale * arc_width
    elif tone_name == "Tease":
        # s(0) = Retreat depth, s(1) = Oscillation speed, s(2) = Pulse variety
        cycles = 2 + s(1) * 6
        depth = 0.2 + s(0) * 0.6
        envelope = (1.0 - depth) + depth * np.abs(np.sin(t_norm * np.pi * cycles))
        # Pulse variety adds noise to the envelope
        if s(2) > 0.1:
            noise = np.random.RandomState(42).uniform(-s(2) * 0.2, s(2) * 0.2, n)
            envelope = np.clip(envelope + noise, 0.1, 1.0)
        pos = center + (pos - center) * envelope
    elif tone_name == "Edge":
        # s(0) = Hold intensity, s(1) = Drop point
        envelope = np.ones(n) * (0.5 + s(0) * 0.5)
        drop_start = int(n * s(1))
        if drop_start < n:
            envelope[drop_start:] = np.linspace(envelope[min(drop_start, n - 1)], 0.3, n - drop_start)
        pos = center + (pos - center) * envelope
    elif tone_name == "Climax":
        # s(0) = Peak intensity, s(1) = Urgency, s(2) = Pulse sharpness, s(3) = Freq push
        expansion = 1.0 + s(0) * 0.5
        # Urgency: slight acceleration toward the end
        urgency_env = 1.0 + s(1) * 0.2 * t_norm
        pos = center + (pos - center) * expansion * urgency_env
    elif tone_name == "Dominant":
        # s(0) = Drive, s(1) = Sweep width, s(2) = Relentlessness
        exponent = 1.0 - s(0) * 0.3
        width = 0.8 + s(1) * 0.6
        diff = pos - center
        pos = center + np.sign(diff) * np.abs(diff) ** exponent * width
        # Relentlessness: pull dips back toward center
        if s(2) > 0.3:
            min_level = s(2) * 30  # floor at relentlessness * 30
            pos = np.where(pos < center, np.maximum(pos, center - (center - min_level)), pos)

    return np.clip(pos, 0, 100).tolist()


# ── Accept & navigation ──────────────────────────────────────────────────


def _apply_tone(tone_name: str):
    """Save tone selection, sliders, and impact to the forge project.
    Appends a history snapshot for undo. Saves toned funscript to chain.
    Caches chart for Phrases tab."""
    from forge.project import save_forge, save_chain_funscript, get_chain_funscript_for
    from datetime import datetime

    project = st.session_state.get("forge_project")
    if project:
        # Collect slider values
        slider_vals = _get_slider_values(tone_name)
        impact = st.session_state.get(f"tone_impact_{tone_name}", 1.0)

        project["tone"] = tone_name
        project["tone_sliders"] = {
            "impact": impact,
            "values": slider_vals,
            "slider_defs": [
                {"label": sl[0], "key": sl[1], "value": st.session_state.get(f"{tone_name}_{sl[1]}", sl[4])}
                for sl in _TONE_SLIDERS.get(tone_name, [])
            ],
        }
        project["progress"]["tone_applied"] = True

        # History snapshot for undo
        project.setdefault("history", []).append({
            "tab": "tone",
            "timestamp": datetime.now().isoformat(),
            "tone": tone_name,
            "tone_sliders": project["tone_sliders"],
        })

        if Path(project.get("output_folder", "")).exists():
            save_forge(project)

    # Apply tone to chain funscript and cache Plotly for Phrases tab
    project = st.session_state.get("forge_project")
    # Read from chain (device-fixed) or fall back to original
    chain_data = get_chain_funscript_for(project, "tone") if project else None
    if not chain_data:
        funscript_path = st.session_state.get("funscript_path", "")
        if funscript_path and Path(funscript_path).exists():
            chain_data = load_funscript(funscript_path)

    if chain_data:
        status = st.status("Applying tone…", expanded=True)
        status.write(f"✅ Tone set to **{tone_name}**")

        times, positions = parse_actions(chain_data)
        if times:
            slider_vals = _get_slider_values(tone_name)
            impact = st.session_state.get(f"tone_impact_{tone_name}", 1.0)
            status.update(label=f"Applying tone to {len(times):,} actions…")
            times_s = [t / 1000.0 for t in times]
            tone_data = next(t for t in _TONES if t["name"] == tone_name)
            toned = _apply_tone_preview(times_s, positions, tone_name, slider_vals)
            # Apply impact blending
            modified = [p + impact * (t - p) for p, t in zip(positions, toned)]

            # Save toned funscript to chain
            if project:
                toned_data = dict(chain_data)
                for i, action in enumerate(toned_data.get("actions", [])):
                    if i < len(modified):
                        action["pos"] = int(round(modified[i]))
                chain_path = save_chain_funscript(project, "tone", toned_data)
                st.session_state["chain_funscript_path"] = chain_path
                status.write("✅ Toned funscript saved to chain")

                # Build and cache the full-color figure
                from forge_ui_components.funscript_chart.core import monochrome_figure, compute_chart_data
                fig = monochrome_figure(
                    times_s, modified,
                    color=tone_data["color"],
                    height=300,
                    show_axes=True,
                    line_width=1.5,
                )
                st.session_state["cached_tone_chart"] = fig

                # Pre-compute vibrant chart data for Phrases tab
                status.update(label="Building chart data…")
                toned_actions = toned_data.get("actions", [])
                st.session_state["cached_vibrant_series"] = compute_chart_data(toned_actions)
                status.write(f"✅ Chart data cached: {len(times):,} actions")

        status.update(label="Tone applied!", state="complete", expanded=False)


