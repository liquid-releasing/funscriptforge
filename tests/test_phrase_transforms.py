# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for pattern_catalog/phrase_transforms.py.

Covers:
- TRANSFORM_CATALOG completeness and structure
- TRANSFORM_ORDER coverage, uniqueness, and consistency with catalog
- Each transform's apply() output
- suggest_transform() rule logic
- TransformParam dataclass fields
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pattern_catalog.phrase_transforms import (
    TRANSFORM_CATALOG,
    TRANSFORM_ORDER,
    PhraseTransform,
    TransformParam,
    suggest_transform,
    _find_extrema,
    _BUILTIN_KEYS,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _actions(positions):
    """Build a minimal action list from a list of positions (10 ms apart)."""
    return [{"at": i * 10, "pos": p} for i, p in enumerate(positions)]


def _timed_actions(positions, start_ms=0, step_ms=100):
    """Build an action list with configurable start time and step."""
    return [{"at": start_ms + i * step_ms, "pos": p} for i, p in enumerate(positions)]


_EXPECTED_KEYS = {
    "passthrough",
    "amplitude_scale",
    "normalize",
    "smooth",
    "clamp_upper",
    "clamp_lower",
    "invert",
    "boost_contrast",
    "shift",
    "recenter",
    "break",
    "waiting",
    "performance",
    "three_one",
    "blend_seams",
    "final_smooth",
    "beat_accent",
    "halve_tempo",
    # Timing / Sync
    "nudge",
    # Replacement transforms (moved from plugins/ to built-ins)
    "stroke",
    "drift",
    "tide",
    "funnel",
    # Tone transforms
    "tone_tender",
    "tone_build",
    "tone_tease",
    "tone_edge",
    "tone_climax",
    "tone_dominant",
}

_PHRASE_HIGH_BPM = {"bpm": 150.0, "pattern_label": "regular", "amplitude_span": 80}
_PHRASE_LOW_BPM  = {"bpm":  90.0, "pattern_label": "regular", "amplitude_span": 80}
_PHRASE_NARROW   = {"bpm": 150.0, "pattern_label": "regular", "amplitude_span": 30}
_PHRASE_TRANS    = {"bpm": 130.0, "pattern_label": "transition break",  "amplitude_span": 80}


# ---------------------------------------------------------------------------
# Catalog structure
# ---------------------------------------------------------------------------

class TestCatalogStructure(unittest.TestCase):

    def test_all_expected_keys_present(self):
        """Built-in catalog keys must exactly match _EXPECTED_KEYS.
        User-defined keys (recipes / plugins) are allowed to be present too."""
        self.assertEqual(_BUILTIN_KEYS, _EXPECTED_KEYS)

    def test_each_entry_is_phrase_transform(self):
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(key=key):
                self.assertIsInstance(spec, PhraseTransform)

    def test_keys_match_spec_key_attr(self):
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(key=key):
                self.assertEqual(spec.key, key)

    def test_each_spec_has_name_and_description(self):
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(key=key):
                self.assertIsInstance(spec.name, str)
                self.assertTrue(spec.name, "name should not be empty")
                self.assertIsInstance(spec.description, str)
                self.assertTrue(spec.description, "description should not be empty")

    def test_params_are_transform_param_instances(self):
        for key, spec in TRANSFORM_CATALOG.items():
            for pname, param in spec.params.items():
                with self.subTest(transform=key, param=pname):
                    self.assertIsInstance(param, TransformParam)
                    self.assertIn(param.type, ("float", "int", "bool"))

    def test_transform_order_covers_all_catalog_keys(self):
        """Every built-in key in TRANSFORM_CATALOG appears in TRANSFORM_ORDER.
        Tone transforms have their own category and are excluded.
        User-defined keys (recipes / plugins) are excluded from this check."""
        _tone_keys = {k for k in _BUILTIN_KEYS if k.startswith("tone_")}
        missing = _BUILTIN_KEYS - set(TRANSFORM_ORDER) - _tone_keys
        self.assertEqual(missing, set(), f"Built-in keys missing from TRANSFORM_ORDER: {missing}")

    def test_transform_order_has_no_unknown_keys(self):
        """TRANSFORM_ORDER contains only keys that exist in TRANSFORM_CATALOG."""
        unknown = set(TRANSFORM_ORDER) - set(TRANSFORM_CATALOG.keys())
        self.assertEqual(unknown, set(), f"Keys in TRANSFORM_ORDER but not in catalog: {unknown}")

    def test_transform_order_has_no_duplicates(self):
        self.assertEqual(len(TRANSFORM_ORDER), len(set(TRANSFORM_ORDER)),
                         "TRANSFORM_ORDER contains duplicate keys")


# ---------------------------------------------------------------------------
# Individual transform behaviour
# ---------------------------------------------------------------------------

class TestPassthrough(unittest.TestCase):

    def test_returns_unchanged_positions(self):
        actions = _actions([10, 50, 90, 20, 80])
        spec = TRANSFORM_CATALOG["passthrough"]
        result = spec.apply(actions)
        self.assertEqual([a["pos"] for a in result], [10, 50, 90, 20, 80])

    def test_does_not_mutate_input(self):
        actions = _actions([30, 70])
        original = [a["pos"] for a in actions]
        TRANSFORM_CATALOG["passthrough"].apply(actions)
        self.assertEqual([a["pos"] for a in actions], original)


class TestAmplitudeScale(unittest.TestCase):

    def test_scale_1_is_identity(self):
        actions = _actions([10, 50, 90])
        spec = TRANSFORM_CATALOG["amplitude_scale"]
        result = spec.apply(actions, {"scale": 1.0})
        self.assertEqual([a["pos"] for a in result], [10, 50, 90])

    def test_scale_2_doubles_distance_from_center(self):
        # pos=75 → centered=25 → scaled=50 → final=100
        actions = _actions([75])
        result = TRANSFORM_CATALOG["amplitude_scale"].apply(actions, {"scale": 2.0})
        self.assertEqual(result[0]["pos"], 100)

    def test_scale_0_collapses_to_center(self):
        actions = _actions([20, 50, 80])
        result = TRANSFORM_CATALOG["amplitude_scale"].apply(actions, {"scale": 0.0})
        for a in result:
            self.assertEqual(a["pos"], 50)

    def test_positions_clamped_0_to_100(self):
        actions = _actions([5, 95])
        result = TRANSFORM_CATALOG["amplitude_scale"].apply(actions, {"scale": 10.0})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


class TestNormalize(unittest.TestCase):

    def test_expands_to_full_range(self):
        actions = _actions([30, 40, 50, 60, 70])
        result = TRANSFORM_CATALOG["normalize"].apply(
            actions, {"target_lo": 0, "target_hi": 100}
        )
        positions = [a["pos"] for a in result]
        self.assertEqual(min(positions), 0)
        self.assertEqual(max(positions), 100)

    def test_flat_input_returns_unchanged(self):
        """All identical positions → no span → no change."""
        actions = _actions([50, 50, 50])
        result = TRANSFORM_CATALOG["normalize"].apply(
            actions, {"target_lo": 0, "target_hi": 100}
        )
        self.assertEqual([a["pos"] for a in result], [50, 50, 50])

    def test_custom_target_range(self):
        actions = _actions([0, 100])
        result = TRANSFORM_CATALOG["normalize"].apply(
            actions, {"target_lo": 20, "target_hi": 80}
        )
        positions = [a["pos"] for a in result]
        self.assertEqual(min(positions), 20)
        self.assertEqual(max(positions), 80)


class TestSmooth(unittest.TestCase):

    def test_returns_same_length(self):
        actions = _actions([10, 90, 10, 90, 10, 90])
        result = TRANSFORM_CATALOG["smooth"].apply(actions, {"strength": 0.15})
        self.assertEqual(len(result), len(actions))

    def test_positions_are_integers(self):
        actions = _actions([10, 90, 10, 90])
        result = TRANSFORM_CATALOG["smooth"].apply(actions, {"strength": 0.15})
        for a in result:
            self.assertIsInstance(a["pos"], int)

    def test_empty_actions(self):
        result = TRANSFORM_CATALOG["smooth"].apply([], {"strength": 0.15})
        self.assertEqual(result, [])


class TestClampRange(unittest.TestCase):

    def test_clamp_upper_keeps_in_range(self):
        actions = _actions([0, 50, 100])
        result = TRANSFORM_CATALOG["clamp_upper"].apply(
            actions, {"range_lo": 50, "range_hi": 100}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)
        # Lower bound of result should be at or above 50 (for pos=0 input: 50+0*50/100=50)
        self.assertGreaterEqual(result[0]["pos"], 50)

    def test_clamp_lower_keeps_in_range(self):
        actions = _actions([0, 50, 100])
        result = TRANSFORM_CATALOG["clamp_lower"].apply(
            actions, {"range_lo": 0, "range_hi": 50}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)
        # Upper bound: pos=100 → 0 + 100/100*50 = 50
        self.assertLessEqual(result[-1]["pos"], 50)


class TestInvert(unittest.TestCase):

    def test_flips_around_50(self):
        actions = _actions([0, 25, 50, 75, 100])
        result = TRANSFORM_CATALOG["invert"].apply(actions)
        self.assertEqual([a["pos"] for a in result], [100, 75, 50, 25, 0])

    def test_double_invert_is_identity(self):
        actions = _actions([10, 40, 70])
        once = TRANSFORM_CATALOG["invert"].apply(actions)
        twice = TRANSFORM_CATALOG["invert"].apply(once)
        self.assertEqual([a["pos"] for a in twice], [10, 40, 70])


class TestBoostContrast(unittest.TestCase):

    def test_midpoint_unchanged(self):
        actions = _actions([50])
        result = TRANSFORM_CATALOG["boost_contrast"].apply(actions, {"strength": 1.0})
        self.assertEqual(result[0]["pos"], 50)

    def test_high_position_pushed_higher(self):
        actions = _actions([80])
        result = TRANSFORM_CATALOG["boost_contrast"].apply(actions, {"strength": 0.5})
        self.assertGreater(result[0]["pos"], 80)

    def test_low_position_pushed_lower(self):
        actions = _actions([20])
        result = TRANSFORM_CATALOG["boost_contrast"].apply(actions, {"strength": 0.5})
        self.assertLess(result[0]["pos"], 20)

    def test_positions_clamped(self):
        actions = _actions([5, 95])
        result = TRANSFORM_CATALOG["boost_contrast"].apply(actions, {"strength": 2.0})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


# ---------------------------------------------------------------------------
# apply() contract
# ---------------------------------------------------------------------------

class TestApplyContract(unittest.TestCase):

    def test_apply_does_not_mutate_input(self):
        """Every transform must deep-copy before modifying."""
        actions = _actions([20, 50, 80])
        original_positions = [a["pos"] for a in actions]
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(transform=key):
                spec.apply(actions)
                self.assertEqual(
                    [a["pos"] for a in actions],
                    original_positions,
                    f"{key}.apply() mutated input",
                )

    def test_apply_empty_actions(self):
        """Every transform handles an empty list without error."""
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(transform=key):
                result = spec.apply([])
                self.assertIsInstance(result, list)
                self.assertEqual(result, [])

    def test_apply_param_defaults_used_when_param_values_empty(self):
        """apply({}) should not raise — defaults fill in missing keys.
        Structural transforms may return fewer actions so we skip the length check."""
        actions = _actions([10, 50, 90])
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(transform=key):
                result = spec.apply(actions, {})
                self.assertIsInstance(result, list)
                if not spec.structural:
                    self.assertEqual(len(result), len(actions))

    def test_apply_returns_list(self):
        actions = _actions([25, 75])
        for key, spec in TRANSFORM_CATALOG.items():
            with self.subTest(transform=key):
                result = spec.apply(actions)
                self.assertIsInstance(result, list)


# ---------------------------------------------------------------------------
# suggest_transform()
# ---------------------------------------------------------------------------

class TestSuggestTransform(unittest.TestCase):

    def test_transition_phrase_suggests_smooth(self):
        key, params = suggest_transform(_PHRASE_TRANS, 120.0)
        self.assertEqual(key, "smooth")

    def test_low_bpm_suggests_passthrough(self):
        key, params = suggest_transform(_PHRASE_LOW_BPM, 120.0)
        self.assertEqual(key, "passthrough")

    def test_high_bpm_wide_amp_suggests_amplitude_scale(self):
        key, params = suggest_transform(_PHRASE_HIGH_BPM, 120.0)
        self.assertEqual(key, "amplitude_scale")

    def test_high_bpm_narrow_amp_suggests_normalize(self):
        key, params = suggest_transform(_PHRASE_NARROW, 120.0)
        self.assertEqual(key, "normalize")

    def test_bpm_exactly_at_threshold_is_high(self):
        phrase = {"bpm": 120.0, "pattern_label": "", "amplitude_span": 80}
        key, _ = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")

    def test_bpm_just_below_threshold_is_low(self):
        phrase = {"bpm": 119.9, "pattern_label": "", "amplitude_span": 80}
        key, _ = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "passthrough")

    def test_missing_fields_do_not_raise(self):
        """suggest_transform should not crash if optional fields are absent."""
        key, params = suggest_transform({}, 120.0)
        self.assertIn(key, TRANSFORM_CATALOG)
        self.assertIsInstance(params, dict)

    def test_returns_valid_catalog_key(self):
        for phrase in [_PHRASE_HIGH_BPM, _PHRASE_LOW_BPM, _PHRASE_NARROW, _PHRASE_TRANS]:
            key, params = suggest_transform(phrase, 120.0)
            self.assertIn(key, TRANSFORM_CATALOG, f"suggest_transform returned unknown key: {key!r}")

    def test_giggle_tag_suggests_amplitude_scale_amplify(self):
        phrase = {"bpm": 130.0, "tags": ["giggle"],
                  "metrics": {"span": 10, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")
        self.assertGreater(params.get("scale", 1.0), 1.0)

    def test_plateau_tag_suggests_amplitude_scale_amplify(self):
        phrase = {"bpm": 130.0, "tags": ["plateau"],
                  "metrics": {"span": 30, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")
        self.assertGreaterEqual(params.get("scale", 1.0), 1.0)

    def test_stingy_tag_suggests_amplitude_scale_reduce(self):
        phrase = {"bpm": 130.0, "tags": ["stingy"],
                  "metrics": {"span": 80, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")
        self.assertLess(params.get("scale", 1.0), 1.0)

    def test_giggle_scale_targets_hi_at_65(self):
        """Scale for giggle should drive the high position to ~65."""
        phrase = {"bpm": 130.0, "tags": ["giggle"],
                  "metrics": {"span": 10, "mean_pos": 50}}
        _, params = suggest_transform(phrase, 120.0)
        # hi = mean_pos + span/2 = 55; after scale, new_hi = 50 + scale*(55-50)
        hi_after = 50 + params["scale"] * (55 - 50)
        self.assertAlmostEqual(hi_after, 65.0, places=0)

    def test_stingy_scale_targets_hi_at_65(self):
        """Scale for stingy should drive the high position to ~65."""
        phrase = {"bpm": 130.0, "tags": ["stingy"],
                  "metrics": {"span": 80, "mean_pos": 50}}
        _, params = suggest_transform(phrase, 120.0)
        hi_after = 50 + params["scale"] * (90 - 50)
        self.assertAlmostEqual(hi_after, 65.0, places=0)

    def test_frantic_tag_suggests_halve_tempo(self):
        phrase = {"bpm": 210.0, "tags": ["frantic"],
                  "metrics": {"span": 80, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "halve_tempo")

    def test_lazy_tag_suggests_amplitude_scale_amplify(self):
        phrase = {"bpm": 60.0, "tags": ["lazy"],
                  "metrics": {"span": 20, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")
        self.assertGreater(params.get("scale", 1.0), 1.0)

    def test_drift_tag_suggests_recenter(self):
        phrase = {"bpm": 130.0, "tags": ["drift"],
                  "metrics": {"span": 60, "mean_pos": 75}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "recenter")
        self.assertEqual(params.get("target_center"), 50)

    def test_half_stroke_tag_suggests_recenter(self):
        phrase = {"bpm": 130.0, "tags": ["half_stroke"],
                  "metrics": {"span": 50, "mean_pos": 75}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "recenter")
        self.assertEqual(params.get("target_center"), 50)

    def test_drone_tag_suggests_beat_accent(self):
        phrase = {"bpm": 130.0, "tags": ["drone"],
                  "metrics": {"span": 70, "mean_pos": 50}}
        key, params = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "beat_accent")

    def test_tag_takes_priority_over_bpm_fallback(self):
        """A tagged phrase should not fall through to the BPM rules."""
        # lazy has low BPM — without tag-aware logic this would be passthrough
        phrase = {"bpm": 50.0, "tags": ["lazy"],
                  "metrics": {"span": 20, "mean_pos": 50}}
        key, _ = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "amplitude_scale")

    def test_frantic_takes_priority_over_bpm_fallback(self):
        """frantic should suggest halve_tempo even though BPM > threshold."""
        phrase = {"bpm": 220.0, "tags": ["frantic"], "amplitude_span": 80,
                  "metrics": {"span": 80, "mean_pos": 50}}
        key, _ = suggest_transform(phrase, 120.0)
        self.assertEqual(key, "halve_tempo")


# ---------------------------------------------------------------------------
# TransformParam
# ---------------------------------------------------------------------------

class TestTransformParam(unittest.TestCase):

    def test_fields_present(self):
        p = TransformParam(
            label="Scale factor", type="float", default=1.0,
            min_val=0.0, max_val=5.0, step=0.1, help="A help string",
        )
        self.assertEqual(p.label, "Scale factor")
        self.assertEqual(p.type, "float")
        self.assertAlmostEqual(p.default, 1.0)
        self.assertAlmostEqual(p.min_val, 0.0)
        self.assertAlmostEqual(p.max_val, 5.0)
        self.assertAlmostEqual(p.step, 0.1)
        self.assertEqual(p.help, "A help string")

    def test_optional_fields_default_to_none_or_empty(self):
        p = TransformParam(label="X", type="int", default=5)
        self.assertIsNone(p.min_val)
        self.assertIsNone(p.max_val)
        self.assertIsNone(p.step)
        self.assertEqual(p.help, "")


# ---------------------------------------------------------------------------
# README CLI examples — each example from pattern_catalog/README.md verified
# as a programmatic equivalent so the docs stay honest.
# ---------------------------------------------------------------------------

class TestReadmeExamples(unittest.TestCase):
    """Programmatic equivalents of the CLI examples in pattern_catalog/README.md.

    These do not call the CLI; they exercise the same catalog calls that the
    phrase-transform command makes internally so that any breakage surfaces here
    before it affects the docs or the UI.
    """

    def _phrase_actions(self):
        """Realistic-ish phrase: alternating low/high positions."""
        return _actions([10, 90, 10, 90, 10, 90, 10, 90])

    # ------------------------------------------------------------------
    # smooth — apply to phrases 4 and 5 (strength=0.25)
    # ------------------------------------------------------------------
    def test_smooth_strength_0_25(self):
        """README: --transform smooth --phrase 4 --phrase 5 --param strength=0.25"""
        actions = self._phrase_actions()
        result = TRANSFORM_CATALOG["smooth"].apply(actions, {"strength": 0.25})
        self.assertEqual(len(result), len(actions))
        # Smoothing should reduce the peak-to-trough swing
        orig_range = max(a["pos"] for a in actions) - min(a["pos"] for a in actions)
        res_range  = max(a["pos"] for a in result)  - min(a["pos"] for a in result)
        self.assertLessEqual(res_range, orig_range)

    # ------------------------------------------------------------------
    # normalize — all phrases, default full range
    # ------------------------------------------------------------------
    def test_normalize_all_default_range(self):
        """README: --transform normalize --all"""
        actions = _actions([30, 40, 50, 60, 70])
        result = TRANSFORM_CATALOG["normalize"].apply(actions, {"target_lo": 0, "target_hi": 100})
        positions = [a["pos"] for a in result]
        self.assertEqual(min(positions), 0)
        self.assertEqual(max(positions), 100)

    # ------------------------------------------------------------------
    # boost_contrast — single phrase, strength=0.8
    # ------------------------------------------------------------------
    def test_boost_contrast_strength_0_8(self):
        """README: --transform boost_contrast --phrase 2 --param strength=0.8"""
        high = _actions([80])
        low  = _actions([20])
        result_high = TRANSFORM_CATALOG["boost_contrast"].apply(high, {"strength": 0.8})
        result_low  = TRANSFORM_CATALOG["boost_contrast"].apply(low,  {"strength": 0.8})
        self.assertGreater(result_high[0]["pos"], 80)
        self.assertLess(result_low[0]["pos"], 20)

    # ------------------------------------------------------------------
    # amplitude_scale — all phrases, scale=0.7 (gentler output)
    # ------------------------------------------------------------------
    def test_amplitude_scale_down(self):
        """README: --transform amplitude_scale --all --param scale=0.7"""
        actions = _actions([20, 80])  # span = 60 around midpoint 50
        result = TRANSFORM_CATALOG["amplitude_scale"].apply(actions, {"scale": 0.7})
        orig_range = 80 - 20
        res_range  = result[1]["pos"] - result[0]["pos"]
        # Scale <1 should compress stroke depth
        self.assertLess(res_range, orig_range)

    # ------------------------------------------------------------------
    # invert — phrase 1 (fix phase-inverted section)
    # ------------------------------------------------------------------
    def test_invert_phrase(self):
        """README: --transform invert --phrase 1"""
        actions = _actions([10, 90, 10, 90])
        result = TRANSFORM_CATALOG["invert"].apply(actions)
        self.assertEqual([a["pos"] for a in result], [90, 10, 90, 10])

    # ------------------------------------------------------------------
    # suggest — auto-pick per phrase (bpm_threshold=120)
    # ------------------------------------------------------------------
    def test_suggest_high_bpm_wide_amp(self):
        """README: --suggest --bpm-threshold 120  (high BPM, wide amp → amplitude_scale)"""
        self.assertEqual(suggest_transform(_PHRASE_HIGH_BPM, 120.0)[0], "amplitude_scale")

    def test_suggest_low_bpm(self):
        """README: --suggest --bpm-threshold 120  (low BPM → passthrough)"""
        self.assertEqual(suggest_transform(_PHRASE_LOW_BPM, 120.0)[0], "passthrough")

    def test_suggest_transition(self):
        """README: --suggest  (transition phrase → smooth)"""
        self.assertEqual(suggest_transform(_PHRASE_TRANS, 120.0)[0], "smooth")

    def test_suggest_narrow_amp(self):
        """README: --suggest  (high BPM, narrow amp → normalize)"""
        self.assertEqual(suggest_transform(_PHRASE_NARROW, 120.0)[0], "normalize")

    # ------------------------------------------------------------------
    # clamp_upper / clamp_lower (documented in catalog table)
    # ------------------------------------------------------------------
    def test_clamp_upper_all_positions_in_upper_half(self):
        """README catalog: clamp_upper keeps motion in the 50-100 zone."""
        actions = _actions([0, 25, 50, 75, 100])
        result = TRANSFORM_CATALOG["clamp_upper"].apply(
            actions, {"range_lo": 50, "range_hi": 100}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 50)

    def test_clamp_lower_all_positions_in_lower_half(self):
        """README catalog: clamp_lower keeps motion in the 0-50 zone."""
        actions = _actions([0, 25, 50, 75, 100])
        result = TRANSFORM_CATALOG["clamp_lower"].apply(
            actions, {"range_lo": 0, "range_hi": 50}
        )
        for a in result:
            self.assertLessEqual(a["pos"], 50)

    # ------------------------------------------------------------------
    # Param override round-trip (--param key=value)
    # ------------------------------------------------------------------
    def test_param_override_scale(self):
        """--param scale=1.0 on amplitude_scale should be identity."""
        actions = _actions([20, 50, 80])
        result = TRANSFORM_CATALOG["amplitude_scale"].apply(actions, {"scale": 1.0})
        self.assertEqual([a["pos"] for a in result], [20, 50, 80])

    def test_param_override_target_range(self):
        """--param target_lo=20 target_hi=80 on normalize."""
        actions = _actions([0, 100])
        result = TRANSFORM_CATALOG["normalize"].apply(
            actions, {"target_lo": 20, "target_hi": 80}
        )
        positions = [a["pos"] for a in result]
        self.assertEqual(min(positions), 20)
        self.assertEqual(max(positions), 80)

    # ------------------------------------------------------------------
    # shift (README: --transform shift --phrase 2 --param offset=20)
    # ------------------------------------------------------------------
    def test_readme_shift_moves_positions_up(self):
        """README: shift --param offset=20 nudges all positions up."""
        actions = _actions([20, 50, 70])
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 20})
        self.assertEqual([a["pos"] for a in result], [40, 70, 90])

    # ------------------------------------------------------------------
    # recenter (README: --transform recenter --param target_center=70)
    # ------------------------------------------------------------------
    def test_readme_recenter_midpoint_lands_at_target(self):
        """README: recenter --param target_center=70 places midpoint at 70."""
        actions = _actions([30, 50, 70])  # midpoint = 50
        result = TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 70})
        positions = [a["pos"] for a in result]
        midpoint = (min(positions) + max(positions)) / 2
        self.assertAlmostEqual(midpoint, 70, delta=1)

    # ------------------------------------------------------------------
    # break (README: default and custom reduce/lpf_strength)
    # ------------------------------------------------------------------
    def test_readme_break_default_reduces_amplitude(self):
        """README: break (defaults) pulls all positions toward 50."""
        actions = _actions([10, 90, 10, 90])
        result = TRANSFORM_CATALOG["break"].apply(actions, {})
        positions = [a["pos"] for a in result]
        self.assertGreater(min(positions), 10)
        self.assertLess(max(positions), 90)

    def test_readme_break_custom_stronger_reduction(self):
        """README: break --param reduce=0.60 --param lpf_strength=0.40."""
        actions = _actions([10, 90, 10, 90])
        default_result = TRANSFORM_CATALOG["break"].apply(actions, {})
        custom_result = TRANSFORM_CATALOG["break"].apply(
            actions, {"reduce": 0.60, "lpf_strength": 0.40}
        )
        default_span = max(a["pos"] for a in default_result) - min(a["pos"] for a in default_result)
        custom_span = max(a["pos"] for a in custom_result) - min(a["pos"] for a in custom_result)
        self.assertLessEqual(custom_span, default_span)

    # ------------------------------------------------------------------
    # performance (README: default and custom params)
    # ------------------------------------------------------------------
    def test_readme_performance_default_in_range(self):
        """README: performance (defaults) keeps positions in 0-100."""
        actions = _actions([0, 50, 100, 50, 0])
        result = TRANSFORM_CATALOG["performance"].apply(actions, {})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_readme_performance_custom_range(self):
        """README: performance --param max_velocity=0.20 --param range_lo=10 --param range_hi=95."""
        actions = _actions([0, 50, 100, 50, 0])
        result = TRANSFORM_CATALOG["performance"].apply(
            actions, {"max_velocity": 0.20, "range_lo": 10, "range_hi": 95}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 10)
            self.assertLessEqual(a["pos"], 95)

    # ------------------------------------------------------------------
    # three_one (README: default and with amplitude_scale+range)
    # ------------------------------------------------------------------
    def test_readme_three_one_default_same_length(self):
        """README: three_one (defaults) returns same number of actions."""
        actions = _actions([20, 80] * 4)
        result = TRANSFORM_CATALOG["three_one"].apply(actions, {})
        self.assertEqual(len(result), len(actions))

    def test_readme_three_one_custom_range_clamped(self):
        """README: three_one --param amplitude_scale=1.5 --param range_lo=20 --param range_hi=80."""
        actions = _actions([20, 80] * 4)
        result = TRANSFORM_CATALOG["three_one"].apply(
            actions, {"amplitude_scale": 1.5, "range_lo": 20, "range_hi": 80}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 20)
            self.assertLessEqual(a["pos"], 80)

    # ------------------------------------------------------------------
    # beat_accent (README: 3 examples)
    # ------------------------------------------------------------------
    def test_readme_beat_accent_default_same_length(self):
        """README: beat_accent (defaults) returns same length."""
        actions = _actions([20, 80] * 6)
        result = TRANSFORM_CATALOG["beat_accent"].apply(actions, {})
        self.assertEqual(len(result), len(actions))

    def test_readme_beat_accent_every_nth_4_stronger(self):
        """README: beat_accent --param every_nth=4 --param accent_amount=10."""
        actions = _actions([20, 80] * 8)
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions, {"every_nth": 4, "accent_amount": 10}
        )
        self.assertEqual(len(result), len(actions))
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_readme_beat_accent_start_at_ms_and_max_accents(self):
        """README: beat_accent --param every_nth=2 --param start_at_ms=... --param max_accents=8."""
        actions = _timed_actions([20, 80] * 10, start_ms=0, step_ms=100)
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions, {"every_nth": 2, "start_at_ms": 200, "max_accents": 8}
        )
        self.assertEqual(len(result), len(actions))

    # ------------------------------------------------------------------
    # blend_seams (README: via finalize or phrase-transform)
    # ------------------------------------------------------------------
    def test_readme_blend_seams_default_same_length(self):
        """README: blend_seams (defaults) is non-structural — same length."""
        actions = _timed_actions([20, 80] * 5, start_ms=0, step_ms=100)
        result = TRANSFORM_CATALOG["blend_seams"].apply(actions, {})
        self.assertEqual(len(result), len(actions))

    def test_readme_blend_seams_in_range(self):
        """README: blend_seams keeps all positions in 0-100."""
        actions = _timed_actions([0, 100] * 4, start_ms=0, step_ms=50)
        result = TRANSFORM_CATALOG["blend_seams"].apply(actions, {})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    # ------------------------------------------------------------------
    # final_smooth (README: via finalize command)
    # ------------------------------------------------------------------
    def test_readme_final_smooth_default_same_length(self):
        """README: final_smooth (defaults) is non-structural — same length."""
        actions = _actions([20, 80, 20, 80, 20])
        result = TRANSFORM_CATALOG["final_smooth"].apply(actions, {})
        self.assertEqual(len(result), len(actions))

    def test_readme_final_smooth_custom_strength_in_range(self):
        """README: final_smooth --param smooth_strength=0.05 (via finalize) keeps 0-100."""
        actions = _actions([0, 100, 0, 100])
        result = TRANSFORM_CATALOG["final_smooth"].apply(actions, {"strength": 0.05})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    # ------------------------------------------------------------------
    # halve_tempo (README: 2 examples)
    # ------------------------------------------------------------------
    def test_readme_halve_tempo_fewer_actions(self):
        """README: halve_tempo --phrase 3 returns fewer actions (structural)."""
        actions = _timed_actions([20, 80] * 6, start_ms=0, step_ms=100)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions, {})
        self.assertLess(len(result), len(actions))

    def test_readme_halve_tempo_with_amplitude_scale(self):
        """README: halve_tempo --all --param amplitude_scale=0.8 compresses amplitude."""
        actions = _timed_actions([10, 90] * 6, start_ms=0, step_ms=100)
        original_span = 90 - 10
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions, {"amplitude_scale": 0.8})
        result_span = max(a["pos"] for a in result) - min(a["pos"] for a in result)
        self.assertLess(result_span, original_span)


