"""Default Channels assignment arc — position-derived character + mechanical
style used when the user SKIPS the Channels tab (no characters.json, or a
chapter with no assignment). Gives a coherent open -> build -> climax ->
wind-down shape so "skip Channels and still export" yields good defaults.

The arc (locked 2026-06-05; user-configurable default is a LATER version):

  position        character          mechanical
  ------------    ---------------    ------------
  first chapter   scene_builder      Cowgirl       (eases in)
  middle          balanced <-> unpredictable / Missionary <-> Doggy  (alternate)
  2nd-to-last     reactive           Riding        (the peak)
  last chapter    scene_closer       Cowgirl       (winds down)

Short scenes collapse sensibly: 1 = open only; 2 = open + close;
3 = open + peak + close.

Generation falls back to this ONLY when chapters exist (an analyzed project);
a truly bare funscript with no chapters stays minimal (no auto e-stim).
"""

from __future__ import annotations

# Character arc (e-stim persona id) by position.
_CHAR_FIRST = "scene_builder"
_CHAR_LAST = "scene_closer"
_CHAR_PENULT = "reactive"
_CHAR_MIDDLE = ("balanced", "unpredictable")

# Mechanical arc (multi-axis position-style key) by position.
_MECH_FIRST = "Cowgirl"
_MECH_LAST = "Cowgirl"
_MECH_PENULT = "Riding"
_MECH_MIDDLE = ("Missionary", "Doggy")


def _arc(index: int, total: int, first, last, penult, middle):
    """Position -> value for the open/build/peak/close arc.

    Order of checks matters: first and last win over penult so 2- and
    3-chapter scenes collapse correctly.
    """
    if total <= 1 or index <= 0:
        return first
    if index == total - 1:
        return last
    if index == total - 2:
        return penult
    # middle: alternate the two by position so neighbours differ.
    return middle[(index - 1) % 2]


def default_character_for(index: int, total: int) -> str:
    """Position-derived default character id for chapter ``index`` of ``total``."""
    return _arc(index, total, _CHAR_FIRST, _CHAR_LAST, _CHAR_PENULT, _CHAR_MIDDLE)


def default_mech_for(index: int, total: int) -> str:
    """Position-derived default mechanical style key for chapter ``index`` of ``total``."""
    return _arc(index, total, _MECH_FIRST, _MECH_LAST, _MECH_PENULT, _MECH_MIDDLE)
