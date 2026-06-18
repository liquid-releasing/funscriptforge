# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""About metadata for FunscriptForge.

Single source of truth for version, credits, attribution, and license
content shown in:
  - Sidebar "About" expander (all platforms)
  - PyWebView Help → About menu (desktop mode only)
  - Next Steps tab credits section (post-export)
"""

from __future__ import annotations

__all__ = [
    "VERSION",
    "APP_NAME",
    "TAGLINE",
    "ABOUT_MARKDOWN",
    "about_title",
    "about_text",
]

# Alpha versioning: 0.0.x until first real release.
# Bump before tagging a new vX.Y.Z-alpha so the About dialog matches the build.
VERSION = "0.0.13"
APP_NAME = "FunscriptForge"
TAGLINE = "The professional post-processor for haptic script creators."


ABOUT_MARKDOWN = f"""
### {APP_NAME} {VERSION}

{TAGLINE}

**FunscriptForge** takes a raw `.funscript` file and turns it into something
that actually feels good. Analyze motion structure, fix what's wrong, and
export device-safe output for mechanical devices, estim, and multi-axis.

---

#### Open source credits

FunscriptForge builds on the significant work of the open source community:

- **[funscript-tools](https://github.com/edger477/funscript-tools)** by **Edger** —
  tone transforms, waveform shaping, and the eTransform algorithms that
  power FunscriptForge's Stim channel generation.
- **[restim](https://github.com/diglet48/restim)** by **Diglet48** (MIT License) —
  3-phase synthesis math for e-stim audio. FunscriptForge uses restim's
  signal processing to render stereo WAV files for audio-based estim
  devices. Extracted module at `forge/restim_math/`.

#### Technology

Built with [Streamlit](https://streamlit.io), [PyWebView](https://pywebview.flowrl.com/),
[Matplotlib](https://matplotlib.org), [pandas](https://pandas.pydata.org), and
[Python](https://python.org). Shared components via
[forge-ui-components](https://github.com/liquid-releasing/forge-ui-components).

#### AI assistance

Written by human and Claude AI (Anthropic).

---

#### Community

Questions, bug reports, and feedback welcome in
[our Discord](https://discord.gg/MHucAwwRc).

---

#### License

**{APP_NAME}™** is a trademark of Liquid Releasing.

© 2026 [Liquid Releasing](https://github.com/liquid-releasing).
Licensed under the [MIT License](https://github.com/liquid-releasing/funscriptforge/blob/main/LICENSE).

The `.funscript` file format is a community standard not owned by Liquid Releasing.
"""


def about_title() -> str:
    """Short title for dialogs: 'FunscriptForge 0.0.11'."""
    return f"{APP_NAME} {VERSION}"


def about_text() -> str:
    """Plain-text version of ABOUT_MARKDOWN for native dialogs that
    don't render markdown (e.g. PyWebView's message box)."""
    return (
        f"{APP_NAME} {VERSION}\n"
        f"{TAGLINE}\n\n"
        "Open source credits:\n"
        "  - funscript-tools by Edger\n"
        "    github.com/edger477/funscript-tools\n"
        "  - restim by Diglet48 (MIT License)\n"
        "    github.com/diglet48/restim\n"
        "    3-phase synthesis math extracted for audio rendering.\n\n"
        "Technology: Streamlit, PyWebView, Matplotlib, pandas, Python.\n"
        "Shared components: forge-ui-components.\n\n"
        "Written by human and Claude AI (Anthropic).\n\n"
        "Community:\n"
        "  discord.gg/MHucAwwRc\n\n"
        f"{APP_NAME} is a trademark of Liquid Releasing.\n"
        "© 2026 Liquid Releasing. MIT License.\n"
        "github.com/liquid-releasing/funscriptforge"
    )
