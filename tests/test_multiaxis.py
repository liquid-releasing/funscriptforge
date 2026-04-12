# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Tests for multi-axis generation algorithms and stitching."""

from __future__ import annotations

import pytest


# ── Test data ─────────────────────────────────────────────────────────

def _make_actions(n: int = 200, duration_ms: int = 10000) -> list[dict]:
    """Create a simple oscillating funscript for testing."""
    actions = []
    for i in range(n):
        t = int(i * duration_ms / n)
        pos = int(50 + 40 * (1 if i % 4 < 2 else -1))
        actions.append({"at": t, "pos": pos})
    return actions


def _make_phrases(n: int = 4, duration_ms: int = 10000) -> list[dict]:
    """Create evenly spaced phrases."""
    seg = duration_ms // n
    return [{"start_ms": i * seg, "end_ms": (i + 1) * seg, "bpm": 120}
            for i in range(n)]


# ── Algorithm tests ───────────────────────────────────────────────────


class TestAlgoNone:
    def test_returns_neutral(self):
        from forge.multiaxis import algo_none
        sig = algo_none([0, 100, 200], [0, 50, 100])
        assert all(p == 50.0 for p in sig.positions)
        assert len(sig.times_ms) == 3

    def test_empty_input(self):
        from forge.multiaxis import algo_none
        sig = algo_none([], [])
        assert sig.times_ms == []
        assert sig.positions == []


class TestAlgoSine:
    def test_oscillates_around_center(self):
        from forge.multiaxis import algo_sine
        times = list(range(0, 2000, 10))  # 200 samples over 2s
        pos = [50.0] * len(times)
        sig = algo_sine(times, pos, amplitude=0.5, freq_hz=1.0)
        assert len(sig.positions) == len(times)
        # Should oscillate around 50
        assert min(sig.positions) < 50
        assert max(sig.positions) > 50
        # All within 0-100
        assert all(0 <= p <= 100 for p in sig.positions)

    def test_zero_amplitude_is_flat(self):
        from forge.multiaxis import algo_sine
        times = list(range(0, 1000, 10))
        pos = [50.0] * len(times)
        sig = algo_sine(times, pos, amplitude=0.0)
        assert all(abs(p - 50.0) < 0.01 for p in sig.positions)


class TestAlgoCorrelateStroke:
    def test_positive_correlation(self):
        from forge.multiaxis import algo_correlate_stroke
        times = [0, 100, 200]
        pos = [0, 50, 100]  # rising stroke
        sig = algo_correlate_stroke(times, pos, correlation=1.0, amplitude=1.0)
        # Should follow stroke: low→mid→high
        assert sig.positions[0] < sig.positions[1] < sig.positions[2]

    def test_negative_correlation_inverts(self):
        from forge.multiaxis import algo_correlate_stroke
        times = [0, 100, 200]
        pos = [0, 50, 100]
        sig = algo_correlate_stroke(times, pos, correlation=-1.0, amplitude=1.0)
        # Should invert: high→mid→low
        assert sig.positions[0] > sig.positions[1] > sig.positions[2]

    def test_bias_shifts_center(self):
        from forge.multiaxis import algo_correlate_stroke
        times = [0, 100, 200]
        pos = [50, 50, 50]  # neutral stroke
        sig_no_bias = algo_correlate_stroke(times, pos, bias=0.0)
        sig_bias = algo_correlate_stroke(times, pos, bias=0.5)
        # Biased version should be higher
        assert all(b > n for b, n in zip(sig_bias.positions, sig_no_bias.positions))


class TestAlgoRandomWalk:
    def test_deterministic_with_same_seed(self):
        from forge.multiaxis import algo_random_walk
        times = list(range(0, 1000, 10))
        pos = [50.0] * len(times)
        sig1 = algo_random_walk(times, pos, seed=42)
        sig2 = algo_random_walk(times, pos, seed=42)
        assert sig1.positions == sig2.positions

    def test_different_seed_different_output(self):
        from forge.multiaxis import algo_random_walk
        times = list(range(0, 1000, 10))
        pos = [50.0] * len(times)
        sig1 = algo_random_walk(times, pos, seed=42)
        sig2 = algo_random_walk(times, pos, seed=99)
        assert sig1.positions != sig2.positions

    def test_stays_in_range(self):
        from forge.multiaxis import algo_random_walk
        times = list(range(0, 5000, 10))
        pos = [50.0] * len(times)
        sig = algo_random_walk(times, pos, amplitude=1.0, smoothing=0.1)
        assert all(0 <= p <= 100 for p in sig.positions)


