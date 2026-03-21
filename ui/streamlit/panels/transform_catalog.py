# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Transform Catalog panel — reference guide for all phrase transforms.

Each transform entry shows:
  • Headline and description
  • Behavioral tags it is best suited for
  • Parameter table (name, type, default, range, description)
  • Live before/after Plotly charts — sliders update the preview in real-time

Transforms are grouped by capability:
  1. Passthrough
  2. Amplitude Shaping
  3. Position Adjustment
  4. Smoothing & Filtering
  5. Break / Recovery
  6. Performance / Device Realism
  7. Rhythmic Patterns
  8. Structural — Tempo
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BG    = "rgba(14,14,18,1)"
_GRID  = "rgba(80,80,80,0.25)"
_BLUE  = "#4a90d9"
_GREEN = "#2ecc71"

# ---------------------------------------------------------------------------
# Meta-categories: each has a headline, description, and list of groups.
# Groups are (group_label, [transform_key, ...]).
# ---------------------------------------------------------------------------

_META: List[Tuple[str, str, List[Tuple[str, List[str]]]]] = [
    (
        "Behavior",
        "Behavior transforms reshape, scale, or filter a phrase while keeping the same "
        "number of actions and overall timing. They adjust *how* a phrase moves — its "
        "amplitude, position, smoothness, or rhythm — without changing the phrase duration "
        "or stroke count.",
        [
            ("Passthrough",                  ["passthrough"]),
            ("Amplitude Shaping",            ["amplitude_scale", "normalize", "boost_contrast"]),
            ("Position Adjustment",          ["shift", "recenter", "clamp_upper", "clamp_lower", "invert", "funnel"]),
            ("Smoothing & Filtering",        ["smooth", "blend_seams", "final_smooth"]),
            ("Break / Recovery",             ["break", "waiting"]),
            ("Performance / Device Realism", ["performance"]),
            ("Rhythmic Patterns",            ["beat_accent", "three_one"]),
        ],
    ),
    (
        "Structural / Tempo",
        "Structural transforms alter the fundamental timing of a phrase. They may change "
        "the number of strokes, redistribute action timestamps, or thin out cycles to "
        "reduce BPM. Because the output timing differs from the input, these transforms "
        "replace the original action sequence rather than modifying it in-place.",
        [
            ("Tempo Reduction", ["halve_tempo"]),
        ],
    ),
    (
        "Replacement",
        "Replacement transforms discard the original phrase entirely and synthesize a new "
        "waveform from scratch. Use them when the source material is too noisy, too sparse, "
        "or structurally unsuitable — and a clean, generated shape is preferable. "
        "Parameters control the generated shape, not the original signal.",
        [
            ("Generated Shapes", ["stroke", "drift", "tide"]),
        ],
    ),
]

# Best-fit behavioral tags for each transform key
_TAG_FIT: Dict[str, List[str]] = {
    "passthrough":     ["Any section already well-formed or below BPM threshold"],
    "amplitude_scale": ["Stingy (amplify)", "Giggle / Plateau (reduce)", "Drone"],
    "normalize":       ["Giggle", "Plateau", "Half Stroke", "Lazy"],
    "boost_contrast":  ["Giggle", "Plateau", "Lazy", "low-contrast phrases"],
    "shift":           ["Drift", "Half Stroke", "vertical repositioning"],
    "recenter":        ["Drift", "Half Stroke", "amplitude-preserving reposition"],
    "clamp_upper":     ["intense sections", "high-energy peaks"],
    "clamp_lower":     ["Break / recovery", "Lazy"],
    "invert":          ["directional correction", "artistic variation"],
    "smooth":          ["Frantic (jitter reduction)", "noisy transitions"],
    "blend_seams":     ["inter-phrase boundaries", "abrupt style changes"],
    "final_smooth":    ["post-processing finishing pass"],
    "break":           ["Break / rest zones", "recovery sections"],
    "performance":     ["Stingy", "Frantic", "Drone", "device-safety limiting"],
    "beat_accent":     ["Drone (add variation)", "Lazy", "repetitive sections"],
    "three_one":       ["Drone (rhythmic pattern)", "monotone sections"],
    "halve_tempo":     ["Frantic (too fast)", "high-BPM reduction"],
    "waiting":         ["Break / rest zones", "low-intensity gaps", "recovery pauses"],
    "stroke":          ["Replacement — clean full stroke", "any phrase needing a simple oscillation"],
    "drift":           ["Replacement — high plateau with one slow dip", "Drift behavioral pattern"],
    "tide":            ["Replacement — fast oscillations on slow center wave", "sustained intensity with ebb-and-flow"],
    "funnel":          ["Ramp behavioral tag", "transition sections", "energy ramp-up or ramp-down", "Ambient"],
}

