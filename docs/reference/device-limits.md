# Device Limits

> **Last updated**: 2026-04-12
>
> These are the velocity and timing limits FunscriptForge uses when
> applying device-aware corrections. Most are community-derived estimates
> because device manufacturers consistently avoid publishing hard numbers.
> If you have better data for your device, please share it — we'll update.
>
> See also: [Device Safety →](device-safety.md)

## Summary table

| Device | max_speed (pos/s) | max_bpm | min_cycle_ms | Confidence | Source |
| --- | --- | --- | --- | --- | --- |
| The Handy | 400 | 120 | 250 | Medium | Community consensus + "10 strokes/s" marketing |
| OSR2 | 500 | 150 | 200 | Low | Community estimate; depends on servo choice/build |
| Generic / Intiface | 300 | 100 | 300 | Low | Conservative Bluetooth fallback estimate |
| Legacy (2b/312) | 500 | 240 | 120 | Low | Audio bandwidth of continuous waveform |
| Stereostim (pulse) | 600 | 300 | 100 | Low-Medium | Pulse encoding allows faster modulation than legacy |
| FOC-Stim 3-phase | 700 | 360 | 80 | Low-Medium | Direct current control, no audio bottleneck |
| FOC-Stim 4-phase | 700 | 360 | 80 | Low | Same hardware as 3-phase, assumed same |
| NeoStim | 550 | 280 | 110 | Very Low | Interpolated between stereostim and FOC |

## Per-device research notes

### The Handy

**What we found:**
- Marketing says "10 strokes per second" (from official Facebook demo + CES 2023 TikTok). At full 110mm stroke, 10 strokes/s = 2200 mm/s *theoretical*. In practice, full strokes at that speed aren't achievable.
- Community consensus on eroscripts/reddit: ~400 mm/s practical max at typical stroke lengths. Some report ~600 mm/s at very short strokes (<30mm).
- Handy SDK (`@ohdoki/handy-sdk` npm package) documents HAMP velocity range 0-100 but doesn't publish the mm/s mapping.
- The Handy REST API v2 at handyfeeling.com accepts absolute position (xa) and absolute velocity (va) parameters. No published ceiling in the API docs we could fetch.
- No "Handy v2" or "Handy Pro" exists as of this research. The product line is one SKU ("The Handy") at $245.
- Firmware updates are OTA and may change limits, but no changelog with velocity numbers found.

**What we're using:** 400 pos/s. Defensible as the community-consensus practical max.

**Confidence:** Medium. The 400 number appears consistently in community discussions but isn't vendor-published. If Sweetech publishes official specs, update.