class TestShift(unittest.TestCase):

    def test_positive_offset_moves_up(self):
        actions = _actions([20, 50, 80])
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 10})
        self.assertEqual([a["pos"] for a in result], [30, 60, 90])

    def test_negative_offset_moves_down(self):
        actions = _actions([20, 50, 80])
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": -10})
        self.assertEqual([a["pos"] for a in result], [10, 40, 70])

    def test_zero_offset_is_identity(self):
        actions = _actions([20, 50, 80])
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 0})
        self.assertEqual([a["pos"] for a in result], [20, 50, 80])

    def test_clamped_at_boundaries(self):
        actions = _actions([10, 90])
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 50})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)
        self.assertEqual(result[1]["pos"], 100)  # 90+50 clamped

    def test_amplitude_preserved_within_bounds(self):
        """When shift doesn't hit a wall, amplitude span is unchanged."""
        actions = _actions([20, 80])  # span = 60
        result = TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 5})
        span = result[1]["pos"] - result[0]["pos"]
        self.assertEqual(span, 60)

    def test_does_not_mutate_input(self):
        actions = _actions([30, 70])
        original = [a["pos"] for a in actions]
        TRANSFORM_CATALOG["shift"].apply(actions, {"offset": 20})
        self.assertEqual([a["pos"] for a in actions], original)


