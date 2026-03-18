# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for forge/beats.py — beat detection pipeline.

Audio-processing tests are skipped when `av` or `librosa` are not installed
so CI doesn't fail on a bare Python environment.  Tests that mock the heavy
dependencies run unconditionally.
"""

import csv
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from forge.beats import (
    load_beats,
    _save_json,
    _save_csv,
    BEATS_JSON,
    BEATS_CSV,
)

try:
    import av        # noqa: F401
    import librosa   # noqa: F401
    import numpy     # noqa: F401
    _HAS_DEPS = True
except ImportError:
    _HAS_DEPS = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fake_beat_result(beat_count=8, bpm=120.0):
    return {
        "source_path":  "fake.mp4",
        "bpm_estimate": bpm,
        "beat_times":   [round(i * 60 / bpm, 4) for i in range(beat_count)],
        "beat_count":   beat_count,
    }


# ── _save_json / _save_csv ────────────────────────────────────────────────────

class TestSaveHelpers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_save_json_creates_file(self):
        data = _fake_beat_result()
        _save_json(data, Path(self.tmp) / "out.json")
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "out.json")))

    def test_save_json_round_trip(self):
        data = _fake_beat_result()
        dest = Path(self.tmp) / "b.json"
        _save_json(data, dest)
        with open(dest) as f:
            loaded = json.load(f)
        self.assertEqual(loaded["bpm_estimate"], data["bpm_estimate"])
        self.assertEqual(loaded["beat_count"],   data["beat_count"])

    def test_save_csv_creates_file(self):
        beat_times = [0.5, 1.0, 1.5]
        _save_csv(beat_times, 120.0, Path(self.tmp) / "b.csv")
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "b.csv")))

    def test_save_csv_header_and_rows(self):
        beat_times = [0.5, 1.0, 1.5]
        dest = Path(self.tmp) / "b.csv"
        _save_csv(beat_times, 120.0, dest)
        with open(dest, newline="") as f:
            rows = list(csv.reader(f))
        self.assertEqual(rows[0], ["beat_index", "time_s", "bpm_estimate"])
        self.assertEqual(len(rows), 4)   # header + 3 beats

    def test_save_csv_beat_index_starts_at_1(self):
        _save_csv([0.5], 100.0, Path(self.tmp) / "b.csv")
        with open(os.path.join(self.tmp, "b.csv"), newline="") as f:
            rows = list(csv.reader(f))
        self.assertEqual(rows[1][0], "1")

    def test_save_csv_empty_beat_list(self):
        _save_csv([], 0.0, Path(self.tmp) / "empty.csv")
        with open(os.path.join(self.tmp, "empty.csv"), newline="") as f:
            rows = list(csv.reader(f))
        self.assertEqual(len(rows), 1)   # only header


# ── load_beats ────────────────────────────────────────────────────────────────

class TestLoadBeats(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_returns_none_when_no_cache(self):
        self.assertIsNone(load_beats(self.tmp))

    def test_returns_dict_when_cache_exists(self):
        data = _fake_beat_result()
        _save_json(data, Path(self.tmp) / BEATS_JSON)
        loaded = load_beats(self.tmp)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["bpm_estimate"], 120.0)

    def test_returns_none_on_corrupt_json(self):
        path = Path(self.tmp) / BEATS_JSON
        path.write_text("not json {{{")
        self.assertIsNone(load_beats(self.tmp))


# ── extract_beats with mocked dependencies ────────────────────────────────────

class TestExtractBeatsMocked(unittest.TestCase):
    """Tests that run without real av/librosa by patching _load_audio and librosa."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    @patch("forge.beats._check_deps", return_value=[])
    @patch("forge.beats._load_audio")
    @patch("forge.beats.librosa", create=True)
    @patch("forge.beats.np", create=True)
    def test_writes_json_and_csv(self, mock_np, mock_librosa, mock_load, _mock_deps):
        import numpy as np_real   # for building fake data
        mock_load.return_value = np_real.zeros(22050)

        # librosa.beat.beat_track → (tempo, frames)
        mock_librosa.beat = MagicMock()
        mock_librosa.beat.beat_track.return_value = (120.0, np_real.array([10, 20, 30]))
        mock_librosa.frames_to_time.return_value = np_real.array([0.5, 1.0, 1.5])
        mock_np.atleast_1d.return_value = np_real.array([120.0])

        from forge.beats import extract_beats
        result = extract_beats("fake.mp4", self.tmp)

        self.assertIsNotNone(result)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, BEATS_JSON)))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, BEATS_CSV)))

    @patch("forge.beats._check_deps", return_value=["av", "librosa"])
    def test_returns_none_when_deps_missing(self, _mock_deps):
        import warnings
        from forge.beats import extract_beats
        with warnings.catch_warnings(record=True):
            result = extract_beats("fake.mp4", self.tmp)
        self.assertIsNone(result)

    @patch("forge.beats._check_deps", return_value=[])
    @patch("forge.beats._load_audio", return_value=None)
    def test_returns_none_when_no_audio(self, _mock_load, _mock_deps):
        import warnings
        from forge.beats import extract_beats
        with warnings.catch_warnings(record=True):
            result = extract_beats("fake.mp4", self.tmp)
        self.assertIsNone(result)


# ── Integration test (requires av + librosa) ──────────────────────────────────

@unittest.skipUnless(_HAS_DEPS, "av, librosa, numpy not installed")
class TestExtractBeatsIntegration(unittest.TestCase):
    """Smoke-tests against a real (very short) WAV if available."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _make_wav(self, path, duration_s=1.0, sr=22050):
        """Write a minimal PCM WAV file with a 440 Hz tone."""
        import numpy as np
        import struct, wave
        t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
        samples = (np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
        with wave.open(path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(samples.tobytes())

    def test_extract_from_wav_via_audio_path(self):
        """extract_beats should accept a .wav as audio_path override."""
        wav = os.path.join(self.tmp, "tone.wav")
        self._make_wav(wav, duration_s=5.0)

        from forge.beats import extract_beats
        result = extract_beats("dummy_video.mp4", self.tmp, audio_path=wav)
        # A 5s constant-frequency tone may produce 0 beats — that's OK.
        # We just need the function to return a dict without crashing.
        self.assertIsNotNone(result)
        self.assertIn("bpm_estimate", result)
        self.assertIn("beat_times",   result)
        self.assertIsInstance(result["beat_times"], list)


if __name__ == "__main__":
    unittest.main()
