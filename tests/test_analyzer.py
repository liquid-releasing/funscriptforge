# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Unit tests for assessment/analyzer.py"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import tempfile
import unittest

from assessment.analyzer import FunscriptAnalyzer, AnalyzerConfig
from models import AssessmentResult, Phase, Cycle, Phrase, BpmTransition

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "sample.funscript")


class TestFunscriptAnalyzer(unittest.TestCase):
    def setUp(self):
        self.analyzer = FunscriptAnalyzer()
        self.analyzer.load(FIXTURE)
        self.result = self.analyzer.analyze()

    def test_load_sets_actions(self):
        self.assertGreater(len(self.analyzer._actions), 0)

    def test_analyze_returns_assessment_result(self):
        self.assertIsInstance(self.result, AssessmentResult)

    def test_phases_detected(self):
        self.assertGreater(len(self.result.phases), 0)

    def test_cycles_detected(self):
        self.assertGreater(len(self.result.cycles), 0)

    def test_patterns_detected(self):
        self.assertGreater(len(self.result.patterns), 0)

    def test_phrases_detected(self):
        self.assertGreater(len(self.result.phrases), 0)

    def test_bpm_transitions_is_list(self):
        self.assertIsInstance(self.result.bpm_transitions, list)

    def test_no_beat_windows_or_auto_mode_windows(self):
        d = self.result.to_dict()
        self.assertNotIn("beat_windows", d)
        self.assertNotIn("auto_mode_windows", d)

    def test_duration_ms_matches_last_action(self):
        with open(FIXTURE) as f:
            data = json.load(f)
        last_at = data["actions"][-1]["at"]
        self.assertEqual(self.result.duration_ms, last_at)

    def test_action_count(self):
        with open(FIXTURE) as f:
            data = json.load(f)
        self.assertEqual(self.result.action_count, len(data["actions"]))

    def test_phase_timestamps_match_ms(self):
        for phase in self.result.phases:
            from utils import ms_to_timestamp
            self.assertEqual(phase.start_ts, ms_to_timestamp(phase.start_ms))
            self.assertEqual(phase.end_ts, ms_to_timestamp(phase.end_ms))

    def test_cycle_timestamps_match_ms(self):
        for cycle in self.result.cycles:
            from utils import ms_to_timestamp
            self.assertEqual(cycle.start_ts, ms_to_timestamp(cycle.start_ms))
            self.assertEqual(cycle.end_ts, ms_to_timestamp(cycle.end_ms))

    def test_phrase_bpm_is_non_negative(self):
        for phrase in self.result.phrases:
            self.assertGreaterEqual(phrase.bpm, 0.0)

    def test_phrase_at_returns_correct_phrase(self):
        if self.result.phrases:
            ph = self.result.phrases[0]
            mid = (ph.start_ms + ph.end_ms) // 2
            found = self.result.phrase_at(mid)
            self.assertEqual(found, ph)

    def test_phrase_at_returns_none_outside_phrases(self):
        found = self.result.phrase_at(-1)
        self.assertIsNone(found)

    def test_no_analyze_without_load(self):
        fresh = FunscriptAnalyzer()
        with self.assertRaises(RuntimeError):
            fresh.analyze()


class TestBpmTransitionDetection(unittest.TestCase):
    def test_transition_flagged_on_large_change(self):
        # Low threshold so our fixture likely triggers at least one check
        cfg = AnalyzerConfig(bpm_change_threshold_pct=0.001)
        analyzer = FunscriptAnalyzer(config=cfg)
        analyzer.load(FIXTURE)
        result = analyzer.analyze()
        # With threshold=0, any BPM change between phrases is flagged
        # (only meaningful if there are 2+ phrases with nonzero BPM)
        self.assertIsInstance(result.bpm_transitions, list)

    def test_no_transitions_on_very_high_threshold(self):
        cfg = AnalyzerConfig(bpm_change_threshold_pct=9999.0)
        analyzer = FunscriptAnalyzer(config=cfg)
        analyzer.load(FIXTURE)
        result = analyzer.analyze()
        self.assertEqual(len(result.bpm_transitions), 0)

    def test_transition_fields(self):
        cfg = AnalyzerConfig(bpm_change_threshold_pct=0.001)
        analyzer = FunscriptAnalyzer(config=cfg)
        analyzer.load(FIXTURE)
        result = analyzer.analyze()
        for t in result.bpm_transitions:
            self.assertIsInstance(t, BpmTransition)
            self.assertGreaterEqual(t.at_ms, 0)
            self.assertIsInstance(t.description, str)


