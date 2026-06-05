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

    def _assign_character(self):
        """Write a characters.json so e-stim generation has a character to use.
        Returns False (caller should skip) when no presets are available."""
        cat = json.loads(_run("list-characters", "--format", "json").stdout)
        chars = cat.get("characters") or []
        if not chars:
            return False
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.characters.json"), "w") as f:
            json.dump({"version": 1, "characters": {"ch1": {"characterId": chars[0]["id"], "params": {}}}}, f)
        return True

    def _stamp_estim(self):
        self.assertEqual(_run("polish-apply", self.main, "--station", "estim3p").returncode, 0)
        _run("polish-write", self.main, "--passes-json",
             json.dumps({"passes": {"estim3p": {"accepted": True}}}))

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

    def test_export_autogenerates_estim_from_characters_without_stamp(self):
        # Characters assigned in Channels but e-stim NOT stamped in Polish:
        # export should still generate the channel set ("skip Polish, still
        # get what you authored").
        if not self._assign_character():
            self.skipTest("no stim characters available")
        out = os.path.join(self.tmp, "autoestim.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            manifest = json.loads(z.read("manifest.ffmeta"))
        self.assertTrue(any(n.startswith("stations/estim3p/") for n in names), names)
        self.assertTrue(any(n.endswith(".alpha.funscript") for n in names), names)
        # Flagged as generated (not a Polish stamp) in the manifest.
        self.assertTrue(manifest["stations"].get("estim3p", {}).get("generated"))

    def test_export_no_characters_no_stations(self):
        # Bare funscript: no chapters.json AND no characters.json -> nothing
        # auto-generated (no arc fallback without chapters), motion still packs.
        out = os.path.join(self.tmp, "bare2.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("motion.funscript", names)
        self.assertFalse(any(n.startswith("stations/") for n in names), names)

    def test_export_default_arc_when_chapters_but_skipped_channels(self):
        # Analyzed project (chapters.json present) but Channels skipped (NO
        # characters.json): export auto-generates e-stim + multi-axis from the
        # position-derived default arc. This is the "skip from open to export"
        # path — touch nothing and still get coherent device files.
        cat = json.loads(_run("list-characters", "--format", "json").stdout)
        if not (cat.get("characters") or []):
            self.skipTest("no stim characters available")
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.chapters.json"), "w") as f:
            json.dump({"chapters": [
                {"at_ms": 0, "end_ms": 5000},
                {"at_ms": 5000, "end_ms": 9950},
            ]}, f)
        out = os.path.join(self.tmp, "defarc.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertTrue(any(n.startswith("stations/estim3p/") for n in names), names)
        self.assertTrue(any(n.startswith("stations/tcode/") for n in names), names)

    def test_stim_audio_opt_in_only(self):
        # e-stim channels present but neither --stim-wav nor --stim-mp3 -> no audio.
        if not self._assign_character():
            self.skipTest("no stim characters available")
        self._stamp_estim()
        no_audio = os.path.join(self.tmp, "noaudio.forge")
        _run("export", self.main, "--mode", "forge", "--out", no_audio)
        with zipfile.ZipFile(no_audio) as z:
            names = z.namelist()
        self.assertFalse(any(n.startswith("audio/") for n in names), names)

    def test_stim_wav_opt_in(self):
        if not self._assign_character():
            self.skipTest("no stim characters available")
        self._stamp_estim()
        out = os.path.join(self.tmp, "wav.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--stim-wav")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("audio/stim.wav", names)
        self.assertNotIn("audio/stim.mp3", names)

    def test_stim_mp3_opt_in(self):
        import shutil
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg not on PATH")
        if not self._assign_character():
            self.skipTest("no stim characters available")
        self._stamp_estim()
        out = os.path.join(self.tmp, "mp3.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--stim-mp3")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("audio/stim.mp3", names)
        self.assertNotIn("audio/stim.wav", names)

    def test_stim_wav_and_mp3_both(self):
        import shutil
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg not on PATH")
        if not self._assign_character():
            self.skipTest("no stim characters available")
        self._stamp_estim()
        out = os.path.join(self.tmp, "both.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--stim-wav", "--stim-mp3")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("audio/stim.wav", names)
        self.assertIn("audio/stim.mp3", names)


if __name__ == "__main__":
    unittest.main()
