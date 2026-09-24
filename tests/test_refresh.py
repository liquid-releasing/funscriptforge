"""Output-pipeline versioning and the refresh path.

Why this exists: a `.forge` bundle recorded `created_with: "FunscriptForge"`
and no version, so nothing on disk said which engine built it. When
`blend_seams` was found to be flattening every exported motion track, there
was no way to tell an affected bundle from a good one except by measuring the
funscript. These tests pin the stamp, the staleness rule, and the status
report a UI (or forgeassembler's importer) reads to decide whether output can
be trusted.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cli as ffcli  # noqa: E402
from forge.pipeline_version import (  # noqa: E402
    OUTPUT_PIPELINE_VERSION, PIPELINE_CHANGELOG, is_stale, changes_since,
)


class TestPipelineVersion(unittest.TestCase):
    def test_version_is_a_plain_integer_string(self):
        # Compared as a string on both sides (Python and api/forge.js); an
        # accidental float or int would break the JS mirror's !== check.
        self.assertIsInstance(OUTPUT_PIPELINE_VERSION, str)
        self.assertTrue(OUTPUT_PIPELINE_VERSION.isdigit())

    def test_every_version_has_a_changelog_entry(self):
        # The entry is what the user reads to decide whether to re-render.
        # A bump with no entry produces a prompt that cannot answer "why?".
        self.assertIn(OUTPUT_PIPELINE_VERSION, PIPELINE_CHANGELOG)

    def test_current_version_is_not_stale(self):
        self.assertFalse(is_stale(OUTPUT_PIPELINE_VERSION))

    def test_unstamped_output_is_stale(self):
        # Deliberately unlike ANALYZER_VERSION, which grandfathers a missing
        # stamp. Every bundle predating stamping was built by the pipeline
        # that flattened the motion track, so it is known-bad, not unknown.
        self.assertTrue(is_stale(None))

    def test_older_version_is_stale(self):
        self.assertTrue(is_stale("1"))

    def test_changes_since_explains_why(self):
        reasons = changes_since("1")
        self.assertTrue(reasons)
        self.assertTrue(any("flatten" in r.lower() for r in reasons))

    def test_changes_since_current_is_empty(self):
        self.assertEqual(changes_since(OUTPUT_PIPELINE_VERSION), [])

    def test_changes_since_unstamped_covers_everything(self):
        self.assertEqual(changes_since(None), changes_since("1"))

    def test_changes_since_tolerates_junk(self):
        # A hand-edited or corrupt manifest must not crash the status read.
        self.assertTrue(changes_since("banana"))


class TestProjectStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "scene.funscript")
        actions = [{"at": i * 250, "pos": 10 if i % 2 else 90} for i in range(40)]
        with open(self.src, "w", encoding="utf-8") as f:
            json.dump({"actions": actions}, f)
        self.forge = Path(ffcli._forge_dir_for(self.src))
        self.forge.mkdir(parents=True, exist_ok=True)

    def _write_bundle_manifest(self, version):
        """An unzipped bundle folder — _read_bundle_manifest accepts both."""
        bundle = Path(ffcli._bundle_for(self.src))
        bundle.mkdir(parents=True, exist_ok=True)
        payload = {"schema": "ffmeta/v1", "stem": "scene"}
        if version is not None:
            payload["pipeline_version"] = version
        (bundle / "manifest.ffmeta").write_text(json.dumps(payload), encoding="utf-8")

    def test_never_exported_is_not_reported_as_stale(self):
        # "You have never exported" and "your export is out of date" are
        # different situations and must not produce the same prompt.
        st = ffcli.project_status(self.src)
        self.assertEqual(st["state"], "never-exported")
        self.assertIsNone(st["bundle"])

    def test_unstamped_bundle_is_stale_with_a_reason(self):
        self._write_bundle_manifest(None)
        st = ffcli.project_status(self.src)
        self.assertEqual(st["state"], "stale")
        self.assertTrue(st["reasons"])

    def test_current_bundle_is_current(self):
        self._write_bundle_manifest(OUTPUT_PIPELINE_VERSION)
        st = ffcli.project_status(self.src)
        self.assertEqual(st["state"], "current")
        self.assertEqual(st["reasons"], [])

    def test_missing_stations_are_reported_but_are_not_staleness(self):
        # Adding a station is an opportunity, not a defect. A project that
        # never stamped FOC-Stim is not broken, and must not be nagged as if
        # its outputs were wrong.
        self._write_bundle_manifest(OUTPUT_PIPELINE_VERSION)
        st = ffcli.project_status(self.src)
        self.assertEqual(st["state"], "current")
        self.assertTrue(st["stations_missing"])
        self.assertIn("handy", st["stations_available"])

    def test_work_funscript_is_used_when_present(self):
        self.assertFalse(ffcli.project_status(self.src)["has_working_edits"])
        (self.forge / "scene.work.funscript").write_text(
            json.dumps({"actions": []}), encoding="utf-8")
        st = ffcli.project_status(self.src)
        self.assertTrue(st["has_working_edits"])
        self.assertTrue(st["work_funscript"].endswith(".work.funscript"))

    def test_status_survives_a_corrupt_manifest(self):
        bundle = Path(ffcli._bundle_for(self.src))
        bundle.mkdir(parents=True, exist_ok=True)
        (bundle / "manifest.ffmeta").write_text("{not json", encoding="utf-8")
        st = ffcli.project_status(self.src)   # must not raise
        self.assertEqual(st["state"], "never-exported")


class TestProjectDiscovery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def _project(self, stem, with_forge=True):
        p = os.path.join(self.tmp, stem + ".funscript")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"actions": [{"at": 0, "pos": 0}]}, f)
        if with_forge:
            Path(ffcli._forge_dir_for(p)).mkdir(parents=True, exist_ok=True)
        return p

    def test_finds_projects_with_a_forge_dir(self):
        self._project("a")
        self._project("b")
        self.assertEqual(len(ffcli._projects_under(self.tmp)), 2)

    def test_ignores_a_bare_funscript_nobody_has_opened(self):
        self._project("a")
        self._project("loose", with_forge=False)
        found = ffcli._projects_under(self.tmp)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].endswith("a.funscript"))

    def test_ignores_our_own_outputs(self):
        # A library walk must not try to refresh work copies or the funscripts
        # inside a bundle/working dir -- that would rebuild from its own output.
        p = self._project("a")
        forge = Path(ffcli._forge_dir_for(p))
        (forge / "a.work.funscript").write_text('{"actions":[]}', encoding="utf-8")
        (forge / "nested.funscript").write_text('{"actions":[]}', encoding="utf-8")
        out = Path(self.tmp) / "a.output"
        out.mkdir(parents=True, exist_ok=True)
        (out / "motion.funscript").write_text('{"actions":[]}', encoding="utf-8")
        found = ffcli._projects_under(self.tmp)
        self.assertEqual(found, [p])

    def test_a_single_file_path_is_accepted_directly(self):
        p = self._project("a")
        self.assertEqual(ffcli._projects_under(p), [p])


class TestExportOptionInheritance(unittest.TestCase):
    """A refresh must not quietly ship less than it replaced.

    The first working version of `refresh` rebuilt the motion track correctly
    and produced a 3.6 MB bundle where the original was 85 MB -- it had lost
    audio/stim.mp3, audio/stim-prostate.mp3 and every media-derived thumbnail,
    because those come from opt-in flags that nothing on disk recorded. The
    manifest's artifact list is the record.
    """

    def _opts(self, paths, media=None, src="/tmp/scene.funscript"):
        manifest = {"artifacts": [{"path": p} for p in paths]}
        if media is not None:
            manifest["media"] = media
        return ffcli._export_opts_from_manifest(manifest, src)

    def test_stim_mp3_is_inherited(self):
        self.assertIn("--stim-mp3", self._opts(["audio/stim.mp3"]))

    def test_stim_wav_is_inherited(self):
        self.assertIn("--stim-wav", self._opts(["audio/stim.wav"]))

    def test_prostate_variant_also_counts_as_stim_audio(self):
        # The real bundle carried audio/stim-prostate.mp3; a prefix match on
        # "audio/stim" catches both without enumerating channel variants.
        self.assertIn("--stim-mp3", self._opts(["audio/stim-prostate.mp3"]))

    def test_no_stim_audio_means_no_flag(self):
        opts = self._opts(["motion.funscript", "audio/beat.mp3"])
        self.assertNotIn("--stim-mp3", opts)
        self.assertNotIn("--stim-wav", opts)

    def test_absent_beat_track_is_explicitly_disabled(self):
        # --beat-mp3 defaults ON, so a bundle built without it needs the
        # negative flag or the refresh would ADD content.
        self.assertIn("--no-beat-mp3", self._opts(["motion.funscript"]))

    def test_present_beat_track_is_left_at_the_default(self):
        self.assertNotIn("--no-beat-mp3", self._opts(["audio/beat.mp3"]))

    def test_bundled_media_is_inherited(self):
        opts = self._opts(["motion.funscript"], media={"bundled": True})
        self.assertIn("--include-media", opts)

    def test_lean_bundle_does_not_embed_media(self):
        opts = self._opts(["motion.funscript"], media={"bundled": False})
        self.assertNotIn("--include-media", opts)

    def test_media_is_passed_when_frame_thumbnails_were_present(self):
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "scene.funscript")
        open(src, "w").close()
        vid = os.path.join(tmp, "scene.mp4")
        open(vid, "w").close()
        opts = self._opts(["thumbnails/hero.png", "thumbnails/chapter_01.png"],
                          media={"filename": "scene.mp4"}, src=src)
        self.assertIn("--media", opts)
        self.assertIn(vid, opts)

    def test_media_is_not_passed_when_the_file_is_gone(self):
        # A moved or deleted video must not make the refresh fail; it just
        # produces a bundle without frame thumbnails.
        opts = self._opts(["thumbnails/hero.png"],
                          media={"filename": "missing.mp4"},
                          src="/nonexistent/scene.funscript")
        self.assertNotIn("--media", opts)

    def test_funscript_only_bundle_needs_no_media(self):
        opts = self._opts(["motion.funscript", "thumbnails/funscript.png"],
                          media={"filename": "scene.mp4"})
        self.assertNotIn("--media", opts)


if __name__ == "__main__":
    unittest.main()


class TestRefreshReplacesTheBundleItRefreshed(unittest.TestCase):
    """★ The bug this class exists for.

    Export's rule is "never clobber a prior snapshot" — a user-initiated
    export versions up to `scene (1).forge`. `refresh` inherited that rule,
    which made the update path useless in the worst possible way: it wrote
    the freshly-rendered output to `scene (4).forge` and left the STALE
    known-bad bundle sitting at `scene.forge`.

    Measured on a real project (2026-09-24): after a successful refresh,
    `scene.forge` still had per-chapter stroke depth 24/24/25/25/25/26 and
    no pipeline stamp, while the good 76/64/86/84/88/88 output was in
    `scene (4).forge`. Everything that resolves a project to `<stem>.forge`
    — the Open dialog, a double-click, a forgeassembler upload — kept
    reading the flattened one, and `refresh --check` reported the project
    stale forever because it too reads `<stem>.forge`.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.base = Path(self.tmp) / "scene.forge"

    def test_export_versions_up_by_default(self):
        # The snapshot rule for a user-initiated export is unchanged.
        self.base.write_text("old", encoding="utf-8")
        self.assertEqual(
            ffcli._next_available_path(self.base).name, "scene (1).forge")

    def test_refresh_asks_export_to_replace(self):
        # A refresh that versions up is not an update. Pin the flag at the
        # call site: this is the single line that made the difference.
        import inspect
        src = inspect.getsource(ffcli.cmd_refresh)
        self.assertIn('"--replace"', src,
                      "cmd_refresh must pass --replace or it leaves the stale "
                      "bundle at the canonical <stem>.forge path")

    def test_replace_is_off_by_default_in_the_parser(self):
        p = ffcli.build_parser()
        args = p.parse_args(["export", "x.funscript"])
        self.assertFalse(args.replace)
        args = p.parse_args(["export", "x.funscript", "--replace"])
        self.assertTrue(args.replace)

    def test_refresh_reports_the_path_it_actually_wrote(self):
        # It used to report `_bundle_for(src)` unconditionally — the path it
        # asked for, not the one export chose. A caller (or a user reading
        # the JSON) was told the bundle had been updated when it had not.
        import inspect
        src = inspect.getsource(ffcli.cmd_refresh)
        self.assertIn('buf.getvalue()', src)


