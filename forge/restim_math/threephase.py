# Extracted from restim by diglet48.
# Original source: https://github.com/diglet48/restim
# License: MIT (see LICENSE in this directory)
# Original file: stim_math/threephase.py
#
# See https://github.com/diglet48/restim/wiki/technical-documentation
#
# The 3-phase signal is computed as:
#   [L, R, 0]^T = P @ ab_transform @ squeeze @ carrier
#
# Where:
#   P           = electrode-to-channel projection
#   ab_transform = Clarke (alpha-beta) transform
#   squeeze     = position-dependent modulation matrix
#   carrier     = [cos(theta), sin(theta)]

import numpy as np

from forge.restim_math.transforms import (
    potential_to_channel_matrix,
    ab_transform,
)


class ThreePhaseSignalGenerator:
    """Generate stereo (L, R) audio from carrier phase and alpha/beta position."""

    @staticmethod
    def project_on_ab_coefs(
        alpha: np.ndarray, beta: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Compute the squeeze matrix coefficients from position."""
        alpha = alpha.astype(np.float32)
        beta = beta.astype(np.float32)

        r = np.sqrt(alpha**2 + beta**2)
        # Clamp to unit circle
        mask = r > 1
        alpha[mask] /= r[mask]
        beta[mask] /= r[mask]
        r[mask] = 1

        t11 = (2 - r + alpha) / 2
        t12 = -beta / 2
        t21 = t12
        t22 = (2 - r - alpha) / 2
        return t11, t12, t21, t22

    @staticmethod
    def carrier(theta: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Generate quadrature carrier components."""
        return np.cos(theta).astype(np.float32), np.sin(theta).astype(np.float32)

    @staticmethod
    def generate(
        theta: np.ndarray,
        alpha: np.ndarray,
        beta: np.ndarray,
        chunksize: int = 10000,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Generate stereo (L, R) samples from carrier phase and position.

        Args:
            theta: Carrier phase angles (radians), one per sample.
            alpha: X position in stimulation field, one per sample.
            beta: Y position in stimulation field, one per sample.
            chunksize: Process in chunks for cache/memory efficiency.

        Returns:
            (L, R) tuple of float32 arrays.
        """
        # Process in chunks for better cache performance
        if len(theta) > (2 * chunksize):
            L = np.empty_like(theta, dtype=np.float32)
            R = np.empty_like(theta, dtype=np.float32)
            for start in np.arange(0, len(theta), chunksize):
                end = start + chunksize
                l, r = ThreePhaseSignalGenerator.generate(
                    theta[start:end], alpha[start:end], beta[start:end]
                )
                L[start:end] = l
                R[start:end] = r
            return L, R

        carrier_x, carrier_y = ThreePhaseSignalGenerator.carrier(theta)

        # Apply squeeze projection
        t11, t12, t21, t22 = ThreePhaseSignalGenerator.project_on_ab_coefs(
            alpha, beta
        )
        a = t11 * carrier_x + t12 * carrier_y
        b = t21 * carrier_x + t22 * carrier_y

        # Project to stereo channels
        T = (potential_to_channel_matrix @ ab_transform)[:2, :2] / np.sqrt(3)
        L, R = T @ np.array([a, b])
        return L.astype(np.float32), R.astype(np.float32)


class ThreePhaseCenterCalibration:
    """Reduce volume near the center of the phase diagram.

    Prevents uncomfortable sensation when alpha/beta are near (0, 0).
    """

    def __init__(self, db_in_center: float):
        self.db_in_center = db_in_center

    def get_scale(
        self, x: np.ndarray | float, y: np.ndarray | float
    ) -> np.ndarray | float:
        ratio = 10 ** (self.db_in_center / 10)
        norm = np.clip(np.linalg.norm((x, y), axis=0), None, 1)

        if ratio <= 1:
            edge = 1
            center = ratio
        else:
            edge = 1 / ratio
            center = 1

        return center + norm * (edge - center)
