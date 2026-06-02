# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""CLI tests — invoke each subcommand via subprocess and verify outputs.

Tests run the real CLI entry point so they cover argument parsing,
dispatch, and file I/O without mocking internals.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample.funscript")
CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")
PYTHON = sys.executable


def run(*args, cwd=None):
    """Run cli.py with *args and return (returncode, stdout, stderr)."""
    result = subprocess.run(
        [PYTHON, CLI, *args],
        capture_output=True,
        text=True,
        cwd=cwd or os.path.dirname(CLI),
    )
    return result.returncode, result.stdout, result.stderr


class TestCliAssess(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_assess_exits_zero(self):
        rc, _, _ = run("assess", FIXTURE, "--output", os.path.join(self.tmp, "a.json"))
        self.assertEqual(rc, 0)

    def test_assess_writes_json(self):
        out = os.path.join(self.tmp, "assessment.json")
        run("assess", FIXTURE, "--output", out)
        self.assertTrue(os.path.exists(out))
        with open(out) as f:
            data = json.load(f)
        self.assertIn("phrases", data)
        self.assertIn("meta", data)

    def test_assess_default_output_path(self):
        import shutil
        fixture_copy = os.path.join(self.tmp, "sample.funscript")
        shutil.copy(FIXTURE, fixture_copy)
        rc, _, _ = run("assess", fixture_copy)
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "sample_assessment.json")))

    def test_assess_prints_summary(self):
        out = os.path.join(self.tmp, "a.json")
        _, stdout, _ = run("assess", FIXTURE, "--output", out)
        self.assertIn("BPM", stdout)
        self.assertIn("Phrases", stdout)

    def test_assess_with_analyzer_config(self):
        cfg_path = os.path.join(self.tmp, "analyzer_config.json")
        run("config", "--analyzer", "--output", cfg_path)
        out = os.path.join(self.tmp, "a.json")
        rc, _, _ = run("assess", FIXTURE, "--output", out, "--config", cfg_path)
        self.assertEqual(rc, 0)


class TestCliTransform(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.assessment = os.path.join(self.tmp, "assessment.json")
        run("assess", FIXTURE, "--output", self.assessment)

    def test_transform_exits_zero(self):
        rc, _, _ = run(
            "transform", FIXTURE,
            "--assessment", self.assessment,
            "--output", os.path.join(self.tmp, "t.funscript"),
        )
        self.assertEqual(rc, 0)

    def test_transform_writes_valid_funscript(self):
        out = os.path.join(self.tmp, "transformed.funscript")
        run("transform", FIXTURE, "--assessment", self.assessment, "--output", out)
        self.assertTrue(os.path.exists(out))
        with open(out) as f:
            data = json.load(f)
        self.assertIn("actions", data)
        for a in data["actions"]:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_transform_with_config(self):
        cfg = os.path.join(self.tmp, "tc.json")
        run("config", "--output", cfg)
        out = os.path.join(self.tmp, "t.funscript")
        rc, _, _ = run(
            "transform", FIXTURE,
            "--assessment", self.assessment,
            "--output", out,
            "--config", cfg,
        )
        self.assertEqual(rc, 0)


class TestCliCustomize(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.assessment = os.path.join(self.tmp, "assessment.json")
        run("assess", FIXTURE, "--output", self.assessment)
        self.transformed = os.path.join(self.tmp, "transformed.funscript")
        run("transform", FIXTURE, "--assessment", self.assessment,
            "--output", self.transformed)

    def test_customize_exits_zero(self):
        out = os.path.join(self.tmp, "customized.funscript")
        rc, _, _ = run(
            "customize", self.transformed,
            "--assessment", self.assessment,
            "--output", out,
        )
        self.assertEqual(rc, 0)

    def test_customize_writes_valid_funscript(self):
        out = os.path.join(self.tmp, "customized.funscript")
        run("customize", self.transformed, "--assessment", self.assessment, "--output", out)
        self.assertTrue(os.path.exists(out))
        with open(out) as f:
            data = json.load(f)
        for a in data["actions"]:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_customize_with_perf_window(self):
        perf = os.path.join(self.tmp, "perf.json")
        with open(perf, "w") as f:
            json.dump([{"start": "00:00:00.000", "end": "00:00:04.000"}], f)
        out = os.path.join(self.tmp, "customized.funscript")
        rc, _, _ = run(
            "customize", self.transformed,
            "--assessment", self.assessment,
            "--output", out,
            "--perf", perf,
        )
        self.assertEqual(rc, 0)

    def test_customize_missing_window_files_ok(self):
        """Customizer treats missing optional window files as empty — should not error."""
        out = os.path.join(self.tmp, "customized.funscript")
        rc, _, stderr = run(
            "customize", self.transformed,
            "--assessment", self.assessment,
            "--output", out,
            "--perf", os.path.join(self.tmp, "nonexistent.json"),
        )
        self.assertEqual(rc, 0)


class TestCliPipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_pipeline_exits_zero(self):
        rc, _, _ = run("pipeline", FIXTURE, "--output-dir", self.tmp)
        self.assertEqual(rc, 0)

    def test_pipeline_writes_all_three_outputs(self):
        run("pipeline", FIXTURE, "--output-dir", self.tmp)
        base = "sample"
        self.assertTrue(os.path.exists(os.path.join(self.tmp, f"{base}.assessment.json")))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, f"{base}.transformed.funscript")))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, f"{base}.customized.funscript")))

    def test_pipeline_output_positions_in_range(self):
        run("pipeline", FIXTURE, "--output-dir", self.tmp)
        customized = os.path.join(self.tmp, "sample.customized.funscript")
        with open(customized) as f:
            data = json.load(f)
        for a in data["actions"]:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_pipeline_with_perf_window(self):
        perf = os.path.join(self.tmp, "perf.json")
        with open(perf, "w") as f:
            json.dump([{"start": "00:00:00.000", "end": "00:00:04.000"}], f)
        rc, _, _ = run("pipeline", FIXTURE, "--output-dir", self.tmp, "--perf", perf)
        self.assertEqual(rc, 0)

    def test_pipeline_prints_stage_summaries(self):
        _, stdout, _ = run("pipeline", FIXTURE, "--output-dir", self.tmp)
        self.assertIn("Assessment saved", stdout)
        self.assertIn("Transformed", stdout)
        self.assertIn("Customized", stdout)


