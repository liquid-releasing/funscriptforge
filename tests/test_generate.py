# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Tests for `cli.py generate` — the forgegen engine inside FunscriptForge.

Two layers:

1. **Pure curve helpers** (`_parse_curve`, `_sample_curve_at`,
   `_pace_to_density_arc`) — no engine, no librosa.
2. **End-to-end** through the real videoflow engine via a *synthetic* full
   `AudioBeatMap` (so we exercise generate_from_beats + funscript_stats + the
   band grading without a slow media analysis pass). The key property under
   test is the step-1 thesis: the **Pace curve drives density dynamics** —
   a flat pace is monotone (rate CoV ~0), a shaped pace is dynamic (CoV > 0).
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import cli  # noqa: E402

CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")
PYTHON = sys.executable


class TestCurveHelpers(unittest.TestCase):
    def test_parse_curve_empty(self):
        self.assertEqual(cli._parse_curve(None), [])
        self.assertEqual(cli._parse_curve(""), [])
        self.assertEqual(cli._parse_curve("  ,, "), [])

    def test_parse_curve_values_and_clamp(self):
        self.assertEqual(cli._parse_curve("0.2, 0.5 ,1.0"), [0.2, 0.5, 1.0])
        # out-of-range values clamp into [0, 1]
        self.assertEqual(cli._parse_curve("-0.5,2.0"), [0.0, 1.0])

    def test_sample_curve_endpoints_and_mid(self):
        s = [0.0, 1.0]
        self.assertAlmostEqual(cli._sample_curve_at(s, 0.0), 0.0)
        self.assertAlmostEqual(cli._sample_curve_at(s, 1.0), 1.0)
        self.assertAlmostEqual(cli._sample_curve_at(s, 0.5), 0.5)  # linear midpoint

    def test_sample_curve_degenerate(self):
        self.assertEqual(cli._sample_curve_at([], 0.5), 0.5)   # empty → neutral
        self.assertEqual(cli._sample_curve_at([0.7], 0.5), 0.7)  # single point
        # p clamps
        self.assertAlmostEqual(cli._sample_curve_at([0.0, 1.0], 5.0), 1.0)
        self.assertAlmostEqual(cli._sample_curve_at([0.0, 1.0], -5.0), 0.0)

    def test_pace_to_density_arc_length_and_none(self):
        beats = [0, 480, 960, 1440, 1920]
        arc = cli._pace_to_density_arc([0.0, 1.0], beats)
        self.assertEqual(len(arc), len(beats))      # one value per beat
        self.assertAlmostEqual(arc[0], 0.0)         # first beat at track start
        self.assertAlmostEqual(arc[-1], 1.0)        # last beat at track end
        self.assertTrue(all(arc[i] <= arc[i + 1] for i in range(len(arc) - 1)))
        # degenerate inputs → no arc (flat fallback in the engine)
        self.assertIsNone(cli._pace_to_density_arc([], beats))
        self.assertIsNone(cli._pace_to_density_arc([0.5], []))

    def test_in_band(self):
        self.assertTrue(cli._in_band(0.40, cli._RATE_COV_BAND))
        self.assertFalse(cli._in_band(0.10, cli._RATE_COV_BAND))
        self.assertFalse(cli._in_band(0.90, cli._RATE_COV_BAND))


