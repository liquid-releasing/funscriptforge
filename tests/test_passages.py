"""Passages — span-relative intensity envelope engine (forge/passages.py).

Covers the five shapes, span resolution from chapter indices, the
absolute-time factor lookup, and the two scaling helpers (e-stim volume vs
multi-axis amplitude). Mirrors the JS shape math in ui/web/src/data/passages.js.
"""

import math

from forge import passages as P


def test_shape_factor_steady_is_identity():
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        assert P.shape_factor("steady", frac, 0.2, 1.0) == 1.0


def test_shape_factor_build_and_release_endpoints():
    assert P.shape_factor("build", 0.0, 0.4, 1.0) == 0.4
    assert P.shape_factor("build", 1.0, 0.4, 1.0) == 1.0
    assert math.isclose(P.shape_factor("build", 0.5, 0.0, 1.0), 0.5)
    # release is the mirror
    assert P.shape_factor("release", 0.0, 0.2, 1.0) == 1.0
    assert math.isclose(P.shape_factor("release", 1.0, 0.2, 1.0), 0.2)


def test_shape_factor_sustain_holds_ceiling():
    for frac in (0.0, 0.5, 1.0):
        assert P.shape_factor("sustain", frac, 0.2, 0.8) == 0.8


def test_shape_factor_swell_peaks_at_middle():
    assert math.isclose(P.shape_factor("swell", 0.0, 0.2, 1.0), 0.2)
    assert math.isclose(P.shape_factor("swell", 0.5, 0.2, 1.0), 1.0)   # peak
    assert math.isclose(P.shape_factor("swell", 1.0, 0.2, 1.0), 0.2)


def test_shape_factor_clamps_out_of_range_frac():
    assert P.shape_factor("build", -0.5, 0.3, 1.0) == 0.3
    assert P.shape_factor("build", 1.5, 0.3, 1.0) == 1.0


CHAPTERS = [
    {"at_ms": 0, "end_ms": 1000},
    {"at_ms": 1000, "end_ms": 2000},
    {"at_ms": 2000, "end_ms": 3000},
]


def test_resolve_maps_indices_to_absolute_spans():
    recs = [{"shape": "build", "beginIdx": 0, "endIdx": 2, "floor": 0.0, "ceiling": 1.0}]
    out = P.resolve_passages(recs, CHAPTERS)
    assert out == [{"lo": 0, "hi": 3000, "shape": "build", "floor": 0.0, "ceiling": 1.0}]


def test_resolve_drops_steady_and_degenerate():
    recs = [
        {"shape": "steady", "beginIdx": 0, "endIdx": 2},          # no-op
        {"shape": "build", "beginIdx": 5, "endIdx": 9},           # clamped to last chapter
    ]
    out = P.resolve_passages(recs, CHAPTERS)
    # steady dropped; the out-of-range build clamps to chapter 2 (lo==hi at the
    # final chapter's bounds is valid since begin/end both clamp to idx 2)
    assert all(p["shape"] != "steady" for p in out)


def test_resolve_swaps_reversed_span():
    recs = [{"shape": "release", "beginIdx": 2, "endIdx": 0, "floor": 0.2, "ceiling": 1.0}]
    out = P.resolve_passages(recs, CHAPTERS)
    assert out[0]["lo"] == 0 and out[0]["hi"] == 3000


def test_factor_at_containment_and_default():
    res = [{"lo": 1000, "hi": 2000, "shape": "build", "floor": 0.0, "ceiling": 1.0}]
    assert P.factor_at(res, 1500) == 0.5         # mid-span
    assert P.factor_at(res, 500) == 1.0          # outside any passage -> identity
    assert P.factor_at(res, 2500) == 1.0