# ── Full generation tests ─────────────────────────────────────────────


class TestGenerateMultiaxis:
    def test_no_styles_produces_empty(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        result = generate_multiaxis(actions, phrases, {}, MULTIAXIS_PRESETS)
        assert not result.active_axes()

    def test_cowgirl_produces_roll_pitch_twist(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        styles = {0: "Cowgirl", 1: "Cowgirl", 2: "Cowgirl", 3: "Cowgirl"}
        result = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        active = result.active_axes()
        assert "roll" in active
        assert "pitch" in active
        assert "twist" in active

    def test_missionary_produces_roll_pitch(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        styles = {0: "Missionary"}
        result = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        active = result.active_axes()
        assert "roll" in active
        assert "pitch" in active
        assert "twist" not in active

    def test_riding_produces_all_five(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        styles = {0: "Riding", 1: "Riding", 2: "Riding", 3: "Riding"}
        result = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        active = result.active_axes()
        assert len(active) == 5

    def test_mixed_styles_per_phrase(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        styles = {0: "Cowgirl", 2: "Doggy"}  # phrases 1 and 3 = None
        result = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        active = result.active_axes()
        # Cowgirl uses roll+pitch+twist; Doggy uses pitch
        assert "pitch" in active
        assert "roll" in active  # from Cowgirl

    def test_output_stays_in_range(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions(n=500, duration_ms=30000)
        phrases = _make_phrases(n=6, duration_ms=30000)
        styles = {i: "Random" for i in range(6)}
        result = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        for axis_name, signal in result.active_axes().items():
            assert all(0 <= p <= 100 for p in signal.positions), \
                f"{axis_name} has out-of-range positions"

    def test_deterministic_output(self):
        from forge.multiaxis import generate_multiaxis
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        actions = _make_actions()
        phrases = _make_phrases()
        styles = {0: "Random", 1: "Cowgirl"}
        r1 = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        r2 = generate_multiaxis(actions, phrases, styles, MULTIAXIS_PRESETS)
        for axis_name in r1.active_axes():
            assert r1.active_axes()[axis_name].positions == \
                   r2.active_axes()[axis_name].positions


# ── Funscript conversion tests ────────────────────────────────────────


class TestMultiaxisToFunscript:
    def test_clamps_to_0_100(self):
        from forge.multiaxis import AxisSignal, multiaxis_to_funscript_actions
        sig = AxisSignal(times_ms=[0, 100, 200], positions=[-10.0, 50.0, 110.0])
        actions = multiaxis_to_funscript_actions(sig)
        assert actions[0]["pos"] == 0
        assert actions[1]["pos"] == 50
        assert actions[2]["pos"] == 100

    def test_rounds_positions(self):
        from forge.multiaxis import AxisSignal, multiaxis_to_funscript_actions
        sig = AxisSignal(times_ms=[0, 100], positions=[33.7, 66.3])
        actions = multiaxis_to_funscript_actions(sig)
        assert actions[0]["pos"] == 34
        assert actions[1]["pos"] == 66


# ── Preset tests ──────────────────────────────────────────────────────


class TestPresets:
    def test_all_presets_have_valid_algorithms(self):
        from forge.multiaxis import ALGORITHMS
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        for style_name, preset in MULTIAXIS_PRESETS.items():
            for axis_name, cfg in preset.items():
                if axis_name.startswith("_"):
                    continue
                algo = cfg.get("algorithm", "none")
                assert algo in ALGORITHMS, \
                    f"{style_name}.{axis_name} uses unknown algorithm: {algo}"

    def test_style_names_list_matches_presets(self):
        from forge.multiaxis_presets import MULTIAXIS_PRESETS, STYLE_NAMES
        for name in STYLE_NAMES:
            if name == "None":
                continue
            assert name in MULTIAXIS_PRESETS, f"Style '{name}' not in presets"

    def test_five_presets_exist(self):
        from forge.multiaxis_presets import MULTIAXIS_PRESETS
        assert len(MULTIAXIS_PRESETS) == 5
