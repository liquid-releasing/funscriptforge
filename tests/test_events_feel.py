# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Events tab durable contract — feel-write / feel-read round-trip and the
list-event-recipes catalog projection.

These two are the load-bearing seams between the EventsTab UI and Python:
  - feel-write/feel-read persist events to the canonical <stem>.feel.yml,
    canonicalizing the JS event shape on the way in and restoring it on the
    way out. The UI stays dumb; Python owns the mapping. The round-trip must
    be lossless or durable edits silently corrupt on reload.
  - list-event-recipes projects the vendored Edger event_definitions.yml
    (+ our SFW/NSFW map) into the catalog the tab consumes. Backend-sourced
    so id/param/label never drift from funscript-tools.

Tests invoke the real CLI via subprocess (parsing + dispatch + file I/O).
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest

CLI = os.path.join(os.path.dirname(__file__), "..", "cli.py")
PYTHON = sys.executable


def run(*args, cwd=None):
    """Run cli.py with *args and return (returncode, stdout, stderr)."""
    result = subprocess.run(
        [PYTHON, CLI, *args],
        capture_output=True,
        text=True,
        cwd=cwd or os.path.dirname(CLI),
    )
    return result.returncode, result.stdout, result.stderr


# A representative EventsTab-shape event (camelCase, what the UI sends).
SAMPLE_EVENT = {
    "id": "e-cap-1",
    "beginMs": 5000,
    "endMs": 12000,
    "effectId": "edge",
    "intensity": 0.7,
    "params": {"buzz_freq": 11},
    "devices": ["estim", "vibrator"],
    "deviceCfg": {"estim": {"mode": "broadcast", "value": 100}},
}


class TestFeelRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # The sidecar lives next to this (non-existent is fine — feel-write
        # only touches the .forge dir, never the funscript itself).
        self.target = os.path.join(self.tmp, "clip.funscript")
        self.events_json = os.path.join(self.tmp, "events.json")

    def _write(self, events):
        with open(self.events_json, "w", encoding="utf-8") as f:
            json.dump(events, f)
        return run("feel-write", self.target, "--events-json", self.events_json)

    def test_write_then_read_is_lossless(self):
        rc, out, err = self._write([SAMPLE_EVENT])
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads(out)["count"], 1)

        rc, out, err = run("feel-read", self.target)
        self.assertEqual(rc, 0, err)
        doc = json.loads(out)
        self.assertEqual(doc["version"], 1)
        self.assertEqual(len(doc["events"]), 1)
        got = doc["events"][0]
        # Every UI field survives the canonical snake_case round-trip.
        for key in ("id", "beginMs", "endMs", "effectId", "intensity",
                    "params", "devices", "deviceCfg"):
            self.assertEqual(got[key], SAMPLE_EVENT[key], f"field {key} drifted")

    def test_write_creates_sidecar_in_forge_dir(self):
        self._write([SAMPLE_EVENT])
        forge = os.path.join(self.tmp, ".clip.forge", "clip.feel.yml")
        self.assertTrue(os.path.exists(forge), f"expected sidecar at {forge}")

    def test_disk_shape_is_canonical_snake_case(self):
        self._write([SAMPLE_EVENT])
        forge = os.path.join(self.tmp, ".clip.forge", "clip.feel.yml")
        text = open(forge, encoding="utf-8").read()
        # Canonical keys on disk, not the JS camelCase.
        self.assertIn("begin_ms", text)
        self.assertIn("effect:", text)
        self.assertIn("overrides", text)
        self.assertNotIn("beginMs", text)
        self.assertNotIn("effectId", text)

    def test_read_missing_file_is_empty(self):
        rc, out, err = run("feel-read", self.target)
        self.assertEqual(rc, 0, err)
        doc = json.loads(out)
        self.assertEqual(doc["events"], [])
        self.assertEqual(doc["version"], 1)

    def test_rewrite_replaces_events(self):
        self._write([SAMPLE_EVENT])
        second = dict(SAMPLE_EVENT, id="e-cap-2", effectId="slow", beginMs=20000, endMs=25000)
        self._write([SAMPLE_EVENT, second])
        rc, out, _ = run("feel-read", self.target)
        ids = [e["id"] for e in json.loads(out)["events"]]
        self.assertEqual(ids, ["e-cap-1", "e-cap-2"])

    def test_write_preserves_other_top_level_keys(self):
        import yaml  # available in the funscriptforge venv
        # Seed the sidecar with an unrelated key feel-write must not clobber.
        forge_dir = os.path.join(self.tmp, ".clip.forge")
        os.makedirs(forge_dir, exist_ok=True)
        sidecar = os.path.join(forge_dir, "clip.feel.yml")
        with open(sidecar, "w", encoding="utf-8") as f:
            yaml.safe_dump({"devices": {"estim": {"channels": 2}}, "events": []}, f)
        self._write([SAMPLE_EVENT])
        doc = yaml.safe_load(open(sidecar, encoding="utf-8"))
        self.assertIn("devices", doc)
        self.assertEqual(doc["devices"]["estim"]["channels"], 2)
        self.assertEqual(len(doc["events"]), 1)