class TestRecenter(unittest.TestCase):

    def test_centers_at_target(self):
        """After recenter, (min+max)/2 should equal target_center (within rounding)."""
        actions = _actions([20, 80])  # midpoint = 50
        result = TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 70})
        lo = min(a["pos"] for a in result)
        hi = max(a["pos"] for a in result)
        self.assertAlmostEqual((lo + hi) / 2, 70, delta=1)

    def test_amplitude_span_unchanged(self):
        actions = _actions([20, 80])  # span = 60
        result = TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 30})
        lo = min(a["pos"] for a in result)
        hi = max(a["pos"] for a in result)
        self.assertAlmostEqual(hi - lo, 60, delta=1)

    def test_already_centered_is_identity(self):
        actions = _actions([20, 80])  # midpoint = 50
        result = TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 50})
        self.assertEqual([a["pos"] for a in result], [20, 80])

    def test_clamped_at_boundaries(self):
        actions = _actions([0, 100])  # full range, midpoint=50
        result = TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 80})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_empty_actions(self):
        result = TRANSFORM_CATALOG["recenter"].apply([], {"target_center": 50})
        self.assertEqual(result, [])

    def test_does_not_mutate_input(self):
        actions = _actions([30, 70])
        original = [a["pos"] for a in actions]
        TRANSFORM_CATALOG["recenter"].apply(actions, {"target_center": 70})
        self.assertEqual([a["pos"] for a in actions], original)


