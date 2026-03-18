"""
Video metadata extraction via pymediainfo.
"""

from pathlib import Path


def video_stats(path: str) -> dict | None:
    """Return metadata dict for a video file, or None if unreadable."""
    try:
        from pymediainfo import MediaInfo
    except ImportError:
        return None

    try:
        info = MediaInfo.parse(path)
    except Exception:
        return None

    general = next((t for t in info.tracks if t.track_type == "General"), None)
    video = next((t for t in info.tracks if t.track_type == "Video"), None)
    audio = next((t for t in info.tracks if t.track_type == "Audio"), None)

    if not video:
        return None

    duration_ms = getattr(general, "duration", None) or getattr(video, "duration", None)
    duration_s = int(duration_ms) / 1000.0 if duration_ms else None
    duration_fmt = _fmt_duration(duration_s) if duration_s else "—"

    file_size = getattr(general, "file_size", None)
    size_fmt = _fmt_size(int(file_size)) if file_size else "—"

    fps = getattr(video, "frame_rate", None)
    fps_fmt = f"{float(fps):.2f} fps" if fps else "—"

    width = getattr(video, "width", None)
    height = getattr(video, "height", None)
    resolution = f"{width} × {height}" if width and height else "—"

    video_codec = getattr(video, "format", None) or "—"
    audio_codec = getattr(audio, "format", None) or "—" if audio else "—"

    bit_rate = getattr(video, "bit_rate", None)
    bit_rate_fmt = f"{int(bit_rate) // 1000:,} kbps" if bit_rate else "—"

    return {
        "duration_s": duration_s,
        "duration_fmt": duration_fmt,
        "file_size": int(file_size) if file_size else None,
        "size_fmt": size_fmt,
        "fps_fmt": fps_fmt,
        "resolution": resolution,
        "video_codec": video_codec,
        "audio_codec": audio_codec,
        "bit_rate_fmt": bit_rate_fmt,
    }


def _fmt_duration(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def _fmt_size(size_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"
