# Extracted from restim by diglet48.
# Original source: https://github.com/diglet48/restim
# License: MIT (see LICENSE in this directory)
# Original file: stim_math/transforms.py

import numpy as np

# Electrode-to-channel projection matrix.
# Maps 3-electrode potentials (N, L, R) to 2-channel stereo (L, R).
potential_to_channel_matrix = np.array([
    [1, -1, 0],
    [1, 0, -1],
    [1, 1, 1],
]).astype(np.float32)

potential_to_channel_matrix_inv = np.linalg.inv(
    potential_to_channel_matrix
).astype(np.float32)

# Clarke (alpha-beta) transform.
# Maps 2D position (alpha, beta) to 3-electrode potentials (N, L, R).
ab_transform = np.array([
    [1, 0, 1],
    [-0.5, np.sqrt(3) / 2, 1],
    [-0.5, -np.sqrt(3) / 2, 1],
]).astype(np.float32)

ab_transform_inv = np.linalg.inv(ab_transform).astype(np.float32)
