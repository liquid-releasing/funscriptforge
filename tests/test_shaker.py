# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Bass-shaker rendering tests — motion intensity becoming sub-bass rumble.

The shaker is the only Polish station with no position: it renders how hard
the scene is moving, not where the toy is. These lock the two properties that
make that read as part of the same performance rather than a second track —
the envelope follows SPEED (so stillness goes quiet and bursts hit hard), and
the audio stays inside the band a transducer can actually deliver.
"""

import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from forge.shaker import (
    BAND_HZ,
    DEFAULT_CARRIER_HZ,
    envelope_from_actions,
    render_lfe_audio,
)


def ramp(start_ms, end_ms, step_ms, lo=0, hi=100):
    """Alternating full-depth strokes every ``step_ms`` — speed set by step."""
    out, t, up = [], start_ms, True
    while t <= end_ms:
        out.append({"at": t, "pos": hi if up else lo})
        up = not up
        t += step_ms
    return out


class TestEnvelopeTracksSpeed(unittest.TestCase):

    def test_faster_motion_yields_stronger_rumble(self):
        """The whole design: same positions, different speed, different feel."""
        slow = envelope_from_actions(ramp(0, 4000, 800), smoothing=0.0)
        fast = envelope_from_actions(ramp(0, 4000, 100), smoothing=0.0)
        self.assertGreater(
            max(s["pos"] for s in fast), max(s["pos"] for s in slow),
            "a faster stroke at identical depth must rumble harder",
        )

    def test_stillness_is_quiet(self):
        still = [{"at": 0, "pos": 50}, {"at": 5000, "pos": 51}]
        env = envelope_from_actions(still, smoothing=0.0)
        self.assertTrue(env)
        self.assertLessEqual(max(s["pos"] for s in env), 2)

    def test_a_burst_between_still_sections_stands_out(self):
        acts = [
            {"at": 0, "pos": 50}, {"at": 2000, "pos": 52},      # still
            {"at": 2100, "pos": 5}, {"at": 2200, "pos": 95},    # burst
            {"at": 2300, "pos": 5},
            {"at": 5000, "pos": 6},                             # still again
        ]
        env = envelope_from_actions(acts, smoothing=0.0, sample_ms=50)
        before = max(s["pos"] for s in env if s["at"] < 2000)
        during = max(s["pos"] for s in env if 2100 <= s["at"] <= 2300)
        after = max(s["pos"] for s in env if s["at"] > 3000)
        self.assertGreater(during, before + 20)
        self.assertGreater(during, after + 20)

    def test_output_stays_in_range(self):
        """Even absurd speed can't push a transducer past full scale."""
        env = envelope_from_actions(ramp(0, 2000, 10), smoothing=0.0)
        self.assertTrue(all(0 <= s["pos"] <= 100 for s in env))

    def test_smoothing_reduces_jitter(self):
        acts = ramp(0, 4000, 100) + ramp(4100, 8000, 900)
        rough = envelope_from_actions(acts, smoothing=0.0)
        smooth = envelope_from_actions(acts, smoothing=0.9)

        def jitter(e):
            return sum(abs(b["pos"] - a["pos"]) for a, b in zip(e, e[1:]))

        self.assertLess(jitter(smooth), jitter(rough))

    def test_uniform_grid(self):
        env = envelope_from_actions(ramp(0, 3000, 250), sample_ms=50)
        gaps = {b["at"] - a["at"] for a, b in zip(env, env[1:])}
        self.assertEqual(gaps, {50})

    def test_degenerate_inputs_return_empty(self):
        """No motion means no envelope — callers must not stamp a silent file."""
        self.assertEqual(envelope_from_actions([]), [])
        self.assertEqual(envelope_from_actions([{"at": 0, "pos": 50}]), [])
        self.assertEqual(
            envelope_from_actions([{"at": 5, "pos": 1}, {"at": 5, "pos": 9}]), [],
        )

    def test_unsorted_actions_are_handled(self):
        acts = [{"at": 400, "pos": 90}, {"at": 0, "pos": 10}, {"at": 200, "pos": 50}]
        env = envelope_from_actions(acts, sample_ms=50)
        self.assertTrue(env)
        self.assertEqual(env[0]["at"], 0)


class TestLfeAudio(unittest.TestCase):

    def setUp(self):
        try:
            import soundfile  # noqa: F401
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("soundfile/numpy not available")
        self._tmp = tempfile.TemporaryDirectory()
        self.out = os.path.join(self._tmp.name, "rumble.wav")

    def tearDown(self):
        self._tmp.cleanup()

    def _render(self, **kw):
        env = envelope_from_actions(ramp(0, 4000, 200))
        return render_lfe_audio(env, self.out, **kw), env

    def test_renders_a_readable_file(self):
        import soundfile as sf
        meta, _ = self._render()
        self.assertTrue(os.path.exists(self.out))
        info = sf.info(self.out)
        self.assertEqual(info.channels, 1, "a shaker feed is mono")
        self.assertGreater(meta["duration_s"], 3.0)

    def test_energy_sits_in_the_tactile_band(self):
        """Above ~80 Hz a shaker stops being felt and starts being heard."""
        import numpy as np
        import soundfile as sf
        self._render(carrier_hz=DEFAULT_CARRIER_HZ)
        y, sr = sf.read(self.out)
        spec = np.abs(np.fft.rfft(y * np.hanning(len(y))))
        freqs = np.fft.rfftfreq(len(y), 1.0 / sr)
        in_band = spec[(freqs >= BAND_HZ[0]) & (freqs <= BAND_HZ[1])].sum()
        self.assertGreater(in_band / spec.sum(), 0.9)
        self.assertAlmostEqual(freqs[int(np.argmax(spec))], DEFAULT_CARRIER_HZ, delta=3)

    def test_carrier_is_clamped_into_the_band(self):
        """A knob can't drive the tone somewhere the hardware can't reproduce."""
        meta, _ = self._render(carrier_hz=5000)
        self.assertLessEqual(meta["carrier_hz"], BAND_HZ[1])
        meta, _ = self._render(carrier_hz=1)
        self.assertGreaterEqual(meta["carrier_hz"], BAND_HZ[0])

    def test_gain_scales_the_output(self):
        loud, _ = self._render(gain=1.0)
        quiet, _ = self._render(gain=0.25)
        self.assertGreater(loud["peak_amplitude"], quiet["peak_amplitude"])

    def test_empty_envelope_raises_rather_than_writing_silence(self):
        """A silent file would masquerade as a working stamp."""
        with self.assertRaises(ValueError):
            render_lfe_audio([], self.out)

    def test_amplitude_follows_the_envelope(self):
        """Quiet passages must actually be quieter in the rendered audio."""
        import numpy as np
        import soundfile as sf
        acts = [
            {"at": 0, "pos": 50}, {"at": 2000, "pos": 51},     # still
            {"at": 2100, "pos": 0}, {"at": 2200, "pos": 100},  # burst
            {"at": 2300, "pos": 0}, {"at": 2400, "pos": 100},
            {"at": 4000, "pos": 99},                           # still
        ]
        env = envelope_from_actions(acts, smoothing=0.2)
        render_lfe_audio(env, self.out, gain=1.0)
        y, sr = sf.read(self.out)
        early = np.abs(y[: int(1.5 * sr)]).max()
        burst = np.abs(y[int(2.1 * sr): int(2.5 * sr)]).max()
        self.assertGreater(burst, early * 2)


if __name__ == "__main__":
    unittest.main()
