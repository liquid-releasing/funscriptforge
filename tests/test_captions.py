# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Tests for forge/captions.py — SRT and VTT parsing, JSON export."""

import json
import os
import tempfile
import textwrap
import unittest

from forge.captions import (
    parse_captions,
    save_captions_json,
    load_captions,
    _ts_to_ms,
    _ms_to_ts,
    _strip_tags,
)

# Path to the sample SRT created for big_buck_bunny integration testing
_SAMPLE_SRT = os.path.join(
    os.path.dirname(__file__), "..", "assets", "samples", "big_buck_bunny.srt"
)


# ── Timestamp helpers ────────────────────────────────────────────────────────

class TestTimestampHelpers(unittest.TestCase):
    def test_ts_to_ms_srt_format(self):
        self.assertEqual(_ts_to_ms("00:00:03,000"), 3000)

    def test_ts_to_ms_vtt_format(self):
        self.assertEqual(_ts_to_ms("00:01:30.500"), 90500)

    def test_ts_to_ms_zero(self):
        self.assertEqual(_ts_to_ms("00:00:00,000"), 0)

    def test_ts_to_ms_large(self):
        self.assertEqual(_ts_to_ms("01:00:00,000"), 3_600_000)

    def test_ms_to_ts_zero(self):
        self.assertEqual(_ms_to_ts(0), "00:00:00,000")

    def test_ms_to_ts_round_trip(self):
        original = "00:01:23,456"
        self.assertEqual(_ms_to_ts(_ts_to_ms(original)), original)

    def test_ms_to_ts_hours(self):
        self.assertEqual(_ms_to_ts(3_600_000), "01:00:00,000")


# ── HTML tag stripping ───────────────────────────────────────────────────────

class TestStripTags(unittest.TestCase):
    def test_removes_bold(self):
        self.assertEqual(_strip_tags("<b>hello</b>"), "hello")

    def test_removes_italic(self):
        self.assertEqual(_strip_tags("<i>world</i>"), "world")

    def test_removes_vtt_color_class(self):
        self.assertEqual(_strip_tags("<c.white>text</c>"), "text")

    def test_no_tags_unchanged(self):
        self.assertEqual(_strip_tags("plain text"), "plain text")


# ── SRT parsing ──────────────────────────────────────────────────────────────

class TestParseSRT(unittest.TestCase):
    def _write_srt(self, content, tmp):
        path = os.path.join(tmp, "test.srt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content))
        return path

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_basic_parse(self):
        path = self._write_srt("""\
            1
            00:00:01,000 --> 00:00:03,000
            Hello world.

            2
            00:00:04,000 --> 00:00:06,000
            Second line.
        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(len(caps), 2)
        self.assertEqual(caps[0]["text"], "Hello world.")
        self.assertEqual(caps[0]["start_ms"], 1000)
        self.assertEqual(caps[0]["end_ms"],   3000)
        self.assertEqual(caps[1]["index"], 2)

    def test_multi_line_joined(self):
        path = self._write_srt("""\
            1
            00:00:00,000 --> 00:00:02,000
            Line one.
            Line two.
        """, self.tmp)
        caps = parse_captions(path)
        self.assertIn("Line one.", caps[0]["text"])
        self.assertIn("Line two.", caps[0]["text"])

    def test_html_tags_stripped(self):
        path = self._write_srt("""\
            1
            00:00:00,000 --> 00:00:02,000
            <b>Bold text.</b>
        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(caps[0]["text"], "Bold text.")

    def test_empty_blocks_ignored(self):
        path = self._write_srt("""\
            1
            00:00:00,000 --> 00:00:02,000
            Text here.


        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(len(caps), 1)

    def test_file_not_found_raises(self):
        with self.assertRaises(FileNotFoundError):
            parse_captions("/nonexistent/path.srt")

    def test_sample_srt_loads(self):
        if not os.path.exists(_SAMPLE_SRT):
            self.skipTest("Sample SRT not present")
        caps = parse_captions(_SAMPLE_SRT)
        self.assertGreater(len(caps), 0)
        self.assertIn("text", caps[0])
        self.assertIn("start_ms", caps[0])


# ── VTT parsing ──────────────────────────────────────────────────────────────

class TestParseVTT(unittest.TestCase):
    def _write_vtt(self, content, tmp):
        path = os.path.join(tmp, "test.vtt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content))
        return path

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_basic_vtt(self):
        path = self._write_vtt("""\
            WEBVTT

            00:00:01.000 --> 00:00:03.000
            Hello VTT.

            00:00:04.000 --> 00:00:06.000
            Second cue.
        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(len(caps), 2)
        self.assertEqual(caps[0]["text"], "Hello VTT.")
        self.assertEqual(caps[0]["start_ms"], 1000)

    def test_vtt_with_cue_identifiers(self):
        path = self._write_vtt("""\
            WEBVTT

            intro
            00:00:00.000 --> 00:00:02.000
            Intro text.
        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(len(caps), 1)
        self.assertEqual(caps[0]["text"], "Intro text.")

    def test_vtt_tags_stripped(self):
        path = self._write_vtt("""\
            WEBVTT

            00:00:00.000 --> 00:00:02.000
            <c.white>Coloured text.</c>
        """, self.tmp)
        caps = parse_captions(path)
        self.assertEqual(caps[0]["text"], "Coloured text.")


# ── JSON save / load ──────────────────────────────────────────────────────────

class TestSaveLoadCaptions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.captions = [
            {"index": 1, "start_ms": 1000, "end_ms": 3000, "text": "Hello."},
            {"index": 2, "start_ms": 4000, "end_ms": 6000, "text": "World."},
        ]

    def test_save_creates_file(self):
        dest = save_captions_json(self.captions, self.tmp)
        self.assertTrue(os.path.exists(dest))

    def test_saved_json_is_valid(self):
        dest = save_captions_json(self.captions, self.tmp)
        with open(dest, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(len(data), 2)

    def test_saved_json_has_timestamp_strings(self):
        dest = save_captions_json(self.captions, self.tmp)
        with open(dest, encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("start", data[0])
        self.assertIn("end",   data[0])
        # Should be human-readable, e.g. "00:00:01,000"
        self.assertRegex(data[0]["start"], r"\d{2}:\d{2}:\d{2},\d{3}")

    def test_load_captions_round_trip(self):
        save_captions_json(self.captions, self.tmp)
        loaded = load_captions(self.tmp)
        self.assertIsNotNone(loaded)
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded[0]["text"], "Hello.")

    def test_load_captions_returns_none_when_missing(self):
        result = load_captions(self.tmp)   # nothing written yet
        self.assertIsNone(result)

    def test_saves_unicode_text(self):
        captions = [{"index": 1, "start_ms": 0, "end_ms": 1000, "text": "日本語テスト"}]
        dest = save_captions_json(captions, self.tmp)
        with open(dest, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data[0]["text"], "日本語テスト")


if __name__ == "__main__":
    unittest.main()
