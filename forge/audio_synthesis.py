# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus 4.6).
#
# Core 3-phase synthesis math by diglet48 (restim).
# https://github.com/diglet48/restim — MIT License.
# See forge/restim_math/ATTRIBUTION.md for details.

"""
Audio synthesis — render funscript channels to stereo WAV/MP3.

Converts alpha + beta channel funscripts into playable audio files
for estim devices that use audio-based stimulation (2b, 312, Tingler,
ZC95). Protocol devices (FOC-Stim, NeoStim) don't use audio — they
receive real-time commands from restim.

Two waveform modes:
  continuous — smooth sine carrier modulated by position (legacy devices)
  pulse      — duty-cycled pulse trains with cosine envelopes (modern devices)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from forge.restim_math.sine_generator import AngleGenerator
from forge.restim_math.threephase import (
    ThreePhaseCenterCalibration,
    ThreePhaseSignalGenerator,
)
from forge.restim_math.pulse import create_pulse_with_ramp_time

# Safety limits for carrier frequency (Hz).
MIN_CARRIER_FREQ = 300   # Below this risks DC component
MAX_CARRIER_FREQ = 1500  # Above this may not stimulate


@dataclass
class AudioRenderResult:
    """Metadata returned after rendering."""

    output_path: str
    duration_s: float
    file_size_bytes: int
    peak_amplitude: float
    waveform: str
    samplerate: int


# ── Public API ───────────────────────────────────────────────────────


def render_stereo_audio(
    alpha_funscript_path: str,
    beta_funscript_path: str,
    output_path: str,
    duration_s: float,
    waveform: str = "continuous",
    carrier_frequency: float | str = 700.0,
    volume: float = 0.8,
    samplerate: int = 44100,
    pulse_frequency: float = 40.0,
    pulse_width_cycles: float = 5.0,
    pulse_rise_time: float = 2.0,
    on_progress: callable | None = None,
) -> AudioRenderResult:
    """Render alpha + beta funscripts to a stereo audio file.

    Args:
        alpha_funscript_path: Path to .alpha.funscript file.
        beta_funscript_path: Path to .beta.funscript file.
        output_path: Output file path (.wav, .mp3, or .ogg).
        duration_s: Duration in seconds.
        waveform: "continuous" (smooth sine) or "pulse" (pulse train).
        carrier_frequency: Hz (float) or path to .carrier_frequency.funscript.
        volume: Master volume 0.0–1.0.
        samplerate: Audio sample rate (default 44100).
        pulse_frequency: Pulses per second (pulse mode only).
        pulse_width_cycles: Carrier cycles per pulse (pulse mode only).
        pulse_rise_time: Rise/fall time in carrier cycles (pulse mode only).
        on_progress: Callback(seconds_rendered, total_seconds).

    Returns:
        AudioRenderResult with metadata.
    """
    import soundfile as sf

    alpha_t, alpha_y = _load_funscript(alpha_funscript_path)
    beta_t, beta_y = _load_funscript(beta_funscript_path)

    # Carrier frequency: constant or from funscript
    carrier_t, carrier_y = None, None
    if isinstance(carrier_frequency, str) and os.path.isfile(carrier_frequency):
        carrier_t, carrier_y = _load_funscript(carrier_frequency)
    else:
        carrier_frequency = float(carrier_frequency)

    n_samples = int(samplerate * duration_s)
    chunk_size = samplerate // 10  # 100ms chunks

    # Determine output format
    _, ext = os.path.splitext(output_path)
    if ext.lower() == ".mp3":
        compression_level = 0.9
        bitrate_mode = "CONSTANT"
    else:
        compression_level = None
        bitrate_mode = None

    peak = 0.0

    with sf.SoundFile(
        output_path,
        mode="w",
        samplerate=samplerate,
        channels=2,
        compression_level=compression_level,
        bitrate_mode=bitrate_mode,
    ) as f:
        if waveform == "continuous":
            peak = _render_continuous(
                f, n_samples, samplerate, chunk_size, duration_s,
                alpha_t, alpha_y, beta_t, beta_y,
                carrier_frequency, carrier_t, carrier_y,
                volume, on_progress,
            )
        elif waveform == "pulse":
            peak = _render_pulse(
                f, n_samples, samplerate, duration_s,
                alpha_t, alpha_y, beta_t, beta_y,
                carrier_frequency, carrier_t, carrier_y,
                volume, pulse_frequency, pulse_width_cycles,
                pulse_rise_time, on_progress,
            )
        else:
            raise ValueError(f"Unknown waveform: {waveform!r}")

    file_size = os.path.getsize(output_path)

    return AudioRenderResult(
        output_path=output_path,
        duration_s=duration_s,
        file_size_bytes=file_size,
        peak_amplitude=peak,
        waveform=waveform,
        samplerate=samplerate,
    )


# ── Continuous waveform renderer ─────────────────────────────────────


def _render_continuous(
    f, n_samples, samplerate, chunk_size, duration_s,
    alpha_t, alpha_y, beta_t, beta_y,
    carrier_frequency, carrier_t, carrier_y,
    volume, on_progress,
) -> float:
    """Render continuous sine waveform. Returns peak amplitude."""
    carrier_gen = AngleGenerator()
    peak = 0.0
    samples_done = 0

    while samples_done < n_samples:
        n = min(chunk_size, n_samples - samples_done)
        t_start = samples_done / samplerate
        t_end = (samples_done + n) / samplerate
        timeline = np.linspace(t_start, t_end, n, endpoint=False)

        # Interpolate funscript channels at audio rate
        alpha = np.interp(timeline, alpha_t, alpha_y)
        beta = np.interp(timeline, beta_t, beta_y)

        # Map from funscript space [0, 1] to restim space [-1, 1]
        alpha = alpha * 2.0 - 1.0
        beta = beta * 2.0 - 1.0

        # Carrier frequency (constant or from funscript)
        if carrier_t is not None:
            freq = np.interp(timeline, carrier_t, carrier_y)
            freq = np.clip(freq, MIN_CARRIER_FREQ, MAX_CARRIER_FREQ)
            # For variable frequency, use mean for this chunk
            freq_mean = float(np.mean(freq))
        else:
            freq_mean = np.clip(carrier_frequency, MIN_CARRIER_FREQ, MAX_CARRIER_FREQ)

        theta = carrier_gen.generate(n, freq_mean, samplerate)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha, beta)

        L *= volume
        R *= volume

        chunk_peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
        peak = max(peak, chunk_peak)

        f.write(np.column_stack((L, R)))

        samples_done += n
        if on_progress:
            on_progress(samples_done / samplerate, duration_s)

    return float(peak)


# ── Pulse waveform renderer ──────────────────────────────────────────


def _render_pulse(
    f, n_samples, samplerate, duration_s,
    alpha_t, alpha_y, beta_t, beta_y,
    carrier_frequency, carrier_t, carrier_y,
    volume, pulse_frequency, pulse_width_cycles,
    pulse_rise_time, on_progress,
) -> float:
    """Render pulse-based waveform. Returns peak amplitude."""
    peak = 0.0
    sample_pos = 0
    polarity = 1
    phase_angle = 0.0

    while sample_pos < n_samples:
        t_now = sample_pos / samplerate

        # Get carrier frequency at this moment
        if carrier_t is not None:
            freq = float(np.interp(t_now, carrier_t, carrier_y))
        else:
            freq = float(carrier_frequency)
        freq = np.clip(freq, MIN_CARRIER_FREQ, MAX_CARRIER_FREQ)

        # Get position at this moment
        alpha_val = float(np.interp(t_now, alpha_t, alpha_y)) * 2.0 - 1.0
        beta_val = float(np.interp(t_now, beta_t, beta_y)) * 2.0 - 1.0

        # Pulse geometry
        pulse_samples = int(samplerate / freq * pulse_width_cycles)
        pause_duration = max(0.0, 1.0 / pulse_frequency - pulse_width_cycles / freq)
        pause_samples = int(samplerate * pause_duration)

        if pulse_samples < 1:
            pulse_samples = 1

        # Generate pulse envelope
        envelope = create_pulse_with_ramp_time(
            pulse_samples, pulse_width_cycles, pulse_rise_time
        )

        # Generate carrier for this pulse
        theta = phase_angle + np.linspace(
            0, 2 * np.pi * pulse_width_cycles, pulse_samples
        ) * polarity

        # Generate 3-phase signal at constant position for this pulse
        alpha_arr = np.full(pulse_samples, alpha_val, dtype=np.float32)
        beta_arr = np.full(pulse_samples, beta_val, dtype=np.float32)
        L, R = ThreePhaseSignalGenerator.generate(theta, alpha_arr, beta_arr)

        # Apply envelope and volume
        L *= envelope * volume
        R *= envelope * volume

        # Write pulse
        n_write = min(pulse_samples, n_samples - sample_pos)
        if n_write > 0:
            chunk_peak = max(np.max(np.abs(L[:n_write])), np.max(np.abs(R[:n_write])))
            peak = max(peak, chunk_peak)
            f.write(np.column_stack((L[:n_write], R[:n_write])))
            sample_pos += n_write

        # Write pause (silence)
        n_pause = min(pause_samples, n_samples - sample_pos)
        if n_pause > 0:
            f.write(np.zeros((n_pause, 2), dtype=np.float32))
            sample_pos += n_pause

        # Alternate polarity, rotate phase (restim pattern: ~1/5 turn)
        polarity *= -1
        phase_angle = (phase_angle + (np.pi * 2 * 19 / 97)) % (2 * np.pi)

        if on_progress and sample_pos % (samplerate * 5) < (pulse_samples + pause_samples):
            on_progress(sample_pos / samplerate, duration_s)

    return float(peak)


# ── Funscript loading ────────────────────────────────────────────────


def _load_funscript(path: str) -> tuple[np.ndarray, np.ndarray]:
    """Load a funscript and return (times_s, positions_0_1) arrays."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    actions = data.get("actions", [])
    if not actions:
        return np.array([0.0]), np.array([0.5])

    times = np.array([a["at"] / 1000.0 for a in actions])
    positions = np.array([a["pos"] / 100.0 for a in actions])
    positions = np.clip(positions, 0.0, 1.0)

    return times, positions
