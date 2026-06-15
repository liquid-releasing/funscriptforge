"""Passages — span-relative intensity envelopes layered over the chapter run.

A *passage* covers a contiguous run of chapters and emits a multiplier in
``[floor, ceiling]`` that scales the intensity of whatever modality consumes it:
the e-stim **volume** channels and the multi-axis (mechanical) amplitude. The
envelope is **span-relative and length-independent** — a Build travels the full
floor->ceiling across the *passage*, not per chapter — so a slow scene-scale
contour survives even when chapters are only 3-5 min each (the per-chapter ramp
is imperceptible: Edger's volume ramp is 15%/hour ≈ 1% over a 4-min chapter,
which is exactly the gap passages fill).

Per-chapter assignment (Channels: Character/Mechanical) answers *what*; a passage
answers *how much*. They compose: the passage multiplier rides on top of the
generated channels just before device clamping. See the
``project_passage_arcs_cross_modality`` / ``project_funscriptforge_post_beta``
memory for the design.
"""

from __future__ import annotations

# The five envelope shapes. Each maps a fractional position ``frac`` in [0, 1]
# across the passage span to a multiplier in [floor, ceiling]. Steady is the
# identity (1.0 everywhere) so an unassigned/default passage is a no-op.
PASSAGE_SHAPES = ("steady", "build", "sustain", "release", "swell")

# e-stim channels that carry *intensity* (scale these); phase/position channels
# (alpha/beta/frequency/...) pass through untouched. Mirrors
# ``stim_config._VOLUME_CHANNELS``.
ESTIM_INTENSITY_CHANNELS = ("volume", "volume-prostate")

# Neutral position for a multi-axis (rotary/linear) channel — amplitude is the
# deviation from this. Scaling toward it reduces motion without shifting center.
AXIS_CENTER = 50


# The arc is ONE parametric envelope: rise from ``floor`` to ``ceiling``,
# finishing at ``rise_point``; hold at ``ceiling`` until ``fall_point``; ease
# back to ``floor`` by the end. The five named shapes are just presets of it
# (so old ``<stem>.passages.json`` records without rise/fall keep working):
#   build   rise=1.0 fall=1.0  (climbs the whole span, never falls)
#   release rise=0.0 fall=0.0  (starts at the peak, eases the whole span)
#   sustain rise=0.0 fall=1.0  (instantly at the peak, holds)
#   swell   rise=0.5 fall=0.5  (a single rounded hump in the middle)
#   steady  identity (1.0) — the no-op default
SHAPE_POINTS = {
    "steady":  (0.0, 1.0),
    "build":   (1.0, 1.0),
    "sustain": (0.0, 1.0),
    "release": (0.0, 0.0),
    "swell":   (0.5, 0.5),
}


def _smoothstep(t: float) -> float:
    """Cubic ease 3t²-2t³ — rounded shoulders, no hard corners. Clamped 0..1."""
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t * t * (3.0 - 2.0 * t)


def envelope_factor(frac: float, floor: float, ceiling: float,
                    rise_point: float, fall_point: float) -> float:
    """Eased multiplier at fractional position ``frac`` (0..1) along the span.

    Rise ``floor``->``ceiling`` over [0, rise_point], hold at ``ceiling`` over
    [rise_point, fall_point], ease back to ``floor`` over [fall_point, 1].
    Both transitions use a smoothstep so the baked arc is gently curved, not a
    straight ramp / pointy triangle.
    """
    f = 0.0 if frac < 0.0 else (1.0 if frac > 1.0 else frac)
    lo = float(floor)
    hi = float(ceiling)
    rp = 0.0 if rise_point < 0.0 else (1.0 if rise_point > 1.0 else rise_point)
    fp = 0.0 if fall_point < 0.0 else (1.0 if fall_point > 1.0 else fall_point)
    if fp < rp:
        fp = rp
    if f <= rp:
        return hi if rp <= 0.0 else lo + (hi - lo) * _smoothstep(f / rp)
    if f <= fp:
        return hi
    if fp >= 1.0:
        return hi
    return hi - (hi - lo) * _smoothstep((f - fp) / (1.0 - fp))


