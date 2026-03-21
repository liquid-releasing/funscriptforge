# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Backward-compat shim — chart logic moved to forge_ui_components.funscript_chart.core

"""funscript_chart.py — Re-exports from forge_ui_components for backward compatibility.

The FunscriptChart class is preserved as a thin wrapper around vibrant_figure()
so existing code that instantiates it continues to work.
"""

from __future__ import annotations

from typing import List

from forge_ui_components.funscript_chart.core import (
    AnnotationBand,
    PointSeries,
    vibrant_figure,
    _LARGE_FUNSCRIPT_THRESHOLD,
)

try:
    import plotly.graph_objects as go
    HAS_PLOTLY = True
except ImportError:
    HAS_PLOTLY = False


class FunscriptChart:
    """Backward-compat wrapper — delegates to vibrant_figure()."""

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

    def render_streamlit(self, view_state, key: str = "chart", height: int = 300):
        import streamlit as st

        if not HAS_PLOTLY:
            st.warning("plotly is not installed — run `pip install plotly`.")
            return None

        fig = self._build_figure(view_state, height)
        event = st.plotly_chart(
            fig, key=key, on_select="rerun", selection_mode=["points", "box"],
        )
        return event

    def _build_figure(self, view_state, height: int) -> "go.Figure":
        return vibrant_figure(
            self.series,
            self.bands,
            view_state=view_state,
            color_mode=getattr(view_state, "color_mode", "velocity"),
            height=height,
            large_funscript_threshold=self.large_funscript_threshold,
            duration_ms=self.duration_ms,
        )
