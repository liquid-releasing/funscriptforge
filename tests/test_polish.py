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
        self.assertEqual(
            set(polish.STATIONS),
            {"estim3p", "focstim", "focstim4p", "handy", "ossm", "tcode",
             "lovense", "vacuglide", "shaker"},
        )

    def test_every_station_resolves_in_device_specs(self):
        specs = load_device_specs()
        for sid, st in polish.STATIONS.items():
            with self.subTest(station=sid):
                self.assertTrue(st.device_keys, f"{sid} has no device_keys")
                for key in st.device_keys:
                    self.assertIn(key, specs, f"{sid} -> unknown device_specs key {key!r}")

    def test_sr6_in_device_specs(self):
        # The merged 'tcode' station clamps against the sr6 spec (== osr2).
        specs = load_device_specs()
        self.assertIn("sr6", specs)
        self.assertEqual(specs["sr6"].device_type, "stroker")
        self.assertGreater(specs["sr6"].max_speed, 0)

    # Stations whose caps have NOT been confirmed against real gear. The
    # experimental flag is what keeps that visible in the UI instead of
    # implying the same confidence as a measured station — so this is an
    # allow-list, not a loosened assertion. Drop an entry here (and the flag)
    # once a file from that station has actually been played on the hardware.
    UNVERIFIED_STATIONS = {
        "shaker",   # caps reasoned about a class of transducer, not measured
        "focstim",    # device_specs foc3phase is "Confidence: LOW-MEDIUM"
        "focstim4p",  # foc4phase limits are inherited, not measured
    }

    def test_only_four_phase_uses_electrode_drive(self):
        """The electrode flag is what routes a station through the e1..e4
        transform instead of writing alpha/beta. If it ever spread to a
        station whose device expects a position, that station would export
        channels its hardware cannot read."""
        flagged = {sid for sid, st in polish.STATIONS.items() if st.electrodes}
        self.assertEqual(flagged, {"focstim4p"})
        for sid in flagged:
            self.assertTrue(polish.is_estim_station(sid))

    def test_hardware_stations_are_not_experimental(self):
        # The stroker/e-stim stations are hardware we own and can verify
        # end-to-end, so none of them may carry the experimental flag.
        for sid, st in polish.STATIONS.items():
            if sid in self.UNVERIFIED_STATIONS:
                continue  # see test_unverified_stations_are_flagged
            with self.subTest(station=sid):
                self.assertFalse(st.experimental)

    def test_unverified_stations_are_flagged(self):
        """Every station in the allow-list must actually carry the flag.

        Without this the allow-list would be a silent escape hatch: adding an
        id would exempt a station from the check whether or not the UI warned
        anyone.
        """
        for sid in self.UNVERIFIED_STATIONS:
            with self.subTest(station=sid):
                self.assertIn(sid, polish.STATIONS)
                self.assertTrue(polish.STATIONS[sid].experimental)

    def test_shaker_is_flagged_experimental(self):
        """Its device spec is conservative defaults, not measured hardware.

        Every other station's caps came off real gear; the shaker's came off
        reasoning about a class of transducer. The flag is what keeps that
        distinction visible in the UI instead of implying equal confidence.
        """
        self.assertTrue(polish.STATIONS["shaker"].experimental)

    def test_shaker_is_amplitude_not_travel(self):
        """The one station with no position — guard against it being 'fixed'
        into an L0 stroker by someone normalising the catalog."""
        st = polish.STATIONS["shaker"]
        self.assertEqual(st.kind, "shaker")
        self.assertEqual(st.axes, ["V0"])
        self.assertNotIn("L0", st.axes)

    def test_shaker_has_the_slowest_settling_lag(self):
        """A suspended mass on a spring settles slower than any motor here."""
        others = [polish.lag_for_device(s) for s in polish.STATIONS if s != "shaker"]
        self.assertGreater(polish.lag_for_device("shaker"), max(others))

    def test_axis_topology(self):
        self.assertEqual(polish.STATIONS["handy"].axes, ["L0"])           # single
        self.assertEqual(polish.STATIONS["lovense"].axes, ["L0"])         # single (BT)
        self.assertEqual(polish.STATIONS["vacuglide"].axes, ["L0"])       # single (cloud)
        self.assertEqual(polish.STATIONS["tcode"].axes,                   # full 6-axis TCode
                         ["L0", "L1", "L2", "R0", "R1", "R2"])