def shape_factor(shape: str, frac: float, floor: float, ceiling: float,
                 rise_point=None, fall_point=None) -> float:
    """Multiplier at ``frac`` for a passage. Explicit ``rise_point``/
    ``fall_point`` win; otherwise they derive from the named ``shape`` (so the
    five shapes are presets of the one eased envelope). ``steady`` is the
    identity (1.0), the no-op default."""
    s = (shape or "steady").lower()
    if s == "steady" and rise_point is None and fall_point is None:
        return 1.0
    rp_def, fp_def = SHAPE_POINTS.get(s, (1.0, 1.0))
    rp = rp_def if rise_point is None else float(rise_point)
    fp = fp_def if fall_point is None else float(fall_point)
    return envelope_factor(frac, floor, ceiling, rp, fp)


def factor_at(passages, t: int) -> float:
    """Combined passage multiplier at absolute time ``t`` (ms).

    Passages are treated as non-overlapping spans; the first one containing
    ``t`` wins. No covering passage -> 1.0 (untouched).
    """
    for p in passages or ():
        lo = p["lo"]
        hi = p["hi"]
        if lo is None or hi is None or hi <= lo:
            continue
        if lo <= t <= hi:
            frac = (t - lo) / max(1, hi - lo)
            return shape_factor(p.get("shape"), frac,
                                p.get("floor", 0.2), p.get("ceiling", 1.0),
                                p.get("rise_point"), p.get("fall_point"))
    return 1.0


def scale_estim(channel_name: str, actions: list[dict], passages) -> list[dict]:
    """Scale an e-stim channel's actions by the passage envelope.

    Only *intensity* (volume) channels are scaled — toward 0 (off). Phase and
    position channels pass through unchanged. No passages -> unchanged.
    """
    if not passages or channel_name not in ESTIM_INTENSITY_CHANNELS:
        return actions
    out = []
    for a in actions:
        factor = factor_at(passages, a["at"])
        out.append({"at": a["at"], "pos": int(round(a["pos"] * factor))})
    return out


def scale_axis(actions: list[dict], passages, center: int = AXIS_CENTER) -> list[dict]:
    """Scale a multi-axis (mechanical) channel's amplitude toward ``center``.

    Reduces motion amplitude by the passage envelope without shifting the
    neutral position (so a Release winds the geometry down to stillness, not
    to an off-center pose). No passages -> unchanged.
    """
    if not passages:
        return actions
    out = []
    for a in actions:
        factor = factor_at(passages, a["at"])
        pos = center + (a["pos"] - center) * factor
        out.append({"at": a["at"], "pos": int(round(pos))})
    return out


def resolve_passages(passage_records, chapters) -> list[dict]:
    """Map authored passage records to absolute-time spans for generation.

    ``passage_records`` is the list from ``<stem>.passages.json``; each carries
    a ``shape``, ``floor``/``ceiling`` (0..1) and a chapter span as 0-based
    ``beginIdx``/``endIdx`` (inclusive). ``chapters`` is the chapters-sidecar
    list (each with ``at_ms``/``end_ms``). Returns
    ``[{lo, hi, shape, floor, ceiling}]`` with ``steady`` / degenerate spans
    dropped (they are no-ops).
    """
    out = []
    n = len(chapters)
    if n == 0:
        return out
    for rec in passage_records or ():
        shape = (rec.get("shape") or "steady").lower()
        if shape == "steady":
            continue
        bi = rec.get("beginIdx", 0)
        ei = rec.get("endIdx", n - 1)
        try:
            bi = max(0, min(int(bi), n - 1))
            ei = max(0, min(int(ei), n - 1))
        except (TypeError, ValueError):
            continue
        if ei < bi:
            bi, ei = ei, bi
        begin = chapters[bi]
        end = chapters[ei]
        lo = begin.get("at_ms", begin.get("atMs", begin.get("start_ms")))
        hi = end.get("end_ms", end.get("endMs"))
        if lo is None or hi is None or hi <= lo:
            continue
        span = {
            "lo": int(lo),
            "hi": int(hi),
            "shape": shape,
            "floor": float(rec.get("floor", 0.2)),
            "ceiling": float(rec.get("ceiling", 1.0)),
        }
        # Optional explicit rise/fall handles (the parametric model); absent =
        # derive from the named shape inside shape_factor.
        if rec.get("risePoint") is not None:
            span["rise_point"] = float(rec["risePoint"])
        if rec.get("fallPoint") is not None:
            span["fall_point"] = float(rec["fallPoint"])
        out.append(span)
    return out
