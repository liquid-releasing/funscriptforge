#!/usr/bin/env python3
"""Set the app version everywhere it is written down.

Before this existed the version lived in four hand-edited places and a
release cut had to remember all of them. It did not: v0.2.16 shipped with
funscriptforge-web still advertising v0.2.15, because the website is a
separate repo and nothing tied the two together.

The four places, and why they disagree on purpose:

  ui/web/package.json              full label ("0.3.17-alpha"). The UI reads
                                   this one -- appVersion.js imports it, so it
                                   is what the title bar and About dialog show.
  ui/web/src-tauri/Cargo.toml      full label. Rust crate version.
  ui/web/src-tauri/tauri.conf.json STRIPPED ("0.3.17"). The MSI bundler
                                   refuses a non-numeric pre-release
                                   identifier, so the marketing suffix cannot
                                   go here. This is a hard Tauri constraint,
                                   not a style choice.
  <web repo>/index.html            the "vX.Y.Z-alpha" download note.

Usage:
    python scripts/bump_version.py 0.3.17-alpha
    python scripts/bump_version.py --check          # verify agreement
    python scripts/bump_version.py 0.3.17-alpha --no-web

Files are rewritten byte-for-byte apart from the version itself: line
endings are preserved (this repo is CRLF) and JSON is patched textually
rather than re-serialised, so formatting and key order survive.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB_REPO = REPO.parent / "funscriptforge-web"

# A label like 0.3.17-alpha. The suffix is optional and free-form; only
# tauri.conf.json cares about it, and it gets stripped there.
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$")


def strip_suffix(version: str) -> str:
    """Drop a pre-release label: 0.3.17-alpha -> 0.3.17 (MSI constraint)."""
    return version.split("-", 1)[0]


def _read(path: Path) -> str:
    # newline="" keeps CRLF intact so a bump is not a whole-file diff.
    return path.read_text(encoding="utf-8", newline="")


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="")


def _sub_once(text: str, pattern: re.Pattern[str], new: str, what: str) -> str:
    """Replace exactly one match, or fail loudly.

    A silent no-op here is the whole failure mode this script exists to
    prevent, so an anchor that stops matching must be an error rather than
    a version that quietly stays behind.
    """
    text, n = pattern.subn(new, text, count=1)
    if n != 1:
        raise SystemExit(f"bump_version: anchor did not match in {what}")
    return text


# Each target: (path, compiled anchor with one capture group for the
# version, template producing the replacement, transform on the version).
def _targets(version: str, include_web: bool):
    t = [
        (
            REPO / "ui/web/package.json",
            re.compile(r'("version"\s*:\s*")([^"]+)(")'),
            lambda v: rf'\g<1>{v}\g<3>',
            version,
        ),
        (
            REPO / "ui/web/src-tauri/Cargo.toml",
            re.compile(r'(?m)^(version\s*=\s*")([^"]+)(")'),
            lambda v: rf'\g<1>{v}\g<3>',
            version,
        ),
        (
            REPO / "ui/web/src-tauri/tauri.conf.json",
            re.compile(r'("version"\s*:\s*")([^"]+)(")'),
            lambda v: rf'\g<1>{v}\g<3>',
            strip_suffix(version),
        ),
    ]
    if include_web:
        t.append(
            (
                WEB_REPO / "index.html",
                re.compile(r'(\bv)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(\s*&nbsp;)'),
                lambda v: rf'\g<1>{v}\g<3>',
                version,
            )
        )
    return t


def apply(version: str, include_web: bool) -> int:
    changed = 0
    for path, anchor, tmpl, value in _targets(version, include_web):
        if not path.exists():
            print(f"  SKIP  {path} (not found)")
            continue
        before = _read(path)
        after = _sub_once(before, anchor, tmpl(value), str(path))
        if before == after:
            print(f"  ok    {path.name} already {value}")
            continue
        _write(path, after)
        print(f"  BUMP  {path.name} -> {value}")
        changed += 1
    return changed


def dev_stamp(sha: str) -> int:
    """Mark a build-only dispatch so it cannot be mistaken for a release.

    Only package.json is touched, because that is the file appVersion.js
    imports -- so the title bar, status bar, and About dialog all start
    reporting e.g. "0.3.17-alpha+dev.446dd7c".

    tauri.conf.json is deliberately left alone: the MSI bundler rejects a
    non-numeric pre-release identifier, and build metadata is no safer.
    Cargo.toml is left alone for the same reason (and nothing displays it).

    This exists because on 2026-09-05 a dispatch build and the v0.2.16
    release were indistinguishable in the UI, and half a session was spent
    debugging a feature that simply was not in the installed binary.
    """
    path = REPO / "ui/web/package.json"
    anchor = re.compile(r'("version"\s*:\s*")([^"]+)(")')
    before = _read(path)
    m = anchor.search(before)
    if not m:
        raise SystemExit("bump_version: no version in package.json")
    base = m.group(2).split("+", 1)[0]
    stamped = f"{base}+dev.{sha}"
    _write(path, _sub_once(before, anchor, rf'\g<1>{stamped}\g<3>', str(path)))
    print(f"  DEV   package.json -> {stamped}")
    return 0


def check(include_web: bool) -> int:
    """Report what each file claims; non-zero if they disagree."""
    seen: dict[str, str] = {}
    for path, anchor, _tmpl, _value in _targets("0.0.0", include_web):
        if not path.exists():
            print(f"  SKIP  {path} (not found)")
            continue
        m = anchor.search(_read(path))
        if not m:
            print(f"  FAIL  {path.name}: no version found")
            return 1
        seen[path.name] = m.group(2)
        print(f"  {path.name:24} {m.group(2)}")

    # tauri.conf.json is expected to differ (stripped); everything else
    # must agree exactly.
    tauri = seen.pop("tauri.conf.json", None)
    labels = set(seen.values())
    if len(labels) > 1:
        print(f"\nMISMATCH: {seen}")
        return 1
    if labels and tauri is not None:
        want = strip_suffix(next(iter(labels)))
        if tauri != want:
            print(f"\nMISMATCH: tauri.conf.json is {tauri}, expected {want}")
            return 1
    print("\nAll version strings agree.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("version", nargs="?", help="e.g. 0.3.17-alpha")
    ap.add_argument("--check", action="store_true", help="verify, change nothing")
    ap.add_argument("--dev-stamp", metavar="SHA",
                    help="append +dev.SHA to package.json only (CI dispatch builds)")
    ap.add_argument("--no-web", action="store_true",
                    help="skip the funscriptforge-web download note")
    args = ap.parse_args()

    include_web = not args.no_web

    if args.dev_stamp:
        return dev_stamp(args.dev_stamp)

    if args.check:
        return check(include_web)

    if not args.version:
        ap.error("give a version, or use --check")

    version = args.version.lstrip("v")
    if not VERSION_RE.match(version):
        ap.error(f"not a version: {args.version!r} (want e.g. 0.3.17-alpha)")

    print(f"Setting version to {version} "
          f"(tauri.conf.json gets {strip_suffix(version)}):")
    apply(version, include_web)
    if include_web and WEB_REPO.exists():
        print(f"\nNote: {WEB_REPO.name} is a SEPARATE repo -- commit and push it too.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
