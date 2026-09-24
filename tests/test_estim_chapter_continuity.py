"""E-stim generation must not put a seam at every chapter boundary.

Channels are generated one chapter at a time: the motion funscript is sliced
per chapter and funscript-tools' `process()` runs on each slice as though it
were a whole scene. Two artifacts came out of that, and neither was anybody's
design decision:

1. Upstream's `make_volume_ramp` emits `y = [0, start, 1.0, 0]` — literals, not
   a tunable. `volume_ramp_combine_ratio` is 20, so the volume channel is 95%
   that ramp, `frequency` is built from it, and `pulse_rise_time` comes from its
   INVERSE (which is why that one spikes at a seam instead of diving). Twelve
   chapters is twelve `0 -> ... -> 0` envelopes glued end to end.
2. `convert_to_speed` (5s window), the acceleration pass (3s) and
   `generate_alpha_beta_from_main` are all degenerate at the first and last
   samples they are given, so the phase channels settle at every chapter start.

Measured on a real 60-minute scene (2026-09-22): volume 6-11 out of 100 at all
eleven internal boundaries, 224s under volume 20, motion at zero at each one.

A chapter boundary means nothing to a listener — chapters are work units for
the editor, and we do not detect scene changes. So the fix is at the source:
process a PADDED slice and discard the padding, and hand each chapter a slice
of ONE track-level ramp. `match_chapter_seams` remains as the repair for
bundles generated before this, and for anything assembled elsewhere.

Measured before/after on two adjacent synthetic chapters:

    volume at seam            min 0   -> min 98   (body plateau 99)
    pulse_rise_time at seam   max 80  -> max 1    (body 0)
    alpha activity at seam    31.24   -> 32.80    (body 32.80)
"""

import contextlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import the repo's own cli BEFORE anything runs funscript-tools. Its adapter
# puts the funscript-tools root on sys.path[0], and that directory has its own
# cli.py -- so a later bare `import cli` gets THAT one and every lookup here
# fails with "module cli has no attribute _polish_generate_estim". The same
# trap is documented in forge/funscript_tools.py::_ensure_cli.
import cli as ffcli  # noqa: E402

from forge.stim_config import (  # noqa: E402
    DEFAULT_RAMP_PERCENT_PER_HOUR,
    ESTIM_OVERLAP_MS,
    pad_window,
    slice_ramp,
    track_volume_ramp,
    trim_to_window,
)

HOUR_MS = 3_600_000


def _times(end_ms, step=250):
    return list(range(0, end_ms + 1, step))


def _level_at(ramp, t):
    """Linear read of a ramp funscript — what np.interp does downstream."""
    if t <= ramp[0]["at"]:
        return float(ramp[0]["pos"])
    if t >= ramp[-1]["at"]:
        return float(ramp[-1]["pos"])
    for i in range(1, len(ramp)):
        a, b = ramp[i - 1], ramp[i]
        if a["at"] <= t <= b["at"]:
            span = b["at"] - a["at"] or 1
            return float(a["pos"]) + (float(b["pos"]) - float(a["pos"])) * (t - a["at"]) / span
    return float(ramp[-1]["pos"])