class TestCliConfig(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_config_transformer_default(self):
        out = os.path.join(self.tmp, "tc.json")
        rc, _, _ = run("config", "--output", out)
        self.assertEqual(rc, 0)
        with open(out) as f:
            d = json.load(f)
        self.assertIn("bpm_threshold", d)
        self.assertIn("amplitude_scale", d)

    def test_config_customizer(self):
        out = os.path.join(self.tmp, "cc.json")
        rc, _, _ = run("config", "--customizer", "--output", out)
        self.assertEqual(rc, 0)
        with open(out) as f:
            d = json.load(f)
        self.assertIn("max_velocity", d)
        self.assertIn("break_amplitude_reduce", d)

    def test_config_analyzer(self):
        out = os.path.join(self.tmp, "ac.json")
        rc, _, _ = run("config", "--analyzer", "--output", out)
        self.assertEqual(rc, 0)
        with open(out) as f:
            d = json.load(f)
        self.assertIn("min_velocity", d)
        self.assertIn("bpm_change_threshold_pct", d)

    def test_config_round_trip_transformer(self):
        """Config written by CLI can be loaded back and used in transform."""
        cfg = os.path.join(self.tmp, "tc.json")
        run("config", "--output", cfg)
        assessment = os.path.join(self.tmp, "a.json")
        run("assess", FIXTURE, "--output", assessment)
        out = os.path.join(self.tmp, "t.funscript")
        rc, _, _ = run(
            "transform", FIXTURE,
            "--assessment", assessment,
            "--output", out,
            "--config", cfg,
        )
        self.assertEqual(rc, 0)


class TestCliExportPlan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.assessment = os.path.join(self.tmp, "assessment.json")
        run("assess", FIXTURE, "--output", self.assessment)

    def test_exits_zero(self):
        rc, _, _ = run("export-plan", FIXTURE, "--assessment", self.assessment)
        self.assertEqual(rc, 0)

    def test_prints_table_header(self):
        _, stdout, _ = run("export-plan", FIXTURE, "--assessment", self.assessment)
        self.assertIn("Transform", stdout)
        self.assertIn("Source", stdout)
        self.assertIn("BPM", stdout)

    def test_no_recommended_shows_zero_transforms(self):
        _, stdout, _ = run(
            "export-plan", FIXTURE, "--assessment", self.assessment, "--no-recommended"
        )
        self.assertIn("0 transform", stdout)

    def test_json_format_is_valid(self):
        rc, stdout, _ = run(
            "export-plan", FIXTURE, "--assessment", self.assessment, "--format", "json"
        )
        self.assertEqual(rc, 0)
        data = json.loads(stdout)
        self.assertIsInstance(data, list)
        if data:
            self.assertIn("phrase", data[0])
            self.assertIn("transform", data[0])
            self.assertIn("bpm", data[0])

    def test_transforms_file_override(self):
        overrides = os.path.join(self.tmp, "overrides.json")
        with open(overrides, "w") as f:
            json.dump({"1": {"transform": "normalize"}}, f)
        _, stdout, _ = run(
            "export-plan", FIXTURE, "--assessment", self.assessment,
            "--no-recommended", "--transforms", overrides,
        )
        self.assertIn("Normalize", stdout)
        self.assertIn("Manual", stdout)

    def test_apply_writes_funscript(self):
        out = os.path.join(self.tmp, "export.funscript")
        rc, _, _ = run(
            "export-plan", FIXTURE, "--assessment", self.assessment,
            "--apply", "--output", out,
        )
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(out))
        with open(out) as f:
            data = json.load(f)
        self.assertIn("actions", data)
        for a in data["actions"]:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_dry_run_writes_no_file(self):
        out = os.path.join(self.tmp, "should_not_exist.funscript")
        rc, stdout, _ = run(
            "export-plan", FIXTURE, "--assessment", self.assessment,
            "--dry-run", "--output", out,
        )
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(out))
        self.assertIn("dry-run", stdout)