class TestListEventRecipes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rc, out, err = run("list-event-recipes")
        assert rc == 0, err
        cls.doc = json.loads(out)
        cls.recipes = cls.doc["recipes"]
        cls.by_id = {r["id"]: r for r in cls.recipes}

    def test_all_32_edger_events_present(self):
        self.assertEqual(len(self.recipes), 32)

    def test_groups_are_source_keyed(self):
        keys = {g["key"] for g in self.doc["groups"]}
        self.assertEqual(keys, {"general", "mcb", "clutch", "test"})
        from collections import Counter
        counts = Counter(r["group"] for r in self.recipes)
        self.assertEqual(dict(counts), {"general": 11, "mcb": 10, "clutch": 10, "test": 1})

    def test_normal_is_not_backend_sourced(self):
        # "Normal" is a synthetic client-side baseline, never an Edger event.
        self.assertNotIn("normal", self.by_id)

    def test_every_recipe_has_required_fields(self):
        required = ("id", "name", "group", "label", "sfwLabel", "nsfwLabel",
                    "branded", "desc", "defaultParams", "params", "steps")
        for r in self.recipes:
            for key in required:
                self.assertIn(key, r, f"{r.get('id')} missing {key}")

    def test_duration_is_not_a_tunable_param(self):
        # duration_ms is derived from the captured span, never a slider.
        for r in self.recipes:
            keys = [p["key"] for p in r["params"]]
            self.assertNotIn("duration_ms", keys, f"{r['id']} exposes duration_ms")

    def test_params_carry_ui_range_spec(self):
        for r in self.recipes:
            for p in r["params"]:
                for key in ("key", "label", "def", "min", "max", "step"):
                    self.assertIn(key, p, f"{r['id']} param {p.get('key')} missing {key}")

    def test_steps_carry_op_axis_and_mode(self):
        # Blend (additive vs overwrite) is derived UI-side from step mode, so
        # every step must carry it (or default additive) under params.
        saw_mode = False
        for r in self.recipes:
            for s in r["steps"]:
                self.assertIn("op", s)
                self.assertIn("axis", s)
                self.assertIn("params", s)
                mode = s["params"].get("mode")
                if mode is not None:
                    self.assertIn(mode, ("additive", "overwrite"))
                    saw_mode = True
        self.assertTrue(saw_mode, "no step carried a mode — blend surfacing would be blind")

    def test_branded_events_have_distinct_sfw_label(self):
        # The SFW/NSFW map brands a curated subset; edge is the canonical one.
        edge = self.by_id.get("edge")
        self.assertIsNotNone(edge)
        self.assertTrue(edge["branded"])
        self.assertEqual(edge["sfwLabel"], "Edge")
        branded = [r for r in self.recipes if r["branded"]]
        self.assertGreaterEqual(len(branded), 1)


if __name__ == "__main__":
    unittest.main()
