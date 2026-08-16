"""Tests for chapter-seam volume matching.

E-stim channels are generated one chapter at a time and concatenated, and each
generated chapter fades in at its start and back out at its end — so every
INTERNAL boundary is a V-notch: the level dives to the floor and climbs straight
back. `match_chapter_volumes` holds the plateau across those seams.

The shape here is taken from a real 34-minute export (Bruna Butterfly,
2026-08-16): a plateau of 97 with 1-2s dips to 6 at all six internal seams. An
earlier version of this pass read the outgoing chapter's LAST sample as the
level to match — that sample is the bottom of the notch, so it was a no-op.
`test_the_measured_export_shape_is_repaired` is the regression for that.

Pure logic, no funscript-tools engine needed.
"""

import unittest

from forge.stim_config import (
    SHAPED_CHARACTERS,
    match_chapter_volumes,
)


def _chapter(lo, hi, plateau=97, floor=6, fade_ms=2500, step=500):
    """One generated chapter: fades up from `floor`, holds `plateau`, fades back
    down — the shape the Edger pipeline actually produces per window."""
    acts = []
    for t in range(lo, hi + 1, step):
        into, left = t - lo, hi - t
        edge = min(into, left)
        if edge >= fade_ms:
            pos = plateau
        else:
            pos = floor + (plateau - floor) * (edge / fade_ms)
        acts.append({"at": t, "pos": int(round(pos))})
    return acts


def _two_chapters(cid_a="balanced", cid_b="balanced", seam=300_000, end=600_000):
    windows = [(0, seam, cid_a), (seam, end, cid_b)]
    acts = _chapter(0, seam - 500) + _chapter(seam, end)
    return windows, acts


class TestSeamRepair(unittest.TestCase):

    def _min_between(self, acts, lo, hi):
        return min(a["pos"] for a in acts if lo <= a["at"] <= hi)

    def test_the_notch_at_an_internal_seam_is_filled(self):
        windows, acts = _two_chapters()
        self.assertLess(self._min_between(acts, 295_000, 305_000), 20)  # notch exists
        out = match_chapter_volumes("volume", acts, windows)
        self.assertGreater(self._min_between(out, 295_000, 305_000), 85)

    def test_the_measured_export_shape_is_repaired(self):
        # Regression for the no-op version: six internal seams, plateau 97,
        # dips to 6 — the shape measured in the real export.
        seams = [344_000, 734_700, 1_125_200, 1_515_800, 1_773_500]
        bounds = [0] + seams + [2_031_800]
        windows = [(bounds[i], bounds[i + 1], "balanced") for i in range(len(bounds) - 1)]
        acts = []
        for lo, hi, _ in windows:
            acts += _chapter(lo, hi - 500)
        out = match_chapter_volumes("volume", acts, windows)
        for s in seams:
            self.assertGreater(
                self._min_between(out, s - 5_000, s + 5_000), 85,
                f"seam at {s/1000:.1f}s still notched",
            )

    def test_the_track_still_opens_and_closes(self):
        # Only INTERNAL seams are repaired — the fade at the very start and the
        # very end of the track is the scene opening and closing.
        windows, acts = _two_chapters()
        out = match_chapter_volumes("volume", acts, windows)
        self.assertLess(out[0]["pos"], 20)
        self.assertLess(out[-1]["pos"], 20)

    def test_values_are_never_lowered(self):
        windows, acts = _two_chapters()
        out = match_chapter_volumes("volume", acts, windows)
        for before, after in zip(acts, out):
            self.assertGreaterEqual(after["pos"], before["pos"])

    def test_chapter_bodies_are_untouched(self):
        windows, acts = _two_chapters()
        out = match_chapter_volumes("volume", acts, windows)
        mid = {a["at"]: a["pos"] for a in out}
        for a in acts:
            if 100_000 <= a["at"] <= 200_000:
                self.assertEqual(mid[a["at"]], a["pos"])

    def test_positions_stay_in_range(self):
        windows, acts = _two_chapters(plateau_check := "balanced")
        out = match_chapter_volumes("volume", acts, windows)
        for a in out:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