class TestCliFinalize(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # Provide a transformed funscript to finalize
        self.assessment = os.path.join(self.tmp, "a.json")
        self.transformed = os.path.join(self.tmp, "t.funscript")
        run("assess", FIXTURE, "--output", self.assessment)
        run("transform", FIXTURE, "--assessment", self.assessment,
            "--output", self.transformed)

    def test_finalize_exits_zero(self):
        out = os.path.join(self.tmp, "fin.funscript")
        rc, _, _ = run("finalize", self.transformed, "--output", out)
        self.assertEqual(rc, 0)

    def test_finalize_writes_valid_funscript(self):
        out = os.path.join(self.tmp, "fin.funscript")
        run("finalize", self.transformed, "--output", out)
        self.assertTrue(os.path.exists(out))
        with open(out) as f:
            data = json.load(f)
        self.assertIn("actions", data)
        for a in data["actions"]:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)

    def test_finalize_default_output_path(self):
        import shutil
        src = os.path.join(self.tmp, "myscore.funscript")
        shutil.copy(self.transformed, src)
        rc, _, _ = run("finalize", src)
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(
            os.path.join(self.tmp, "myscore_finalized.funscript")
        ))

    def test_finalize_skip_seams(self):
        out = os.path.join(self.tmp, "fin.funscript")
        rc, stdout, _ = run("finalize", self.transformed, "--output", out, "--skip-seams")
        self.assertEqual(rc, 0)
        self.assertNotIn("blend_seams", stdout)

    def test_finalize_skip_smooth(self):
        out = os.path.join(self.tmp, "fin.funscript")
        rc, stdout, _ = run("finalize", self.transformed, "--output", out, "--skip-smooth")
        self.assertEqual(rc, 0)
        self.assertNotIn("final_smooth", stdout)

    def test_finalize_skip_both_still_writes(self):
        """Skipping both passes still produces an output file (passthrough)."""
        out = os.path.join(self.tmp, "fin.funscript")
        rc, _, _ = run("finalize", self.transformed, "--output", out,
                       "--skip-seams", "--skip-smooth")
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(out))