class TestBreak(unittest.TestCase):
    """Tests for the break amplitude-reduce + LPF transform."""

    def test_same_length_and_timestamps(self):
        actions = _actions([0, 100, 0, 100])
        result = TRANSFORM_CATALOG["break"].apply(actions)
        self.assertEqual(len(result), len(actions))
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_positions_pulled_toward_center(self):
        """With reduce=0.40, pos=0 → 20 and pos=100 → 80."""
        actions = _actions([0, 100])
        result = TRANSFORM_CATALOG["break"].apply(actions, {"reduce": 0.40, "lpf_strength": 0.0})
        self.assertEqual(result[0]["pos"], 20)   # 0 + (50-0)*0.40
        self.assertEqual(result[1]["pos"], 80)   # 100 + (50-100)*0.40

    def test_reduce_zero_is_passthrough(self):
        actions = _actions([10, 50, 90])
        result = TRANSFORM_CATALOG["break"].apply(actions, {"reduce": 0.0, "lpf_strength": 0.0})
        self.assertEqual([a["pos"] for a in result], [10, 50, 90])

    def test_reduce_one_collapses_to_center(self):
        actions = _actions([0, 100])
        result = TRANSFORM_CATALOG["break"].apply(actions, {"reduce": 1.0, "lpf_strength": 0.0})
        for a in result:
            self.assertEqual(a["pos"], 50)

    def test_lpf_reduces_range(self):
        actions = _actions([0, 100, 0, 100, 0, 100])
        no_lpf   = TRANSFORM_CATALOG["break"].apply(
            [dict(a) for a in actions], {"reduce": 0.0, "lpf_strength": 0.0}
        )
        with_lpf = TRANSFORM_CATALOG["break"].apply(
            [dict(a) for a in actions], {"reduce": 0.0, "lpf_strength": 0.3}
        )
        range_no  = max(a["pos"] for a in no_lpf)  - min(a["pos"] for a in no_lpf)
        range_lpf = max(a["pos"] for a in with_lpf) - min(a["pos"] for a in with_lpf)
        self.assertLessEqual(range_lpf, range_no)

    def test_does_not_mutate_input(self):
        actions = _actions([0, 100, 0, 100])
        original = [a["pos"] for a in actions]
        TRANSFORM_CATALOG["break"].apply(actions)
        self.assertEqual([a["pos"] for a in actions], original)

    def test_matches_six_task_defaults(self):
        """Default params should match BREAK_AMPLITUDE_REDUCE=0.40, LPF_BREAK=0.30."""
        spec = TRANSFORM_CATALOG["break"]
        self.assertAlmostEqual(spec.params["reduce"].default, 0.40)
        self.assertAlmostEqual(spec.params["lpf_strength"].default, 0.30)