class TestSiblingPaths(unittest.TestCase):

    def test_l0_is_bare_stem(self):
        self.assertEqual(polish.sibling_path("scene", "L0"), "scene.funscript")

    def test_named_axes(self):
        self.assertEqual(polish.sibling_path("scene", "L1"), "scene.surge.funscript")
        self.assertEqual(polish.sibling_path("scene", "R0"), "scene.twist.funscript")
        self.assertEqual(polish.sibling_path("scene", "R1"), "scene.roll.funscript")
        self.assertEqual(polish.sibling_path("scene", "R2"), "scene.pitch.funscript")

    def test_tcode_full_sibling_set(self):
        paths = [polish.sibling_path("v", a) for a in polish.STATIONS["tcode"].axes]
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
        for sid in ("handy", "tcode", "lovense"):
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


import subprocess
import sys
import tempfile

_CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")


def _run_cli(*args):
    return subprocess.run(
        [sys.executable, _CLI, *args],
        capture_output=True, text=True,
        cwd=os.path.dirname(_CLI),
    )


def _cli_importable():
    """The full CLI pulls in app deps (plotly etc.) absent from minimal envs.
    Skip the subprocess tests there rather than report a false failure."""
    r = _run_cli("polish-read", os.devnull)
    return "ModuleNotFoundError" not in (r.stderr or "")


