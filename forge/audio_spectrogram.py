"""
Mel-spectrogram preview renderer — visualization-only, not a sidecar yet.

Renders a mel spectrogram PNG next to the media file so we can eyeball
whether the frequency-over-time view is useful for funscript editing.
If it pans out, the next step is sidecar + canvas-mode rendering in the
MediaViewer (separate work).

render_mel_spectrogram(media_path, output_path=None, n_mels=64) -> str | None
  Returns the written PNG path. None on dep / decode failure.

Lives separately from forge.audio_peaks because the data shape (2D mel
bins over time) and the consumer (PNG preview) are different. If we
later promote this to a sidecar mode, we'd add a sidecar-writer here
similar to audio_peaks.write_sidecar.
"""

from __future__ import annotations

import warnings
from pathlib import Path


PNG_SUFFIX = ".spectrogram.png"


def _check_deps() -> list[str]:
    missing = []
    try:
        import librosa  # noqa: F401
    except ImportError:
        missing.append("librosa")
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        missing.append("matplotlib")
    try:
        import numpy  # noqa: F401
    except ImportError:
        missing.append("numpy")
    return missing


def default_png_path(media_path: str) -> str:
    p = Path(media_path)
    return str(p.with_suffix(PNG_SUFFIX))


def render_mel_spectrogram(
    media_path: str,
    output_path: str | None = None,
    n_mels: int = 64,
    sr: int = 22050,
    hop_length: int = 512,
    fmax: int = 8000,
    figsize: tuple[float, float] = (16.0, 4.0),
    cmap: str = "magma",
) -> str | None:
    """Render a mel spectrogram PNG of the media's audio track.

    Parameters
    ----------
    media_path:   Path to source media (video or audio).
    output_path:  Where to write the PNG. Default: <stem>.spectrogram.png
                  next to the media file.
    n_mels:       Number of mel frequency bins (default 64).
    sr:           Resample rate (default 22050 Hz).
    hop_length:   FFT hop in samples (default 512 ≈ 23ms at 22050 Hz).
    fmax:         Max frequency in Hz (default 8000 — covers vocal and
                  percussion content; higher rates rarely add signal for
                  pop/music sources).
    figsize:      Matplotlib figure size in inches. Wide aspect for
                  readability across long tracks.
    cmap:         Matplotlib colormap. 'magma' / 'inferno' / 'viridis'
                  all good for spectrograms; 'magma' reads warm-on-dark
                  similar to a DAW.

    Returns
    -------
    Path to the written PNG, or None on dep / decode failure.
    """
    missing = _check_deps()
    if missing:
        warnings.warn(
            f"audio-spectrogram requires: {', '.join(missing)}. "
            "Install with: pip install librosa matplotlib numpy"
        )
        return None

    import librosa
    import librosa.display
    import matplotlib
    matplotlib.use("Agg")  # headless — no GUI backend needed for PNG write
    import matplotlib.pyplot as plt
    import numpy as np

    try:
        samples, _ = librosa.load(media_path, sr=sr, mono=True)
    except Exception as exc:
        warnings.warn(f"audio-spectrogram: could not load audio: {exc}")
        return None
    if samples is None or len(samples) == 0:
        warnings.warn(f"audio-spectrogram: no audio in {media_path!r}")
        return None

    # Mel spectrogram in power units, then dB-scale for visualization
    # (otherwise the dynamic range is too compressed and everything
    # reads as solid color).
    mel = librosa.feature.melspectrogram(
        y=samples.astype(np.float32, copy=False),
        sr=sr,
        n_mels=n_mels,
        hop_length=hop_length,
        fmax=fmax,
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)

    out_path = output_path or default_png_path(media_path)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=figsize, dpi=120)
    img = librosa.display.specshow(
        mel_db,
        sr=sr,
        hop_length=hop_length,
        x_axis="time",
        y_axis="mel",
        fmax=fmax,
        cmap=cmap,
        ax=ax,
    )
    ax.set_title(f"Mel spectrogram · {Path(media_path).name}")
    ax.set_xlabel("Time (mm:ss)")
    ax.set_ylabel("Frequency (Hz, mel-scaled)")
    fig.colorbar(img, ax=ax, format="%+2.0f dB")
    fig.tight_layout()
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)

    return out_path
