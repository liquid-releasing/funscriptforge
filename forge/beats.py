"""
Beat detection pipeline.

extract_beats(video_path, output_folder, audio_path=None) -> dict | None
  Extracts audio from video (via av/PyAV) or uses provided audio file,
  runs librosa beat detection, returns timestamps + BPM estimate,
  caches to _beats.json and _beats.csv inside output_folder.

load_beats(output_folder) -> dict | None
  Loads cached _beats.json if it exists, otherwise None.

Both functions return None (with a warning) if required libraries are
missing rather than hard-crashing, so the UI can degrade gracefully.
"""

from __future__ import annotations

import csv
import json
import os
import warnings
from pathlib import Path


# ── Optional dependency detection ──────────────────────────────────────────

def _check_deps():
    missing = []
    try:
        import av  # noqa: F401
    except ImportError:
        missing.append("av")
    try:
        import librosa  # noqa: F401
    except ImportError:
        missing.append("librosa")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    return missing


BEATS_JSON  = "_beats.json"
BEATS_CSV   = "_beats.csv"


# ── Public API ──────────────────────────────────────────────────────────────

def extract_beats(
    video_path: str,
    output_folder: str,
    audio_path: str | None = None,
    sr: int = 22050,
) -> dict | None:
    """Extract audio and detect beats.

    Parameters
    ----------
    video_path:    Path to the source video file.
    output_folder: Directory where _beats.json and _beats.csv are written.
    audio_path:    Optional path to a separate audio file. When provided
                   this is used instead of the video's audio track.
    sr:            Sample rate for librosa (default 22050).

    Returns
    -------
    dict with keys:
        source_path   – audio source used
        bpm_estimate  – float
        beat_times    – list[float]  (seconds)
        beat_count    – int
    or None if extraction fails.
    """
    missing = _check_deps()
    if missing:
        warnings.warn(
            f"beat detection requires: {', '.join(missing)}. "
            "Install with: pip install av librosa numpy"
        )
        return None

    import numpy as np
    import librosa

    source = audio_path or video_path
    try:
        samples = _load_audio(source, sr=sr)
    except Exception as exc:
        warnings.warn(f"beats: could not load audio from {source!r}: {exc}")
        return None

    if samples is None or len(samples) == 0:
        warnings.warn(f"beats: no audio data from {source!r}")
        return None

    try:
        tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        # tempo may be ndarray in newer librosa
        bpm = float(np.atleast_1d(tempo)[0])
    except Exception as exc:
        warnings.warn(f"beats: librosa beat_track failed: {exc}")
        return None

    result = {
        "source_path": source,
        "bpm_estimate": round(bpm, 2),
        "beat_times":   [round(t, 4) for t in beat_times],
        "beat_count":   len(beat_times),
    }

    out = Path(output_folder)
    out.mkdir(parents=True, exist_ok=True)
    _save_json(result, out / BEATS_JSON)
    _save_csv(beat_times, bpm, out / BEATS_CSV)

    return result


def load_beats(output_folder: str) -> dict | None:
    """Return cached beat data or None."""
    p = Path(output_folder) / BEATS_JSON
    if not p.exists():
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# ── Internal helpers ────────────────────────────────────────────────────────

def _load_audio(source: str, sr: int) -> "np.ndarray | None":
    """Load audio samples from video or audio file via PyAV + numpy."""
    import av
    import numpy as np

    samples_list: list[np.ndarray] = []

    with av.open(source) as container:
        audio_streams = [s for s in container.streams if s.type == "audio"]
        if not audio_streams:
            return None

        stream = audio_streams[0]
        resampler = av.AudioResampler(
            format="fltp",
            layout="mono",
            rate=sr,
        )

        for packet in container.demux(stream):
            for frame in packet.decode():
                resampled_frames = resampler.resample(frame)
                for rf in resampled_frames:
                    arr = rf.to_ndarray()           # shape (channels, samples)
                    samples_list.append(arr[0])     # mono → first channel

        # Flush resampler
        for rf in resampler.resample(None):
            arr = rf.to_ndarray()
            samples_list.append(arr[0])

    if not samples_list:
        return None

    return np.concatenate(samples_list)


def _save_json(data: dict, path: Path) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def _save_csv(beat_times: list[float], bpm: float, path: Path) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["beat_index", "time_s", "bpm_estimate"])
        for i, t in enumerate(beat_times):
            writer.writerow([i + 1, round(t, 4), round(bpm, 2)])
