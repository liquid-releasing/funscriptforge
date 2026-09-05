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

Yes — but read this first, because "skip" does not mean "no device files".

If you export without stamping anything, FunscriptForge still generates two
stations for you, using their default settings:

- **E-Stim (3-phase)** — the full e-stim channel set
- **T-Code / SR6** — the multi-axis stroker file

Every other station — including **both FOC-Stim stations** — is only produced
if you stamp it in Polish. Skipping Polish therefore means **no FOC-Stim files
in your export at all.**

That is deliberate. The two auto-generated stations are hardware we have
verified end to end; the FOC-Stim stations are still marked experimental, and
generating output for untested hardware without being asked is the wrong
default.

Two more things worth knowing about skipping:

- The auto-generated pass uses **default knobs**. It does not use anything you
  adjusted and then walked away from without stamping.
- The e-stim pass needs a **character assigned** to your chapters. Without one
  it produces nothing, silently — there is no error, just no e-stim files.

If you only care about one device, stamping that one station is faster than
skipping, and it is the only way to know what you are shipping.

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
