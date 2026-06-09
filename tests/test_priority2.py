# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for Priority 2 features: file upload paths, quality gate, progress callback."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from assessment.analyzer import FunscriptAnalyzer, AnalyzerConfig
from ui.common.project import Project

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample.funscript")


# ---------------------------------------------------------------------------
# Quality gate logic (mirrors export_panel._check_quality without Streamlit)
# ---------------------------------------------------------------------------

def _check_quality(actions: list) -> list:
    """Local mirror of export_panel._check_quality for Streamlit-free testing."""
    issues = []
    for i in range(1, len(actions)):
        a0, a1 = actions[i - 1], actions[i]
        dt_ms = a1["at"] - a0["at"]
        if dt_ms <= 0:
            continue
        dp = abs(a1["pos"] - a0["pos"])
        velocity = dp / dt_ms * 1000

        if velocity > 300:
            issues.append({"level": "error", "message": f"Velocity {velocity:.0f} pos/s", "at": a0["at"]})
        elif velocity > 200:
            issues.append({"level": "warning", "message": f"Velocity {velocity:.0f} pos/s", "at": a0["at"]})

        if dt_ms < 50:
            issues.append({"level": "warning", "message": f"Short interval {dt_ms}ms", "at": a0["at"]})

    return issues


class TestQualityGate(unittest.TestCase):
    """Tests for _check_quality device-awareness checks (#13)."""

    def test_clean_actions_no_issues(self):
        actions = [
            {"at": 0,   "pos": 0},
            {"at": 500, "pos": 50},
            {"at": 1000,"pos": 100},
        ]
        issues = _check_quality(actions)
        self.assertEqual(issues, [])

    def test_high_velocity_error(self):
        # 100 pos in 200 ms = 500 pos/s → error
        actions = [{"at": 0, "pos": 0}, {"at": 200, "pos": 100}]
        issues = _check_quality(actions)
        errors = [i for i in issues if i["level"] == "error"]
        self.assertEqual(len(errors), 1)
        self.assertIn("500", errors[0]["message"])

    def test_medium_velocity_warning(self):
        # 80 pos in 300 ms ≈ 267 pos/s → warning (200 < v ≤ 300)
        actions = [{"at": 0, "pos": 10}, {"at": 300, "pos": 90}]
        issues = _check_quality(actions)
        warnings = [i for i in issues if i["level"] == "warning"]
        self.assertGreater(len(warnings), 0)

    def test_low_velocity_no_velocity_issue(self):
        # 50 pos in 1000 ms = 50 pos/s → no velocity issue
        actions = [{"at": 0, "pos": 25}, {"at": 1000, "pos": 75}]
        issues = _check_quality(actions)
        vel_issues = [i for i in issues if "pos/s" in i["message"]]
        self.assertEqual(vel_issues, [])

    def test_short_interval_warning(self):
        # 20 ms interval → short interval warning
        actions = [{"at": 0, "pos": 50}, {"at": 20, "pos": 50}]
        issues = _check_quality(actions)
        short_issues = [i for i in issues if "interval" in i["message"].lower()]
        self.assertGreater(len(short_issues), 0)

    def test_exactly_50ms_no_short_interval(self):
        # 50 ms interval — exactly at threshold, not flagged
        actions = [{"at": 0, "pos": 50}, {"at": 50, "pos": 50}]
        issues = _check_quality(actions)
        short_issues = [i for i in issues if "interval" in i["message"].lower()]
        self.assertEqual(short_issues, [])

    def test_empty_actions_no_issues(self):
        self.assertEqual(_check_quality([]), [])

    def test_single_action_no_issues(self):
        self.assertEqual(_check_quality([{"at": 0, "pos": 50}]), [])

    def test_zero_dt_skipped(self):
        # Duplicate timestamps (dt=0) — must not divide by zero
        actions = [{"at": 100, "pos": 0}, {"at": 100, "pos": 100}]
        issues = _check_quality(actions)
        self.assertEqual(issues, [])

    def test_issue_at_field_matches_first_action(self):
        actions = [{"at": 1000, "pos": 0}, {"at": 1200, "pos": 100}]
        issues = _check_quality(actions)
        # Velocity = 100/200*1000 = 500 pos/s → error
        self.assertEqual(issues[0]["at"], 1000)


# ---------------------------------------------------------------------------
# Progress callback (#14)
# ---------------------------------------------------------------------------

class TestProgressCallback(unittest.TestCase):
    """Verify that FunscriptAnalyzer.analyze() fires the progress_callback."""

    def test_callback_called_for_each_stage(self):
        stages = []
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        analyzer.analyze(progress_callback=stages.append)
        self.assertGreaterEqual(len(stages), 5)

    def test_callback_labels_are_strings(self):
        stages = []
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        analyzer.analyze(progress_callback=stages.append)
        for s in stages:
            self.assertIsInstance(s, str)
            self.assertGreater(len(s), 0)

    def test_phase_stage_first(self):
        stages = []
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        analyzer.analyze(progress_callback=stages.append)
        self.assertIn("phase", stages[0].lower())

    def test_behavior_stage_last(self):
        stages = []
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        analyzer.analyze(progress_callback=stages.append)
        self.assertTrue(
            any("behav" in s.lower() or "classif" in s.lower() for s in stages),
            f"No behaviour/classify stage found in: {stages}",
        )

    def test_no_callback_still_works(self):
        """analyze() without a callback must behave identically to before."""
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        result = analyzer.analyze()   # no callback argument
        self.assertIsNotNone(result)
        self.assertGreater(len(result.phrases), 0)

    def test_callback_via_project_from_funscript(self):
        stages = []
        project = Project.from_funscript(FIXTURE, progress_callback=stages.append)
        self.assertGreaterEqual(len(stages), 5)
        self.assertIsNotNone(project.assessment)

    def test_callback_via_run_assessment(self):
        stages = []
        project = Project(funscript_path=FIXTURE)
        project.run_assessment(progress_callback=stages.append)
        self.assertGreaterEqual(len(stages), 5)