def _synthetic_beatmap_json(path, *, beats=240, interval_ms=480):
    """Write a FULL AudioBeatMap (energies + stanzas) the engine can generate
    from — the analyze pass would produce this; we synthesize it so the test
    stays fast and deterministic (no librosa / media decode)."""
    beat_ms = [i * interval_ms for i in range(beats)]
    # Varied per-beat energy so the gate has something to bite on.
    energy = [0.3 + 0.5 * ((i * 7) % 11) / 10.0 for i in range(beats)]
    stanzas = [
        {"start_ms": s * 16 * interval_ms, "end_ms": (s + 1) * 16 * interval_ms}
        for s in range((beats + 15) // 16)
    ]
    data = {
        "bpm": 60000.0 / interval_ms,
        "duration_ms": beats * interval_ms,
        "beats": beat_ms,
        "downbeats": beat_ms[::4],
        "stanzas": stanzas,
        "energy": [round(e, 6) for e in energy],
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def _run_generate(beatmap_path, out_path, pace, range_curve=None):
    cmd = [PYTHON, CLI, "generate", "--beats", beatmap_path,
           "--output", out_path, "--pace-curve", pace, "--format", "json"]
    if range_curve is not None:
        cmd += ["--range-curve", range_curve]
    result = subprocess.run(cmd, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


class TestGenerateEndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.beatmap = os.path.join(self.tmp, "bm.json")
        _synthetic_beatmap_json(self.beatmap)

    def test_reduced_sidecar_rejected(self):
        """A reduced beat sidecar (no energy/stanzas) must be refused clearly."""
        reduced = os.path.join(self.tmp, "reduced.json")
        with open(reduced, "w", encoding="utf-8") as f:
            json.dump({"bpm": 120.0, "duration_ms": 1000,
                       "beats": [0, 500], "downbeats": [0],
                       "stanzas": [], "energy": []}, f)
        out = os.path.join(self.tmp, "x.funscript")
        result = subprocess.run(
            [PYTHON, CLI, "generate", "--beats", reduced, "--output", out],
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reduced beat sidecar", result.stderr)

    def test_generates_well_formed_funscript(self):
        out = os.path.join(self.tmp, "gen.funscript")
        payload = _run_generate(self.beatmap, out, "0.3,0.5,0.8,0.6,0.4")
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["density_arc"])
        self.assertGreater(payload["actions"], 0)
        self.assertEqual(payload["pace_points"], 5)
        # band block is present and well-shaped
        self.assertIn("rate_cov", payload["band"])
        self.assertIn("velocity_cov_in_band", payload["band"])
        # written file is a valid funscript: monotonic, clamped
        d = json.load(open(out))
        a = d["actions"]
        self.assertTrue(all(a[i]["at"] < a[i + 1]["at"] for i in range(len(a) - 1)))
        self.assertTrue(all(0 <= x["pos"] <= 100 for x in a))

    def test_pace_curve_drives_dynamics(self):
        """THE step-1 thesis: a flat pace is monotone; a shaped pace is dynamic.

        Same source, same engine — only the Pace curve differs. The shaped
        pace must produce strictly higher density dynamics (rate CoV) than the
        flat one. This is what the diagnosis panel's Flat→Dynamic loop rides."""
        flat_out = os.path.join(self.tmp, "flat.funscript")
        shaped_out = os.path.join(self.tmp, "shaped.funscript")
        flat = _run_generate(self.beatmap, flat_out, "0.5,0.5,0.5,0.5,0.5")
        shaped = _run_generate(self.beatmap, shaped_out, "0.15,0.4,0.95,0.5,0.2")
        self.assertGreater(
            shaped["band"]["rate_cov"], flat["band"]["rate_cov"],
            "shaped pace should be more dynamic than flat pace",
        )
        # a flat pace should be (near-)monotone density
        self.assertLess(flat["band"]["rate_cov"], 0.1)

    def test_range_curve_drives_reach(self):
        """Step-2 thesis: the Range curve controls how FAR strokes go. Same
        source + same Pace; only Range differs. A low Range produces a smaller
        average stroke (shallower reach) than a full Range."""
        full_out = os.path.join(self.tmp, "rfull.funscript")
        shallow_out = os.path.join(self.tmp, "rshallow.funscript")
        pace = "0.5,0.6,0.7,0.6,0.5"
        full = _run_generate(self.beatmap, full_out, pace, range_curve="1.0,1.0,1.0,1.0,1.0")
        shallow = _run_generate(self.beatmap, shallow_out, pace, range_curve="0.4,0.4,0.4,0.4,0.4")
        self.assertTrue(full["gain_arc"])
        self.assertTrue(shallow["gain_arc"])
        self.assertLess(
            shallow["stats"]["motion"]["avg_stroke"],
            full["stats"]["motion"]["avg_stroke"],
            "a low Range curve should produce shallower strokes",
        )

    def test_rising_range_keeps_rails_at_the_top(self):
        """A Range that rises to 1.0 must still reach the rails late — the
        depth law (bimodal at full reach) is preserved, not flattened."""
        out = os.path.join(self.tmp, "rising.funscript")
        _run_generate(self.beatmap, out, "0.6,0.6,0.6,0.6,0.6",
                      range_curve="0.3,0.5,0.7,0.9,1.0")
        a = json.load(open(out))["actions"]
        # late strokes should reach near the rails (full Range at the end)
        late = [x["pos"] for x in a if x["at"] >= a[-1]["at"] - 5000]
        self.assertGreaterEqual(max(late), 95)
        self.assertLessEqual(min(late), 5)


if __name__ == "__main__":
    unittest.main()
