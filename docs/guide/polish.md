# Polish

Polish is where your one edited funscript becomes **device-ready files** — one
set per piece of hardware you intend to play it on.

You author motion once. Polish renders that motion into the shape each device
actually understands: a stroker wants positions over time, an e-stim box wants
a multi-channel field, a shaker wants a low-frequency rumble. Nothing about
your funscript changes here — Polish only translates.

Each device is a **station**. Stamping a station writes its files and records
the settings you used, so a later export ships exactly what you approved.

---

## Can I skip Polish?

Yes. **Skipping Polish means accepting its defaults** — you get device files
for every station, generated at each one's default settings, without having to
walk the tab.

You do not have to work out which devices you lose by skipping. That was the
whole reason for the rule: the alternative is an Export tab that has to
explain, device by device, what is and is not in your bundle.

Three things are still worth knowing:

- **Defaults are defaults.** If you adjusted a station's knobs and walked away
  without stamping, those adjustments are not used. Stamping is what records
  them.
- **Some stations need data you may not have.** The e-stim channel set is built
  from the **character** assigned to each chapter, and the T-Code axis set from
  each chapter's **Mechanical style**. Without those, the export produces no
  files for them — silently, because there is nothing to report. Stations that
  need only the motion track (the per-device stroker clamps, the shaker
  envelope) are always generated.
- **Experimental stations are generated conservatively.** Writing a file is not
  the same as driving hardware — you still load it and set your own limits — so
  an experimental station is included rather than silently dropped. But it does
  not get to apply an *unverified* rate ceiling to someone who never opened the
  tab: FOC-Stim auto-generates at the proven **0.55** ceiling instead of its own
  0.65. Stamp it deliberately and you get 0.65.

One artifact is deliberately left out of the automatic pass: the Bass Shaker's
LFE `.wav`. It is a full-length audio render, and every other audio file in the
bundle is an explicit opt-in. Stamp Bass Shaker if you want it.

Stamping is still worth doing when you care about a specific device — it is the
only way to tune a station and to know exactly what you are shipping.

---

## The e-stim stations

Three stations drive electrical hardware. They are all "e-stim" in the sense
that matters to safety, but they reach the device by different routes, and
that difference decides which files you need.

| Station | Delivered as | Writes |
|---|---|---|
| **E-Stim · 3-phase** | a stereo **audio** signal | position channels + `stim.wav` / `stim.mp3` |
| **FOC-Stim · Direct current control** | the device's **own protocol** | position channels |
| **FOC-Stim · 4-phase** | the device's **own protocol** | four per-electrode channels |

### E-Stim · 3-phase

The restim path. restim plays the `alpha`/`beta` position pair out of your
sound card as a stereo control signal, and the hardware is driven by that
sound. This is why — and only why — the export can render `stim.wav` and
`stim.mp3`: for this station the audio *is* the signal.

### FOC-Stim · Direct current control

Three-phase FOC-Stim, driven directly. It consumes the same kind of
alpha/beta position data as the station above, but it speaks its own protocol
over the wire rather than through your sound card.

The practical consequence: **FOC-Stim does not use the stim mp3 or WAV.** If
you stamp only FOC-Stim stations, no stim audio is rendered, because there is
nothing that would play it. The stim audio options remain correct and useful
for E-Stim (3-phase).

"Direct current control" names the *control path* — the app hands the device
its channel values directly. It does not mean DC output.

### FOC-Stim · 4-phase

Four-phase hardware works differently enough to need its own station. Instead
of an alpha/beta *position*, the device wants a **power level for each of its
four electrodes**.

So this station writes `e1`, `e2`, `e3`, `e4` and does **not** write `alpha`,
`beta`, or the prostate position pair — those channels would be meaningless to
a four-electrode driver.

The conversion from your authored position to four electrode powers is the
same transform restim uses, ported from its `stim_math/transforms_4.py` and
verified against it. Two properties are worth knowing when you look at the
output:

- **The centre is rest.** A neutral position drives nothing, so quiet passages
  stay quiet.
- **One electrode is always at rest.** That is inherent to four-phase drive,
  not a gap in the conversion.

Calibration is a **device setting, not script content** — it lives on the
hardware and is never written into your files.

### Which do I stamp?

Stamp the station that matches the hardware you own. There is no benefit to
stamping FOC-Stim if you play through restim, and no benefit to the 3-phase
FOC-Stim station if your device is four-phase. Stamping more than one is
harmless — it just writes more files.

---

## Experimental stations

**Both FOC-Stim stations are marked experimental**, and their rate limits are
labelled *unverified*. They have been verified against restim's own maths, but
not yet on hardware.

If you are the first to try one: calibrate on the device first, start at its
lowest output, and treat the rate ceiling as unproven.
