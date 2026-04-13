# Extracted from restim by diglet48.
# Original source: https://github.com/diglet48/restim
# License: MIT (see LICENSE in this directory)
# Original file: stim_math/pulse.py

import numpy as np


def create_pulse_with_ramp_time(
    n_samples: int, carrier_cycles: float, rise_time: float
) -> np.ndarray:
    """Create a pulse envelope with cosine-ramped rise/fall edges.

    Args:
        n_samples: Total samples in the pulse.
        carrier_cycles: Total carrier cycles in the pulse width.
        rise_time: Rise/fall time in carrier cycles.

    Returns:
        Envelope array in [0, 1].
    """
    a = 1 / carrier_cycles * rise_time
    b = 1 - a
    if a >= b:
        # Rise time >= half the pulse — use half-circle envelope
        return np.sin(np.linspace(0, np.pi, n_samples))
    theta = np.interp(
        np.linspace(0, 1, n_samples), [0, a, b, 1], [0, np.pi / 2, np.pi / 2, np.pi]
    )
    return np.sin(theta)
