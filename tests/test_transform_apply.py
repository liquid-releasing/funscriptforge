# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Golden harness for the `transform-apply` CLI command (the editor's
preview/apply bridge).

The per-transform math is covered in test_phrase_transforms.py. This file
guards the *bridge*: every catalog transform must run end-to-end through
`cmd_transform_apply` (preview + apply) on a real span set without error,
returning well-formed, in-bounds actions. This is the programmatic
"check out every transform" — a regression here means a transform the UI
can no longer preview or apply.
"""

import io
import json
import math
import os
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import redirect_stdout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import cli  # noqa: E402
from pattern_catalog.phrase_transforms import TRANSFORM_CATALOG  # noqa: E402


def _sine_funscript(path, dur_ms=30000, step_ms=50):
    """A full-range 0-100 oscillation — enough cycles/reversals that every
    transform (incl. structural retiming + beat accenting) has signal."""
    actions = []
    for at in range(0, dur_ms + 1, step_ms):
        pos = int(round(50 + 49 * math.sin(at / 400.0)))
        actions.append({"at": at, "pos": max(0, min(100, pos))})
    with open(path, "w") as f:
        json.dump({"actions": actions}, f)
    return actions


def _args(funscript, spans, transform, preview=True, param=None,
          params_json=None, output=None):
    return Namespace(
        funscript=funscript, spans=spans, transform=transform,
        preview=preview, param=param, params_json=params_json, output=output,
    )


def _run(args):
    """Invoke the command, returning parsed stdout JSON (preview) or the
    printed apply summary."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        cli.cmd_transform_apply(args)
    out = buf.getvalue().strip()
    return json.loads(out) if out else None


class TransformApplyBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="tx_apply_")
        cls.fs = os.path.join(cls.tmp, "in.funscript")
        cls.spans_path = os.path.join(cls.tmp, "spans.json")
        _sine_funscript(cls.fs)
        # Two disjoint spans (the edit-set shape the UI sends).
        cls.spans = [{"start_ms": 5000, "end_ms": 15000},
                     {"start_ms": 18000, "end_ms": 28000}]
        with open(cls.spans_path, "w") as f:
            json.dump(cls.spans, f)

    # --- the headline guarantee: EVERY transform previews cleanly ---------
    def test_every_transform_previews(self):
        for key in sorted(TRANSFORM_CATALOG):
            with self.subTest(transform=key):
                res = _run(_args(self.fs, self.spans_path, key, preview=True))
                self.assertEqual(res["transform"], key)
                self.assertEqual(len(res["spans"]), 2)
                for span in res["spans"]:
                    acts = span["actions"]
                    self.assertGreater(len(acts), 0,
                                       f"{key}: empty span actions")
                    for a in acts:
                        self.assertIsInstance(a["at"], int)
                        self.assertIsInstance(a["pos"], int)
                        self.assertGreaterEqual(a["pos"], 0)
                        self.assertLessEqual(a["pos"], 100)

    # --- apply (write) path round-trips for every transform ---------------
    def test_every_transform_applies_and_writes(self):
        for key in sorted(TRANSFORM_CATALOG):
            with self.subTest(transform=key):
                out = os.path.join(self.tmp, f"out_{key}.funscript")
                res = _run(_args(self.fs, self.spans_path, key,
                                 preview=False, output=out))
                self.assertEqual(res["transform"], key)
                self.assertTrue(os.path.exists(out))
                data = json.load(open(out))
                self.assertGreater(len(data["actions"]), 0)
                for a in data["actions"]:
                    self.assertGreaterEqual(a["pos"], 0)
                    self.assertLessEqual(a["pos"], 100)

    # --- structural transforms may change action count in-span ------------
    def test_structural_retime_changes_count(self):
        # halve_tempo keeps every other cycle → fewer actions in the span.
        res = _run(_args(self.fs, self.spans_path, "halve_tempo"))
        orig = [a for a in _sine_funscript(os.path.join(self.tmp, "x.funscript"))
                if 5000 <= a["at"] <= 15000]
        self.assertLess(len(res["spans"][0]["actions"]), len(orig))

    # --- non-structural transforms keep the action timestamps ------------
    def test_recenter_shifts_midpoint(self):
        res = _run(_args(self.fs, self.spans_path, "recenter",
                         param=["target_center=10"]))
        acts = res["spans"][0]["actions"]
        # Original midpoint is ~50; recenter to 10 pulls everything down.
        self.assertLessEqual(max(a["pos"] for a in acts), 60)

    # --- param casting: stringy CLI value must reach the transform typed --
    def test_string_float_param_is_cast(self):
        res = _run(_args(self.fs, self.spans_path, "amplitude_scale",
                         param=["scale=0.5"]))
        acts = res["spans"][0]["actions"]
        # scale 0.5 compresses a 0-100 span toward 25-75.
        self.assertGreaterEqual(min(a["pos"] for a in acts), 20)
        self.assertLessEqual(max(a["pos"] for a in acts), 80)

    # --- params-json path (UI sends real JSON numbers) -------------------
    def test_params_json_path(self):
        pj = os.path.join(self.tmp, "pj.json")
        json.dump({"scale": 0.5}, open(pj, "w"))
        res = _run(_args(self.fs, self.spans_path, "amplitude_scale",
                         params_json=pj))
        self.assertEqual(res["params"]["scale"], 0.5)

    # --- unknown transform key is a clean error, not a crash -------------
    def test_unknown_transform_errors(self):
        with self.assertRaises(SystemExit):
            _run(_args(self.fs, self.spans_path, "no_such_transform"))


if __name__ == "__main__":
    unittest.main()
