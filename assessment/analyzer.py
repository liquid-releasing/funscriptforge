# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""FunscriptAnalyzer: structural analysis of a funscript.

Pipeline:
  load() → analyze() → AssessmentResult

The AssessmentResult contains:
  phases, cycles, patterns, phrases — all with both millisecond and
  human-readable timestamp fields, plus per-phrase BPM.

  bpm_transitions — list of significant BPM changes between consecutive phrases,
  flagged when the change exceeds bpm_change_threshold_pct.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, List, Optional, Tuple

from models import Phase, Cycle, Pattern, Phrase, BpmTransition, AssessmentResult
from utils import ms_to_timestamp

# Internal tuple types used by the detection pipeline.
# (start_ms, end_ms, pattern_label, oscillation_count, amplitude_range)
_CycleRow = Tuple[int, int, str, int, float]


@dataclass
class AnalyzerConfig:
    """Tunable parameters for the analysis pipeline."""
    min_velocity: float = 0.02
    min_phase_duration_ms: int = 80
    duration_tolerance: float = 0.20
    velocity_tolerance: float = 0.25
    # Two cycles whose amplitude ranges differ by more than this fraction
    # are considered distinct patterns (breaks up P1-style monolithic phrases).
    amplitude_tolerance: float = 0.30
    # After phrase detection, merge any phrase shorter than this into its
    # shortest neighbour.  Set to 0 to disable.
    # NOTE: if auto_scale_phrases is True, this is auto-adjusted based on
    # funscript duration (see _auto_scale_phrase_params).
    min_phrase_duration_ms: int = 20_000
    # During phrase detection, force a phrase boundary once the accumulated
    # duration would exceed this value even if the pattern is still uniform.
    # Prevents a single giant phrase on perfectly uniform funscripts (e.g.
    # VictoriaOaks).  Set to 0 to disable.
    max_phrase_duration_ms: int = 300_000  # 5 minutes
    # Flag BPM transitions whose absolute percentage change exceeds this value
    bpm_change_threshold_pct: float = 40.0
    # Auto-scale phrase parameters based on funscript duration.
    # Short scripts (3min) keep tight detection; long scripts (90min) use
    # wider tolerances to avoid over-segmentation.
    auto_scale_phrases: bool = True

    def __post_init__(self) -> None:
        if self.min_velocity < 0:
            raise ValueError(f"min_velocity must be >= 0, got {self.min_velocity}")
        if self.min_phase_duration_ms < 0:
            raise ValueError(f"min_phase_duration_ms must be >= 0, got {self.min_phase_duration_ms}")
        if not 0.0 < self.duration_tolerance < 1.0:
            raise ValueError(f"duration_tolerance must be in (0, 1), got {self.duration_tolerance}")
        if not 0.0 < self.amplitude_tolerance < 1.0:
            raise ValueError(f"amplitude_tolerance must be in (0, 1), got {self.amplitude_tolerance}")
        if self.bpm_change_threshold_pct <= 0:
            raise ValueError(
                f"bpm_change_threshold_pct must be > 0, got {self.bpm_change_threshold_pct}"
            )


