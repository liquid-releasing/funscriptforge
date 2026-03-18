# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for forge/metadata.py — derive_metadata and helpers."""

import unittest

from forge.metadata import (
    derive_metadata,
    format_metadata_table,
    _derive_pace,
    _derive_intensity,
    _derive_depth,
    _derive_duration,
    _derive_mood_variety,
    _derive_arc,
    _suggest_tone,
    _build_tags,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _phrase(bpm=60.0, tags=None):
    return {"bpm": bpm, "tags": tags or []}


def _stats(**kwargs):
    defaults = {
        "avg_speed":  40.0,
        "min_pos":    0,
        "max_pos":    100,
        "duration_s": 600,
    }
    defaults.update(kwargs)
    return defaults


# ── Pace tests ────────────────────────────────────────────────────────────────

class TestDerivePace(unittest.TestCase):
    def test_empty_phrases_returns_unknown(self):
        self.assertEqual(_derive_pace([]), "Unknown")

    def test_slow(self):
        self.assertEqual(_derive_pace([_phrase(30)]), "Slow")

    def test_medium(self):
        self.assertEqual(_derive_pace([_phrase(60)]), "Medium")

    def test_fast(self):
        self.assertEqual(_derive_pace([_phrase(100)]), "Fast")

    def test_intense(self):
        self.assertEqual(_derive_pace([_phrase(150)]), "Intense")

    def test_average_of_multiple_phrases(self):
        # avg = 50 → Medium
        phrases = [_phrase(20), _phrase(80)]
        self.assertEqual(_derive_pace(phrases), "Medium")

    def test_phrase_without_bpm_ignored(self):
        phrases = [{"tags": []}, _phrase(150)]
        self.assertEqual(_derive_pace(phrases), "Intense")


# ── Intensity tests ───────────────────────────────────────────────────────────

class TestDeriveIntensity(unittest.TestCase):
    def test_low(self):
        self.assertEqual(_derive_intensity(_stats(avg_speed=10)), "Low")

    def test_medium(self):
        self.assertEqual(_derive_intensity(_stats(avg_speed=35)), "Medium")

    def test_high(self):
        self.assertEqual(_derive_intensity(_stats(avg_speed=65)), "High")

    def test_extreme(self):
        self.assertEqual(_derive_intensity(_stats(avg_speed=90)), "Extreme")

    def test_missing_avg_speed_defaults_low(self):
        self.assertEqual(_derive_intensity({}), "Low")


# ── Depth tests ───────────────────────────────────────────────────────────────

class TestDeriveDepth(unittest.TestCase):
    def test_shallow(self):
        self.assertEqual(_derive_depth(_stats(min_pos=40, max_pos=60)), "Shallow")

    def test_mid(self):
        self.assertEqual(_derive_depth(_stats(min_pos=20, max_pos=70)), "Mid")

    def test_deep(self):
        self.assertEqual(_derive_depth(_stats(min_pos=10, max_pos=90)), "Deep")

    def test_full(self):
        self.assertEqual(_derive_depth(_stats(min_pos=0, max_pos=100)), "Full")

    def test_string_positions_parsed(self):
        # Some funscript stats return "0%" / "100%"
        stats = {"min_pos": "0%", "max_pos": "100%"}
        self.assertEqual(_derive_depth(stats), "Full")

    def test_invalid_positions_returns_unknown(self):
        stats = {"min_pos": "N/A", "max_pos": "N/A"}
        self.assertEqual(_derive_depth(stats), "Unknown")


# ── Duration tests ────────────────────────────────────────────────────────────

class TestDeriveDuration(unittest.TestCase):
    def test_short(self):
        self.assertEqual(_derive_duration(_stats(duration_s=60)), "Short")

    def test_medium(self):
        self.assertEqual(_derive_duration(_stats(duration_s=600)), "Medium")

    def test_long(self):
        self.assertEqual(_derive_duration(_stats(duration_s=1200)), "Long")

    def test_feature(self):
        self.assertEqual(_derive_duration(_stats(duration_s=3600)), "Feature")


# ── Mood / variety tests ──────────────────────────────────────────────────────

class TestDeriveMoodVariety(unittest.TestCase):
    def test_no_phrases_returns_unknown_focused(self):
        mood, variety = _derive_mood_variety([])
        self.assertEqual(mood, "Unknown")
        self.assertEqual(variety, "Focused")

    def test_single_tone_is_focused(self):
        phrases = [_phrase(tags=["frantic"]), _phrase(tags=["frantic"])]
        mood, variety = _derive_mood_variety(phrases)
        self.assertEqual(mood, "Dominant")
        self.assertEqual(variety, "Focused")

    def test_two_tones_is_varied(self):
        phrases = [_phrase(tags=["frantic"]), _phrase(tags=["giggle"])]
        mood, variety = _derive_mood_variety(phrases)
        self.assertEqual(variety, "Varied")

    def test_four_tones_is_complex(self):
        phrases = [
            _phrase(tags=["frantic"]),
            _phrase(tags=["giggle"]),
            _phrase(tags=["plateau"]),
            _phrase(tags=["lazy"]),
        ]
        _, variety = _derive_mood_variety(phrases)
        self.assertEqual(variety, "Complex")

    def test_unmapped_tags_ignored(self):
        phrases = [_phrase(tags=["unknown_tag"])]
        mood, _ = _derive_mood_variety(phrases)
        self.assertEqual(mood, "Unknown")

    def test_dominant_is_most_common(self):
        phrases = [
            _phrase(tags=["giggle"]),
            _phrase(tags=["giggle"]),
            _phrase(tags=["frantic"]),
        ]
        mood, _ = _derive_mood_variety(phrases)
        self.assertEqual(mood, "Tease")


# ── Arc tests ────────────────────────────────────────────────────────────────

class TestDeriveArc(unittest.TestCase):
    def test_empty_returns_unknown(self):
        self.assertEqual(_derive_arc([]), "Unknown")

    def test_fewer_than_3_phrases_returns_short(self):
        self.assertEqual(_derive_arc([_phrase(60), _phrase(80)]), "Short")

    def test_climactic(self):
        # Last third >> first third
        phrases = [_phrase(30)] * 3 + [_phrase(30)] * 3 + [_phrase(90)] * 3
        self.assertEqual(_derive_arc(phrases), "Climactic")

    def test_building(self):
        # Gradual increase, last > first * 1.2 but no single peak
        phrases = [_phrase(40)] * 3 + [_phrase(50)] * 3 + [_phrase(55)] * 3
        self.assertEqual(_derive_arc(phrases), "Building")

    def test_flat(self):
        phrases = [_phrase(60)] * 9
        self.assertEqual(_derive_arc(phrases), "Flat")


# ── Tone suggestion tests ────────────────────────────────────────────────────

class TestSuggestTone(unittest.TestCase):
    def test_climactic_arc_gives_climax(self):
        tone, rationale = _suggest_tone("Unknown", "Medium", "Climactic", "Medium")
        self.assertEqual(tone, "Climax")
        self.assertIn("climactic", rationale.lower())

    def test_building_arc_gives_build(self):
        tone, _ = _suggest_tone("Unknown", "Medium", "Building", "Medium")
        self.assertEqual(tone, "Build")

    def test_dominant_mood_used_when_no_arc(self):
        tone, _ = _suggest_tone("Tease", "Low", "Flat", "Slow")
        self.assertEqual(tone, "Tease")

    def test_high_intensity_fallback_gives_dominant(self):
        tone, _ = _suggest_tone("Unknown", "High", "Flat", "Fast")
        self.assertEqual(tone, "Dominant")

    def test_low_intensity_slow_gives_tender(self):
        tone, _ = _suggest_tone("Unknown", "Low", "Flat", "Slow")
        self.assertEqual(tone, "Tender")

    def test_rationale_starts_with_suggested_based_on(self):
        _, rationale = _suggest_tone("Unknown", "Medium", "Flat", "Medium")
        self.assertTrue(rationale.startswith("Suggested based on:"))


# ── Tag building tests ───────────────────────────────────────────────────────

class TestBuildTags(unittest.TestCase):
    def test_tags_include_all_dimensions(self):
        tags = _build_tags("Fast", "High", "Deep", "Medium", "Dominant", "Building", "Varied")
        dims = {t.split(":")[0] for t in tags}
        for d in ("pace", "intensity", "depth", "duration", "arc", "variety"):
            self.assertIn(d, dims)

    def test_mood_tag_added_when_known(self):
        tags = _build_tags("Fast", "High", "Deep", "Medium", "Dominant", "Building", "Varied")
        self.assertIn("mood:dominant", tags)

    def test_mood_tag_omitted_when_unknown(self):
        tags = _build_tags("Fast", "High", "Deep", "Medium", "Unknown", "Flat", "Focused")
        mood_tags = [t for t in tags if t.startswith("mood:")]
        self.assertEqual(mood_tags, [])

    def test_all_tags_lowercase(self):
        tags = _build_tags("Fast", "High", "Deep", "Medium", "Dominant", "Building", "Varied")
        for t in tags:
            self.assertEqual(t, t.lower())


# ── Integration: derive_metadata ────────────────────────────────────────────

class TestDeriveMetadata(unittest.TestCase):
    def _make_phrases(self):
        return [
            _phrase(bpm=100, tags=["frantic"]),
            _phrase(bpm=120, tags=["frantic"]),
            _phrase(bpm=80, tags=["giggle"]),
        ]

    def test_returns_all_keys(self):
        meta = derive_metadata(_stats(), self._make_phrases())
        expected = {
            "pace", "intensity", "depth", "duration_category",
            "dominant_mood", "arc_type", "variety",
            "auto_tags", "tone_suggestion", "tone_rationale",
        }
        self.assertEqual(set(meta.keys()), expected)

    def test_auto_tags_is_list(self):
        meta = derive_metadata(_stats(), self._make_phrases())
        self.assertIsInstance(meta["auto_tags"], list)
        self.assertTrue(len(meta["auto_tags"]) > 0)

    def test_tone_suggestion_is_valid_label(self):
        meta = derive_metadata(_stats(), self._make_phrases())
        valid = {"Dominant", "Tease", "Edge", "Tender", "Build", "Climax"}
        self.assertIn(meta["tone_suggestion"], valid)

    def test_empty_phrases_does_not_crash(self):
        meta = derive_metadata(_stats(), [])
        self.assertIn("tone_suggestion", meta)

    def test_empty_stats_does_not_crash(self):
        meta = derive_metadata({}, self._make_phrases())
        self.assertIn("pace", meta)


# ── format_metadata_table ────────────────────────────────────────────────────

class TestFormatMetadataTable(unittest.TestCase):
    def setUp(self):
        self.meta = derive_metadata(_stats(), [_phrase(100, ["frantic"])])

    def test_returns_string(self):
        self.assertIsInstance(format_metadata_table(self.meta), str)

    def test_contains_key_labels(self):
        table = format_metadata_table(self.meta)
        for label in ("Pace", "Intensity", "Arc type", "Tone suggestion"):
            self.assertIn(label, table)

    def test_contains_auto_tags_header(self):
        table = format_metadata_table(self.meta)
        self.assertIn("Auto tags", table)


if __name__ == "__main__":
    unittest.main()
