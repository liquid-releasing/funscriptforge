# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for funscript chart — Plotly chart widget (via forge_ui_components)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from forge_ui_components.funscript_chart.core import AnnotationBand, compute_chart_data, vibrant_figure


# ---------------------------------------------------------------------------
# Minimal view-state stub
# ---------------------------------------------------------------------------

class _ViewState:
    """Minimal stand-in for the Streamlit view-state object used by vibrant_figure."""

    def __init__(
        self,
        color_mode="velocity",
        zoom_start_ms=None,
        zoom_end_ms=None,
        selection_start_ms=None,
        selection_end_ms=None,
    ):
        self.color_mode = color_mode
        self.zoom_start_ms = zoom_start_ms
        self.zoom_end_ms = zoom_end_ms
        self.selection_start_ms = selection_start_ms
        self.selection_end_ms = selection_end_ms

    def has_zoom(self) -> bool:
        return self.zoom_start_ms is not None and self.zoom_end_ms is not None

    def has_selection(self) -> bool:
        return self.selection_start_ms is not None and self.selection_end_ms is not None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_actions(n: int, step_ms: int = 100) -> list:
    """Return *n* alternating actions at positions 10 and 90."""
    return [{"at": i * step_ms, "pos": 10 if i % 2 == 0 else 90} for i in range(n)]


def _scatter_traces(fig) -> list:
    """Return only Scatter traces from a Plotly figure."""
    try:
        import plotly.graph_objects as go
    except ImportError:
        return []
    return [t for t in fig.data if isinstance(t, go.Scatter)]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestBuildFigureSmall(unittest.TestCase):
    """vibrant_figure works for small series (< 10 actions)."""

    def test_build_figure_small(self):
        """Small series (< 10 actions) builds a figure without error."""
        actions = _make_actions(5)
        series = compute_chart_data(actions)

        view = _ViewState(color_mode="velocity")
        fig = vibrant_figure(series, [], view_state=view, height=300, duration_ms=400)

        # Must return a Plotly Figure
        try:
            import plotly.graph_objects as go
            self.assertIsInstance(fig, go.Figure)
        except ImportError:
            self.skipTest("plotly not installed")

        # With 5 points there should be 4 per-segment line traces + 1 markers trace
        traces = _scatter_traces(fig)
        self.assertGreaterEqual(len(traces), 1)

        # The markers trace (last one added) should carry the positions
        marker_trace = traces[-1]
        self.assertEqual(list(marker_trace.x), series.times_ms)
        self.assertEqual(list(marker_trace.y), series.positions)


class TestBuildFigureLarge(unittest.TestCase):
    """vibrant_figure uses grey-line mode for series above the large threshold."""

    def test_build_figure_large(self):
        """Series of 30 000 actions uses grey-line mode (only 2 traces: grey line + markers)."""
        try:
            import plotly.graph_objects as go
        except ImportError:
            self.skipTest("plotly not installed")

        actions = _make_actions(30_000)
        series = compute_chart_data(actions)

        view = _ViewState(color_mode="velocity")
        fig = vibrant_figure(series, [], view_state=view, height=300, duration_ms=30_000 * 100)

        traces = _scatter_traces(fig)

        # Grey-line mode emits exactly 2 Scatter traces: the grey line and the
        # coloured markers.  No per-segment coloured line traces should exist.
        self.assertEqual(
            len(traces),
            2,
            f"Expected 2 traces in grey-line mode, got {len(traces)}",
        )

        # First trace is the grey line (lines mode, no markers)
        grey_line = traces[0]
        self.assertEqual(grey_line.mode, "lines")
        # Its colour should contain the grey rgba used for large funscripts
        self.assertIn("200,200,200", grey_line.line.color)

        # Second trace is the coloured marker scatter
        marker_trace = traces[1]
        self.assertEqual(marker_trace.mode, "markers")


class TestLargeThresholdConfigurable(unittest.TestCase):
    """Passing a custom large_funscript_threshold forces grey-line mode early."""

    def test_large_threshold_configurable(self):
        """Setting large_funscript_threshold=5 forces grey-line mode for a 6-point series."""
        try:
            import plotly.graph_objects as go
        except ImportError:
            self.skipTest("plotly not installed")

        actions = _make_actions(6)
        series = compute_chart_data(actions)

        view = _ViewState(color_mode="velocity")
        fig = vibrant_figure(
            series, [],
            view_state=view,
            height=300,
            duration_ms=600,
            large_funscript_threshold=5,  # 6 points > 5 → large mode
        )

        traces = _scatter_traces(fig)

        # Grey-line mode: 2 traces only (no per-segment lines)
        self.assertEqual(
            len(traces),
            2,
            f"Expected 2 traces with threshold=5 and 6 actions, got {len(traces)}",
        )

        grey_line = traces[0]
        self.assertEqual(grey_line.mode, "lines")
        self.assertIn("200,200,200", grey_line.line.color)

        marker_trace = traces[1]
        self.assertEqual(marker_trace.mode, "markers")


if __name__ == "__main__":
    unittest.main()
