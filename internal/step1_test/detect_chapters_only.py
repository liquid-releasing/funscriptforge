"""Run JUST chapter detection + sidecar write — skip the slow downstream pipeline.

Used to regenerate <stem>.chapters.json for Step 1 phrase testing without
re-running beats / classify / audio_peaks / spectrogram / chapter_clips.
"""

import sys
import time
from pathlib import Path

import librosa

from videoflow.structural import _detect_chapters, _write_sidecar, _prepare_audio
from videoflow.structural import _videoflow_version


def detect_only(media_path: str, target_minutes: float = 5.5, sr: int = 22050) -> None:
    media = Path(media_path)
    if not media.exists():
        print(f"NOT FOUND: {media}", file=sys.stderr)
        sys.exit(1)

    def _progress(msg: str) -> None:
        print(f"  {msg}", file=sys.stderr, flush=True)

    print(f"=== {media.name} ===", file=sys.stderr)

    t0 = time.time()
    print("[extract] preparing audio...", file=sys.stderr, flush=True)
    audio_path, tmp = _prepare_audio(media, sr=sr, progress=_progress)
    print(f"  done in {time.time() - t0:.1f}s -> {audio_path}", file=sys.stderr)

    try:
        t1 = time.time()
        print("[load] librosa.load...", file=sys.stderr, flush=True)
        y, sr_ = librosa.load(audio_path, sr=sr, mono=True)
        duration_ms = int(round(librosa.get_duration(y=y, sr=sr_) * 1000))
        print(f"  done in {time.time() - t1:.1f}s -> {duration_ms / 1000:.1f}s @ {sr_} Hz", file=sys.stderr)

        t2 = time.time()
        print("[detect] _detect_chapters...", file=sys.stderr, flush=True)
        chapters = _detect_chapters(
            y, sr_, duration_ms,
            target_minutes=target_minutes,
            progress=_progress,
        )
        print(f"  done in {time.time() - t2:.1f}s -> {len(chapters)} chapters", file=sys.stderr)

        t3 = time.time()
        print("[sidecar] writing chapters.json...", file=sys.stderr, flush=True)
        _write_sidecar(
            media,
            {
                "chapters": [c.to_dict() for c in chapters],
                "generated_by": {
                    "tool": "videoflow.structural",
                    "tool_version": _videoflow_version(),
                    "target_minutes": target_minutes,
                    "stage": "partial",
                },
            },
            writer="videoflow.structural",
            writer_version=_videoflow_version(),
            mode="analyze",
        )
        print(f"  done in {time.time() - t3:.1f}s", file=sys.stderr)

    finally:
        if tmp is not None:
            Path(tmp).unlink(missing_ok=True)

    total = time.time() - t0
    print(f"=== total {total:.1f}s for {len(chapters)} chapters ===", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: detect_chapters_only.py <media_path>", file=sys.stderr)
        sys.exit(2)
    detect_only(sys.argv[1])
