"""Tests for device specs — limits, violations, minimum fix."""

import unittest
from forge.device_specs import (
    load_device_specs,
    combined_limits,
    analyze_violations,
    apply_minimum_fix,
    DeviceSpec,
)


class TestLoadSpecs(unittest.TestCase):

    def test_load_returns_all_devices(self):
        specs = load_device_specs()
        self.assertIn("handy", specs)
        self.assertIn("osr2", specs)
        self.assertIn("estim_foc", specs)
        self.assertIn("estim_stereo", specs)

    def test_spec_has_required_fields(self):
        specs = load_device_specs()
        for key, spec in specs.items():
            with self.subTest(device=key):
                self.assertGreater(spec.max_speed, 0)
                self.assertGreater(spec.max_bpm, 0)
                self.assertGreater(spec.min_cycle_ms, 0)


class TestCombinedLimits(unittest.TestCase):

    def test_single_device(self):
        limits = combined_limits(["handy"])
        self.assertIsNotNone(limits)
        self.assertEqual(limits.max_speed, 400)

    def test_combined_uses_most_restrictive(self):
        # Handy max_speed=400, OSR2 max_speed=500 → combined=400
        limits = combined_limits(["handy", "osr2"])
        self.assertEqual(limits.max_speed, 400)
        # Handy min_cycle_ms=250, OSR2 min_cycle_ms=200 → combined=250
        self.assertEqual(limits.min_cycle_ms, 250)

    def test_empty_returns_none(self):
        self.assertIsNone(combined_limits([]))

    def test_unknown_device_skipped(self):
        limits = combined_limits(["handy", "nonexistent"])
        self.assertIsNotNone(limits)
        self.assertEqual(limits.max_speed, 400)


class TestAnalyzeViolations(unittest.TestCase):

    def _limits(self, max_speed=400):
        return DeviceSpec(
            key="test", name="Test", max_speed=max_speed,
            max_bpm=120, min_cycle_ms=250,
            position_min=0, position_max=100, max_acceleration=3000,
        )

    def test_no_violations(self):
        # Slow actions: 10 pos-units in 1 second = speed 10
        actions = [{"at": 0, "pos": 50}, {"at": 1000, "pos": 60}]
        result = analyze_violations(actions, self._limits())
        self.assertEqual(result["violation_count"], 0)
        self.assertEqual(result["percent_ok"], 100.0)

    def test_detects_violations(self):
        # Fast: 100 pos-units in 100ms = speed 1000 (exceeds 400 limit)
        actions = [{"at": 0, "pos": 0}, {"at": 100, "pos": 100}]
        result = analyze_violations(actions, self._limits())
        self.assertEqual(result["violation_count"], 1)
        self.assertGreater(result["max_speed_found"], 400)

    def test_detects_delta_violations(self):
        # Delta 80 exceeds estim limit of 60
        actions = [{"at": 0, "pos": 10}, {"at": 1000, "pos": 90}]
        limits = DeviceSpec(
            key="estim", name="Estim", device_type="estim",
            max_speed=1000, max_bpm=300, min_cycle_ms=100,
            position_min=0, position_max=100, max_acceleration=10000,
            max_delta=60,
        )
        result = analyze_violations(actions, limits)
        self.assertEqual(result["delta_violations"], 1)
        self.assertEqual(result["max_delta_found"], 80)

    def test_empty_actions(self):
        result = analyze_violations([], self._limits())
        self.assertEqual(result["violation_count"], 0)


class TestApplyMinimumFix(unittest.TestCase):

    def _limits(self, max_speed=400):
        return DeviceSpec(
            key="test", name="Test", max_speed=max_speed,
            max_bpm=120, min_cycle_ms=250,
            position_min=0, position_max=100, max_acceleration=3000,
        )

    def test_does_not_mutate_input(self):
        actions = [{"at": 0, "pos": 0}, {"at": 100, "pos": 100}]
        original_pos = [a["pos"] for a in actions]
        apply_minimum_fix(actions, self._limits())
        self.assertEqual([a["pos"] for a in actions], original_pos)

    def test_fixes_violations(self):
        # Speed 1000 exceeds limit 400
        actions = [{"at": 0, "pos": 0}, {"at": 100, "pos": 100}]
        fixed = apply_minimum_fix(actions, self._limits())
        # Fixed action should have reduced position
        self.assertLess(fixed[1]["pos"], 100)
        # Verify no more violations
        result = analyze_violations(fixed, self._limits())
        self.assertEqual(result["violation_count"], 0)

    def test_preserves_ok_actions(self):
        # Slow: speed 10, well within limits
        actions = [{"at": 0, "pos": 50}, {"at": 1000, "pos": 60}]
        fixed = apply_minimum_fix(actions, self._limits())
        self.assertEqual(fixed[0]["pos"], 50)
        self.assertEqual(fixed[1]["pos"], 60)

    def test_fixes_delta_violations(self):
        # Delta 80 exceeds limit 60 — should be clamped
        limits = DeviceSpec(
            key="estim", name="Estim", device_type="estim",
            max_speed=1000, max_bpm=300, min_cycle_ms=100,
            position_min=0, position_max=100, max_acceleration=10000,
            max_delta=60,
        )
        actions = [{"at": 0, "pos": 10}, {"at": 500, "pos": 90}]
        fixed = apply_minimum_fix(actions, limits)
        delta = abs(fixed[1]["pos"] - fixed[0]["pos"])
        self.assertLessEqual(delta, 60)

    def test_clamps_within_position_range(self):
        actions = [{"at": 0, "pos": 0}, {"at": 100, "pos": 100}]
        fixed = apply_minimum_fix(actions, self._limits())
        for a in fixed:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


if __name__ == "__main__":
    unittest.main()