class TestCliListTransforms(unittest.TestCase):
    def test_exits_zero(self):
        rc, _, _ = run("list-transforms")
        self.assertEqual(rc, 0)

    def test_builtin_keys_present(self):
        _, stdout, _ = run("list-transforms")
        for key in ("amplitude_scale", "normalize", "smooth", "halve_tempo", "blend_seams"):
            self.assertIn(key, stdout)

    def test_user_only_empty_by_default(self):
        """No user transforms ship in the default scan path now — the example
        recipes moved to user_transforms/examples/ (kept as seeds for the
        future custom-behavior builder, but out of the shipped picker)."""
        _, stdout, _ = run("list-transforms", "--user-only")
        self.assertNotIn("example_center_lift", stdout)
        self.assertNotIn("amplitude_scale", stdout)

    def test_example_recipes_still_load_from_examples_dir(self):
        """The moved examples still parse + load (loader coverage)."""
        from pattern_catalog.phrase_transforms import load_user_transforms
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ex_dir = os.path.join(root, "user_transforms", "examples")
        loaded = load_user_transforms(recipes_dir=ex_dir, plugins_dir=ex_dir)
        self.assertIn("example_center_lift", loaded)
        self.assertIn("example_tame_frantic", loaded)

    def test_user_only_empty_when_no_user_transforms(self):
        """--user-only in a temp dir with no user_transforms/ or plugins/ prints nothing."""
        import tempfile, shutil
        # Run with a cwd that has no user_transforms or plugins dirs
        tmp = tempfile.mkdtemp()
        rc, stdout, _ = run("list-transforms", "--user-only", cwd=tmp)
        shutil.rmtree(tmp)
        self.assertEqual(rc, 0)
        # output may be "No transforms found." or empty
        self.assertNotIn("amplitude_scale", stdout)

    def test_verbose_shows_param_details(self):
        _, stdout, _ = run("list-transforms", "--verbose")
        self.assertIn("--param", stdout)

    def test_format_json_valid(self):
        _, stdout, _ = run("list-transforms", "--format", "json")
        data = json.loads(stdout)
        self.assertIn("amplitude_scale", data)
        self.assertIn("name", data["amplitude_scale"])
        self.assertIn("source", data["amplitude_scale"])

    def test_format_json_user_source_tag(self):
        _, stdout, _ = run("list-transforms", "--format", "json")
        data = json.loads(stdout)
        self.assertEqual(data["amplitude_scale"]["source"], "builtin")
        # No user-source transforms ship by default (examples moved out).
        self.assertNotIn("example_center_lift", data)

    def test_format_json_verbose_includes_params(self):
        _, stdout, _ = run("list-transforms", "--format", "json", "--verbose")
        data = json.loads(stdout)
        self.assertIn("params", data["amplitude_scale"])
        self.assertIn("scale", data["amplitude_scale"]["params"])