class TestTrackVolumeRamp(unittest.TestCase):
    """The ramp spans the SCENE, which is what ramp_percent_per_hour meant."""

    def test_it_has_the_same_four_points_upstream_emits(self):
        times = _times(HOUR_MS)
        ramp = track_volume_ramp(times)
        self.assertEqual(len(ramp), 4)
        self.assertEqual([p["at"] for p in ramp],
                         [times[0], times[0] + 10_000, times[-2], times[-1]])
        self.assertEqual(ramp[0]["pos"], 0.0)
        self.assertEqual(ramp[2]["pos"], 100.0)
        self.assertEqual(ramp[3]["pos"], 0.0)

    def test_an_hour_long_scene_opens_at_85(self):
        """15%/hour over one hour: the ramp starts at 1.0 - 0.15 and reaches
        100 at the peak. That arc is the whole point of the parameter."""
        ramp = track_volume_ramp(_times(HOUR_MS))
        self.assertAlmostEqual(ramp[1]["pos"], 85.0, delta=0.5)

    def test_a_five_minute_chapter_alone_would_barely_ramp_at_all(self):
        """THE argument for moving it to track level. Run per chapter, the same
        arithmetic gives a five-minute window a 1.25% rise — meaningless — and
        buys it with a full fade in from zero."""
        per_chapter = track_volume_ramp(_times(300_000))
        self.assertGreater(per_chapter[1]["pos"], 98.0)   # the "rise" is 1.25%
        self.assertEqual(per_chapter[0]["pos"], 0.0)      # ...for a fade from 0

    def test_the_rate_is_honoured(self):
        flat = track_volume_ramp(_times(HOUR_MS), ramp_percent_per_hour=0.0)
        steep = track_volume_ramp(_times(HOUR_MS), ramp_percent_per_hour=40.0)
        self.assertAlmostEqual(flat[1]["pos"], 100.0, delta=0.5)
        self.assertAlmostEqual(steep[1]["pos"], 60.0, delta=0.5)
        self.assertEqual(DEFAULT_RAMP_PERCENT_PER_HOUR, 15.0)

    def test_a_scene_shorter_than_the_fade_in_stays_monotonic_in_time(self):
        """The 10-second knot would land past the peak on a very short clip and
        hand np.interp a non-monotonic x. It is dropped instead."""
        ramp = track_volume_ramp(_times(4_000))
        self.assertEqual(len(ramp), 3)
        ats = [p["at"] for p in ramp]
        self.assertEqual(ats, sorted(ats))

    def test_too_few_actions_defers_to_upstream(self):
        """An empty ramp is the signal to write no sidecar at all, so upstream
        builds its own — never a half-formed one."""
        self.assertEqual(track_volume_ramp([0, 1000, 2000]), [])
        self.assertEqual(track_volume_ramp([]), [])

    def test_a_zero_length_track_defers_too(self):
        self.assertEqual(track_volume_ramp([0, 0, 0, 0]), [])


class TestSliceRamp(unittest.TestCase):

    def setUp(self):
        self.ramp = track_volume_ramp(_times(HOUR_MS))

    def test_an_interior_slice_never_touches_zero(self):
        """THE regression. Every per-chapter ramp began and ended at 0; a slice
        of the track ramp sits wherever the scene has got to."""
        s = slice_ramp(self.ramp, 600_000, 1_200_000)
        self.assertGreater(min(p["pos"] for p in s), 80.0)

    def test_the_endpoints_are_interpolated_not_snapped_to_a_knot(self):
        lo, hi = 600_000, 1_200_000
        s = slice_ramp(self.ramp, lo, hi)
        self.assertEqual(s[0]["at"], lo)
        self.assertEqual(s[-1]["at"], hi)
        self.assertAlmostEqual(s[0]["pos"], _level_at(self.ramp, lo), places=2)
        self.assertAlmostEqual(s[-1]["pos"], _level_at(self.ramp, hi), places=2)

    def test_adjacent_slices_meet_at_the_same_level(self):
        """The seam is continuous because both sides read one ramp. Rounding
        each slice to whole percent would have put a step back at every
        boundary, which is why positions stay floats."""
        seam = 1_800_000
        left = slice_ramp(self.ramp, 1_200_000, seam)
        right = slice_ramp(self.ramp, seam, 2_400_000)
        self.assertAlmostEqual(left[-1]["pos"], right[0]["pos"], places=2)

    def test_the_slice_still_rises_across_a_chapter(self):
        """Continuity is not flatness — the arc has to keep climbing."""
        s = slice_ramp(self.ramp, 600_000, 1_200_000)
        self.assertGreater(s[-1]["pos"], s[0]["pos"])

    def test_the_first_slice_still_opens_the_scene_from_silence(self):
        s = slice_ramp(self.ramp, 0, 600_000)
        self.assertEqual(s[0]["pos"], 0.0)

    def test_the_last_slice_still_closes_the_scene(self):
        s = slice_ramp(self.ramp, 3_000_000, self.ramp[-1]["at"])
        self.assertEqual(s[-1]["pos"], 0.0)

    def test_interior_knots_are_kept(self):
        """A slice spanning the peak must carry it, or the arc flattens."""
        s = slice_ramp(self.ramp, 3_000_000, HOUR_MS)
        self.assertIn(100.0, [p["pos"] for p in s])

    def test_degenerate_inputs_are_empty(self):
        self.assertEqual(slice_ramp([], 0, 1000), [])
        self.assertEqual(slice_ramp(self.ramp, 5000, 5000), [])
        self.assertEqual(slice_ramp(self.ramp, 9000, 5000), [])


