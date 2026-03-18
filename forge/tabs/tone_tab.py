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

    # ── Six cards across ──────────────────────────────────────────────────
    cols = st.columns(6, gap="small")
    for i, tone in enumerate(_TONES):
        with cols[i]:
            _render_card(tone, selected)

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


def _render_card(tone: dict, selected: str | None):
    """Render a single tone card with flip behavior."""
    name = tone["name"]
    is_selected = selected == name
    # Track which cards are flipped to show description
    flip_key = f"tone_flip_{name}"
    is_flipped = st.session_state.get(flip_key, False)

    border_color = tone["color"] if is_selected else "#444"
    border_width = "3px" if is_selected else "1px"
    opacity = "1.0" if (is_selected or selected is None) else "0.5"
    badge = " ✓" if is_selected else ""

    if is_flipped:
        # Back of card — description
        st.markdown(
            f"<div style='border:{border_width} solid {border_color};border-radius:10px;"
            f"padding:10px;opacity:{opacity};'>"
            f"<strong style='color:{tone['color']};font-size:0.85em'>{name}{badge}</strong>"
            f"<div style='font-size:0.75em;color:#ccc;margin-top:6px;line-height:1.4'>"
            f"{tone['description']}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
    else:
        # Front of card — icon
        st.markdown(
            f"<div style='border:{border_width} solid {border_color};border-radius:10px;"
            f"padding:10px;text-align:center;opacity:{opacity};'>"
            f"<strong style='color:{tone['color']};font-size:0.85em'>{name}{badge}</strong>"
            f"<div style='font-size:0.7em;color:#888'>{tone['tagline']}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
        if tone["icon"].exists():
            st.image(str(tone["icon"]), width="stretch")

    # Two buttons: flip and select
    bcol1, bcol2 = st.columns(2)
    with bcol1:
        flip_label = "ℹ️" if not is_flipped else "🖼️"
        if st.button(flip_label, key=f"flip_{name}", width="stretch",
                     help="Flip card" if not is_flipped else "Show icon"):
            st.session_state[flip_key] = not is_flipped
            st.rerun()
    with bcol2:
        if is_selected:
            st.button("✓", key=f"sel_{name}", disabled=True, width="stretch")
        else:
            if st.button("Select", key=f"sel_{name}", width="stretch"):
                st.session_state["tone_global"] = name
                st.rerun()


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
        col_before, col_after = st.columns(2)
        with col_before:
            st.caption("**Before** — original")
            _plot_funscript(times_s, positions, _BLUE, "Original")
        with col_after:
            st.caption(f"**After** — {selected}")
            modified = _apply_tone_preview(times_s, positions, selected)
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


def _apply_tone_preview(times_s: list, positions: list, tone_name: str) -> list:
    """Apply a simple tone simulation for preview purposes.
    This is a visual approximation — the real transform runs on Accept."""
    import numpy as np
    pos = np.array(positions, dtype=float)
    n = len(pos)
    t_norm = np.linspace(0, 1, n)

    if tone_name == "Tender":
        # Compress toward center, reduce range
        center = 50
        pos = center + (pos - center) * 0.4
    elif tone_name == "Build":
        # Scale intensity by position in timeline
        center = 50
        scale = 0.3 + 0.7 * t_norm
        pos = center + (pos - center) * scale
    elif tone_name == "Tease":
        # Oscillating amplitude envelope
        envelope = 0.4 + 0.6 * np.abs(np.sin(t_norm * np.pi * 4))
        center = 50
        pos = center + (pos - center) * envelope
    elif tone_name == "Edge":
        # Hold high, drop at end
        envelope = np.ones(n)
        drop_start = int(n * 0.85)
        envelope[drop_start:] = np.linspace(1.0, 0.3, n - drop_start)
        center = 50
        pos = center + (pos - center) * envelope
    elif tone_name == "Climax":
        # Expand range to max
        center = 50
        pos = center + (pos - center) * 1.3
    elif tone_name == "Dominant":
        # Push extremes harder, sharpen peaks
        center = 50
        diff = pos - center
        pos = center + np.sign(diff) * np.abs(diff) ** 0.85 * 1.2

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
