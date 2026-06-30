"""Generation-time e-stim flash cap + screech sidecar.

The keystone of the screech-safety work (see
``internal/screech_safety_architecture.md``). Runs AFTER the e-stim
channels are generated and BEFORE they ship, enforcing the safety
invariant:

    The device must never be commanded to near-max carrier frequency AND
    near-max volume at the same instant — that is the painful "flash".

Two complementary clamps on the volume channel(s):

1. **Region-targeted** — where the videoflow de-screech pass flagged a
   clipped/screech span in the *source audio*, hold volume under a firm
   ceiling. This is the smart clamp: it catches flashes that the channel
   values alone can't reveal (at the VictoriaOaks 1:21 screech the volume
   channel read only 0.90 — indistinguishable from intended intensity —
   yet the source clearly screeched). Having the audio-domain regions here
   is exactly why the generator can do what the player backstop cannot.

2. **Co-rail catch-all** — where volume and frequency are *both* pinned at
   the absolute ceiling, cap volume so the combination can't rail. Rare in
   practice (the rails are high on purpose) but a cheap safety net for
   sources we never analysed.

Both write their touched spans to a ``<stem>.screech.json`` sidecar that
the funscript viewer renders as timeline markers and that tells the user a
screech was detected and tamed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# ── Tunables (channel space is 0..100 ints on disk; 0..1 fractions here) ──────
VOL_RAIL = 0.99       # co-rail: volume at/above this AND...
FREQ_RAIL = 0.99      # ...frequency at/above this counts as co-max.
FLASH_VOL_CAP = 0.88  # co-rail cap applied to volume.
REGION_VOL_CAP = 0.80 # firmer cap inside a flagged source-screech span.
# Channels whose values are "volume-like" (felt intensity) and get capped.
VOLUME_CHANNELS = ("volume", "volume-prostate")
FREQ_CHANNEL = "frequency"


@dataclass(frozen=True)
class CapRegion:
    start_s: float
    end_s: float
    channel: str
    reason: str          # "source_screech" | "co_rail"
    peak_volume: float   # max volume (0..1) in the span before capping

    def as_dict(self) -> dict:
        return {
            "start_s": round(float(self.start_s), 3),
            "end_s": round(float(self.end_s), 3),
            "channel": self.channel,
            "reason": self.reason,
            "peak_volume": round(float(self.peak_volume), 3),
        }


def cap_stim_channels(
    channel_files: dict[str, str],
    *,
    screech_regions: list[dict] | None = None,
    write: bool = True,
) -> list[CapRegion]:
    """Cap the volume channel(s) in place; return the regions touched.

    ``channel_files`` maps logical channel name → funscript path. Only
    ``volume`` / ``volume-prostate`` are modified; ``frequency`` (if given)
    is read as the co-rail detector. ``screech_regions`` is the list of
    ``{start_s, end_s}`` dicts from videoflow analysis (seconds).
    """
    regions: list[CapRegion] = []
    spans = _normalize_spans(screech_regions)
    freq_t, freq_p = _load(channel_files.get(FREQ_CHANNEL))

    for name in VOLUME_CHANNELS:
        path = channel_files.get(name)
        t, p = _load(path)
        if t is None:
            continue
        original = list(p)
        touched = [False] * len(p)

        # 1) region-targeted cap (source screeched here)
        for i, ti in enumerate(t):
            ts = ti / 1000.0
            if _in_spans(ts, spans):
                cap = REGION_VOL_CAP * 100.0
                if p[i] > cap:
                    p[i] = cap
                    touched[i] = True

        # 2) co-rail catch-all (volume AND frequency both at the ceiling)
        if freq_t is not None:
            for i, ti in enumerate(t):
                if original[i] >= VOL_RAIL * 100.0:
                    f = _interp(ti, freq_t, freq_p)
                    if f >= FREQ_RAIL * 100.0:
                        cap = FLASH_VOL_CAP * 100.0
                        if p[i] > cap:
                            p[i] = cap
                            touched[i] = True

        regions.extend(_collapse(t, original, touched, name, spans))
        if write and any(touched):
            _save(path, t, p)

    return regions


def cap_channels_dict(
    channels: dict[str, dict],
    *,
    screech_regions: list[dict] | None = None,
) -> list[CapRegion]:
    """In-memory variant of :func:`cap_stim_channels`.

    Operates on the ``{channel: {"actions": [{at, pos}, ...]}}`` shape used
    by the live per-chapter draw and the export packager. Mutates the volume
    channels in place and returns the regions touched. ``frequency`` is read
    as the co-rail detector. Use this on the draw/export path so the
    capped values are what the user sees and what ships.
    """
    spans = _normalize_spans(screech_regions)
    fch = channels.get(FREQ_CHANNEL, {}).get("actions") or []
    freq_t = [a["at"] for a in fch] or None
    freq_p = [float(a["pos"]) for a in fch] or None

    regions: list[CapRegion] = []
    for name in VOLUME_CHANNELS:
        acts = channels.get(name, {}).get("actions")
        if not acts:
            continue
        t = [a["at"] for a in acts]
        original = [float(a["pos"]) for a in acts]
        p = list(original)
        touched = [False] * len(p)
        for i, ti in enumerate(t):
            if _in_spans(ti / 1000.0, spans) and p[i] > REGION_VOL_CAP * 100.0:
                p[i] = REGION_VOL_CAP * 100.0
                touched[i] = True
        if freq_t is not None:
            for i, ti in enumerate(t):
                if original[i] >= VOL_RAIL * 100.0 and _interp(ti, freq_t, freq_p) >= FREQ_RAIL * 100.0:
                    if p[i] > FLASH_VOL_CAP * 100.0:
                        p[i] = FLASH_VOL_CAP * 100.0
                        touched[i] = True
        if any(touched):
            for i, a in enumerate(acts):
                a["pos"] = int(round(p[i]))
        regions.extend(_collapse(t, original, touched, name, spans))
    return regions


def write_sidecar(
    sidecar_path: str | Path,
    *,
    cap_regions: list[CapRegion],
    screech_regions: list[dict] | None,
) -> Path:
    """Write the ``<stem>.screech.json`` report (analysis + generation)."""
    path = Path(sidecar_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "source_screech_regions": screech_regions or [],
        "generation_cap_regions": [r.as_dict() for r in cap_regions],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def discover_channels(output_dir: str | Path, stem: str) -> dict[str, str]:
    """Map logical channel name → path for ``<stem>.<channel>.funscript``."""
    d = Path(output_dir)
    found: dict[str, str] = {}
    for chan in (*VOLUME_CHANNELS, FREQ_CHANNEL):
        f = d / f"{stem}.{chan}.funscript"
        if f.exists():
            found[chan] = str(f)
    return found


# ── funscript IO + helpers ────────────────────────────────────────────────────

def _load(path: str | None):
    if not path or not Path(path).exists():
        return None, None
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    acts = data.get("actions", [])
    return [a["at"] for a in acts], [float(a["pos"]) for a in acts]


def _save(path: str, t: list[int], p: list[float]) -> None:
    src = json.loads(Path(path).read_text(encoding="utf-8"))
    src["actions"] = [{"at": int(ti), "pos": int(round(pi))} for ti, pi in zip(t, p)]
    Path(path).write_text(json.dumps(src), encoding="utf-8")


def _normalize_spans(screech_regions: list[dict] | None) -> list[tuple[float, float]]:
    if not screech_regions:
        return []
    return [
        (float(r["start_s"]), float(r["end_s"]))
        for r in screech_regions
        if "start_s" in r and "end_s" in r
    ]


def _in_spans(ts: float, spans: list[tuple[float, float]]) -> bool:
    return any(lo <= ts <= hi for lo, hi in spans)


def _interp(ti: int, ft: list[int], fp: list[float]) -> float:
    """Linear interpolation of frequency value at time ti (ms)."""
    if ti <= ft[0]:
        return fp[0]
    if ti >= ft[-1]:
        return fp[-1]
    # binary search
    lo, hi = 0, len(ft) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if ft[mid] <= ti:
            lo = mid
        else:
            hi = mid
    span = ft[hi] - ft[lo]
    if span <= 0:
        return fp[lo]
    w = (ti - ft[lo]) / span
    return fp[lo] * (1 - w) + fp[hi] * w


def _collapse(t, original, touched, channel, spans) -> list[CapRegion]:
    out: list[CapRegion] = []
    i = 0
    n = len(touched)
    while i < n:
        if not touched[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and touched[j + 1]:
            j += 1
        ts0, ts1 = t[i] / 1000.0, t[j] / 1000.0
        reason = "source_screech" if any(
            _in_spans(t[k] / 1000.0, spans) for k in range(i, j + 1)
        ) else "co_rail"
        out.append(
            CapRegion(
                start_s=ts0,
                end_s=ts1,
                channel=channel,
                reason=reason,
                peak_volume=max(original[i : j + 1]) / 100.0,
            )
        )
        i = j + 1
    return out