class TestPerformance(unittest.TestCase):
    """Tests for the performance velocity-cap + reversal-softening transform."""

    def _ramp(self, n=20, period_ms=50):
        """Alternating 0-100 wave with `n` half-cycles."""
        actions = []
        for i in range(n):
            actions.append({"at": i * period_ms, "pos": 0 if i % 2 == 0 else 100})
        return actions

    def test_same_length_and_timestamps(self):
        actions = self._ramp()
        result = TRANSFORM_CATALOG["performance"].apply(actions)
        self.assertEqual(len(result), len(actions))
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_velocity_cap_limits_change(self):
        """With a very tight velocity cap, no step should exceed cap × dt."""
        actions = self._ramp(n=20, period_ms=50)
        max_vel = 0.20
        result = TRANSFORM_CATALOG["performance"].apply(actions, {
            "max_velocity": max_vel, "reversal_soften": 0.0,
            "height_blend": 1.0, "range_lo": 0, "range_hi": 100, "lpf_strength": 0.0,
        })
        for i in range(1, len(result)):
            dt = max(1, result[i]["at"] - result[i-1]["at"])
            delta = abs(result[i]["pos"] - result[i-1]["pos"])
            self.assertLessEqual(delta, max_vel * dt + 1,  # +1 for int rounding
                                 f"Velocity exceeded cap at index {i}")

    def test_range_compress_applied(self):
        """All output positions must be within [range_lo, range_hi]."""
        actions = self._ramp()
        result = TRANSFORM_CATALOG["performance"].apply(actions, {
            "max_velocity": 1.0, "reversal_soften": 0.0, "height_blend": 1.0,
            "range_lo": 15, "range_hi": 92, "lpf_strength": 0.0,
        })
        for a in result:
            self.assertGreaterEqual(a["pos"], 15)
            self.assertLessEqual(a["pos"], 92)

    def test_reversal_soften_reduces_overshoot(self):
        """With high reversal_soften, direction-change positions should be pulled in."""
        # One sharp reversal: go up to 100, then try to snap to 0
        actions = [
            {"at": 0,   "pos": 50},
            {"at": 50,  "pos": 100},
            {"at": 100, "pos": 0},   # sharp reversal here
        ]
        hard = TRANSFORM_CATALOG["performance"].apply(
            [dict(a) for a in actions],
            {"max_velocity": 1.0, "reversal_soften": 0.0, "height_blend": 1.0,
             "range_lo": 0, "range_hi": 100, "lpf_strength": 0.0},
        )
        soft = TRANSFORM_CATALOG["performance"].apply(
            [dict(a) for a in actions],
            {"max_velocity": 1.0, "reversal_soften": 0.8, "height_blend": 0.5,
             "range_lo": 0, "range_hi": 100, "lpf_strength": 0.0},
        )
        # Softened reversal should land higher than 0 (less extreme snap-back)
        self.assertGreater(soft[2]["pos"], hard[2]["pos"])

    def test_lpf_reduces_jitter(self):
        """LPF should reduce the peak-to-trough range."""
        actions = self._ramp(n=20, period_ms=10)
        no_lpf  = TRANSFORM_CATALOG["performance"].apply(
            [dict(a) for a in actions],
            {"max_velocity": 1.0, "reversal_soften": 0.0, "height_blend": 1.0,
             "range_lo": 0, "range_hi": 100, "lpf_strength": 0.0},
        )
        with_lpf = TRANSFORM_CATALOG["performance"].apply(
            [dict(a) for a in actions],
            {"max_velocity": 1.0, "reversal_soften": 0.0, "height_blend": 1.0,
             "range_lo": 0, "range_hi": 100, "lpf_strength": 0.3},
        )
        range_no  = max(a["pos"] for a in no_lpf)  - min(a["pos"] for a in no_lpf)
        range_lpf = max(a["pos"] for a in with_lpf) - min(a["pos"] for a in with_lpf)
        self.assertLessEqual(range_lpf, range_no)

    def test_short_phrase_passthrough(self):
        actions = _actions([0, 100])
        result = TRANSFORM_CATALOG["performance"].apply(actions)
        self.assertEqual(len(result), len(actions))

    def test_does_not_mutate_input(self):
        actions = self._ramp()
        original = [{"at": a["at"], "pos": a["pos"]} for a in actions]
        TRANSFORM_CATALOG["performance"].apply(actions)
        self.assertEqual(actions, original)