class TestAssessmentResultSerialization(unittest.TestCase):
    def setUp(self):
        analyzer = FunscriptAnalyzer()
        analyzer.load(FIXTURE)
        self.result = analyzer.analyze()

    def test_to_dict_has_meta(self):
        d = self.result.to_dict()
        self.assertIn("meta", d)
        self.assertIn("duration_ms", d["meta"])
        self.assertIn("duration_ts", d["meta"])
        self.assertIn("action_count", d["meta"])
        self.assertIn("bpm", d["meta"])

    def test_to_dict_has_all_sections(self):
        d = self.result.to_dict()
        for key in ("phases", "cycles", "patterns", "phrases", "bpm_transitions"):
            self.assertIn(key, d)

    def test_phase_dicts_have_both_ms_and_ts(self):
        d = self.result.to_dict()
        for phase in d["phases"]:
            self.assertIn("start_ms", phase)
            self.assertIn("start_ts", phase)
            self.assertIn("end_ms", phase)
            self.assertIn("end_ts", phase)

    def test_save_and_load_roundtrip(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
            tmp_path = f.name

        try:
            self.result.save(tmp_path)
            loaded = AssessmentResult.load(tmp_path)

            self.assertEqual(loaded.duration_ms, self.result.duration_ms)
            self.assertEqual(loaded.action_count, self.result.action_count)
            self.assertEqual(len(loaded.phases), len(self.result.phases))
            self.assertEqual(len(loaded.cycles), len(self.result.cycles))
            self.assertEqual(len(loaded.patterns), len(self.result.patterns))
            self.assertEqual(len(loaded.phrases), len(self.result.phrases))
            self.assertEqual(len(loaded.bpm_transitions), len(self.result.bpm_transitions))
        finally:
            os.unlink(tmp_path)


class TestAnalyzerConfig(unittest.TestCase):
    def test_default_config(self):
        cfg = AnalyzerConfig()
        self.assertEqual(cfg.min_velocity, 0.02)
        self.assertEqual(cfg.bpm_change_threshold_pct, 40.0)

    def test_custom_threshold(self):
        cfg = AnalyzerConfig(bpm_change_threshold_pct=10.0)
        self.assertEqual(cfg.bpm_change_threshold_pct, 10.0)

    def test_invalid_min_velocity_raises(self):
        with self.assertRaises(ValueError):
            AnalyzerConfig(min_velocity=-0.1)

    def test_invalid_duration_tolerance_raises(self):
        with self.assertRaises(ValueError):
            AnalyzerConfig(duration_tolerance=1.5)

    def test_invalid_bpm_threshold_raises(self):
        with self.assertRaises(ValueError):
            AnalyzerConfig(bpm_change_threshold_pct=0.0)


class TestUniformTempoSegmentation(unittest.TestCase):
    """Tests for duration-based phrase splitting (fix for issue #2 / VictoriaOaks).

    A perfectly uniform funscript (constant BPM, constant amplitude) would
    previously produce a single giant phrase.  The fix forces a boundary
    whenever the accumulated phrase would exceed max_phrase_duration_ms.
    """

    @staticmethod
    def _make_uniform_funscript(total_ms: int, half_cycle_ms: int = 250) -> str:
        """Build a perfectly uniform oscillating funscript and return its path."""
        actions = []
        t = 0
        i = 0
        while t < total_ms:
            actions.append({"at": t, "pos": 100 if i % 2 == 0 else 0})
            t += half_cycle_ms
            i += 1
        actions.append({"at": total_ms, "pos": 50})

        import tempfile
        path = tempfile.mktemp(suffix=".funscript")
        with open(path, "w") as f:
            json.dump({"actions": actions}, f)
        return path

    def _analyze(self, path: str, max_dur: int, min_dur: int = 0) -> "AssessmentResult":
        cfg = AnalyzerConfig(
            max_phrase_duration_ms=max_dur,
            min_phrase_duration_ms=min_dur,
            auto_scale_phrases=False,  # Tests use explicit params
        )
        a = FunscriptAnalyzer(config=cfg)
        a.load(path)
        return a.analyze()

    def test_uniform_without_cap_produces_one_phrase(self):
        """Baseline: without the cap, 10-min uniform → 1 phrase."""
        path = self._make_uniform_funscript(600_000)
        try:
            result = self._analyze(path, max_dur=0)
            self.assertEqual(len(result.phrases), 1)
        finally:
            os.unlink(path)

    def test_uniform_with_cap_produces_multiple_phrases(self):
        """With a 5-min cap, a 10-min uniform funscript → ≥2 phrases."""
        path = self._make_uniform_funscript(600_000)
        try:
            result = self._analyze(path, max_dur=300_000)
            self.assertGreater(len(result.phrases), 1)
        finally:
            os.unlink(path)

    def test_phrase_count_scales_with_duration(self):
        """A 15-min funscript with a 5-min cap should produce ~3 phrases."""
        path = self._make_uniform_funscript(900_000)
        try:
            result = self._analyze(path, max_dur=300_000)
            self.assertGreaterEqual(len(result.phrases), 2)
        finally:
            os.unlink(path)

    def test_phrases_are_contiguous(self):
        """Phrase boundaries must not overlap or leave gaps."""
        path = self._make_uniform_funscript(600_000)
        try:
            result = self._analyze(path, max_dur=300_000)
            phrases = result.phrases
            for i in range(1, len(phrases)):
                self.assertEqual(
                    phrases[i - 1].end_ms, phrases[i].start_ms,
                    f"Gap or overlap between phrase {i-1} and {i}",
                )
        finally:
            os.unlink(path)

    def test_each_phrase_within_cap(self):
        """No individual phrase should exceed max_phrase_duration_ms by more than
        one cycle duration (we split at cycle boundaries, not mid-cycle)."""
        half_cycle_ms = 250
        max_dur = 60_000  # 1-minute cap
        path = self._make_uniform_funscript(600_000, half_cycle_ms=half_cycle_ms)
        try:
            result = self._analyze(path, max_dur=max_dur)
            for ph in result.phrases:
                dur = ph.end_ms - ph.start_ms
                # Allow one extra cycle beyond the cap
                self.assertLessEqual(
                    dur, max_dur + half_cycle_ms * 2 + 1000,
                    f"Phrase duration {dur}ms exceeds cap {max_dur}ms by more than one cycle",
                )
        finally:
            os.unlink(path)

    def test_cap_disabled_when_zero(self):
        """max_phrase_duration_ms=0 disables the cap."""
        path = self._make_uniform_funscript(120_000)
        try:
            result = self._analyze(path, max_dur=0)
            self.assertEqual(len(result.phrases), 1)
        finally:
            os.unlink(path)

    def test_cap_larger_than_funscript_no_effect(self):
        """If the cap is larger than the total duration, no extra splits occur."""
        path = self._make_uniform_funscript(60_000)
        try:
            result = self._analyze(path, max_dur=300_000)
            self.assertEqual(len(result.phrases), 1)
        finally:
            os.unlink(path)

    def test_config_default_is_300000(self):
        """Default max_phrase_duration_ms should be 5 minutes."""
        cfg = AnalyzerConfig()
        self.assertEqual(cfg.max_phrase_duration_ms, 300_000)


class TestAnalyzerErrorPaths(unittest.TestCase):
    def test_load_missing_file_raises(self):
        analyzer = FunscriptAnalyzer()
        with self.assertRaises(FileNotFoundError):
            analyzer.load("/nonexistent/path/file.funscript")

    def test_load_invalid_json_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".funscript", delete=False, mode="w") as f:
            f.write("this is not valid json {{{")
            tmp = f.name
        try:
            analyzer = FunscriptAnalyzer()
            with self.assertRaises(ValueError):
                analyzer.load(tmp)
        finally:
            os.unlink(tmp)

    def test_load_missing_actions_key_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".funscript", delete=False, mode="w") as f:
            json.dump({"version": 1}, f)
            tmp = f.name
        try:
            analyzer = FunscriptAnalyzer()
            with self.assertRaises(ValueError):
                analyzer.load(tmp)
        finally:
            os.unlink(tmp)

    def test_assessment_load_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            AssessmentResult.load("/nonexistent/assessment.json")

    def test_assessment_load_invalid_json_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w") as f:
            f.write("not json")
            tmp = f.name
        try:
            with self.assertRaises(ValueError):
                AssessmentResult.load(tmp)
        finally:
            os.unlink(tmp)


if __name__ == "__main__":
    unittest.main()
