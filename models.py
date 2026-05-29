# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""Shared data models for assessment and pattern_catalog."""

import json
from dataclasses import dataclass, field
from typing import List, Dict, Optional

from utils import ms_to_timestamp, find_phrase_at


@dataclass
class Phase:
    start_ms: int
    end_ms: int
    label: str

    @property
    def start_ts(self) -> str:
        return ms_to_timestamp(self.start_ms)

    @property
    def end_ts(self) -> str:
        return ms_to_timestamp(self.end_ms)

    def to_dict(self) -> dict:
        return {
            "start_ms": self.start_ms,
            "start_ts": self.start_ts,
            "end_ms": self.end_ms,
            "end_ts": self.end_ts,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Phase":
        return cls(d["start_ms"], d["end_ms"], d["label"])


@dataclass
class Cycle:
    start_ms: int
    end_ms: int
    label: str
    oscillation_count: int = 0   # actual up-down pairs within this structural cycle
    amplitude_range: float = 0.0  # max_pos - min_pos of actions within this cycle

    @property
    def start_ts(self) -> str:
        return ms_to_timestamp(self.start_ms)

    @property
    def end_ts(self) -> str:
        return ms_to_timestamp(self.end_ms)

    @property
    def bpm(self) -> float:
        duration = self.end_ms - self.start_ms
        if duration <= 0 or self.oscillation_count == 0:
            return 0.0
        return round(self.oscillation_count * 60_000 / duration, 2)

    def to_dict(self) -> dict:
        return {
            "start_ms": self.start_ms,
            "start_ts": self.start_ts,
            "end_ms": self.end_ms,
            "end_ts": self.end_ts,
            "oscillation_count": self.oscillation_count,
            "bpm": self.bpm,
            "label": self.label,
            "amplitude_range": round(self.amplitude_range, 1),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Cycle":
        return cls(
            d["start_ms"], d["end_ms"], d["label"],
            d.get("oscillation_count", 0),
            d.get("amplitude_range", 0.0),
        )


@dataclass
class Pattern:
    pattern_label: str
    avg_duration_ms: float
    count: int
    cycles: List[Cycle]

    def to_dict(self) -> dict:
        return {
            "pattern_label": self.pattern_label,
            "avg_duration_ms": self.avg_duration_ms,
            "count": self.count,
            "cycles": [c.to_dict() for c in self.cycles],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Pattern":
        return cls(
            d["pattern_label"],
            d["avg_duration_ms"],
            d["count"],
            [Cycle.from_dict(c) for c in d["cycles"]],
        )


@dataclass
class Phrase:
    start_ms: int
    end_ms: int
    pattern_label: str
    cycle_count: int
    description: str
    oscillation_count: int = 0  # total up-down pairs across all cycles in this phrase
    tags: list = field(default_factory=list)    # behavioral tag keys, e.g. ["stingy", "drone"]
    metrics: dict = field(default_factory=dict)  # computed metrics from classifier
    shape_label: str = "steady"  # structural shape (the patterns lens): steady/pulse/three_one/tide/drift/burst/taper/swell

    @property
    def start_ts(self) -> str:
        return ms_to_timestamp(self.start_ms)

    @property
    def end_ts(self) -> str:
        return ms_to_timestamp(self.end_ms)

    @property
    def bpm(self) -> float:
        duration = self.end_ms - self.start_ms
        if duration <= 0 or self.oscillation_count == 0:
            return 0.0
        return round(self.oscillation_count * 60_000 / duration, 2)

    def to_dict(self) -> dict:
        return {
            "start_ms": self.start_ms,
            "start_ts": self.start_ts,
            "end_ms": self.end_ms,
            "end_ts": self.end_ts,
            "oscillation_count": self.oscillation_count,
            "bpm": self.bpm,
            "pattern_label": self.pattern_label,
            "cycle_count": self.cycle_count,
            "description": self.description,
            "tags": list(self.tags),
            "metrics": dict(self.metrics),
            "shape_label": self.shape_label,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Phrase":
        obj = cls(
            d["start_ms"], d["end_ms"],
            d["pattern_label"], d["cycle_count"], d["description"],
            d.get("oscillation_count", 0),
        )
        obj.tags    = d.get("tags", [])
        obj.metrics = d.get("metrics", {})
        obj.shape_label = d.get("shape_label", "steady")
        return obj


@dataclass
class BpmTransition:
    """A significant BPM change detected between consecutive phrases."""
    at_ms: int          # timestamp where the transition occurs (start of the new phrase)
    from_bpm: float     # BPM of the preceding phrase
    to_bpm: float       # BPM of the incoming phrase
    change_pct: float   # signed percentage change: (to - from) / from * 100

    @property
    def at_ts(self) -> str:
        return ms_to_timestamp(self.at_ms)

    @property
    def description(self) -> str:
        direction = "rises" if self.to_bpm > self.from_bpm else "drops"
        return (
            f"BPM {direction} from {self.from_bpm:.1f} to {self.to_bpm:.1f} "
            f"({self.change_pct:+.1f}%) at {self.at_ts}"
        )

    def to_dict(self) -> dict:
        return {
            "at_ms": self.at_ms,
            "at_ts": self.at_ts,
            "from_bpm": self.from_bpm,
            "to_bpm": self.to_bpm,
            "change_pct": self.change_pct,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BpmTransition":
        return cls(
            d["at_ms"],
            d["from_bpm"],
            d["to_bpm"],
            d["change_pct"],
        )


@dataclass
class Window:
    start_ms: int
    end_ms: int
    label: str = ""

    @property
    def start_ts(self) -> str:
        return ms_to_timestamp(self.start_ms)

    @property
    def end_ts(self) -> str:
        return ms_to_timestamp(self.end_ms)

    def to_dict(self) -> dict:
        return {
            "start_ms": self.start_ms,
            "start_ts": self.start_ts,
            "end_ms": self.end_ms,
            "end_ts": self.end_ts,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Window":
        return cls(d["start_ms"], d["end_ms"], d.get("label", ""))


@dataclass
class AssessmentResult:
    source_file: str
    analyzed_at: str
    duration_ms: int
    action_count: int
    phases: List[Phase]
    cycles: List[Cycle]
    patterns: List[Pattern]
    phrases: List[Phrase]
    bpm_transitions: List[BpmTransition] = field(default_factory=list)

    @property
    def duration_ts(self) -> str:
        return ms_to_timestamp(self.duration_ms)

    @property
    def bpm(self) -> float:
        """Average oscillations per minute derived from directional phase count."""
        active = sum(
            1 for p in self.phases
            if "upward" in p.label or "downward" in p.label
        )
        if active == 0 or self.duration_ms <= 0:
            return 0.0
        return round((active / 2) * 60_000 / self.duration_ms, 2)

    def phrase_at(self, t_ms: int) -> Optional[Phrase]:
        """Return the phrase containing timestamp t_ms, or None."""
        return find_phrase_at(self.phrases, t_ms)

    def to_dict(self) -> dict:
        return {
            "meta": {
                "source_file": self.source_file,
                "analyzed_at": self.analyzed_at,
                "duration_ms": self.duration_ms,
                "duration_ts": self.duration_ts,
                "action_count": self.action_count,
                "bpm": self.bpm,
            },
            "bpm_transitions": [t.to_dict() for t in self.bpm_transitions],
            "phrases": [p.to_dict() for p in self.phrases],
            "cycles": [c.to_dict() for c in self.cycles],
            "patterns": [p.to_dict() for p in self.patterns],
            "phases": [p.to_dict() for p in self.phases],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "AssessmentResult":
        meta = d["meta"]
        return cls(
            source_file=meta["source_file"],
            analyzed_at=meta["analyzed_at"],
            duration_ms=meta["duration_ms"],
            action_count=meta["action_count"],
            phases=[Phase.from_dict(p) for p in d.get("phases", [])],
            cycles=[Cycle.from_dict(c) for c in d.get("cycles", [])],
            patterns=[Pattern.from_dict(p) for p in d.get("patterns", [])],
            phrases=[Phrase.from_dict(p) for p in d.get("phrases", [])],
            bpm_transitions=[BpmTransition.from_dict(t) for t in d.get("bpm_transitions", [])],
        )

    def save(self, path: str) -> None:
        """Save the assessment result to a JSON file.

        Raises:
            OSError: if the file cannot be written.
        """
        try:
            with open(path, "w") as f:
                json.dump(self.to_dict(), f, indent=2)
        except OSError as e:
            raise OSError(f"Failed to save assessment to '{path}': {e}") from e

    @classmethod
    def load(cls, path: str) -> "AssessmentResult":
        """Load an assessment result from a JSON file.

        Raises:
            FileNotFoundError: if the file does not exist.
            ValueError: if the file is not valid JSON.
        """
        try:
            with open(path) as f:
                return cls.from_dict(json.load(f))
        except FileNotFoundError:
            raise FileNotFoundError(f"Assessment file not found: {path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in assessment '{path}': {e}") from e
