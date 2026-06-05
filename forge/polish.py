"""Polish — device-clamp adapter, the last shaping step before Export.

Channels produces device-AGNOSTIC motion. Polish runs that motion through a
per-device "forge pass" (smoothing -> slew/rate ceiling -> BPM cap -> quiet
floor -> quantize) and produces device-ready files. It is a THIN ADAPTER:

  * The tunable polish math is ported verbatim from the v3 design engine
    (``forge-ui-design/.../polish-engine.js``) so the live JS preview and the
    written file share one algorithm (golden-locked in tests).
  * The SAFETY-critical speed/delta clamp reuses the authoritative, tested
    engine in :mod:`forge.device_specs` (``combined_limits`` +
    ``apply_minimum_fix``) as a final backstop. We do NOT re-derive it here.
  * The first-order mechanical-lag "as performed" trace is a PREVIEW visual
    only (see :func:`preview_pass`). It is never baked into the output file.

Station catalog (v1 = owned / user-testable hardware):

  ===========  ====================  ==============================  ============
  station id   hardware              device_specs limits             output
  ===========  ====================  ==============================  ============
  ``estim3p``  E-Stim 3-phase        ``foc3phase``                   9-channel set
  ``handy``    The Handy (1-axis)    ``handy``                       ``.funscript``
  ``osr2``     OSR2 (TCode)          ``osr2``                        axis siblings
  ``sr6``      SR6 (TCode 6-axis)    ``sr6``                         axis siblings
  ===========  ====================  ==============================  ============

OSR2/SR6 are TCode multi-axis: they consume the MultiFunPlayer-convention
sibling set (``<stem>.funscript`` = L0 + ``.surge/.sway/.twist/.roll/.pitch``),
not a flat funscript. The Handy is a single-axis ``.funscript``.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field

from .device_specs import DeviceSpec, apply_minimum_fix, combined_limits


def _round_half_up(x: float) -> int:
    """Round half away from zero toward +inf, matching JS ``Math.round``.

    Python's builtin ``round`` is banker's (round-half-to-even), which disagrees
    with the JS preview at exact .5 — this keeps the two engines bit-identical.
    """
    return math.floor(x + 0.5)

# ─── TCode axis -> MultiFunPlayer sibling suffix ──────────────────────────────
# L0 is the bare ``<stem>.funscript`` (suffix ""); the rest are siblings.
TCODE_SUFFIX = {
    "L0": "",
    "L1": "surge",
    "L2": "sway",
    "R0": "twist",
    "R1": "roll",
    "R2": "pitch",
}


@dataclass
class Station:
    """A Polish output target — one device the user can play the result on."""

    id: str
    label: str
    sublabel: str
    kind: str                       # "stroker" | "stroker-tcode" | "estim"
    device_keys: list[str]          # keys into forge/device_specs.json
    axes: list[str]                 # TCode axes this station writes (L0 = main)
    output_template: str            # e.g. "{stem}.handy.funscript"
    default_knobs: dict = field(default_factory=dict)
    experimental: bool = False
    constraint_hint: str = ""


# v1 catalog — only hardware we own and can verify. Post-beta rows
# (Vacuglide cloud, e-stim 4-phase, subwoofer) slot in here later as data.
STATIONS: dict[str, Station] = {
    "estim3p": Station(
        id="estim3p",
        label="E-Stim",
        sublabel="3-phase",
        kind="estim",
        device_keys=["foc3phase"],
        axes=["L0"],  # synthesised channel set, not TCode siblings
        output_template="{stem}.estim3.funscript",
        default_knobs={"rateLimit": 0.55, "quietFloor": 0.06, "smoothing": 0.30, "latency": 20},
        constraint_hint="Rate-of-change ceiling · safety",
    ),
    "handy": Station(
        id="handy",
        label="The Handy",
        sublabel="1-axis stroker",
        kind="stroker",
        device_keys=["handy"],
        axes=["L0"],
        output_template="{stem}.handy.funscript",
        default_knobs={"maxBpm": 120, "smoothing": 0.45, "latency": 60, "quantize": 1},
        constraint_hint="BPM ceiling · carriage acceleration",
    ),
    # OSR2 and SR6 share one station: we always write the full 6-axis TCode set
    # (L0 stroke + surge/sway/twist/roll/pitch). OSR2 owners play the 4 axes
    # their 2-servo build supports; SR6 owners play all 6. Same files, the
    # player picks. OSR2/SR6 limits are identical in device_specs (500 / 150).
    "tcode": Station(
        id="tcode",
        label="OSR2 / SR6",
        sublabel="TCode multi-axis",
        kind="stroker-tcode",
        device_keys=["sr6"],
        axes=["L0", "L1", "L2", "R0", "R1", "R2"],
        output_template="{stem}.funscript",  # L0; siblings derived from axes
        default_knobs={"maxBpm": 150, "smoothing": 0.40, "latency": 50, "quantize": 1},
        constraint_hint="Servo slew · full 6-axis TCode set",
    ),
    "lovense": Station(
        id="lovense",
        label="Lovense",
        sublabel="Bluetooth 1-axis",
        kind="stroker",
        device_keys=["generic"],  # conservative BT fallback: 100 BPM / 300 pos/s
        axes=["L0"],
        output_template="{stem}.lovense.funscript",
        default_knobs={"maxBpm": 100, "smoothing": 0.45, "latency": 80, "quantize": 1},
        constraint_hint="Bluetooth range · gentle slew",
    ),
    "vacuglide": Station(
        id="vacuglide",
        label="Vacuglide 2",
        sublabel="Autoblow cloud · 1-axis",
        kind="stroker",
        device_keys=["vacuglide"],
        axes=["L0"],
        output_template="{stem}.vacuglide.funscript",
        default_knobs={"maxBpm": 120, "smoothing": 0.40, "latency": 0, "quantize": 1},
        constraint_hint="Cloud stroker · uploads funscript",
    ),
}


def sibling_path(stem: str, axis: str) -> str:
    """Return the funscript filename for a TCode ``axis`` of ``stem``.

    ``L0`` -> ``<stem>.funscript``; others -> ``<stem>.<suffix>.funscript``.
    """
    suffix = TCODE_SUFFIX.get(axis, axis.lower())
    return f"{stem}.funscript" if not suffix else f"{stem}.{suffix}.funscript"


# ─── Engine — ported verbatim from polish-engine.js ───────────────────────────
# Operates on DENSE samples: lists of {"at": ms, "pos": 0..100}. The sparse
# funscript "actions" are derived by extrema-keeping (:func:`dense_to_actions`).

def lowpass(samples: list[dict], strength: float) -> list[dict]:
    """3-tap weighted low-pass on the position curve (Gaussian-ish)."""
    w = min(0.85, strength)
    out = []
    n = len(samples)
    for i in range(n):
        prev = samples[max(0, i - 1)]["pos"]
        nxt = samples[min(n - 1, i + 1)]["pos"]
        blend = samples[i]["pos"] * (1 - w) + ((prev + nxt) / 2) * w
        out.append({"at": samples[i]["at"], "pos": blend})
    return out


def slew_limit(samples: list[dict], rate_p100: float) -> list[dict]:
    """Cap position change to ``rate_p100`` fraction (0..1) per 100 ms."""
    if not samples:
        return []
    out = [{"at": samples[0]["at"], "pos": samples[0]["pos"]}]
    for i in range(1, len(samples)):
        dt = samples[i]["at"] - samples[i - 1]["at"]
        max_delta = rate_p100 * 100 * (dt / 100)  # pct
        prev = out[i - 1]["pos"]
        target = samples[i]["pos"]
        delta = target - prev
        if abs(delta) <= max_delta:
            limited = target
        else:
            limited = prev + math.copysign(max_delta, delta)
        out.append({"at": samples[i]["at"], "pos": limited})
    return out


def bpm_cap(samples: list[dict], max_bpm: float) -> list[dict]:
    """Smooth windows whose local cycling exceeds ``max_bpm`` (zero-crossings)."""
    if not samples:
        return []
    n = len(samples)
    mean = sum(x["pos"] for x in samples) / n
    window = 50  # ~500 ms at 100 Hz
    out = [{"at": s["at"], "pos": s["pos"]} for s in samples]
    for i in range(n):
        lo = max(0, i - window)
        hi = min(n - 1, i + window)
        crossings = 0
        for k in range(lo + 1, hi + 1):
            if (samples[k - 1]["pos"] - mean) * (samples[k]["pos"] - mean) < 0:
                crossings += 1
        local_ms = (samples[hi]["at"] - samples[lo]["at"]) or 1
        local_bpm = (crossings / 2) * (60000 / local_ms)
        if local_bpm > max_bpm:
            ratio = min(0.7, (local_bpm / max_bpm - 1))
            prev = out[max(0, i - 1)]["pos"]
            nxt = out[min(n - 1, i + 1)]["pos"]
            out[i]["pos"] = out[i]["pos"] * (1 - ratio) + ((prev + nxt) / 2) * ratio
    return out


def subsample(samples: list[dict], period_ms: float) -> list[dict]:
    """Hold-last resample to ``period_ms`` then re-densify to original timing."""
    if period_ms <= 10 or not samples:
        return samples
    out = []
    next_at = samples[0]["at"]
    for s in samples:
        if s["at"] >= next_at:
            out.append({"at": s["at"], "pos": s["pos"]})
            next_at = s["at"] + period_ms
    dense = []
    held = out[0]["pos"] if out else 0
    idx = 0
    for s in samples:
        while idx < len(out) - 1 and out[idx + 1]["at"] <= s["at"]:
            idx += 1
            held = out[idx]["pos"]
        dense.append({"at": s["at"], "pos": held})
    return dense


def first_order_lag(samples: list[dict], tau_ms: float) -> list[dict]:
    """Mechanical lag — first-order low-pass with time constant ``tau_ms``.

    PREVIEW ONLY. Models what the hardware *does* (vs. what it's commanded);
    never written to the output file.
    """
    if not samples:
        return []
    out = [{"at": samples[0]["at"], "pos": samples[0]["pos"]}]
    for i in range(1, len(samples)):
        dt = samples[i]["at"] - samples[i - 1]["at"]
        alpha = 1 - math.exp(-dt / max(1, tau_ms))
        prev = out[i - 1]["pos"]
        out.append({"at": samples[i]["at"], "pos": prev + alpha * (samples[i]["pos"] - prev)})
    return out


def shift_time(samples: list[dict], delta_ms: float) -> list[dict]:
    """Shift every sample in time (latency / lead-time compensation). Preview."""
    return [{"at": s["at"] + delta_ms, "pos": s["pos"]} for s in samples]


def lag_for_device(station_id: str) -> float:
    """Mechanical lag time-constant (ms) per station. Preview only."""
    return {
        "handy": 22,     # electric motor — fast
        "tcode": 18,     # direct servo (OSR2 / SR6)
        "lovense": 35,   # Bluetooth — higher command latency
        "vacuglide": 28, # Autoblow stroker — cloud-synced
        "estim3p": 6,    # near-instant
    }.get(station_id, 30)


# ─── Dense <-> sparse ─────────────────────────────────────────────────────────

def actions_to_dense(actions: list[dict], sr_ms: int = 10) -> list[dict]:
    """Linear-interpolate sparse actions to a dense ``sr_ms`` grid."""
    if not actions:
        return []
    if len(actions) == 1:
        return [{"at": actions[0]["at"], "pos": float(actions[0]["pos"])}]
    out = []
    j = 0
    t0, t1 = actions[0]["at"], actions[-1]["at"]
    t = t0
    while t <= t1:
        while j < len(actions) - 2 and actions[j + 1]["at"] <= t:
            j += 1
        a, b = actions[j], actions[j + 1]
        span = b["at"] - a["at"]
        frac = 0.0 if span <= 0 else (t - a["at"]) / span
        frac = max(0.0, min(1.0, frac))
        out.append({"at": t, "pos": a["pos"] + (b["pos"] - a["pos"]) * frac})
        t += sr_ms
    return out


def dense_to_actions(samples: list[dict]) -> list[dict]:
    """Sparsify dense samples to local extrema (rounded int positions)."""
    if not samples:
        return []
    if len(samples) <= 2:
        return [{"at": _round_half_up(s["at"]), "pos": _round_half_up(s["pos"])} for s in samples]
    out = [{"at": _round_half_up(samples[0]["at"]), "pos": _round_half_up(samples[0]["pos"])}]
    for i in range(1, len(samples) - 1):
        a, b, c = samples[i - 1]["pos"], samples[i]["pos"], samples[i + 1]["pos"]
        if (b > a and b >= c) or (b < a and b <= c):
            out.append({"at": _round_half_up(samples[i]["at"]), "pos": _round_half_up(b)})
    out.append({"at": _round_half_up(samples[-1]["at"]), "pos": _round_half_up(samples[-1]["pos"])})
    return out


# ─── The pass ─────────────────────────────────────────────────────────────────

def _engine_clamp(samples: list[dict], kind: str, knobs: dict) -> list[dict]:
    """Run the tunable polish chain on dense samples (matches the JS engine)."""
    clamped = [{"at": s["at"], "pos": s["pos"]} for s in samples]

    smoothing = knobs.get("smoothing")
    if smoothing is not None and smoothing > 0:
        clamped = lowpass(clamped, smoothing)

    if knobs.get("slewRate") is not None:
        clamped = slew_limit(clamped, knobs["slewRate"])
    if knobs.get("rateLimit") is not None:
        clamped = slew_limit(clamped, knobs["rateLimit"])

    if knobs.get("maxBpm") is not None:
        clamped = bpm_cap(clamped, knobs["maxBpm"])

    quiet = knobs.get("quietFloor")
    if quiet is not None and quiet > 0:
        floor = quiet * 100
        clamped = [{"at": s["at"], "pos": max(s["pos"], floor)} for s in clamped]

    quant = knobs.get("quantize")
    if quant is not None and kind in ("stroker", "stroker-tcode") and quant > 0:
        clamped = [{"at": s["at"], "pos": _round_half_up(s["pos"] / quant) * quant} for s in clamped]

    return clamped


def compute_stats(src: list[dict], clamped: list[dict], station_id: str) -> dict:
    """Lightweight before/after stats for the workbench readout."""
    def rms(arr):
        return math.sqrt(sum(x["pos"] ** 2 for x in arr) / len(arr)) if arr else 0.0

    def peak_delta(a, b):
        n = min(len(a), len(b))
        return max((abs(a[i]["pos"] - b[i]["pos"]) for i in range(n)), default=0.0)

    src_bpm = _bpm_list(src)
    clamp_bpm = _bpm_list(clamped)
    return {
        "srcMaxBpm": round(max(src_bpm, default=0)),
        "clampMaxBpm": round(max(clamp_bpm, default=0)),
        "srcRms": round(rms(src), 1),
        "clampRms": round(rms(clamped), 1),
        "peakDelta": round(peak_delta(src, clamped), 1),
        "mechLagMs": lag_for_device(station_id),
    }


def _bpm_list(samples: list[dict]) -> list[float]:
    if not samples:
        return []
    mean = sum(x["pos"] for x in samples) / len(samples)
    crossings = []
    for i in range(1, len(samples)):
        if (samples[i - 1]["pos"] - mean) * (samples[i]["pos"] - mean) < 0:
            crossings.append(samples[i]["at"])
    bpms = []
    for i in range(1, len(crossings)):
        dt = crossings[i] - crossings[i - 1]
        if dt > 0:
            bpms.append(60000 / (2 * dt))
    return bpms


def resolve_knobs(station_id: str, overrides: dict | None = None) -> dict:
    """Merge user ``overrides`` onto a station's default knob values."""
    knobs = dict(STATIONS[station_id].default_knobs)
    if overrides:
        knobs.update({k: v for k, v in overrides.items() if v is not None})
    return knobs


def apply_pass(
    actions: list[dict],
    station_id: str,
    knobs: dict | None = None,
) -> tuple[list[dict], dict]:
    """Clamp ``actions`` for ``station_id`` and return ``(clamped, stats)``.

    Pipeline: tunable polish chain (smoothing/slew/bpm/floor/quantize, matching
    the JS preview) on a dense grid, re-sparsified, then the authoritative
    :func:`forge.device_specs.apply_minimum_fix` safety backstop on the sparse
    result. The ``maxBpm`` knob, when present, tightens the device's BPM limit.
    """
    if station_id not in STATIONS:
        raise ValueError(f"unknown polish station: {station_id!r}")
    station = STATIONS[station_id]
    knobs = resolve_knobs(station_id, knobs)

    if len(actions) < 2:
        return [dict(a) for a in actions], {"engine": {}, "backstop": {}}

    samples = actions_to_dense(actions)
    clamped_dense = _engine_clamp(samples, station.kind, knobs)
    clamped = dense_to_actions(clamped_dense)
    stats = compute_stats(samples, clamped_dense, station_id)

    # Authoritative safety backstop from the tested device_specs engine.
    spec = combined_limits(station.device_keys)
    backstop: dict = {}
    if spec is not None:
        if knobs.get("maxBpm") is not None:
            spec.max_bpm = min(spec.max_bpm, knobs["maxBpm"])
        clamped, backstop = apply_minimum_fix(clamped, spec)

    return clamped, {"engine": stats, "backstop": backstop}


def preview_pass(
    actions: list[dict],
    station_id: str,
    knobs: dict | None = None,
) -> dict:
    """Return dense traces for the 3-pane preview (character/clamped/performed).

    The ``performed`` trace adds mechanical lag + latency shift — illustration
    only; :func:`apply_pass` is what writes the file.
    """
    station = STATIONS[station_id]
    knobs = resolve_knobs(station_id, knobs)
    samples = actions_to_dense(actions)
    clamped = _engine_clamp(samples, station.kind, knobs) if len(samples) >= 2 else samples

    performed = first_order_lag(clamped, lag_for_device(station_id)) if clamped else []
    latency = knobs.get("latency")
    if latency:
        performed = shift_time(performed, -latency)

    return {
        "character": samples,
        "clamped": clamped,
        "performed": performed,
        "stats": compute_stats(samples, clamped, station_id) if len(samples) >= 2 else {},
    }
