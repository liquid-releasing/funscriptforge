# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Loader error-handling tests (bug D34).

``load_funscript`` swallows every failure into ``None``. That suits callers
which treat "absent" as ordinary, but commands used to pass the ``None``
straight into ``parse_actions``, so a missing or corrupt file surfaced as
``AttributeError: 'NoneType' object has no attribute 'get'`` — a stack trace
naming no file and offering the user nothing to act on.

These lock the strict loader and the clean one-line CLI errors it enables,
without disturbing the lenient loader that other callers still rely on.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from forge.funscript import load_funscript, load_funscript_strict, parse_actions

CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")
PYTHON = sys.executable


class TestLenientLoaderUnchanged(unittest.TestCase):
    """The permissive loader keeps its contract — callers depend on None."""

    def test_missing_file_still_returns_none(self):
        self.assertIsNone(load_funscript(os.path.join(tempfile.gettempdir(), "nope.funscript")))

    def test_valid_file_loads(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.funscript")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"actions": [{"at": 0, "pos": 10}]}, f)
            self.assertEqual(load_funscript(p)["actions"][0]["pos"], 10)


class TestStrictLoader(unittest.TestCase):

    def test_valid_file_returns_the_document(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.funscript")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"actions": [{"at": 5, "pos": 20}]}, f)
            times, pos = parse_actions(load_funscript_strict(p))
            self.assertEqual((times, pos), ([5], [20]))

    def test_missing_file_names_the_path(self):
        missing = os.path.join(tempfile.gettempdir(), "definitely_absent.funscript")
        with self.assertRaises(FileNotFoundError) as ctx:
            load_funscript_strict(missing)
        self.assertIn("definitely_absent.funscript", str(ctx.exception))

    def test_directory_is_rejected_clearly(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError) as ctx:
                load_funscript_strict(d)
            self.assertIn("directory", str(ctx.exception).lower())

    def test_invalid_json_names_the_path(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "bad.funscript")
            with open(p, "w", encoding="utf-8") as f:
                f.write("not json at all")
            with self.assertRaises(ValueError) as ctx:
                load_funscript_strict(p)
            msg = str(ctx.exception)
            self.assertIn("bad.funscript", msg)
            self.assertIn("valid JSON", msg)

    def test_non_object_json_is_rejected(self):
        """A bare array is a common near-miss — it has no 'actions' key."""
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "arr.funscript")
            with open(p, "w", encoding="utf-8") as f:
                json.dump([{"at": 0, "pos": 0}], f)
            with self.assertRaises(ValueError) as ctx:
                load_funscript_strict(p)
            self.assertIn("actions", str(ctx.exception))

    def test_never_returns_none(self):
        """The whole point: no caller can inherit a None to crash on later."""
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.funscript")
            with open(p, "w", encoding="utf-8") as f:
                json.dump({"actions": []}, f)
            self.assertIsNotNone(load_funscript_strict(p))


class TestCliSurfacesActionableErrors(unittest.TestCase):
    """End-to-end: the message reaches the user as one line, not a traceback."""

    def _run(self, *args):
        return subprocess.run(
            [PYTHON, CLI, *args], capture_output=True, text=True,
        )

    def test_stim_process_missing_funscript(self):
        missing = os.path.join(tempfile.gettempdir(), "absent_stim.funscript")
        r = self._run("stim-process", missing, "--character", "Reactive", "--mode", "2d")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Error:", r.stderr)
        self.assertIn("absent_stim.funscript", r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        self.assertNotIn("NoneType", r.stderr)

    def test_multiaxis_process_missing_funscript(self):
        missing = os.path.join(tempfile.gettempdir(), "absent_multi.funscript")
        r = self._run("multiaxis-process", missing, "--style", "Cowgirl")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Error:", r.stderr)
        self.assertIn("absent_multi.funscript", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