# Per-transform preview duration overrides (ms).  Replacement transforms need
# long windows so their shape is visible at default parameters.
_PREVIEW_DURATION_MS: Dict[str, int] = {
    "drift": 25_000,
    "tide":  120_000,
}
_DEFAULT_PREVIEW_MS = 5_600

# Structural transforms that should still show a Before/After comparison
# (they reshape an existing phrase rather than generating from scratch).
_SHOW_BEFORE: frozenset = frozenset({"halve_tempo"})


# ---------------------------------------------------------------------------
# Synthetic waveform generator (fixed, deterministic)
# ---------------------------------------------------------------------------

def _make_preview_actions(duration_ms: int = _DEFAULT_PREVIEW_MS) -> List[Dict[str, int]]:
    """Return a varied funscript waveform scaled to *duration_ms*.

    Uses the original six-section pattern for the default 5600 ms window and
    tiles / truncates it for other durations.
    """
    base_pts = [
        (0,    0),   (200,  100), (400,  0),   (600,  100), (800,  0),
        (1000, 100), (1200, 0),   (1380, 25),  (1560, 70),  (1740, 25),
        (1920, 70),  (2100, 25),  (2200, 30),  (2300, 100), (2400, 0),
        (2500, 100), (2600, 0),   (2700, 100), (2800, 0),   (2900, 100),
        (3000, 0),   (3300, 100), (3600, 0),   (3900, 100), (4100, 50),
        (4300, 100), (4500, 50),  (4700, 100), (4800, 50),  (5000, 0),
        (5200, 100), (5400, 0),   (5600, 100),
    ]
    base_len = 5_600
    if duration_ms <= base_len:
        pts = [(t, p) for t, p in base_pts if t <= duration_ms]
        if not pts or pts[-1][0] < duration_ms:
            pts.append((duration_ms, base_pts[-1][1]))
        return [{"at": t, "pos": p} for t, p in pts]

    # Tile the base pattern until we cover duration_ms
    result = []
    tile = 0
    while True:
        offset = tile * base_len
        for t, p in base_pts:
            at = offset + t
            if at > duration_ms:
                break
            result.append({"at": at, "pos": p})
        else:
            tile += 1
            continue
        break
    if not result or result[-1]["at"] < duration_ms:
        result.append({"at": duration_ms, "pos": base_pts[-1][1]})
    return result


_PREVIEW_ACTIONS = _make_preview_actions()

# ---------------------------------------------------------------------------
# Chart helpers
# ---------------------------------------------------------------------------

def _make_chart(actions: List[Dict], color: str, title: str, height: int = 160) -> go.Figure:
    xs = [a["at"] / 1000.0 for a in actions]   # ms → seconds
    ys = [a["pos"] for a in actions]
    fig = go.Figure(go.Scatter(
        x=xs, y=ys,
        mode="lines+markers",
        line=dict(color=color, width=2),
        marker=dict(size=4),
        hovertemplate="%{x:.1f}s  pos %{y}<extra></extra>",
        showlegend=False,
    ))
    fig.update_layout(
        title=dict(text=title, font=dict(size=12), x=0.0, xanchor="left"),
        height=height,
        margin=dict(l=30, r=10, t=30, b=30),
        paper_bgcolor=_BG,
        plot_bgcolor=_BG,
        xaxis=dict(
            gridcolor=_GRID, zeroline=False,
            showticklabels=True, ticksuffix="s",
            title=dict(text="time (s)", font=dict(size=10)),
        ),
        yaxis=dict(gridcolor=_GRID, zeroline=False, range=[-5, 105], title="pos"),
    )
    return fig


# ---------------------------------------------------------------------------
# Parameter widget renderer — returns current param values from session state
# ---------------------------------------------------------------------------