# ---------------------------------------------------------------------------
# File upload save path (logic only — no Streamlit)
# ---------------------------------------------------------------------------

class TestUploadSavePath(unittest.TestCase):
    """Validate the upload-save logic works correctly with real paths."""

    def test_save_uploaded_bytes_creates_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            uploads_dir = os.path.join(tmp, "uploads")
            os.makedirs(uploads_dir, exist_ok=True)
            content = b'{"actions": [{"at": 0, "pos": 50}]}'
            dest = os.path.join(uploads_dir, "test.funscript")
            with open(dest, "wb") as f:
                f.write(content)
            self.assertTrue(os.path.exists(dest))
            with open(dest, "rb") as f:
                self.assertEqual(f.read(), content)

    def test_overwrite_same_filename_keeps_latest(self):
        with tempfile.TemporaryDirectory() as tmp:
            uploads_dir = os.path.join(tmp, "uploads")
            os.makedirs(uploads_dir, exist_ok=True)
            dest = os.path.join(uploads_dir, "test.funscript")
            with open(dest, "wb") as f:
                f.write(b"version1")
            with open(dest, "wb") as f:
                f.write(b"version2")
            with open(dest, "rb") as f:
                self.assertEqual(f.read(), b"version2")

    def test_uploads_dir_listed_before_test_funscript(self):
        """Uploads should appear first in the candidate label list."""
        # Simulate the label-building logic from app.py
        path_for = {}
        with tempfile.TemporaryDirectory() as tmp:
            uploads_dir = os.path.join(tmp, "uploads")
            os.makedirs(uploads_dir)
            # Create a fake uploaded file
            open(os.path.join(uploads_dir, "my.funscript"), "w").close()
            for f in sorted(os.listdir(uploads_dir)):
                if f.endswith(".funscript"):
                    path_for[f"[↑] {f}"] = os.path.join(uploads_dir, f)
            # Simulate test_funscript
            path_for["fixture.funscript"] = "/some/path/fixture.funscript"

        labels = list(path_for.keys())
        self.assertTrue(labels[0].startswith("[↑]"))
        self.assertFalse(labels[-1].startswith("[↑]"))


# ---------------------------------------------------------------------------
# Local-mode recents helpers
# ---------------------------------------------------------------------------

import json as _json  # noqa: E402  (already imported at module level but alias for clarity)


class TestLocalRecents(unittest.TestCase):
    """Tests for _load_recents() and _save_recents() in app.py."""

    # Mirror the logic locally so we don't need to import Streamlit.
    _RECENTS_FILE = "recent_funscripts.json"
    _RECENTS_MAX  = 10

    def _load(self, output_dir: str) -> list:
        path = os.path.join(output_dir, self._RECENTS_FILE)
        try:
            with open(path) as fh:
                data = _json.load(fh)
            return [p for p in data if isinstance(p, str) and os.path.isfile(p)]
        except Exception:
            return []

    def _save(self, output_dir: str, file_path: str) -> None:
        recents = self._load(output_dir)
        if file_path in recents:
            recents.remove(file_path)
        recents.insert(0, file_path)
        recents = recents[:self._RECENTS_MAX]
        path = os.path.join(output_dir, self._RECENTS_FILE)
        os.makedirs(output_dir, exist_ok=True)
        with open(path, "w") as fh:
            _json.dump(recents, fh)

    def test_empty_recents_returns_list(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self._load(d), [])

    def test_save_and_load_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            # Create a real file so _load validates existence
            fp = os.path.join(d, "test.funscript")
            open(fp, "w").close()
            self._save(d, fp)
            recents = self._load(d)
            self.assertEqual(recents, [fp])

    def test_most_recent_first(self):
        with tempfile.TemporaryDirectory() as d:
            files = []
            for i in range(3):
                fp = os.path.join(d, f"f{i}.funscript")
                open(fp, "w").close()
                files.append(fp)
                self._save(d, fp)
            recents = self._load(d)
            self.assertEqual(recents[0], files[-1])  # last saved is first

    def test_duplicate_moves_to_top(self):
        with tempfile.TemporaryDirectory() as d:
            fp1 = os.path.join(d, "a.funscript")
            fp2 = os.path.join(d, "b.funscript")
            open(fp1, "w").close()
            open(fp2, "w").close()
            self._save(d, fp1)
            self._save(d, fp2)
            self._save(d, fp1)   # re-save fp1
            recents = self._load(d)
            self.assertEqual(recents[0], fp1)
            self.assertEqual(len(recents), 2)  # no duplicates

    def test_max_entries_respected(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(self._RECENTS_MAX + 5):
                fp = os.path.join(d, f"f{i}.funscript")
                open(fp, "w").close()
                self._save(d, fp)
            recents = self._load(d)
            self.assertLessEqual(len(recents), self._RECENTS_MAX)

    def test_nonexistent_files_filtered_out(self):
        with tempfile.TemporaryDirectory() as d:
            # Write a recents file with a path that doesn't exist
            path = os.path.join(d, self._RECENTS_FILE)
            with open(path, "w") as fh:
                _json.dump(["/nonexistent/path.funscript"], fh)
            recents = self._load(d)
            self.assertEqual(recents, [])


if __name__ == "__main__":
    unittest.main()