class TestShapedCharacters(unittest.TestCase):

    def _side_min(self, acts, lo, hi):
        return min(a["pos"] for a in acts if lo <= a["at"] <= hi)

    def test_a_builder_keeps_its_opening(self):
        # Incoming chapter is a Builder: its rise from silence is the intent.
        windows, acts = _two_chapters(cid_b="scene_builder")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertLess(self._side_min(out, 300_000, 302_000), 30)

    def test_a_closer_keeps_its_wind_down(self):
        # Outgoing chapter is a Closer: its fall is the intent.
        windows, acts = _two_chapters(cid_a="scene_closer")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertLess(self._side_min(out, 297_000, 299_500), 30)

    def test_the_normal_side_of_a_shaped_seam_is_still_repaired(self):
        # Closer → normal: the Closer's fall stays, but the incoming chapter
        # should not also climb from the floor.
        windows, acts = _two_chapters(cid_a="scene_closer")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertGreater(self._side_min(out, 300_500, 305_000), 60)

    def test_a_builder_does_not_protect_its_ENDING(self):
        # A Builder's intent is that it opens from nothing. The fade-out at its
        # end is just the per-window artifact, so the seam AFTER a Builder must
        # still be repaired. Regression for the 2026-08-16 dogfood, where a
        # mid-track Builder left the seam behind it sitting at the floor while
        # every unshaped seam was repaired.
        windows, acts = _two_chapters(cid_a="scene_builder")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertGreater(self._side_min(out, 295_000, 305_000), 85)

    def test_a_closer_does_not_protect_its_OPENING(self):
        # Mirror: a Closer winds down at its end; its start carries no intent.
        windows, acts = _two_chapters(cid_b="scene_closer")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertGreater(self._side_min(out, 295_000, 305_000), 85)

    def test_label_form_is_recognised(self):
        windows, acts = _two_chapters(cid_b="Scene Builder")
        out = match_chapter_volumes("volume", acts, windows)
        self.assertLess(self._side_min(out, 300_000, 302_000), 30)

    def test_shaped_set_is_exactly_the_two_arc_characters(self):
        self.assertEqual(SHAPED_CHARACTERS, {"scene_builder", "scene_closer"})


class TestGuards(unittest.TestCase):

    def test_non_volume_channels_pass_through(self):
        windows, acts = _two_chapters()
        for ch in ("alpha", "beta", "frequency", "pulse_frequency"):
            self.assertEqual(match_chapter_volumes(ch, acts, windows), acts)

    def test_volume_prostate_is_repaired_too(self):
        windows, acts = _two_chapters()
        self.assertNotEqual(match_chapter_volumes("volume-prostate", acts, windows), acts)

    def test_single_chapter_is_a_no_op(self):
        acts = _chapter(0, 300_000)
        self.assertEqual(match_chapter_volumes("volume", acts, [(0, 300_000, "balanced")]), acts)

    def test_empty_actions(self):
        self.assertEqual(match_chapter_volumes("volume", [], [(0, 1), (1, 2)]), [])

    def test_windows_with_missing_bounds_are_skipped(self):
        windows = [(0, 300_000, "balanced"), (None, None, "balanced")]
        _, acts = _two_chapters()
        self.assertEqual(match_chapter_volumes("volume", acts, windows), acts)

    def test_short_chapter_is_not_mostly_rewritten(self):
        # The window reaches at most a third into either neighbour.
        windows = [(0, 300_000, "balanced"), (300_000, 312_000, "balanced")]
        acts = _chapter(0, 299_500) + _chapter(300_000, 312_000, fade_ms=1500)
        out = match_chapter_volumes("volume", acts, windows)
        changed = [a["at"] for a, b in zip(acts, out) if a["pos"] != b["pos"]]
        self.assertTrue(all(t <= 305_000 for t in changed), "reached too far into the short chapter")


if __name__ == "__main__":
    unittest.main()
