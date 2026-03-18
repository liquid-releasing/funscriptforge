"""
Tab 2 — Tone

Easy Button. Pick a tone, apply globally.
Six tones ordered by intensity: Tender → Build → Tease → Edge → Climax → Dominant.
Card flip: icon on front, description on back.
"""

from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

from forge.funscript import load_funscript, parse_actions

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
        "This is the creative decision that used to require expert-level estim knowledge. "
        "Now you just pick one.\n\n"
        "Click a card to see what it does. Click again to flip back. "
        "Your choice applies to the entire funscript. "
        "Nothing changes until you click **Accept** below."
    )

    selected = st.session_state.get("tone_global", None)
    suggested = _suggest_tone()

    # ── Six cards across ──────────────────────────────────────────────────
    cols = st.columns(6, gap="small")
    for i, tone in enumerate(_TONES):
        with cols[i]:
            _render_card(tone, selected, suggested)

    # ── Sliders (between cards and preview) ───────────────────────────────
    if selected:
        st.divider()
        _render_sliders(selected)

    st.divider()

    # ── Before / After preview ────────────────────────────────────────────
    _render_preview(selected)

    st.divider()

    # ── Accept ────────────────────────────────────────────────────────────
    if st.button(
        "Accept →",
        type="primary",
        width="stretch",
        disabled=not selected,
        help="Apply this tone and continue." if selected else "Select a tone first.",
    ):
        _apply_tone(selected)
        st.session_state["nav_hint_tone"] = "phrases"
        st.rerun()

    hint = st.session_state.pop("nav_hint_tone", None)
    if hint == "phrases":
        _click_tab("Phrases")


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


def _suggest_tone() -> str | None:
    """Suggest the closest tone based on funscript assessment stats.
    Returns tone name or None if no assessment available."""
    from forge.funscript import funscript_stats

    funscript_path = st.session_state.get("funscript_path", "")
    if not funscript_path or not Path(funscript_path).exists():
        return None

    data = load_funscript(funscript_path)
    if not data:
        return None

    stats = funscript_stats(data)
    if not stats:
        return None

    # Normalize the funscript's characteristics to 0–1
    # BPM: 0–200 range typical, avg_speed is proxy for BPM
    bpm_norm = min(stats.get("avg_speed", 0) / 200.0, 1.0)
    # Range: max_pos - min_pos, out of 100
    range_norm = (stats.get("max_pos", 100) - stats.get("min_pos", 0)) / 100.0
    # Speed: avg_speed / max_speed gives consistency, invert for "energy"
    max_spd = stats.get("max_speed", 1)
    speed_norm = min(stats.get("avg_speed", 0) / max(max_spd, 1), 1.0)

    profile = (bpm_norm, range_norm, speed_norm)

    # Find closest tone by euclidean distance
    best_tone = None
    best_dist = float("inf")
    for tone_name, target in _TONE_TARGETS.items():
        dist = sum((a - b) ** 2 for a, b in zip(profile, target)) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best_tone = tone_name

    return best_tone


# ── Sliders ───────────────────────────────────────────────────────────────

# Per-tone slider definitions: (label, session_key, min, max, default, help)
_TONE_SLIDERS = {
    "Tender": [
        ("Softness", "tone_s1", 0.0, 1.0, 0.7,
         "How much to compress stroke range. Higher = gentler."),
        ("Pulse onset", "tone_s2", 0.0, 1.0, 0.3,
         "How gradually pulses rise. Higher = softer entry."),
    ],
    "Build": [
        ("Build rate", "tone_s1", 0.0, 1.0, 0.5,
         "How fast intensity ramps up. Higher = steeper climb."),
        ("Starting intensity", "tone_s2", 0.0, 1.0, 0.3,
         "Where the ramp begins. Lower = more room to grow."),
    ],
    "Tease": [
        ("Retreat depth", "tone_s1", 0.0, 1.0, 0.6,
         "How far intensity pulls back at peaks. Higher = more denial."),
        ("Oscillation speed", "tone_s2", 0.0, 1.0, 0.5,
         "How fast the rise-and-retreat cycles. Higher = faster teasing."),
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
    ],
    "Dominant": [
        ("Drive", "tone_s1", 0.0, 1.0, 0.8,
         "How assertive the device pace is. Higher = harder push."),
        ("Sweep width", "tone_s2", 0.0, 1.0, 0.7,
         "How wide the stroke range. Higher = bigger movements."),
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


def _get_slider_values(tone_name: str) -> tuple[float, float]:
    """Return current slider values for a tone (s1, s2)."""
    sliders = _TONE_SLIDERS.get(tone_name, [])
    if len(sliders) < 2:
        return (0.5, 0.5)
    s1_key = f"{tone_name}_{sliders[0][1]}"
    s2_key = f"{tone_name}_{sliders[1][1]}"
    return (
        st.session_state.get(s1_key, sliders[0][4]),
        st.session_state.get(s2_key, sliders[1][4]),
    )


# ── Preview ───────────────────────────────────────────────────────────────


def _render_preview(selected: str | None):
    """Show before/after funscript preview."""
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

    _BLUE = "#4C8BF5"
    if selected:
        s1, s2 = _get_slider_values(selected)
        col_before, col_after = st.columns(2)
        with col_before:
            st.caption("**Before** — original")
            _plot_funscript(times_s, positions, _BLUE, "Original")
        with col_after:
            st.caption(f"**After** — {selected}")
            modified = _apply_tone_preview(times_s, positions, selected, s1, s2)
            _plot_funscript(times_s, modified, _BLUE, selected)
    else:
        st.caption("**Your funscript** — select a tone to see the preview")
        _plot_funscript(times_s, positions, _BLUE, "Original")


def _plot_funscript(times_s: list, positions: list, color: str, label: str):
    """Render a compact funscript chart."""
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=times_s, y=positions,
        mode="lines",
        line=dict(color=color, width=1),
        name=label,
    ))
    fig.update_layout(
        height=150,
        margin=dict(l=0, r=0, t=0, b=0),
        xaxis=dict(showgrid=False, showticklabels=False),
        yaxis=dict(range=[0, 100], showgrid=False, showticklabels=False),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0.05)",
        showlegend=False,
    )
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})


