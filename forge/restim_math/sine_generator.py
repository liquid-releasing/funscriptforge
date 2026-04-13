# Extracted from restim by diglet48.
# Original source: https://github.com/diglet48/restim
# License: MIT (see LICENSE in this directory)
# Original file: stim_math/sine_generator.py

import numpy as np


class AngleGenerator:
    """Accumulates carrier phase across chunks to maintain continuity."""

    def __init__(self):
        self.theta = 0.0

    def generate(self, n: int, frequency: float, samplerate: float) -> np.ndarray:
        begin = self.theta
        end = self.theta + 2 * np.pi * frequency * (n / samplerate)
        self.theta = end
        return np.linspace(begin, end, n, endpoint=False)
