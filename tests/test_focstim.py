"""FOC-Stim four-phase position -> electrode mapping.

The transform is ported from restim (stim_math/transforms_4.py, MIT). These
tests pin the properties that make the output safe to send to hardware, not
just the arithmetic: everything in range, a resting centre, and no silent
saturation at the corners of the authoring square.
"""

import unittest

import numpy as np

from forge.focstim import (
    ELECTRODE_CHANNELS,
    abc_to_e1234,
    channels_from_alpha_beta,
    electrodes_from_alpha_beta,
)


class TestTransform(unittest.TestCase):
    def test_centre_is_at_rest(self):
        """Neutral position must drive nothing.

        50/50 is the authored centre; if it produced current the device would
        never be idle during a quiet passage.
        """
        e = electrodes_from_alpha_beta([50], [50])
        self.assertEqual([ch[0] for ch in e], [0, 0, 0, 0])

    def test_output_never_leaves_range(self):
        """Sweep the whole authoring square, not just the axes.

        The transform exceeds 1.0 for positions outside the unit circle (the
        corners reach 1.303), which is why the caller normalises first. Without
        that, the clamp would flatten a corner into full scale silently.
        """
        xs = np.repeat(np.arange(0, 101, 2), 51)
        ys = np.tile(np.arange(0, 101, 2), 51)
        e = np.array(electrodes_from_alpha_beta(xs, ys))
        self.assertGreaterEqual(int(e.min()), 0)
        self.assertLessEqual(int(e.max()), 100)

    def test_corners_are_not_saturated(self):
        """A corner is a real position, not full scale on every electrode."""
        e = [ch[0] for ch in electrodes_from_alpha_beta([100], [100])]
        self.assertLess(sum(1 for v in e if v == 100), 4)
        self.assertGreater(sum(e), 0)

    def test_one_electrode_always_at_rest(self):
        """Inherent to the four-phase drive — pin it so a change is visible."""
        rng = np.random.default_rng(11)
        xs = rng.integers(0, 101, 500)
        ys = rng.integers(0, 101, 500)
        e = np.array(electrodes_from_alpha_beta(xs, ys))
        self.assertTrue(np.all(e.min(axis=0) == 0))

    def test_magnitude_only_is_documented_behaviour(self):
        """Opposite positions map alike — the transform drops polarity.

        Not a bug (electrode power is unsigned) but surprising enough that it
        is worth failing loudly if it ever changes.
        """
        pos = [ch[0] for ch in electrodes_from_alpha_beta([100], [50])]
        neg = [ch[0] for ch in electrodes_from_alpha_beta([0], [50])]
        self.assertEqual(pos, neg)

    def test_matches_upstream_shape(self):
        """Golden values, so a refactor of the ported matrices is caught."""
        e = abc_to_e1234([1.0], [0.0], [0.0])
        np.testing.assert_allclose(e.ravel(), [1.0, 0.0, 0.0, 0.0], atol=1e-9)


class TestChannelAssembly(unittest.TestCase):
    def test_union_timeline_not_positional_zip(self):
        """alpha and beta need not share timestamps.

        Zipping them positionally would shear the position — pair the wrong
        alpha with the wrong beta — so both are sampled onto the union.
        """
        alpha = [{"at": 0, "pos": 50}, {"at": 100, "pos": 100}]
        beta = [{"at": 0, "pos": 50}, {"at": 50, "pos": 80}, {"at": 100, "pos": 50}]
        chans = channels_from_alpha_beta(alpha, beta)
        for ch in ELECTRODE_CHANNELS:
            self.assertEqual([a["at"] for a in chans[ch]], [0, 50, 100])

    def test_all_four_channels_present(self):
        chans = channels_from_alpha_beta(
            [{"at": 0, "pos": 10}], [{"at": 0, "pos": 90}],
        )
        self.assertEqual(set(chans), set(ELECTRODE_CHANNELS))

    def test_empty_input_is_not_a_crash(self):
        chans = channels_from_alpha_beta([], [])
        self.assertEqual(set(chans), set(ELECTRODE_CHANNELS))
        self.assertTrue(all(v == [] for v in chans.values()))

    def test_positions_are_ints_in_range(self):
        chans = channels_from_alpha_beta(
            [{"at": t, "pos": t % 101} for t in range(0, 500, 7)],
            [{"at": t, "pos": (t * 3) % 101} for t in range(0, 500, 5)],
        )
        for ch in ELECTRODE_CHANNELS:
            for a in chans[ch]:
                self.assertIsInstance(a["pos"], int)
                self.assertGreaterEqual(a["pos"], 0)
                self.assertLessEqual(a["pos"], 100)


if __name__ == "__main__":
    unittest.main()
