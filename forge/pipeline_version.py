"""Version stamp for the OUTPUT pipeline — generation, polish and export.

Why this exists
---------------
A `.forge` bundle used to record ``created_with: "FunscriptForge"`` and no
version, so nothing on disk said which engine produced it. When a fix changed
the output, there was no way to tell an affected bundle from a good one short
of measuring the funscript — which is exactly what had to be done on
2026-09-24 to discover that `blend_seams` had been flattening every exported
motion track (median stroke depth 88 -> 30, chapter dynamics erased).

The analysis stage already solved this shape of problem: videoflow's
``ANALYZER_VERSION`` is stamped into ``chapters.json`` and mirrored in
``api/forge.js``, and the Open dialog offers to recalculate on a mismatch.
This is the same idea for the other end of the pipeline.

⚠ One deliberate difference from ``ANALYZER_VERSION``: there, a MISSING stamp
is grandfathered rather than re-ground, because re-analysing is expensive and
old chapters are usually fine. Here a missing stamp means STALE, because every
bundle that predates stamping was built by a pipeline we know flattened the
motion track. Re-rendering is cheap and the old output is known-bad.

Bumping
-------
Bump ``OUTPUT_PIPELINE_VERSION`` whenever a change alters the BYTES a project
produces — a transform fix, a generation change, a new channel in a station.
Add a ``PIPELINE_CHANGELOG`` entry saying what changed in user-facing terms:
that text is what a "your outputs are out of date" prompt shows, so it has to
answer "why should I care?" rather than just "a number differs".

Do NOT bump for changes that cannot alter output (UI, docs, refactors).
Every bump asks users to re-render their library.
"""

# Bump with a PIPELINE_CHANGELOG entry. Mirrored in
# ui/web/src/api/forge.js as OUTPUT_PIPELINE_VERSION.
OUTPUT_PIPELINE_VERSION = "3"

# version -> what changed, in the words a user needs to decide.
PIPELINE_CHANGELOG: dict[str, str] = {
    "3": (
        "Events now last as long as you set them. A flat stretch before an "
        "event was being discarded when the channel was saved, so players "
        "slid gradually into the event from wherever the flat stretch began "
        "— a 2-second pause could play as a 35-second fade, and volume "
        "appeared to drop with nothing happening in the audio. Re-stamp your "
        "device stations to pick this up; re-exporting alone is not enough."
    ),
    "2": (
        "Exports no longer flatten the motion track. 'Blend seams' was "
        "smoothing every stroke instead of only the sharp transitions, which "
        "removed most of the depth you authored and made all chapters feel "
        "the same. E-stim no longer fades out at each chapter boundary."
    ),
    "1": "Original pipeline (not stamped on disk).",
}


def is_stale(stamped: str | None) -> bool:
    """True when output stamped with ``stamped`` should be re-rendered.

    ``None`` — the bundle predates stamping — counts as stale. See the module
    docstring for why this differs from the analyzer's grandfathering rule.
    """
    return stamped is None or str(stamped) != OUTPUT_PIPELINE_VERSION


def changes_since(stamped: str | None) -> list[str]:
    """User-facing reasons that output at ``stamped`` is out of date.

    Every version newer than ``stamped``, newest first. An unstamped bundle
    gets every entry except the placeholder for version 1 itself.
    """
    try:
        have = int(stamped) if stamped is not None else 0
    except (TypeError, ValueError):
        have = 0
    out = []
    for v in sorted(PIPELINE_CHANGELOG, key=int, reverse=True):
        if int(v) > have and int(v) > 1:
            out.append(PIPELINE_CHANGELOG[v])
    return out
