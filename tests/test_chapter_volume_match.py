"""Tests for chapter-seam volume matching.

E-stim channels are generated one chapter at a time and concatenated, and
Edger's volume ramp is hard-coded rising from 0 — so every chapter restarts near
silence and each boundary is an audible drop. `match_chapter_volumes` lifts the
incoming chapter to the outgoing one's ending level and eases back to its own
curve, without changing how any chapter is generated.

Pure logic, no funscript-tools engine needed.
"""

import unittest

from forge.stim_config import (
    DEFAULT_SEAM_DECAY_MS,
    SHAPED_CHARACTERS,
    match_chapter_volumes,
)


def _ramp(lo, hi, start, end, step=1000):
    """A linear ramp from `start` to `end` across [lo, hi] — stands in for one
    chapter's generated volume channel."""
    span = max(1, hi - lo)
    return [{"at": t, "pos": int(round(start + (end - start) * (t - lo) / span))}
            for t in range(lo, hi + 1, step)]


class TestSeamMatching(unittest.TestCase):

    def setUp(self):
        # Two chapters, each ramping 0 -> 80: a 80-point drop at the seam.
        self.windows = [(0, 60_000, "balanced"), (60_000, 120_000, "balanced")]
        self.acts = _ramp(0, 59_000, 0, 78) + _ramp(60_000, 120_000, 0, 80)

    def _at(self, out, t):
        return next(a["pos"] for a in out if a["at"] == t)

    def test_the_step_at_the_seam_is_removed(self):
        out = match_chapter_volumes("volume", self.acts, self.windows)
        before = self._at(out, 59_000)
        after = self._at(out, 60_000)
        # Was an ~78-point cliff; now the incoming chapter starts where the
        # previous one ended.
        self.assertLessEqual(abs(after - before), 2)

    def test_chapter_body_is_untouched(self):
        out = match_chapter_volumes("volume", self.acts, self.windows)
        # Well past the decay window, the second chapter keeps its own curve.
        t = 60_000 + DEFAULT_SEAM_DECAY_MS + 20_000
        self.assertEqual(self._at(out, t), self._at(self.acts, t))

    def test_lift_decays_monotonically_back_to_the_natural_curve(self):
        out = match_chapter_volumes("volume", self.acts, self.windows)
        # The applied correction shrinks with time and never goes negative.
        prev_lift = None
        for t in range(60_000, 60_000 + DEFAULT_SEAM_DECAY_MS + 1, 1000):
            lift = self._at(out, t) - self._at(self.acts, t)
            self.assertGreaterEqual(lift, -1)
            if prev_lift is not None:
                self.assertLessEqual(lift, prev_lift + 1)
            prev_lift = lift

    def test_first_chapter_is_never_lifted(self):
        out = match_chapter_volumes("volume", self.acts, self.windows)
        self.assertEqual(self._at(out, 0), self._at(self.acts, 0))

    def test_positions_stay_in_range(self):
        # A big lift near the ceiling must clamp rather than overshoot.
        windows = [(0, 60_000, "balanced"), (60_000, 120_000, "balanced")]
        acts = _ramp(0, 59_000, 0, 100) + _ramp(60_000, 120_000, 90, 100)
        out = match_chapter_volumes("volume", acts, windows)
        for a in out:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


class TestShapedCharactersAreExempt(unittest.TestCase):

    def _two(self, second_cid):
        windows = [(0, 60_000, "balanced"), (60_000, 120_000, second_cid)]
        acts = _ramp(0, 59_000, 0, 78) + _ramp(60_000, 120_000, 0, 80)
        return windows, acts

    def test_scene_builder_chapter_is_left_alone(self):
        # Builder is meant to open from nothing — lifting its head would erase
        # the build.
        windows, acts = self._two("scene_builder")
        self.assertEqual(match_chapter_volumes("volume", acts, windows), acts)

    def test_scene_closer_chapter_is_left_alone(self):
        windows, acts = self._two("scene_closer")
        self.assertEqual(match_chapter_volumes("volume", acts, windows), acts)

    def test_label_form_is_also_exempt(self):
        windows, acts = self._two("Scene Builder")
        self.assertEqual(match_chapter_volumes("volume", acts, windows), acts)

    def test_a_normal_chapter_after_a_closer_still_lifts(self):
        # Only the chapter being MODIFIED is exempt. A normal chapter following
        # a Closer lifts toward the Closer's ending level — that continuity is
        # the whole point of the arc.
        windows = [(0, 60_000, "scene_closer"), (60_000, 120_000, "balanced")]
        acts = _ramp(0, 59_000, 80, 20) + _ramp(60_000, 120_000, 0, 80)
        out = match_chapter_volumes("volume", acts, windows)
        self.assertGreater(
            next(a["pos"] for a in out if a["at"] == 60_000),
            next(a["pos"] for a in acts if a["at"] == 60_000),
        )

    def test_shaped_set_is_exactly_the_two_arc_characters(self):
        self.assertEqual(SHAPED_CHARACTERS, {"scene_builder", "scene_closer"})


class TestGuards(unittest.TestCase):

    def test_non_volume_channels_pass_through(self):
        windows = [(0, 60_000, "balanced"), (60_000, 120_000, "balanced")]
        acts = _ramp(0, 120_000, 0, 80)
        for ch in ("alpha", "beta", "frequency", "pulse_frequency"):
            self.assertEqual(match_chapter_volumes(ch, acts, windows), acts)

    def test_volume_prostate_is_matched_too(self):
        windows = [(0, 60_000, "balanced"), (60_000, 120_000, "balanced")]
        acts = _ramp(0, 59_000, 0, 78) + _ramp(60_000, 120_000, 0, 80)
        out = match_chapter_volumes("volume-prostate", acts, windows)
        self.assertNotEqual(out, acts)

    def test_single_chapter_is_a_no_op(self):
        acts = _ramp(0, 60_000, 0, 80)
        self.assertEqual(match_chapter_volumes("volume", acts, [(0, 60_000, "balanced")]), acts)

    def test_empty_actions(self):
        self.assertEqual(match_chapter_volumes("volume", [], [(0, 1), (1, 2)]), [])

    def test_short_chapter_recovers_within_half_its_length(self):
        # A fixed 12s ramp on a 10s chapter would shift nearly all of it, so the
        # decay is capped at half the chapter.
        windows = [(0, 60_000, "balanced"), (60_000, 70_000, "balanced")]
        acts = _ramp(0, 59_000, 0, 78) + _ramp(60_000, 70_000, 0, 20, step=500)
        out = match_chapter_volumes("volume", acts, windows)
        # By the chapter's midpoint the lift is spent.
        self.assertEqual(
            next(a["pos"] for a in out if a["at"] == 65_500),
            next(a["pos"] for a in acts if a["at"] == 65_500),
        )

    def test_windows_with_missing_bounds_are_skipped(self):
        windows = [(0, 60_000, "balanced"), (None, None, "balanced")]
        acts = _ramp(0, 120_000, 0, 80)
        self.assertEqual(match_chapter_volumes("volume", acts, windows), acts)


if __name__ == "__main__":
    unittest.main()
