"""
Tab 2 — Tone

Easy Button. Pick a tone, apply globally.
Six tones: Build, Climax, Tease, Edge, Tender, Dominant.
"""

from pathlib import Path

import streamlit as st

_ASSETS = Path(__file__).parents[2] / "assets" / "tone_cards"

_TONES = [
    {
        "name": "Build",
        "tagline": "Tension grows",
        "feel": "Intensity increases steadily. No release until the end.",
        "color": "#2ecc71",
        "icon": _ASSETS / "build_icon_forge_aes.png",
    },
    {
        "name": "Climax",
        "tagline": "Everything, now",
        "feel": "Maximum intensity, full range, urgent pacing.",
        "color": "#e74c3c",
        "icon": _ASSETS / "climax_icon_forge_ae.png",
    },
    {
        "name": "Tease",
        "tagline": "Pull back at the peak",
        "feel": "Rises toward a peak then retreats. Reward withheld.",
        "color": "#9b59b6",
        "icon": _ASSETS / "tease_icon_forge_aes.png",
    },
    {
        "name": "Edge",
        "tagline": "Hold there",
        "feel": "Sustained plateau. High intensity maintained, no release.",
        "color": "#f39c12",
        "icon": _ASSETS / "edge_icon_forge_aest.png",
    },
    {
        "name": "Tender",
        "tagline": "Slow and close",
        "feel": "Soft, slow, shallow. Intimate and present.",
        "color": "#4a90d9",
        "icon": _ASSETS / "tender_icon_forge_ae.png",
    },
    {
        "name": "Dominant",
        "tagline": "Driving, relentless",
        "feel": "Fast, wide, assertive. The device takes charge.",
        "color": "#2c3e50",
        "icon": _ASSETS / "dominant_icon_forge.png",
    },
]


def render():
    st.subheader("Tone")
    st.caption("The single most important creative decision. Pick one — everything else follows.")

    selected = st.session_state.get("tone_global", None)

    cols = st.columns(3, gap="small")
    for i, tone in enumerate(_TONES):
        col = cols[i % 3]
        with col:
            is_selected = selected == tone["name"]
            border = f"3px solid {tone['color']}" if is_selected else "2px solid #333"
            opacity = "1.0" if is_selected else "0.65"
            badge = " ✓" if is_selected else ""

            st.markdown(
                f"<div style='border:{border};border-radius:10px;padding:12px;"
                f"opacity:{opacity};margin-bottom:8px;'>"
                f"<strong style='color:{tone['color']}'>{tone['name']}{badge}</strong>"
                f"<div style='font-size:0.8em;color:#aaa'>{tone['tagline']}</div>"
                f"</div>",
                unsafe_allow_html=True,
            )

            if tone["icon"].exists():
                st.image(str(tone["icon"]), use_container_width=True)

            if is_selected:
                st.button("Selected ✓", key=f"tone_{tone['name']}", disabled=True,
                          use_container_width=True, type="primary")
            else:
                if st.button(f"Select {tone['name']}", key=f"tone_{tone['name']}",
                             use_container_width=True):
                    st.session_state["tone_global"] = tone["name"]
                    st.rerun()

    if selected:
        tone_data = next(t for t in _TONES if t["name"] == selected)
        st.divider()
        st.markdown(f"**What you'll feel — {selected}:** {tone_data['feel']}")

    st.divider()
    st.caption(
        "For advanced estim channel settings, see "
        "[Funscript-Tools](https://github.com/edger477/funscript-tools)."
    )
