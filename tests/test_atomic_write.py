"""Funscripts must be published, not written in place.

A funscript is the user's work. ``open(path, "w")`` and ``Path.write_text``
truncate the destination before writing a byte, so a crash, a cancel, or a
window-close mid-write leaves the file EMPTY -- the old contents destroyed
before the new ones exist, with nothing to recover from.

Mirrors ``videoflow/tests/test_atomic_write.py``; keep the two in step.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

import pytest

from forge.atomic_write import write_json_atomic, write_text_atomic


class TestTheHelper:
    def test_writes_content_and_creates_parents(self, tmp_path: Path) -> None:
        p = tmp_path / "deep" / "x.funscript"
        write_json_atomic(p, {"actions": [{"at": 0, "pos": 50}]})
        assert json.loads(p.read_text())["actions"][0]["pos"] == 50

    def test_overwrites_an_existing_file(self, tmp_path: Path) -> None:
        p = tmp_path / "x.funscript"
        write_json_atomic(p, {"v": 1})
        write_json_atomic(p, {"v": 2})
        assert json.loads(p.read_text()) == {"v": 2}

    def test_leaves_no_part_files_behind(self, tmp_path: Path) -> None:
        write_json_atomic(tmp_path / "x.funscript", {"a": 1})
        assert [f.name for f in tmp_path.iterdir()] == ["x.funscript"]

    def test_dumps_kwargs_reach_json(self, tmp_path: Path) -> None:
        p = tmp_path / "x.funscript"
        write_json_atomic(p, {"a": [1, 2]}, indent=2)
        assert "\n" in p.read_text()
        write_json_atomic(p, {"a": [1, 2]})
        assert p.read_text() == '{"a": [1, 2]}'

    def test_write_text_atomic_round_trips_unicode(self, tmp_path: Path) -> None:
        p = tmp_path / "x.yml"
        write_text_atomic(p, "café ★")
        assert p.read_text(encoding="utf-8") == "café ★"


class TestTheDataLossItWasAddedToPrevent:
    def test_a_failed_write_leaves_the_USERS_file_intact(self, tmp_path: Path) -> None:
        # ★ The case `Path.write_text` cannot survive. It truncates first, so
        # a failure part-way leaves an empty funscript where the user's edits
        # were. Here the destination is untouched until the new content is
        # complete on disk.
        p = tmp_path / "scene.funscript"
        write_json_atomic(p, {"actions": [{"at": 0, "pos": 50}]})
        with pytest.raises(TypeError):
            write_json_atomic(p, {"actions": object()})
        assert json.loads(p.read_text())["actions"] == [{"at": 0, "pos": 50}]

    def test_a_failed_write_leaves_no_litter(self, tmp_path: Path) -> None:
        p = tmp_path / "scene.funscript"
        write_json_atomic(p, {"a": 1})
        with pytest.raises(TypeError):
            write_json_atomic(p, {"a": object()})
        assert [f.name for f in tmp_path.iterdir()] == ["scene.funscript"]

    def test_a_concurrent_reader_never_sees_an_empty_or_partial_file(
        self, tmp_path: Path
    ) -> None:
        p = tmp_path / "scene.funscript"
        big = {"actions": [{"at": i, "pos": i % 100} for i in range(20_000)]}
        write_json_atomic(p, big)

        bad: list[str] = []
        stop = threading.Event()

        def reader() -> None:
            while not stop.is_set():
                try:
                    raw = p.read_text()
                except (FileNotFoundError, PermissionError):
                    continue
                if raw == "":
                    bad.append("EMPTY")
                    continue
                try:
                    json.loads(raw)
                except json.JSONDecodeError:
                    bad.append("PARTIAL")

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        try:
            for i in range(25):
                big["v"] = i
                write_json_atomic(p, big)
        finally:
            stop.set()
            t.join(timeout=10)

        assert bad == [], f"reader saw {len(bad)} bad reads: {set(bad)}"


class TestWindowsReplaceRetry:
    """Windows refuses to replace a destination another handle has open; POSIX
    does not. CI runs on Linux, so without these the retry could rot unseen and
    fail only on the platform the app ships on."""

    nt_only = pytest.mark.skipif(os.name != "nt", reason="POSIX replaces open files")

    @nt_only
    def test_it_waits_for_a_reader_to_let_go(self, tmp_path: Path) -> None:
        p = tmp_path / "held.funscript"
        write_json_atomic(p, {"v": 1})
        release = threading.Event()

        def holder() -> None:
            with open(p, "r"):
                release.wait(timeout=5)

        t = threading.Thread(target=holder, daemon=True)
        t.start()
        threading.Event().wait(0.05)
        threading.Timer(0.3, release.set).start()

        write_json_atomic(p, {"v": 2}, replace_timeout_s=5.0)
        assert json.loads(p.read_text()) == {"v": 2}
        release.set()
        t.join(timeout=5)

    @nt_only
    def test_it_raises_rather_than_silently_truncating(self, tmp_path: Path) -> None:
        p = tmp_path / "held.funscript"
        write_json_atomic(p, {"v": 1})
        release = threading.Event()

        def holder() -> None:
            with open(p, "r"):
                release.wait(timeout=10)

        t = threading.Thread(target=holder, daemon=True)
        t.start()
        threading.Event().wait(0.05)

        with pytest.raises(PermissionError):
            write_json_atomic(p, {"v": 2}, replace_timeout_s=0.2)
        assert json.loads(p.read_text()) == {"v": 1}     # intact, not empty
        release.set()
        t.join(timeout=5)


def test_no_funscript_in_cli_is_still_written_non_atomically() -> None:
    """★ A regression guard, because the next funscript writer will be added
    by someone who has never read this file.

    ⚠ Known limit, measured rather than assumed: run against the pre-fix
    cli.py this catches 4 of the 9 sites -- the ones that name the path
    inline, like `(wdir / f"{stem}.ramp.funscript").write_text(...)`. It does
    NOT catch `output = _default_path(..., "_export.funscript")` followed by
    `open(output, "w")`, because the filename and the write are on different
    lines and `output` could be anything by then.

    It is kept anyway: the inline form is the common one, and a guard that
    catches the easy half beats no guard. Do not read a pass here as proof
    that every funscript write is atomic.
    """
    src = Path(__file__).resolve().parent.parent / "cli.py"
    text = src.read_text(encoding="utf-8")

    offenders = []
    for n, line in enumerate(text.split("\n"), 1):
        if ".funscript" not in line:
            continue
        if re.search(r'\.write_text\(', line):
            offenders.append((n, line.strip()))
        elif re.search(r'open\([^)]*\.funscript[^)]*,\s*["\']w', line):
            offenders.append((n, line.strip()))

    assert not offenders, "non-atomic funscript writes:\n" + "\n".join(
        f"  cli.py:{n}: {l}" for n, l in offenders
    )
