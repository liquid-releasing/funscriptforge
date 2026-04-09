# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Tests for forge.stim_config — user-editable stim presets."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _ft_available() -> bool:
    from forge.funscript_tools import AVAILABLE
    return AVAILABLE


class TestAppConfigDir(unittest.TestCase):
    """Platform-specific config directory resolution."""

    def test_returns_path_in_funscriptforge_subdir(self):
        from forge.stim_config import app_config_dir
        d = app_config_dir()
        self.assertIsInstance(d, Path)
        self.assertEqual(d.name, "funscriptforge")

    def test_user_config_path_uses_app_dir(self):
        from forge.stim_config import app_config_dir, user_config_path
        self.assertEqual(user_config_path().parent, app_config_dir())
        self.assertEqual(user_config_path().name, "stim_presets.json")


class TestEnsureUserConfig(unittest.TestCase):
    """Writing the default config file when missing."""

    def setUp(self):
        if not _ft_available():
            self.skipTest("funscript-tools not available")
        self._tmp = tempfile.TemporaryDirectory()
        self._patcher = patch(
            "forge.stim_config.app_config_dir",
            return_value=Path(self._tmp.name),
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmp.cleanup()

    def test_creates_file_when_missing(self):
        from forge.stim_config import ensure_user_config, user_config_path
        path = user_config_path()
        self.assertFalse(path.exists())
        result = ensure_user_config()
        self.assertTrue(path.is_file())
        self.assertEqual(result, path)

    def test_idempotent_when_file_exists(self):
        from forge.stim_config import ensure_user_config, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"custom": "preserved"}', encoding="utf-8")
        ensure_user_config()
        # File contents should be unchanged
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"custom": "preserved"})

    def test_default_contents_match_builtins(self):
        from forge.funscript_tools import get_builtin_presets
        from forge.stim_config import ensure_user_config
        path = ensure_user_config()
        data = json.loads(path.read_text(encoding="utf-8"))
        builtins = get_builtin_presets()
        # All built-in preset names should appear in the written file
        for name in builtins:
            self.assertIn(name, data)


class TestLoadUserConfig(unittest.TestCase):
    """Loading the config file with various failure modes."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._patcher = patch(
            "forge.stim_config.app_config_dir",
            return_value=Path(self._tmp.name),
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmp.cleanup()

    def test_missing_file_returns_empty_no_error(self):
        from forge.stim_config import load_user_config
        data, err = load_user_config()
        self.assertEqual(data, {})
        self.assertIsNone(err)

    def test_valid_file_returns_data(self):
        from forge.stim_config import load_user_config, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"Gentle": {"description": "my custom"}}', encoding="utf-8")
        data, err = load_user_config()
        self.assertIsNone(err)
        self.assertEqual(data["Gentle"]["description"], "my custom")

    def test_invalid_json_returns_error(self):
        from forge.stim_config import load_user_config, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{not valid json', encoding="utf-8")
        data, err = load_user_config()
        self.assertEqual(data, {})
        self.assertIsNotNone(err)
        self.assertIn("not valid JSON", err)

    def test_top_level_array_returns_error(self):
        from forge.stim_config import load_user_config, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('["not", "an", "object"]', encoding="utf-8")
        data, err = load_user_config()
        self.assertEqual(data, {})
        self.assertIsNotNone(err)
        self.assertIn("JSON object", err)


class TestMergedPresets(unittest.TestCase):
    """User overrides applied on top of built-in presets."""

    def setUp(self):
        if not _ft_available():
            self.skipTest("funscript-tools not available")
        self._tmp = tempfile.TemporaryDirectory()
        self._patcher = patch(
            "forge.stim_config.app_config_dir",
            return_value=Path(self._tmp.name),
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmp.cleanup()

    def test_no_user_file_returns_builtins(self):
        from forge.funscript_tools import get_builtin_presets
        from forge.stim_config import merged_presets
        presets, err = merged_presets()
        self.assertIsNone(err)
        self.assertEqual(set(presets.keys()), set(get_builtin_presets().keys()))

    def test_user_override_replaces_field(self):
        from forge.stim_config import merged_presets, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({
                "Gentle": {
                    "description": "user override description",
                },
            }),
            encoding="utf-8",
        )
        presets, err = merged_presets()
        self.assertIsNone(err)
        self.assertEqual(presets["Gentle"]["description"], "user override description")
        # Other fields should still come from builtin
        self.assertIn("config", presets["Gentle"])
        self.assertIn("sliders", presets["Gentle"])

    def test_user_custom_preset_added(self):
        from forge.stim_config import merged_presets, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({
                "MyCustom": {"description": "user-defined character"},
            }),
            encoding="utf-8",
        )
        presets, _ = merged_presets()
        self.assertIn("MyCustom", presets)
        self.assertEqual(presets["MyCustom"]["description"], "user-defined character")

    def test_corrupt_user_file_falls_back_to_builtins_with_error(self):
        from forge.funscript_tools import get_builtin_presets
        from forge.stim_config import merged_presets, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not valid", encoding="utf-8")
        presets, err = merged_presets()
        self.assertIsNotNone(err)
        # Built-ins are still usable
        self.assertEqual(set(presets.keys()), set(get_builtin_presets().keys()))

    def test_deep_merge_preserves_unspecified_nested_fields(self):
        from forge.stim_config import merged_presets, user_config_path
        path = user_config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({
                "Gentle": {
                    "config": {
                        "alpha_beta_generation": {
                            "min_distance_from_center": 0.42,
                        },
                    },
                },
            }),
            encoding="utf-8",
        )
        presets, _ = merged_presets()
        ab = presets["Gentle"]["config"]["alpha_beta_generation"]
        self.assertEqual(ab["min_distance_from_center"], 0.42)
        # Algorithm field from the built-in should still be present
        self.assertIn("algorithm", ab)


if __name__ == "__main__":
    unittest.main()
