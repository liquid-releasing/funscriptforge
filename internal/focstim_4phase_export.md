# FOC-Stim 4-phase export — scope

Status: **scoped, not built.** Written 2026-09-04, after shipping the
three-phase-compatible `focstim` Polish station (`d05c42c`).

The station that ships today emits the same channel set as `estim3p`, because
restim's *three-phase* FOC algorithm consumes exactly that. This document
scopes the genuinely different thing: **four-phase**, which drives four
per-electrode power values instead of a 2-D position.

---

## 1. What is already settled (verified in restim source)

These are not assumptions — each has a source.

| Fact | Source |
| --- | --- |
| Four-phase takes four electrode powers, not a position | `device/focstim/fourphase_algorithm.py` returns `AXIS_ELECTRODE_1..4_POWER` |
| Three-phase takes a 2-D position | `device/focstim/threephase_algorithm.py` returns `AXIS_POSITION_ALPHA` / `_BETA` |
| `AXIS_POSITION_GAMMA` is **not** the fourth phase | It exists in `constants_pb2.pyi` but `fourphase_algorithm` never reads it |
| Funscript suffixes for the four inputs are `e1`–`e4` | `qt_ui/models/funscript_kit.py`: `INTENSITY_A: ('e1', …)` … `INTENSITY_D: ('e4', …)` |
| Each is range **0..1** | same table, `limit_min=0, limit_max=1` |
| Funscript position maps linearly onto the range | `qt_ui/algorithm_factory.py:427` — `np.clip(script.y, 0, 1) * (limit_max - limit_min) + limit_min` |
| `script.y` is already normalised | `funscript/funscript.py:54` — `pos * 0.01` |
| Sidecar naming is `<stem>.<type>.funscript` | `funscript/collect_funscripts.py` — type is `suffixes[-2][1:]` |
| Calibration is a **device setting, not script content** | `AXIS_CALIBRATION_4_A..D` + `_REDUCTION_IN_CENTER` come from `params.calibrate`, set in restim's wizard |
| Parameter transmit interval is 30 ms (~33 Hz) | `device/focstim/proto_device.py:331` — `transmit_dirty_params(interval=30)` |

**Consequence for the export format: there is nothing to invent.** Writing
`<stem>.e1.funscript` … `<stem>.e4.funscript` with ordinary 0–100 positions
produces files restim loads and maps directly onto electrode power 0..1.

Shared channels (`volume`, `pulse_frequency`, `pulse_width`,
`pulse_rise_time`, `frequency`) are unchanged between three- and four-phase —
the four-phase algorithm returns them too. Only the position model differs.

---

## 2. The one open question: where do e1–e4 come from?

This is the whole design risk, and it is **not** a format problem.

Today the pipeline produces `alpha`/`beta` — a 2-D position on the three-phase
triangle — from edger's `process()`. Four-phase wants four independent
intensities. Converting one to the other is a decision about **where current
flows in a body**, and the device carries per-electrode calibration precisely
because that varies by person and placement.

Three candidate approaches, cheapest first:

### A. Geometric projection from the existing alpha/beta
Treat the four electrodes as positions in a plane and project the existing
alpha/beta position onto them (e.g. inverse-distance or barycentric-style
weighting), normalised so total delivered power matches the three-phase case.

- **Pro:** reuses the authored motion exactly; one function; no new authoring
  surface; the sensation should track what the user already tuned.
- **Con:** the electrode geometry is an assumption. Whether "position" even
  means the same thing across the two modes needs hardware to confirm.

### B. Direct four-electrode synthesis from the scene
Generate e1–e4 from the scene's motion/character with a four-electrode spatial
model, independent of alpha/beta.

- **Pro:** uses the mode for what it is rather than emulating three-phase.
- **Con:** a new generator, new tuning surface, and nothing to validate it
  against. This is the expensive option.

### C. Pass-through / manual
Export whatever four curves the user authored elsewhere.

- **Pro:** no invention at all.
- **Con:** no authoring surface exists, so in practice this ships nothing.

