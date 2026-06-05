"""Tests for the Channels default arc (forge/channels_defaults.py).

The position-derived character + mechanical arc used when the user skips the
Channels tab. Pure logic — no engine needed.
"""

import unittest

from forge.channels_defaults import default_character_for, default_mech_for


class TestCharacterArc(unittest.TestCase):

    def test_single_chapter_is_opener(self):
        self.assertEqual(default_character_for(0, 1), "scene_builder")

    def test_two_chapters_open_then_close(self):
        self.assertEqual(default_character_for(0, 2), "scene_builder")
        self.assertEqual(default_character_for(1, 2), "scene_closer")

    def test_three_chapters_open_peak_close(self):
        self.assertEqual(default_character_for(0, 3), "scene_builder")
        self.assertEqual(default_character_for(1, 3), "reactive")
        self.assertEqual(default_character_for(2, 3), "scene_closer")

    def test_full_arc_shape(self):
        n = 6
        arc = [default_character_for(i, n) for i in range(n)]
        self.assertEqual(arc[0], "scene_builder")          # open
        self.assertEqual(arc[-1], "scene_closer")          # close
        self.assertEqual(arc[-2], "reactive")              # peak (2nd-to-last)
        # middle alternates balanced <-> unpredictable
        self.assertEqual(arc[1], "balanced")
        self.assertEqual(arc[2], "unpredictable")
        self.assertEqual(arc[3], "balanced")

    def test_long_scene_only_one_opener_and_closer(self):
        n = 17
        arc = [default_character_for(i, n) for i in range(n)]
        self.assertEqual(arc.count("scene_builder"), 1)
        self.assertEqual(arc.count("scene_closer"), 1)
        self.assertEqual(arc[0], "scene_builder")
        self.assertEqual(arc[-1], "scene_closer")
        self.assertEqual(arc[-2], "reactive")


class TestMechanicalArc(unittest.TestCase):

    def test_opener_and_closer_are_cowgirl(self):
        self.assertEqual(default_mech_for(0, 5), "Cowgirl")
        self.assertEqual(default_mech_for(4, 5), "Cowgirl")

    def test_peak_is_riding(self):
        self.assertEqual(default_mech_for(3, 5), "Riding")  # 2nd-to-last

    def test_middle_alternates(self):
        n = 6
        self.assertEqual(default_mech_for(1, n), "Missionary")
        self.assertEqual(default_mech_for(2, n), "Doggy")
        self.assertEqual(default_mech_for(3, n), "Missionary")

    def test_two_chapters(self):
        self.assertEqual(default_mech_for(0, 2), "Cowgirl")
        self.assertEqual(default_mech_for(1, 2), "Cowgirl")

    def test_never_none(self):
        # Every position yields a real motion style (default arc is always motion).
        for n in (1, 2, 3, 5, 12):
            for i in range(n):
                self.assertIn(default_mech_for(i, n),
                              {"Cowgirl", "Missionary", "Doggy", "Riding"})


if __name__ == "__main__":
    unittest.main()
