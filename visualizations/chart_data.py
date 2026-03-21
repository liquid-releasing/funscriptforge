# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Backward-compat shim — all logic moved to forge_ui_components.funscript_chart.core

"""chart_data.py — Re-exports from forge_ui_components for backward compatibility."""

from forge_ui_components.funscript_chart.core import (  # noqa: F401
    ANNOTATION_COLORS,
    AnnotationBand,
    PointSeries,
    _VELOCITY_STOPS,
    _AMPLITUDE_STOPS,
    _hex_to_rgb,
    _interpolate_color,
    _lerp_hex,
    compute_annotation_bands,
    compute_chart_data,
    slice_bands,
    slice_series,
)
