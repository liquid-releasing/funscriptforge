# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""Tests for the new Export tab device layout (mechanical/ + estim/ subfolders).

Covers the pure helpers and the heatmap writer. _do_export_to_folders itself
is heavily Streamlit-coupled and is exercised manually during user testing.
"""

from __future__ import annotations

from pathlib import Path

import pytest


# ── _split_targets ────────────────────────────────────────────────────


def test_split_targets_empty():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, estim = _split_targets([])
    assert mech is False
    assert estim == []


def test_split_targets_mechanical_only():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, estim = _split_targets(["handy", "osr2", "generic"])
    assert mech is True
    assert estim == []


def test_split_targets_single_mechanical_still_counts():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, _ = _split_targets(["handy"])
    assert mech is True


def test_split_targets_estim_only():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, estim = _split_targets(["stereostim", "neostim"])
    assert mech is False
    assert estim == ["stereostim", "neostim"]


def test_split_targets_mixed():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, estim = _split_targets(["handy", "stereostim"])
    assert mech is True
    assert estim == ["stereostim"]


def test_split_targets_ignores_unknown_keys():
    from ui.streamlit.panels.export_panel import _split_targets
    mech, estim = _split_targets(["handy", "fake_device"])
    assert mech is True
    assert estim == []  # fake_device is not in ESTIM_KEYS


def test_split_targets_all_five_estim_devices():
    from ui.streamlit.panels.export_panel import _split_targets, ESTIM_KEYS
    mech, estim = _split_targets(list(ESTIM_KEYS))
    assert mech is False
    assert set(estim) == set(ESTIM_KEYS)


# ── Constants ─────────────────────────────────────────────────────────


def test_mechanical_keys_unchanged():
    """Mechanical group always expands to handy + osr2 + generic so the
    Device tab limits code (which keys off output_targets) keeps working."""
    from ui.streamlit.panels.export_panel import MECHANICAL_KEYS
    assert MECHANICAL_KEYS == ("handy", "osr2", "generic")


def test_estim_devices_has_five_options():
    from ui.streamlit.panels.export_panel import ESTIM_DEVICES
    keys = [k for k, _ in ESTIM_DEVICES]
    assert keys == ["legacy", "stereostim", "foc3phase", "foc4phase", "neostim"]


# ── Heatmap PNG writer ────────────────────────────────────────────────


def test_write_heatmap_png_produces_real_png(tmp_path: Path):
    from ui.streamlit.panels.export_panel import _write_heatmap_png

    actions = [
        {"at": i * 100, "pos": int((i * 7) % 100)} for i in range(200)
    ]
    dest = tmp_path / "test.heatmap.png"
    _write_heatmap_png(actions, str(dest))

    assert dest.exists(), "heatmap PNG was not written"
    data = dest.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "file is not a valid PNG"
    assert len(data) > 1000, "heatmap PNG is suspiciously small"


def test_write_heatmap_png_handles_empty_actions(tmp_path: Path):
    from ui.streamlit.panels.export_panel import _write_heatmap_png

    dest = tmp_path / "empty.heatmap.png"
    _write_heatmap_png([], str(dest))

    assert dest.exists()
    data = dest.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