class TestCliProject(unittest.TestCase):
    """Tests for `cli.py project` — get/set name and description."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # Create a minimal .project.json with no custom metadata.
        self.project_file = os.path.join(self.tmp, "test.project.json")
        data = {
            "funscript_path": FIXTURE,
            "custom_name": "",
            "description": "",
            "work_items": [],
        }
        with open(self.project_file, "w") as f:
            json.dump(data, f)

    def test_get_name_returns_filename_when_no_custom(self):
        rc, stdout, _ = run("project", self.project_file, "get-name")
        self.assertEqual(rc, 0)
        self.assertIn("sample", stdout)

    def test_set_name_persists(self):
        rc, _, _ = run("project", self.project_file, "set-name", "My Project")
        self.assertEqual(rc, 0)
        with open(self.project_file) as f:
            data = json.load(f)
        self.assertEqual(data["custom_name"], "My Project")

    def test_get_name_after_set(self):
        run("project", self.project_file, "set-name", "Renamed")
        rc, stdout, _ = run("project", self.project_file, "get-name")
        self.assertEqual(rc, 0)
        self.assertIn("Renamed", stdout)

    def test_set_desc_persists(self):
        rc, _, _ = run("project", self.project_file, "set-desc", "A test description.")
        self.assertEqual(rc, 0)
        with open(self.project_file) as f:
            data = json.load(f)
        self.assertEqual(data["description"], "A test description.")

    def test_get_desc_after_set(self):
        run("project", self.project_file, "set-desc", "Hello desc.")
        rc, stdout, _ = run("project", self.project_file, "get-desc")
        self.assertEqual(rc, 0)
        self.assertIn("Hello desc.", stdout)

    def test_missing_file_exits_nonzero(self):
        rc, _, _ = run("project", "/nonexistent/path.project.json", "get-name")
        self.assertNotEqual(rc, 0)


class TestClassifierTags(unittest.TestCase):
    """Tests for the new ramp and ambient behavioral tags in classifier.py."""

    def setUp(self):
        from assessment.classifier import compute_phrase_metrics, classify_phrase
        self.compute = compute_phrase_metrics
        self.classify = classify_phrase

    def _make_phrase(self, start_ms=0, end_ms=10_000, bpm=120.0, tags=None):
        return {"start_ms": start_ms, "end_ms": end_ms, "bpm": bpm, "tags": tags or []}

    def _make_actions(self, positions):
        """Build equally-spaced actions from a list of positions."""
        step = 200
        return [{"at": i * step, "pos": p} for i, p in enumerate(positions)]

    def test_ramp_tag_detected_when_center_shifts(self):
        """Phrase where mean_pos rises from ~30 to ~70 should get 'ramp' tag."""
        # First half: low strokes (0-60 range, center ~30)
        # Second half: high strokes (40-100 range, center ~70)
        actions = (
            [{"at": i * 100, "pos": 0 if i % 2 == 0 else 60} for i in range(20)]
            + [{"at": 2000 + i * 100, "pos": 40 if i % 2 == 0 else 100} for i in range(20)]
        )
        phrase = {"start_ms": 0, "end_ms": 3900, "bpm": 120.0}
        metrics = self.compute(phrase, actions)
        tags = self.classify(phrase, metrics)
        self.assertIn("ramp", tags)
        self.assertIn("ramp_delta", metrics)
        self.assertGreater(metrics["ramp_delta"], 0)  # positive = ramp up

    def test_ambient_tag_detected_for_slow_shallow(self):
        """Phrase with very low BPM and shallow amplitude should get 'ambient' tag."""
        actions = [{"at": i * 2000, "pos": 45 if i % 2 == 0 else 55} for i in range(10)]
        phrase = {"start_ms": 0, "end_ms": 18_000, "bpm": 20.0}
        metrics = self.compute(phrase, actions)
        tags = self.classify(phrase, metrics)
        self.assertIn("ambient", tags)

    def test_no_ramp_for_stable_phrase(self):
        """Uniformly alternating phrase should not get 'ramp' tag."""
        actions = [{"at": i * 250, "pos": 0 if i % 2 == 0 else 100} for i in range(20)]
        phrase = {"start_ms": 0, "end_ms": 4750, "bpm": 120.0}
        metrics = self.compute(phrase, actions)
        tags = self.classify(phrase, metrics)
        self.assertNotIn("ramp", tags)


class TestFunnelTransform(unittest.TestCase):
    """Tests for the Funnel transform in phrase_transforms.py."""

    def setUp(self):
        from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG
        self.spec = TRANSFORM_CATALOG["funnel"]

    def _make_actions(self, n=20, step_ms=200):
        """Simple alternating 0-100 phrase."""
        return [{"at": i * step_ms, "pos": 0 if i % 2 == 0 else 100} for i in range(n)]

    def test_funnel_in_catalog(self):
        from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG, TRANSFORM_ORDER
        self.assertIn("funnel", TRANSFORM_CATALOG)
        self.assertIn("funnel", TRANSFORM_ORDER)

    def test_funnel_ramp_up_expands_amplitude(self):
        """Start amplitude should be smaller than end amplitude for ramp-up."""
        actions = self._make_actions()
        result = self.spec.apply(actions, {"start_center": 30, "end_center": 70,
                                           "start_scale": 0.2, "end_scale": 1.0})
        start_span = abs(result[1]["pos"] - result[0]["pos"])
        end_span   = abs(result[-1]["pos"] - result[-2]["pos"])
        self.assertLess(start_span, end_span)

    def test_funnel_ramp_down_compresses_amplitude(self):
        """Start amplitude should be larger than end amplitude for ramp-down."""
        actions = self._make_actions()
        result = self.spec.apply(actions, {"start_center": 70, "end_center": 30,
                                           "start_scale": 1.0, "end_scale": 0.2})
        start_span = abs(result[1]["pos"] - result[0]["pos"])
        end_span   = abs(result[-1]["pos"] - result[-2]["pos"])
        self.assertGreater(start_span, end_span)

    def test_funnel_preserves_action_count(self):
        """Funnel is not structural; action count should be unchanged."""
        actions = self._make_actions()
        result = self.spec.apply(actions, {"start_center": 30, "end_center": 70,
                                           "start_scale": 0.2, "end_scale": 1.0})
        self.assertEqual(len(result), len(actions))

    def test_funnel_clamps_positions(self):
        """All output positions should be in [0, 100]."""
        actions = self._make_actions()
        result = self.spec.apply(actions, {"start_center": 0, "end_center": 100,
                                           "start_scale": 0.0, "end_scale": 3.0})
        for a in result:
            self.assertGreaterEqual(a["pos"], 0)
            self.assertLessEqual(a["pos"], 100)


class TestCliAudioPeaks(unittest.TestCase):
    """The audio-peaks subcommand round-trips through the
    ``forge.audio_peaks`` shim into ``videoflow.audio_peaks``. If the
    shim drops any of the legacy names (decode_audio / compute_peaks /
    load_peaks / write_sidecar / sidecar_path) the command breaks, so
    this test guards the shim contract.

    Audio is synthesised on the fly (~1s sine) so the test stays fast
    and doesn't need a bundled binary fixture.
    """

    @classmethod
    def setUpClass(cls):
        # Skip the whole class if soundfile isn't available — same posture
        # as the videoflow structural tests.
        try:
            import soundfile as _sf  # noqa: F401
            import numpy as _np  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("soundfile / numpy required for audio CLI tests")

    def setUp(self):
        import numpy as np
        import soundfile as sf

        self.tmp = tempfile.mkdtemp()
        sr = 22050
        t = np.arange(sr) / sr
        y = (0.5 * np.sin(2.0 * np.pi * 440 * t)).astype(np.float32)
        self.wav_path = os.path.join(self.tmp, "tone.wav")
        sf.write(self.wav_path, y, sr, subtype="FLOAT")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_audio_peaks_json_stdout_shape(self):
        # --no-write keeps the test cwd clean of sidecars; --format json
        # emits the full dict to stdout so the Tauri bridge can consume
        # it without a second file read.
        rc, stdout, stderr = run(
            "audio-peaks", self.wav_path,
            "--no-write", "--format", "json",
        )
        self.assertEqual(rc, 0, f"stderr: {stderr}")
        data = json.loads(stdout)
        self.assertEqual(data["version"], "1.0")
        self.assertEqual(data["hop_ms"], 10)
        self.assertGreater(data["peak_count"], 0)
        self.assertEqual(len(data["peaks"]), data["peak_count"])
        self.assertFalse(data["from_sidecar"])

    def test_audio_peaks_writes_sidecar(self):
        rc, _, stderr = run("audio-peaks", self.wav_path)
        self.assertEqual(rc, 0, f"stderr: {stderr}")
        sidecar = self.wav_path.replace(".wav", ".audio.json")
        self.assertTrue(os.path.exists(sidecar))
        with open(sidecar) as f:
            data = json.load(f)
        self.assertEqual(data["version"], "1.0")
        self.assertGreater(data["peak_count"], 0)

    def test_audio_peaks_cached_sidecar_reused(self):
        # First run writes the sidecar; second run should report
        # from_sidecar=True (= no decode).
        run("audio-peaks", self.wav_path)
        rc, stdout, _ = run(
            "audio-peaks", self.wav_path, "--format", "json",
        )
        self.assertEqual(rc, 0)
        data = json.loads(stdout)
        self.assertTrue(data["from_sidecar"])

    def test_audio_peaks_force_recomputes(self):
        run("audio-peaks", self.wav_path)
        rc, stdout, _ = run(
            "audio-peaks", self.wav_path, "--force", "--format", "json",
        )
        self.assertEqual(rc, 0)
        data = json.loads(stdout)
        self.assertFalse(data["from_sidecar"])

    def test_audio_peaks_shim_re_exports_match(self):
        """Direct symbol check — if the shim drops names, the CLI breaks
        even if the subprocess paths above pass for some other reason."""
        from forge.audio_peaks import (
            decode_audio, compute_peaks, load_peaks,
            write_sidecar, sidecar_path,
        )
        self.assertTrue(callable(decode_audio))
        self.assertTrue(callable(compute_peaks))
        self.assertTrue(callable(load_peaks))
        self.assertTrue(callable(write_sidecar))
        self.assertTrue(callable(sidecar_path))


if __name__ == "__main__":
    unittest.main()
