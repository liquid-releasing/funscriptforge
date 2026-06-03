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

    def test_every_event_is_branded_with_an_sfw_label(self):
        # The map now covers all 32 (locked 2026-06-02) — no raw name leaks
        # into the UI as a label.
        for r in self.recipes:
            self.assertTrue(r["branded"], f"{r['id']} has no SFW label")
            self.assertTrue(r["sfwLabel"], f"{r['id']} sfwLabel empty")
            self.assertTrue(r["nsfwLabel"], f"{r['id']} nsfwLabel empty")

    def test_featured_is_a_curated_subset_distinct_from_branded(self):
        featured = [r for r in self.recipes if r.get("featured")]
        # A handful of quick-access events, not all 32.
        self.assertGreater(len(featured), 0)
        self.assertLess(len(featured), len(self.recipes))
        # edge is featured; lube/ruin are branded but not featured.
        self.assertTrue(self.by_id["edge"]["featured"])
        self.assertFalse(self.by_id["lube"].get("featured"))
        self.assertFalse(self.by_id["ruin"].get("featured"))

    def test_sensitive_names_get_neutral_sfw_labels(self):
        # Locked direction: raw explicit/BDSM names show a neutral motion SFW
        # label; the NSFW label preserves the original intent.
        expected = {
            "ruin": ("Drop", "Ruin"),
            "mcb_obey": ("Drive", "Obey"),
            "mcb_submit": ("Yield", "Submit"),
            "mcb_denial": ("Withhold", "Denial"),
            "clutch_good_slave": ("Praise", "Good Slave"),
            "test_slaps": ("Taps", "Slaps"),
        }
        for name, (sfw, nsfw) in expected.items():
            r = self.by_id[name]
            self.assertEqual(r["sfwLabel"], sfw, f"{name} sfw drifted")
            self.assertEqual(r["nsfwLabel"], nsfw, f"{name} nsfw drifted")


class TestEdgerRoundTrip(unittest.TestCase):
    """feel.yml ↔ playable Edger events.yml. effectId IS the Edger name, so
    begin/end/effect/params round-trip losslessly; intensity/devices are FF-only
    and reset to defaults across an Edger round-trip (documented boundary)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.target = os.path.join(self.tmp, "clip.funscript")
        self.events_json = os.path.join(self.tmp, "events.json")

    def _seed_feel(self, events):
        with open(self.events_json, "w", encoding="utf-8") as f:
            json.dump(events, f)
        rc, _, err = run("feel-write", self.target, "--events-json", self.events_json)
        self.assertEqual(rc, 0, err)

    def test_export_writes_sibling_events_yml_and_skips_baseline(self):
        self._seed_feel([
            SAMPLE_EVENT,
            {"id": "e-cap-2", "beginMs": 1000, "endMs": 3000, "effectId": "normal",
             "intensity": 1.0, "params": {}, "devices": [], "deviceCfg": {}},
        ])
        rc, out, err = run("edger-export", self.target)
        self.assertEqual(rc, 0, err)
        res = json.loads(out)
        # Sibling of the source, named <stem>.events.yml (funscript-tools rule).
        self.assertEqual(res["path"], os.path.join(self.tmp, "clip.events.yml"))
        self.assertTrue(os.path.exists(res["path"]))
        self.assertEqual(res["count"], 1)            # edge kept, normal skipped
        self.assertEqual(res["skipped"], ["normal"])  # baseline never exported

    def test_export_puts_span_in_duration_ms(self):
        self._seed_feel([SAMPLE_EVENT])  # 5000 → 12000
        rc, out, _ = run("edger-export", self.target, "--no-write")
        ev = json.loads(out)
        import yaml
        doc = yaml.safe_load(ev["yaml"])
        e = doc["events"][0]
        self.assertEqual(e["time"], 5000)
        self.assertEqual(e["name"], "edge")
        self.assertEqual(e["params"]["duration_ms"], 7000)
        self.assertEqual(e["params"]["buzz_freq"], 11)

    def test_export_no_write_leaves_no_file(self):
        self._seed_feel([SAMPLE_EVENT])
        rc, out, _ = run("edger-export", self.target, "--no-write")
        res = json.loads(out)
        self.assertIsNone(res["path"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "clip.events.yml")))
        self.assertIn("events:", res["yaml"])  # rendered anyway (Preview)

    def test_import_restores_span_effect_and_params(self):
        self._seed_feel([SAMPLE_EVENT])
        rc, out, _ = run("edger-export", self.target)
        yml = json.loads(out)["path"]
        rc, out, err = run("edger-import", yml)
        self.assertEqual(rc, 0, err)
        res = json.loads(out)
        self.assertEqual(res["imported"], 1)
        e = res["events"][0]
        self.assertEqual(e["beginMs"], 5000)
        self.assertEqual(e["endMs"], 12000)   # span reconstructed from duration_ms
        self.assertEqual(e["effectId"], "edge")
        self.assertEqual(e["params"], {"buzz_freq": 11})  # duration_ms stripped back out
        # FF-only fields reset to UI defaults across the Edger boundary.
        self.assertEqual(e["intensity"], 0.7)
        self.assertEqual(e["devices"], [])

    def test_import_skips_unknown_event_names(self):
        bad = os.path.join(self.tmp, "bad.events.yml")
        with open(bad, "w", encoding="utf-8") as f:
            f.write("events:\n- time: 1000\n  name: not_a_real_event\n  params: {duration_ms: 2000}\n"
                    "- time: 5000\n  name: edge\n  params: {duration_ms: 3000}\n")
        rc, out, err = run("edger-import", bad)
        self.assertEqual(rc, 0, err)
        res = json.loads(out)
        self.assertEqual(res["imported"], 1)
        self.assertEqual(res["skipped"], ["not_a_real_event"])
        self.assertEqual(res["events"][0]["effectId"], "edge")

    def test_import_uses_definition_default_duration_when_missing(self):
        nodur = os.path.join(self.tmp, "nodur.events.yml")
        with open(nodur, "w", encoding="utf-8") as f:
            f.write("events:\n- time: 2000\n  name: edge\n")
        rc, out, err = run("edger-import", nodur)
        self.assertEqual(rc, 0, err)
        e = json.loads(out)["events"][0]
        # endMs = time + (edge's default_params.duration_ms); just assert it
        # advanced past the start by a positive, definition-sourced amount.
        self.assertGreater(e["endMs"], e["beginMs"])

    def test_full_round_trip_preserves_playable_fields(self):
        seed = [
            SAMPLE_EVENT,
            {"id": "e-cap-2", "beginMs": 20000, "endMs": 24000, "effectId": "slow",
             "intensity": 0.6, "params": {}, "devices": ["estim"], "deviceCfg": {}},
        ]
        self._seed_feel(seed)
        rc, out, _ = run("edger-export", self.target)
        yml = json.loads(out)["path"]
        rc, out, _ = run("edger-import", yml)
        got = json.loads(out)["events"]
        playable = [(e["beginMs"], e["endMs"], e["effectId"]) for e in got]
        self.assertEqual(playable, [(5000, 12000, "edge"), (20000, 24000, "slow")])


if __name__ == "__main__":
    unittest.main()