def _render_param_widgets(
    transform_key: str,
    params: dict,
) -> Dict[str, Any]:
    """Render sliders / number inputs for each param; return current values."""
    values: Dict[str, Any] = {}
    if not params:
        return values

    cols = st.columns(min(len(params), 3))
    for col, (pname, p) in zip(
        (cols[i % len(cols)] for i in range(len(params))),
        params.items(),
    ):
        key = f"tc_{transform_key}_{pname}"
        if p.type == "float":
            val = col.slider(
                p.label,
                min_value=float(p.min_val) if p.min_val is not None else 0.0,
                max_value=float(p.max_val) if p.max_val is not None else 1.0,
                value=float(p.default),
                step=float(p.step) if p.step is not None else 0.01,
                key=key,
                help=p.help or None,
            )
        elif p.type == "int":
            # Use slider for bounded params, number_input for large-range ones
            if p.min_val is not None and p.max_val is not None and (p.max_val - p.min_val) <= 200:
                val = col.slider(
                    p.label,
                    min_value=int(p.min_val),
                    max_value=int(p.max_val),
                    value=int(p.default),
                    step=int(p.step) if p.step is not None else 1,
                    key=key,
                    help=p.help or None,
                )
            else:
                val = col.number_input(
                    p.label,
                    min_value=int(p.min_val) if p.min_val is not None else 0,
                    max_value=int(p.max_val) if p.max_val is not None else 9999999,
                    value=int(p.default),
                    step=int(p.step) if p.step is not None else 1,
                    key=key,
                    help=p.help or None,
                )
        else:
            val = p.default
        values[pname] = val
    return values


# ---------------------------------------------------------------------------
# Single transform card
# ---------------------------------------------------------------------------

