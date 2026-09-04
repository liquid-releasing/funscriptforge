"""FOC-Stim four-phase — position to per-electrode intensity.

Four-phase FOC-Stim does not take a 2-D position the way three-phase does. It
takes four independent electrode powers, ``e1``..``e4``, each 0..1
(``device/focstim/fourphase_algorithm.py`` returns ``AXIS_ELECTRODE_1..4_POWER``;
``qt_ui/models/funscript_kit.py`` binds them to the ``.e1``..``.e4`` funscript
suffixes with ``limit_min=0, limit_max=1``).

The transform from a position to those four intensities is NOT invented here —
restim already defines it, and using its own math is what keeps a file we write
consistent with what the device expects. ``abc_to_e1234`` below is ported from
restim ``stim_math/transforms_4.py``.

    restim — Copyright (c) 2023 diglet48 — MIT License.
    https://github.com/diglet48/restim

Two properties of that transform are worth knowing before reading output:

  * It is **magnitude-only**. The final ``abs()`` means opposite positions map
    to identical intensities: alpha=+1 and alpha=-1 both give
    ``(1, 0, 0, 0)``. Electrode power is unsigned, so this is correct for the
    wire format, but it means the e-channels do not distinguish a position
    from its mirror.
  * It **normalises so one component is zero** — there is always an electrode
    at rest. That is inherent to the four-phase drive, not a choice made here.

Our pipeline authors ``alpha``/``beta`` as funscript positions 0..100, while
restim's alpha/beta axes are -1..1. :func:`electrodes_from_alpha_beta` handles
that rescale, so callers stay in funscript units at both ends.
"""

from __future__ import annotations

import numpy as np

# ── Ported from restim stim_math/transforms_4.py (MIT, © 2023 diglet48) ──────
# Kept verbatim in structure so a future upstream change is a readable diff
# rather than an archaeology exercise.
_COEF_1 = 1.0
_COEF_2 = np.sqrt(8) / 3          # sqrt(1 - coef_1**2/3)
_COEF_3 = np.sqrt(2) / np.sqrt(3)  # sqrt(1 - coef_1**2/3 - coef_2**2/2)

_AB_TRANSFORM = np.array([
    [_COEF_1, 0, 0, 1],
    [-_COEF_1 / 3, _COEF_2, 0, 1],
    [-_COEF_1 / 3, -_COEF_2 / 2, _COEF_3, 1],
    [-_COEF_1 / 3, -_COEF_2 / 2, -_COEF_3, 1],
])


def abc_to_e1234(a, b, c):
    """Position ``(a, b, c)`` -> four electrode intensities, each 0..1.

    ``a``/``b``/``c`` are restim's alpha/beta/gamma position axes (-1..1).
    Accepts scalars or arrays; returns a ``(4, N)`` array.
    """
    a = np.atleast_1d(np.asarray(a, dtype=float))
    b = np.atleast_1d(np.asarray(b, dtype=float))
    c = np.atleast_1d(np.asarray(c, dtype=float))

    e = _AB_TRANSFORM[:, :3] @ np.vstack([a, b, c])

    # Normalise so the smallest component sits at zero — one electrode always
    # at rest.
    min_index = np.argmin(np.abs(e), axis=0)
    e = e - e[min_index, np.arange(e.shape[1])]
    e = e / (4.0 / 3)
    return np.abs(e)


# ── FunscriptForge side ──────────────────────────────────────────────────────

def electrodes_from_alpha_beta(alpha_pos, beta_pos, gamma_pos=None):
    """Funscript alpha/beta positions (0..100) -> four e-channels (0..100).

    ``gamma_pos`` is optional and defaults to the mid-point (50 -> 0.0), i.e. a
    position in the plane the three-phase authoring already works in. We do not
    synthesise a gamma curve: nothing upstream authors one, and inventing depth
    here would change where sensation sits rather than translating it.

    Returns four lists of ints, clamped to 0..100.
    """
    alpha = _to_axis(alpha_pos)
    beta = _to_axis(beta_pos)
    gamma = np.zeros_like(alpha) if gamma_pos is None else _to_axis(gamma_pos)

    # Normalise into the unit ball first, exactly as restim does before it
    # transforms a position (ThreePhasePosition.transform_position: it divides
    # by the norm clipped at 1). Without this the corners of the alpha/beta
    # square — e.g. both axes at full travel, norm 1.414 — push the transform
    # past 1.0 (measured 1.303), and the clamp below would flatten the peak
    # into silent full-scale instead of scaling the position.
    norm = np.clip(np.sqrt(alpha ** 2 + beta ** 2 + gamma ** 2), 1.0, None)
    alpha = alpha / norm
    beta = beta / norm
    gamma = gamma / norm

    e = abc_to_e1234(alpha, beta, gamma)
    # e is 0..1 by construction; scale to funscript units and clamp defensively
    # so a numerical edge can never emit an out-of-range position.
    scaled = np.clip(np.rint(e * 100.0), 0, 100).astype(int)
    return [scaled[i].tolist() for i in range(4)]


def _to_axis(positions) -> np.ndarray:
    """Funscript 0..100 -> restim axis -1..1 (50 is the neutral centre)."""
    arr = np.asarray(list(positions), dtype=float)
    return np.clip(arr / 100.0, 0.0, 1.0) * 2.0 - 1.0


# Channel suffixes, in the order restim's funscript kit lists them.
ELECTRODE_CHANNELS = ("e1", "e2", "e3", "e4")

# Position channels that have no destination in four-phase: the device takes
# electrode powers, so alpha/beta are consumed by the transform, and the
# prostate position pair has no second electrode set to drive.
POSITION_CHANNELS = ("alpha", "beta", "alpha-prostate", "beta-prostate")


def _sample(actions, times):
    """Linear-interpolate funscript ``actions`` at ``times`` (ms)."""
    if not actions:
        return np.full(len(times), 50.0)  # neutral centre
    xs = np.array([a["at"] for a in actions], dtype=float)
    ys = np.array([a["pos"] for a in actions], dtype=float)
    return np.interp(np.asarray(times, dtype=float), xs, ys)


def channels_from_alpha_beta(alpha_actions, beta_actions) -> dict:
    """``alpha``/``beta`` action lists -> ``{"e1": [...], ..., "e4": [...]}``.

    alpha and beta are separate funscripts and are not guaranteed to share a
    timeline, so both are sampled onto the union of their timestamps rather
    than zipped positionally — zipping two differently-timed channels would
    silently shear the position.
    """
    times = sorted({a["at"] for a in (alpha_actions or [])}
                   | {a["at"] for a in (beta_actions or [])})
    if not times:
        return {ch: [] for ch in ELECTRODE_CHANNELS}

    alpha = _sample(alpha_actions, times)
    beta = _sample(beta_actions, times)
    e = electrodes_from_alpha_beta(alpha, beta)
    return {
        ch: [{"at": int(t), "pos": int(p)} for t, p in zip(times, vals)]
        for ch, vals in zip(ELECTRODE_CHANNELS, e)
    }
