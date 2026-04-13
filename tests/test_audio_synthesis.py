# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Tests for audio synthesis — rendering funscript channels to stereo audio."""

from __future__ import annotations

import json
import os
import struct
import tempfile

import numpy as np
import pytest


# ── Helpers ──────────────────────────────────────────────────────────


def _write_funscript(path: str, actions: list[dict]):
    """Write a minimal funscript file."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"actions": actions}, f)


def _make_simple_actions(duration_ms: int = 10000, n_points: int = 100) -> list[dict]:
    """Create a simple oscillating funscript."""
    actions = []
    for i in range(n_points):
        t = int(i * duration_ms / n_points)
        # Oscillate between 20 and 80
        pos = 50 + 30 * (1 if i % 4 < 2 else -1)
        actions.append({"at": t, "pos": pos})
    return actions


def _make_constant_actions(pos: int = 50, duration_ms: int = 5000) -> list[dict]:
    """Create a constant-position funscript."""
    return [
        {"at": 0, "pos": pos},
        {"at": duration_ms, "pos": pos},
    ]


# ── restim_math unit tests ──────────────────────────────────────────


class TestThreePhaseSignalGenerator:
    def test_generate_returns_two_channels(self):
        from forge.restim_math.threephase import ThreePhaseSignalGenerator
        theta = np.linspace(0, 2 * np.pi * 10, 1000)
        alpha = np.zeros(1000, dtype=np.float32)
        beta = np.zeros(1000, dtype=np.float32)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha, beta)
        assert len(L) == 1000
        assert len(R) == 1000

    def test_output_is_float32(self):
        from forge.restim_math.threephase import ThreePhaseSignalGenerator
        theta = np.linspace(0, 2 * np.pi, 100, dtype=np.float32)
        alpha = np.full(100, 0.5, dtype=np.float32)
        beta = np.full(100, 0.0, dtype=np.float32)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha, beta)
        assert L.dtype == np.float32
        assert R.dtype == np.float32

    def test_center_position_produces_low_amplitude(self):
        from forge.restim_math.threephase import ThreePhaseSignalGenerator
        theta = np.linspace(0, 2 * np.pi * 10, 1000)
        # Position at center (0, 0) should produce minimal output
        alpha = np.zeros(1000, dtype=np.float32)
        beta = np.zeros(1000, dtype=np.float32)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha, beta)
        # At center, amplitude should be relatively low
        assert np.max(np.abs(L)) < 1.0
        assert np.max(np.abs(R)) < 1.0

    def test_nonzero_position_produces_output(self):
        from forge.restim_math.threephase import ThreePhaseSignalGenerator
        theta = np.linspace(0, 2 * np.pi * 10, 1000)
        alpha = np.full(1000, 0.8, dtype=np.float32)
        beta = np.full(1000, 0.0, dtype=np.float32)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha, beta)
        # Off-center should produce significant output
        assert np.max(np.abs(L)) > 0.01 or np.max(np.abs(R)) > 0.01

    def test_chunked_matches_single(self):
        from forge.restim_math.threephase import ThreePhaseSignalGenerator
        n = 25000  # Large enough to trigger chunking
        theta = np.linspace(0, 2 * np.pi * 50, n)
        alpha = np.full(n, 0.5, dtype=np.float32)
        beta = np.full(n, 0.3, dtype=np.float32)
        # Generate with default chunking
        L1, R1 = ThreePhaseSignalGenerator.generate(theta, alpha, beta)
        # Generate without chunking
        L2, R2 = ThreePhaseSignalGenerator.generate(
            theta, alpha.copy(), beta.copy(), chunksize=n + 1
        )
        np.testing.assert_allclose(L1, L2, atol=1e-6)
        np.testing.assert_allclose(R1, R2, atol=1e-6)


class TestAngleGenerator:
    def test_phase_continuity(self):
        from forge.restim_math.sine_generator import AngleGenerator
        gen = AngleGenerator()
        chunk1 = gen.generate(100, 700.0, 44100)
        chunk2 = gen.generate(100, 700.0, 44100)
        # Second chunk should start where first ended
        assert abs(chunk2[0] - chunk1[-1]) < 0.1

    def test_frequency_determines_phase_rate(self):
        from forge.restim_math.sine_generator import AngleGenerator
        gen = AngleGenerator()
        theta = gen.generate(44100, 700.0, 44100)
        # One second at 700 Hz = 700 full cycles = 700 * 2π radians
        expected_end = 2 * np.pi * 700
        assert abs(theta[-1] - expected_end) < 1.0


class TestPulseEnvelope:
    def test_starts_and_ends_near_zero(self):
        from forge.restim_math.pulse import create_pulse_with_ramp_time
        env = create_pulse_with_ramp_time(1000, 5.0, 2.0)
        assert env[0] < 0.05
        assert env[-1] < 0.05

    def test_peak_near_one(self):
        from forge.restim_math.pulse import create_pulse_with_ramp_time
        env = create_pulse_with_ramp_time(1000, 5.0, 2.0)
        assert np.max(env) > 0.95

    def test_all_non_negative(self):
        from forge.restim_math.pulse import create_pulse_with_ramp_time
        env = create_pulse_with_ramp_time(500, 5.0, 2.0)
        assert np.all(env >= 0)


class TestTransforms:
    def test_matrices_are_invertible(self):
        from forge.restim_math.transforms import (
            potential_to_channel_matrix,
            potential_to_channel_matrix_inv,
            ab_transform,
            ab_transform_inv,
        )
        identity_p = potential_to_channel_matrix @ potential_to_channel_matrix_inv
        np.testing.assert_allclose(identity_p, np.eye(3), atol=1e-5)
        identity_ab = ab_transform @ ab_transform_inv
        np.testing.assert_allclose(identity_ab, np.eye(3), atol=1e-5)


class TestCenterCalibration:
    def test_zero_db_is_unity(self):
        from forge.restim_math.threephase import ThreePhaseCenterCalibration
        cal = ThreePhaseCenterCalibration(0.0)
        scale = cal.get_scale(0.5, 0.5)
        assert abs(scale - 1.0) < 0.01

    def test_negative_db_reduces_center(self):
        from forge.restim_math.threephase import ThreePhaseCenterCalibration
        cal = ThreePhaseCenterCalibration(-3.0)
        center_scale = cal.get_scale(0.0, 0.0)
        edge_scale = cal.get_scale(1.0, 0.0)
        assert center_scale < edge_scale


# ── Funscript loading tests ─────────────────────────────────────────


class TestLoadFunscript:
    def test_loads_actions(self):
        from forge.audio_synthesis import _load_funscript
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".funscript", delete=False
        ) as f:
            json.dump({"actions": [
                {"at": 0, "pos": 0},
                {"at": 1000, "pos": 50},
                {"at": 2000, "pos": 100},
            ]}, f)
            path = f.name

        try:
            t, y = _load_funscript(path)
            assert len(t) == 3
            np.testing.assert_allclose(t, [0.0, 1.0, 2.0])
            np.testing.assert_allclose(y, [0.0, 0.5, 1.0])
        finally:
            os.unlink(path)

    def test_empty_actions_returns_neutral(self):
        from forge.audio_synthesis import _load_funscript
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".funscript", delete=False
        ) as f:
            json.dump({"actions": []}, f)
            path = f.name

        try:
            t, y = _load_funscript(path)
            assert len(t) == 1
            assert y[0] == 0.5
        finally:
            os.unlink(path)

    def test_clamps_out_of_range(self):
        from forge.audio_synthesis import _load_funscript
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".funscript", delete=False
        ) as f:
            json.dump({"actions": [
                {"at": 0, "pos": -10},
                {"at": 1000, "pos": 150},
            ]}, f)
            path = f.name

        try:
            t, y = _load_funscript(path)
            assert y[0] == 0.0
            assert y[1] == 1.0
        finally:
            os.unlink(path)


# ── Full render tests ────────────────────────────────────────────────


@pytest.fixture
def funscript_pair(tmp_path):
    """Create a pair of alpha/beta funscripts for testing."""
    alpha_path = str(tmp_path / "test.alpha.funscript")
    beta_path = str(tmp_path / "test.beta.funscript")
    _write_funscript(alpha_path, _make_simple_actions(duration_ms=5000))
    _write_funscript(beta_path, _make_simple_actions(duration_ms=5000))
    return alpha_path, beta_path


class TestRenderContinuous:
    def test_renders_wav(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        result = render_stereo_audio(alpha, beta, out, duration_s=2.0)
        assert os.path.isfile(out)
        assert result.file_size_bytes > 0
        assert result.waveform == "continuous"
        assert result.duration_s == 2.0

    def test_output_is_stereo(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        render_stereo_audio(alpha, beta, out, duration_s=1.0)
        info = sf.info(out)
        assert info.channels == 2
        assert info.samplerate == 44100

    def test_duration_matches(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        render_stereo_audio(alpha, beta, out, duration_s=3.0)
        info = sf.info(out)
        assert abs(info.duration - 3.0) < 0.01

    def test_peak_amplitude_in_range(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        result = render_stereo_audio(alpha, beta, out, duration_s=2.0)
        assert 0 < result.peak_amplitude <= 1.0

    def test_deterministic(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out1 = str(tmp_path / "out1.wav")
        out2 = str(tmp_path / "out2.wav")
        render_stereo_audio(alpha, beta, out1, duration_s=1.0)
        render_stereo_audio(alpha, beta, out2, duration_s=1.0)
        data1, _ = sf.read(out1)
        data2, _ = sf.read(out2)
        np.testing.assert_array_equal(data1, data2)

    def test_carrier_frequency_affects_output(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out_lo = str(tmp_path / "lo.wav")
        out_hi = str(tmp_path / "hi.wav")
        render_stereo_audio(alpha, beta, out_lo, duration_s=1.0,
                            carrier_frequency=400.0)
        render_stereo_audio(alpha, beta, out_hi, duration_s=1.0,
                            carrier_frequency=1000.0)
        data_lo, _ = sf.read(out_lo)
        data_hi, _ = sf.read(out_hi)
        # Different carrier freq → different waveforms
        assert not np.array_equal(data_lo, data_hi)

    def test_progress_callback(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        calls = []
        render_stereo_audio(alpha, beta, out, duration_s=1.0,
                            on_progress=lambda done, total: calls.append((done, total)))
        assert len(calls) > 0
        assert calls[-1][0] >= 0.9  # Last call should be near end

    def test_constant_position_not_silent(self, tmp_path):
        """A constant alpha/beta should still produce a carrier signal."""
        from forge.audio_synthesis import render_stereo_audio
        alpha_path = str(tmp_path / "const.alpha.funscript")
        beta_path = str(tmp_path / "const.beta.funscript")
        _write_funscript(alpha_path, _make_constant_actions(pos=80))
        _write_funscript(beta_path, _make_constant_actions(pos=50))
        out = str(tmp_path / "output.wav")
        result = render_stereo_audio(alpha_path, beta_path, out, duration_s=1.0)
        assert result.peak_amplitude > 0.01


class TestRenderPulse:
    def test_renders_wav(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "pulse.wav")
        result = render_stereo_audio(alpha, beta, out, duration_s=2.0,
                                     waveform="pulse")
        assert os.path.isfile(out)
        assert result.waveform == "pulse"

    def test_output_is_stereo(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "pulse.wav")
        render_stereo_audio(alpha, beta, out, duration_s=1.0, waveform="pulse")
        info = sf.info(out)
        assert info.channels == 2

    def test_has_silence_between_pulses(self, funscript_pair, tmp_path):
        """Pulse mode should have periods of silence (the pauses)."""
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "pulse.wav")
        render_stereo_audio(alpha, beta, out, duration_s=1.0,
                            waveform="pulse", pulse_frequency=10.0)
        data, _ = sf.read(out)
        # With 10 Hz pulses, there should be silent regions
        # Check that some samples are near zero
        near_zero = np.sum(np.abs(data) < 0.001) / data.size
        assert near_zero > 0.1  # At least 10% silence

    def test_different_from_continuous(self, funscript_pair, tmp_path):
        import soundfile as sf
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out_c = str(tmp_path / "cont.wav")
        out_p = str(tmp_path / "pulse.wav")
        render_stereo_audio(alpha, beta, out_c, duration_s=1.0,
                            waveform="continuous")
        render_stereo_audio(alpha, beta, out_p, duration_s=1.0,
                            waveform="pulse")
        data_c, _ = sf.read(out_c)
        data_p, _ = sf.read(out_p)
        assert not np.array_equal(data_c, data_p)


class TestRenderEdgeCases:
    def test_unknown_waveform_raises(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        with pytest.raises(ValueError, match="Unknown waveform"):
            render_stereo_audio(alpha, beta, out, duration_s=1.0,
                                waveform="invalid")

    def test_very_short_duration(self, funscript_pair, tmp_path):
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "short.wav")
        result = render_stereo_audio(alpha, beta, out, duration_s=0.1)
        assert result.file_size_bytes > 0

    def test_carrier_frequency_clamped(self, funscript_pair, tmp_path):
        """Carrier below MIN or above MAX should be clamped, not error."""
        from forge.audio_synthesis import render_stereo_audio
        alpha, beta = funscript_pair
        out = str(tmp_path / "output.wav")
        # Should not raise
        render_stereo_audio(alpha, beta, out, duration_s=0.5,
                            carrier_frequency=50.0)  # Below MIN
        render_stereo_audio(alpha, beta, out, duration_s=0.5,
                            carrier_frequency=5000.0)  # Above MAX