def _render_transform_card(spec) -> None:
    """Render one transform: header, tags, params, before/after charts."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG  # noqa: F401

    # Header
    badge = "  `structural`" if spec.structural else ""
    st.markdown(f"### {spec.name}{badge}")
    st.write(spec.description)

    # Tag fit
    tags = _TAG_FIT.get(spec.key, [])
    if tags:
        st.caption("Best for: " + " · ".join(tags))

    # Parameters table
    if spec.params:
        rows = []
        for pname, p in spec.params.items():
            range_str = ""
            if p.min_val is not None and p.max_val is not None:
                range_str = f"{p.min_val} – {p.max_val}"
            rows.append({
                "Parameter":   p.label,
                "Type":        p.type,
                "Default":     str(p.default),
                "Range":       range_str,
                "Description": p.help or "",
            })
        st.dataframe(
            pd.DataFrame(rows),
            hide_index=True,
            width="stretch",
        )

    # Choose preview duration
    preview_ms = _PREVIEW_DURATION_MS.get(spec.key, _DEFAULT_PREVIEW_MS)
    before_actions = _make_preview_actions(preview_ms)

    if spec.structural and spec.key not in _SHOW_BEFORE:
        # Replacement transforms generate their shape independently — skip Before chart,
        # show the output full-width so the generated shape fills the available space.
        st.caption("*Structural transform — replaces the original phrase entirely.*")
        param_values = _render_param_widgets(spec.key, spec.params)
        after_actions = spec.apply(before_actions, param_values)
        st.plotly_chart(
            _make_chart(after_actions, _GREEN, "Output", height=220),
            width="stretch",
            config={"displayModeBar": False},
            key=f"tc_chart_after_{spec.key}",
        )
    else:
        chart_left, chart_right = st.columns(2)
        with chart_left:
            st.plotly_chart(
                _make_chart(before_actions, _BLUE, "Before"),
                width="stretch",
                config={"displayModeBar": False},
                key=f"tc_chart_before_{spec.key}",
            )
        with chart_right:
            param_values = _render_param_widgets(spec.key, spec.params)
            after_actions = spec.apply(before_actions, param_values)
            st.plotly_chart(
                _make_chart(after_actions, _GREEN, "After"),
                width="stretch",
                config={"displayModeBar": False},
                key=f"tc_chart_after_{spec.key}",
            )

    st.divider()


# ---------------------------------------------------------------------------
# Tag Catalog
# ---------------------------------------------------------------------------

def _render_tag_chart(
    actions: List[Dict],
    color: str,
    title: str,
    height: int = 140,
) -> go.Figure:
    """Thin wrapper around _make_chart with a smaller default height for tag cards."""
    return _make_chart(actions, color, title, height=height)


# ---------------------------------------------------------------------------
# Tone Catalog
# ---------------------------------------------------------------------------

_TONE_CATALOG = [
    {
        "name": "Tender",
        "icon": "💜",
        "intensity": "Low",
        "description": (
            "Compresses the cycle range and softens pulse onset. "
            "Good for intimate, slow content. Preserves the original shape "
            "while making everything gentler."
        ),
        "sliders": [
            ("Softness", "How much to compress the cycle range. Higher = gentler."),
            ("Pulse onset", "How gradually pulses rise. Higher = softer entry."),
        ],
    },
    {
        "name": "Build",
        "icon": "📈",
        "intensity": "Low → Medium",
        "description": (
            "Creates a rising intensity arc across the phrase. "
            "Starts low and ramps up. Good for scenes that develop over time."
        ),
        "sliders": [
            ("Build rate", "How fast intensity ramps up. Higher = steeper climb."),
            ("Starting intensity", "Where the ramp begins. Lower = more room to grow."),
            ("Arc width", "How wide the sweep pattern is. Higher = broader motion."),
        ],
    },
    {
        "name": "Tease",
        "icon": "🎭",
        "intensity": "Medium",
        "description": (
            "Rise-and-retreat pattern that builds then pulls back before full intensity. "
            "Creates anticipation and denial. Good for edging content."
        ),
        "sliders": [
            ("Retreat depth", "How far intensity pulls back at peaks. Higher = more denial."),
            ("Oscillation speed", "How fast the rise-and-retreat cycles. Higher = faster teasing."),
            ("Pulse variety", "How much the pulse pattern varies. Higher = less predictable."),
        ],
    },
    {
        "name": "Edge",
        "icon": "🔥",
        "intensity": "Medium → High",
        "description": (
            "Sustains a high-intensity plateau before a sharp drop. "
            "Holds the user at peak intensity for as long as possible."
        ),
        "sliders": [
            ("Hold intensity", "The sustained plateau level. Higher = more demanding."),
            ("Drop point", "How late the intensity drops. Higher = longer hold."),
        ],
    },
    {
        "name": "Climax",
        "icon": "💥",
        "intensity": "High",
        "description": (
            "Pushes everything to maximum — range, urgency, sharpness, and frequency. "
            "Designed for the peak moment of a scene."
        ),
        "sliders": [
            ("Peak intensity", "How far to push the range. Higher = more extreme."),
            ("Urgency", "How aggressive the pacing feels. Higher = more relentless."),
            ("Pulse sharpness", "How sharp the pulse edges are. Higher = harder hits."),
            ("Frequency push", "How high the pulse frequency goes. Higher = more intense."),
        ],
    },
    {
        "name": "Dominant",
        "icon": "👊",
        "intensity": "High",
        "description": (
            "Assertive, wide-sweep pattern with minimal intensity dips. "
            "Relentless pacing that doesn't let up."
        ),
        "sliders": [
            ("Drive", "How assertive the device pace is. Higher = harder push."),
            ("Sweep width", "How wide the cycle range. Higher = bigger movements."),
            ("Relentlessness", "How little the intensity dips. Higher = no breaks."),
        ],
    },
]


def _render_tone_catalog() -> None:
    """Render the Tone Catalog section — one card per tone."""
    st.markdown("## Tone Catalog")
    st.info(
        "Tones shape the overall feel of your funscript. Applied globally on the Tone tab, "
        "they adjust amplitude, pacing, and pulse shape to match a mood. "
        "Tones are ordered from gentle to intense.",
        icon=None,
    )

    for tone in _TONE_CATALOG:
        with st.expander(
            f"**{tone['icon']} {tone['name']}** — Intensity: {tone['intensity']}",
            expanded=False,
        ):
            st.write(tone["description"])

            if tone["sliders"]:
                st.caption("**Sliders**")
                for label, hint in tone["sliders"]:
                    st.markdown(f"- **{label}** — {hint}")

    # Summary table
    st.markdown("### Tone Summary")
    rows = []
    for tone in _TONE_CATALOG:
        rows.append({
            "Tone": f"{tone['icon']} {tone['name']}",
            "Intensity": tone["intensity"],
            "Sliders": len(tone["sliders"]),
            "Description": tone["description"][:80] + ("…" if len(tone["description"]) > 80 else ""),
        })
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")


# ---------------------------------------------------------------------------
# Stim Catalog
# ---------------------------------------------------------------------------

_STIM_CATALOG = [
    {
        "name": "Gentle",
        "icon": "🌊",
        "tagline": "Soft, slow-building",
        "description": (
            "Sensation stays close to center and builds gradually — no sharp onset. "
            "Subtle movement with slow pulse build. Good for warming up or winding down."
        ),
        "path": "Semi-circle",
        "sliders": [
            ("Softness", "How far sensation moves from center. Low = very subtle."),
            ("Pulse onset", "How gently pulses start. Higher = softer attack."),
        ],
    },
    {
        "name": "Reactive",
        "icon": "⚡",
        "tagline": "Sharp, tracks every stroke",
        "description": (
            "Sensation follows the action instantly — no lag, wide sweep. "
            "Pulse rate spikes with fast action. Good for fast, intense content."
        ),
        "path": "Three-quarter arc",
        "sliders": [
            ("Reactivity", "How tightly sensation follows each stroke. Low = instant."),
            ("Peak intensity", "Maximum pulse rate during peak action."),
        ],
    },
    {
        "name": "Scene Builder",
        "icon": "🏗️",
        "tagline": "Builds gradually over the scene",
        "description": (
            "Sensation expands as the scene develops. The arc widens over time. "
            "Rewards patience. Works well for longer content with a slow arc."
        ),
        "path": "Full circle",
        "sliders": [
            ("Build speed", "How gradually sensation builds. High = very slow build."),
            ("Arc width", "How far the sensation sweeps across."),
        ],
    },
    {
        "name": "Unpredictable",
        "icon": "🎲",
        "tagline": "Random direction changes",
        "description": (
            "Direction changes without warning. Pulse rate varies widely. "
            "Keeps you guessing. Good for surprise content."
        ),
        "path": "Zigzag",
        "sliders": [
            ("Wildness", "How wide the random movement ranges. High = very wild."),
            ("Variety", "How varied the pulse rate is."),
        ],
    },
    {
        "name": "Balanced",
        "icon": "⚖️",
        "tagline": "Middle of everything",
        "description": (
            "Moderate sweep, steady build, neither too sharp nor too soft. "
            "A good starting point for any content. Works with most scenes."
        ),
        "path": "Full circle",
        "sliders": [
            ("Sweep width", "Width of the sensation sweep."),
            ("Speed / build balance", "More reactive (low) vs. more gradual (high)."),
        ],
    },
]


def _render_stim_catalog() -> None:
    """Render the Stim Catalog section — e-stim character patterns."""
    st.markdown("## Stim Catalog")
    st.info(
        "Stim characters control how funscript motion translates into e-stim sensation. "
        "Each character defines a path shape and signal behavior. "
        "These apply only when an e-stim device (FOC or Stereo) is selected.",
        icon=None,
    )

    for char in _STIM_CATALOG:
        with st.expander(
            f"**{char['icon']} {char['name']}** — {char['tagline']}",
            expanded=False,
        ):
            st.write(char["description"])
            st.caption(f"**Path shape:** {char['path']}")

            if char["sliders"]:
                st.caption("**Sliders**")
                for label, hint in char["sliders"]:
                    st.markdown(f"- **{label}** — {hint}")

    # Summary table
    st.markdown("### Stim Character Summary")
    rows = []
    for char in _STIM_CATALOG:
        rows.append({
            "Character": f"{char['icon']} {char['name']}",
            "Style": char["tagline"],
            "Path": char["path"],
            "Sliders": len(char["sliders"]),
        })
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")


# ---------------------------------------------------------------------------
# Tag Catalog
# ---------------------------------------------------------------------------

def _render_tag_catalog() -> None:
    """Render the Tag Catalog section — one card per behavioral tag."""
    from assessment.classifier import TAGS
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    st.markdown("## Tag Catalog")
    st.info(
        "Behavioral tags describe patterns that may need attention. "
        "Each phrase is automatically tagged during assessment. "
        "Use the Pattern Editor tab to browse and fix phrases by tag.",
        icon=None,
    )

    # Collect catalog stats if available (best-effort)
    catalog = None
    try:
        import streamlit as _st
        catalog = _st.session_state.get("pattern_catalog")
    except Exception:
        pass
    catalog_stats = catalog.get_tag_stats() if catalog else {}

    for tag_key, meta in TAGS.items():
        with st.expander(f"**{meta.label}** — {meta.description[:60]}…", expanded=False):
            col_info, col_charts = st.columns([1, 2])

            with col_info:
                st.markdown(f"### {meta.label}")
                st.write(meta.description)

                # Characteristics from catalog stats
                cs = catalog_stats.get(tag_key, {})
                if cs.get("count", 0) > 0:
                    st.caption(
                        f"Typical BPM {cs['bpm_min']}–{cs['bpm_max']} "
                        f"· span {cs['span_min']}–{cs['span_max']}"
                    )

                # Suggested transform
                spec = TRANSFORM_CATALOG.get(meta.suggested_transform)
                if spec:
                    st.caption(f"Suggested transform: **{spec.name}**")
                    st.caption(meta.fix_hint)
                else:
                    st.caption(f"Suggested transform: **{meta.suggested_transform}**")
                    st.caption(meta.fix_hint)

            with col_charts:
                if not TRANSFORM_CATALOG.get(meta.suggested_transform):
                    continue
                spec = TRANSFORM_CATALOG[meta.suggested_transform]
                preview_ms = _PREVIEW_DURATION_MS.get(meta.suggested_transform, _DEFAULT_PREVIEW_MS)
                before_actions = _make_preview_actions(preview_ms)

                if spec.structural and spec.key not in _SHOW_BEFORE:
                    # Replacement — just show the output
                    default_params = {pk: p.default for pk, p in spec.params.items()}
                    after_actions = spec.apply(before_actions, default_params)
                    st.plotly_chart(
                        _render_tag_chart(after_actions, _GREEN, f"Output — {spec.name}"),
                        width="stretch",
                        config={"displayModeBar": False},
                        key=f"tc_tag_after_{tag_key}",
                    )
                else:
                    c_left, c_right = st.columns(2)
                    with c_left:
                        st.plotly_chart(
                            _render_tag_chart(before_actions, _BLUE, "Before"),
                            width="stretch",
                            config={"displayModeBar": False},
                            key=f"tc_tag_before_{tag_key}",
                        )
                    with c_right:
                        default_params = {pk: p.default for pk, p in spec.params.items()}
                        after_actions = spec.apply(before_actions, default_params)
                        st.plotly_chart(
                            _render_tag_chart(after_actions, _GREEN, f"After — {spec.name}"),
                            width="stretch",
                            config={"displayModeBar": False},
                            key=f"tc_tag_after_{tag_key}",
                        )

    st.markdown("### Behavior Tags (summary)")
    rows = []
    for tag_key, meta in TAGS.items():
        cs = catalog_stats.get(tag_key, {})
        rows.append({
            "Tag":                 meta.label,
            "Description":         meta.description[:80] + ("…" if len(meta.description) > 80 else ""),
            "Suggested Transform": meta.suggested_transform,
            "Catalog Phrases":     cs.get("count", "—"),
        })
    if rows:
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def render() -> None:
    """Render the full Catalogs panel (Transform Catalog + Tag Catalog)."""
    from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG

    st.subheader("Catalogs")
    st.caption(
        "Reference guides for all phrase transforms and behavioral tags. "
        "Adjust parameters to see their effect live on the preview waveform."
    )

    # Track every key that appears in a built-in meta-section
    grouped_keys: set = {
        k
        for _, _, groups in _META
        for _, keys in groups
        for k in keys
    }

    for meta_label, meta_desc, groups in _META:
        st.markdown(f"## {meta_label}")
        st.info(meta_desc, icon=None)

        for group_label, keys in groups:
            specs = [TRANSFORM_CATALOG[k] for k in keys if k in TRANSFORM_CATALOG]
            if not specs:
                continue
            n = len(specs)
            with st.expander(
                f"**{group_label}** ({n} transform{'s' if n != 1 else ''})",
                expanded=True,
            ):
                for spec in specs:
                    _render_transform_card(spec)

    # Auto-display any plugin transforms not already in a meta-section
    extra: Dict[str, list] = {}
    for key, spec in TRANSFORM_CATALOG.items():
        if key not in grouped_keys and not key.startswith("__sep_"):
            cat = getattr(spec, "category", "") or "Plugins"
            extra.setdefault(cat, []).append(spec)

    if extra:
        st.markdown("## Plugins")
        st.info(
            "Plugin transforms are loaded from the `plugins/` or `user_transforms/` "
            "folders at startup. They extend the catalog with custom or experimental "
            "transforms. See `plugins/example_plugin.py` for the authoring template.",
            icon=None,
        )
        for cat, specs in extra.items():
            n = len(specs)
            with st.expander(
                f"**{cat}** ({n} transform{'s' if n != 1 else ''})",
                expanded=True,
            ):
                for spec in specs:
                    _render_transform_card(spec)

    # Tone Catalog
    _render_tone_catalog()

    # Stim Catalog
    _render_stim_catalog()

    # Tag Catalog — appears last
    _render_tag_catalog()
