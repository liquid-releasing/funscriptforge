# FunScriptForge — Next Steps tab
# Written by human and Claude AI (Claude Sonnet).

"""Next Steps tab — playback guidance, credits, and license."""

from __future__ import annotations

import streamlit as st


# ---------------------------------------------------------------------------
# Playback guides per device
# ---------------------------------------------------------------------------

_PLAYBACK_GUIDES: dict[str, dict[str, str]] = {
    "handy": {
        "title": "The Handy",
        "icon": "🤖",
        "steps": (
            "1. Connect your Handy to Wi-Fi and pair it at **handyfeeling.com**\n"
            "2. Upload your exported `.funscript` to **handyfeeling.com/upload**\n"
            "3. Load the matching video in the web player or use **ScriptPlayer**\n"
            "4. Press play — the Handy syncs automatically"
        ),
    },
    "osr2": {
        "title": "OSR2 / SR6",
        "icon": "🎮",
        "steps": (
            "1. Connect your OSR2/SR6 via USB or Bluetooth\n"
            "2. Open **MultiFunPlayer** and load the exported `.funscript`\n"
            "3. Load the matching video in your preferred player\n"
            "4. Sync and play"
        ),
    },
    "estim_foc": {
        "title": "E-Stim (Restim — Focus)",
        "icon": "⚡",
        "steps": (
            "1. Open **Restim** and load the exported funscript files\n"
            "2. The alpha, beta, and pulse channels are in your device folder\n"
            "3. Connect your e-stim device via audio output\n"
            "4. Start playback in Restim — it handles signal generation\n\n"
            "Download Restim → [github.com/diglet48/restim](https://github.com/diglet48/restim/releases)"
        ),
    },
    "estim_stereo": {
        "title": "E-Stim (Restim — Stereo)",
        "icon": "⚡",
        "steps": (
            "1. Open **Restim** and load the exported funscript files\n"
            "2. Select stereo output mode in Restim settings\n"
            "3. Connect your e-stim device via audio output\n"
            "4. Start playback in Restim\n\n"
            "Download Restim → [github.com/diglet48/restim](https://github.com/diglet48/restim/releases)"
        ),
    },
}


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------

_CREDITS = """
### Open Source Contributors

FunScriptForge builds on the significant work of the open source community:

| Project | Author | Description |
|---------|--------|-------------|
| [Funscript-Tools](https://github.com/edger477/funscript-tools) | **Edger** | Tone transforms, waveform shaping, and the eTransform algorithms that power FunScriptForge's tone processing |
| [Restim](https://github.com/diglet48/restim/releases) | **Diglet48** | Real-time e-stim signal generation from funscript — the bridge between funscripts and e-stim devices |

### Technology

Built with [Streamlit](https://streamlit.io), [Plotly](https://plotly.com),
[pandas](https://pandas.pydata.org), and [Python](https://python.org).

### AI Assistance

Written by human and Claude AI (Anthropic).
"""

_LICENSE_SECTION = """
---

### License

**FunScriptForge™** is a trademark of Liquid Releasing.

© 2026 [Liquid Releasing](https://github.com/liquid-releasing).
Licensed under the [MIT License](https://github.com/liquid-releasing/funscriptforge/blob/main/LICENSE).

The `.funscript` file format is a community standard not owned by Liquid Releasing.
"""


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render() -> None:
    """Render the Next Steps tab."""
    st.header("Next Steps")
    st.markdown(
        "Your funscripts have been exported. Here's how to use them."
    )

    # -- Playback guidance ---------------------------------------------------
    st.subheader("🎬 Playback Guide")

    forge_project = st.session_state.get("forge_project")
    selected_devices: list[str] = []
    if forge_project:
        selected_devices = forge_project.get("output_targets", [])

    if selected_devices:
        # Show guides only for selected devices
        for dev_key in selected_devices:
            guide = _PLAYBACK_GUIDES.get(dev_key)
            if guide:
                with st.expander(f"{guide['icon']} {guide['title']}", expanded=True):
                    st.markdown(guide["steps"])
    else:
        # Show all guides
        for guide in _PLAYBACK_GUIDES.values():
            with st.expander(f"{guide['icon']} {guide['title']}", expanded=False):
                st.markdown(guide["steps"])

    st.markdown("---")

    # -- SyncPlayer teaser ---------------------------------------------------
    st.subheader("🔜 SyncPlayer")
    st.info(
        "**SyncPlayer** is coming soon — a multi-device, multi-monitor "
        "player that routes your funscripts directly to your devices. "
        "Stay tuned for updates from Liquid Releasing."
    )

    # -- Credits -------------------------------------------------------------
    st.subheader("🙏 Credits & Attribution")
    st.markdown(_CREDITS)

    # -- License -------------------------------------------------------------
    st.markdown(_LICENSE_SECTION)