class TestPadWindow(unittest.TestCase):

    def test_an_interior_chapter_reaches_into_both_neighbours(self):
        self.assertEqual(pad_window(600_000, 1_200_000, 0, HOUR_MS),
                         (600_000 - ESTIM_OVERLAP_MS, 1_200_000 + ESTIM_OVERLAP_MS))

    def test_the_track_start_and_end_are_not_padded(self):
        """There is nothing outside them to read, and the scene SHOULD open
        from silence and close — that fade is the authored one."""
        self.assertEqual(pad_window(0, 600_000, 0, HOUR_MS)[0], 0)
        self.assertEqual(pad_window(3_000_000, HOUR_MS, 0, HOUR_MS)[1], HOUR_MS)

    def test_the_overlap_outlasts_every_upstream_window(self):
        """speed_window_size is 5s, accel_window_size 3s, and the volume ramp's
        own fade-in is 10s. The padding has to outlive the longest of them or
        the transient survives into the kept region."""
        self.assertGreaterEqual(ESTIM_OVERLAP_MS, 10_000)


class TestTrimToWindow(unittest.TestCase):

    def setUp(self):
        self.acts = [{"at": t, "pos": 50} for t in range(0, 20_001, 1000)]

    def test_the_padding_is_discarded(self):
        out = trim_to_window(self.acts, 5_000, 15_000)
        self.assertEqual(out[0]["at"], 5_000)
        self.assertLess(out[-1]["at"], 15_000)

    def test_it_is_half_open_so_chapters_do_not_double_up(self):
        left = trim_to_window(self.acts, 0, 10_000)
        right = trim_to_window(self.acts, 10_000, 20_000)
        ats = [a["at"] for a in left] + [a["at"] for a in right]
        self.assertEqual(len(ats), len(set(ats)))

    def test_the_final_chapter_keeps_the_last_sample(self):
        out = trim_to_window(self.acts, 10_000, 20_000, include_hi=True)
        self.assertEqual(out[-1]["at"], 20_000)

    def test_consecutive_windows_tile_the_track_exactly_once(self):
        bounds = [0, 5_000, 12_000, 20_000]
        got = []
        for i in range(len(bounds) - 1):
            got += trim_to_window(self.acts, bounds[i], bounds[i + 1],
                                  include_hi=bounds[i + 1] == bounds[-1])
        self.assertEqual([a["at"] for a in got], [a["at"] for a in self.acts])


class TestTheSceneKeepsOneArc(unittest.TestCase):
    """What the track-level ramp buys -- which is NOT the seam.

    Measured through the real engine on three chapters of a ten-minute track
    (2026-09-22), each half of the fix applied on its own:

        configuration                seam min   step across seam   body rise
        per-chapter ramp, no pad        6.1         -60.05           +0.53
        overlap only                   99.3          +0.01           +0.85
        track ramp only                60.0          +6.37           +0.55
        overlap + track ramp           99.3          +0.01           +0.85

    So the OVERLAP is what closes the seam; the remaining 60.0 in the
    "track ramp only" row is the speed channel sitting at zero on the clip
    edge, which only padding can remove.

    The track-level ramp is for the ARC. ramp_percent_per_hour describes a rise
    across the SCENE, and computing it per chapter gives a 60-minute film twelve
    1.4% ramps that each reset to where the last one started, instead of one 15%
    climb. Ten minutes is far too short for that to show in the table above,
    which is why it is asserted here on the ramp itself rather than through the
    engine.
    """

    CHAPTERS = 12
    TRACK = HOUR_MS

    def _slices(self):
        ramp = track_volume_ramp(_times(self.TRACK, step=1000))
        edges = [round(i * self.TRACK / self.CHAPTERS) for i in range(self.CHAPTERS + 1)]
        return [slice_ramp(ramp, edges[i], edges[i + 1]) for i in range(self.CHAPTERS)]

    def test_the_level_never_steps_down_at_a_chapter_start(self):
        """Per-chapter ramps sawtooth -- each chapter reopens below where the
        last one finished. One arc cannot do that anywhere."""
        sl = self._slices()
        for i in range(1, len(sl)):
            with self.subTest(chapter=i + 1):
                self.assertGreaterEqual(sl[i][0]["pos"], sl[i - 1][-1]["pos"] - 0.01)

    def test_the_arc_climbs_across_the_whole_hour(self):
        """Early chapters really are quieter than late ones. This is the thing
        a per-chapter ramp cannot express at all."""
        sl = self._slices()
        self.assertLess(sl[1][0]["pos"], 90.0)
        self.assertGreater(sl[-1][0]["pos"], 97.0)
        self.assertGreater(sl[-1][0]["pos"] - sl[1][0]["pos"], 10.0)

    def test_a_per_chapter_ramp_would_have_had_no_arc_at_all(self):
        """The contrast, computed the old way: twelve five-minute ramps, each
        opening at ~98.8 and reaching 100. Twelve times zero arc."""
        five_min = HOUR_MS // self.CHAPTERS
        per_chapter = track_volume_ramp(_times(five_min, step=1000))
        self.assertGreater(per_chapter[1]["pos"], 98.5)
        self.assertLess(per_chapter[2]["pos"] - per_chapter[1]["pos"], 2.0)