class FunscriptAnalyzer:
    """Analyzes a funscript and produces a structured AssessmentResult.

    Usage::

        analyzer = FunscriptAnalyzer()
        analyzer.load("path/to/file.funscript")
        result = analyzer.analyze()
        result.save("path/to/assessment.json")
    """

    def __init__(self, config: Optional[AnalyzerConfig] = None):
        self.config = config or AnalyzerConfig()
        self._actions: list = []
        self._source_file: str = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, path: str) -> None:
        """Load a funscript file.

        Raises:
            FileNotFoundError: if the file does not exist.
            ValueError: if the file is not valid JSON or missing the 'actions' list.
        """
        try:
            with open(path) as f:
                data = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(f"Funscript not found: {path}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in funscript '{path}': {e}")
        if "actions" not in data or not isinstance(data["actions"], list):
            raise ValueError(
                f"Funscript '{path}' is missing a required 'actions' list."
            )
        self._actions = data["actions"]
        self._source_file = path

    def analyze(
        self,
        progress_callback: Optional[Callable[[str], None]] = None,
    ) -> AssessmentResult:
        """Run the full analysis pipeline and return an AssessmentResult.

        Parameters
        ----------
        progress_callback:
            Optional callable invoked at the start of each pipeline stage with
            a human-readable stage label, e.g. ``"Detecting phases…"``.
            Useful for updating progress indicators in a UI.
        """
        if not self._actions:
            raise RuntimeError("No actions loaded. Call load() first.")

        def _cb(stage: str) -> None:
            if progress_callback:
                progress_callback(stage)

        _cb("Detecting phases…")
        phases = self._detect_phases()
        _cb("Detecting cycles…")
        cycles = self._detect_cycles(phases)
        _cb("Detecting patterns…")
        patterns = self._detect_patterns(cycles)
        _cb("Detecting phrases…")
        if self.config.auto_scale_phrases:
            self._auto_scale_phrase_params()
        phrases = self._detect_phrases(patterns)
        _cb("Detecting BPM transitions…")
        bpm_transitions = self._detect_bpm_transitions(phrases)
        _cb("Classifying behaviors…")

        # Behavioral classification — adds "tags" and "metrics" to each phrase dict
        from assessment.classifier import annotate_phrases
        phrase_dicts = [p.to_dict() for p in phrases]
        cycle_dicts  = [c.to_dict() for c in sum([p.cycles for p in patterns], [])]
        annotate_phrases(phrase_dicts, cycle_dicts, self._actions)
        # Store annotations back onto the Phrase objects
        for phrase, pd in zip(phrases, phrase_dicts):
            phrase.tags    = pd.get("tags", [])
            phrase.metrics = pd.get("metrics", {})

        return AssessmentResult(
            source_file=self._source_file,
            analyzed_at=datetime.now().isoformat(),
            duration_ms=self._actions[-1]["at"],
            action_count=len(self._actions),
            phases=phases,
            cycles=cycles,
            patterns=patterns,
            phrases=phrases,
            bpm_transitions=bpm_transitions,
        )

    def _auto_scale_phrase_params(self) -> None:
        """Scale phrase detection parameters based on funscript duration.

        Short scripts (3min) keep tight detection (~7-10 phrases).
        Long scripts (90min) use wider tolerances (~15-25 phrases).
        """
        if not self._actions:
            return

        dur_ms = self._actions[-1]["at"] - self._actions[0]["at"]
        dur_min = dur_ms / 60_000

        # Target ~10-25 phrases regardless of duration.
        # Formula: duration / 15 gives ~15 phrases, with floor and ceiling.
        # 3min → 12s, 10min → 40s, 30min → 120s, 90min → 360s (capped at 180s)
        target_phrases = 15
        scaled_min = max(10_000, int(dur_ms / target_phrases))
        scaled_min = min(scaled_min, 180_000)  # Cap at 3 minutes

        # Scale amplitude tolerance: 0.40 base, up to 0.55 for long scripts
        # Higher tolerance = fewer phrase splits on amplitude changes
        if dur_min > 10:
            scaled_amp_tol = min(0.55, 0.40 + (dur_min - 10) * 0.002)
        else:
            scaled_amp_tol = 0.40

        # Scale max phrase duration proportionally
        scaled_max = max(300_000, int(dur_min * 5000))  # 5s per minute
        scaled_max = min(scaled_max, 600_000)  # Cap at 10 minutes

        self.config.min_phrase_duration_ms = scaled_min
        self.config.amplitude_tolerance = scaled_amp_tol
        self.config.max_phrase_duration_ms = scaled_max

    # ------------------------------------------------------------------
    # Phase detection
    # ------------------------------------------------------------------

    def _detect_phases(self) -> List[Phase]:
        actions = self._actions
        cfg = self.config
        phases: List[Phase] = []
        phase_start_idx = 0
        phase_velocities: List[float] = []

        for i in range(1, len(actions)):
            t0 = actions[i - 1]["at"]
            t1 = actions[i]["at"]
            p0 = actions[i - 1]["pos"]
            p1 = actions[i]["pos"]

            v = self._velocity(p0, p1, t0, t1)
            phase_velocities.append(v)

            current_dir = self._dir(v, cfg.min_velocity)
            prev_dir = (
                self._dir(phase_velocities[-2], cfg.min_velocity)
                if len(phase_velocities) > 1
                else current_dir
            )

            if current_dir != prev_dir:
                start_t = actions[phase_start_idx]["at"]
                end_t = actions[i - 1]["at"]
                if end_t - start_t >= cfg.min_phase_duration_ms:
                    avg_vel = sum(phase_velocities[:-1]) / max(1, len(phase_velocities[:-1]))
                    phases.append(Phase(start_t, end_t, self._describe_phase(avg_vel)))
                phase_start_idx = i - 1
                phase_velocities = [v]

        if phase_velocities:
            start_t = actions[phase_start_idx]["at"]
            end_t = actions[-1]["at"]
            if end_t - start_t >= cfg.min_phase_duration_ms:
                avg_vel = sum(phase_velocities) / max(1, len(phase_velocities))
                phases.append(Phase(start_t, end_t, self._describe_phase(avg_vel)))

        return phases

    # ------------------------------------------------------------------
    # Cycle detection
    # ------------------------------------------------------------------

    def _detect_cycles(self, phases: List[Phase]) -> List[Cycle]:
        """Group phases into cycles.

        A cycle closes once it has accumulated at least one active (non-flat)
        direction change in each direction (i.e. a complete up→down oscillation).
        When the *next* direction change would start a new oscillation, the
        accumulated phases are emitted as a cycle and a fresh one begins.
        """
        cycles: List[Cycle] = []
        current: List[Phase] = []

        for ph in phases:
            ph_dir = self._phase_direction(ph.label)

            if not current:
                current.append(ph)
                continue

            last_dir = self._phase_direction(current[-1].label)

            if ph_dir == last_dir:
                # consecutive same direction — extend the current segment
                current.append(ph)
            else:
                # direction changed — check if current already has both active directions
                active_dirs = {
                    self._phase_direction(p.label)
                    for p in current
                    if self._phase_direction(p.label) != "flat"
                }
                if len(active_dirs) >= 2:
                    # completed a full oscillation; close and start fresh
                    label = " → ".join(self._phase_direction(p.label) for p in current)
                    c_start = current[0].start_ms
                    c_end   = current[-1].end_ms
                    cycles.append(Cycle(
                        c_start, c_end, label,
                        self._oscillation_count(current),
                        self._cycle_amplitude(c_start, c_end),
                    ))
                    current = [ph]
                else:
                    current.append(ph)

        if current:
            label   = " → ".join(self._phase_direction(p.label) for p in current)
            c_start = current[0].start_ms
            c_end   = current[-1].end_ms
            cycles.append(Cycle(
                c_start, c_end, label,
                self._oscillation_count(current),
                self._cycle_amplitude(c_start, c_end),
            ))

        return cycles

    # ------------------------------------------------------------------
    # Pattern detection
    # ------------------------------------------------------------------

    def _detect_patterns(self, cycles: List[Cycle]) -> List[Pattern]:
        patterns: List[Pattern] = []
        assigned = [False] * len(cycles)

        for i, base in enumerate(cycles):
            if assigned[i]:
                continue
            group = [base]
            assigned[i] = True
            for j in range(i + 1, len(cycles)):
                if not assigned[j] and self._cycles_similar(base, cycles[j]):
                    group.append(cycles[j])
                    assigned[j] = True
            avg_dur = sum(c.end_ms - c.start_ms for c in group) / len(group)
            patterns.append(Pattern(base.label, avg_dur, len(group), group))

        return patterns

    # ------------------------------------------------------------------
    # Phrase detection
    # ------------------------------------------------------------------

    def _detect_phrases(self, patterns: List[Pattern]) -> List[Phrase]:
        all_cycles = sorted(
            [
                (c.start_ms, c.end_ms, p.pattern_label, c.oscillation_count, c.amplitude_range)
                for p in patterns for c in p.cycles
            ],
            key=lambda x: x[0],
        )

        phrases: List[Phrase] = []
        current: List[_CycleRow] = []
        current_label: Optional[str] = None
        current_oscillations: int = 0
        current_amp_sum: float = 0.0

        for start, end, label, osc, amp in all_cycles:
            if not current:
                current.append((start, end))
                current_label = label
                current_oscillations = osc
                current_amp_sum = amp
                continue

            # Break on pattern label change OR significant amplitude shift.
            label_changed = label != current_label
            amp_changed = False
            if amp > 0 and current_amp_sum > 0:
                current_avg_amp = current_amp_sum / len(current)
                deviation = abs(amp - current_avg_amp) / max(amp, current_avg_amp)
                amp_changed = deviation > self.config.amplitude_tolerance

            if not label_changed and not amp_changed:
                # Duration-based fallback split: prevent one giant phrase on
                # perfectly uniform funscripts (fixes VictoriaOaks / issue #2).
                max_dur = self.config.max_phrase_duration_ms
                duration_exceeded = (
                    max_dur > 0
                    and (end - current[0][0]) > max_dur
                )
                if duration_exceeded:
                    phrases.append(self._make_phrase(current, current_label, current_oscillations))
                    current = [(start, end)]
                    current_label = label
                    current_oscillations = osc
                    current_amp_sum = amp
                else:
                    current.append((start, end))
                    current_oscillations += osc
                    current_amp_sum += amp
            else:
                phrases.append(self._make_phrase(current, current_label, current_oscillations))
                current = [(start, end)]
                current_label = label
                current_oscillations = osc
                current_amp_sum = amp

        if current:
            phrases.append(self._make_phrase(current, current_label, current_oscillations))

        return self._merge_short_phrases(phrases)

    def _merge_short_phrases(self, phrases: List[Phrase]) -> List[Phrase]:
        """Merge any phrase shorter than min_phrase_duration_ms into its shortest neighbour."""
        min_dur = self.config.min_phrase_duration_ms
        if min_dur <= 0 or len(phrases) <= 1:
            return phrases

        changed = True
        while changed and len(phrases) > 1:
            changed = False
            for i, ph in enumerate(phrases):
                if (ph.end_ms - ph.start_ms) < min_dur:
                    # Pick the shorter neighbour to merge into.
                    if i == 0:
                        merge_idx = 1
                    elif i == len(phrases) - 1:
                        merge_idx = i - 1
                    else:
                        prev_dur = phrases[i - 1].end_ms - phrases[i - 1].start_ms
                        next_dur = phrases[i + 1].end_ms - phrases[i + 1].start_ms
                        merge_idx = i - 1 if prev_dur <= next_dur else i + 1

                    lo, hi = min(i, merge_idx), max(i, merge_idx)
                    a, b = phrases[lo], phrases[hi]
                    merged = Phrase(
                        a.start_ms, b.end_ms,
                        a.pattern_label,
                        a.cycle_count + b.cycle_count,
                        f"{a.cycle_count + b.cycle_count} cycles",
                        a.oscillation_count + b.oscillation_count,
                    )
                    phrases = phrases[:lo] + [merged] + phrases[hi + 1:]
                    changed = True
                    break  # restart scan after each merge

        return phrases

    # ------------------------------------------------------------------
    # BPM transition detection
    # ------------------------------------------------------------------

    def _detect_bpm_transitions(self, phrases: List[Phrase]) -> List[BpmTransition]:
        """Flag consecutive phrase pairs where BPM changes significantly."""
        transitions: List[BpmTransition] = []
        threshold = self.config.bpm_change_threshold_pct

        for i in range(1, len(phrases)):
            prev = phrases[i - 1]
            curr = phrases[i]
            from_bpm = prev.bpm
            to_bpm = curr.bpm

            if from_bpm <= 0:
                continue

            change_pct = (to_bpm - from_bpm) / from_bpm * 100
            if abs(change_pct) >= threshold:
                transitions.append(BpmTransition(
                    at_ms=curr.start_ms,
                    from_bpm=round(from_bpm, 2),
                    to_bpm=round(to_bpm, 2),
                    change_pct=round(change_pct, 1),
                ))

        return transitions

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _velocity(p0: float, p1: float, t0: int, t1: int) -> float:
        return (p1 - p0) / max(1, t1 - t0)

    @staticmethod
    def _dir(v: float, threshold: float) -> int:
        if v > threshold:
            return 1
        if v < -threshold:
            return -1
        return 0

    @staticmethod
    def _describe_phase(avg_vel: float, threshold: float = 0.02) -> str:
        if avg_vel > threshold:
            return "steady upward motion"
        if avg_vel < -threshold:
            return "steady downward motion"
        return "low-motion plateau"

    @staticmethod
    def _phase_direction(label: str) -> str:
        label = label.lower()
        if "upward" in label:
            return "up"
        if "downward" in label:
            return "down"
        return "flat"

    def _cycles_similar(self, a: Cycle, b: Cycle) -> bool:
        cfg = self.config
        dur_a = a.end_ms - a.start_ms
        dur_b = b.end_ms - b.start_ms
        if abs(dur_a - dur_b) > cfg.duration_tolerance * max(dur_a, dur_b):
            return False
        if a.label != b.label:
            return False
        vel_a = 1.0 / max(1, dur_a)
        vel_b = 1.0 / max(1, dur_b)
        if abs(vel_a - vel_b) > cfg.velocity_tolerance * max(vel_a, vel_b):
            return False
        # Cycles with significantly different stroke depths are distinct patterns.
        if a.amplitude_range > 0 and b.amplitude_range > 0:
            amp_ratio = min(a.amplitude_range, b.amplitude_range) / max(a.amplitude_range, b.amplitude_range)
            if amp_ratio < (1.0 - cfg.amplitude_tolerance):
                return False
        return True

    @staticmethod
    def _make_phrase(current: list, label: str, oscillation_count: int = 0) -> Phrase:
        n = len(current)
        return Phrase(
            current[0][0], current[-1][1],
            label, n,
            f"{n} cycles of pattern '{label}'",
            oscillation_count,
        )

    def _oscillation_count(self, phases: List[Phase]) -> int:
        """Count up-down pairs (oscillations) in a list of phases."""
        active = sum(1 for p in phases if self._phase_direction(p.label) != "flat")
        return active // 2

    def _cycle_amplitude(self, start_ms: int, end_ms: int) -> float:
        """Position range (max - min) of actions within [start_ms, end_ms]."""
        positions = [
            a["pos"] for a in self._actions
            if start_ms <= a["at"] <= end_ms
        ]
        if not positions:
            return 0.0
        return float(max(positions) - min(positions))
