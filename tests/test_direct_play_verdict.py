# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Direct-play verdict tests — which sources skip chapter-clip extraction.

A source that direct-plays streams straight into WebView2's <video> and the
whole per-chapter transcode is skipped. That is the difference between an
analysis pass that spends minutes on ffmpeg and one that spends none (D32),
so the gate's boundaries are worth pinning.

The verdict is deliberately conservative: a false "not playable" costs one
clip, a false "playable" is a stuttering or OOM-ing viewer. These tests lock
each disqualifier independently so a future tweak to one can't quietly widen
another.

MIRROR: videoflow ``chapter_clips.is_direct_playable`` implements the same
rules. ``DIRECT_PLAY_MAX_WIDTH`` must match on both sides or analysis and
playback disagree about whether clips exist for a source.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cli


def stream(**over):
    """A clean 1080p H.264 SDR CFR stream — the canonical playable source."""
    st = {
        "codec_name": "h264",
        "pix_fmt": "yuv420p",
        "profile": "High",
        "width": 1920,
        "color_transfer": "bt709",
        "color_primaries": "bt709",
        "avg_frame_rate": "30/1",
        "r_frame_rate": "30/1",
    }
    st.update(over)
    return st


def verdict(**over):
    out: dict = {}
    cli._verdict_direct_playable(out, stream(**over))
    return out


class TestWidthGate(unittest.TestCase):
    """The gate raised from 1920 to 2560 so 1440p/2.5K stops transcoding."""

    def test_constant_is_2560(self):
        self.assertEqual(cli.DIRECT_PLAY_MAX_WIDTH, 2560)

    def test_1080p_plays(self):
        self.assertTrue(verdict(width=1920)["direct_playable"])

    def test_2520_wide_plays(self):
        """A real source from the D32 report (Madmartigan vol6)."""
        self.assertTrue(verdict(width=2520)["direct_playable"])

    def test_2560_wide_plays_at_the_boundary(self):
        """Madmartigan vol2 sits exactly on the gate — inclusive, not off-by-one."""
        self.assertTrue(verdict(width=2560)["direct_playable"])

    def test_just_over_the_gate_clips(self):
        self.assertFalse(verdict(width=2561)["direct_playable"])

    def test_4k_still_clips(self):
        """4K is the decode/OOM cliff the gate exists for — must not regress."""
        out = verdict(width=3840)
        self.assertFalse(out["direct_playable"])
        self.assertIn("width:3840", out["playable_reasons"])

    def test_missing_width_is_not_a_disqualifier(self):
        """An unknown width shouldn't fail on width alone; other rules still apply."""
        out = verdict(width=0)
        self.assertNotIn("width:0", out["playable_reasons"])


class TestOtherDisqualifiersUnaffected(unittest.TestCase):
    """Raising the width gate must not loosen anything else."""

    def test_hevc_clips_even_when_narrow(self):
        out = verdict(codec_name="hevc", width=1280)
        self.assertFalse(out["direct_playable"])
        self.assertIn("codec:hevc", out["playable_reasons"])

    def test_10bit_clips_at_1440p(self):
        out = verdict(width=2560, pix_fmt="yuv420p10le", profile="High 10")
        self.assertFalse(out["direct_playable"])

    def test_hdr_clips_at_1440p(self):
        out = verdict(width=2560, color_transfer="smpte2084", color_primaries="bt2020")
        self.assertFalse(out["direct_playable"])
        self.assertTrue(any(r.startswith("hdr:") for r in out["playable_reasons"]))

    def test_vfr_clips_at_1440p(self):
        out = verdict(width=2560, avg_frame_rate="30/1", r_frame_rate="60/1")
        self.assertFalse(out["direct_playable"])
        self.assertIn("vfr", out["playable_reasons"])

    def test_near_cfr_still_plays_at_1440p(self):
        """vol6 reports avg 59.999 vs r 60 — near-CFR, must stay playable."""
        out = verdict(width=2520, avg_frame_rate="2086150018/34769167",
                      r_frame_rate="60/1")
        self.assertTrue(out["direct_playable"], out["playable_reasons"])

    def test_reasons_accumulate(self):
        """A source can fail several ways; all get surfaced for the UI."""
        out = verdict(width=3840, codec_name="av1")
        self.assertGreaterEqual(len(out["playable_reasons"]), 2)


class TestMirrorAgreement(unittest.TestCase):

    def test_gate_matches_videoflow(self):
        """Drift here means analysis and playback disagree about clips."""
        try:
            from videoflow.chapter_clips import DIRECT_PLAY_MAX_WIDTH
        except ImportError:
            self.skipTest("videoflow not importable")
        self.assertEqual(cli.DIRECT_PLAY_MAX_WIDTH, DIRECT_PLAY_MAX_WIDTH)


if __name__ == "__main__":
    unittest.main()