class TestThreeOne(unittest.TestCase):
    """Tests for the three_one pulse transform."""

    def _wave(self, cycles=8, period_ms=100):
        """Clean alternating wave with `cycles` half-cycles (beats)."""
        actions = []
        for c in range(cycles):
            pos = 0 if c % 2 == 0 else 100
            actions.append({"at": c * period_ms, "pos": pos})
        actions.append({"at": cycles * period_ms, "pos": 0})
        return actions

    def test_same_length_as_input(self):
        """three_one is positional — action count must not change."""
        actions = self._wave(cycles=8)
        result = TRANSFORM_CATALOG["three_one"].apply(actions)
        self.assertEqual(len(result), len(actions))

    def test_same_timestamps(self):
        """Timestamps must be identical to input."""
        actions = self._wave(cycles=8)
        result = TRANSFORM_CATALOG["three_one"].apply(actions)
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_fourth_beat_is_flat(self):
        """The 4th beat window should be at a single constant (center) position."""
        actions = self._wave(cycles=8)
        result = TRANSFORM_CATALOG["three_one"].apply(
            actions, {"amplitude_scale": 1.0, "range_lo": 0, "range_hi": 100}
        )
        from pattern_catalog.phrase_transforms import _find_extrema
        extrema = _find_extrema(result, min_prominence=10)
        if len(extrema) >= 4:
            # Actions in the 4th beat window (extrema[3] to extrema[4])
            a_start = extrema[3]
            a_end = extrema[4] if len(extrema) > 4 else len(result)
            hold_positions = {result[k]["pos"] for k in range(a_start, a_end)}
            self.assertEqual(len(hold_positions), 1, "4th beat should be flat (single position)")

    def test_positions_clamped_by_range(self):
        """range_lo / range_hi should cap all output positions."""
        actions = self._wave(cycles=8)
        result = TRANSFORM_CATALOG["three_one"].apply(
            actions, {"amplitude_scale": 2.0, "range_lo": 20, "range_hi": 80}
        )
        for a in result:
            self.assertGreaterEqual(a["pos"], 20)
            self.assertLessEqual(a["pos"], 80)

    def test_amplitude_scale_1_keeps_stroke_positions(self):
        """With scale=1 and no range cap, stroke positions should be near original."""
        actions = self._wave(cycles=8)
        result = TRANSFORM_CATALOG["three_one"].apply(
            actions, {"amplitude_scale": 1.0, "range_lo": 0, "range_hi": 100}
        )
        from pattern_catalog.phrase_transforms import _find_extrema
        extrema = _find_extrema(actions, min_prominence=10)
        # First beat's extremum should be unchanged
        if extrema:
            self.assertEqual(result[extrema[0]]["pos"], actions[extrema[0]]["pos"])

    def test_does_not_mutate_input(self):
        actions = self._wave(cycles=8)
        original = [{"at": a["at"], "pos": a["pos"]} for a in actions]
        TRANSFORM_CATALOG["three_one"].apply(actions)
        self.assertEqual(actions, original)

    def test_short_phrase_passthrough(self):
        """Fewer than 4 actions returns input unchanged."""
        actions = _actions([0, 100, 0])
        result = TRANSFORM_CATALOG["three_one"].apply(actions)
        self.assertEqual(len(result), len(actions))


# ---------------------------------------------------------------------------
# _find_extrema helper
# ---------------------------------------------------------------------------

class TestFindExtrema(unittest.TestCase):

    def test_single_peak(self):
        actions = _actions([0, 100, 0])
        idx = _find_extrema(actions, min_prominence=10)
        self.assertIn(1, idx)  # peak at index 1

    def test_always_includes_first_and_last(self):
        actions = _actions([50, 60, 50, 60, 50])
        idx = _find_extrema(actions)
        self.assertEqual(idx[0], 0)
        self.assertEqual(idx[-1], len(actions) - 1)

    def test_noise_below_prominence_excluded(self):
        # Tiny 3-unit wobble should not count as an extremum
        actions = _actions([50, 53, 50, 53, 50])
        idx = _find_extrema(actions, min_prominence=10)
        # Only first and last should survive
        self.assertEqual(set(idx), {0, len(actions) - 1})

    def test_short_list_under_3_returns_all(self):
        """Lists with fewer than 3 actions return all indices."""
        for n in range(1, 3):
            actions = _actions(list(range(n)))
            idx = _find_extrema(actions)
            self.assertEqual(len(idx), n)

    def test_3_action_peak_detected(self):
        """A 3-action list with a clear peak includes the middle index."""
        actions = _actions([0, 100, 0])
        idx = _find_extrema(actions, min_prominence=10)
        self.assertIn(1, idx)


# ---------------------------------------------------------------------------
# halve_tempo structural transform
# ---------------------------------------------------------------------------