# ---------------------------------------------------------------------------
# Against the real engine
# ---------------------------------------------------------------------------

try:
    from forge.funscript_tools import AVAILABLE, build_config, process
except ImportError:  # pragma: no cover - the adapter itself is missing
    AVAILABLE = False

TRACK_HI = 600_000
_STEP = 250
_PAIRS = [(t, 10 if (t // _STEP) % 2 else 90) for t in range(0, TRACK_HI + 1, _STEP)]
_FULL_RAMP = track_volume_ramp([t for t, _ in _PAIRS])


def _generate(lo, hi, *, overlap, inject, channels):
    """One chapter through the real pipeline, trimmed back to its window —
    the same two steps `_polish_generate_estim` takes."""
    plo, phi = pad_window(lo, hi, 0, TRACK_HI, overlap_ms=overlap)
    win = [(t, p) for t, p in _PAIRS if plo <= t <= phi]
    d = Path(tempfile.mkdtemp(prefix="ff_seam_test_"))
    stem = "seam"
    (d / f"{stem}.funscript").write_text(
        json.dumps({"actions": [{"at": t, "pos": p} for t, p in win]}), encoding="utf-8")
    if inject:
        rs = slice_ramp(_FULL_RAMP, plo, phi)
        (d / f"{stem}.ramp.funscript").write_text(
            json.dumps({"actions": rs}), encoding="utf-8")
    config = build_config("Balanced", None, output_dir=str(d))
    with contextlib.redirect_stdout(sys.stderr):
        result = process(str(d / f"{stem}.funscript"), config, None)
    if not result.get("success"):
        raise AssertionError(f"funscript-tools failed: {result}")
    out = {}
    for suf in channels:
        p = d / f"{stem}.{suf}.funscript"
        if p.exists():
            acts = json.loads(p.read_text(encoding="utf-8"))["actions"]
            out[suf] = trim_to_window(acts, lo, hi, include_hi=hi >= TRACK_HI)
    return out


@unittest.skipUnless(AVAILABLE, "funscript-tools not available")
class TestAgainstTheRealEngine(unittest.TestCase):
    """Slow (~6s): these run the actual Edger pipeline, because the thing most
    likely to break on an upstream bump is the assumption that it reads our
    ramp sidecar at all."""

    def test_upstream_really_does_honour_an_injected_ramp(self):
        """The load-bearing assumption. `processor.py` copies
        `<stem>.ramp.funscript` from beside its input and skips
        `make_volume_ramp` when it finds one. If an upstream change ever drops
        that, the notch comes back silently and every other test here still
        passes, because they are all pure arithmetic."""
        lo, hi = 300_000, 360_000
        theirs = _generate(lo, hi, overlap=0, inject=False, channels=("volume",))
        ours = _generate(lo, hi, overlap=0, inject=True, channels=("volume",))

        # Upstream builds its own ramp and opens the clip at silence.
        self.assertEqual(theirs["volume"][0]["pos"], 0)
        # Ours starts where the scene had got to. It is not yet at the plateau
        # — the speed channel is still zero at the clip edge, which is what the
        # overlap padding is for — but it is nowhere near zero.
        self.assertGreater(ours["volume"][0]["pos"], 40)

    def test_the_seam_between_two_chapters_holds(self):
        """THE end-to-end regression. Old way: volume dives to 0 and
        pulse_rise_time (the ramp INVERTED) spikes to 80 against a body of 0."""
        seam = 300_000
        chans = {}
        for lo, hi in ((0, seam), (seam, TRACK_HI)):
            for suf, acts in _generate(
                lo, hi, overlap=ESTIM_OVERLAP_MS, inject=True,
                channels=("volume", "pulse_rise_time"),
            ).items():
                chans.setdefault(suf, []).extend(acts)

        near = [a["pos"] for a in chans["volume"] if seam - 6_000 <= a["at"] <= seam + 6_000]
        body = [a["pos"] for a in chans["volume"] if 100_000 <= a["at"] <= 280_000]
        self.assertTrue(near and body)
        # Within a couple of percent of the plateau, not diving to the floor.
        self.assertGreaterEqual(min(near), max(body) - 3)

        spike = [a["pos"] for a in chans.get("pulse_rise_time", [])
                 if seam - 6_000 <= a["at"] <= seam + 6_000]
        if spike:
            self.assertLessEqual(max(spike), 10)

    def test_the_phase_channels_stop_settling_at_a_boundary(self):
        """alpha/beta are excluded from `match_chapter_seams` on purpose — a dip
        in them is real motion, and smoothing it would change the sensation.
        That reasoning holds mid-chapter and fails at a seam, where the dip is
        the clip edge. Discarding the padding fixes them without any per-channel
        policy, which is the argument for doing it this way."""
        seam = 300_000
        chans = {}
        for lo, hi in ((0, seam), (seam, TRACK_HI)):
            for suf, acts in _generate(
                lo, hi, overlap=ESTIM_OVERLAP_MS, inject=True,
                channels=("alpha", "beta"),
            ).items():
                chans.setdefault(suf, []).extend(acts)

        for suf in ("alpha", "beta"):
            acts = sorted(chans[suf], key=lambda a: a["at"])

            def activity(lo, hi):
                w = [a for a in acts if lo <= a["at"] <= hi]
                return sum(abs(w[i]["pos"] - w[i - 1]["pos"])
                           for i in range(1, len(w))) / max(1, len(w) - 1)

            at_seam = activity(seam - 3_000, seam + 3_000)
            in_body = activity(100_000, 280_000)
            with self.subTest(channel=suf):
                self.assertGreater(at_seam, in_body * 0.9,
                                   f"{suf} still settles at the boundary")


@unittest.skipUnless(AVAILABLE, "funscript-tools not available")
class TestTheGeneratorIsActuallyWiredUp(unittest.TestCase):
    """Everything above tests the parts. This drives `_polish_generate_estim`
    itself on a three-chapter project, because deleting the ramp sidecar write
    or the pad_window call in cli.py would leave every other test in this file
    passing while the notch quietly came back.

    Assertions compare the seam against the track's OWN body rather than
    against fixed numbers: `merged_presets()` reads the developer's
    stim_presets.json, so a hand-edited Balanced preset must not fail the
    build. What is being asserted is continuity, not a level.
    """

    BOUNDS = [0, 200_000, 400_000, TRACK_HI]

    @classmethod
    def setUpClass(cls):
        from forge.polish import STATIONS
        from videoflow.sidecar import forge_dir

        d = Path(tempfile.mkdtemp(prefix="ff_wiring_test_"))
        stem = "wire"
        fs = d / f"{stem}.funscript"
        fs.write_text(json.dumps({"actions": [
            {"at": t, "pos": p} for t, p in _PAIRS]}), encoding="utf-8")

        fdir = forge_dir(fs)
        fdir.mkdir(parents=True, exist_ok=True)
        (fdir / f"{stem}.chapters.json").write_text(json.dumps({"chapters": [
            {"at_ms": cls.BOUNDS[i], "end_ms": cls.BOUNDS[i + 1], "title": f"ch{i + 1}"}
            for i in range(len(cls.BOUNDS) - 1)]}), encoding="utf-8")
        (fdir / f"{stem}.characters.json").write_text(json.dumps({"characters": {
            f"ch{i + 1}": {"characterId": "balanced"}
            for i in range(len(cls.BOUNDS) - 1)}}), encoding="utf-8")

        # Spy on the two helpers while the generator runs. Without this, the
        # ramp half of the fix could be deleted from cli.py and every
        # assertion below would still pass: a ten-minute synthetic track is
        # too short for a track-level arc to be visible in the output (see
        # TestTheSceneKeepsOneArc). Verified by reverting each half and
        # re-running -- the padding half fails six tests, the ramp half failed
        # none until these spies existed.
        import forge.stim_config as sc
        real_pad, real_slice = sc.pad_window, sc.slice_ramp
        cls.padded, cls.ramped = [], []

        def spy_pad(lo, hi, lo_bound, hi_bound, **kw):
            out = real_pad(lo, hi, lo_bound, hi_bound, **kw)
            cls.padded.append(((lo, hi), out))
            return out

        def spy_slice(ramp, lo, hi):
            out = real_slice(ramp, lo, hi)
            cls.ramped.append(((lo, hi), out))
            return out

        sc.pad_window, sc.slice_ramp = spy_pad, spy_slice
        try:
            with contextlib.redirect_stdout(sys.stderr):
                cls.out = ffcli._polish_generate_estim(
                    str(fs), None, STATIONS["estim3p"], match_chapter_volume=False)
        finally:
            sc.pad_window, sc.slice_ramp = real_pad, real_slice
        cls.tmpdir = d

    def test_every_chapter_was_processed_with_padding(self):
        """Guards the padding half of the wiring."""
        self.assertEqual(len(self.padded), len(self.BOUNDS) - 1)
        for (lo, hi), (plo, phi) in self.padded:
            with self.subTest(chapter=(lo, hi)):
                self.assertTrue(plo < lo or lo == 0)
                self.assertTrue(phi > hi or hi == TRACK_HI)

    def test_every_chapter_was_handed_a_slice_of_one_track_ramp(self):
        """Guards the ramp half. Each slice must cover the PADDED window (it
        is the input clip's ramp, not the chapter's), and no interior slice may
        open at zero -- that zero was the whole bug."""
        self.assertEqual(len(self.ramped), len(self.BOUNDS) - 1)
        for i, ((lo, hi), sl) in enumerate(self.ramped):
            with self.subTest(chapter=i + 1):
                self.assertTrue(sl, "no ramp slice was written")
                self.assertEqual(sl[0]["at"], lo)
                self.assertEqual(sl[-1]["at"], hi)
                if i > 0:
                    self.assertGreater(sl[0]["pos"], 50.0)

    def test_the_ramp_slices_form_one_continuous_arc(self):
        """Each chapter picks up where the previous one left off, because all
        of them are reading one ramp."""
        ordered = sorted(self.ramped, key=lambda r: r[0][0])
        for i in range(1, len(ordered)):
            prev_lo, prev_hi = ordered[i - 1][0]
            prev, cur = ordered[i - 1][1], ordered[i][1]
            # The padded windows overlap in TIME but share no knots, so read
            # each slice at the same instant rather than looking for a
            # matching point. Anywhere both cover, both must agree -- that is
            # what makes it one ramp rather than two that happen to meet.
            for t in (prev_hi, (ordered[i][0][0] + prev_hi) // 2):
                with self.subTest(chapter=i + 1, at=t):
                    self.assertAlmostEqual(_level_at(prev, t), _level_at(cur, t),
                                           places=2)
            self.assertGreater(prev_hi, ordered[i][0][0],
                               "padded windows should overlap")
            self.assertLess(prev_lo, ordered[i][0][0])

    @staticmethod
    def _at(acts, t):
        acts = sorted(acts, key=lambda a: a["at"])
        if t <= acts[0]["at"]:
            return float(acts[0]["pos"])
        for i in range(1, len(acts)):
            a, b = acts[i - 1], acts[i]
            if a["at"] <= t <= b["at"]:
                span = (b["at"] - a["at"]) or 1
                return float(a["pos"]) + (float(b["pos"]) - float(a["pos"])) * (t - a["at"]) / span
        return float(acts[-1]["pos"])

    def _actions(self, channel):
        acts = self.out.get(channel, {}).get("actions") or []
        self.assertTrue(acts, f"no {channel} generated")
        return sorted(acts, key=lambda a: a["at"])

    def test_the_volume_channel_does_not_dip_at_any_internal_boundary(self):
        """THE regression, through the real call. Measured on a 60-minute
        export before this: 6-11 out of 100 at every internal boundary."""
        acts = self._actions("volume")
        body = self._at(acts, 100_000)
        for seam in self.BOUNDS[1:-1]:
            with self.subTest(seam=seam):
                self.assertGreater(self._at(acts, seam), body - 3)

    def test_the_scene_still_opens_and_closes(self):
        """Continuity across chapters is not the same as no dynamics at all.
        The track's own first and last points are never padded, so the authored
        open and close survive."""
        acts = self._actions("volume")
        self.assertLess(self._at(acts, 0), 50)
        self.assertLess(self._at(acts, TRACK_HI), 50)

    def test_the_ramp_is_one_arc_and_never_resets(self):
        """What moving it to track level was FOR. Per chapter it reset three
        times; now one arc spans the track.

        ★ This used to compare volume at 50s against 550s and assert the
        later was higher. That passed only because of a bug in
        `forge.polish.dense_to_actions`, which kept local extrema ONLY and so
        discarded every point inside a flat run -- making a saturated plateau
        interpolate as though it were still climbing. With plateau shoulders
        preserved, the real ramp is ~97 by 20s and creeps to 99, so both
        samples read 99 and the old assertion failed. The premise was the
        artifact, not the ramp.

        The property that actually distinguishes one track-level arc from
        three per-chapter ramps is that the interior never RESETS: a
        per-chapter ramp sawtooths down at each boundary. So assert against
        the running maximum instead of against a second sample, which holds
        whether or not the arc has saturated.
        """
        acts = self._actions("volume")
        # Skip the authored open and close (covered by
        # test_the_scene_still_opens_and_closes) and walk the body.
        peak = 0.0
        worst_drop, worst_at = 0.0, None
        for t in range(20_000, TRACK_HI - 20_000, 1_000):
            v = self._at(acts, t)
            peak = max(peak, v)
            if peak - v > worst_drop:
                worst_drop, worst_at = peak - v, t
        # A per-chapter ramp dropped to 6-11 out of 100 at each seam, so a
        # real reset is a ~90-point fall. 12 leaves room for the preset's own
        # modulation without admitting anything that reads as a reset.
        self.assertLess(
            worst_drop, 12.0,
            f"volume fell {worst_drop:.0f} below its running peak at {worst_at}ms "
            f"— that is a ramp reset, not modulation")

    def test_pulse_rise_time_does_not_spike_at_a_boundary(self):
        """It is built from the INVERTED ramp, so a per-chapter ramp made it
        jump UP at each seam (measured: 80 against a body of 0) — which is why
        a raise-only seam repair could never have fixed it."""
        acts = self._actions("pulse_rise_time")
        for seam in self.BOUNDS[1:-1]:
            before = self._at(acts, seam - 10_000)
            after = self._at(acts, seam + 10_000)
            with self.subTest(seam=seam):
                self.assertLess(abs(self._at(acts, seam) - (before + after) / 2), 10)

    def test_the_phase_channels_do_not_jump_at_a_boundary(self):
        """alpha/beta are two independent Edger runs either side of a seam, so
        continuity here is worth checking rather than assuming: the biggest
        step across a boundary must be no worse than the biggest step the
        channel takes in normal play."""
        for channel in ("alpha", "beta"):
            acts = self._actions(channel)

            def biggest(lo, hi):
                w = [a for a in acts if lo <= a["at"] <= hi]
                return max((abs(w[i]["pos"] - w[i - 1]["pos"])
                            for i in range(1, len(w))), default=0)

            body = biggest(50_000, 150_000)
            for seam in self.BOUNDS[1:-1]:
                with self.subTest(channel=channel, seam=seam):
                    self.assertLessEqual(biggest(seam - 1_000, seam + 1_000), body)

    def test_chapters_tile_without_duplicating_a_sample(self):
        """The half-open trim. Before, each window was taken inclusively at
        both ends, so a sample landed twice at every boundary."""
        for channel in ("alpha", "volume"):
            ats = [a["at"] for a in self._actions(channel)]
            with self.subTest(channel=channel):
                self.assertEqual(len(ats), len(set(ats)))


if __name__ == "__main__":
    unittest.main()
