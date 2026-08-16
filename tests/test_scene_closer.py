"""Tests for the Scene Closer virtual character (route B).

Scene Closer is a forge-level character: it generates from a base Edger preset
(Scene Builder), then a span-relative DESCENDING volume envelope is applied at
our layer so the intensity winds down over the assigned span — the reverse of
Scene Builder (Builder opens, Closer closes), and length-independent (unlike
Edger's duration-scaled ramp).

These cover the pure route-B logic (no funscript-tools needed); the full
channel generation is exercised by test_polish / test_export when the engine
is available.
"""

import unittest

from forge.stim_config import (
    VIRTUAL_CHARACTERS,
    apply_virtual_envelope,
    resolve_character,
)

_SPEC = VIRTUAL_CHARACTERS["scene_closer"]


class TestResolveCharacter(unittest.TestCase):

    def test_scene_closer_resolves_to_base_plus_spec(self):
        base, spec = resolve_character("scene_closer")
        self.assertEqual(base, "Scene Builder")
        self.assertIsNotNone(spec)
        self.assertEqual(spec["envelope"], "descending")

    def test_label_form_resolves(self):
        base, spec = resolve_character("Scene Closer")
        self.assertEqual(base, "Scene Builder")
        self.assertIsNotNone(spec)

    def test_real_character_passes_through(self):
        base, spec = resolve_character("balanced")
        self.assertEqual(base, "balanced")
        self.assertIsNone(spec)


class TestDescendingEnvelope(unittest.TestCase):

    def _flat(self, lo, hi, step=100, pos=80):
        return [{"at": t, "pos": pos} for t in range(lo, hi + 1, step)]

    def test_volume_channel_descends_full_to_floor(self):
        acts = self._flat(0, 1000)  # constant 80
        out = apply_virtual_envelope("volume", acts, 0, 1000, _SPEC)
        floor = _SPEC["envelope_floor"]
        # First sample ~unchanged (factor 1.0); last ~ pos*floor.
        self.assertEqual(out[0]["pos"], 80)
        self.assertEqual(out[-1]["pos"], round(80 * floor))
        # Strictly non-increasing across the span (a clean wind-down).
        for a, b in zip(out, out[1:]):
            self.assertLessEqual(b["pos"], a["pos"])

    def test_envelope_is_span_relative_not_duration_scaled(self):
        # The SAME fade depth regardless of span length — a 4-min and a 40-min
        # chapter both end at floor. (This is the whole point vs Edger's ramp.)
        short = apply_virtual_envelope("volume", self._flat(0, 240_000, 1000), 0, 240_000, _SPEC)
        long = apply_virtual_envelope("volume", self._flat(0, 2_400_000, 1000), 0, 2_400_000, _SPEC)
        floor = _SPEC["envelope_floor"]
        self.assertEqual(short[-1]["pos"], round(80 * floor))
        self.assertEqual(long[-1]["pos"], round(80 * floor))

    def test_midpoint_is_still_at_full(self):
        # The wind-down lives in the closing quarter, so the middle of the span
        # is untouched. (This replaced a midpoint-is-halfway test when the hold
        # landed — fading from the first beat made a chapter read as ending
        # before it had started.)
        out = apply_virtual_envelope("volume", self._flat(0, 1000), 0, 1000, _SPEC)
        self.assertEqual(out[len(out) // 2]["pos"], 80)

    def test_full_until_the_hold_point_then_drops(self):
        out = apply_virtual_envelope("volume", self._flat(0, 1000, 10), 0, 1000, _SPEC)
        hold = _SPEC["envelope_hold"]
        at_hold = {a["at"]: a["pos"] for a in out}
        # Everything up to the hold point is untouched...
        for t in range(0, int(1000 * hold) + 1, 10):
            self.assertEqual(at_hold[t], 80, f"expected full volume at {t}ms")
        # ...and it is strictly falling somewhere after it.
        self.assertLess(at_hold[1000], 80)

    def test_hold_zero_restores_the_full_span_taper(self):
        spec = dict(_SPEC, envelope_hold=0.0)
        out = apply_virtual_envelope("volume", self._flat(0, 1000), 0, 1000, spec)
        floor = spec["envelope_floor"]
        mid = out[len(out) // 2]
        self.assertEqual(mid["pos"], round(80 * (1.0 - (1.0 - floor) * 0.5)))

    def test_hold_of_one_still_closes(self):
        # Clamped below 1.0 — otherwise the closer would silently stop closing.
        spec = dict(_SPEC, envelope_hold=1.0)
        out = apply_virtual_envelope("volume", self._flat(0, 1000), 0, 1000, spec)
        self.assertLess(out[-1]["pos"], 80)

    def test_non_volume_channels_untouched(self):
        acts = self._flat(0, 1000)
        for ch in ("alpha", "beta", "frequency", "pulse_frequency"):
            out = apply_virtual_envelope(ch, acts, 0, 1000, _SPEC)
            self.assertEqual(out, acts)

    def test_volume_prostate_also_scaled(self):
        out = apply_virtual_envelope("volume-prostate", self._flat(0, 1000), 0, 1000, _SPEC)
        self.assertLess(out[-1]["pos"], out[0]["pos"])

    def test_no_spec_passes_through(self):
        acts = self._flat(0, 1000)
        self.assertEqual(apply_virtual_envelope("volume", acts, 0, 1000, None), acts)


if __name__ == "__main__":
    unittest.main()
