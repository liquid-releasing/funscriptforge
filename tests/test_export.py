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
        # Loose output is the human, device-organized view: universal stroke at
        # top, a Handy/ folder, manifest + README. (Machine layout — motion.funscript,
        # stations/<id>/ — lives in the .forge bundle, not here.)
        self._stamp_handy()
        out = os.path.join(self.tmp, "scene_export")
        r = _run("export", self.main, "--mode", "loose", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(os.path.join(out, "scene.funscript")))
        self.assertTrue(os.path.exists(os.path.join(out, "manifest.ffmeta")))
        self.assertTrue(os.path.isdir(os.path.join(out, "Handy")))
        self.assertTrue(os.path.exists(os.path.join(out, "README.txt")))

    def test_loose_output_is_device_organized(self):
        # Device folders + README + universal stroke at top; re-edit metadata
        # (chapters.json) stays in the .forge backup, NOT the loose deliverable.
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.chapters.json"), "w") as f:
            json.dump({"chapters": [{"at_ms": 0, "end_ms": 9950}]}, f)
        self._stamp_handy()
        out = os.path.join(self.tmp, "human")
        r = _run("export", self.main, "--mode", "loose", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(os.path.join(out, "scene.funscript")))
        self.assertTrue(os.path.isdir(os.path.join(out, "Handy")))
        readme = open(os.path.join(out, "README.txt"), encoding="utf-8").read()
        self.assertIn("Handy", readme)
        self.assertFalse(os.path.exists(os.path.join(out, "chapters.json")))
        self.assertFalse(os.path.exists(os.path.join(out, "scene.chapters.json")))

    def test_loose_default_is_dot_output_and_increments(self):
        # Default loose destination is <stem>.output/; a second export versions
        # the FOLDER name (scene.output -> scene.output (1)), not the extension.
        r1 = _run("export", self.main, "--mode", "loose")
        self.assertEqual(r1.returncode, 0, r1.stderr)
        p1 = json.loads(r1.stdout)["path"]
        self.assertTrue(p1.replace("\\", "/").endswith("scene.output"), p1)
        r2 = _run("export", self.main, "--mode", "loose")
        self.assertEqual(r2.returncode, 0, r2.stderr)
        p2 = json.loads(r2.stdout)["path"]
        self.assertTrue(p2.replace("\\", "/").endswith("scene.output (1)"), p2)

    def test_export_without_polish_still_packs_motion(self):
        out = os.path.join(self.tmp, "bare.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertIn("motion.funscript", names)
        self.assertIn("manifest.ffmeta", names)
        # Skipping Polish means ACCEPTING ITS DEFAULTS, so stations that need
        # only the motion track -- the per-device stroker clamps and the
        # shaker envelope -- are generated here. Changed deliberately
        # 2026-09-05: naming two stations meant a skipped Polish tab silently
        # shipped no FOC-Stim and no shaker at all.
        #
        # The invariant that still matters: nothing DERIVED from data this
        # project does not have. e-stim needs a per-chapter character and
        # TCode needs a Mechanical style, so neither may appear for a bare
        # funscript -- that is what this test protects.
        derived = [n for n in names if n.startswith((
            "stations/estim3p/", "stations/focstim/", "stations/focstim4p/",
            "stations/tcode/",
        ))]
        self.assertFalse(derived, names)
        self.assertTrue(any(n.startswith("stations/handy/") for n in names), names)

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
            self.assertIn("thumbnails/funscript.png", z.namelist())

    def test_exclude_drops_target_groups(self):
        # --exclude leaves out whole target groups (the Export-tab checkboxes).
        # Excluding strokers + preview drops motion.funscript + thumbnails.
        out = os.path.join(self.tmp, "ex.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--exclude", "strokers,preview")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        self.assertNotIn("motion.funscript", names)
        self.assertFalse(any(n.startswith("thumbnails/") for n in names), names)
        self.assertIn("manifest.ffmeta", names)  # manifest always rides

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
        # Skipping Polish means ACCEPTING ITS DEFAULTS, so stations that need
        # only the motion track -- the per-device stroker clamps and the
        # shaker envelope -- are generated here. Changed deliberately
        # 2026-09-05: naming two stations meant a skipped Polish tab silently
        # shipped no FOC-Stim and no shaker at all.
        #
        # The invariant that still matters: nothing DERIVED from data this
        # project does not have. e-stim needs a per-chapter character and
        # TCode needs a Mechanical style, so neither may appear for a bare
        # funscript -- that is what this test protects.
        derived = [n for n in names if n.startswith((
            "stations/estim3p/", "stations/focstim/", "stations/focstim4p/",
            "stations/tcode/",
        ))]
        self.assertFalse(derived, names)
        self.assertTrue(any(n.startswith("stations/handy/") for n in names), names)

    def test_skipping_polish_generates_every_estim_station(self):
        """Skipping Polish means accepting its defaults -- for EVERY station.

        The export's fallback used to name estim3p and tcode specifically, so
        a user who never opened the Polish tab silently got no FOC-Stim files
        at all (user, 2026-09-05: "it should generate all of the devices, even
        experimental ones"). Nothing else pins that; the two tests this change
        touched only assert what must NOT appear.
        """
        if not self._assign_character():
            self.skipTest("no stim characters available")
        out = os.path.join(self.tmp, "allstations.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        for sid in ("estim3p", "focstim", "focstim4p"):
            self.assertTrue(
                any(n.startswith(f"stations/{sid}/") for n in names),
                f"{sid} was not generated: {names}",
            )

    def test_four_phase_exports_electrodes_not_positions(self):
        """Four-phase hardware wants a power per electrode, not a position.

        focstim4p writes e1..e4 and drops alpha/beta -- position channels are
        meaningless to a four-electrode driver, and shipping them would look
        like a usable file that the device cannot read.
        """
        if not self._assign_character():
            self.skipTest("no stim characters available")
        out = os.path.join(self.tmp, "fourphase.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
        four = [n for n in names if n.startswith("stations/focstim4p/")]
        self.assertTrue(four, f"no four-phase station: {names}")
        for ch in ("e1", "e2", "e3", "e4"):
            self.assertTrue(
                any(n.endswith(f".{ch}.funscript") for n in four),
                f"{ch} missing from four-phase: {four}",
            )
        for pos in ("alpha", "beta", "alpha-prostate", "beta-prostate"):
            self.assertFalse(
                any(n.endswith(f".{pos}.funscript") for n in four),
                f"four-phase must not write {pos}: {four}",
            )

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

    def test_export_analysis_sidecars_and_preview_images(self):
        # beats.json + audio.json ride for downstream; audio + spectrogram
        # preview PNGs render media-free from the cached sidecars; the manifest
        # carries the assessment summary (self-describing bundle).
        import base64
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        with open(os.path.join(forge, "scene.audio.json"), "w") as f:
            json.dump({"version": "1.0", "hop_ms": 10, "duration_ms": 10000,
                       "peaks": [abs(math.sin(i / 20)) * 0.9 for i in range(1000)],
                       "peak_count": 1000}, f)
        with open(os.path.join(forge, "scene.beats.json"), "w") as f:
            json.dump({"version": "1.0", "bpm": 120,
                       "beats": [i * 500 for i in range(20)],
                       "downbeats": [i * 2000 for i in range(5)]}, f)
        n_mels, n_frames = 64, 300
        cells = bytes((i * 7) % 128 for i in range(n_mels * n_frames))
        with open(os.path.join(forge, "scene.spectrogram.json"), "w") as f:
            json.dump({"version": "1.0", "hop_ms": 23, "n_mels": n_mels, "n_frames": n_frames,
                       "duration_ms": 7000, "fmax": 8000, "db_floor": -80.0, "db_ceiling": 0.0,
                       "cells_b64": base64.b64encode(cells).decode()}, f)
        out = os.path.join(self.tmp, "rich.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            manifest = json.loads(z.read("manifest.ffmeta"))
        self.assertIn("beats.json", names)
        self.assertIn("audio.json", names)
        self.assertIn("thumbnails/funscript.png", names)
        self.assertIn("thumbnails/audio.png", names)
        self.assertIn("thumbnails/spectrogram.png", names)
        self.assertIn("assessment", manifest, "manifest missing self-describing assessment summary")

    def test_export_never_overwrites_increments(self):
        # Re-exporting to the same path must NOT clobber — it versions up.
        out = os.path.join(self.tmp, "dup.forge")
        r1 = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r1.returncode, 0, r1.stderr)
        self.assertEqual(json.loads(r1.stdout)["path"], out)
        r2 = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r2.returncode, 0, r2.stderr)
        p2 = json.loads(r2.stdout)["path"]
        self.assertTrue(p2.endswith("(1).forge"), p2)
        self.assertTrue(os.path.exists(out) and os.path.exists(p2))

    def test_lineage_id_stable_version_increments(self):
        # project_id is stable across exports; project_version is monotonic.
        o1 = os.path.join(self.tmp, "v1.forge")
        o2 = os.path.join(self.tmp, "v2.forge")
        self.assertEqual(_run("export", self.main, "--mode", "forge", "--out", o1).returncode, 0)
        self.assertEqual(_run("export", self.main, "--mode", "forge", "--out", o2).returncode, 0)
        with zipfile.ZipFile(o1) as z:
            m1 = json.loads(z.read("manifest.ffmeta"))
        with zipfile.ZipFile(o2) as z:
            m2 = json.loads(z.read("manifest.ffmeta"))
        self.assertTrue(m1["project_id"])
        self.assertEqual(m1["project_id"], m2["project_id"])
        self.assertEqual(m1["project_version"], 1)
        self.assertEqual(m2["project_version"], 2)

    def test_media_provenance_recorded_lean(self):
        # Default (lean): no media bytes in the bundle, but the manifest records
        # a relink key (filename + size + head hash).
        media = os.path.join(self.tmp, "scene.mp4")
        with open(media, "wb") as f:
            f.write(b"\x00\x11\x22" * 100_000)
        out = os.path.join(self.tmp, "lean.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--media", media)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            m = json.loads(z.read("manifest.ffmeta"))
        self.assertFalse(any(n.startswith("media/") for n in names), names)
        self.assertEqual(m["media"]["filename"], "scene.mp4")
        self.assertFalse(m["media"]["bundled"])
        self.assertIn("head_sha256", m["media"])

    def test_include_media_embeds_bytes(self):
        media = os.path.join(self.tmp, "scene.mp4")
        with open(media, "wb") as f:
            f.write(b"forge-media-payload" * 1000)
        out = os.path.join(self.tmp, "fat.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--media", media, "--include-media")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            m = json.loads(z.read("manifest.ffmeta"))
        self.assertIn("media/scene.mp4", names)
        self.assertTrue(m["media"]["bundled"])


@unittest.skipUnless(_cli_importable(), "cli.py app deps not installed in this interpreter")
class TestImportCLI(unittest.TestCase):
    """`cli.py import` — unpack a `.forge` bundle back into a re-editable
    project. Round-trips against the real `export` so the two stay in sync."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ff_import_test_")
        self.main = os.path.join(self.tmp, "scene.funscript")
        acts = [{"at": i * 50, "pos": int(round(50 + 40 * math.sin(i * 50 / 120.0)))} for i in range(200)]
        with open(self.main, "w") as f:
            json.dump({"actions": acts}, f)
        # A forge dir with a chapters sidecar so the bundle carries authoring.
        self.forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(self.forge, exist_ok=True)
        with open(os.path.join(self.forge, "scene.chapters.json"), "w") as f:
            json.dump({"chapters": [{"at_ms": 0, "end_ms": 9950}]}, f)

    def _stamp_handy(self):
        self.assertEqual(_run("polish-apply", self.main, "--station", "handy").returncode, 0)
        passes = json.dumps({"passes": {"handy": {"accepted": True, "accepted_at": "2026-06-04T00:00:00Z"}}})
        self.assertEqual(_run("polish-write", self.main, "--passes-json", passes).returncode, 0)

    def _export_forge(self, name="scene.forge"):
        out = os.path.join(self.tmp, name)
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        return out

    def test_roundtrip_forge_zip_restores_project(self):
        self._stamp_handy()
        bundle = self._export_forge()
        dest = os.path.join(self.tmp, "imported")
        r = _run("import", bundle, "--out", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout)

        # The funscript the app opens.
        fs = res["funscript_path"]
        self.assertEqual(fs, os.path.join(dest, "scene.funscript"))
        self.assertTrue(os.path.exists(fs))
        with open(fs) as f:
            self.assertEqual(len(json.load(f)["actions"]), 200)

        forge = os.path.join(dest, ".scene.forge")
        # Authoring sidecar restored with its stem-prefixed name.
        self.assertTrue(os.path.exists(os.path.join(forge, "scene.chapters.json")))
        # Manifest surfaced as the ffmeta sidecar load_project reads.
        self.assertTrue(os.path.exists(os.path.join(forge, "scene.ffmeta.json")))
        # Stamped station restored + a polish.yml marking it accepted.
        self.assertTrue(os.path.isdir(os.path.join(forge, "polish", "handy")))
        ppath = os.path.join(forge, "scene.polish.yml")
        self.assertTrue(os.path.exists(ppath))
        import yaml
        passes = (yaml.safe_load(open(ppath, encoding="utf-8").read()) or {}).get("passes") or {}
        self.assertTrue(passes.get("handy", {}).get("accepted"))

    def test_import_from_unzipped_bundle_dir(self):
        # An unzipped .forge (machine layout) imports identically to the zip.
        bundle = self._export_forge()
        unz = os.path.join(self.tmp, "unzipped")
        with zipfile.ZipFile(bundle) as z:
            z.extractall(unz)
        dest = os.path.join(self.tmp, "imported_dir")
        r = _run("import", unz, "--out", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(os.path.join(dest, "scene.funscript")))
        self.assertTrue(os.path.exists(os.path.join(dest, ".scene.forge", "scene.chapters.json")))

    def test_import_rejects_output_folder(self):
        # The human <stem>.output/ deliverable is NOT an import source — point
        # the user at the .forge backup instead.
        out = os.path.join(self.tmp, "scene.output")
        self.assertEqual(_run("export", self.main, "--mode", "loose", "--out", out).returncode, 0)
        r = _run("import", out, "--out", os.path.join(self.tmp, "nope2"))
        self.assertEqual(r.returncode, 1)
        self.assertIn(".forge", r.stderr)

    def test_import_defaults_dest_to_bundle_folder(self):
        # No --out: extract beside the bundle.
        sub = os.path.join(self.tmp, "delivery")
        os.makedirs(sub, exist_ok=True)
        bundle = os.path.join(sub, "scene.forge")
        self.assertEqual(_run("export", self.main, "--mode", "forge", "--out", bundle).returncode, 0)
        r = _run("import", bundle)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout)
        self.assertEqual(res["dest"], sub)
        self.assertTrue(os.path.exists(os.path.join(sub, "scene.funscript")))

    def test_import_rejects_bundle_without_motion(self):
        # Exporting with strokers excluded drops motion.funscript; import then
        # has no stroke track to bootstrap a project and must fail cleanly.
        bundle = os.path.join(self.tmp, "nomotion.forge")
        self.assertEqual(
            _run("export", self.main, "--mode", "forge", "--out", bundle, "--exclude", "strokers").returncode, 0)
        r = _run("import", bundle, "--out", os.path.join(self.tmp, "nope"))
        self.assertEqual(r.returncode, 1)
        self.assertIn("motion", r.stderr.lower())

    def test_events_roundtrip_reconstructs_feel(self):
        # Author an event, export (renders events.yml), import (reconstructs
        # feel.yml). Tolerant: skips if no recipe catalog or events.yml absent.
        recs = json.loads(_run("list-event-recipes").stdout or "{}")
        recipes = recs.get("recipes") or recs.get("events") or []
        if not recipes:
            self.skipTest("no event recipes available")
        effect_id = recipes[0].get("id") or recipes[0].get("effectId")
        if not effect_id:
            self.skipTest("recipe has no id")
        events = [{"id": "e1", "beginMs": 1000, "endMs": 4000, "effectId": effect_id,
                   "intensity": 0.8, "params": {}, "devices": [], "deviceCfg": {}}]
        ev_json = os.path.join(self.tmp, "ev.json")
        with open(ev_json, "w") as f:
            json.dump(events, f)
        if _run("feel-write", self.main, "--events-json", ev_json).returncode != 0:
            self.skipTest("feel-write unavailable")
        bundle = self._export_forge("withevents.forge")
        with zipfile.ZipFile(bundle) as z:
            if "events.yml" not in z.namelist():
                self.skipTest("export did not emit events.yml for this recipe")
        dest = os.path.join(self.tmp, "ev_imported")
        self.assertEqual(_run("import", bundle, "--out", dest).returncode, 0)
        forge = os.path.join(dest, ".scene.forge")
        # The playable sibling AND the re-editable canonical feel.yml.
        self.assertTrue(os.path.exists(os.path.join(forge, "scene.events.yml")))
        feel = os.path.join(forge, "scene.feel.yml")
        self.assertTrue(os.path.exists(feel))
        import yaml
        doc = yaml.safe_load(open(feel, encoding="utf-8").read()) or {}
        self.assertTrue(doc.get("events"), "feel.yml has no events after reconstruction")

    def test_import_no_clobber_versions_stem(self):
        # Importing the same bundle into a dir that already has that project
        # lands as "scene (1)" rather than overwriting the live working copy.
        bundle = self._export_forge()
        dest = os.path.join(self.tmp, "twice")
        self.assertEqual(_run("import", bundle, "--out", dest).returncode, 0)
        r2 = _run("import", bundle, "--out", dest)
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertEqual(os.path.basename(json.loads(r2.stdout)["funscript_path"]), "scene (1).funscript")
        self.assertTrue(os.path.exists(os.path.join(dest, "scene.funscript")))
        self.assertTrue(os.path.exists(os.path.join(dest, "scene (1).funscript")))

    def test_import_then_export_continues_lineage(self):
        # Import inherits the bundle's project_id; a re-export from the imported
        # working copy is v(N+1) of the SAME project, not a fresh id.
        bundle = self._export_forge()  # v1
        with zipfile.ZipFile(bundle) as z:
            m1 = json.loads(z.read("manifest.ffmeta"))
        dest = os.path.join(self.tmp, "cont")
        self.assertEqual(_run("import", bundle, "--out", dest).returncode, 0)
        fs = os.path.join(dest, "scene.funscript")
        out2 = os.path.join(dest, "scene-next.forge")
        self.assertEqual(_run("export", fs, "--mode", "forge", "--out", out2).returncode, 0)
        with zipfile.ZipFile(out2) as z:
            m2 = json.loads(z.read("manifest.ffmeta"))
        self.assertEqual(m2["project_id"], m1["project_id"])
        self.assertEqual(m2["project_version"], m1["project_version"] + 1)

    def test_import_extracts_bundled_media(self):
        # --include-media bundle: import extracts the media next to the funscript
        # (renamed to the project stem so load_project finds it).
        media = os.path.join(self.tmp, "scene.mp4")
        with open(media, "wb") as f:
            f.write(b"payload" * 5000)
        bundle = os.path.join(self.tmp, "withmedia.forge")
        self.assertEqual(
            _run("export", self.main, "--mode", "forge", "--out", bundle,
                 "--media", media, "--include-media").returncode, 0)
        dest = os.path.join(self.tmp, "mediaimp")
        r = _run("import", bundle, "--out", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout)
        self.assertTrue(res["media"], res)
        self.assertEqual(os.path.basename(res["media"]), "scene.mp4")
        self.assertTrue(os.path.exists(os.path.join(dest, "scene.mp4")))

    def test_import_lean_reports_media_expected(self):
        # Lean bundle imported into a dir with no sibling media: media is null,
        # media_expected names the file to relink (UI's "locate it" prompt).
        media = os.path.join(self.tmp, "scene.mp4")
        with open(media, "wb") as f:
            f.write(b"x" * 1000)
        bundle = os.path.join(self.tmp, "leanbundle.forge")
        self.assertEqual(
            _run("export", self.main, "--mode", "forge", "--out", bundle, "--media", media).returncode, 0)
        dest = os.path.join(self.tmp, "leanimp")
        r = _run("import", bundle, "--out", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        res = json.loads(r.stdout)
        self.assertIsNone(res["media"])
        self.assertEqual(res["media_expected"], "scene.mp4")

    def _write_beatmap(self):
        """Drop a minimal <stem>.beatmap.json in the forge dir so the export's
        beat-track step has timestamps to render from."""
        forge = os.path.join(self.tmp, ".scene.forge")
        os.makedirs(forge, exist_ok=True)
        beats = list(range(0, 9000, 500))  # a beat every 0.5s for 9s
        bm = {"bpm": 120.0, "duration_ms": 9000, "beats": beats,
              "downbeats": beats[::4], "stanzas": [], "energy": []}
        with open(os.path.join(forge, "scene.beatmap.json"), "w") as f:
            json.dump(bm, f)

    def test_beat_mp3_rendered_from_beatmap(self):
        # A beatmap sidecar → audio/beat.mp3 (metronome click track) ships by
        # default, with no media and no e-stim channels needed.
        self._write_beatmap()
        out = os.path.join(self.tmp, "scene.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            self.assertIn("audio/beat.mp3", names)
            self.assertGreater(z.getinfo("audio/beat.mp3").file_size, 0)
            manifest = json.loads(z.read("manifest.ffmeta"))
        self.assertTrue(any(a.get("role") == "beat" for a in manifest["artifacts"]))

    def test_no_beat_mp3_opt_out(self):
        # --no-beat-mp3 suppresses the click track even when a beatmap exists.
        self._write_beatmap()
        out = os.path.join(self.tmp, "scene.forge")
        r = _run("export", self.main, "--mode", "forge", "--out", out, "--no-beat-mp3")
        self.assertEqual(r.returncode, 0, r.stderr)
        with zipfile.ZipFile(out) as z:
            self.assertNotIn("audio/beat.mp3", z.namelist())


class TestBeatRenderer(unittest.TestCase):
    """The reusable click-track synth — pure, needs only beat timestamps."""

    def test_clicks_land_at_beat_samples(self):
        import cli
        sr = 8000
        wave = cli._synth_click_track([0, 1000, 2000], 3.0, sr=sr)
        self.assertEqual(len(wave), 3 * sr)
        # Energy present at each beat onset, silence well between them.
        for b_ms in (0, 1000, 2000):
            i = int(b_ms / 1000.0 * sr)
            self.assertGreater(abs(wave[i : i + 100]).max(), 0.1)
        mid = int(0.5 * sr)  # halfway between beat 0 and 1 — past the 35ms tick
        self.assertLess(abs(wave[mid : mid + 100]).max(), 1e-3)

    def test_downbeats_are_accented(self):
        import cli
        sr = 8000
        wave = cli._synth_click_track([0, 500], 1.0, downbeats=[0], sr=sr)
        peak0 = abs(wave[0:200]).max()
        peak1 = abs(wave[int(0.5 * sr) : int(0.5 * sr) + 200]).max()
        self.assertGreater(peak0, peak1)  # downbeat louder than the regular beat


if __name__ == "__main__":
    unittest.main()