class TestHalveTempo(unittest.TestCase):
    """Tests for the halve_tempo structural transform."""

    def _wave(self, cycles=4, period_ms=100):
        """Generate a clean square-ish wave with `cycles` full up-down cycles."""
        actions = []
        for c in range(cycles):
            t = c * period_ms
            actions.append({"at": t,                  "pos": 0})
            actions.append({"at": t + period_ms // 2, "pos": 100})
        actions.append({"at": cycles * period_ms, "pos": 0})
        return actions

    def test_structural_flag_set(self):
        spec = TRANSFORM_CATALOG["halve_tempo"]
        self.assertTrue(spec.structural)

    def test_returns_fewer_actions(self):
        """Should produce fewer actions than input (temporal decimation)."""
        actions = self._wave(cycles=4)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        self.assertLess(len(result), len(actions))

    def test_preserves_phrase_time_window(self):
        """First and last timestamps must match original phrase boundaries."""
        actions = self._wave(cycles=4)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        self.assertEqual(result[0]["at"], actions[0]["at"])
        self.assertEqual(result[-1]["at"], actions[-1]["at"])

    def test_timestamps_sorted(self):
        """Output must be in ascending time order."""
        actions = self._wave(cycles=4)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        times = [a["at"] for a in result]
        self.assertEqual(times, sorted(times))

    def test_positions_in_range(self):
        """All output positions must be 0–100."""
        actions = self._wave(cycles=4)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_amplitude_scale_param(self):
        """amplitude_scale=0.5 should compress stroke depth around 50."""
        actions = self._wave(cycles=4)
        normal = TRANSFORM_CATALOG["halve_tempo"].apply(actions, {"amplitude_scale": 1.0})
        scaled = TRANSFORM_CATALOG["halve_tempo"].apply(actions, {"amplitude_scale": 0.5})
        normal_range = max(a["pos"] for a in normal) - min(a["pos"] for a in normal)
        scaled_range = max(a["pos"] for a in scaled) - min(a["pos"] for a in scaled)
        self.assertLessEqual(scaled_range, normal_range)

    def test_short_phrase_passthrough(self):
        """Phrases with fewer than 4 actions are returned unchanged."""
        actions = _actions([0, 100, 0])
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        self.assertEqual(len(result), len(actions))

    def test_does_not_mutate_input(self):
        actions = self._wave(cycles=4)
        original = [{"at": a["at"], "pos": a["pos"]} for a in actions]
        TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        self.assertEqual(actions, original)

    def test_readme_example_halve_tempo(self):
        """CLI README: --transform halve_tempo --all"""
        actions = self._wave(cycles=6)
        result = TRANSFORM_CATALOG["halve_tempo"].apply(actions)
        # Result should have fewer actions and same time window
        self.assertLess(len(result), len(actions))
        self.assertEqual(result[0]["at"], actions[0]["at"])
        self.assertEqual(result[-1]["at"], actions[-1]["at"])


# ---------------------------------------------------------------------------
# blend_seams
# ---------------------------------------------------------------------------

class TestBlendSeams(unittest.TestCase):
    """Tests for the blend_seams velocity-adaptive bilateral LPF transform."""

    def _with_jump(self):
        """Actions with a sharp positional jump between index 2 and 3."""
        # First half around 70–75, then a hard cut to 20–25
        return [
            {"at":   0, "pos": 72},
            {"at": 100, "pos": 75},
            {"at": 200, "pos": 73},
            {"at": 300, "pos": 20},   # sharp jump: |20-73|/100 = 0.53 pos/ms
            {"at": 400, "pos": 22},
            {"at": 500, "pos": 25},
        ]

    def test_sharp_jump_is_softened(self):
        """The action immediately after a high-velocity jump should be blended
        toward the incoming value, not left at the raw target."""
        actions = self._with_jump()
        raw_jump = actions[3]["pos"]   # 20
        result = TRANSFORM_CATALOG["blend_seams"].apply(
            actions, {"max_velocity": 0.40, "max_strength": 0.70}
        )
        # Bilateral blend: position 3 should be between raw (20) and pre-jump (73)
        self.assertGreater(result[3]["pos"], raw_jump,
                           "jump action should be blended upward, not stay at 20")

    def test_smooth_region_largely_unchanged(self):
        """Actions with velocity well below threshold should be barely touched.

        Velocity here: |75-25| / 500ms = 0.10 pos/ms  →  fraction = 0.10/0.50 = 0.20
        → blend strength = 0.20 * 0.70 = 0.14 → positions stay very close to original.
        """
        actions = [{"at": i * 500, "pos": 75 if i % 2 == 0 else 25}
                   for i in range(6)]
        result = TRANSFORM_CATALOG["blend_seams"].apply(
            actions, {"max_velocity": 0.50, "max_strength": 0.70}
        )
        # Positions should remain within 15 of originals
        for orig, res in zip(actions, result):
            self.assertAlmostEqual(orig["pos"], res["pos"], delta=15,
                                   msg=f"Smooth region changed too much at at={orig['at']}")

    def test_same_length_and_timestamps(self):
        actions = self._with_jump()
        result = TRANSFORM_CATALOG["blend_seams"].apply(actions)
        self.assertEqual(len(result), len(actions))
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_empty_and_single_action(self):
        self.assertEqual(TRANSFORM_CATALOG["blend_seams"].apply([]), [])
        single = [{"at": 0, "pos": 50}]
        result = TRANSFORM_CATALOG["blend_seams"].apply(single)
        self.assertEqual(result[0]["pos"], 50)

    def test_positions_stay_in_range(self):
        actions = self._with_jump()
        result = TRANSFORM_CATALOG["blend_seams"].apply(actions)
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_max_strength_zero_is_passthrough(self):
        """max_strength=0 → no blending → positions unchanged."""
        actions = self._with_jump()
        result = TRANSFORM_CATALOG["blend_seams"].apply(
            actions, {"max_velocity": 0.40, "max_strength": 0.0}
        )
        self.assertEqual([a["pos"] for a in result], [a["pos"] for a in actions])

    def test_does_not_mutate_input(self):
        actions = self._with_jump()
        original = [{"at": a["at"], "pos": a["pos"]} for a in actions]
        TRANSFORM_CATALOG["blend_seams"].apply(actions)
        self.assertEqual(actions, original)

    def test_default_params_in_catalog(self):
        spec = TRANSFORM_CATALOG["blend_seams"]
        self.assertAlmostEqual(spec.params["max_velocity"].default, 0.50)
        self.assertAlmostEqual(spec.params["max_strength"].default, 0.70)

    def test_not_structural(self):
        self.assertFalse(TRANSFORM_CATALOG["blend_seams"].structural)


# ---------------------------------------------------------------------------
# final_smooth
# ---------------------------------------------------------------------------

class TestFinalSmooth(unittest.TestCase):
    """Tests for the final_smooth light global LPF finishing pass."""

    def test_in_catalog(self):
        self.assertIn("final_smooth", TRANSFORM_CATALOG)

    def test_default_strength_is_light(self):
        """Default strength should match LPF_DEFAULT=0.10 from six_task_transformer."""
        spec = TRANSFORM_CATALOG["final_smooth"]
        self.assertAlmostEqual(spec.params["strength"].default, 0.10)

    def test_applies_lpf(self):
        """A rapidly alternating signal should have reduced range after smoothing."""
        actions = [{"at": i * 10, "pos": 0 if i % 2 == 0 else 100}
                   for i in range(10)]
        result = TRANSFORM_CATALOG["final_smooth"].apply(actions, {"strength": 0.40})
        raw_range  = max(a["pos"] for a in actions) - min(a["pos"] for a in actions)
        out_range  = max(a["pos"] for a in result)  - min(a["pos"] for a in result)
        self.assertLess(out_range, raw_range)

    def test_strength_zero_is_passthrough(self):
        actions = _actions([10, 50, 90, 20, 80])
        result = TRANSFORM_CATALOG["final_smooth"].apply(actions, {"strength": 0.0})
        self.assertEqual([a["pos"] for a in result], [10, 50, 90, 20, 80])

    def test_same_length_and_timestamps(self):
        actions = _actions([0, 50, 100, 50])
        result = TRANSFORM_CATALOG["final_smooth"].apply(actions)
        self.assertEqual(len(result), len(actions))
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_does_not_mutate_input(self):
        actions = _actions([10, 90, 10, 90])
        original = [a["pos"] for a in actions]
        TRANSFORM_CATALOG["final_smooth"].apply(actions)
        self.assertEqual([a["pos"] for a in actions], original)

    def test_not_structural(self):
        self.assertFalse(TRANSFORM_CATALOG["final_smooth"].structural)


# ---------------------------------------------------------------------------
# beat_accent
# ---------------------------------------------------------------------------

class TestBeatAccent(unittest.TestCase):
    """Tests for the beat_accent rhythmic emphasis transform."""

    def _wave(self, half_cycles=8, period_ms=100):
        """Alternating 20/80 wave; each extremum is a 'beat'.
        Using 20/80 (not 0/100) so accent boosts are not swallowed by clamping."""
        return [{"at": i * period_ms, "pos": 20 if i % 2 == 0 else 80}
                for i in range(half_cycles + 1)]

    # --- basic mechanics ---

    def test_same_length_and_timestamps(self):
        actions = self._wave()
        result = TRANSFORM_CATALOG["beat_accent"].apply(actions)
        self.assertEqual(len(result), len(actions))
        self.assertEqual([a["at"] for a in result], [a["at"] for a in actions])

    def test_peaks_boosted_up(self):
        """Accented peaks (pos=80) should be boosted upward."""
        actions = self._wave(half_cycles=4)
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions, {"every_nth": 1, "accent_amount": 4, "radius_ms": 40,
                       "start_at_ms": 0, "max_accents": 0}
        )
        for orig, res in zip(actions, result):
            if orig["pos"] == 80:
                self.assertGreater(res["pos"], orig["pos"],
                                   f"Peak at t={orig['at']} should be boosted up")

    def test_troughs_boosted_down(self):
        """Accented troughs (pos=20) should be boosted downward."""
        actions = self._wave(half_cycles=4)
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions, {"every_nth": 1, "accent_amount": 4, "radius_ms": 40,
                       "start_at_ms": 0, "max_accents": 0}
        )
        for orig, res in zip(actions, result):
            if orig["pos"] == 20:
                self.assertLess(res["pos"], orig["pos"],
                                f"Trough at t={orig['at']} should be boosted down")

    def test_positions_stay_in_range(self):
        actions = self._wave()
        result = TRANSFORM_CATALOG["beat_accent"].apply(actions)
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    # --- every_nth ---

    def test_every_nth_2_accents_half_as_many(self):
        """With every_nth=2, roughly half the beats should be changed."""
        actions = self._wave(half_cycles=8)
        all_beats = TRANSFORM_CATALOG["beat_accent"].apply(
            [dict(a) for a in actions],
            {"every_nth": 1, "accent_amount": 10, "radius_ms": 10,
             "start_at_ms": 0, "max_accents": 0},
        )
        every_2 = TRANSFORM_CATALOG["beat_accent"].apply(
            [dict(a) for a in actions],
            {"every_nth": 2, "accent_amount": 10, "radius_ms": 10,
             "start_at_ms": 0, "max_accents": 0},
        )
        changed_all = sum(1 for o, r in zip(actions, all_beats) if o["pos"] != r["pos"])
        changed_2   = sum(1 for o, r in zip(actions, every_2)   if o["pos"] != r["pos"])
        self.assertLess(changed_2, changed_all,
                        "every_nth=2 should change fewer positions than every_nth=1")

    def test_every_nth_4_fewer_than_2(self):
        actions = self._wave(half_cycles=16)
        every_2 = TRANSFORM_CATALOG["beat_accent"].apply(
            [dict(a) for a in actions],
            {"every_nth": 2, "accent_amount": 10, "radius_ms": 10,
             "start_at_ms": 0, "max_accents": 0},
        )
        every_4 = TRANSFORM_CATALOG["beat_accent"].apply(
            [dict(a) for a in actions],
            {"every_nth": 4, "accent_amount": 10, "radius_ms": 10,
             "start_at_ms": 0, "max_accents": 0},
        )
        changed_2 = sum(1 for o, r in zip(actions, every_2) if o["pos"] != r["pos"])
        changed_4 = sum(1 for o, r in zip(actions, every_4) if o["pos"] != r["pos"])
        self.assertLess(changed_4, changed_2)

    # --- start_at_ms ---

    def test_start_at_ms_skips_earlier_beats(self):
        """With start_at_ms set to the middle of the phrase, early beats should be unchanged."""
        actions = self._wave(half_cycles=8, period_ms=100)
        # start_at_ms=400 → skip beats at t=0,100,200,300
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions,
            {"every_nth": 1, "accent_amount": 10, "radius_ms": 10,
             "start_at_ms": 400, "max_accents": 0},
        )
        # Actions at t=0,100,200,300 should be unchanged (before start)
        for orig, res in zip(actions[:4], result[:4]):
            self.assertEqual(orig["pos"], res["pos"],
                             f"Action at t={orig['at']} should be unchanged before start_at_ms=400")

    # --- max_accents ---

    def test_max_accents_caps_changes(self):
        """max_accents=2 should change positions near at most 2 beats."""
        actions = self._wave(half_cycles=8, period_ms=100)
        result = TRANSFORM_CATALOG["beat_accent"].apply(
            actions,
            {"every_nth": 1, "accent_amount": 20, "radius_ms": 10,
             "start_at_ms": 0, "max_accents": 2},
        )
        # With radius_ms=10 and period_ms=100, only the exact extremum ±10ms is boosted
        # so at most 2 actions should differ from originals (one per accent)
        changed = [i for i, (o, r) in enumerate(zip(actions, result)) if o["pos"] != r["pos"]]
        # Allow a small slack because radius can capture an adjacent action
        self.assertLessEqual(len(changed), 4,
                             f"Expected at most ~2 beats affected, got {len(changed)}: {changed}")

    # --- edge cases ---

    def test_empty_actions(self):
        self.assertEqual(TRANSFORM_CATALOG["beat_accent"].apply([]), [])

    def test_single_action(self):
        actions = [{"at": 0, "pos": 50}]
        result = TRANSFORM_CATALOG["beat_accent"].apply(actions)
        self.assertEqual(len(result), 1)

    def test_does_not_mutate_input(self):
        actions = self._wave()
        original = [{"at": a["at"], "pos": a["pos"]} for a in actions]
        TRANSFORM_CATALOG["beat_accent"].apply(actions)
        self.assertEqual(actions, original)

    def test_not_structural(self):
        self.assertFalse(TRANSFORM_CATALOG["beat_accent"].structural)

    def test_default_params_match_six_task_transformer(self):
        """Defaults should match BEAT_ACCENT_AMOUNT=4, BEAT_ACCENT_RADIUS_MS=40."""
        spec = TRANSFORM_CATALOG["beat_accent"]
        self.assertEqual(spec.params["accent_amount"].default, 4)
        self.assertEqual(spec.params["radius_ms"].default, 40)
        self.assertEqual(spec.params["every_nth"].default, 1)
        self.assertEqual(spec.params["start_at_ms"].default, 0)
        self.assertEqual(spec.params["max_accents"].default, 0)


