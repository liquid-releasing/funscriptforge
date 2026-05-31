# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Regression tests for assessment/character_drift.py phrase splitting.

Headline guard: subdividing a phrase must NOT inflate its BPM. The drift
splitter shallow-copied each parent into sub-phrases and retimed start/end
but left the parent's full oscillation_count on a fraction of the span, so
phrase.bpm (= osc·60000/dur) blew up by 1/ratio — a 127s→10s split read
~12x too hot (Prisoner showed 1641 BPM for real ~135). The counts must
scale with the sub-span duration.
"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from assessment.character_drift import split_phrases  # noqa: E402
from models import Phrase  # noqa: E402


def _steady_actions(dur_ms, bpm):
    """Triangle wave at `bpm` oscillations/min over dur_ms (0↔100)."""
    osc_per_ms = bpm / 60_000.0
    half_ms = 1.0 / (2 * osc_per_ms)  # one up- or down-stroke
    acts, at, up = [], 0, True
    while at <= dur_ms:
        acts.append({"at": int(at), "pos": 100 if up else 0})
        at += half_ms
        up = not up
    return acts


class TestDriftSplitBpm(unittest.TestCase):
    def test_split_does_not_inflate_bpm(self):
        # A long, uniform 135-BPM phrase — long enough to be subdivided.
        dur = 130_000
        bpm = 135
        acts = _steady_actions(dur, bpm)
        osc = round(bpm * dur / 60_000)  # oscillations over the span
        parent = Phrase(0, dur, "steady", osc, f"{osc} cycles", osc)
        parent.chapter_id = 0
        self.assertAlmostEqual(parent.bpm, bpm, delta=2)

        subs = split_phrases([parent], acts)
        self.assertGreater(len(subs), 1, "expected the long phrase to split")

        # Every sub-phrase reads close to the parent's true rate — NOT the
        # 1/ratio-inflated value the bug produced.
        for s in subs:
            self.assertLessEqual(
                s.bpm, bpm * 1.6,
                f"sub {s.start_ms}-{s.end_ms} bpm {s.bpm} inflated (parent {bpm})",
            )
            self.assertGreaterEqual(s.bpm, bpm * 0.4)

    def test_subspan_osc_scales_with_duration(self):
        dur = 120_000
        acts = _steady_actions(dur, 120)
        parent = Phrase(0, dur, "steady", 240, "240 cycles", 240)
        parent.chapter_id = 0
        subs = split_phrases([parent], acts)
        # Total oscillations across subs ≈ the parent's (conserved, ± rounding).
        total = sum(s.oscillation_count for s in subs)
        self.assertAlmostEqual(total, 240, delta=len(subs) + 1)
        # No sub carries the full parent count on a partial span.
        self.assertTrue(all(s.oscillation_count < 240 for s in subs))


if __name__ == "__main__":
    unittest.main()
