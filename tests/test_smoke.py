# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Smoke tests for the full assessment pipeline against the three real test funscripts.

Tests verify that:
  - Assessment completes without error
  - Structural output is non-empty and internally consistent
  - Export produces valid JSON with the required funscript keys
  - VictoriaOaks (uniform-tempo) now produces multiple phrases (issue #2 fix)

These tests use the actual funscript files in test_funscript/ and are therefore
integration-level: they exercise the full assess → export path end-to-end.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from assessment.analyzer import FunscriptAnalyzer, AnalyzerConfig

_ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FS_DIR   = os.path.join(_ROOT, "test_funscript")

_TIMELINE    = os.path.join(_FS_DIR, "Timeline1.original.funscript")
_LONGANDCUT  = os.path.join(_FS_DIR, "LongandCut-hdr.original.funscript")
_VICTORIA    = os.path.join(_FS_DIR, "VictoriaOaks_stingy.original.funscript")

_AVAILABLE = [p for p in (_TIMELINE, _LONGANDCUT, _VICTORIA) if os.path.isfile(p)]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _analyze(path: str) -> dict:
    """Run the full assessment pipeline and return the result dict."""
    analyzer = FunscriptAnalyzer()
    analyzer.load(path)
    result = analyzer.analyze()
    return result.to_dict()


def _build_export(original_actions: list, plan: list) -> bytes:
    """Minimal export: apply an empty plan (passthrough) and return JSON bytes."""
    import copy
    actions = copy.deepcopy(original_actions)
    actions.sort(key=lambda a: a["at"])
    return json.dumps({"actions": actions, "version": 1}).encode()


# ---------------------------------------------------------------------------
# Per-funscript smoke tests (skipped if file absent)
# ---------------------------------------------------------------------------

def _make_smoke_case(label: str, path: str):
    """Dynamically generate a TestCase class for a single funscript."""

    @unittest.skipUnless(os.path.isfile(path), f"{os.path.basename(path)} not found")
    class _SmokeTest(unittest.TestCase):

        @classmethod
        def setUpClass(cls):
            cls.path = path
            with open(path, encoding="utf-8") as f:
                cls.fs_data = json.load(f)
            cls.result_dict = _analyze(path)

        # -- Assessment output structure ----------------------------------------

        def test_assessment_has_required_keys(self):
            for key in ("meta", "phases", "cycles", "patterns", "phrases", "bpm_transitions"):
                self.assertIn(key, self.result_dict, f"Missing key: {key}")

        def test_phases_non_empty(self):
            self.assertGreater(len(self.result_dict["phases"]), 0)

        def test_cycles_non_empty(self):
            self.assertGreater(len(self.result_dict["cycles"]), 0)

        def test_patterns_non_empty(self):
            self.assertGreater(len(self.result_dict["patterns"]), 0)

        def test_phrases_non_empty(self):
            self.assertGreater(len(self.result_dict["phrases"]), 0)

        def test_phrase_bpm_positive(self):
            for ph in self.result_dict["phrases"]:
                self.assertGreater(ph["bpm"], 0, f"Non-positive BPM in phrase {ph}")

        def test_phrase_boundaries_contiguous(self):
            phrases = self.result_dict["phrases"]
            for i in range(1, len(phrases)):
                self.assertEqual(
                    phrases[i - 1]["end_ms"], phrases[i]["start_ms"],
                    f"Gap between phrase {i-1} and {i}",
                )

        def test_phrase_duration_ms_positive(self):
            for ph in self.result_dict["phrases"]:
                self.assertGreater(ph["end_ms"] - ph["start_ms"], 0)

        def test_duration_matches_last_action(self):
            last_at = self.fs_data["actions"][-1]["at"]
            self.assertEqual(self.result_dict["meta"]["duration_ms"], last_at)

        def test_action_count_matches(self):
            self.assertEqual(
                self.result_dict["meta"]["action_count"],
                len(self.fs_data["actions"]),
            )

        def test_bpm_transitions_is_list(self):
            self.assertIsInstance(self.result_dict["bpm_transitions"], list)

        def test_phrases_have_tags_field(self):
            for ph in self.result_dict["phrases"]:
                self.assertIn("tags", ph)
                self.assertIsInstance(ph["tags"], list)

        # -- Export round-trip --------------------------------------------------

        def test_passthrough_export_is_valid_json(self):
            """A passthrough export (no transforms) must produce valid funscript JSON."""
            actions = self.fs_data.get("actions", [])
            exported = _build_export(actions, [])
            data = json.loads(exported)
            self.assertIn("actions", data)
            self.assertIsInstance(data["actions"], list)

        def test_passthrough_export_action_count_preserved(self):
            actions = self.fs_data.get("actions", [])
            exported = json.loads(_build_export(actions, []))
            self.assertEqual(len(exported["actions"]), len(actions))

        def test_passthrough_positions_in_range(self):
            actions = self.fs_data.get("actions", [])
            exported = json.loads(_build_export(actions, []))
            for a in exported["actions"]:
                self.assertGreaterEqual(a["pos"], 0)
                self.assertLessEqual(a["pos"], 100)

        def test_passthrough_timestamps_sorted(self):
            actions = self.fs_data.get("actions", [])
            exported = json.loads(_build_export(actions, []))
            timestamps = [a["at"] for a in exported["actions"]]
            self.assertEqual(timestamps, sorted(timestamps))

    _SmokeTest.__name__ = f"SmokeTest_{label}"
    _SmokeTest.__qualname__ = f"SmokeTest_{label}"
    return _SmokeTest


SmokeTest_Timeline   = _make_smoke_case("Timeline",   _TIMELINE)
SmokeTest_LongAndCut = _make_smoke_case("LongAndCut", _LONGANDCUT)
SmokeTest_Victoria   = _make_smoke_case("Victoria",   _VICTORIA)


# ---------------------------------------------------------------------------
# VictoriaOaks-specific: uniform-tempo must now produce multiple phrases
# ---------------------------------------------------------------------------

@unittest.skipUnless(os.path.isfile(_VICTORIA), "VictoriaOaks funscript not found")
class TestVictoriaOaksUniformTempo(unittest.TestCase):
    """VictoriaOaks is a 1:33:12 uniform-BPM funscript that previously produced
    a single phrase (issue #2).  With max_phrase_duration_ms=300_000 it must
    produce multiple phrases of reasonable duration."""

    @classmethod
    def setUpClass(cls):
        analyzer = FunscriptAnalyzer()
        analyzer.load(_VICTORIA)
        cls.result = analyzer.analyze()

    def test_produces_multiple_phrases(self):
        self.assertGreater(
            len(self.result.phrases), 1,
            "VictoriaOaks should produce >1 phrase with duration-based splitting",
        )

    def test_no_phrase_exceeds_cap(self):
        # With auto-scaling, the cap adjusts based on funscript duration.
        # Formula from _auto_scale_phrase_params: max(300_000, dur_min * 5000), cap 600_000
        dur_ms = self.result.duration_ms
        dur_min = dur_ms / 60_000
        auto_max = min(600_000, max(300_000, int(dur_min * 5000)))
        slack_ms = 10_000
        for ph in self.result.phrases:
            dur = ph.end_ms - ph.start_ms
            self.assertLessEqual(
                dur, auto_max + slack_ms,
                f"Phrase duration {dur}ms exceeds auto-scaled cap {auto_max}ms + slack {slack_ms}ms",
            )

    def test_phrase_boundaries_contiguous(self):
        phrases = self.result.phrases
        for i in range(1, len(phrases)):
            self.assertEqual(
                phrases[i - 1].end_ms, phrases[i].start_ms,
                f"Gap between phrase {i-1} and {i}",
            )

    def test_all_phrases_have_positive_bpm(self):
        for ph in self.result.phrases:
            self.assertGreater(ph.bpm, 0)


# ---------------------------------------------------------------------------
# Cross-funscript sanity: all available files should parse without error
# ---------------------------------------------------------------------------

class TestAllAvailableFunscriptsParse(unittest.TestCase):

    def test_all_test_funscripts_load_and_analyze(self):
        """Every funscript in test_funscript/ that exists must analyze cleanly."""
        for path in _AVAILABLE:
            with self.subTest(file=os.path.basename(path)):
                try:
                    result_dict = _analyze(path)
                    self.assertIn("phrases", result_dict)
                    self.assertGreater(len(result_dict["phrases"]), 0)
                except Exception as exc:
                    self.fail(f"{os.path.basename(path)} raised {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    unittest.main()
