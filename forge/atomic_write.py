"""Atomic publish for files that must never be seen half-written.

★ MIRROR of ``videoflow/src/videoflow/atomic_write.py``. Keep the two in step
— this repo already treats that kind of duplication as load-bearing (see the
Rust/Python mirrors elsewhere). It is copied rather than imported because
``cli.py`` imports videoflow LAZILY, inside the functions that need it, so
several commands run without videoflow present at all. A module-level import
here would quietly make it mandatory.

Why this exists: ``open(path, "w")`` and ``Path.write_text`` truncate the
destination before writing a byte. Anything reading it in that window sees an
empty or partial file. Two consequences, and the second is the serious one:

  * A concurrent reader gets garbage. Observed 2026-09-26 as
    "EOF while parsing a value at line 1 column 0" from a sidecar that was
    perfectly valid seconds later.
  * ★ A KILLED process leaves the destination permanently broken. For a cache
    that is an annoyance. For a FUNSCRIPT it is data loss: the user's edits
    are gone and there is nothing to recover from, because the old contents
    were destroyed before the new ones existed.

So funscripts are published, not written: build the new file beside the
destination, then ``os.replace`` it in. A reader — or a crash — sees either
the whole old file or the whole new one.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

# Windows refuses to replace a destination another handle has open. Readers
# hold these files for milliseconds, so this is generous.
_REPLACE_TIMEOUT_S = 2.0


def _replace_with_retry(tmp: str, dest: Path, timeout_s: float) -> None:
    """``os.replace`` with a bounded retry, for Windows.

    POSIX replaces a file happily while others have it open. Windows fails
    with ``PermissionError`` (WinError 5) when the DESTINATION is open without
    FILE_SHARE_DELETE — which is how Python's ``open()`` opens it for reading.
    Since the app reads these files while the CLI writes them, on the platform
    this ships on the contended case is the normal one.

    If it still cannot replace, RAISE. The destination keeps its previous,
    complete contents; falling back to a truncating write would resurrect the
    exact bug this module prevents, and do it silently.
    """
    delay = 0.005
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            os.replace(tmp, dest)
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.1)


def write_text_atomic(
    path: str | Path,
    text: str,
    *,
    encoding: str = "utf-8",
    replace_timeout_s: float = _REPLACE_TIMEOUT_S,
) -> Path:
    """Write *text* to *path* so no reader, and no crash, sees a partial file."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # A sibling of the destination: `os.replace` is only atomic within one
    # filesystem. The leading dot keeps the temp out of casual listings.
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=f".{p.name}.", suffix=".part")
    try:
        # Newline translation left at the platform default, so the bytes match
        # what `open(p, "w")` / `Path.write_text` produced before.
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(text)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass  # best effort; the replace is still atomic
        _replace_with_retry(tmp, p, replace_timeout_s)
    except BaseException:
        # KeyboardInterrupt / SystemExit included on purpose: a cancelled run
        # must not leave `.part` litter beside the real file.
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return p


def write_json_atomic(
    path: str | Path,
    obj: Any,
    *,
    replace_timeout_s: float = _REPLACE_TIMEOUT_S,
    **dumps_kwargs: Any,
) -> Path:
    """``json.dumps`` *obj* and publish it atomically. ``dumps_kwargs`` pass
    straight through, so callers keep control of ``indent``/``separators``."""
    return write_text_atomic(
        path, json.dumps(obj, **dumps_kwargs), replace_timeout_s=replace_timeout_s,
    )
