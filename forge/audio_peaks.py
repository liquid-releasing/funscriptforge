"""
Audio peaks sidecar — pre-computed waveform for the MediaViewer Audio mode.

extract_peaks(media_path, hop_ms=10, sr=22050) -> dict | None
  Decodes audio from a video or audio file via PyAV (mono float32),
  computes per-hop RMS, normalizes to [0, 1], and returns a sidecar
  dict ready to write next to the media file.

load_peaks(media_path) -> dict | None
  Reads <stem>.audio.json next to the media file, returns None if
  absent or unparseable.

Sidecar shape:
    {
      "version": "1.0",
      "hop_ms": int,
      "duration_ms": int,
      "peaks": [float, ...],      # 0..1, length = duration_ms / hop_ms
      "peak_count": int,
      "generated_by": {"tool": "...", "method": "rms"}
    }

Returns None (with a warning) if PyAV / numpy aren't installed, so the UI
can degrade gracefully — same shape as forge.beats.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path


SIDECAR_SUFFIX = ".audio.json"
SIDECAR_VERSION = "1.0"


def _check_deps() -> list[str]:
    missing = []
    try:
        import librosa  # noqa: F401
    except ImportError:
        missing.append("librosa")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    return missing


def sidecar_path(media_path: str) -> str:
    """Return the canonical sidecar path for the given media file.

    Strips the media extension and appends `.audio.json`. The MediaViewer
    lookup path on the Rust side mirrors this.
    """
    p = Path(media_path)
    return str(p.with_suffix(SIDECAR_SUFFIX))


def load_peaks(media_path: str) -> dict | None:
    """Return the cached sidecar dict or None when absent / unparseable."""
    sp = Path(sidecar_path(media_path))
    if not sp.exists():
        return None
    try:
        with open(sp) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def extract_peaks(
    media_path: str,
    hop_ms: int = 10,
    sr: int = 22050,
) -> dict | None:
    """Decode media audio and compute per-hop RMS peaks.

    Parameters
    ----------
    media_path:  Path to source media (video or audio).
    hop_ms:      Window size in milliseconds. 10ms (default) gives
                 ~100 peaks/sec; a 30-minute track ≈ 180k floats ≈ 1.4MB
                 JSON. Larger hop trades resolution for file size.
    sr:          Resampler sample rate (default 22050 Hz). The hop window
                 in samples is `sr * hop_ms / 1000`.

    Returns
    -------
    dict with keys: version, hop_ms, duration_ms, peaks, peak_count,
    generated_by. Or None if dependencies are missing / decode failed.

    Peaks are RMS magnitudes normalized into [0, 1] against the global
    max. Normalizing per-track (rather than per-hop) preserves dynamic
    range — a quiet passage reads as quiet, not "loudest local sound."
    """
    missing = _check_deps()
    if missing:
        warnings.warn(
            f"audio-peaks requires: {', '.join(missing)}. "
            "Install with: pip install librosa numpy"
        )
        return None

    if hop_ms < 1:
        raise ValueError(f"hop_ms must be >= 1, got {hop_ms}")

    import numpy as np

    try:
        samples = _load_audio(media_path, sr=sr)
    except Exception as exc:
        warnings.warn(f"audio-peaks: could not load audio from {media_path!r}: {exc}")
        return None
    if samples is None or len(samples) == 0:
        warnings.warn(f"audio-peaks: no audio data from {media_path!r}")
        return None

    hop_samples = max(1, int(round(sr * hop_ms / 1000.0)))
    # Trim to a multiple of hop_samples so we can reshape into hops.
    n_hops = len(samples) // hop_samples
    if n_hops == 0:
        warnings.warn(f"audio-peaks: audio too short for hop_ms={hop_ms}")
        return None
    trimmed = samples[: n_hops * hop_samples].astype(np.float32, copy=False)
    frames = trimmed.reshape(n_hops, hop_samples)

    # RMS per hop. Squaring float32 stays in float32 → fast and bounded.
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    peak_max = float(np.max(rms))
    if peak_max > 0:
        norm = (rms / peak_max).astype(np.float32, copy=False)
    else:
        norm = rms  # all-silence track — leave zeros
    peaks = [round(float(v), 4) for v in norm]

    duration_ms = int(round(n_hops * hop_ms))

    return {
        "version": SIDECAR_VERSION,
        "hop_ms": int(hop_ms),
        "duration_ms": duration_ms,
        "peaks": peaks,
        "peak_count": len(peaks),
        "generated_by": {
            "tool": "funscriptforge.cli.audio-peaks",
            "method": "rms",
            "sample_rate": sr,
        },
    }


def write_sidecar(media_path: str, data: dict) -> str:
    """Write `data` to `<stem>.audio.json` next to the media file.

    Returns the sidecar path. Uses compact JSON (no indent) since peak
    arrays explode in size when pretty-printed.
    """
    sp = sidecar_path(media_path)
    Path(sp).parent.mkdir(parents=True, exist_ok=True)
    with open(sp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return sp


def _load_audio(source: str, sr: int):
    """Decode audio from `source` to mono float32 numpy array at `sr` Hz.

    Uses librosa.load which routes through soundfile for plain audio and
    audioread→ffmpeg for container formats (mp4/mkv/etc). Requires ffmpeg
    to be on PATH for video sources. Returns None if the file has no
    decodable audio.
    """
    import librosa
    import numpy as np

    samples, _ = librosa.load(source, sr=sr, mono=True)
    if samples is None or samples.size == 0:
        return None
    return samples.astype(np.float32, copy=False)
