# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Opus 4.6).

"""multiaxis_presets.py — Position style presets for multi-axis generation.

Each preset maps secondary axes (roll, pitch, twist, surge, sway) to
algorithm configs. The algorithm configs are passed to the functions in
forge.multiaxis.

Presets are designed to be self-explanatory: the name tells the user
what physical position the motion simulates, and the axis configs
implement the physics of that position.
"""

from __future__ import annotations


MULTIAXIS_PRESETS: dict[str, dict] = {
    "Cowgirl": {
        "_description": "Rocking motion — pitch follows stroke, gentle roll sway.",
        "roll": {
            "algorithm": "sine",
            "amplitude": 0.3,
            "freq_hz": 0.5,
            "modulate_by": "stroke_velocity",
            "mod_strength": 0.4,
        },
        "pitch": {
            "algorithm": "correlate_stroke",
            "correlation": 0.7,
            "amplitude": 0.6,
        },
        "twist": {
            "algorithm": "random_walk",
            "amplitude": 0.15,
            "smoothing": 0.8,
        },
    },
    "Missionary": {
        "_description": "Side-to-side emphasis — roll is dominant, driven by stroke speed.",
        "roll": {
            "algorithm": "correlate_stroke_velocity",
            "amplitude": 0.7,
            "smoothing": 0.6,
        },
        "pitch": {
            "algorithm": "sine",
            "amplitude": 0.2,
            "freq_hz": 0.3,
        },
    },
    "Doggy": {
        "_description": "Forward-thrust emphasis — pitch dominant with forward bias.",
        "pitch": {
            "algorithm": "correlate_stroke",
            "correlation": 0.8,
            "amplitude": 0.8,
            "bias": 0.3,
        },
    },
    "Riding": {
        "_description": "Full circular motion — all axes active, wide amplitude.",
        "roll": {
            "algorithm": "sine",
            "amplitude": 0.6,
            "freq_hz": 0.4,
            "modulate_by": "stroke_velocity",
            "mod_strength": 0.5,
        },
        "pitch": {
            "algorithm": "correlate_stroke",
            "correlation": -0.5,
            "amplitude": 0.6,
        },
        "twist": {
            "algorithm": "random_walk",
            "amplitude": 0.4,
            "smoothing": 0.7,
        },
        "surge": {
            "algorithm": "sine",
            "amplitude": 0.3,
            "freq_hz": 0.2,
        },
        "sway": {
            "algorithm": "sine",
            "amplitude": 0.3,
            "freq_hz": 0.15,
            "phase_offset": 1.5708,  # π/2
        },
    },
    "Random": {
        "_description": "All axes get independent random walks. Surprise me.",
        "roll": {
            "algorithm": "random_walk",
            "amplitude": 0.5,
            "modulate_by": "stroke_velocity",
            "mod_strength": 0.5,
            "smoothing": 0.6,
        },
        "pitch": {
            "algorithm": "random_walk",
            "amplitude": 0.5,
            "modulate_by": "stroke_velocity",
            "mod_strength": 0.5,
            "smoothing": 0.6,
        },
        "twist": {
            "algorithm": "random_walk",
            "amplitude": 0.3,
            "smoothing": 0.7,
        },
        "surge": {
            "algorithm": "random_walk",
            "amplitude": 0.2,
            "smoothing": 0.8,
        },
        "sway": {
            "algorithm": "random_walk",
            "amplitude": 0.2,
            "smoothing": 0.8,
        },
    },
}

# Style names in display order
STYLE_NAMES = ["None", "Cowgirl", "Missionary", "Doggy", "Riding", "Random"]

# Axis → file suffix mapping (T-Code convention)
AXIS_SUFFIXES = {
    "roll":  "roll",
    "pitch": "pitch",
    "twist": "twist",
    "surge": "surge",
    "sway":  "sway",
}