@unittest.skipUnless(_cli_importable(), "cli.py app deps not installed in this interpreter")
class TestPolishCLI(unittest.TestCase):
    """End-to-end through the real `python cli.py` entry point."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ff_polish_test_")
        self.main = os.path.join(self.tmp, "scene.funscript")
        acts = [{"at": i * 40, "pos": int(round(50 + 45 * math.sin(i * 40 / 90.0)))} for i in range(300)]
        with open(self.main, "w") as f:
            json.dump({"actions": acts}, f)
        # a twist sibling so the TCode station has an axis to clamp
        with open(os.path.join(self.tmp, "scene.twist.funscript"), "w") as f:
            json.dump({"actions": [{"at": i * 40, "pos": 50} for i in range(300)]}, f)

    def test_preview_emits_three_traces(self):
        r = _run_cli("polish-apply", self.main, "--station", "handy", "--preview",
                     "--start-ms", "0", "--end-ms", "2000")
        self.assertEqual(r.returncode, 0, r.stderr)
        pv = json.loads(r.stdout)
        self.assertEqual(pv["station"], "handy")
        for k in ("character", "clamped", "performed", "stats"):
            self.assertIn(k, pv)
        self.assertTrue(pv["clamped"])

    def test_apply_handy_writes_single_file(self):
        r = _run_cli("polish-apply", self.main, "--station", "handy")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(len(out["saved"]), 1)
        self.assertTrue(out["saved"][0].endswith("scene.handy.funscript"))
        self.assertTrue(os.path.exists(out["saved"][0]))

    def test_apply_tcode_writes_tcode_set(self):
        r = _run_cli("polish-apply", self.main, "--station", "tcode")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        names = sorted(os.path.basename(p) for p in out["saved"])
        # main L0 + the twist sibling that existed beside the source
        self.assertIn("scene.funscript", names)
        self.assertIn("scene.twist.funscript", names)

    def test_apply_estim_without_character_errors(self):
        # No characters.json beside the temp source -> nothing to generate;
        # report a helpful error rather than writing empty/wrong channels.
        r = _run_cli("polish-apply", self.main, "--station", "estim3p")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["saved"], [])
        self.assertIn("error", out)

    def test_apply_estim_generates_channels(self):
        # Assign a real character (whole-track, no chapters) and confirm the
        # 9-channel set is generated + clamped.
        cat = json.loads(_run_cli("list-characters", "--format", "json").stdout)
        chars = cat.get("characters") or []
        if not chars:
            self.skipTest("no stim characters available (funscript-tools missing)")
        char_id = chars[0]["id"]
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.characters.json"), "w") as f:
            json.dump({"version": 1, "characters": {"ch1": {"characterId": char_id, "params": {}}}}, f)
        r = _run_cli("polish-apply", self.main, "--station", "estim3p")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertGreater(len(out["saved"]), 0, out)
        self.assertTrue(any(p.endswith(".alpha.funscript") for p in out["saved"]))

    def test_channels_preview_returns_rebased_channels(self):
        # polish-channels feeds the Polish preview the ACTUAL e-stim channels
        # for a window, rebased to 0 so the UI window is 0-based.
        cat = json.loads(_run_cli("list-characters", "--format", "json").stdout)
        chars = cat.get("characters") or []
        if not chars:
            self.skipTest("no stim characters available (funscript-tools missing)")
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.characters.json"), "w") as f:
            json.dump({"version": 1, "characters": {"ch1": {"characterId": chars[0]["id"], "params": {}}}}, f)
        r = _run_cli("polish-channels", self.main, "--station", "estim3p",
                     "--start-ms", "2000", "--end-ms", "8000")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["window"], {"start_ms": 2000, "end_ms": 8000})
        self.assertIn("volume", out["channels"])
        self.assertIn("alpha", out["channels"])
        for acts in out["channels"].values():
            ats = [a["at"] for a in acts]
            self.assertGreaterEqual(min(ats), 0)            # rebased to window start
            self.assertLessEqual(max(ats), 6000)            # clipped to window length
            self.assertTrue(all(0 <= a["pos"] <= 100 for a in acts))

    def test_channels_preview_non_estim_is_empty(self):
        # Strokers preview the position motion truthfully — nothing to generate.
        r = _run_cli("polish-channels", self.main, "--station", "handy",
                     "--start-ms", "0", "--end-ms", "5000")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["channels"], {})

    def _gen_estim_volume(self):
        """Run estim generation and return the saved volume channel actions."""
        r = _run_cli("polish-apply", self.main, "--station", "estim3p")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        vol = next((p for p in out.get("saved", []) if p.endswith(".volume.funscript")), None)
        self.assertIsNotNone(vol, out)
        with open(vol) as f:
            return json.load(f)["actions"]

    def test_estim_bakes_authored_events(self):
        # Events authored in <stem>.feel.yml must bake into the generated e-stim
        # channels (restim/forgeplayer play channels, not events). A volume-
        # modulating event ('cum') over [2s,8s] must change the volume channel.
        cat = json.loads(_run_cli("list-characters", "--format", "json").stdout)
        chars = cat.get("characters") or []
        if not chars:
            self.skipTest("no stim characters available (funscript-tools missing)")
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.characters.json"), "w") as f:
            json.dump({"version": 1,
                       "characters": {"ch1": {"characterId": chars[0]["id"], "params": {}}}}, f)

        # 1. Generate with NO events (the deterministic baseline).
        base = self._gen_estim_volume()

        # 2. Author one volume-modulating event, regenerate.
        import yaml
        with open(os.path.join(forge, "scene.feel.yml"), "w") as f:
            yaml.safe_dump({"events": [{
                "id": "e1", "begin_ms": 2000, "end_ms": 8000,
                "effect": "cum", "intensity": 0.8,
                "params": {}, "devices": [], "overrides": {},
            }]}, f, sort_keys=False)
        baked = self._gen_estim_volume()

        # The event reshapes the volume channel — baked must differ from base.
        self.assertNotEqual(base, baked, "events did not bake into the volume channel")

    def test_estim_no_feel_yml_is_noop(self):
        # Absent feel.yml: generation still succeeds and the bake step is a
        # transparent pass-through (no crash, channels produced).
        cat = json.loads(_run_cli("list-characters", "--format", "json").stdout)
        if not (cat.get("characters") or []):
            self.skipTest("no stim characters available (funscript-tools missing)")
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.characters.json"), "w") as f:
            json.dump({"version": 1,
                       "characters": {"ch1": {"characterId": cat["characters"][0]["id"], "params": {}}}}, f)
        self.assertGreater(len(self._gen_estim_volume()), 0)

    def test_polish_yml_roundtrip_with_hash(self):
        passes = json.dumps({"passes": {"handy": {"accepted": True,
                                                  "accepted_at": "2026-06-04T00:00:00Z",
                                                  "knobs": {"maxBpm": 110}}}})
        w = _run_cli("polish-write", self.main, "--passes-json", passes)
        self.assertEqual(w.returncode, 0, w.stderr)
        rd = json.loads(_run_cli("polish-read", self.main).stdout)
        self.assertIn("handy", rd["passes"])
        # stamped hash matches the live source hash
        self.assertEqual(rd["passes"]["handy"]["source_hash"], rd["current_hash"])


if __name__ == "__main__":
    unittest.main()