**Sources:**
- [Storming Gravity product page](https://storminggravity.com/en-us/products/the-handy-a-high-performance-interactive-stroker) — no specs in HTML, JS-rendered
- [Official Facebook speed demo](https://www.facebook.com/TheHandyOfficial/videos/handy-speed-demo/201185631814651/) — "10 strokes/s"
- [CES 2023 TikTok](https://www.tiktok.com/@carterpcs/video/7186070462936468779) — "10 strokes/s"
- [Handy SDK npm](https://www.npmjs.com/package/@ohdoki/handy-sdk) — API structure, no velocity ceiling

### OSR2 / SR6

**What we found:**
- OSR2 uses two 20kg.cm servos; SR6 uses six servos in a Stewart platform.
- OSR2 stroke: 112mm default, 150mm maximum. SR6 stroke: 120mm up/down, 60mm L/R, 60mm F/B.
- Control via T-Code serial protocol over ESP32.
- **No published max velocity.** Speed depends on servo model, build quality, load, and stroke length. The OSR Wiki and Your Hobbies Customized product pages describe features and movement ranges but not speed limits.
- Community reports vary widely: 300-600 mm/s depending on servo quality and stroke length.

**What we're using:** 500 pos/s. Mid-range of community reports. Reasonable for a well-built OSR2 with standard servos.

**Confidence:** Low. "Depends on build" is the honest answer. A cheap servo build might max at 300; a premium build at 600+.

**Sources:**
- [OSR Wiki - SR6 Overview](https://osr.wiki/books/sr6/page/overview) — movement ranges, no speed
- [Your Hobbies Customized](https://yourhobbiescustomized.com/) — product pages, no speed specs
- [Thingiverse OSR2](https://www.thingiverse.com/thing:4843410) — 20kg.cm servo spec

### Generic / Intiface (Bluetooth devices)

**What we found:**
- Intiface (Buttplug.io) is a middleware protocol, not a device. It bridges many devices including Lovense, Kiiroo, WeVibe, etc.
- Each device has its own motor/actuator limits. A Lovense Solace has different speed from a Kiiroo Keon.
- No universal "Intiface max speed" exists.

**What we're using:** 300 pos/s. Conservative fallback representing the slowest Bluetooth devices in the Intiface ecosystem.

**Confidence:** Low. This is a guess intended as a safe floor, not a measured value.

### FOC-Stim (3-phase and 4-phase)

**What we found:**
- FOC-Stim is open-source hardware by diglet48. Uses an ESP32 + DRV8231A motor drivers + transformer (Xicon 42TL004, winding ratio 5.5).
- Drive circuit limit: 30V max, effective ~10V to neutral, 110V output-to-output.
- Max charge: <5 μC benchmark.
- Frequency range: operational up to 3000-5000 Hz (where device parameters become problematic).
- **No published "max pos/s" or velocity limit.** FOC-Stim is a *current driver*, not a position actuator. The concept of "position velocity" only applies at the funscript→waveform layer (restim), not at the hardware layer. The hardware constraint is frequency and charge-per-pulse, not position speed.
- The practical limit on funscript velocity for FOC is: how fast can the stimulation pattern change without the user losing sensation? This is a **perceptual** limit, not a hardware one. Community consensus: FOC can follow faster patterns than audio-based estim because of direct current control (no DAC→amplifier→transformer chain adding latency).

**What we're using:** 700 pos/s for both 3-phase and 4-phase. This represents "the hardware isn't the bottleneck; the bottleneck is what feels good." Community reports suggest curated estim scripts run 700+ pos/s without issue on FOC.

**Confidence:** Low-Medium. The 700 number is a perceptual ceiling, not a hardware ceiling. The hardware can go much faster; the question is whether the user benefits.

**Sources:**
- [FOC-Stim README](https://github.com/diglet48/FOC-Stim/blob/master/README.md)
- [FOC-Stim v4 docs](https://github.com/diglet48/FOC-Stim/blob/master/docs/focstim-v4.md) — ESP32, DRV8231A, accelerometer
- [FOC-Stim v4 output specs](https://github.com/diglet48/FOC-Stim/blob/master/docs/focstim-v4-output-specifications.md) — 30V limit, <5μC charge, 3000-5000 Hz range

### Legacy estim (2b / ET-312 / continuous audio)

**What we found:**
- These are audio-driven boxes. The estim signal IS the audio waveform — a continuous sine/triangle/saw passed through electrodes.
- The speed limit is effectively the audio bandwidth of the amplifier chain: DAC → audio amp → transformer → electrodes. Standard audio sampling at 44.1 kHz means the theoretical limit is very high, but the *useful* limit is lower because the body filters high-frequency stimulation.
- Practical useful range: below ~1000 Hz for sensation. Above that, stimulation becomes imperceptible.
- **No funscript velocity limit** in the hardware sense. The funscript controls the *envelope* of the audio waveform, not the waveform itself. Envelope changes at 500 pos/s are easily achievable.

**What we're using:** 500 pos/s. Conservative, based on the assumption that rapid envelope changes above this rate don't add meaningful sensation on legacy hardware.

**Confidence:** Low. This is an educated guess, not a measured value.

### Stereostim (pulse-based: Tingler, ZC95)

**What we found:**
- Pulse-based estim encodes the stimulation as discrete pulses rather than continuous waveforms. Each pulse has width, rise time, and amplitude.
- Pulse encoding allows faster modulation than continuous waveform because the pulse parameters can change independently between pulses.
- The hardware is typically audio-based but the pulse structure gives more control over sensation.
- **No published velocity limit.** Same conceptual framework as legacy: the funscript controls the pulse envelope, and the hardware limit is the audio chain bandwidth.

**What we're using:** 600 pos/s. Slightly higher than legacy because pulse encoding allows faster parameter changes.

**Confidence:** Low-Medium. The 600 number reflects that pulse-based is faster than continuous but slower than FOC.

### NeoStim

**What we found:**
- Web search returned **medical neurostimulation devices**, not the hobbyist estim device we're looking for. The "NeoStim" in the estim community appears to be a niche device with very little public documentation.
- No specs found from any source. No GitHub repo. No vendor page.

**What we're using:** 550 pos/s. Interpolated between stereostim (600) and legacy (500), biased toward stereostim because NeoStim is reportedly more modern.

**Confidence:** Very Low. This is entirely a guess. If a NeoStim user reports real-world limits, update immediately.

## Key takeaways

1. **Vendor specs for velocity are effectively nonexistent** across all devices. The Handy's "10 strokes/s" is the closest to an official number, and it's marketing, not engineering.

2. **Estim devices don't have a "velocity limit" in the mechanical sense.** The funscript controls an envelope that modulates a waveform or pulse train. The hardware constraint is frequency/charge, not position speed. Our `max_speed` values for estim devices are **perceptual ceilings** ("above this, faster changes don't add sensation"), not hardware ceilings.

3. **Mechanical device speeds depend on build quality** (OSR2/SR6) and firmware version (Handy). Our numbers are community consensus for typical setups.

4. **All numbers in device_specs.json should carry a confidence tag.** We added `notes` fields with "PLACEHOLDER" for the new entries. Going forward, when a user reports a real-world limit that differs from ours, update the JSON and the notes.

5. **The right model for estim devices may not be max_speed at all.** A future redesign might separate "mechanical velocity cap" (Handy: 400 pos/s hard limit) from "perceptual envelope rate" (FOC: 700 pos/s useful ceiling). Today they share the same `max_speed` field.