def test_scale_estim_only_volume_channels():
    res = [{"lo": 0, "hi": 1000, "shape": "build", "floor": 0.0, "ceiling": 1.0}]
    # non-volume channel passes through untouched
    assert P.scale_estim("alpha", [{"at": 0, "pos": 100}], res) == [{"at": 0, "pos": 100}]
    # volume channel scaled: frac 0 of a build -> 0
    assert P.scale_estim("volume", [{"at": 0, "pos": 100}], res) == [{"at": 0, "pos": 0}]
    assert P.scale_estim("volume", [{"at": 1000, "pos": 100}], res) == [{"at": 1000, "pos": 100}]
    assert P.scale_estim("volume-prostate", [{"at": 500, "pos": 80}], res) == [{"at": 500, "pos": 40}]


def test_scale_axis_toward_center():
    res = [{"lo": 0, "hi": 1000, "shape": "release", "floor": 0.0, "ceiling": 1.0}]
    # release frac 1 -> factor 0 -> everything collapses to center (50)
    assert P.scale_axis([{"at": 1000, "pos": 100}], res) == [{"at": 1000, "pos": 50}]
    assert P.scale_axis([{"at": 1000, "pos": 0}], res) == [{"at": 1000, "pos": 50}]
    # frac 0 -> factor 1 -> unchanged
    assert P.scale_axis([{"at": 0, "pos": 100}], res) == [{"at": 0, "pos": 100}]


def test_no_passages_is_noop():
    assert P.scale_estim("volume", [{"at": 0, "pos": 100}], []) == [{"at": 0, "pos": 100}]
    assert P.scale_axis([{"at": 0, "pos": 100}], []) == [{"at": 0, "pos": 100}]
    assert P.factor_at([], 500) == 1.0


# ── parametric eased envelope ──────────────────────────────────────

def test_build_is_eased_not_linear():
    # A straight build would be 0.25 at frac 0.25; the smoothstep ease sits
    # below that early (slow start), above it late. Endpoints + midpoint match.
    assert P.shape_factor("build", 0.25, 0.0, 1.0) < 0.25
    assert P.shape_factor("build", 0.75, 0.0, 1.0) > 0.75
    assert math.isclose(P.shape_factor("build", 0.5, 0.0, 1.0), 0.5)
    assert P.shape_factor("build", 0.0, 0.0, 1.0) == 0.0
    assert P.shape_factor("build", 1.0, 0.0, 1.0) == 1.0


def test_explicit_rise_fall_override_shape():
    # "Build & hold": rise by 0.5, then hold at ceiling to the end.
    f = lambda frac: P.envelope_factor(frac, 0.3, 1.0, 0.5, 1.0)
    assert math.isclose(f(0.5), 1.0)   # reaches the top at the rise point
    assert math.isclose(f(0.8), 1.0)   # and holds there
    assert f(0.25) > 0.3 and f(0.25) < 1.0
    # shape_factor threads explicit points through (over the shape's defaults)
    assert math.isclose(P.shape_factor("build", 0.8, 0.3, 1.0, 0.5, 1.0), 1.0)


def test_envelope_hold_plateau_between_rise_and_fall():
    # rise 0.3, fall 0.7 → flat ceiling across the middle, eased on both sides.
    f = lambda frac: P.envelope_factor(frac, 0.2, 1.0, 0.3, 0.7)
    assert math.isclose(f(0.5), 1.0)
    assert math.isclose(f(0.3), 1.0) and math.isclose(f(0.7), 1.0)
    assert math.isclose(f(0.0), 0.2) and math.isclose(f(1.0), 0.2)


def test_resolve_carries_explicit_points():
    recs = [{"shape": "build", "beginIdx": 0, "endIdx": 2, "floor": 0.3,
             "ceiling": 1.0, "risePoint": 0.5, "fallPoint": 1.0}]
    out = P.resolve_passages(recs, CHAPTERS)
    assert out[0]["rise_point"] == 0.5 and out[0]["fall_point"] == 1.0
    # and factor_at honors them: held at ceiling by 80% through the span
    assert math.isclose(P.factor_at(out, 2400), 1.0)
