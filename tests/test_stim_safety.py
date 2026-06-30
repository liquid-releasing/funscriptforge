"""Tests for forge.stim_safety — generation-time e-stim flash cap.

Covers the two clamps (region-targeted source-screech + co-rail catch-all),
the surgical-touch property (intended intensity is left alone), the sidecar
report, and channel discovery.
"""

import json
import os
import tempfile
import unittest

from forge import stim_safety
from forge.stim_safety import (
    FLASH_VOL_CAP,
    REGION_VOL_CAP,
    cap_stim_channels,
    discover_channels,
    write_sidecar,
)


def _write(path, pairs):
    actions = [{"at": int(t), "pos": int(p)} for t, p in pairs]
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"actions": actions}, f)


def _read(path):
    with open(path, encoding="utf-8") as f:
        return [(a["at"], a["pos"]) for a in json.load(f)["actions"]]


class StimSafetyTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.stem = "scene"

    def _paths(self):
        return {
            "volume": os.path.join(self.d, f"{self.stem}.volume.funscript"),
            "frequency": os.path.join(self.d, f"{self.stem}.frequency.funscript"),
        }

    # ── region-targeted ──────────────────────────────────────────────────────
    def test_source_screech_region_caps_volume(self):
        p = self._paths()
        _write(p["volume"], [(0, 90), (1000, 95), (2000, 90)])  # 1.0s..2.0s loud
        _write(p["frequency"], [(0, 50), (1000, 50), (2000, 50)])  # freq low
        regions = cap_stim_channels(
            p, screech_regions=[{"start_s": 0.9, "end_s": 1.1}], write=True
        )
        vol = _read(p["volume"])
        # the sample at 1000 ms (inside the screech span) is capped to REGION_VOL_CAP
        self.assertEqual(vol[1][1], int(REGION_VOL_CAP * 100))
        self.assertEqual(vol[0][1], 90)  # outside span untouched
        self.assertTrue(any(r.reason == "source_screech" for r in regions))

    def test_region_does_not_raise_quiet_volume(self):
        p = self._paths()
        _write(p["volume"], [(1000, 50)])  # already below the region cap
        _write(p["frequency"], [(1000, 50)])
        regions = cap_stim_channels(
            p, screech_regions=[{"start_s": 0.9, "end_s": 1.1}], write=True
        )
        self.assertEqual(_read(p["volume"])[0][1], 50)  # unchanged (cap only lowers)
        self.assertEqual(regions, [])

    # ── co-rail catch-all ────────────────────────────────────────────────────
    def test_co_rail_caps_when_both_railed(self):
        p = self._paths()
        _write(p["volume"], [(0, 100), (1000, 100)])
        _write(p["frequency"], [(0, 100), (1000, 100)])
        regions = cap_stim_channels(p, screech_regions=None, write=True)
        for _at, pos in _read(p["volume"]):
            self.assertEqual(pos, int(FLASH_VOL_CAP * 100))
        self.assertTrue(all(r.reason == "co_rail" for r in regions))

    def test_no_cap_when_frequency_low(self):
        p = self._paths()
        _write(p["volume"], [(0, 100), (1000, 100)])  # loud but...
        _write(p["frequency"], [(0, 30), (1000, 30)])  # ...freq low → intended
        regions = cap_stim_channels(p, screech_regions=None, write=True)
        self.assertEqual([pos for _t, pos in _read(p["volume"])], [100, 100])
        self.assertEqual(regions, [])

    def test_surgical_touch(self):
        # a long loud-but-clean scene: nothing co-rails, nothing flagged → 0 edits
        p = self._paths()
        _write(p["volume"], [(i * 100, 95) for i in range(100)])
        _write(p["frequency"], [(i * 100, 95) for i in range(100)])  # 0.95 < rail
        regions = cap_stim_channels(p, screech_regions=None, write=True)
        self.assertEqual(regions, [])

    # ── sidecar + discovery ──────────────────────────────────────────────────
    def test_sidecar_has_both_region_sets(self):
        p = self._paths()
        _write(p["volume"], [(0, 100)])
        _write(p["frequency"], [(0, 100)])
        regions = cap_stim_channels(p, screech_regions=[{"start_s": 0, "end_s": 0.001}])
        sc = write_sidecar(
            os.path.join(self.d, f"{self.stem}.screech.json"),
            cap_regions=regions,
            screech_regions=[{"start_s": 0, "end_s": 0.001}],
        )
        payload = json.load(open(sc, encoding="utf-8"))
        self.assertEqual(payload["version"], 1)
        self.assertIn("source_screech_regions", payload)
        self.assertIn("generation_cap_regions", payload)

    def test_discover_channels(self):
        p = self._paths()
        _write(p["volume"], [(0, 10)])
        _write(p["frequency"], [(0, 10)])
        found = discover_channels(self.d, self.stem)
        self.assertIn("volume", found)
        self.assertIn("frequency", found)
        self.assertNotIn("volume-prostate", found)  # absent

    def test_missing_volume_channel_is_noop(self):
        regions = cap_stim_channels({}, screech_regions=[{"start_s": 0, "end_s": 1}])
        self.assertEqual(regions, [])


if __name__ == "__main__":
    unittest.main()