def _apply_tone_preview(times_s: list, positions: list, tone_name: str,
                        s1: float = 0.5, s2: float = 0.5) -> list:
    """Apply a tone simulation for preview, driven by slider values.
    s1 and s2 are the two contextual sliders (0.0–1.0).
    This is a visual approximation — the real transform runs on Accept."""
    import numpy as np
    pos = np.array(positions, dtype=float)
    n = len(pos)
    t_norm = np.linspace(0, 1, n)
    center = 50

    if tone_name == "Tender":
        # s1 = Softness (compression), s2 = Pulse onset (smoothing)
        compression = 0.2 + 0.6 * (1.0 - s1)  # higher softness = more compression
        pos = center + (pos - center) * compression
    elif tone_name == "Build":
        # s1 = Build rate (steepness), s2 = Starting intensity
        floor = s2 * 0.5  # 0.0–0.5
        scale = floor + (1.0 - floor) * (t_norm ** (0.5 + s1 * 1.5))
        pos = center + (pos - center) * scale
    elif tone_name == "Tease":
        # s1 = Retreat depth, s2 = Oscillation speed
        cycles = 2 + s2 * 6  # 2–8 cycles
        depth = 0.2 + s1 * 0.6  # how much it retreats
        envelope = (1.0 - depth) + depth * np.abs(np.sin(t_norm * np.pi * cycles))
        pos = center + (pos - center) * envelope
    elif tone_name == "Edge":
        # s1 = Hold intensity, s2 = Drop point
        envelope = np.ones(n) * (0.5 + s1 * 0.5)
        drop_start = int(n * s2)
        if drop_start < n:
            envelope[drop_start:] = np.linspace(envelope[min(drop_start, n - 1)], 0.3, n - drop_start)
        pos = center + (pos - center) * envelope
    elif tone_name == "Climax":
        # s1 = Peak intensity (range expansion), s2 = Urgency
        expansion = 1.0 + s1 * 0.5  # 1.0–1.5x range
        pos = center + (pos - center) * expansion
    elif tone_name == "Dominant":
        # s1 = Drive (sharpening), s2 = Sweep width
        exponent = 1.0 - s1 * 0.3  # 0.7–1.0, lower = sharper peaks
        width = 0.8 + s2 * 0.6  # 0.8–1.4x range
        diff = pos - center
        pos = center + np.sign(diff) * np.abs(diff) ** exponent * width

    return np.clip(pos, 0, 100).tolist()


# ── Accept & navigation ──────────────────────────────────────────────────


def _apply_tone(tone_name: str):
    """Save tone selection to the forge project and cache the chart for Phrases tab."""
    from forge.project import save_forge

    project = st.session_state.get("forge_project")
    if project:
        project["tone"] = tone_name
        project["progress"]["tone_applied"] = True
        # Only save if output folder exists (project was accepted in Project tab)
        if Path(project.get("output_folder", "")).exists():
            save_forge(project)

    # Cache the Plotly figure for the Phrases tab
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and Path(funscript_path).exists():
        status = st.status("Applying tone…", expanded=True)
        status.write(f"✅ Tone set to **{tone_name}**")

        data = load_funscript(funscript_path)
        if data:
            times, positions = parse_actions(data)
            if times:
                status.update(label=f"Building chart… {len(times):,} actions")
                times_s = [t / 1000.0 for t in times]
                tone_data = next(t for t in _TONES if t["name"] == tone_name)
                modified = _apply_tone_preview(times_s, positions, tone_name)

                # Build and cache the full-color figure
                fig = go.Figure()
                fig.add_trace(go.Scatter(
                    x=times_s, y=modified,
                    mode="lines",
                    line=dict(color=tone_data["color"], width=1.5),
                    name=tone_name,
                ))
                fig.update_layout(
                    height=300,
                    margin=dict(l=0, r=0, t=10, b=0),
                    xaxis=dict(title="time (s)", showgrid=False),
                    yaxis=dict(title="pos", range=[0, 100], showgrid=False),
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0.05)",
                    showlegend=False,
                )
                st.session_state["cached_tone_chart"] = fig
                status.write(f"✅ Chart cached: {len(times):,} actions")

        status.update(label="Tone applied!", state="complete", expanded=False)


def _click_tab(tab_label: str):
    """Programmatically click a Streamlit tab by its label using JS."""
    import streamlit.components.v1 as components
    components.html(
        f"""<script>
        (function() {{
            var tabs = window.parent.document.querySelectorAll('[data-baseweb="tab"] button, [role="tab"]');
            for (var i = 0; i < tabs.length; i++) {{
                if (tabs[i].textContent.trim() === '{tab_label}') {{
                    tabs[i].click();
                    return;
                }}
            }}
        }})();
        </script>""",
        height=0,
    )
