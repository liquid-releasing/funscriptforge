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


class TestUpstreamCliIsNotShadowed(unittest.TestCase):
    """This repo has its own root `cli.py`, and so does funscript-tools.

    A bare `import cli` inside the adapter resolves to whichever one reached
    `sys.modules['cli']` first. Ours usually runs as `__main__` and never claims
    the name — but the moment anything imports it as `cli` (a test did, and
    every preset test downstream started failing with
    `module 'cli' has no attribute 'BUILTIN_PRESETS'`), the adapter silently
    reads OUR module. Load-by-path makes the collision unreachable.
    """

    def setUp(self):
        from forge.funscript_tools import AVAILABLE
        if not AVAILABLE:
            self.skipTest("funscript-tools not available")

    def test_presets_load_with_an_unrelated_cli_module_in_sys_modules(self):
        import sys
        import types

        import forge.funscript_tools as ft
        decoy = types.ModuleType("cli")   # no BUILTIN_PRESETS, like ours
        saved_cli, saved_cache = sys.modules.get("cli"), ft._cli
        sys.modules["cli"] = decoy
        ft._cli = None                    # force a fresh resolve
        try:
            self.assertIn("Balanced", ft.get_builtin_presets())
        finally:
            ft._cli = saved_cache
            if saved_cli is None:
                sys.modules.pop("cli", None)
            else:
                sys.modules["cli"] = saved_cli


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


class TestProcessWithDefaultConfig(unittest.TestCase):
    """The Export tab's 'estim selected, no Stim preset' path."""

    def setUp(self):
        from forge.funscript_tools import AVAILABLE
        if not AVAILABLE:
            self.skipTest("funscript-tools not available")

    def test_helper_is_callable(self):
        from forge.funscript_tools import process_with_default_config
        self.assertTrue(callable(process_with_default_config))

    def test_default_config_signature_matches_process(self):
        """Both helpers must accept the same on_progress callback shape."""
        import inspect
        from forge.funscript_tools import process, process_with_default_config
        proc_params = list(inspect.signature(process).parameters.keys())
        default_params = list(inspect.signature(process_with_default_config).parameters.keys())
        # Both share the on_progress parameter
        self.assertIn("on_progress", proc_params)
        self.assertIn("on_progress", default_params)


if __name__ == "__main__":
    unittest.main()
