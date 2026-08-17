"""Which produced file does the Viewer show?

Export never overwrites — it versions up (`scene.forge` → `scene (2).forge`,
`scene.output` → `scene.output (2)`). The resolver used to take the exact name
if it existed and otherwise the alphabetically first sibling, so the FIRST
export won forever: re-exporting with a fix changed nothing on screen. That
cost a full afternoon of "still broken" reports against a repair that was
verifiably correct in the bundles (2026-08-16, Bruna Butterfly).

The rule is now: newest by mtime, this project's before a sibling's.
"""

import json
import os
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from forge.viewer import _resolve_sources, load_device_outputs


def _touch_at(p: Path, when: float):
    os.utime(p, (when, when))


def _bundle(path: Path, *, level: int, when: float):
    """A minimal `.forge` bundle holding one e-stim channel at `level`."""
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("stations/estim3p/scene.volume.funscript", json.dumps(
            {"actions": [{"at": t, "pos": level} for t in range(0, 10_000, 500)]}))
    _touch_at(path, when)


def _output_dir(path: Path, *, level: int, when: float):
    """A minimal loose `<stem>.output/` tree holding one e-stim channel."""
    dev = path / "E-Stim"
    dev.mkdir(parents=True)
    (dev / "scene.volume.funscript").write_text(json.dumps(
        {"actions": [{"at": t, "pos": level} for t in range(0, 10_000, 500)]}), encoding="utf-8")
    _touch_at(path, when)


def _level(res: dict) -> int:
    return res["devices"][0]["channels"][0]["actions"][0]["pos"]


class TestNewestWins(unittest.TestCase):

    def test_a_re_export_replaces_the_original_on_screen(self):
        # THE regression. Two exports of the same project: the second is the fix.
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=6, when=1_000_000)          # first export
            _bundle(d / "scene (1).forge", level=97, when=2_000_000)     # the fix
            res = load_device_outputs(str(media))
            self.assertTrue(res["available"])
            self.assertEqual(res["sourceName"], "scene (1).forge")
            self.assertEqual(_level(res), 97, "the Viewer is still showing the first export")

    def test_the_newest_wins_however_many_versions_there_are(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=6, when=1_000_000)
            for n in range(1, 6):
                _bundle(d / f"scene ({n}).forge", level=90 + n, when=1_000_000 + n * 1000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["sourceName"], "scene (5).forge")
            self.assertEqual(_level(res), 95)

    def test_a_versioned_output_folder_is_found(self):
        # Folders version AFTER the name, so `*.output` glob alone misses them.
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _output_dir(d / "scene.output", level=6, when=1_000_000)
            _output_dir(d / "scene.output (2)", level=97, when=2_000_000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["sourceName"], "scene.output (2)")
            self.assertEqual(_level(res), 97)

    def test_a_newer_bundle_beats_an_older_loose_folder(self):
        # The loose folder used to shadow the bundle unconditionally, so
        # switching export mode left the Viewer on the older set.
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _output_dir(d / "scene.output", level=6, when=1_000_000)
            _bundle(d / "scene.forge", level=97, when=2_000_000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["source"], "forge")
            self.assertEqual(_level(res), 97)

    def test_an_older_bundle_does_not_beat_a_newer_loose_folder(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=6, when=1_000_000)
            _output_dir(d / "scene.output", level=97, when=2_000_000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["source"], "output")
            self.assertEqual(_level(res), 97)


class TestSiblingAdoption(unittest.TestCase):

    def test_this_projects_own_export_beats_a_newer_siblings(self):
        # A folder can hold 1080p / 4K / VR renders of one title. Adoption is a
        # FALLBACK — never a reason to show another render's work over your own.
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=97, when=1_000_000)
            _bundle(d / "other.forge", level=6, when=9_000_000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["sourceName"], "scene.forge")

    def test_a_sibling_is_adopted_when_this_project_has_none(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene_4k.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=97, when=1_000_000)
            res = load_device_outputs(str(media))
            self.assertTrue(res["available"], "opening another render lost the work")
            self.assertEqual(res["sourceName"], "scene.forge")

    def test_the_newest_sibling_is_adopted(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene_4k.mp4"
            media.write_bytes(b"x")
            _bundle(d / "aaa.forge", level=6, when=1_000_000)
            _bundle(d / "zzz.forge", level=97, when=2_000_000)
            res = load_device_outputs(str(media))
            self.assertEqual(res["sourceName"], "zzz.forge")


class TestResolverEdges(unittest.TestCase):

    def test_nothing_produced_yet(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            self.assertEqual(_resolve_sources(str(media)), [])
            self.assertFalse(load_device_outputs(str(media))["available"])

    def test_a_forge_DIRECTORY_is_not_a_bundle(self):
        # `.<stem>.forge/` is the working project dir — same suffix, not an
        # export. It is hidden by the leading dot, but never a bundle.
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            (d / ".scene.forge").mkdir()
            (d / "scene.forge").mkdir()
            self.assertEqual(_resolve_sources(str(media)), [])

    def test_the_stem_follows_the_chosen_source(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene_4k.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene.forge", level=97, when=1_000_000)
            kind, path, stem = _resolve_sources(str(media))[0]
            self.assertEqual(stem, "scene", "channel names parse against the resolved stem")

    def test_a_versioned_name_resolves_to_its_base_stem(self):
        with TemporaryDirectory() as td:
            d = Path(td)
            media = d / "scene.mp4"
            media.write_bytes(b"x")
            _bundle(d / "scene (3).forge", level=97, when=1_000_000)
            kind, path, stem = _resolve_sources(str(media))[0]
            self.assertEqual(stem, "scene")


if __name__ == "__main__":
    unittest.main()
