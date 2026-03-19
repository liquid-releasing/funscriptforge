# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""funscript_chart.py — Reusable Plotly-based funscript chart widget.

Renders a single funscript channel as a colour-coded line chart with
phrase annotation boxes and an optional selection highlight.

Requirements
------------
    pip install plotly
"""

from __future__ import annotations

from math import ceil
from typing import List, Tuple

from visualizations.chart_data import (
    AnnotationBand,
    PointSeries,
    slice_bands,
    slice_series,
)

try:
    import plotly.graph_objects as go
    HAS_PLOTLY = True
except ImportError:
    HAS_PLOTLY = False


# Viewport segment threshold: used only to scale dot size.
_MAX_SEGMENT_TRACES = 600

# Funscripts with more total actions than this use the fast grey-line rendering
# (grey line + coloured dots) in all views.  Smaller funscripts use per-segment
# coloured lines so line and dot colours match throughout.
_LARGE_FUNSCRIPT_THRESHOLD = 2500


class FunscriptChart:
    """Renders a single funscript panel.

    Parameters
    ----------
    series:
        Pre-computed :class:`~visualizations.chart_data.PointSeries`.
    bands:
        Pre-computed annotation bands (all of them — filtering by enabled
        kinds happens inside the render call).
    title:
        Panel title shown at the top.
    duration_ms:
        Full funscript duration.  Used to set the default x-axis range.
    """

    def __init__(
        self,
        series: PointSeries,
        bands: List[AnnotationBand],
        title: str = "",
        duration_ms: int = 0,
        large_funscript_threshold: int = _LARGE_FUNSCRIPT_THRESHOLD,
    ) -> None:
        self.series = series
        self.bands = bands
        self.title = title
        self.duration_ms = duration_ms
        self.large_funscript_threshold = large_funscript_threshold

    # ------------------------------------------------------------------
    # Streamlit rendering
    # ------------------------------------------------------------------

    def render_streamlit(
        self,
        view_state,
        key: str = "chart",
        height: int = 300,
    ):
        """Render the chart inside a Streamlit app.

        Returns the Plotly event dict (may be None or empty).
        """
        import streamlit as st

        if not HAS_PLOTLY:
            st.warning("plotly is not installed — run `pip install plotly`.")
            return None

        fig = self._build_figure(view_state, height)
        event = st.plotly_chart(
                fig,
                key=key,
                on_select="rerun",
                selection_mode=["points", "box"],
            )
        return event

    # ------------------------------------------------------------------
    # Figure construction
    # ------------------------------------------------------------------

    def _build_figure(self, view_state, height: int) -> "go.Figure":
        color_mode = view_state.color_mode

        full_start = self.series.times_ms[0]  if self.series.times_ms else 0
        full_end   = self.series.times_ms[-1] if self.series.times_ms else self.duration_ms

        # X viewport: use zoom window if set, otherwise show full funscript
        if view_state.has_zoom():
            x_start = view_state.zoom_start_ms
            x_end   = view_state.zoom_end_ms
            s = slice_series(self.series, x_start, x_end)
            visible_bands = slice_bands(self.bands, x_start, x_end)
        else:
            x_start = full_start
            x_end   = full_end
            s = self.series
            visible_bands = self.bands

        colors = s.colors_velocity if color_mode == "velocity" else s.colors_amplitude

        has_selection = view_state.has_selection()
        fig = go.Figure()

        # --- Phrase bounding boxes ---
        for band in visible_bands:
            if band.kind != "phrase":
                continue
            is_selected = (
                has_selection
                and view_state.selection_start_ms == band.start_ms
                and view_state.selection_end_ms   == band.end_ms
            )
            if is_selected:
                border = "rgba(255,220,50,1.0)"
                fill   = "rgba(255,220,50,0.15)"
            elif has_selection:
                # Dim unselected phrases when another is active
                border = "rgba(218,112,214,0.40)"
                fill   = "rgba(60,60,80,0.45)"
            else:
                border = "rgba(218,112,214,0.85)"
                fill   = "rgba(218,112,214,0.12)"
            fig.add_vrect(
                x0=band.start_ms, x1=band.end_ms,
                fillcolor=fill,
                line_width=2, line_color=border,
                layer="below",
            )
            if band.name:
                fig.add_annotation(
                    x=band.start_ms, y=97,
                    text=band.name,
                    showarrow=False,
                    xanchor="left", yanchor="top",
                    font=dict(size=11, color=border),
                    bgcolor="rgba(0,0,0,0)",
                )

        # --- Invisible phrase hit targets (allow clicking anywhere inside a phrase box) ---
        # Place a grid of transparent markers across each phrase so any click inside
        # the bounding box registers as a point event and triggers phrase selection.
        _HIT_STEP_MS = 1_000   # one column of hit targets per second
        _HIT_Y_LEVELS = [20, 50, 80]
        for band in visible_bands:
            if band.kind != "phrase":
                continue
            xs = list(range(band.start_ms, band.end_ms + _HIT_STEP_MS, _HIT_STEP_MS))
            hit_x = xs * len(_HIT_Y_LEVELS)
            hit_y = [y for y in _HIT_Y_LEVELS for _ in xs]
            fig.add_trace(go.Scatter(
                x=hit_x,
                y=hit_y,
                mode="markers",
                marker=dict(color="rgba(0,0,0,0)", size=18, line=dict(width=0)),
                hoverinfo="skip",
                showlegend=False,
            ))

        # --- Motion line + dots ---
        n = len(s.times_ms)
        dot_size = 5 if (n - 1) <= _MAX_SEGMENT_TRACES else 3
        large = len(self.series.times_ms) > self.large_funscript_threshold

        if n > 0:
            if large:
                # Large funscript: single grey line for speed, coloured dots on top.
                # Exception: within the selected phrase window, overlay per-segment
                # coloured lines so the active phrase is visually distinct.
                fig.add_trace(go.Scatter(
                    x=s.times_ms,
                    y=s.positions,
                    mode="lines",
                    line=dict(color="rgba(200,200,200,0.55)", width=1),
                    showlegend=False,
                    hoverinfo="skip",
                ))
                if has_selection:
                    sel_s = slice_series(
                        s,
                        view_state.selection_start_ms,
                        view_state.selection_end_ms,
                    )
                    sel_colors = (
                        sel_s.colors_velocity
                        if color_mode == "velocity"
                        else sel_s.colors_amplitude
                    )
                    sn = len(sel_s.times_ms)
                    for i in range(sn - 1):
                        fig.add_trace(go.Scatter(
                            x=[sel_s.times_ms[i], sel_s.times_ms[i + 1]],
                            y=[sel_s.positions[i], sel_s.positions[i + 1]],
                            mode="lines",
                            line=dict(color=sel_colors[i], width=2),
                            showlegend=False,
                            hoverinfo="skip",
                        ))
            else:
                # Small funscript: per-segment coloured lines match dot colours
                for i in range(n - 1):
                    fig.add_trace(go.Scatter(
                        x=[s.times_ms[i], s.times_ms[i + 1]],
                        y=[s.positions[i], s.positions[i + 1]],
                        mode="lines",
                        line=dict(color=colors[i], width=2),
                        showlegend=False,
                        hoverinfo="skip",
                    ))
            fig.add_trace(go.Scatter(
                x=s.times_ms,
                y=s.positions,
                mode="markers",
                marker=dict(color=colors, size=dot_size, line=dict(width=0)),
                hovertemplate="t=%{x} ms  pos=%{y}<extra></extra>",
                name=self.title or "",
                showlegend=False,
            ))

        # --- Layout ---
        tickvals, ticktext = _compute_ticks(x_start, x_end)
        # Angle tick labels when the span exceeds 15 minutes to prevent overlap
        tickangle = -45 if (x_end - x_start) > 900_000 else 0
        bottom_margin = 60 if tickangle else 30

        fig.update_layout(
            title=dict(text=self.title, font=dict(size=12)) if self.title else None,
            height=height,
            margin=dict(l=45, r=10, t=30 if self.title else 10, b=bottom_margin),
            paper_bgcolor="#0e1117",
            plot_bgcolor="#1a1d23",
            font=dict(color="#cccccc"),
            xaxis=dict(
                title=None,
                range=[x_start, x_end],
                color="#aaaaaa",
                showgrid=False,
                tickvals=tickvals,
                ticktext=ticktext,
                tickangle=tickangle,
                fixedrange=True,
            ),
            yaxis=dict(
                title="pos",
                range=[0, 100],
                color="#aaaaaa",
                showgrid=False,
                fixedrange=True,
            ),
            showlegend=False,
            dragmode=False,
        )

        return fig


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _compute_ticks(
    start_ms: int, end_ms: int, max_ticks: int = 20
) -> Tuple[List[int], List[str]]:
    """Return (tickvals, ticktext) for a human-readable time axis.

    The step size is chosen so there are at most *max_ticks* labels.
    """
    span = end_ms - start_ms
    candidates = [500, 1_000, 5_000, 10_000, 30_000, 60_000, 120_000,
                  300_000, 600_000, 900_000, 1_800_000]
    step = candidates[-1]
    for c in candidates:
        if span / c <= max_ticks:
            step = c
            break

    first = ceil(start_ms / step) * step
    vals  = list(range(first, end_ms + 1, step))
    texts = [_format_ms(v) for v in vals]
    return vals, texts


def _format_ms(ms: int) -> str:
    """Format milliseconds as M:SS or M:SS.t (tenths of a second)."""
    total_s = ms // 1000
    m  = total_s // 60
    s  = total_s % 60
    sub = ms % 1000
    if sub == 0:
        return f"{m}:{s:02d}"
    return f"{m}:{s:02d}.{sub // 100}"
