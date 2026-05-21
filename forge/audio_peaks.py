"""Audio peaks sidecar — thin re-export shim of :mod:`videoflow.audio_peaks`.

The peaks pipeline moved upstream to videoflow 2026-05-21 so all forge
apps share one analysis path AND so peaks are built alongside chapters /
spectrogram in `videoflow.structural.auto_chapter` (one user-triggered
analysis pass writes all the sidecars at once, no more video-burping
lazy decode on first viewer-mode toggle).

This module exists only to keep `cli.py audio-peaks` and any other
direct callers working without churn. Real implementations live in
videoflow — see :mod:`videoflow.audio_peaks` for sidecar shape, the
decode/compute split, and integration notes.

Importers can keep using these names; under the hood they call into
videoflow:

    from forge.audio_peaks import (
        decode_audio, compute_peaks, load_peaks,
        write_sidecar, sidecar_path,
    )

For the recommended path (build sidecars alongside chapter analysis),
call `videoflow.structural.auto_chapter` instead — it now emits the
peaks + spectrogram sidecars as part of the chapter pass.
"""

from __future__ import annotations

from videoflow.audio_peaks import (  # noqa: F401  (re-exports)
    DEFAULT_HOP_MS,
    DEFAULT_SAMPLE_RATE,
    SIDECAR_SUFFIX,
    SIDECAR_VERSION,
    compute_peaks,
    compute_sidecar_from_samples,
    decode_audio,
    extract_peaks,
    extract_sidecar,
    load_peaks,
    load_sidecar,
    sidecar_path,
    write_sidecar,
)
