# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus).

"""Bass-shaker rendering — motion intensity as sub-bass rumble.

Every other Polish station renders a POSITION: where the toy is at time t. A
tactile transducer has no position. It has one degree of freedom — how hard it
is shaking — so the scene reaches it as an *intensity envelope*, which is
exactly how the Events catalog has always modelled it (``axes: ['volume']``,
"sub-bass intensity"). Until now nothing rendered that intent; you could author
"rumble here" and no file ever carried it.

Two artifacts come out of one envelope:

* ``<stem>.shaker.funscript`` — the envelope itself, 0 (still) to 100 (full
  shake), for bridges that drive a transducer from a script.
* an LFE audio file — a low-frequency tone amplitude-modulated by that
  envelope, for plugging straight into a shaker amp with no bridge at all.

**The envelope tracks SPEED, not position.** A slow full-depth stroke and a
fast shallow one sit at the same positions but feel nothing alike, and it's the
fast one you want to feel in your chest. Deriving rumble from |Δpos|/Δt means
the shaker punctuates the same moments the motion does — stillness goes quiet,
a burst hits hard — which is what makes it read as part of the same performance
rather than a second track running alongside it.
"""

from __future__ import annotations

import math

# Tactile transducers live roughly here. Below ~20 Hz you feel nothing and the
# amp just heats up; above ~80 Hz a shaker stops being felt and starts being
# heard, which is the wrong instrument.
BAND_HZ = (20.0, 80.0)
DEFAULT_CARRIER_HZ = 40.0
DEFAULT_SAMPLERATE = 44100

# Speed (position-units per second) mapped to full-scale rumble. Measured
# against real scripts: sustained fast work sits near 300–400 u/s and peaks
# well past that, so anchoring full scale at 400 keeps ordinary motion in the
# expressive middle of the range instead of pinned at 100.
FULL_SCALE_SPEED = 400.0


def envelope_from_actions(
    actions: list[dict],
    *,
    smoothing: float = 0.55,
    sample_ms: int = 50,
    full_scale_speed: float = FULL_SCALE_SPEED,
) -> list[dict]:
    """Derive a 0–100 sub-bass intensity envelope from funscript *actions*.

    Args:
        actions: Source funscript actions (``{"at", "pos"}``, any spacing).
        smoothing: 0–1 exponential smoothing on the intensity. Higher is
            smoother; a shaker's suspended mass cannot follow steps anyway, so
            an unsmoothed envelope just asks for motion the hardware will blur
            into mush.
        sample_ms: Envelope grid spacing. 50 ms (20 Hz) is well above the
            fastest rumble change a body can distinguish and keeps the file
            small on a long scene.
        full_scale_speed: Speed in position-units/sec that maps to 100.

    Returns:
        A list of ``{"at", "pos"}`` samples on a uniform grid. Empty input (or
        a single action, which has no speed) returns ``[]``.
    """
    if not actions or len(actions) < 2:
        return []

    pts = sorted(
        ({"at": int(a["at"]), "pos": float(a["pos"])} for a in actions),
        key=lambda p: p["at"],
    )
    start, end = pts[0]["at"], pts[-1]["at"]
    if end <= start:
        return []

    # Instantaneous speed per source segment. Held as (t_end, speed) so a
    # lookup at time t finds the segment t falls inside.
    segs: list[tuple[int, int, float]] = []
    for a, b in zip(pts, pts[1:]):
        dt = b["at"] - a["at"]
        if dt <= 0:
            continue
        segs.append((a["at"], b["at"], abs(b["pos"] - a["pos"]) / (dt / 1000.0)))
    if not segs:
        return []

    alpha = 1.0 - max(0.0, min(1.0, smoothing))
    out: list[dict] = []
    level = 0.0
    j = 0
    t = start
    while t <= end:
        while j < len(segs) - 1 and segs[j][1] <= t:
            j += 1
        speed = segs[j][2]
        target = max(0.0, min(1.0, speed / full_scale_speed)) * 100.0
        # First sample seeds directly so a scene that opens mid-action doesn't
        # spend its first second ramping up from a silence that never happened.
        level = target if not out else level + alpha * (target - level)
        out.append({"at": int(t), "pos": int(round(max(0.0, min(100.0, level))))})
        t += sample_ms

    return out


def render_lfe_audio(
    envelope: list[dict],
    output_path: str,
    *,
    carrier_hz: float = DEFAULT_CARRIER_HZ,
    gain: float = 0.85,
    samplerate: int = DEFAULT_SAMPLERATE,
    duration_s: float | None = None,
) -> dict:
    """Render *envelope* to a mono sub-bass tone at ``output_path``.

    A single low-frequency sine amplitude-modulated by the envelope. No
    harmonics: anything above the band would be heard rather than felt, and a
    shaker amp has no business receiving it.

    Args:
        envelope: 0–100 samples from :func:`envelope_from_actions`.
        output_path: ``.wav`` / ``.flac`` / ``.ogg`` (soundfile-writable).
        carrier_hz: Tone frequency; clamped into :data:`BAND_HZ`.
        gain: Master gain 0–1, applied after the envelope.
        samplerate: Output sample rate.
        duration_s: Override the rendered length; defaults to the envelope's
            own span.

    Returns:
        ``{"output_path", "duration_s", "carrier_hz", "peak_amplitude", "samplerate"}``.

    Raises:
        ValueError: If *envelope* is empty — there is nothing to render, and a
            silent file would masquerade as a working stamp.
    """
    import numpy as np
    import soundfile as sf

    if not envelope:
        raise ValueError("shaker: cannot render LFE audio from an empty envelope")

    carrier_hz = max(BAND_HZ[0], min(BAND_HZ[1], float(carrier_hz)))
    gain = max(0.0, min(1.0, float(gain)))

    start = envelope[0]["at"]
    end = envelope[-1]["at"]
    span_s = max(0.0, (end - start) / 1000.0)
    total_s = float(duration_s) if duration_s is not None else span_s
    if total_s <= 0:
        raise ValueError("shaker: envelope has zero duration")

    n = int(total_s * samplerate)
    t = np.arange(n, dtype=np.float64) / samplerate

    # Envelope onto the audio grid. np.interp holds the end values beyond the
    # envelope's span, which is what we want for a duration override.
    env_t = np.array([(p["at"] - start) / 1000.0 for p in envelope], dtype=np.float64)
    env_y = np.array([p["pos"] / 100.0 for p in envelope], dtype=np.float64)
    amp = np.interp(t, env_t, env_y)

    signal = np.sin(2.0 * math.pi * carrier_hz * t) * amp * gain

    # Short fades: a shaker fed a hard edge produces an audible thump from the
    # cone's step response, which reads as a defect rather than as content.
    fade_n = min(int(0.02 * samplerate), n // 2)
    if fade_n > 0:
        ramp = np.linspace(0.0, 1.0, fade_n)
        signal[:fade_n] *= ramp
        signal[-fade_n:] *= ramp[::-1]

    sf.write(output_path, signal.astype(np.float32), samplerate)

    return {
        "output_path": str(output_path),
        "duration_s": round(total_s, 3),
        "carrier_hz": carrier_hz,
        "peak_amplitude": float(np.max(np.abs(signal))) if n else 0.0,
        "samplerate": samplerate,
    }