class TestPolishStampFollowsTheChannelFiles(unittest.TestCase):
    """★ A staleness check the user can never satisfy.

    `polish.yml`'s `pipeline_version` means "the channel files these passes
    describe were built by this version". Only `cmd_polish_write` (the UI's
    Stamp button) set it. `cmd_polish_apply` — the thing that actually
    re-renders the channel files, and what `refresh` drives — left it alone.

    Measured 2026-09-24: a full refresh of a real project regenerated all 9
    stations with the v3 pipeline and the bundle came out stamped 3, but
    polish.yml still read 2, so `refresh --check` reported the project stale
    immediately after refreshing it. A warning that never clears is a warning
    the user learns to ignore.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp, "scene.funscript")
        with open(self.src, "w", encoding="utf-8") as f:
            json.dump({"actions": [{"at": 0, "pos": 0}]}, f)
        Path(ffcli._forge_dir_for(self.src)).mkdir(parents=True, exist_ok=True)

    def _write_polish(self, version):
        import yaml
        doc = {"version": 1, "schema": "polish/v1",
               "passes": {"estim3p": {"accepted": True, "knobs": {"gain": 1}}}}
        if version is not None:
            doc["pipeline_version"] = version
        path = ffcli._polish_path(self.src)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(doc), encoding="utf-8")
        return path

    def test_restamp_updates_an_older_stamp(self):
        self._write_polish("2")
        self.assertEqual(ffcli._restamp_polish_pipeline_version(self.src),
                         OUTPUT_PIPELINE_VERSION)
        st = ffcli.project_status(self.src)
        self.assertEqual(st["polish_pipeline_version"], OUTPUT_PIPELINE_VERSION)

    def test_restamp_preserves_the_passes(self):
        # The stamp must not be written by rebuilding the doc from scratch —
        # the accepted stations and their knobs are the user's work.
        self._write_polish("2")
        ffcli._restamp_polish_pipeline_version(self.src)
        import yaml
        doc = yaml.safe_load(ffcli._polish_path(self.src).read_text(encoding="utf-8"))
        self.assertTrue(doc["passes"]["estim3p"]["accepted"])
        self.assertEqual(doc["passes"]["estim3p"]["knobs"], {"gain": 1})

    def test_restamp_with_no_polish_doc_is_a_no_op(self):
        self.assertIsNone(ffcli._restamp_polish_pipeline_version(self.src))

    def test_restamp_survives_a_corrupt_polish_doc(self):
        ffcli._polish_path(self.src).parent.mkdir(parents=True, exist_ok=True)
        ffcli._polish_path(self.src).write_text("{[not yaml", encoding="utf-8")
        self.assertIsNone(ffcli._restamp_polish_pipeline_version(self.src))

    def test_refresh_restamps_only_when_it_regenerated_stations(self):
        # --export-only does NOT re-render channel files, so it must NOT claim
        # they are current. Stale there is the honest answer.
        import inspect
        src = inspect.getsource(ffcli.cmd_refresh)
        body = src.split("if not args.export_only:", 1)
        self.assertEqual(len(body), 2, "expected the export_only guard")
        self.assertIn("_restamp_polish_pipeline_version", body[1])

    def test_refresh_keeps_its_error_handling(self):
        # Near-miss while fixing the stamp bug: a new helper was inserted
        # directly above `def cmd_refresh`, between the `@_cli_command`
        # decorator and the function it decorated. The decorator silently
        # moved to the helper — which swallowed its return value — and
        # cmd_refresh lost FileNotFoundError/ValueError handling. refresh
        # walks a whole library and touches user files; a bad path there
        # should print one line, not a traceback.
        self.assertTrue(hasattr(ffcli.cmd_refresh, "__wrapped__"),
                        "cmd_refresh must keep its @_cli_command decorator")
        self.assertEqual(ffcli.cmd_refresh.__wrapped__.__name__, "cmd_refresh")


class TestReplaceRefusesToDeleteWhatItDoesNotRecognise(unittest.TestCase):
    """`--replace` deletes a tree and `--out` is user-supplied. The forge
    branch overwrites a single file, which is bounded; the loose branch calls
    rmtree, which is not. Only replace a folder carrying our own manifest."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.src = self.tmp / "scene.funscript"
        self.src.write_text(json.dumps({"actions": [{"at": 0, "pos": 0}]}),
                            encoding="utf-8")

    def _run(self, out):
        p = ffcli.build_parser()
        args = p.parse_args(["export", str(self.src), "--mode", "loose",
                             "--out", str(out), "--replace"])
        # cmd_export is wrapped by @_cli_command, which turns ValueError into
        # SystemExit(1) after printing one line. Call the undecorated function
        # so the test sees the refusal itself.
        return ffcli.cmd_export.__wrapped__(args)

    def test_refuses_a_folder_that_is_not_ours(self):
        victim = self.tmp / "my_documents"
        victim.mkdir()
        (victim / "important.txt").write_text("keep me", encoding="utf-8")
        with self.assertRaises(ValueError) as cm:
            self._run(victim)
        self.assertIn("manifest.ffmeta", str(cm.exception))
        self.assertTrue((victim / "important.txt").exists(),
                        "a refused --replace must not have deleted anything")
