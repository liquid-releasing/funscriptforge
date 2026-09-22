# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Tests for the assess fast-path — `cli._fresh_phrases_payload`.

Guards the "aggressive recalc" fix (D27a): re-entering the Phrases tab (or any
json-mode assess on an *unchanged* funscript) must reuse the on-disk
`<stem>.phrases.json` sidecar instead of re-running the full analyzer. Freshness
is mtime-based against the funscript and the chapters sidecar, with a schema
version gate — so a tone edit (funscript rewrite) or a chapter re-detect still
forces a real reassess.
"""

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import cli  # noqa: E402


def _forge_dir(funscript_path: str) -> Path:
    p = Path(funscript_path)
    return p.parent / f".{p.stem}.forge"


class TestFreshPhrasesPayload(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.fs = os.path.join(self.d, "scene.funscript")
        Path(self.fs).write_text('{"actions":[]}', encoding="utf-8")
        self.forge = _forge_dir(self.fs)
        self.forge.mkdir(parents=True, exist_ok=True)
        self.sidecar = self.forge / "scene.phrases.json"

    def _write_sidecar(self, version=cli._PHRASES_SIDECAR_VERSION):
        self.sidecar.write_text(json.dumps({
            "version": version, "kind": "phrase", "source_file": self.fs,
            "slices": [
                {"id": "ph_0", "at_ms": 0, "end_ms": 1000, "label": "steady",
                 "metrics": {"bpm": 120.0, "pattern_label": "steady",
                             "tags": ["drone"]}},
                {"id": "ph_1", "at_ms": 1000, "end_ms": 2000, "label": "pulse",
                 "metrics": {"bpm": 140.0, "pattern_label": "pulse",
                             "tags": ["stingy"]}},
            ],
        }), encoding="utf-8")

    def _make_newer(self, path, *, than):
        """Set *path*'s mtime safely after *than*'s, avoiding fs granularity."""
        base = os.stat(than).st_mtime
        os.utime(path, (base + 5, base + 5))

    def test_fresh_sidecar_returns_payload(self):
        self._write_sidecar()
        self._make_newer(self.sidecar, than=self.fs)
        out = cli._fresh_phrases_payload(self.fs)
        self.assertIsNotNone(out)
        self.assertEqual(len(out["phrases"]), 2)
        self.assertTrue(out["cached"])
        # Sidecar slice fields map onto the json_mode payload shape.
        p0, p1 = out["phrases"]
        self.assertEqual(p0["at_ms"], 0)
        self.assertEqual(p0["tag"], "drone")
        self.assertEqual(p0["all_tags"], ["drone"])
        self.assertEqual(p0["number"], 1)
        self.assertEqual(p1["bpm"], 140.0)
        self.assertEqual(p1["pattern_label"], "pulse")

    def test_funscript_newer_is_stale(self):
        self._write_sidecar()
        self._make_newer(self.fs, than=self.sidecar)
        self.assertIsNone(cli._fresh_phrases_payload(self.fs))

    def test_chapters_newer_is_stale(self):
        self._write_sidecar()
        self._make_newer(self.sidecar, than=self.fs)
        chapters = self.forge / "scene.chapters.json"
        chapters.write_text("{}", encoding="utf-8")
        self._make_newer(chapters, than=self.sidecar)
        self.assertIsNone(cli._fresh_phrases_payload(self.fs))

    def test_wrong_version_is_stale(self):
        self._write_sidecar(version=cli._PHRASES_SIDECAR_VERSION + 999)
        self._make_newer(self.sidecar, than=self.fs)
        self.assertIsNone(cli._fresh_phrases_payload(self.fs))

    def test_missing_sidecar_is_none(self):
        self.assertIsNone(cli._fresh_phrases_payload(self.fs))


if __name__ == "__main__":
    unittest.main()