**Recommendation: A**, gated on hardware validation (§4). It is the smallest
change that produces a real file, and it degrades to "feels like three-phase"
rather than to "feels wrong".

---

## 3. Implementation sketch (assuming A)

Roughly one focused change each:

1. **`forge/polish.py`** — a second station, `focstim4p`, `device_keys:
   ["foc4phase"]`, `experimental=True`. `is_estim_station()` already returns
   true for any `kind == "estim"`, so the export path picks it up with no
   further edits — that was the point of `d05c42c`.
2. **New: `forge/focstim.py`** — `alpha_beta_to_electrodes(alpha, beta) ->
   (e1, e2, e3, e4)`. Pure function, golden-tested. Documents the electrode
   geometry assumption in one place so hardware findings change one constant
   block, not scattered code.
3. **`cli.py` `_polish_generate_estim`** — when the station is `focstim4p`,
   run the existing edger generation, then derive the four electrode channels
   from the alpha/beta pair and emit `.e1`–`.e4` **instead of** `.alpha`/
   `.beta`. Everything else (volume, pulse params, per-chapter character walk,
   clamping) is unchanged.
4. **`forge/viewer.py`** — add `e1`–`e4` to `_CHANNEL_ORDER` so the Viewer
   lists them in a sensible order.
5. **`ui/web/src/data/polishDevices.js`** — the station card.
6. **Tests** — golden test on the mapping; an export test asserting the four
   files exist with the right suffixes and that `alpha`/`beta` are absent for
   this station.

Deliberately *not* in scope: writing calibration values (device setting), and
`AXIS_POSITION_GAMMA` (unused by four-phase).

---

## 4. Validation — the part that actually gates this

Hardware now exists, so this stops being theoretical. Nothing ships to users
before:

1. **Bench check with no body in circuit.** Confirm restim loads all four
   files, binds them to `INTENSITY_A..D`, and the device stats widget shows
   four channels moving.
2. **Calibrate first.** Run restim's four-phase calibration so per-electrode
   response is normalised before judging the mapping.
3. **Low-amplitude feel test.** `WaveformAmpltiudeFOC` is 0.01–0.20 A;
   start at the floor. The question is only "does the sensation track the
   authored motion" — not comfort at level.
4. **Compare against three-phase** on the same scene. If four-phase feels
   arbitrary where three-phase felt intentional, the geometry assumption in
   §3.2 is wrong and gets revised there.
5. Only then drop `experimental` and remove `focstim`/`focstim4p` from
   `UNVERIFIED_STATIONS` in `tests/test_polish.py`.

**Safety note.** The rate ceiling in `device_specs.json` for `foc4phase`
(700 pos/s / 360 BPM / 80 ms) is stamped *"Confidence: LOW … limits assumed
identical pending vendor data"*. It is an assumption inherited from
`foc3phase`, not a measurement. Do not raise knob defaults toward that ceiling
on the strength of the number alone.

---

## 5. ForgePlayer

FunscriptForge's own testing does **not** need ForgePlayer: restim loads the
sidecars directly, so §4 can be done as soon as the export exists.

ForgePlayer support is a separate piece — it currently drives e-stim through
its vendored synth, and four-phase would mean either speaking FOC-Stim's
protobuf/HDLC protocol (`device/focstim/proto_api.py`, `hdlc.py`) or handing
off to restim. That is its own scope; it should not block this export.

---

## 6. Estimate

| Piece | Size |
| --- | --- |
| Station + wiring (§3.1, 3.4–3.5) | small — the export path is already generalised |
| Mapping function + goldens (§3.2) | small in code, **the design is the cost** |
| Generation branch (§3.3) | medium — touches the per-chapter walk |
| Hardware validation (§4) | not a code cost; it is the gate |
| ForgePlayer (§5) | separate, larger, not a blocker |

The code is perhaps a day. The mapping decision and validation are what
determine whether it is worth shipping, and neither is a typing problem.
