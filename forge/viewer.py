"""Load a project's generated device outputs for the Viewer stage.

The Viewer is the last pipeline stage — a review surface for what generation
actually produced. This module scans the project's ``<stem>.output/`` tree
(written at export), groups the channel funscripts by device, decimates each
channel for transport, and attaches the ``<stem>.screech.json`` note. Pure
file IO; no generation.
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

# `.forge` bundle station folder → friendly device name (the loose `.output`
# tree uses these display names directly; the zip uses lowercase station slugs).
_STATION_DEVICE = {
    "estim3p": "E-Stim", "estim": "E-Stim", "handy": "Handy", "lovense": "Lovense",
    "focstim": "FOC-Stim",
    "osr2": "OSR2", "sr6": "SR6", "ossm": "Ossm", "vacuglide": "Vacuglide",
    "multifunplayer": "MultiFunPlayer",
}

# Device folders we know how to surface, in a sensible review order. Any other
# subfolder of <stem>.output that holds .funscript files is still picked up.
_DEVICE_ORDER = [
    "E-Stim", "FOC-Stim", "Handy", "Lovense", "MultiFunPlayer", "OSR2", "SR6",
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


def _stride_decimate(actions: list[dict], cap: int) -> list[dict]:
    """Time-uniform thinning for the monitor: keep every k-th real sample so the
    curve stays monotonic in time. Unlike the center lane's min/max envelope
    (which emits low+high *pairs* per bin and reads as a zigzag when zoomed),
    this preserves the true stroke shape in a windowed view."""
    n = len(actions)
    if cap <= 0 or n <= cap:
        return [{"at": int(a["at"]), "pos": int(a["pos"])} for a in actions]
    k = (n + cap - 1) // cap
    out = [{"at": int(actions[i]["at"]), "pos": int(actions[i]["pos"])} for i in range(0, n, k)]
    last = actions[-1]
    if out[-1]["at"] != int(last["at"]):
        out.append({"at": int(last["at"]), "pos": int(last["pos"])})
    return out


_VERSION_RE = re.compile(r"^(.*) \(\d+\)$")


def _unversioned(name: str) -> str:
    """Strip Explorer-style versioning: `scene (3)` → `scene`."""
    m = _VERSION_RE.match(name)
    return m.group(1) if m else name


def _output_candidates(parent: Path) -> list[tuple[Path, str]]:
    """Every `<stem>.output` folder in `parent`, paired with the stem it belongs
    to. Export versions FOLDERS after the name (`scene.output (2)`)."""
    if not parent.is_dir():
        return []
    out = []
    for d in parent.iterdir():
        if not d.is_dir():
            continue
        base = _unversioned(d.name)
        if base.endswith(".output"):
            out.append((d, base[: -len(".output")]))
    return out


def _forge_candidates(parent: Path) -> list[tuple[Path, str]]:
    """Every `.forge` bundle FILE, paired with its stem. Export versions files
    inside the extension (`scene (2).forge`)."""
    return [(f, _unversioned(f.name[: -len(".forge")]))
            for f in parent.glob("*.forge") if f.is_file()]


def _newest(cands: list[tuple[Path, str]], stem: str) -> tuple[Path | None, str]:
    """The most recently WRITTEN candidate — this project's if it has one, else
    a sibling render's (1080p/4K/VR share one generated set).

    Picking by name is what made re-exporting look broken: export never
    overwrites (`scene.forge` → `scene (2).forge`), so the original bundle keeps
    winning and the Viewer shows the FIRST export forever, however many times
    you re-generate. mtime is what "the thing I just produced" actually means.
    """
    pool = [c for c in cands if c[1] == stem] or cands
    if not pool:
        return None, stem
    path, base = max(pool, key=lambda c: c[0].stat().st_mtime)
    return path, base


def _resolve_sources(path: str) -> list[tuple[str, Path, str]]:
    """Generated-output sources for a project as ``[(kind, path, stem)]``,
    newest first — kind is ``'output'`` (loose folder) or ``'forge'`` (bundle).

    The loose folder and the bundle can be from different exports, so they are
    ordered against each other by mtime rather than one always shadowing the
    other; a caller takes the first that actually holds channels.
    """
    p = Path(path)
    parent = p.parent
    out_dir, out_stem = _newest(_output_candidates(parent), p.stem)
    forge, forge_stem = _newest(_forge_candidates(parent), p.stem)
    found = []
    if out_dir is not None:
        found.append(("output", out_dir, out_stem))
    if forge is not None:
        found.append(("forge", forge, forge_stem))
    found.sort(key=lambda c: c[1].stat().st_mtime, reverse=True)
    return found


def _resolve_stem(path: str) -> str:
    """The stem the generated files were written under — the project's own, or
    an adopted sibling's."""
    found = _resolve_sources(path)
    return found[0][2] if found else Path(path).stem