class TestToneTransforms(unittest.TestCase):
    """All 6 tone transforms apply correctly and modify positions."""

    _TONE_KEYS = [
        "tone_tender", "tone_build", "tone_tease",
        "tone_edge", "tone_climax", "tone_dominant",
    ]

    def test_all_tones_registered(self):
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                self.assertIn(key, TRANSFORM_CATALOG)

    def test_tone_has_impact_param(self):
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                self.assertIn("impact", TRANSFORM_CATALOG[key].params)

    def test_tone_modifies_positions(self):
        actions = _actions([10, 50, 90, 20, 80, 40, 60, 30, 70, 50])
        original_pos = [a["pos"] for a in actions]
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                spec = TRANSFORM_CATALOG[key]
                result = spec.apply(actions)
                result_pos = [a["pos"] for a in result]
                # At least some positions should change (with default params)
                self.assertNotEqual(result_pos, original_pos,
                                    f"{key} did not modify any positions")

    def test_tone_impact_zero_is_passthrough(self):
        actions = _actions([10, 50, 90, 20, 80])
        original_pos = [a["pos"] for a in actions]
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                spec = TRANSFORM_CATALOG[key]
                result = spec.apply(actions, {"impact": 0.0})
                result_pos = [a["pos"] for a in result]
                self.assertEqual(result_pos, original_pos,
                                 f"{key} with impact=0 should be passthrough")

    def test_tone_does_not_mutate_input(self):
        actions = _actions([30, 70, 50])
        original = [a["pos"] for a in actions]
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                TRANSFORM_CATALOG[key].apply(actions)
                self.assertEqual([a["pos"] for a in actions], original)

    def test_tone_in_category(self):
        from pattern_catalog.phrase_transforms import get_transforms_by_category
        cats = get_transforms_by_category()
        self.assertIn("Tone", cats)
        tone_keys = [k for k, _ in cats["Tone"]]
        for key in self._TONE_KEYS:
            with self.subTest(key=key):
                self.assertIn(key, tone_keys)
        # Tone should be the first category
        self.assertEqual(list(cats.keys())[0], "Tone")


if __name__ == "__main__":
    unittest.main()
