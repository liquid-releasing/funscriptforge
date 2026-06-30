"""Load a project's generated device outputs for the Viewer stage.

The Viewer is the last pipeline stage — a review surface for what generation
actually produced. This module scans the project's ``<stem>.output/`` tree
(written at export), groups the channel funscripts by device, decimates each
channel for transport, and attaches the ``<stem>.screech.json`` note. Pure
file IO; no generation.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

# `.forge` bundle station folder → friendly device name (the loose `.output`
# tree uses these display names directly; the zip uses lowercase station slugs).
_STATION_DEVICE = {
    "estim3p": "E-Stim", "estim": "E-Stim", "handy": "Handy", "lovense": "Lovense",
    "osr2": "OSR2", "sr6": "SR6", "ossm": "Ossm", "vacuglide": "Vacuglide",
    "multifunplayer": "MultiFunPlayer",
}

# Device folders we know how to surface, in a sensible review order. Any other
# subfolder of <stem>.output that holds .funscript files is still picked up.
_DEVICE_ORDER = [
    "E-Stim", "Handy", "Lovense", "MultiFunPlayer", "OSR2", "SR6",
    "Ossm", "Vacuglide", "Edger",
]
# Channel display order within a device (E-Stim). Unknown channels append after.
_CHANNEL_ORDER = [
    "alpha", "beta", "frequency", "pulse_frequency", "volume",
    "pulse_rise_time", "alpha-prostate", "beta-prostate", "volume-prostate",
]


def _decimate(actions: list[dict], max_points: int) -> list[dict]:
    """Peak-preserving decimation: keep min+max position per time bin.

    Returns the actions unchanged when already under ``max_points``. Otherwise
    bins into ``max_points/2`` windows and emits each window's lowest and
    highest point in time order, so the stroke envelope survives.
    """
    n = len(actions)
    if n <= max_points or max_points < 4:
        return [{"at": int(a["at"]), "pos": int(a["pos"])} for a in actions]
    bins = max_points // 2
    out: list[dict] = []
    for i in range(bins):
        lo = (i * n) // bins
        hi = max(lo + 1, ((i + 1) * n) // bins)
        seg = actions[lo:hi]
        amin = min(seg, key=lambda a: a["pos"])
        amax = max(seg, key=lambda a: a["pos"])
        first, second = (amin, amax) if amin["at"] <= amax["at"] else (amax, amin)
        out.append({"at": int(first["at"]), "pos": int(first["pos"])})
        if second is not first:
            out.append({"at": int(second["at"]), "pos": int(second["pos"])})
    return out


def _channel_name(filename: str, stem: str) -> str:
    """`<stem>.<channel>.funscript` → `<channel>` (robust to dotted stems)."""
    base = filename[: -len(".funscript")] if filename.endswith(".funscript") else filename
    if base == stem:
        return "stroke"  # the bare <stem>.funscript = main stroke channel
    if base.startswith(stem + "."):
        return base[len(stem) + 1:]
    return base.rsplit(".", 1)[-1] if "." in base else base


def _channel_sort_key(name: str):
    return (_CHANNEL_ORDER.index(name) if name in _CHANNEL_ORDER else len(_CHANNEL_ORDER), name)


def _device_sort_key(name: str):
    return (_DEVICE_ORDER.index(name) if name in _DEVICE_ORDER else len(_DEVICE_ORDER), name)


def _find_screech(output_dir: Path, stem: str) -> dict | None:
    """Look for ``<stem>.screech.json`` anywhere under the output tree."""
    direct = output_dir / f"{stem}.screech.json"
    if direct.exists():
        try:
            return json.loads(direct.read_text(encoding="utf-8"))
        except Exception:
            return None
    for p in output_dir.rglob(f"{stem}.screech.json"):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def load_device_outputs(path: str, *, max_points: int = 2000) -> dict:
    """Load a project's generated device channels for the Viewer.

    ``path`` is the project's media or funscript path. Prefers the loose
    sibling ``<stem>.output/`` (live, most-recent); falls back to the
    ``<stem>.forge`` bundle (the shipped snapshot) so the Viewer still works
    when only the bundle was kept. Returns
    ``{available, devices:[{name, channels:[{name, actions}]}], durationMs, screech, source}``.
    """
    p = Path(path)
    stem = p.stem
    parent = p.parent
    output_dir = parent / f"{stem}.output"
    forge = parent / f"{stem}.forge"
    # Sibling fallback — a folder may hold several renders of the same title
    # (1080p / 4K / VR) but the output was generated for just one. If the opened
    # media's exact <stem>.output/.forge isn't there, adopt the first sibling so
    # opening ANY of those files still finds the work. The resolved stem then
    # drives channel-name parsing + the audio/beats/events lookup.
    if not output_dir.is_dir():
        sibs = sorted(parent.glob("*.output"))
        if sibs:
            output_dir = sibs[0]
            stem = output_dir.name[: -len(".output")]
    if not forge.is_file():
        fsibs = sorted(f for f in parent.glob("*.forge") if f.is_file())
        if fsibs:
            forge = fsibs[0]
            if not output_dir.is_dir():
                stem = forge.name[: -len(".forge")]
    res = None
    if output_dir.is_dir():
        cand = _load_from_dir(output_dir, stem, max_points)
        if cand["available"]:
            cand["source"] = "output"
            res = cand
    if res is None and forge.is_file():
        cand = _load_from_forge(forge, stem, max_points)
        if cand["available"]:
            cand["source"] = "forge"
            res = cand
    if res is None:
        return {"available": False, "error": "no <stem>.output dir or .forge bundle",
                "devices": []}
    # Context lanes — audio waveform + beats + events — sourced wherever they
    # live (the loose output, the .forge cache, or the bundle). Spectrogram is
    # omitted: it's only built during full analysis, not part of the export.
    res["audio"] = _load_audio(parent, stem)
    res["beats"] = _load_beats(parent, stem)
    res["events"] = _load_events(parent, stem)
    # Spectrogram is shipped as a static PNG in the export (Preview/), not as
    # rebuildable cells — so the center spectro lane renders the image directly.
    spec = output_dir / "Preview" / "spectrogram.png"
    res["spectrogramPng"] = str(spec) if spec.is_file() else None
    return res


def _load_beats(parent: Path, stem: str) -> dict | None:
    """Beat grid for the monitor + audio-lane ticks: {bpm, beatsMs, downbeatsMs}."""
    raw = None
    cache = parent / f".{stem}.forge" / f"{stem}.beats.json"
    if cache.is_file():
        try:
            raw = json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            raw = None
    if raw is None:
        forge = parent / f"{stem}.forge"
        if forge.is_file():
            try:
                z = zipfile.ZipFile(forge)
                hit = next((n for n in z.namelist() if n.endswith("beats.json")), None)
                if hit:
                    raw = json.loads(z.read(hit).decode("utf-8"))
            except Exception:
                raw = None
    if not raw:
        return None
    beats = raw.get("beats_ms") or raw.get("beatsMs") or []
    if not beats:
        return None
    return {
        "bpm": raw.get("bpm"),
        "beatsMs": [int(b) for b in beats],
        "downbeatsMs": [int(b) for b in (raw.get("downbeats_ms") or raw.get("downbeatsMs") or [])],
    }


def _decimate_peaks(peaks: list, target: int = 3000) -> list:
    n = len(peaks)
    if n <= target:
        return [abs(float(x)) for x in peaks]
    out = []
    for i in range(target):
        lo = (i * n) // target
        hi = max(lo + 1, ((i + 1) * n) // target)
        out.append(max(abs(float(x)) for x in peaks[lo:hi]))
    return out


def _load_audio(parent: Path, stem: str) -> dict | None:
    """Audio peak envelope for the viewer's audio lane, decimated for transport.
    Tries the hidden cache, then the .forge bundle (the loose output has none)."""
    def _shape(d: dict) -> dict | None:
        peaks = d.get("peaks")
        if not peaks:
            return None
        dur = d.get("duration_ms") or d.get("durationMs") or 0
        # Finer than the lane needs (the lane re-bins to pixel width) so the
        # zoomed-in monitor waveform isn't a solid block.
        dec = _decimate_peaks(peaks, target=16000)
        hop = (dur / len(dec)) if (dur and dec) else (d.get("hop_ms") or d.get("hopMs") or 10)
        return {"peaks": dec, "hopMs": hop, "durationMs": dur}

    cache = parent / f".{stem}.forge" / f"{stem}.audio.json"
    if cache.is_file():
        try:
            return _shape(json.loads(cache.read_text(encoding="utf-8")))
        except Exception:
            pass
    forge = parent / f"{stem}.forge"
    if forge.is_file():
        try:
            z = zipfile.ZipFile(forge)
            hit = next((n for n in z.namelist() if n.endswith("audio.json")), None)
            if hit:
                return _shape(json.loads(z.read(hit).decode("utf-8")))
        except Exception:
            pass
    return None


def _load_events(parent: Path, stem: str) -> list[dict]:
    """Parse the Edger events.yml into timeline spans {start, end, label}."""
    import yaml

    raw = None
    loose = parent / f"{stem}.output" / "Edger" / f"{stem}.events.yml"
    if loose.is_file():
        try:
            raw = yaml.safe_load(loose.read_text(encoding="utf-8"))
        except Exception:
            raw = None
    if raw is None:
        forge = parent / f"{stem}.forge"
        if forge.is_file():
            try:
                z = zipfile.ZipFile(forge)
                hit = next((n for n in z.namelist() if n.endswith("events.yml")), None)
                if hit:
                    raw = yaml.safe_load(z.read(hit).decode("utf-8"))
            except Exception:
                raw = None
    if not raw:
        return []
    out = []
    for e in raw.get("events") or []:
        t = e.get("time")
        if t is None:
            continue
        dur = int((e.get("params") or {}).get("duration_ms") or 0)
        out.append({"start": int(t), "end": int(t) + dur, "label": e.get("name", "")})
    return out


def _load_from_dir(output_dir: Path, stem: str, max_points: int) -> dict:
    devices: list[dict] = []
    duration_ms = 0
    for dev_dir in sorted(
        [d for d in output_dir.iterdir() if d.is_dir()],
        key=lambda d: _device_sort_key(d.name),
    ):
        channels: list[dict] = []
        for f in sorted(dev_dir.glob("*.funscript")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            acts = data.get("actions") or []
            if len(acts) < 2:
                continue
            if acts[-1]["at"] > duration_ms:
                duration_ms = int(acts[-1]["at"])
            channels.append({
                "name": _channel_name(f.name, stem),
                "actions": _decimate(acts, max_points),
                "rawCount": len(acts),
            })
        if channels:
            channels.sort(key=lambda c: _channel_sort_key(c["name"]))
            devices.append({"name": dev_dir.name, "channels": channels})

    return {
        "available": bool(devices),
        "devices": devices,
        "durationMs": duration_ms,
        "screech": _find_screech(output_dir, stem),
    }


def _load_from_forge(forge_path: Path, stem: str, max_points: int) -> dict:
    """Read device channels from a ``.forge`` zip (``stations/<slug>/*.funscript``
    plus the root ``motion.funscript``)."""
    try:
        z = zipfile.ZipFile(forge_path)
    except Exception:
        return {"available": False, "error": "unreadable .forge", "devices": []}

    by_station: dict[str, list[str]] = {}
    motion_entry = None
    screech = None
    for n in z.namelist():
        if n == "motion.funscript":
            motion_entry = n
        elif n.endswith(".screech.json"):
            try:
                screech = json.loads(z.read(n).decode("utf-8"))
            except Exception:
                screech = None
        elif n.endswith(".funscript"):
            parts = n.split("/")
            if len(parts) >= 3 and parts[0] == "stations":
                by_station.setdefault(parts[1], []).append(n)

    duration_ms = 0

    def _read(entry: str, name: str) -> dict | None:
        nonlocal duration_ms
        try:
            data = json.loads(z.read(entry).decode("utf-8"))
        except Exception:
            return None
        acts = data.get("actions") or []
        if len(acts) < 2:
            return None
        if acts[-1]["at"] > duration_ms:
            duration_ms = int(acts[-1]["at"])
        return {"name": name, "actions": _decimate(acts, max_points), "rawCount": len(acts)}

    devices: list[dict] = []
    for slug in sorted(by_station, key=lambda s: _device_sort_key(_STATION_DEVICE.get(s, s))):
        channels = []
        for entry in sorted(by_station[slug]):
            ch = _read(entry, _channel_name(entry.split("/")[-1], stem))
            if ch:
                channels.append(ch)
        if channels:
            channels.sort(key=lambda c: _channel_sort_key(c["name"]))
            devices.append({"name": _STATION_DEVICE.get(slug, slug.title()), "channels": channels})

    if motion_entry:
        mc = _read(motion_entry, "stroke")
        if mc:
            devices.append({"name": "Motion", "channels": [mc]})

    return {
        "available": bool(devices),
        "devices": devices,
        "durationMs": duration_ms,
        "screech": screech,
    }