def load_single_channel(path: str, device: str, channel: str, *, cap: int = 40000) -> dict:
    """Full-resolution actions for ONE device channel — the monitor's funscript
    view (windowed to a few seconds, so it needs real samples, not the center
    lane's decimated envelope). Returns {available, name, actions, rawCount}."""
    for kind, src, stem in _resolve_sources(path):
        if kind == "output":
            dev_dir = src / device
            if not dev_dir.is_dir():
                continue
            for f in sorted(dev_dir.glob("*.funscript")):
                if _channel_name(f.name, stem) == channel:
                    try:
                        acts = (json.loads(f.read_text(encoding="utf-8")).get("actions") or [])
                    except Exception:
                        acts = []
                    if len(acts) >= 2:
                        return {"available": True, "name": channel,
                                "actions": _stride_decimate(acts, cap), "rawCount": len(acts)}
        else:
            try:
                z = zipfile.ZipFile(src)
                for n in z.namelist():
                    if not n.endswith(".funscript"):
                        continue
                    parts = n.split("/")
                    dev = (_STATION_DEVICE.get(parts[1], parts[1].title())
                           if len(parts) >= 3 and parts[0] == "stations"
                           else ("Motion" if n == "motion.funscript" else None))
                    nm = "stroke" if n == "motion.funscript" else _channel_name(parts[-1], stem)
                    if dev == device and nm == channel:
                        acts = (json.loads(z.read(n).decode("utf-8")).get("actions") or [])
                        if len(acts) >= 2:
                            return {"available": True, "name": channel,
                                    "actions": _stride_decimate(acts, cap), "rawCount": len(acts)}
            except Exception:
                pass
    return {"available": False, "name": channel, "actions": [], "rawCount": 0}


def load_audio_only(path: str, *, points: int = 150000) -> dict:
    """High-resolution audio envelope for the monitor's windowed waveform (the
    main payload's 16k is fine for the full-timeline lane but blocky when the
    monitor zooms to ~12s). Returns {available, audio:{peaks,hopMs,durationMs}}."""
    stem = _resolve_stem(path)
    audio = _load_audio(Path(path).parent, stem, target=points)
    return {"available": bool(audio), "audio": audio}


def load_device_outputs(path: str, *, max_points: int = 2000) -> dict:
    """Load a project's generated device channels for the Viewer.

    ``path`` is the project's media or funscript path. Takes the most recently
    written of the loose ``<stem>.output/`` folder and the ``<stem>.forge``
    bundle — export versions rather than overwrites, so "newest" has to mean
    mtime, not name. Falls back to a sibling render's set (1080p/4K/VR share one
    generated set). Returns
    ``{available, devices:[{name, channels:[{name, actions}]}], durationMs, screech, source}``.
    """
    parent = Path(path).parent
    res = None
    stem = Path(path).stem
    output_dir = None
    for kind, src, src_stem in _resolve_sources(path):
        if kind == "output" and output_dir is None:
            output_dir = src
        cand = (_load_from_dir(src, src_stem, max_points) if kind == "output"
                else _load_from_forge(src, src_stem, max_points))
        if cand["available"]:
            cand["source"] = kind
            cand["sourcePath"] = str(src)
            cand["sourceName"] = src.name
            res, stem = cand, src_stem
            break
    if res is None:
        return {"available": False, "error": "no <stem>.output dir or .forge bundle",
                "devices": []}
    # Context lanes — audio waveform + beats + events — sourced wherever they
    # live (the loose output, the .forge cache, or the bundle). Spectrogram is
    # omitted: it's only built during full analysis, not part of the export.
    res["audio"] = _load_audio(parent, stem)
    res["beats"] = _load_beats(parent, stem)
    res["events"] = _load_events(parent, stem)
    res["chapters"] = _load_chapters(parent, stem)
    # Spectrogram is shipped as a static PNG in the export (Preview/), not as
    # rebuildable cells — so the center spectro lane renders the image directly.
    spec = (output_dir / "Preview" / "spectrogram.png") if output_dir else None
    res["spectrogramPng"] = str(spec) if spec and spec.is_file() else None
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


def _load_audio(parent: Path, stem: str, target: int = 16000) -> dict | None:
    """Audio peak envelope for the viewer's audio lane, decimated for transport.
    Tries the hidden cache, then the .forge bundle (the loose output has none).
    ``target`` controls resolution — the center lane re-bins to pixel width so
    16k is plenty there, but the monitor windows to ~12s and wants far more."""
    def _shape(d: dict) -> dict | None:
        peaks = d.get("peaks")
        if not peaks:
            return None
        dur = d.get("duration_ms") or d.get("durationMs") or 0
        dec = _decimate_peaks(peaks, target=target)
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


def _load_chapters(parent: Path, stem: str) -> list[dict]:
    """Chapter spans for the per-chapter liveliness readout: {start, end, name,
    tone, color}. From the hidden cache, else the .forge bundle's chapters.json."""
    raw = None
    cache = parent / f".{stem}.forge" / f"{stem}.chapters.json"
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
                hit = next((n for n in z.namelist() if n.endswith("chapters.json")), None)
                if hit:
                    raw = json.loads(z.read(hit).decode("utf-8"))
            except Exception:
                raw = None
    if not raw:
        return []
    chs = raw.get("chapters") if isinstance(raw, dict) else raw
    out = []
    for i, c in enumerate(chs or []):
        start = c.get("at_ms")
        end = c.get("end_ms")
        if start is None or end is None:
            continue
        out.append({
            "start": int(start), "end": int(end),
            "name": c.get("name") or f"Chapter {i + 1}",
            "tone": c.get("tone", ""), "color": c.get("color", ""),
        })
    return out


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
