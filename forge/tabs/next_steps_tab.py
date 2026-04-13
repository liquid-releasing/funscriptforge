# FunscriptForge — Next Steps tab
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
    "estim_audio": {
        "title": "E-Stim — Audio Devices (2b, 312, Tingler, EstimHero, ZC95)",
        "icon": "⚡",
        "steps": (
            "FunscriptForge exports **stereo WAV audio files** ready to play "
            "on audio-based estim devices.\n\n"
            "1. Find the `.wav` files in your `estim/` export folder\n"
            "2. Connect your estim device to your computer's audio output\n"
            "3. Play the WAV file using any media player (VLC, foobar2000, etc.)\n"
            "4. Sync with your video using **MultiFunPlayer** or **ScriptPlayer**\n\n"
            "**Continuous WAV** (`.legacy.wav`) — for 2b, 312, and similar legacy devices\n\n"
            "**Pulse WAV** (`.stereostim.wav`) — for Tingler, EstimHero, ZC95, and similar modern devices\n\n"
            "The audio file IS the stimulation signal — your device amplifies it directly. "
            "No additional software required for playback."
        ),
    },
    "estim_protocol": {
        "title": "E-Stim — Protocol Devices (FOC-Stim, NeoStim)",
        "icon": "⚡",
        "steps": (
            "FOC-Stim and NeoStim are **protocol-controlled devices** — they "
            "generate stimulation signals internally from commands sent over "
            "serial/USB. They do not use audio files.\n\n"
            "1. Open **Restim** and load the channel funscripts from your `estim/` folder\n"
            "2. Connect your FOC-Stim or NeoStim device\n"
            "3. Configure your device type in Restim's device wizard\n"
            "4. Start playback — Restim sends real-time commands to your device\n\n"
            "Download Restim → [github.com/diglet48/restim](https://github.com/diglet48/restim/releases)\n\n"
            "The exported `.alpha.funscript` and `.beta.funscript` files contain "
            "the position data Restim needs. Restim handles the device protocol."
        ),
    },
}


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------

_CREDITS = """
### Open Source Contributors

FunscriptForge builds on the significant work of the open source community:

| Project | Author | Description |
|---------|--------|-------------|
| [Funscript-Tools](https://github.com/edger477/funscript-tools) | **Edger** | Tone transforms, waveform shaping, and the eTransform algorithms that power FunscriptForge's Stim channel generation |
| [Restim](https://github.com/diglet48/restim/releases) | **Diglet48** | 3-phase synthesis math for e-stim audio — FunscriptForge uses restim's signal processing to render stereo WAV files |

### Key Innovations

- **Groove (Humanize)** — varies cycle timing to prevent monotone burn, discovered through EDA on expert-crafted scripts
- **Three Red Flags stingy detection** — identifies scripts that need timing variation (low CV + flat build + no rest)
- **Device awareness** — Groove + speed backstop replaces aggressive velocity clamping
- **Vibrant velocity-coded charts** — see your funscript's intensity at a glance (blue=slow, red=fast)
- **ChartCache** — pre-computed charts flow through the workflow, every tab loads instantly

### Technology

Built with [Streamlit](https://streamlit.io), [Matplotlib](https://matplotlib.org),
[pandas](https://pandas.pydata.org), and [Python](https://python.org).
Shared components via [forge-ui-components](https://github.com/liquid-releasing/forge-ui-components).

### AI Assistance

Written by human and Claude AI (Anthropic).
"""

_LICENSE_SECTION = """
---

### License

**FunscriptForge™** is a trademark of Liquid Releasing.

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

    forge_project = st.session_state.get("forge_project")
    _exported = forge_project.get("progress", {}).get("exported", False) if forge_project else False

    if _exported:
        st.success("Your funscripts have been exported. Here's how to use them.")
    else:
        st.info("Complete the workflow and export to see playback instructions.")

    # -- What you built ------------------------------------------------------
    if forge_project:
        st.subheader("Your Project")
        _cols = st.columns(4)
        _devices = forge_project.get("output_targets", [])
        _tone = forge_project.get("tone", "—")
        _groove = forge_project.get("groove", 0)
        _cols[0].metric("Devices", ", ".join(_devices) if _devices else "—")
        _cols[1].metric("Tone", _tone)
        _cols[2].metric("Groove", f"{_groove:.2f}")
        _cols[3].metric("Status", "Exported" if _exported else "In progress")
        st.divider()

    # -- Playback guidance ---------------------------------------------------
    st.subheader("Playback Guide")

    selected_devices: list[str] = []
    if forge_project:
        selected_devices = forge_project.get("output_targets", [])

    if selected_devices:
        for dev_key in selected_devices:
            guide = _PLAYBACK_GUIDES.get(dev_key)
            if guide:
                with st.expander(f"{guide['icon']} {guide['title']}", expanded=_exported):
                    st.markdown(guide["steps"])
    else:
        for guide in _PLAYBACK_GUIDES.values():
            with st.expander(f"{guide['icon']} {guide['title']}", expanded=False):
                st.markdown(guide["steps"])

    st.divider()

    # -- ForgePlayer teaser --------------------------------------------------
    st.subheader("Coming Soon")
    st.info(
        "**ForgePlayer** — play your funscripts directly on your devices "
        "with real-time visualization. Load any funscript, pick a tone and "
        "groove, and play — no editing required.\n\n"
        "**forgegen** — generate funscripts from audio and video automatically. "
        "Beat detection, scene analysis, and the Humanize algorithm built in."
    )

    st.divider()

    # -- Community -----------------------------------------------------------
    st.subheader("Community")
    st.markdown(
        "Join the conversation and share your creations:\n\n"
        "- [Discord](https://discord.gg/funscriptforge) — feedback, feature requests, sharing\n"
        "- [GitHub](https://github.com/liquid-releasing/funscriptforge) — issues, contributions\n"
    )

    st.divider()

    # -- Credits -------------------------------------------------------------
    st.subheader("Credits & Attribution")
    st.markdown(_CREDITS)

    # -- License -------------------------------------------------------------
    st.markdown(_LICENSE_SECTION)
