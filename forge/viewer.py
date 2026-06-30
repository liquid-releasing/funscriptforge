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
    output_dir = p.parent / f"{stem}.output"
    if output_dir.is_dir():
        res = _load_from_dir(output_dir, stem, max_points)
        if res["available"]:
            res["source"] = "output"
            return res
    forge = p.parent / f"{stem}.forge"
    if forge.is_file():
        res = _load_from_forge(forge, stem, max_points)
        if res["available"]:
            res["source"] = "forge"
            return res
    return {"available": False, "error": "no <stem>.output dir or .forge bundle",
            "devices": []}


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
