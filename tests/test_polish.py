"""Tests for forge.polish — the device-clamp adapter behind the Polish tab.

Covers the v1 station catalog, the ported polish chain, the device_specs
safety backstop, TCode sibling naming, and a shared fixture the JS preview
engine cross-checks against (golden parity — preview must equal the file).
"""

import json
import math
import os
import unittest

from forge import polish
from forge.device_specs import combined_limits, load_device_specs


def _sine(n=400, dt=60, amp=45, center=50, period_ms=240):
    return [
        {"at": i * dt, "pos": int(round(center + amp * math.sin((i * dt) / (period_ms / (2 * math.pi)))))}
        for i in range(n)
    ]


def _jerky(n=200, dt=20):
    # Alternates 0/100 every dt ms => ~5000 pos/s, far past any device cap.
    return [{"at": i * dt, "pos": 0 if i % 2 == 0 else 100} for i in range(n)]


class TestStationCatalog(unittest.TestCase):

    def test_v1_stations_present(self):
        self.assertEqual(set(polish.STATIONS), {"estim3p", "handy", "osr2", "sr6"})

    def test_every_station_resolves_in_device_specs(self):
        specs = load_device_specs()
        for sid, st in polish.STATIONS.items():
            with self.subTest(station=sid):
                self.assertTrue(st.device_keys, f"{sid} has no device_keys")
                for key in st.device_keys:
                    self.assertIn(key, specs, f"{sid} -> unknown device_specs key {key!r}")

    def test_sr6_added_to_device_specs(self):
        specs = load_device_specs()
        self.assertIn("sr6", specs)
        self.assertEqual(specs["sr6"].device_type, "stroker")
        self.assertGreater(specs["sr6"].max_speed, 0)

    def test_sr6_experimental_handy_estim_not(self):
        self.assertTrue(polish.STATIONS["sr6"].experimental)
        self.assertFalse(polish.STATIONS["handy"].experimental)
        self.assertFalse(polish.STATIONS["estim3p"].experimental)

    def test_axis_topology(self):
        self.assertEqual(polish.STATIONS["handy"].axes, ["L0"])           # single
        self.assertEqual(polish.STATIONS["sr6"].axes,                     # full TCode
                         ["L0", "L1", "L2", "R0", "R1", "R2"])
        self.assertIn("L0", polish.STATIONS["osr2"].axes)                 # has main
        self.assertNotIn("L1", polish.STATIONS["osr2"].axes)             # OSR2 has no surge carriage


class TestSiblingPaths(unittest.TestCase):

    def test_l0_is_bare_stem(self):
        self.assertEqual(polish.sibling_path("scene", "L0"), "scene.funscript")

    def test_named_axes(self):
        self.assertEqual(polish.sibling_path("scene", "L1"), "scene.surge.funscript")
        self.assertEqual(polish.sibling_path("scene", "R0"), "scene.twist.funscript")
        self.assertEqual(polish.sibling_path("scene", "R1"), "scene.roll.funscript")
        self.assertEqual(polish.sibling_path("scene", "R2"), "scene.pitch.funscript")

    def test_sr6_full_sibling_set(self):
        paths = [polish.sibling_path("v", a) for a in polish.STATIONS["sr6"].axes]
        self.assertEqual(paths, [
            "v.funscript", "v.surge.funscript", "v.sway.funscript",
            "v.twist.funscript", "v.roll.funscript", "v.pitch.funscript",
        ])


class TestRoundHalfUp(unittest.TestCase):

    def test_matches_js_math_round_at_half(self):
        # JS Math.round rounds .5 up (toward +inf); Python's builtin round is banker's.
        self.assertEqual(polish._round_half_up(0.5), 1)
        self.assertEqual(polish._round_half_up(1.5), 2)
        self.assertEqual(polish._round_half_up(2.5), 3)
        self.assertEqual(polish._round_half_up(49.5), 50)


class TestApplyPass(unittest.TestCase):

    def test_deterministic(self):
        acts = _sine()
        a, _ = polish.apply_pass(acts, "handy")
        b, _ = polish.apply_pass(acts, "handy")
        self.assertEqual(a, b)

    def test_unknown_station_raises(self):
        with self.assertRaises(ValueError):
            polish.apply_pass(_sine(), "nope")

    def test_short_input_passthrough(self):
        out, stats = polish.apply_pass([{"at": 0, "pos": 10}], "handy")
        self.assertEqual(len(out), 1)

    def test_backstop_clamps_jerky_script(self):
        # A 5000 pos/s script must be tamed below each device's max_speed.
        acts = _jerky()
        for sid in ("handy", "osr2", "sr6"):
            with self.subTest(station=sid):
                out, stats = polish.apply_pass(acts, sid)
                spec = combined_limits(polish.STATIONS[sid].device_keys)
                worst = 0.0
                for i in range(1, len(out)):
                    dt = (out[i]["at"] - out[i - 1]["at"]) / 1000.0
                    if dt > 0:
                        worst = max(worst, abs(out[i]["pos"] - out[i - 1]["pos"]) / dt)
                # Backstop should keep us at/under the device ceiling (small float slack).
                self.assertLessEqual(worst, spec.max_speed + 1.0,
                                     f"{sid}: {worst:.0f} pos/s exceeds cap {spec.max_speed}")

    def test_quiet_floor_lifts_estim_minimum(self):
        # E-stim quietFloor default 0.06 -> nothing below 6.
        acts = [{"at": i * 50, "pos": 0 if i % 2 else 3} for i in range(60)]
        out, _ = polish.apply_pass(acts, "estim3p")
        self.assertGreaterEqual(min(a["pos"] for a in out), 6 - 1)  # -1 for backstop slack

    def test_positions_in_range(self):
        for sid in polish.STATIONS:
            out, _ = polish.apply_pass(_sine(), sid)
            for a in out:
                self.assertGreaterEqual(a["pos"], 0)
                self.assertLessEqual(a["pos"], 100)


class TestPreviewPass(unittest.TestCase):

    def test_three_traces(self):
        pv = polish.preview_pass(_sine(), "handy")
        self.assertEqual(set(pv), {"character", "clamped", "performed", "stats"})
        self.assertTrue(pv["performed"])

    def test_performed_differs_from_clamped_by_lag(self):
        pv = polish.preview_pass(_sine(), "handy")
        # First-order lag means performed != clamped somewhere.
        diffs = [abs(c["pos"] - p["pos"]) for c, p in zip(pv["clamped"], pv["performed"])]
        self.assertGreater(max(diffs), 0)


class TestJsParityFixture(unittest.TestCase):
    """Golden fixture the JS preview engine consumes to prove no drift."""

    FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "polish_parity.json")

    def test_fixture_matches_current_engine(self):
        if not os.path.exists(self.FIXTURE):
            self.skipTest("fixture not generated yet")
        data = json.loads(open(self.FIXTURE, encoding="utf-8").read())
        acts = data["acts"]
        for sid, expected in data["py"].items():
            got = [round(s["pos"], 6) for s in polish.preview_pass(acts, sid)["clamped"]]
            self.assertEqual(len(got), len(expected), f"{sid} length drift")
            worst = max((abs(g - e) for g, e in zip(got, expected)), default=0)
            self.assertLess(worst, 1e-6, f"{sid} engine drifted from fixture by {worst}")


if __name__ == "__main__":
    unittest.main()
