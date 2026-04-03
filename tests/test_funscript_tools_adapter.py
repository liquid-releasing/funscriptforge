# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Tests for forge.funscript_tools adapter module."""

import unittest
from pathlib import Path


class TestAdapterAvailability(unittest.TestCase):
    """Test that the adapter detects funscript-tools correctly."""

    def test_available_flag(self):
        from forge.funscript_tools import AVAILABLE
        # If funscript-tools is cloned as sibling, AVAILABLE is True
        _ft_root = Path(__file__).resolve().parents[1].parent / "funscript-tools"
        expected = (_ft_root / "cli.py").exists()
        self.assertEqual(AVAILABLE, expected)


class TestPresets(unittest.TestCase):
    """Test that presets load correctly from funscript-tools."""

    def setUp(self):
        from forge.funscript_tools import AVAILABLE
        if not AVAILABLE:
            self.skipTest("funscript-tools not available")

    def test_get_presets_returns_dict(self):
        from forge.funscript_tools import get_presets
        presets = get_presets()
        self.assertIsInstance(presets, dict)
        self.assertGreater(len(presets), 0)

    def test_expected_character_names(self):
        from forge.funscript_tools import get_presets
        presets = get_presets()
        for name in ["Gentle", "Reactive", "Scene Builder", "Unpredictable", "Balanced"]:
            self.assertIn(name, presets, f"Missing preset: {name}")

    def test_preset_has_config_and_sliders(self):
        from forge.funscript_tools import get_presets
        presets = get_presets()
        for name, preset in presets.items():
            self.assertIn("config", preset, f"{name} missing config")
            self.assertIn("sliders", preset, f"{name} missing sliders")
            self.assertIsInstance(preset["config"], dict)
            self.assertIsInstance(preset["sliders"], list)

    def test_slider_has_required_fields(self):
        from forge.funscript_tools import get_presets
        presets = get_presets()
        for name, preset in presets.items():
            for sl in preset["sliders"]:
                for field in ["cv", "label", "from_", "to_"]:
                    self.assertIn(field, sl, f"{name} slider missing {field}")


class TestBuildConfig(unittest.TestCase):
    """Test config building from presets + overrides."""

    def setUp(self):
        from forge.funscript_tools import AVAILABLE
        if not AVAILABLE:
            self.skipTest("funscript-tools not available")

    def test_build_config_returns_dict(self):
        from forge.funscript_tools import build_config
        config = build_config("Gentle")
        self.assertIsInstance(config, dict)

    def test_build_config_applies_preset(self):
        from forge.funscript_tools import build_config
        config = build_config("Gentle")
        # Gentle preset sets algorithm in alpha_beta_generation
        ab = config.get("alpha_beta_generation", {})
        self.assertIn("algorithm", ab)

    def test_build_config_with_output_dir(self):
        from forge.funscript_tools import build_config
        config = build_config("Gentle", output_dir="/tmp/test_output")
        self.assertEqual(
            config.get("advanced", {}).get("custom_output_directory"),
            "/tmp/test_output",
        )

    def test_build_config_with_slider_overrides(self):
        from forge.funscript_tools import build_config
        config = build_config("Gentle", slider_overrides={"cv_min_dist": 0.25})
        ab = config.get("alpha_beta_generation", {})
        self.assertEqual(ab.get("min_distance_from_center"), 0.25)

    def test_unknown_preset_uses_defaults(self):
        from forge.funscript_tools import build_config
        config = build_config("NonexistentPreset")
        # Should still return a valid config (defaults)
        self.assertIsInstance(config, dict)


if __name__ == "__main__":
    unittest.main()
