"""Tests for `cli.py export` — the bundle packager.

Export collects the motion track + Polish's stamped station files + events +
authoring sidecars + a manifest, into a loose folder or a `.forge` zip.
Subprocess-driven through the real CLI; skipped when app deps are absent.
"""

import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

_CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")


def _run(*args):
    return subprocess.run(
        [sys.executable, _CLI, *args],
        capture_output=True, text=True, cwd=os.path.dirname(_CLI),
    )


def _cli_importable():
    return "ModuleNotFoundError" not in (_run("polish-read", os.devnull).stderr or "")


@unittest.skipUnless(_cli_importable(), "cli.py app deps not installed in this interpreter")
class TestExportCLI(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ff_export_test_")
        self.main = os.path.join(self.tmp, "scene.funscript")
        acts = [{"at": i * 50, "pos": int(round(50 + 40 * math.sin(i * 50 / 120.0)))} for i in range(200)]
        with open(self.main, "w") as f:
            json.dump({"actions": acts}, f)

    def _stamp_handy(self):
        self.assertEqual(_run("polish-apply", self.main, "--station", "handy").returncode, 0)
        passes = json.dumps({"passes": {"handy": {"accepted": True, "accepted_at": "2026-06-04T00:00:00Z"}}})
        self.assertEqual(_run("polish-write", self.main, "--passes-json", passes).returncode, 0)

    def test_forge_zip_contains_motion_manifest_and_station(self):
        self._stamp_handy()
        out = os.path.join(self.tmp, "scene.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(out))
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            self.assertIn("motion.funscript", names)
            self.assertIn("manifest.ffmeta", names)
            self.assertTrue(any(n.startswith("stations/handy/") for n in names), names)
            manifest = json.loads(z.read("manifest.ffmeta"))
        self.assertEqual(manifest["schema"], "ffmeta/v1")
        self.assertIn("handy", manifest["stations"])
        self.assertTrue(any(a["role"] == "stroke" for a in manifest["artifacts"]))
        self.assertTrue(any(a.get("station") == "handy" for a in manifest["artifacts"]))

    def test_loose_folder(self):
        self._stamp_handy()
        out = os.path.join(self.tmp, "scene_export")
        r = _run("export", self.main, "--mode", "loose", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(os.path.join(out, "motion.funscript")))
        self.assertTrue(os.path.exists(os.path.join(out, "manifest.ffmeta")))
        self.assertTrue(os.path.exists(os.path.join(out, "stations", "handy")))

    def test_export_without_polish_still_packs_motion(self):
        out = os.path.join(self.tmp, "bare.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("motion.funscript", names)
        self.assertIn("manifest.ffmeta", names)
        self.assertFalse(any(n.startswith("stations/") for n in names), names)

    def test_finalize_flags_accepted(self):
        # --blend-seams/--final-smooth shouldn't error and still produce motion.
        out = os.path.join(self.tmp, "fin.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--blend-seams", "--final-smooth")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            self.assertIn("motion.funscript", z.namelist())

    def test_waveform_thumbnail_always(self):
        out = os.path.join(self.tmp, "wf.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            self.assertIn("thumbnails/waveform.png", z.namelist())

    def test_stim_wav_opt_in_only(self):
        # e-stim stamped but --stim-wav NOT passed -> no audio/stim.wav.
        self.assertEqual(_run("polish-apply", self.main, "--station", "estim3p").returncode, 0)
        _run("polish-write", self.main, "--passes-json",
             json.dumps({"passes": {"estim3p": {"accepted": True}}}))
        no_wav = os.path.join(self.tmp, "nowav.forge")
        _run("export", self.main, "--mode", "forge", "--out", no_wav)
        with zipfile.ZipFile(no_wav) as z:
            self.assertNotIn("audio/stim.wav", z.namelist())


if __name__ == "__main__":
    unittest.main()
