#!/usr/bin/env python3
# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""FunscriptForge CLI

Full-pipeline shortcut (Steps 1 + 3 + 4 in one command):

  python cli.py pipeline path/to/input.funscript --output-dir output/
      [--perf performance.json] [--break break.json] [--raw raw.json]
      [--beats beats.json] [--transformer-config tc.json]
      [--customizer-config cc.json]

Individual steps:

  Step 1 — Assess
    python cli.py assess path/to/input.funscript [--output assessment.json]
                        [--config analyzer_config.json]
                        [--min-phrase-duration SECONDS]
                        [--amplitude-tolerance FRACTION]

  Step 2 — Review [MANUAL] — open assessment.json, inspect bpm_transitions and per-phrase BPMs,
             then decide which phrases to edit (use Streamlit UI or phrase-transform command)

  Step 3 — Transform (BPM-threshold based)
    python cli.py transform path/to/input.funscript \\
        --assessment assessment.json \\
        [--output output.funscript] \\
        [--config transformer_config.json]

  Step 4 — Customize (human-defined windows)
    python cli.py customize path/to/transformed.funscript \\
        --assessment assessment.json \\
        [--output customized.funscript] \\
        [--config customizer_config.json] \\
        [--perf manual_performance.json] \\
        [--break manual_break.json] \\
        [--raw raw_windows.json] \\
        [--beats beats.json]

  Step 2b — Phrase Transform (catalog transform on individual phrases)
    python cli.py phrase-transform path/to/input.funscript \\
        --assessment assessment.json \\
        --transform smooth --phrase 3 [--param strength=0.25]    # one phrase
        --transform normalize --all                               # all phrases
        --suggest [--bpm-threshold 120]                          # auto-pick per phrase
        --dry-run                                                # print plan only

    --suggest uses tag-aware rules (highest priority first):
      frantic → halve_tempo
      giggle / plateau / lazy → amplitude_scale  (amplify; scale targets peak hi ≈ 65)
      stingy                  → amplitude_scale  (reduce;  scale targets peak hi ≈ 65)
      drift / half_stroke     → recenter         (target_center=50)
      drone                   → beat_accent
      (no tag) transition     → smooth
      (no tag) low BPM        → passthrough
      (no tag) narrow span    → normalize
      (no tag) high BPM       → amplitude_scale

    For split-phrase workflows (different transforms in different time ranges within
    a single phrase) use the Streamlit Pattern Editor UI — it supports adding split
    boundaries, per-segment transform selection, and proportional copy to all
    instances of the same behavioral tag.

Additional commands:

  python cli.py finalize path/to/transformed.funscript          # blend seams + final smooth, then save
      [--output finalized.funscript]
      [--param seam_max_velocity=0.3]   # blend_seams param override
      [--param smooth_strength=0.05]    # final_smooth param override
      [--skip-seams] [--skip-smooth]    # disable either pass

  python cli.py export-plan path/to/input.funscript            # show export-tab transform plan
      [--assessment assessment.json]                           # use cached assessment
      [--transforms overrides.json]                           # per-phrase manual overrides
      [--no-recommended]                                       # skip auto-suggestions
      [--bpm-threshold 120]                                    # threshold for recommendations
      [--format table|json]                                    # output format (default: table)
      [--apply] [--output out.funscript]                       # write the result
      [--dry-run]                                              # print plan only

  python cli.py catalog [--catalog PATH]                       # show catalog summary
  python cli.py catalog --tag stingy                           # list all stingy phrases
  python cli.py catalog --remove Timeline1.original.funscript  # remove one entry
  python cli.py catalog --clear                                # clear all entries

  python cli.py visualize path/to/input.funscript --assessment assessment.json [--output viz.png]
  python cli.py config --output transformer_config.json        # dump default transformer config
  python cli.py config --customizer --output cc.json           # dump customizer config
  python cli.py config --analyzer --output analyzer_config.json  # dump analyzer config
  python cli.py test                                            # run all tests

Forge metadata / media analysis:

  python cli.py meta path/to/input.funscript                   # print auto-derived metadata table
      [--assessment assessment.json]                           # reuse cached assessment
      [--output metadata.json]                                 # also save as JSON
      [--format table|json]                                    # output format (default: table)

  Derived fields: Pace (BPM), Intensity (avg_speed), Stroke depth (pos range),
  Duration category, Dominant mood, Arc type, Variety, auto Hub tags, Tone suggestion.

  python cli.py suggest-tone path/to/input.funscript            # print tone label + rationale

  python cli.py beats path/to/video.mp4                        # extract beat timestamps
      [--audio path/to/override.wav]                           # use separate audio track instead
      [--output-dir output/]                                   # where to write _beats.json + _beats.csv
  Requires: pip install av librosa numpy

  python cli.py audio-peaks path/to/media.mp4                  # pre-computed waveform sidecar
      [--hop-ms 10]                                            # window size (default 10ms)
      [--force]                                                # recompute even if sidecar exists
      [--no-write]                                             # skip writing <stem>.audio.json
      [--format table|json]                                    # output format (default: table)
  Writes <stem>.audio.json next to the media file (peaks: 0..1 RMS-per-hop).
  Requires: pip install av numpy

  python cli.py parse-captions path/to/captions.srt            # parse SRT or VTT, save _captions.json
      [--output-dir output/]                                   # destination folder
      [--print]                                                # also print all cues to stdout
  Supports: .srt (SubRip), .vtt (WebVTT)
"""

import argparse
import copy
import dataclasses
import functools
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))

from assessment.analyzer import AnalyzerConfig, FunscriptAnalyzer
from assessment.classifier import TAGS
from catalog.pattern_catalog import PatternCatalog
from models import AssessmentResult
from pattern_catalog.config import TransformerConfig
from pattern_catalog.phrase_transforms import (
    TRANSFORM_CATALOG, _BUILTIN_KEYS, _validate_recipe_entry, suggest_transform,
    derive_picker_category,
)
from pattern_catalog.transformer import FunscriptTransformer
from user_customization.config import CustomizerConfig
from user_customization.customizer import WindowCustomizer
from utils import ms_to_timestamp
from visualizations.motion import HAS_MATPLOTLIB, MotionVisualizer


# ------------------------------------------------------------------
# Error handling
# ------------------------------------------------------------------

def _cli_command(fn):
    """Decorator that gives every CLI command consistent error handling.

    Catches FileNotFoundError and ValueError (the two exceptions our pipeline
    raises for bad input) and prints a clean one-line message to stderr before
    exiting with code 1.  KeyboardInterrupt exits with code 130.
    """
    @functools.wraps(fn)
    def wrapper(args):
        try:
            fn(args)
        except (FileNotFoundError, ValueError) as exc:
            print(f"Error: {exc}", file=sys.stderr)
            sys.exit(1)
        except KeyboardInterrupt:
            print("\nInterrupted.", file=sys.stderr)
            sys.exit(130)
    return wrapper


# ------------------------------------------------------------------
# Command implementations
# ------------------------------------------------------------------

def _build_analyzer_config(args):
    """Build an AnalyzerConfig from CLI args and optional --config file."""
    config = AnalyzerConfig()
    if getattr(args, "config", None):
        with open(args.config) as f:
            d = json.load(f)
        config = AnalyzerConfig(**{
            k: v for k, v in d.items()
            if k in AnalyzerConfig.__dataclass_fields__
        })
    if getattr(args, "min_phrase_duration", None) is not None:
        config.min_phrase_duration_ms = int(args.min_phrase_duration * 1000)
    if getattr(args, "amplitude_tolerance", None) is not None:
        config.amplitude_tolerance = args.amplitude_tolerance
    return config


@_cli_command
def cmd_pipeline(args):
    output_dir = args.output_dir or os.path.join(
        os.path.dirname(args.funscript), "output"
    )
    os.makedirs(output_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(args.funscript))[0]

    # Stage 1 — Assess
    analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
    analyzer.load(args.funscript)
    t0 = time.time()
    assessment = analyzer.analyze(progress_callback=lambda s: print(f"  {s}"))
    assessment_path = os.path.join(output_dir, f"{base}.assessment.json")
    assessment.save(assessment_path)
    print(f"Assessment saved: {assessment_path}  ({time.time() - t0:.2f}s)")
    print(f"  BPM: {assessment.bpm}  Phrases: {len(assessment.phrases)}"
          f"  Transitions: {len(assessment.bpm_transitions)}")

    # Stage 2 — Transform
    tx_config = TransformerConfig.load(args.transformer_config) if args.transformer_config else TransformerConfig()
    transformer = FunscriptTransformer(tx_config)
    transformer.load_funscript(args.funscript)
    transformer.load_assessment(assessment)
    t0 = time.time()
    transformer.transform()
    transformed_path = os.path.join(output_dir, f"{base}.transformed.funscript")
    transformer.save(transformed_path)
    print(f"Transformed:  {transformed_path}  ({time.time() - t0:.2f}s)")

    # Stage 3 — Customize
    cust_config = CustomizerConfig.load(args.customizer_config) if args.customizer_config else CustomizerConfig()
    customizer = WindowCustomizer(cust_config)
    customizer.load_funscript(transformed_path)
    customizer.load_assessment(assessment)
    customizer.load_manual_overrides(
        perf_path=args.perf,
        break_path=args.break_windows,
        raw_path=args.raw,
    )
    if args.beats:
        customizer.load_beats_from_file(args.beats)
    t0 = time.time()
    customizer.customize()
    customized_path = os.path.join(output_dir, f"{base}.customized.funscript")
    customizer.save(customized_path)
    print(f"Customized:   {customized_path}  ({time.time() - t0:.2f}s)")


@_cli_command
def cmd_assess(args):
    json_mode = getattr(args, "format", "table") == "json"

    # Fast path — reuse a FRESH phrases.json sidecar instead of re-running the
    # full analyzer pipeline. The de-coupled analyze pass already wrote it, so
    # re-entering the Phrases tab (or any assess on an unchanged funscript) was
    # paying the whole multi-minute pipeline again — the "aggressive recalc"
    # (D27a). Only for json_mode (the UI/bridge consumer); the table/file path
    # still computes because it persists the richer assessment object. A tone
    # edit rewrites the funscript → the sidecar is older → we recompute, which
    # is the correct invalidation.
    if json_mode:
        cached = _fresh_phrases_payload(args.funscript)
        if cached is not None:
            print(json.dumps(cached))
            return

    analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
    analyzer.load(args.funscript)
    t0 = time.time()
    # JSON mode: stdout is the structured payload — keep progress prints
    # off it. Send progress to stderr so the user (and Tauri bridge) can
    # still see them but the parser stays clean. The same stage label is
    # also pushed onto the structured progress pipe at depth 2 so the
    # AcceptBar footer renders a 6-step checklist (matches the
    # auto-chapter UX — depth 1 is reserved for the outer command
    # wrapper, depth 2+ is what the listener actually surfaces).
    _stages_seen: list[str] = []
    def _progress(stage: str) -> None:
        if json_mode:
            print(f"  {stage}", file=sys.stderr)
        else:
            print(f"  {stage}")
        # Close the previous stage with `done::` before opening the new
        # one with `start::`. The analyzer only emits one event per stage
        # (no explicit completion), so the next start implicitly marks
        # the prior stage done.
        if _stages_seen:
            _emit_progress(f"done::2::{_stages_seen[-1]}")
        _emit_progress(f"start::2::{stage}")
        _stages_seen.append(stage)

    result = analyzer.analyze(progress_callback=_progress)
    # Close the final stage once analyze() returns.
    if _stages_seen:
        _emit_progress(f"done::2::{_stages_seen[-1]}")
    elapsed = time.time() - t0

    # Chapter-scoped phrase re-detection — when chapters exist, replace
    # the global phrase pass with per-chapter detection so each chapter's
    # natural duration drives the analyzer's auto_scale thresholds. Solves
    # the previously-observed mashup-vs-individual mismatch: the 93-min
    # mashup yielded 37 phrases globally vs 111 across the 16 component
    # clips with tight per-chapter scoping. chapter_id is tagged at
    # detection time (no midpoint lookup needed).
    chapters = _load_chapters_for_phrases(args.funscript)
    if chapters:
        per_chapter_phrases = []
        for ch_idx, ch in enumerate(chapters):
            ch_start = int(ch.get("at_ms", 0))
            ch_end = int(ch.get("end_ms", 0))
            ch_actions = [
                a for a in analyzer._actions
                if ch_start <= a["at"] < ch_end
            ]
            if not ch_actions:
                continue
            # Per-chapter sub-analyzer: disable auto-scale. auto_scale targets
            # ~15 phrases per analyzed span; applied per-chapter that forces
            # 15 phrases into every chapter, over-splitting uniform regions
            # and burying real transitions under widened tolerances. Fixed
            # defaults (min_phrase_duration_ms=20_000, amplitude_tolerance=0.30)
            # split on actual character drift instead of a target count.
            sub_config = _build_analyzer_config(args)
            sub_config.auto_scale_phrases = False
            sub = FunscriptAnalyzer(config=sub_config)
            sub._actions = ch_actions
            sub._source_file = analyzer._source_file
            sub_result = sub.analyze(progress_callback=None)
            for p in sub_result.phrases:
                p.chapter_id = ch_idx
            per_chapter_phrases.extend(sub_result.phrases)
        result.phrases = per_chapter_phrases

    # Length splitter post-pass — chapter-scoped phrases > 4 min still
    # benefit from the splitter (e.g. one long chapter of uniform
    # character produces an oversized phrase). Mutates result.phrases so
    # the json_mode stdout payload reflects the split too.
    result.phrases = _split_long_phrases(result.phrases, args.funscript)

    # Step 2 — character-drift splitter. Subdivides on top/bottom/density drift,
    # adds beat-aligned drone-grid in long uniform stretches, snaps interior
    # boundaries to downbeats when the beats sidecar is available. Validated
    # against VictoriaOaks + IPZZ-125 dogfood; user-confirmed direction.
    from assessment.character_drift import split_phrases as _drift_split
    downbeats_ms = _load_downbeats_for_phrases(args.funscript)
    result.phrases = _drift_split(result.phrases, analyzer._actions, downbeats_ms=downbeats_ms)

    # Re-classify post-split phrases. _split_long_phrases and _drift_split
    # create NEW phrase boundaries; without this pass, tags / metrics /
    # shape_label reflect the pre-split phrases, which yields wrong
    # labels (e.g. a "swell" that was split into two equal halves would
    # carry "swell" on both halves even though each half is now
    # structurally different from the original).
    from assessment.classifier import annotate_phrases as _annotate_phrases
    from assessment.shape_labeler import label_phrases as _label_phrases
    _post_split_phrase_dicts = [p.to_dict() for p in result.phrases]
    _annotate_phrases(_post_split_phrase_dicts, [], analyzer._actions)
    _label_phrases(_post_split_phrase_dicts, analyzer._actions)
    for _phrase, _pd in zip(result.phrases, _post_split_phrase_dicts):
        _phrase.tags        = _pd.get("tags", [])
        _phrase.metrics     = _pd.get("metrics", {})
        _phrase.shape_label = _pd.get("shape_label", "steady")

    # Phrase slice sidecar — `<stem>.forge/<stem>.phrases.json`. Read by
    # PhrasesTab / PatternsTab. chapter_id comes from the runtime
    # attribute set during per-chapter detection above (None when the
    # project has no chapters sidecar).
    if not getattr(args, "no_save", False):
        _write_phrases_slice_sidecar(args.funscript, result)

    if json_mode:
        # Structured stdout payload for the Tauri bridge (PhrasesTab consumer).
        # Phrase shape: at_ms / end_ms / number (1-based global) / bpm / tag
        # (primary tag for color) / all_tags (forward-compat) / pattern_label.
        # Sidecar file is written too unless --no-save is passed; gives both
        # the JS consumer and the existing pipeline what they need.
        payload = {
            "duration_ms": result.duration_ms,
            "bpm": result.bpm,
            "action_count": result.action_count,
            "phrases": [
                {
                    "at_ms":         p.start_ms,
                    "end_ms":        p.end_ms,
                    "number":        i + 1,
                    "bpm":           p.bpm,
                    "tag":           (p.tags[0] if p.tags else None),
                    "all_tags":      list(p.tags),
                    "pattern_label": p.pattern_label,
                }
                for i, p in enumerate(result.phrases)
            ],
        }
        if not getattr(args, "no_save", False):
            output = args.output or _assessment_path(args.funscript)
            result.save(output)
        print(json.dumps(payload))
        return

    output = args.output or _assessment_path(args.funscript)
    result.save(output)

    print(f"Assessment saved: {output}  ({elapsed:.2f}s)")
    print(f"  Duration:  {result.duration_ts}  ({result.duration_ms} ms)")
    print(f"  BPM:       {result.bpm}")
    print(f"  Actions:   {result.action_count}")
    print(f"  Phases:    {len(result.phases)}")
    print(f"  Cycles:    {len(result.cycles)}")
    print(f"  Patterns:  {len(result.patterns)}")
    print(f"  Phrases:   {len(result.phrases)}")
    if result.bpm_transitions:
        print(f"  BPM transitions ({len(result.bpm_transitions)}):")
        for t in result.bpm_transitions:
            print(f"    {t.description}")
    else:
        print("  BPM transitions: none detected")


@_cli_command
def cmd_transform(args):
    config = TransformerConfig.load(args.config) if args.config else TransformerConfig()
    transformer = FunscriptTransformer(config)
    transformer.load_funscript(args.funscript)
    transformer.load_assessment_from_file(args.assessment)
    t0 = time.time()
    transformer.transform()
    elapsed = time.time() - t0

    output = args.output or _default_path(args.funscript, "_transformed.funscript")
    transformer.save(output)

    for line in transformer.get_log():
        print(line)
    print(f"\nTransformed funscript saved: {output}  ({elapsed:.2f}s)")


@_cli_command
def cmd_customize(args):
    config = CustomizerConfig.load(args.config) if args.config else CustomizerConfig()
    customizer = WindowCustomizer(config)
    customizer.load_funscript(args.funscript)
    customizer.load_assessment_from_file(args.assessment)

    customizer.load_manual_overrides(
        perf_path=args.perf,
        break_path=args.break_windows,
        raw_path=args.raw,
    )

    if args.beats:
        customizer.load_beats_from_file(args.beats)

    t0 = time.time()
    customizer.customize()
    elapsed = time.time() - t0

    output = args.output or _default_path(args.funscript, "_customized.funscript")
    customizer.save(output)

    for line in customizer.get_log():
        print(line)
    print(f"\nCustomized funscript saved: {output}  ({elapsed:.2f}s)")


@_cli_command
def cmd_visualize(args):
    if not HAS_MATPLOTLIB:
        print("Error: matplotlib is not installed. Run: pip install matplotlib")
        sys.exit(1)

    with open(args.funscript) as f:
        data = json.load(f)
    actions = data["actions"]

    assessment = AssessmentResult.load(args.assessment)
    output = args.output or _default_path(args.funscript, "_visualization.png")

    viz = MotionVisualizer(assessment, actions)
    viz.plot(output)
    print(f"Visualization saved: {output}")


@_cli_command
def cmd_config(args):
    if args.customizer:
        cfg = CustomizerConfig()
        output = args.output or "customizer_config.json"
        cfg.save(output)
        print(f"Default customizer config written: {output}")
    elif args.analyzer:
        cfg = AnalyzerConfig()
        output = args.output or "analyzer_config.json"
        with open(output, "w") as f:
            json.dump(dataclasses.asdict(cfg), f, indent=2)
        print(f"Default analyzer config written: {output}")
    else:
        cfg = TransformerConfig()
        output = args.output or "transformer_config.json"
        cfg.save(output)
        print(f"Default transformer config written: {output}")
    print("Edit the values then pass with --config when running the command.")


@_cli_command
def cmd_list_transforms(args):
    """List all available transforms (built-in + user-loaded)."""
    catalog = dict(sorted(TRANSFORM_CATALOG.items()))
    if args.user_only:
        catalog = {k: v for k, v in catalog.items() if k not in _BUILTIN_KEYS}

    if args.format == "json":
        out = {}
        for key, spec in catalog.items():
            # Hidden transforms (consolidated aliases) stay in the catalog so
            # recipes / suggest_transform resolve them, but are omitted from
            # the picker catalog the UI builds from this output.
            if getattr(spec, "hidden", False):
                continue
            # Category is the UI grouping the picker tabs key on: exactly
            # tone / behavior / structural. Shared helper so this and the
            # streamlit get_transforms_by_category can't disagree.
            category = derive_picker_category(key, spec)
            entry = {
                "name": spec.name,
                "description": spec.description,
                "structural": spec.structural,
                "category": category,
                "source": "builtin" if key in _BUILTIN_KEYS else "user",
            }
            if args.verbose:
                entry["params"] = {
                    pkey: {
                        "label": p.label,
                        "type": p.type,
                        "default": p.default,
                        "min": p.min_val,
                        "max": p.max_val,
                        "step": p.step,
                        "help": p.help,
                    }
                    for pkey, p in (spec.params or {}).items()
                }
            out[key] = entry
        print(json.dumps(out, indent=2))
        return

    # --- table output ---
    if not catalog:
        print("No transforms found.")
        return

    for key, spec in catalog.items():
        source_tag = "" if key in _BUILTIN_KEYS else "  [user]"
        struct_tag = "  (structural)" if spec.structural else ""
        print(f"{key}{source_tag}{struct_tag}")
        print(f"    {spec.name} — {spec.description}")
        if args.verbose and spec.params:
            for pkey, p in spec.params.items():
                default_str = f", default {p.default}" if p.default is not None else ""
                range_str = f" [{p.min_val}–{p.max_val}]" if p.min_val is not None else ""
                print(f"      --param {pkey}=VALUE  {p.label}{range_str}{default_str}")
                if p.help:
                    print(f"        {p.help}")
        print()


def cmd_validate_plugins(args):
    """Validate JSON recipe files and report Python plugin gate status."""
    import glob as _glob

    root = os.path.dirname(os.path.abspath(__file__))
    recipes_dir = args.recipes_dir or os.path.join(root, "user_transforms")
    plugins_dir = args.plugins_dir or os.path.join(root, "plugins")

    total_files = 0
    total_entries = 0
    total_errors = 0

    # ---- JSON recipes ----
    if os.path.isdir(recipes_dir):
        json_files = sorted(_glob.glob(os.path.join(recipes_dir, "*.json")))
        for path in json_files:
            fname = os.path.relpath(path, root)
            total_files += 1
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as exc:
                print(f"  ERROR  {fname}: {exc}")
                total_errors += 1
                continue
            entries = data if isinstance(data, list) else [data]
            file_ok = True
            for i, entry in enumerate(entries):
                total_entries += 1
                err = _validate_recipe_entry(entry)
                if err:
                    key = entry.get("key", f"entry[{i}]") if isinstance(entry, dict) else f"entry[{i}]"
                    print(f"  ERROR  {fname} [{key}]: {err}")
                    total_errors += 1
                    file_ok = False
                elif args.verbose:
                    key = entry.get("key", f"entry[{i}]")
                    print(f"  ok     {fname} [{key}]")
            if file_ok and not args.verbose:
                n = len(entries)
                print(f"  ok     {fname}  ({n} {'entry' if n == 1 else 'entries'})")
    else:
        print(f"  (no recipes directory at {recipes_dir})")

    # ---- Python plugins ----
    print()
    plugins_enabled = os.environ.get("FUNSCRIPT_PLUGINS_ENABLED", "").lower() in (
        "1", "true", "yes",
    )
    if os.path.isdir(plugins_dir):
        py_files = sorted(_glob.glob(os.path.join(plugins_dir, "*.py")))
        non_example = [p for p in py_files if not os.path.basename(p).startswith("example_")]
        example_files = [p for p in py_files if os.path.basename(p).startswith("example_")]
        if not py_files:
            print("Python plugins: none found in plugins/")
        else:
            status = "ENABLED (FUNSCRIPT_PLUGINS_ENABLED is set)" if plugins_enabled else "DISABLED (FUNSCRIPT_PLUGINS_ENABLED not set)"
            print(f"Python plugins: {status}")
            for p in non_example:
                tag = "would load" if plugins_enabled else "skipped — set FUNSCRIPT_PLUGINS_ENABLED=1 to enable"
                print(f"  {os.path.relpath(p, root)}: {tag}")
            for p in example_files:
                print(f"  {os.path.relpath(p, root)}: skipped (example/template file)")
    else:
        print("Python plugins: no plugins/ directory found")

    # ---- Summary ----
    print()
    if total_files == 0:
        print("No JSON recipe files found.")
    elif total_errors == 0:
        print(f"All {total_entries} recipe {'entry' if total_entries == 1 else 'entries'} in {total_files} {'file' if total_files == 1 else 'files'} are valid.")
    else:
        print(f"{total_errors} error(s) found across {total_files} file(s). Fix errors before loading.")
        sys.exit(1)


def _load_json_arg(val: str):
    """Accept either a path to a JSON file or an inline JSON string.

    The Tauri bridge passes spans/params as inline JSON argv strings
    (small payloads, well under argv limits) to avoid temp files; the CLI
    and tests can still pass a file path. Inline is detected by a leading
    '[' or '{'.
    """
    s = val.strip()
    if s[:1] in ("[", "{"):
        return json.loads(s)
    with open(val) as f:
        return json.load(f)


def _coerce(v: str):
    """Parse a string value as int, float, or str."""
    try:
        i = int(v); f = float(v)
        return i if i == f else f
    except ValueError:
        return v


@_cli_command
def cmd_phrase_transform(args):
    """Apply a catalog transform to one or all phrases of a funscript."""
    # --- load inputs ---
    with open(args.funscript) as f:
        data = json.load(f)
    actions = data["actions"]
    assessment = AssessmentResult.load(args.assessment)
    phrases = [p.__dict__ if hasattr(p, "__dict__") else p for p in assessment.phrases]
    # Normalise to plain dicts with the keys phrase_detail expects
    phrase_dicts = []
    for p in assessment.phrases:
        d = p if isinstance(p, dict) else {
            "start_ms":      p.start_ms,
            "end_ms":        p.end_ms,
            "bpm":           getattr(p, "bpm", 0),
            "pattern_label": getattr(p, "pattern_label", ""),
            "amplitude_span": getattr(p, "amplitude_span", 100),
            "cycle_count":   getattr(p, "cycle_count", None),
        }
        phrase_dicts.append(d)

    if not phrase_dicts:
        print("No phrases found in assessment — nothing to transform.")
        sys.exit(1)

    # --- resolve which phrases to process ---
    if args.all or args.suggest:
        indices = list(range(len(phrase_dicts)))
    elif args.phrase:
        indices = []
        for n in args.phrase:
            idx = n - 1   # user-facing is 1-based
            if idx < 0 or idx >= len(phrase_dicts):
                print(f"Error: --phrase {n} is out of range (1–{len(phrase_dicts)}).")
                sys.exit(1)
            indices.append(idx)
    else:
        print("Error: specify --phrase N, --all, or --suggest.")
        sys.exit(1)

    # --- parse --param key=value pairs ---
    extra_params = {}
    for kv in (args.param or []):
        if "=" not in kv:
            print(f"Error: --param must be key=value, got: {kv!r}")
            sys.exit(1)
        k, v = kv.split("=", 1)
        extra_params[k.strip()] = _coerce(v.strip())

    # --- build transform plan ---
    bpm_threshold = args.bpm_threshold or 120.0
    plan = []   # list of (phrase_idx, transform_key, param_values)
    for idx in indices:
        phrase = phrase_dicts[idx]
        if args.suggest:
            key, _ = suggest_transform(phrase, bpm_threshold)
        else:
            key = args.transform
            if key not in TRANSFORM_CATALOG:
                print(f"Error: unknown transform {key!r}. "
                      f"Available: {', '.join(TRANSFORM_CATALOG)}")
                sys.exit(1)
        spec = TRANSFORM_CATALOG[key]
        params = {k: v.default for k, v in spec.params.items()}
        params.update(extra_params)
        plan.append((idx, key, params))

    # --- print plan ---
    print(f"Phrase-transform plan ({len(plan)} phrase{'s' if len(plan) != 1 else ''}):")
    for idx, key, params in plan:
        ph = phrase_dicts[idx]
        param_str = "  ".join(f"{k}={v}" for k, v in params.items()) if params else "-"
        label = ph.get('pattern_label', '').encode('ascii', errors='replace').decode('ascii')
        print(f"  P{idx + 1:>2}  {key:<18}  params: {param_str}"
              f"  ({ph.get('bpm', 0):.0f} BPM, {label})")

    if args.dry_run:
        print("\n--dry-run: no file written.")
        return

    # --- apply ---
    result = copy.deepcopy(actions)
    for idx, key, params in plan:
        spec  = TRANSFORM_CATALOG[key]
        ph    = phrase_dicts[idx]
        start = ph["start_ms"]
        end   = ph["end_ms"]
        slice_ = [a for a in result if start <= a["at"] <= end]
        transformed = spec.apply(slice_, params)
        if spec.structural:
            # Replace the phrase slice with the new (potentially shorter) actions
            result = [a for a in result if not (start <= a["at"] <= end)]
            result = sorted(result + transformed, key=lambda a: a["at"])
        else:
            t_map = {a["at"]: a["pos"] for a in transformed}
            for a in result:
                if a["at"] in t_map:
                    a["pos"] = t_map[a["at"]]

    # --- save ---
    data["actions"] = result
    output = args.output or _default_path(args.funscript, "_phrase_transformed.funscript")
    with open(output, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nSaved: {output}")


def _clamp_action(a):
    """Funscript actions are int pos in [0,100] at int ms. Transforms may
    emit floats; normalise on the way out so preview == apply exactly."""
    return {"at": int(round(a["at"])), "pos": max(0, min(100, int(round(a["pos"]))))}


@_cli_command
def cmd_transform_apply(args):
    """Apply ONE catalog transform to a set of spans — the UI bridge for
    both preview and apply.

    This is intentionally decoupled from the assessment file: the editor
    already knows the phrase/stanza spans, so it passes them directly as
    a JSON list of {start_ms, end_ms} (--spans FILE). One transform + one
    param set is applied to every span (the edit set).

    Param keys MUST match the authoritative catalog (`list-transforms`),
    not the UI's historical aliases — that drift (center vs target_center,
    every_n vs every_nth, …) is exactly what this wiring exists to kill.

    --preview  → emit JSON {transform, params, spans:[{start_ms,end_ms,
                 actions:[{at,pos}]}]} to stdout, write nothing. Structural
                 transforms may change the action count/timing within a
                 span, so preview returns the transformed actions per span
                 rather than a position map.
    apply      → merge every span back into the full action list and write
                 the funscript to --output (or a *_transform_applied suffix).
    """
    key = args.transform
    if key not in TRANSFORM_CATALOG:
        raise ValueError(
            f"unknown transform {key!r}. "
            f"Available: {', '.join(sorted(TRANSFORM_CATALOG))}"
        )
    spec = TRANSFORM_CATALOG[key]

    with open(args.funscript) as f:
        data = json.load(f)
    actions = data["actions"]

    # --- spans (disjoint phrase/stanza windows) ---
    raw_spans = _load_json_arg(args.spans)
    spans = []
    for s in raw_spans:
        start = s.get("start_ms", s.get("at_ms"))
        end = s.get("end_ms")
        if start is None or end is None:
            raise ValueError(f"span missing start_ms/end_ms: {s!r}")
        spans.append((int(start), int(end)))
    spans.sort()

    # --- params: authoritative defaults, then file, then --param ---
    # Cast every value to the param's DECLARED type (int/float/bool).
    # PhraseTransform.apply does no coercion and silently drops unknown
    # keys, so a stringy "0.5" reaches the transform as text and a wrong
    # key vanishes into the default — both invisible failures. Casting by
    # spec type here makes the bridge robust to string-typed CLI args and
    # to UI JSON that may arrive as strings.
    spec_params = spec.params or {}

    def _cast(pkey, value):
        sp = spec_params.get(pkey)
        t = getattr(sp, "type", None) if sp else None
        try:
            if t == "int":
                return int(round(float(value)))
            if t == "float":
                return float(value)
            if t == "bool":
                return str(value).strip().lower() in ("1", "true", "yes", "on")
        except (TypeError, ValueError):
            pass
        return _coerce(value) if isinstance(value, str) else value

    params = {k: p.default for k, p in spec_params.items()}
    if args.params_json:
        for k, v in _load_json_arg(args.params_json).items():
            params[k] = _cast(k, v)
    for kv in (args.param or []):
        if "=" not in kv:
            raise ValueError(f"--param must be key=value, got: {kv!r}")
        k, v = kv.split("=", 1)
        k = k.strip()
        params[k] = _cast(k, v.strip())

    # --- apply each span on a working copy ---
    result = copy.deepcopy(actions)
    per_span = []
    for start, end in spans:
        slice_ = copy.deepcopy([a for a in result if start <= a["at"] <= end])
        transformed = [_clamp_action(a) for a in spec.apply(slice_, params)]
        per_span.append({"start_ms": start, "end_ms": end, "actions": transformed})
        if spec.structural:
            # Structural transforms can retime/drop actions — replace the
            # whole window with the new actions.
            result = [a for a in result if not (start <= a["at"] <= end)]
            result = sorted(result + transformed, key=lambda a: a["at"])
        else:
            t_map = {a["at"]: a["pos"] for a in transformed}
            for a in result:
                if a["at"] in t_map:
                    a["pos"] = t_map[a["at"]]

    if args.preview:
        json.dump({"transform": key, "params": params, "spans": per_span}, sys.stdout)
        sys.stdout.write("\n")
        return

    merged = [_clamp_action(a) for a in result]

    if args.emit_actions:
        # Full merged list for the editor's in-memory roll-forward (Apply).
        # Same merge as the file-write path below — just returned instead of
        # written, so session state and a later chain-write stay identical.
        json.dump({"transform": key, "params": params, "actions": merged}, sys.stdout)
        sys.stdout.write("\n")
        return

    data["actions"] = merged
    output = args.output or _default_path(args.funscript, "_transform_applied.funscript")
    with open(output, "w") as f:
        json.dump(data, f, indent=2)
    print(json.dumps({"saved": output, "transform": key, "spans": len(spans)}))


@_cli_command
def cmd_finalize(args):
    """Apply blend_seams + final_smooth to the full action list, then save."""
    with open(args.funscript) as f:
        data = json.load(f)

    result = copy.deepcopy(data["actions"])

    seam_spec   = TRANSFORM_CATALOG["blend_seams"]
    smooth_spec = TRANSFORM_CATALOG["final_smooth"]

    # Build optional param overrides from --param seam_* / smooth_* prefixes
    seam_params   = {}
    smooth_params = {}
    for kv in (args.param or []):
        if "=" not in kv:
            print(f"Error: --param must be key=value, got: {kv!r}")
            sys.exit(1)
        k, v = kv.split("=", 1)
        k = k.strip()
        val = _coerce(v.strip())
        if k.startswith("seam_"):
            seam_params[k[5:]] = val
        elif k.startswith("smooth_"):
            smooth_params[k[7:]] = val
        else:
            print(f"Error: --param key must start with seam_ or smooth_, got: {k!r}")
            sys.exit(1)

    if not args.skip_seams:
        result = seam_spec.apply(result, seam_params or None)
        print(f"Applied blend_seams  (max_velocity={seam_spec.params['max_velocity'].default if not seam_params else seam_params.get('max_velocity', seam_spec.params['max_velocity'].default)}, "
              f"max_strength={seam_params.get('max_strength', seam_spec.params['max_strength'].default)})")

    if not args.skip_smooth:
        result = smooth_spec.apply(result, smooth_params or None)
        print(f"Applied final_smooth (strength={smooth_params.get('strength', smooth_spec.params['strength'].default)})")

    data["actions"] = result
    output = args.output or _default_path(args.funscript, "_finalized.funscript")
    with open(output, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nSaved: {output}")


def _export_finalize(actions: list, *, blend: bool, smooth: bool) -> list:
    """Apply the same finalize passes as `cmd_finalize` (blend_seams +
    final_smooth) to a copy of `actions`. Used by Export's main-funscript
    write-through so the bundled motion track matches what `finalize` produces."""
    result = copy.deepcopy(actions)
    if blend:
        result = TRANSFORM_CATALOG["blend_seams"].apply(result, None)
    if smooth:
        result = TRANSFORM_CATALOG["final_smooth"].apply(result, None)
    return result


def _estim_seam_windows(funscript_path: str) -> list[tuple]:
    """`(lo_ms, hi_ms, character_id)` per chapter — the seam-matching view of
    the Channels authoring.

    Mirrors the window construction in `_polish_generate_estim`, but reads only
    the sidecars: the STAMPED station files were generated in a previous
    session and we need their chapter boundaries after the fact. Returns []
    when there are no chapters (nothing to match across).
    """
    from forge.channels_defaults import default_character_for
    from videoflow.sidecar import forge_dir

    stem = Path(funscript_path).stem
    chap_path = forge_dir(funscript_path) / f"{stem}.chapters.json"
    chapters = []
    if chap_path.exists():
        try:
            chapters = json.loads(chap_path.read_text(encoding="utf-8")).get("chapters") or []
        except (OSError, json.JSONDecodeError):
            chapters = []
    if not chapters:
        return []

    chars_doc = {}
    cp = _characters_path(funscript_path)
    if cp.exists():
        try:
            chars_doc = json.loads(cp.read_text(encoding="utf-8")).get("characters") or {}
        except (OSError, json.JSONDecodeError):
            chars_doc = {}

    n = len(chapters)
    windows = []
    for i, ch in enumerate(chapters):
        # Positional `ch{i+1}` ids, same convention characters.json keys by.
        assign = chars_doc.get(f"ch{i + 1}") or {}
        windows.append((
            ch.get("at_ms", ch.get("atMs", ch.get("start_ms"))),
            ch.get("end_ms", ch.get("endMs")),
            assign.get("characterId") or default_character_for(i, n),
        ))
    return windows


def _collect_events_yaml(target) -> str | None:
    """Render a fresh playable Edger `events.yml` body from `<stem>.feel.yml`.

    Returns the YAML text, or None when there are no real events. Lean variant
    of `cmd_edger_export`'s render (no reconciliation comments — the bundle
    just needs a valid events file)."""
    import yaml
    feel = _feel_path(target)
    if not feel.exists():
        return None
    try:
        doc = yaml.safe_load(feel.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return None
    events = (doc.get("events") or []) if isinstance(doc, dict) else []
    edger = [
        _canonical_to_edger(e) for e in events
        if e.get("effect") and e.get("effect") != "normal"
    ]
    if not edger:
        return None
    edger.sort(key=lambda x: x["time"])
    return yaml.safe_dump({"events": edger}, sort_keys=False, allow_unicode=True)


def _render_waveform_png(actions: list, out_path: Path, width: int = 480, height: int = 140) -> bool:
    """Render a compact MiniWave-style funscript curve PNG (library-card image).
    Pure matplotlib (Agg backend, headless). Returns False on any failure.

    DEPRECATED (2026-06-15): scheduled for removal. Export previews must be
    rendered by the funscript video player's EXACT canvas code (forgemoment
    funscript chart), not this separate matplotlib path, so they can't drift
    from what the editor shows. Do not extend. See project_funscriptforge_pending
    "Export — Preview images should be COPIES OF THE APP'S VIDEO-EDITOR VIEWS"."""
    if not actions:
        return False
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return False
    try:
        t = [a["at"] for a in actions]
        p = [a["pos"] for a in actions]
        fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100)
        fig.patch.set_facecolor("#0e1117")
        ax.set_facecolor("#0e1117")
        ax.fill_between(t, p, 0, color="#4dabf7", alpha=0.18, linewidth=0)
        ax.plot(t, p, color="#4dabf7", linewidth=0.8)
        ax.set_ylim(-2, 102)
        ax.margins(x=0)
        ax.axis("off")
        fig.tight_layout(pad=0)
        fig.savefig(out_path, dpi=100, facecolor=fig.get_facecolor())
        plt.close(fig)
        return out_path.exists()
    except Exception as exc:
        print(f"waveform.png skipped: {exc}", file=sys.stderr)
        return False


def _render_audio_png(audio_json_path: Path, out_path: Path, width: int = 480, height: int = 140) -> bool:
    """Render the audio peak envelope (from `<stem>.audio.json`) as a PNG.
    Media-free — reads the cached RMS-per-hop peaks sidecar. False on failure.

    DEPRECATED (2026-06-15): scheduled for removal — to be replaced by the
    funscript video player's EXACT WaveformCanvas render (crude unipolar
    matplotlib envelope here vs the player's real waveform). Do not extend.
    See project_funscriptforge_pending (export-previews-from-app note)."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        doc = json.loads(Path(audio_json_path).read_text(encoding="utf-8"))
        peaks = doc.get("peaks") or []
        if not peaks:
            return False
        # Downsample to ~width bars (peak-per-bucket) for a compact card image.
        n = len(peaks)
        step = max(1, n // width)
        env = [max(peaks[i:i + step]) for i in range(0, n, step)]
        x = list(range(len(env)))
        fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100)
        fig.patch.set_facecolor("#0e1117")
        ax.set_facecolor("#0e1117")
        ax.fill_between(x, env, 0, color="#ffa94d", alpha=0.65, linewidth=0)
        ax.set_ylim(0, 1.02)
        ax.margins(x=0)
        ax.axis("off")
        fig.tight_layout(pad=0)
        fig.savefig(out_path, dpi=100, facecolor=fig.get_facecolor())
        plt.close(fig)
        return out_path.exists()
    except Exception as exc:
        print(f"audio.png skipped: {exc}", file=sys.stderr)
        return False


def _render_spectrogram_png(spectro_json_path: Path, out_path: Path, width: int = 480, height: int = 140) -> bool:
    """Render the mel spectrogram (from `<stem>.spectrogram.json` int8 cells) as
    a magma PNG, low frequencies at the bottom. Media-free. False on failure.

    DEPRECATED (2026-06-15): scheduled for removal — to be replaced by the
    funscript video player's EXACT SpectrogramCanvas render. Do not extend.
    See project_funscriptforge_pending (export-previews-from-app note)."""
    try:
        import base64
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        doc = json.loads(Path(spectro_json_path).read_text(encoding="utf-8"))
        b64 = doc.get("cells_b64")
        n_mels = int(doc.get("n_mels") or 0)
        if not b64 or n_mels <= 0:
            return False
        raw = np.frombuffer(base64.b64decode(b64), dtype=np.int8).astype(np.float32)
        n_frames = raw.size // n_mels
        if n_frames == 0:
            return False
        cells = raw[: n_frames * n_mels].reshape(n_frames, n_mels).T  # (n_mels, n_frames)
        fig, ax = plt.subplots(figsize=(width / 100, height / 100), dpi=100)
        fig.patch.set_facecolor("#0e1117")
        ax.imshow(cells, aspect="auto", origin="lower", cmap="magma", interpolation="nearest")
        ax.axis("off")
        fig.tight_layout(pad=0)
        fig.savefig(out_path, dpi=100, facecolor=fig.get_facecolor())
        plt.close(fig)
        return out_path.exists()
    except Exception as exc:
        print(f"spectrogram.png skipped: {exc}", file=sys.stderr)
        return False


def _assessment_summary(funscript_path):
    """Best-effort auto-metadata (pace / intensity / depth / mood / arc / variety
    / tags) for the bundle manifest — makes the .forge self-describing for
    library cards, sharing, the assembler, and cloud destinations. Recomputed
    cheap from the funscript (no media); None on any failure."""
    try:
        from forge.metadata import derive_metadata
        from assessment.analyzer import FunscriptAnalyzer
        analyzer = FunscriptAnalyzer(config=AnalyzerConfig())
        analyzer.load(str(funscript_path))
        result = analyzer.analyze()
        stats = result.to_stats_dict() if hasattr(result, "to_stats_dict") else {}
        phrases = [p if isinstance(p, dict) else p.to_dict() for p in result.phrases]
        return derive_metadata(stats, phrases)
    except Exception as exc:
        print(f"assessment summary skipped: {exc}", file=sys.stderr)
        return None


def _render_stim_audio(alpha: Path, beta: Path, out_path: Path, duration_s: float,
                       fmt: str = "wav") -> bool:
    """Render the stamped e-stim alpha/beta channels to a stereo audio file via
    the existing audio-synthesis engine (pulse waveform, the common device
    default). WAV by default; ``fmt="mp3"`` transcodes via ffmpeg (libsndfile
    here lacks MPEG write). WAV and mp3 are both standard for audio e-stim in
    practice. Returns False on any failure."""
    try:
        from forge.audio_synthesis import render_stereo_audio
        if fmt == "mp3":
            import shutil
            import subprocess
            tmp_wav = out_path.with_suffix(".stim.tmp.wav")
            render_stereo_audio(str(alpha), str(beta), str(tmp_wav), duration_s, waveform="pulse")
            if not shutil.which("ffmpeg"):
                print("mp3 requested but ffmpeg missing — kept WAV", file=sys.stderr)
                tmp_wav.replace(out_path.with_suffix(".wav"))
                return out_path.with_suffix(".wav").exists()
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(tmp_wav), "-codec:a", "libmp3lame",
                 "-b:a", "192k", str(out_path)],
                capture_output=True, timeout=600,
            )
            tmp_wav.unlink(missing_ok=True)
        else:
            render_stereo_audio(str(alpha), str(beta), str(out_path), duration_s, waveform="pulse")
        return out_path.exists()
    except Exception as exc:
        print(f"stim audio skipped: {exc}", file=sys.stderr)
        return False


def _synth_click_track(beats, duration_s: float, downbeats=None, sr: int = 44100):
    """Build a mono click-track waveform: a short percussive tick at each beat
    timestamp, downbeats accented (higher pitch + louder).

    Pure synthesis — needs ONLY the beat timestamps (ms), so the persisted
    ``<stem>.beatmap.json`` alone drives it (no librosa, no media). Returns a
    float32 numpy array of length ``duration_s * sr``."""
    import numpy as np
    n = max(1, int(duration_s * sr))
    out = np.zeros(n, dtype=np.float32)
    down = {int(d) for d in (downbeats or [])}

    def _click(freq: float, amp: float, dur_ms: float = 35.0):
        # Short exponentially-decaying sine — a clean, percussive metronome tick.
        ln = max(1, int(sr * dur_ms / 1000.0))
        t = np.arange(ln) / sr
        env = np.exp(-t * 60.0)
        return (amp * np.sin(2 * np.pi * freq * t) * env).astype(np.float32)

    reg = _click(1000.0, 0.6)
    acc = _click(1600.0, 0.9)
    for b in beats:
        i = int(int(b) / 1000.0 * sr)
        if i < 0 or i >= n:
            continue
        clip = acc if int(b) in down else reg
        end = min(n, i + len(clip))
        out[i:end] += clip[: end - i]
    np.clip(out, -1.0, 1.0, out=out)
    return out


def _render_beat_audio(beats, duration_s: float, out_path: Path,
                       downbeats=None, fmt: str = "mp3", sr: int = 44100) -> bool:
    """Render a click-track audio file (one tick per beat, accented downbeats)
    from beat timestamps. mp3 by default (small + shareable); ``fmt="wav"`` for
    the lossless original.

    Reusable beat-renderer: export ``beat.mp3``, an optional audible click in
    the viewer, and the prep tool's beat-file output all call this. False on any
    failure (never aborts the export)."""
    try:
        import soundfile as sf
        wave = _synth_click_track(beats, duration_s, downbeats=downbeats, sr=sr)
        if fmt == "mp3":
            import shutil
            import subprocess
            tmp_wav = out_path.with_suffix(".beat.tmp.wav")
            sf.write(str(tmp_wav), wave, sr)
            if not shutil.which("ffmpeg"):
                print("beat mp3 requested but ffmpeg missing — kept WAV", file=sys.stderr)
                tmp_wav.replace(out_path.with_suffix(".wav"))
                return out_path.with_suffix(".wav").exists()
            # A click track is mostly silence with sparse ticks — mono, a low
            # sample rate, and VBR keep a full-length track small (a metronome
            # needs no fidelity above ~11 kHz).
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(tmp_wav), "-ac", "1", "-ar", "22050",
                 "-codec:a", "libmp3lame", "-q:a", "7", str(out_path)],
                capture_output=True, timeout=600,
            )
            tmp_wav.unlink(missing_ok=True)
        else:
            sf.write(str(out_path), wave, sr)
        return out_path.exists()
    except Exception as exc:
        print(f"beat audio skipped: {exc}", file=sys.stderr)
        return False


def _extract_frame(media: str, t_ms: int, out_path: Path) -> bool:
    """Grab a single 320px-wide frame at `t_ms` via ffmpeg. Returns False when
    ffmpeg is absent or the grab fails."""
    import shutil
    import subprocess
    if not shutil.which("ffmpeg"):
        return False
    t = max(0, int(t_ms)) / 1000.0
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", str(media),
             "-frames:v", "1", "-vf", "scale=320:-1", str(out_path)],
            capture_output=True, timeout=30,
        )
        return out_path.exists()
    except Exception as exc:
        print(f"frame at {t_ms}ms skipped: {exc}", file=sys.stderr)
        return False


def _frame_brightness(path) -> float:
    """Mean luma 0..255 of a PNG (0 = black). Used to reject black hero frames.
    Returns 255 (don't-reject) when it can't measure."""
    try:
        from PIL import Image
        import numpy as np
        return float(np.asarray(Image.open(path).convert("L")).mean())
    except Exception:
        return 255.0


def _extract_hero_frame(media: str, start_ms: int, end_ms: int, out_path: Path) -> bool:
    """Pick a REPRESENTATIVE, non-black hero frame from [start_ms, end_ms].

    The old behavior grabbed the frame at the chapter's exact start — which is
    where cuts/fades/black live, so heroes came out black. Instead: (1) run
    ffmpeg's `thumbnail` filter over a content window seeked a bit past the cut
    (it favors a content frame over uniform/black ones), and accept it only if
    it's not near-black; (2) fall back to sampling a few points across the span
    and keeping the brightest. Face-preference is a future stretch. False on
    failure / no ffmpeg.
    """
    import shutil
    import subprocess
    if not shutil.which("ffmpeg"):
        return False
    span = max(1000, int(end_ms) - int(start_ms))
    base = max(0, int(start_ms))

    # 1) thumbnail over a window that skips the opening fade.
    seek = (base + min(int(span * 0.15), 8000)) / 1000.0
    window_s = min(max(span / 1000.0 * 0.5, 4.0), 20.0)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{seek:.3f}", "-t", f"{window_s:.1f}",
             "-i", str(media), "-frames:v", "1",
             "-vf", "thumbnail=120,scale=320:-1", str(out_path)],
            capture_output=True, timeout=60,
        )
        if out_path.exists() and _frame_brightness(out_path) > 12.0:
            return True
    except Exception as exc:
        print(f"hero thumbnail skipped: {exc}", file=sys.stderr)

    # 2) Fallback: sample across the span, keep the brightest (non-black) grab.
    best_b = -1.0
    for frac in (0.25, 0.45, 0.65, 0.85):
        cand = out_path.with_name(out_path.stem + f".c{int(frac * 100)}.png")
        if _extract_frame(str(media), base + int(span * frac), cand):
            b = _frame_brightness(cand)
            if b > best_b:
                best_b = b
                cand.replace(out_path)
            else:
                cand.unlink(missing_ok=True)
    return best_b > 0.0 and out_path.exists()


_PROBE_VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"}
_PROBE_AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}


def _media_kind(media: str) -> str:
    """'video' | 'audio' | 'unknown' from the extension (mirrors the Rust
    classifier in commands.rs)."""
    ext = Path(media).suffix.lower()
    if ext in _PROBE_VIDEO_EXTS:
        return "video"
    if ext in _PROBE_AUDIO_EXTS:
        return "audio"
    return "unknown"


def _probe_media_dict(media: str) -> dict:
    """Probe a raw media file with ffprobe → duration_ms + (video) dimensions.

    Returns ``{ok, media, kind, duration_ms, width, height, fps}``. Best-effort:
    when ffprobe is missing or the file won't parse, duration_ms is 0 and
    width/height/fps are None — the caller still gets the kind from the
    extension so a video-only project can open with a placeholder duration.
    """
    import shutil
    import subprocess
    kind = _media_kind(media)
    out = {"ok": True, "media": media, "kind": kind,
           "duration_ms": 0, "width": None, "height": None, "fps": None,
           # direct_playable: True when the source can stream straight into
           # WebView2's <video> via asset:// WITHOUT a per-chapter re-encode —
           # the single-file-streaming fast path. None until probed; False with
           # `playable_reasons` listing what disqualified it (→ fall back to
           # chapter-clip extraction). codec_name/pix_fmt/profile/fps_mode are
           # surfaced so the caller (and logs) can see why.
           "direct_playable": None, "playable_reasons": [],
           "codec_name": None, "pix_fmt": None, "profile": None,
           "fps_mode": None}
    if not shutil.which("ffprobe"):
        out["ok"] = False
        out["reason"] = "ffprobe-missing"
        return out
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", str(media)],
            capture_output=True, timeout=30, text=True,
        )
        data = json.loads(proc.stdout or "{}")
    except Exception as exc:  # noqa: BLE001 — probe is best-effort
        out["ok"] = False
        out["reason"] = f"probe-failed: {exc}"
        return out

    fmt = data.get("format") or {}
    try:
        out["duration_ms"] = int(round(float(fmt.get("duration", 0)) * 1000))
    except (TypeError, ValueError):
        out["duration_ms"] = 0

    for st in data.get("streams") or []:
        if st.get("codec_type") == "video":
            out["width"] = st.get("width")
            out["height"] = st.get("height")
            rate = st.get("avg_frame_rate") or st.get("r_frame_rate") or "0/0"
            try:
                num, _, den = rate.partition("/")
                den_f = float(den) if den else 0.0
                out["fps"] = round(float(num) / den_f, 3) if den_f else None
            except (TypeError, ValueError):
                out["fps"] = None
            _verdict_direct_playable(out, st)
            break
    return out


def _fps_to_float(fr: str) -> float:
    """Parse an ffprobe frame-rate ('30/1', '2080658801/69461181', '29.97') to
    float; 0.0 on anything unparseable or a zero denominator."""
    try:
        if "/" in fr:
            n, d = fr.split("/", 1)
            d = float(d)
            return float(n) / d if d else 0.0
        return float(fr)
    except (ValueError, ZeroDivisionError):
        return 0.0


# Near-CFR tolerance: HandBrake / x264 report avg_frame_rate a hair below the
# nominal r_frame_rate (avg = frames ÷ duration), e.g. 29.955 vs 30 — that's
# effectively CFR and plays fine. True VFR (screen caps, phone video) diverges
# far more. 1% of nominal keeps real VFR on the clip path.
_CFR_FPS_TOLERANCE = 0.01


def _is_cfr(avg: str, rrate: str) -> bool:
    a, r = _fps_to_float(avg), _fps_to_float(rrate)
    return a > 0 and r > 0 and abs(a - r) <= _CFR_FPS_TOLERANCE * r


# Widest source WebView2 is trusted to stream raw. Above this we pre-extract
# 720p chapter clips instead. Mirrored in videoflow chapter_clips.py — the two
# must agree or analysis and playback disagree about whether clips exist.
#
# 2560 covers 1440p / 2.5K (2520 and 2560 wide sources both qualify); 4K (3840)
# and up still clip. This is the ONE value to change if 1440p playback turns out
# to stutter or OOM in the live test — drop it back to 1920 and the old
# behaviour returns exactly.
DIRECT_PLAY_MAX_WIDTH = 2560


def _verdict_direct_playable(out: dict, st: dict) -> None:
    """Decide whether a video stream can stream straight into WebView2's
    <video> via asset:// without a normalizing re-encode — the single-file
    streaming fast path.

    The per-chapter clip pipeline exists because long high-bitrate / 4K / VFR
    / exotic-profile sources STUTTER or OOM the embedded Chromium decoder (see
    chapter_clips.py FFMPEG_CLIP_ARGS). So we only direct-play sources we're
    confident WebView2 handles cleanly; anything else falls back to clips.
    Conservative by design — a false "not playable" just costs a clip; a false
    "playable" costs the user a stuttering preview.

    Mutates *out*: sets ``direct_playable`` (bool) + ``playable_reasons`` (the
    disqualifiers, empty when playable) + the surfaced codec_name/pix_fmt/
    profile/fps_mode.
    """
    reasons: list[str] = []
    codec = (st.get("codec_name") or "").lower()
    pix_fmt = (st.get("pix_fmt") or "").lower()
    profile = (st.get("profile") or "")
    width = st.get("width") or 0
    transfer = (st.get("color_transfer") or "").lower()
    primaries = (st.get("color_primaries") or "").lower()
    avg = st.get("avg_frame_rate") or ""
    rrate = st.get("r_frame_rate") or ""
    out["codec_name"] = codec or None
    out["pix_fmt"] = pix_fmt or None
    out["profile"] = profile or None
    # VFR is the primary stutter trigger; CFR has avg ≈ r frame rate (within a
    # small tolerance — HandBrake reports avg a touch below nominal).
    fps_mode = "cfr" if _is_cfr(avg, rrate) else "vfr"
    out["fps_mode"] = fps_mode

    # H.264 is what WebView2 plays cleanly. HEVC/AV1/VP9 vary by platform.
    if codec != "h264":
        reasons.append(f"codec:{codec or 'unknown'}")
    # 8-bit 4:2:0 only. 10-bit / 4:2:2 / 4:4:4 stutter or won't decode.
    if pix_fmt and pix_fmt != "yuv420p":
        reasons.append(f"pix_fmt:{pix_fmt}")
    # High 10 / 4:2:2 / 4:4:4 profiles imply >8-bit or chroma the decoder chokes on.
    if any(tok in profile.lower() for tok in ("10", "422", "444")):
        reasons.append(f"profile:{profile}")
    # Raw decode is the heaviest op and 4K is where WebView2 hits the blob/OOM
    # cliff, so wide sources fall back to pre-extracted 720p chapter clips.
    #
    # The gate was 1920 (≤1080p). Raised to 2560 so 1440p / 2.5K sources stream
    # directly instead of paying a full transcode per chapter: on a 2560×1440
    # source that was minutes of silent ffmpeg per analysis (D32), and skipping
    # extraction is the only change that takes it to zero — encoding faster
    # does not. 1440p is ~2.4× 1080p's pixels where 4K is ~4×, so it sits on
    # the near side of the cliff the original gate was drawn against; true 4K
    # (3840) and up still clip. MIRROR: videoflow chapter_clips.is_direct_playable.
    if width and width > DIRECT_PLAY_MAX_WIDTH:
        reasons.append(f"width:{width}")
    # HDR (BT.2020 / PQ / HLG) needs tone-mapping; SDR BT.709 only.
    if transfer in ("smpte2084", "arib-std-b67") or primaries == "bt2020":
        reasons.append(f"hdr:{transfer or primaries}")
    # Variable frame rate — the dominant long-source stutter cause.
    if fps_mode == "vfr":
        reasons.append("vfr")

    out["playable_reasons"] = reasons
    out["direct_playable"] = (len(reasons) == 0)


@_cli_command
def cmd_probe_media(args):
    """Probe a raw video/audio file for duration + dimensions (ffprobe).

    The lightweight metadata a VIDEO-ONLY project needs to open before any
    funscript exists (cmd_meta needs a funscript; this needs only the media).
    """
    print(json.dumps(_probe_media_dict(args.media)))


def _contact_sheet_dir(media: str) -> Path:
    """`<dir>/.<stem>.forge/<stem>.thumbs/` — cached contact-sheet frames."""
    from videoflow.sidecar import forge_dir
    return forge_dir(media) / f"{Path(media).stem}.thumbs"


@_cli_command
def cmd_contact_sheet(args):
    """Extract N evenly-spaced frames from a video → cached contact sheet.

    The video-only Project page renders these as a 3×N grid ("what's in this
    video, across its length"). Frames are sampled at the CENTRE of each of N
    equal slices (so none lands on the opening/closing black), written 320px
    wide into the forge dir, and reused on the next open unless ``--force``.
    Audio files have no frames — returns ``{ok:false, reason:'audio'}``.
    """
    media = args.media
    if _media_kind(media) != "video":
        print(json.dumps({"ok": False, "reason": "audio", "thumbs": []}))
        return

    count = max(1, min(int(args.count), 24))
    duration_ms = int(args.duration_ms) if args.duration_ms else _probe_media_dict(media)["duration_ms"]
    if duration_ms <= 0:
        print(json.dumps({"ok": False, "reason": "no-duration", "thumbs": []}))
        return

    sheet_dir = _contact_sheet_dir(media)
    sheet_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(media).stem
    thumbs = []
    for i in range(count):
        # centre of slice i — avoids the first/last frame (cuts/black/credits)
        t_ms = int(duration_ms * (i + 0.5) / count)
        out_path = sheet_dir / f"{stem}.thumb.{count:02d}.{i:02d}.jpg"
        if out_path.exists() and not args.force:
            thumbs.append({"index": i, "at_ms": t_ms, "path": str(out_path)})
            continue
        if _extract_frame(media, t_ms, out_path):
            thumbs.append({"index": i, "at_ms": t_ms, "path": str(out_path)})

    # Publish one frame as the project's cover at `<forge_dir>/thumb.jpg`.
    # The Library scanner already looks for exactly that path and already
    # surfaces it as `project.thumbPath`; nothing had ever written it, so every
    # card fell back to the film icon. Costs one file copy over frames we just
    # generated anyway — no extra ffmpeg work, and no thumb appears until a
    # project has actually been opened far enough to build its contact sheet.
    if thumbs:
        try:
            import shutil
            from videoflow.sidecar import forge_dir as _forge_dir
            # A middle frame: openings are titles or black far more often than
            # the middle of a scene is.
            cover_src = Path(thumbs[len(thumbs) // 2]["path"])
            cover_dst = _forge_dir(media) / "thumb.jpg"
            if cover_src.exists() and (args.force or not cover_dst.exists()):
                cover_dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(cover_src, cover_dst)
        except Exception as exc:  # cover art is never worth failing the sheet
            print(f"library cover thumb skipped: {exc}", file=sys.stderr)

    print(json.dumps({
        "ok": bool(thumbs),
        "media": media,
        "count": len(thumbs),
        "requested": count,
        "duration_ms": duration_ms,
        "thumbs": thumbs,
    }))


def _next_available_path(base: Path) -> Path:
    """Return `base` if free, else the first non-colliding ` (N)` sibling —
    Explorer-style. Works for both a file (`scene.forge` → `scene (1).forge`,
    extension preserved) and a folder (`scene_export` → `scene_export (1)`). The
    rule across Export + Import: never overwrite, always version up. The working
    folder is the source of truth; bundles are immutable snapshots, so a new
    export is a new snapshot, not a clobber of the last one.
    """
    if not base.exists():
        return base
    # Files version inside the extension (scene.forge -> scene (1).forge);
    # directories version the whole name (scene.output -> scene.output (1)),
    # since a folder's trailing ".output" is identity, not an extension.
    if base.is_dir():
        suffix, stem = "", base.name
    else:
        suffix = base.suffix
        stem = base.name[:-len(suffix)] if suffix else base.name
    n = 1
    while True:
        cand = base.parent / f"{stem} ({n}){suffix}"
        if not cand.exists():
            return cand
        n += 1


_PROVENANCE_VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"}


def _media_provenance(media_path: Path) -> dict:
    """A cheap, robust relink key for a media file: name + size + a hash of the
    first 1 MiB (fast even on multi-GB video). Stamped into the bundle manifest
    so a consumer (e.g. forgeassembler) can relink to the original on disk
    without the bundle embedding gigabytes of video."""
    import hashlib
    st = media_path.stat()
    h = hashlib.sha256()
    with open(media_path, "rb") as f:
        h.update(f.read(1024 * 1024))
    return {
        "filename": media_path.name,
        "size": st.st_size,
        "head_sha256": h.hexdigest(),
        "kind": "video" if media_path.suffix.lower() in _PROVENANCE_VIDEO_EXTS else "audio",
    }


def _project_identity_path(target) -> Path:
    """`<dir>/.<stem>.forge/<stem>.project.json` — the stable lineage marker for
    a working project: `{project_id, version}`. Lives in the working folder (the
    source of truth) so it persists across re-exports; bundles carry a *copy* of
    the identity in their manifest, not this file."""
    from videoflow.sidecar import forge_dir
    stem = Path(target).stem
    return forge_dir(target) / f"{stem}.project.json"


def _read_project_identity(target) -> dict:
    """Load `{project_id, version}` for a working project, or `{}` if unset."""
    p = _project_identity_path(target)
    if p.exists():
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(doc, dict) and doc.get("project_id"):
                return {"project_id": doc["project_id"], "version": int(doc.get("version", 0))}
        except (OSError, json.JSONDecodeError, ValueError, TypeError):
            pass
    return {}


def _write_project_identity(target, ident: dict) -> None:
    p = _project_identity_path(target)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ident, indent=2), encoding="utf-8")


# Loose-output organization: device/player-named folders, so a user opening
# `<stem>.output/` finds files by what they OWN, not by file type. The .forge
# bundle keeps the flat machine layout (stations/<id>/) that import + the
# assembler read; this human view is loose-mode only.
_STATION_FOLDER = {
    "estim3p": "E-Stim", "focstim": "FOC-Stim", "focstim4p": "FOC-Stim 4-phase",
    "handy": "Handy", "tcode": "MultiFunPlayer",
    "osr2": "OSR2", "sr6": "SR6", "lovense": "Lovense", "vacuglide": "Vacuglide",
}
_STATION_PURPOSE = {
    "estim3p": "E-stim channel set — load in restim or ForgePlayer.",
    "focstim": "E-stim channel set clamped for FOC-Stim (direct current control) — load in restim. Experimental: the device limits are unverified.",
    "focstim4p": "FOC-Stim 4-phase: four per-electrode power channels (e1–e4) — load in restim with a 4-phase device. Experimental: unverified on hardware.",
    "handy": "Clamped stroke script tuned for The Handy.",
    "tcode": "Multi-axis set — point MultiFunPlayer or XTPlayer at this folder (it auto-detects the axes).",
    "osr2": "T-code multi-axis set for the OSR2.",
    "sr6": "T-code multi-axis set for the SR6.",
    "lovense": "Clamped script for Lovense devices.",
    "vacuglide": "Clamped stroke script for Vacuglide / Autoblow.",
}


def _render_output_readme(stem: str, placed: list, manifest: dict) -> str:
    """Plain-English index for the loose output folder — 'grab this for your
    device'. Generated from what was actually placed, so it never lies."""
    L = [f"{stem} — FunscriptForge output", "=" * 44, "",
         "Grab the files for your device or player:", ""]
    for label, names, purpose in placed:
        L.append(f"  {'(this folder)' if label == '.' else label + '/'}")
        L.append(f"      {purpose}")
        for n in names:
            L.append(f"        - {n}")
        L.append("")
    media = manifest.get("media") or {}
    if media and not media.get("bundled"):
        L.append(f"Source video/audio: {media.get('filename')} — NOT included here. Keep it")
        L.append("next to these files for players that need the video.")
        L.append("")
    L.append("To keep editing this scene, open the sibling .forge bundle in")
    L.append("FunscriptForge — it's the complete, re-editable backup.")
    # Plain .txt for any viewer: normalize em-dashes to ASCII so old Windows
    # editors don't render mojibake (only touches the dash, not e.g. stem text).
    return ("\n".join(L) + "\n").replace("—", "-")


def _emit_loose_output(staging: Path, out: Path, stem: str, manifest: dict) -> None:
    """Reorganize the staged machine tree into a human-findable output folder:
    the universal stroke at top, one folder per device/player, previews, and a
    generated README. Playables only — re-edit metadata + the full bundle live
    in the .forge backup."""
    from forge import polish as _polish_mod
    import shutil
    out.mkdir(parents=True, exist_ok=True)
    placed = []  # (folder_label, [filenames], purpose) — drives the README

    motion = staging / "motion.funscript"
    if motion.exists():
        shutil.copy2(motion, out / f"{stem}.funscript")
        placed.append((".", [f"{stem}.funscript"],
                       "Universal stroke script — works with most 1-axis players."))

    audio_dir = staging / "audio"
    stations_dir = staging / "stations"
    if stations_dir.is_dir():
        for sdir in sorted(p for p in stations_dir.iterdir() if p.is_dir()):
            sid = sdir.name
            files = sorted(sdir.glob("*"))
            if not files:
                continue
            label = _STATION_FOLDER.get(sid, sid.replace("_", " ").title())
            dst = out / label
            dst.mkdir(parents=True, exist_ok=True)
            names = []
            for fp in files:
                shutil.copy2(fp, dst / fp.name)
                names.append(fp.name)
            if _polish_mod.is_estim_station(sid) and audio_dir.is_dir():  # stim audio rides with the channels
                for ap in sorted(audio_dir.glob("*")):
                    shutil.copy2(ap, dst / ap.name)
                    names.append(ap.name)
            placed.append((label, names, _STATION_PURPOSE.get(sid, f"Files for {label}.")))

    ev = staging / "events.yml"
    if ev.exists():
        d = out / "Edger"
        d.mkdir(exist_ok=True)
        shutil.copy2(ev, d / f"{stem}.events.yml")
        placed.append(("Edger", [f"{stem}.events.yml"],
                       "Edger event script — load alongside the base script in Edger."))

    thumbs = staging / "thumbnails"
    if thumbs.is_dir():
        names = []
        d = out / "Preview"
        d.mkdir(exist_ok=True)
        for tp in sorted(thumbs.glob("*")):
            shutil.copy2(tp, d / tp.name)
            names.append(tp.name)
        if names:
            placed.append(("Preview", names, "Waveform + frame thumbnails for browsing / sharing."))

    # Self-describing machine map (no re-edit metadata — that stays in .forge).
    mp = staging / "manifest.ffmeta"
    if mp.exists():
        shutil.copy2(mp, out / "manifest.ffmeta")

    (out / "README.txt").write_text(_render_output_readme(stem, placed, manifest), encoding="utf-8")


@_cli_command
def cmd_export(args):
    """Collect the project's outputs into a loose folder or a `.forge` zip.

    Export is a PACKAGER, not a generator: it gathers the effective main
    funscript (optionally finalized), the device-ready files Polish stamped
    (`<forge>/polish/<station>/`, for the `accepted` passes in
    `<stem>.polish.yml`), a fresh `events.yml` (from `<stem>.feel.yml`), the
    authoring sidecars that exist (chapters / phrases / characters json), and
    writes a `manifest.ffmeta` describing it all.

      --mode loose  -> writes the tree into `<out>/` (a folder)
      --mode forge  -> writes `<out>` as a `.forge` zip (single-file deliverable)

    `--out` defaults to `<dir>/<stem>.output/` (loose) or `<dir>/<stem>.forge`
    (forge). Reads the EFFECTIVE funscript (Rust resolves work-else-original).
    """
    import shutil
    import tempfile
    import zipfile
    import yaml
    from videoflow.sidecar import forge_dir
    # Bound here rather than part-way down: the e-stim station checks run
    # before the block that used to own this import, and a skipped block
    # left it unbound.
    from forge import polish as _polish_mod

    # The positional `src` is the ORIGINAL funscript — it owns the stem, the
    # forge dir, the authoring sidecars, and the per-chapter character/style
    # assignments the generators read. `--effective` (when present) is the
    # edited work funscript we pack as the *motion* track. Deriving the stem
    # from `src` (not the work path) keeps sidecar/channel filenames correct.
    src = args.funscript
    motion_src = args.effective or src
    stem = args.stem or Path(src).stem
    fdir = forge_dir(src)

    # Target groups the user unchecked in the Export UI ("what's in the bundle").
    # strokers = motion.funscript + non-estim device stations (handy/lovense/
    # vacuglide/tcode); estim = the 9-channel estim3p set + stim audio;
    # authoring = sidecars + events.yml; preview = thumbnails. Default empty =
    # include everything (back-compat).
    excluded = {t.strip() for t in (args.exclude or "").split(",") if t.strip()}
    inc_strokers = "strokers" not in excluded
    inc_estim = "estim" not in excluded
    inc_authoring = "authoring" not in excluded
    inc_preview = "preview" not in excluded
    # A device station maps to the e-stim group iff it emits the channel set.
    def _station_included(sid):
        return inc_estim if _polish_mod.is_estim_station(sid) else inc_strokers

    staging = Path(tempfile.mkdtemp(prefix="ff_export_"))
    artifacts: list[dict] = []
    try:
        # 1. Main funscript (+ optional finalize) -> motion.funscript
        _emit_progress("Export — collecting the motion track…")
        with open(motion_src, encoding="utf-8") as f:
            data = json.load(f)
        actions = data.get("actions", [])
        if args.blend_seams or args.final_smooth:
            actions = _export_finalize(actions, blend=args.blend_seams, smooth=args.final_smooth)
        main = dict(data)
        main["actions"] = actions
        duration_ms = actions[-1]["at"] if actions else 0
        # Always read the motion (duration + waveform need it) but only PACK
        # motion.funscript when the Strokers target is kept.
        if inc_strokers:
            (staging / "motion.funscript").write_text(json.dumps(main), encoding="utf-8")
            artifacts.append({"path": "motion.funscript", "kind": "funscript", "role": "stroke", "axis": "L0"})

        # 2. Polish stations (accepted) -> stations/<id>/...
        _emit_progress("Export — gathering stamped device stations…")
        passes = {}
        ppath = _polish_path(src)
        if ppath.exists():
            try:
                pdoc = yaml.safe_load(ppath.read_text(encoding="utf-8")) or {}
                passes = pdoc.get("passes") or {}
            except yaml.YAMLError:
                passes = {}
        polish_root = fdir / "polish"
        stations_meta = {}
        # Built lazily — only a stamped e-stim pass needs them.
        _seam_windows = None
        for sid, p in passes.items():
            if not (isinstance(p, dict) and p.get("accepted")):
                continue
            if not _station_included(sid):
                continue  # target group unchecked in the Export UI
            sdir = polish_root / sid
            if not sdir.is_dir():
                continue
            dest = staging / "stations" / sid
            dest.mkdir(parents=True, exist_ok=True)
            files = []
            for fp in sorted(sdir.glob("*.funscript")):
                # A STAMPED e-stim pass was generated per chapter in an earlier
                # session, so it carries the same V-notch at every seam as a
                # freshly generated one — and copying it verbatim was how the
                # whole feature silently did nothing for anyone who had stamped
                # Polish (dogfood 2026-08-16). Repair on the way into the
                # bundle; the stamped files on disk are left as authored.
                # Derived from SEAM_MATCHED_CHANNELS, never a local list: this
                # was hardcoded to the two volume channels, so when the set
                # broadened to frequency / pulse_frequency / pulse_rise_time
                # those three kept being copied verbatim and the widened fix
                # silently did nothing for them (dogfood 2026-08-16). Longest
                # first so "volume-prostate" wins over "volume".
                from forge.stim_config import SEAM_MATCHED_CHANNELS
                suffix = next((s for s in sorted(SEAM_MATCHED_CHANNELS, key=len, reverse=True)
                               if fp.name.endswith(f".{s}.funscript")), None)
                if (args.match_chapter_volume and _polish_mod.is_estim_station(sid) and suffix):
                    if _seam_windows is None:
                        _seam_windows = _estim_seam_windows(src)
                    if len(_seam_windows) >= 2:
                        from forge.stim_config import match_chapter_seams
                        try:
                            doc = json.loads(fp.read_text(encoding="utf-8"))
                            doc["actions"] = match_chapter_seams(
                                suffix, doc.get("actions") or [], _seam_windows,
                            )
                            (dest / fp.name).write_text(json.dumps(doc), encoding="utf-8")
                        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
                            print(f"seam match skipped for {fp.name}: {exc}", file=sys.stderr)
                            shutil.copy2(fp, dest / fp.name)
                    else:
                        shutil.copy2(fp, dest / fp.name)
                else:
                    shutil.copy2(fp, dest / fp.name)
                artifacts.append({
                    "path": f"stations/{sid}/{fp.name}", "kind": "funscript",
                    "role": "device", "station": sid,
                })
                files.append(fp.name)
            if files:
                stations_meta[sid] = {"files": files, "accepted_at": p.get("accepted_at")}

        # 2b. Auto-generate derived device files from the Channels authoring for
        # any station the user did NOT stamp in Polish — so assigning a
        # character or a Mechanical style still yields files at export
        # ("skip Polish, still get what you authored"). Default clamps; each in
        # its own folder. e-stim ← per-chapter characters; multi-axis (TCode) ←
        # per-chapter Mechanical styles. motion.funscript already serves plain
        # 1-axis devices, so the per-device stroker clamps stay a Polish opt-in.

        def _emit_generated_station(sid, files_map):
            """files_map: {filename: (template_doc, actions)}. Writes the set,
            records artifacts + station meta (flagged generated)."""
            dest = staging / "stations" / sid
            dest.mkdir(parents=True, exist_ok=True)
            names = []
            for fname, (tmpl, acts) in files_map.items():
                _write_funscript_like(dest / fname, tmpl, acts)
                artifacts.append({
                    "path": f"stations/{sid}/{fname}", "kind": "funscript",
                    "role": "device", "station": sid, "generated": True,
                })
                names.append(fname)
            if names:
                stations_meta[sid] = {"files": names, "generated": True}

        if inc_estim and "estim3p" not in stations_meta:
            _emit_progress("Export — generating e-stim channels (no stamped pass)…")
            try:
                chans = _polish_generate_estim(
                    src, None, _polish_mod.STATIONS["estim3p"],
                    match_chapter_volume=args.match_chapter_volume,
                )
            except ValueError:
                chans = {}            # no character assigned / tools missing — nothing to do
            if chans:
                _emit_generated_station("estim3p", {
                    f"{stem}.{name}.funscript": (payload["template"], payload["actions"])
                    for name, payload in chans.items()
                })

        if inc_strokers and "tcode" not in stations_meta:
            _emit_progress("Export — generating T-Code axes (no stamped pass)…")
            try:
                axes = _polish_generate_tcode(src, None, _polish_mod.STATIONS["tcode"])
            except ValueError:
                axes = {}
            # Emit only when a Mechanical style produced real secondary axes;
            # an L0-only result would just duplicate motion.funscript.
            if len(axes) > 1:
                _emit_generated_station("tcode", {
                    (f"{stem}.funscript" if axis == "L0" else f"{stem}.{axis}.funscript"): (data, acts)
                    for axis, acts in axes.items()
                })

        # 3 + 4. Forge metadata — events.yml + authoring sidecars (chapters /
        # phrases / characters). The re-editable project data: pack only when the
        # "Forge metadata" target is kept.
        if inc_authoring:
            ev = _collect_events_yaml(src)
            if ev:
                (staging / "events.yml").write_text(ev, encoding="utf-8")
                artifacts.append({"path": "events.yml", "kind": "events"})
            # Authoring + analysis sidecars. beats/audio are media-derived but
            # CAN'T be regenerated without the source video, so they ride for
            # downstream consumers (beat-sync players, the assembler's beat-
            # aligned cuts, the audio preview image) — small. The big mel
            # spectrogram stays a local cache (shipped only as a PNG below).
            for analysis, fname in (
                ("chapters", f"{stem}.chapters.json"),
                ("phrases", f"{stem}.phrases.json"),
                ("characters", f"{stem}.characters.json"),
                ("beats", f"{stem}.beats.json"),
                ("audio", f"{stem}.audio.json"),
            ):
                sp = fdir / fname
                if sp.exists():
                    shutil.copy2(sp, staging / f"{analysis}.json")
                    artifacts.append({"path": f"{analysis}.json", "kind": "sidecar", "analysis": analysis})

        # 5. thumbnails/ — waveform always; hero + per-chapter frames when media
        if inc_preview:
            _emit_progress("Export — rendering thumbnails…")
            thumbs = staging / "thumbnails"
            thumbs.mkdir(parents=True, exist_ok=True)
            # The three previews are the funscript-player's EXACT lane renders
            # when the app supplies them (--preview-*), packed verbatim so they
            # can't drift from the editor. Each role independently falls back to
            # the matplotlib render (headless/CLI exports, or a lane with no
            # data). `_pack_preview` copies an app PNG or runs the fallback.
            def _pack_preview(app_png, role, out_name, fallback):
                dest = thumbs / out_name
                src = Path(app_png) if app_png else None
                if src and src.exists():
                    try:
                        shutil.copy2(src, dest)
                        artifacts.append({"path": f"thumbnails/{out_name}", "kind": "thumbnail", "role": role})
                        return
                    except OSError:
                        pass  # fall through to the matplotlib render
                if fallback():
                    artifacts.append({"path": f"thumbnails/{out_name}", "kind": "thumbnail", "role": role})

            _aj = fdir / f"{stem}.audio.json"
            _sj = fdir / f"{stem}.spectrogram.json"
            # funscript.png = the velocity-colored stroke curve (the funscript
            # PICTURE). Named for what it is — the legacy "waveform.png" was
            # confusing next to audio.png (the actual audio waveform).
            _pack_preview(args.preview_funscript, "funscript", "funscript.png",
                          lambda: _render_waveform_png(actions, thumbs / "funscript.png"))
            _pack_preview(args.preview_audio, "audio", "audio.png",
                          lambda: _aj.exists() and _render_audio_png(_aj, thumbs / "audio.png"))
            _pack_preview(args.preview_spectrogram, "spectrogram", "spectrogram.png",
                          lambda: _sj.exists() and _render_spectrogram_png(_sj, thumbs / "spectrogram.png"))
            if args.media and Path(args.media).exists():
                chap_list = []
                cj = fdir / f"{stem}.chapters.json"
                if cj.exists():
                    try:
                        chap_list = json.loads(cj.read_text(encoding="utf-8")).get("chapters") or []
                    except (OSError, json.JSONDecodeError):
                        chap_list = []
                # Hero: a representative, non-black frame from the first chapter
                # (not the exact cut, which is usually a fade/black).
                ch0_start = chap_list[0].get("at_ms", 0) if chap_list else 0
                ch0_end = (chap_list[0].get("end_ms") if chap_list else None) or duration_ms or (ch0_start + 60000)
                if _extract_hero_frame(args.media, ch0_start, ch0_end, thumbs / "hero.png"):
                    artifacts.append({"path": "thumbnails/hero.png", "kind": "thumbnail", "role": "hero"})
                for i, ch in enumerate(chap_list):
                    name = f"chapter_{i + 1:02d}.png"
                    if _extract_frame(args.media, ch.get("at_ms", 0), thumbs / name):
                        artifacts.append({"path": f"thumbnails/{name}", "kind": "thumbnail", "role": "chapter", "index": i + 1})

        # 6. audio/stim.{wav,mp3} — render the stamped e-stim alpha/beta to a
        # stereo control signal. Both formats are independent opt-ins (--stim-wav
        # / --stim-mp3): WAV is the lossless original, mp3 the common real-world
        # delivery format (smaller). A full-length WAV is large (~10 MB/min); the
        # channel funscripts remain the primary e-stim artifact.
        stim_formats = (["wav"] if args.stim_wav else []) + (["mp3"] if args.stim_mp3 else [])
        if inc_estim and stim_formats and duration_ms > 0:
            # Whichever e-stim station actually produced channels. Hardcoding
            # estim3p here meant a project that stamped only the FOC-Stim
            # station rendered no stim audio at all, silently — the directory
            # simply wasn't there. Prefer the flagship, fall back to any other
            # e-stim station that has files.
            est_dir = staging / "stations" / "estim3p"
            if not est_dir.is_dir():
                est_dir = next(
                    (d for d in sorted((staging / "stations").glob("*"))
                     if d.is_dir() and _polish_mod.is_estim_station(d.name)),
                    est_dir,
                )
            adir = staging / "audio"
            # Each phase PAIR renders to its own stereo control signal. The
            # NORMAL set (alpha/beta) and the PROSTATE set (alpha-prostate/
            # beta-prostate) are independent 2-channel renders → two audio
            # files (stim.* + stim-prostate.*), so someone with a prostate
            # electrode gets its own track, not just the normal mix. The
            # prostate render is skipped when those channels weren't generated.
            stim_pairs = [
                ("stim", "estim", "stim",
                 f"{stem}.alpha.funscript", f"{stem}.beta.funscript"),
                ("stim-prostate", "estim-prostate", "prostate stim",
                 f"{stem}.alpha-prostate.funscript", f"{stem}.beta-prostate.funscript"),
            ]
            for base, role, label, a_name, b_name in stim_pairs:
                a, b = est_dir / a_name, est_dir / b_name
                if not (a.exists() and b.exists()):
                    continue
                adir.mkdir(parents=True, exist_ok=True)
                for fmt in stim_formats:
                    _emit_progress(f"Export — rendering {label} audio ({fmt.upper()})…")
                    if _render_stim_audio(a, b, adir / f"{base}.{fmt}", duration_ms / 1000.0, fmt=fmt):
                        artifacts.append({"path": f"audio/{base}.{fmt}", "kind": "audio", "role": role, "format": fmt})

        # 6c. audio/beat.mp3 — a metronome click track (one tick per detected
        # beat, accented downbeats) synthesized straight from the persisted
        # beatmap sidecar. Needs no media and no e-stim channels — just the beat
        # timestamps — so it ships whenever a beatmap exists. Small (128k mp3),
        # handy for lining up haptics to the music by ear.
        if args.beat_mp3 and duration_ms > 0:
            bj = fdir / f"{stem}.beatmap.json"
            if bj.exists():
                try:
                    bdata = json.loads(bj.read_text(encoding="utf-8"))
                    beats = bdata.get("beats") or []
                    downbeats = bdata.get("downbeats") or []
                except (OSError, json.JSONDecodeError):
                    beats, downbeats = [], []
                if beats:
                    adir = staging / "audio"
                    adir.mkdir(parents=True, exist_ok=True)
                    _emit_progress("Export — rendering beat track (MP3)…")
                    if _render_beat_audio(beats, duration_ms / 1000.0,
                                          adir / "beat.mp3", downbeats=downbeats):
                        artifacts.append({"path": "audio/beat.mp3", "kind": "audio", "role": "beat", "format": "mp3"})

        # 6b. Source media — provenance is ALWAYS recorded (relink key); the
        # bytes ride only when --include-media is set (opt-in, big). Lean default
        # keeps the bundle a shareable snapshot; a consumer relinks via the key.
        media_meta = None
        if args.media and Path(args.media).exists():
            media_meta = _media_provenance(Path(args.media))
            if args.include_media:
                _emit_progress("Export — bundling the source media…")
                mdest = staging / "media"
                mdest.mkdir(parents=True, exist_ok=True)
                shutil.copy2(args.media, mdest / media_meta["filename"])
                media_meta["bundled"] = True
                media_meta["path"] = f"media/{media_meta['filename']}"
                artifacts.append({"path": media_meta["path"], "kind": "media", "role": "source"})
            else:
                media_meta["bundled"] = False

        # 7. manifest.ffmeta — stamped with stable lineage: a project_id that
        # persists across exports + a monotonic `project_version` bumped each
        # time. The id/version live in the working folder's project.json (source
        # of truth); the manifest carries a snapshot so an imported bundle keeps
        # the lineage. (`version`/`schema` are the manifest FORMAT version, a
        # different axis from the project's content version.)
        import datetime as _dt
        import uuid
        ident = _read_project_identity(src) or {"project_id": uuid.uuid4().hex, "version": 0}
        ident["version"] = int(ident.get("version", 0)) + 1
        _write_project_identity(src, ident)
        manifest = {
            "version": 1, "schema": "ffmeta/v1", "stem": stem,
            "created_with": "FunscriptForge", "duration_ms": duration_ms,
            "project_id": ident["project_id"], "project_version": ident["version"],
            "exported_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "artifacts": artifacts, "stations": stations_meta,
        }
        if media_meta:
            manifest["media"] = media_meta
        # Self-describing descriptor — pace/intensity/mood/arc/tags. Derived
        # (recomputes on import), so it rides in the manifest, not as a file.
        _assess = _assessment_summary(motion_src)
        if _assess:
            manifest["assessment"] = _assess
        (staging / "manifest.ffmeta").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        # --- write output ---
        if args.mode == "forge":
            _emit_progress("Export — packaging the .forge bundle…")
            out = Path(args.out) if args.out else (Path(src).parent / f"{stem}.forge")
            out = _next_available_path(out)  # never clobber a prior snapshot
            out.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
                for fp in sorted(staging.rglob("*")):
                    if fp.is_file():
                        z.write(fp, fp.relative_to(staging).as_posix())
            result_path = str(out)
        else:
            _emit_progress("Export — writing the output folder…")
            out = Path(args.out) if args.out else (Path(src).parent / f"{stem}.output")
            out = _next_available_path(out)  # never clobber a prior snapshot
            _emit_loose_output(staging, out, stem, manifest)
            result_path = str(out)

        print(json.dumps({
            "mode": args.mode, "path": result_path,
            "artifacts": len(artifacts), "stations": list(stations_meta),
            "manifest": manifest,
        }))
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _feel_from_events_yml(events_path, target) -> int:
    """Reconstruct the canonical `<stem>.feel.yml` from a playable Edger
    `events.yml` — the inverse of `_collect_events_yaml`. Used by `import` so a
    bundle's authored events re-open in the Events tab (the EventsTab reads
    feel.yml; events.yml is the play-only sibling). Mirrors `cmd_edger_import`
    (events.yml → canonical) + `cmd_feel_write` (canonical → feel.yml). Events
    whose name isn't in our vendored definitions are skipped. Returns the count.
    """
    import yaml
    doc = yaml.safe_load(Path(events_path).read_text(encoding="utf-8")) or {}
    raw = (doc.get("events") or []) if isinstance(doc, dict) else []
    definitions = _load_edger_definitions().get("definitions", {})
    canonical, idx = [], 0
    for ev in raw:
        if not isinstance(ev, dict) or "time" not in ev or "name" not in ev:
            continue
        if ev["name"] not in definitions:
            continue
        idx += 1
        canonical.append(_edger_to_canonical(ev, idx, definitions))
    canonical.sort(key=lambda c: c["begin_ms"])

    path = _feel_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    feel_doc = {}
    if path.exists():
        try:
            feel_doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            feel_doc = {}
    if not isinstance(feel_doc, dict):
        feel_doc = {}
    feel_doc["version"] = 1
    feel_doc["events"] = canonical
    path.write_text(yaml.safe_dump(feel_doc, sort_keys=False, allow_unicode=True),
                    encoding="utf-8")
    return len(canonical)


_IMPORT_MEDIA_EXTS = (
    ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v",
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac",
)


@_cli_command
def cmd_import(args):
    """Unpack a `.forge` bundle into a re-editable project on disk.

    The inverse of `cmd_export`: a `.forge` is a self-contained, shareable work-
    in-progress, and this onboards it as a first-class project. Reads
    `manifest.ffmeta`, lays the motion track down as `<dest>/<stem>.funscript`,
    and restores everything that makes the project re-editable into the
    per-project forge dir `<dest>/.<stem>.forge/`:

      motion.funscript        -> <dest>/<stem>.funscript   (what the app opens)
      {chapters,phrases,characters}.json -> <forge>/<stem>.<kind>.json
      events.yml              -> <forge>/<stem>.events.yml (playable sibling)
                                 + reconstructed <stem>.feel.yml (re-editable)
      stations/<id>/*.funscript -> <forge>/polish/<id>/...  (+ rebuilt polish.yml
                                 marking stamped stations accepted)
      manifest.ffmeta         -> <forge>/<stem>.ffmeta.json (load_project reads it)

    Accepts a `.forge` zip or an unzipped bundle folder (the machine layout with
    motion.funscript at root) — NOT the human `<stem>.output/` deliverable.
    `--out` chooses the destination folder (default: the bundle's own folder).
    Prints JSON with the funscript path the caller should then load.
    """
    import shutil
    import tempfile
    import zipfile
    from videoflow.sidecar import forge_dir

    src = Path(args.bundle)
    if not src.exists():
        raise FileNotFoundError(f"bundle not found: {src}")

    staging = Path(tempfile.mkdtemp(prefix="ff_import_"))
    try:
        # A `.forge` is a zip; an unzipped bundle is already a folder. (The
        # human `<stem>.output/` folder is NOT an import source — it's a
        # device-organized deliverable; re-import the sibling .forge instead.)
        if src.is_dir():
            root = src
        else:
            _emit_progress("Import — unpacking the .forge bundle…")
            with zipfile.ZipFile(src) as z:
                z.extractall(staging)
            root = staging

        manifest = {}
        manifest_path = root / "manifest.ffmeta"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                manifest = {}

        stem = args.stem or manifest.get("stem") or src.stem
        dest = Path(args.out) if args.out else src.parent
        dest.mkdir(parents=True, exist_ok=True)

        # Never clobber a live project: if `<stem>.funscript` or its working
        # folder already exists in dest, version the import up ("scene" ->
        # "scene (1)"). The working folder is the source of truth, so an import
        # must not overwrite in-progress edits with a snapshot.
        from videoflow.sidecar import forge_dir as _fd
        base_stem, n = stem, 0
        while (dest / f"{stem}.funscript").exists() or _fd(dest / f"{stem}.funscript").exists():
            n += 1
            stem = f"{base_stem} ({n})"
        funscript_path = dest / f"{stem}.funscript"

        # The motion track is the project's funscript — required to bootstrap.
        motion = root / "motion.funscript"
        if not motion.exists():
            if (root / "README.txt").exists() or not manifest:
                raise ValueError(
                    "this doesn't look like a .forge bundle (no motion.funscript). "
                    "If it's a `<stem>.output` folder, import the sibling .forge "
                    "backup instead — the output folder is a one-way deliverable."
                )
            raise ValueError(
                "bundle has no motion.funscript (exported without the Strokers "
                "target) — there is no stroke track to open as a project."
            )
        _emit_progress("Import — restoring the motion track + sidecars…")
        shutil.copy2(motion, funscript_path)
        imported = [f"{stem}.funscript"]

        fdir = forge_dir(funscript_path)
        fdir.mkdir(parents=True, exist_ok=True)

        # Authoring sidecars — export flattened the stem (chapters.json); restore
        # the stem-prefixed name the loaders probe for (<stem>.chapters.json).
        for kind in ("chapters", "phrases", "characters", "beats", "audio"):
            sp = root / f"{kind}.json"
            if sp.exists():
                shutil.copy2(sp, fdir / f"{stem}.{kind}.json")
                imported.append(f"{kind}.json")

        # Events: keep the playable sibling AND reconstruct the canonical
        # feel.yml so the Events tab re-opens with the authored events.
        ev = root / "events.yml"
        if ev.exists():
            shutil.copy2(ev, fdir / f"{stem}.events.yml")
            try:
                n = _feel_from_events_yml(ev, funscript_path)
                imported.append(f"events.yml → feel.yml ({n})")
            except Exception as exc:  # reconstruction is best-effort
                print(f"feel.yml reconstruction skipped: {exc}", file=sys.stderr)
                imported.append("events.yml")

        # Polish stations -> <forge>/polish/<id>/. Rebuild <stem>.polish.yml
        # marking STAMPED (accepted) stations accepted against the freshly
        # imported source hash so Export re-packs them and they don't read as
        # stale. Generated stations (manifest `generated`) reproduce from
        # characters.json — restore the files but skip the polish.yml entry.
        stations_meta = manifest.get("stations") or {}
        stations_root = root / "stations"
        polish_passes = {}
        if stations_root.is_dir():
            for sdir in sorted(p for p in stations_root.iterdir() if p.is_dir()):
                sid = sdir.name
                files = sorted(sdir.glob("*.funscript"))
                if not files:
                    continue
                dest_sdir = fdir / "polish" / sid
                dest_sdir.mkdir(parents=True, exist_ok=True)
                for fp in files:
                    shutil.copy2(fp, dest_sdir / fp.name)
                imported.append(f"station:{sid}")
                if not (stations_meta.get(sid) or {}).get("generated"):
                    polish_passes[sid] = {"accepted": True}
        if polish_passes:
            import yaml
            src_hash = _polish_source_hash(funscript_path)
            for st in polish_passes.values():
                st["source_hash"] = src_hash
            ppath = _polish_path(funscript_path)
            ppath.parent.mkdir(parents=True, exist_ok=True)
            ppath.write_text(
                yaml.safe_dump(
                    {"version": 1, "schema": "polish/v1", "passes": polish_passes},
                    sort_keys=False, allow_unicode=True),
                encoding="utf-8")
            imported.append("polish.yml")

        # The manifest itself, as the sidecar load_project surfaces.
        if manifest:
            (fdir / f"{stem}.ffmeta.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8")
            imported.append("ffmeta.json")

        # Continue the lineage: inherit the bundle's project_id + version so the
        # next export from this working copy is v(N+1) of the SAME project (not a
        # fresh id). Bundles made before lineage existed simply mint an id on
        # their first export from here.
        pid = manifest.get("project_id")
        if pid:
            _write_project_identity(
                funscript_path,
                {"project_id": pid, "version": int(manifest.get("project_version") or 0)})
            imported.append("project.json")

        # Source media. If the bundle embedded it (--include-media), extract it
        # next to the funscript renamed to the project stem so load_project's
        # adjacent-media probe finds it. Otherwise relink: look for a sibling
        # (stem match, or the original filename the manifest recorded). `media`
        # is the resolved path or null; `media_expected` is the relink target so
        # the UI can prompt "locate <file>" when the original isn't present.
        mmeta = manifest.get("media") or {}
        media = None
        if mmeta.get("bundled"):
            srcm = root / (mmeta.get("path") or f"media/{mmeta.get('filename', '')}")
            if srcm.exists():
                target = dest / f"{stem}{Path(mmeta.get('filename', '')).suffix}"
                shutil.copy2(srcm, target)
                media = str(target)
                imported.append("media")
        if media is None:
            for cand in sorted(dest.glob(f"{stem}.*")):
                if cand.suffix.lower() in _IMPORT_MEDIA_EXTS:
                    media = str(cand)
                    break
            if media is None and mmeta.get("filename"):
                orig = dest / mmeta["filename"]
                if orig.exists():
                    media = str(orig)

        print(json.dumps({
            "funscript_path": str(funscript_path),
            "stem": stem,
            "dest": str(dest),
            "imported": imported,
            "media": media,
            "media_expected": mmeta.get("filename"),
        }))
    finally:
        shutil.rmtree(staging, ignore_errors=True)


@_cli_command
def cmd_catalog(args):
    """Inspect or manage the cross-funscript pattern catalog."""
    catalog_path = args.catalog or os.path.join(
        os.path.dirname(__file__), "output", "pattern_catalog.json"
    )
    cat = PatternCatalog(catalog_path)

    if args.clear:
        cat._data["entries"] = []
        cat.save()
        print("Catalog cleared.")
        return

    if args.remove:
        removed = cat.remove(args.remove)
        if removed:
            cat.save()
            print(f"Removed: {args.remove}")
        else:
            print(f"Not found in catalog: {args.remove}")
        return

    if args.tag:
        tag = args.tag
        meta = TAGS.get(tag)
        phrases = cat.get_phrases_for_tag(tag)
        label = meta.label if meta else tag
        print(f"Tag '{label}' — {len(phrases)} phrase(s) across {len({p['_funscript'] for p in phrases})} file(s)")
        if meta:
            print(f"  Description: {meta.description}")
            print(f"  Suggested fix: {meta.suggested_transform} — {meta.fix_hint}")
        for ph in phrases:
            print(f"  [{ph['_funscript']}]  {ms_to_timestamp(ph['start_ms'])} → {ms_to_timestamp(ph['end_ms'])}"
                  f"  BPM: {ph.get('bpm', 0):.1f}"
                  f"  span: {ph.get('metrics', {}).get('span', 0):.1f}")
        return

    # Default: summary
    s = cat.summary()
    print(f"Catalog: {catalog_path}")
    print(f"  Funscripts indexed : {s['funscripts_indexed']}")
    print(f"  Tagged phrases     : {s['total_tagged_phrases']}")
    if s["tags_found"]:
        stats = cat.get_tag_stats()
        print(f"  Tags found         : {', '.join(s['tags_found'])}")
        print()
        print(f"  {'Tag':<14}  {'Phrases':>7}  {'Files':>5}  {'BPM':>12}  {'Span':>12}")
        print(f"  {'-'*14}  {'-'*7}  {'-'*5}  {'-'*12}  {'-'*12}")
        for tag in s["tags_found"]:
            st = stats[tag]
            label = TAGS[tag].label if tag in TAGS else tag
            bpm_range  = f"{st['bpm_min']}–{st['bpm_max']}"
            span_range = f"{st['span_min']}–{st['span_max']}"
            print(f"  {label:<14}  {st['count']:>7}  {st['funscripts']:>5}  {bpm_range:>12}  {span_range:>12}")
    else:
        print("  No tagged phrases yet — assess a funscript to populate the catalog.")


@_cli_command
def cmd_export_plan(args):
    """Show (and optionally apply) the export-tab transform plan for a funscript."""
    # --- load assessment (run fresh if not provided) ---
    if args.assessment:
        assessment = AssessmentResult.load(args.assessment)
    else:
        analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
        analyzer.load(args.funscript)
        assessment = analyzer.analyze()

    phrase_dicts = []
    for p in assessment.phrases:
        d = p if isinstance(p, dict) else {
            "start_ms":       p.start_ms,
            "end_ms":         p.end_ms,
            "bpm":            getattr(p, "bpm", 0),
            "cycle_count":    getattr(p, "cycle_count", None),
            "pattern_label":  getattr(p, "pattern_label", ""),
            "amplitude_span": getattr(p, "amplitude_span", 100),
            "tags":           list(getattr(p, "tags", []) or []),
        }
        phrase_dicts.append(d)

    if not phrase_dicts:
        print("No phrases found — run an assessment first.")
        sys.exit(1)

    # --- load per-phrase override file (optional) ---
    # Format: {"1": {"transform": "normalize", "params": {...}}, "3": "passthrough", ...}
    # Keys are 1-based phrase numbers (strings or ints).
    overrides: dict = {}
    if args.transforms:
        with open(args.transforms) as f:
            raw = json.load(f)
        for k, v in raw.items():
            idx = int(k) - 1   # convert 1-based → 0-based
            if isinstance(v, str):
                overrides[idx] = {"transform": v, "params": {}}
            else:
                overrides[idx] = {
                    "transform": v.get("transform", "passthrough"),
                    "params":    v.get("params", {}),
                }

    bpm_threshold = args.bpm_threshold or 120.0
    include_recommended = not args.no_recommended

    # --- build plan ---
    plan = []   # list of dicts
    for idx, phrase in enumerate(phrase_dicts):
        tx_key:    str  = None
        tx_params: dict = {}
        source:    str  = None

        # 1. Manual override from --transforms file
        if idx in overrides:
            entry_tx = overrides[idx]["transform"]
            if entry_tx and entry_tx != "passthrough":
                tx_key    = entry_tx
                tx_params = overrides[idx]["params"]
                source    = "Manual"

        # 2. Recommended (untouched phrases)
        if not tx_key and include_recommended:
            rec, rec_params = suggest_transform(phrase, bpm_threshold)
            if rec and rec != "passthrough":
                tx_key    = rec
                tx_params = rec_params
                source    = "Recommended"

        if not tx_key:
            continue

        if tx_key not in TRANSFORM_CATALOG:
            print(f"Warning: unknown transform {tx_key!r} for phrase {idx + 1} — skipping.")
            continue

        old_bpm    = phrase.get("bpm", 0.0)
        old_cycles = phrase.get("cycle_count") or 0
        new_bpm    = (old_bpm / 2)    if tx_key == "halve_tempo" else None
        new_cycles = (old_cycles // 2) if tx_key == "halve_tempo" else None

        spec    = TRANSFORM_CATALOG[tx_key]
        tx_name = spec.name

        plan.append({
            "phrase_idx":  idx,
            "start_ms":    phrase["start_ms"],
            "end_ms":      phrase["end_ms"],
            "tx_key":      tx_key,
            "tx_name":     tx_name,
            "tx_params":   tx_params,
            "source":      source,
            "old_bpm":     old_bpm,
            "new_bpm":     new_bpm,
            "old_cycles":  old_cycles,
            "new_cycles":  new_cycles,
        })

    # --- output ---
    if args.format == "json":
        out = []
        for e in plan:
            row = {
                "phrase":     e["phrase_idx"] + 1,
                "start":      ms_to_timestamp(e["start_ms"]),
                "end":        ms_to_timestamp(e["end_ms"]),
                "duration_s": round((e["end_ms"] - e["start_ms"]) / 1000, 1),
                "transform":  e["tx_name"],
                "source":     e["source"],
                "bpm":        {
                    "old": round(e["old_bpm"], 1),
                    **({"new": round(e["new_bpm"], 1)} if e["new_bpm"] is not None else {}),
                },
                "cycles":     {
                    "old": e["old_cycles"],
                    **({"new": e["new_cycles"]} if e["new_cycles"] is not None else {}),
                },
            }
            out.append(row)
        print(json.dumps(out, indent=2))
    else:
        # Human-readable table
        n = len(plan)
        rec_n  = sum(1 for e in plan if e["source"] == "Recommended")
        man_n  = n - rec_n
        print(f"Export plan: {n} transform{'s' if n != 1 else ''}"
              f"  ({man_n} manual, {rec_n} recommended)")
        print(f"  BPM threshold for recommendations: {bpm_threshold}")
        print()

        _W = (3, 29, 7, 24, 13, 18, 8)
        _HDR = ("#", "Time", "Dur(s)", "Transform", "Source", "BPM", "Cycles")
        _sep = "  ".join(f"{h:<{w}}" for h, w in zip(_HDR, _W))
        print(_sep)
        print("-" * len(_sep))

        for e in plan:
            time_str = (f"{ms_to_timestamp(e['start_ms'])} -> "
                        f"{ms_to_timestamp(e['end_ms'])}")
            dur_s    = f"{(e['end_ms'] - e['start_ms']) / 1000:.1f}"

            if e["new_bpm"] is not None:
                bpm_str = f"{e['old_bpm']:.1f} -> {e['new_bpm']:.1f}"
            else:
                bpm_str = f"{e['old_bpm']:.1f}"

            if e["new_cycles"] is not None:
                cyc_str = f"{e['old_cycles']} -> {e['new_cycles']}"
            else:
                cyc_str = str(e["old_cycles"])

            row = (
                str(e["phrase_idx"] + 1),
                time_str,
                dur_s,
                e["tx_name"],
                e["source"],
                bpm_str,
                cyc_str,
            )
            print("  ".join(f"{v:<{w}}" for v, w in zip(row, _W)))

        print()
        if not plan:
            print("No transforms to apply (all phrases are passthrough).")

    if not plan:
        return

    if args.dry_run:
        print("--dry-run: no file written.")
        return

    if not args.apply and not args.output:
        return

    # --- apply transforms ---
    with open(args.funscript) as f:
        fs_data = json.load(f)
    result = copy.deepcopy(fs_data.get("actions", []))

    for e in plan:
        spec     = TRANSFORM_CATALOG[e["tx_key"]]
        start_ms = e["start_ms"]
        end_ms   = e["end_ms"]
        params   = e["tx_params"] or {}

        phrase_slice = [a for a in result if start_ms <= a["at"] <= end_ms]
        transformed  = spec.apply(phrase_slice, params if params else None)
        if not transformed:
            continue

        if spec.structural:
            outside = [a for a in result if not (start_ms <= a["at"] <= end_ms)]
            result  = sorted(outside + transformed, key=lambda a: a["at"])
        else:
            t_to_pos = {a["at"]: a["pos"] for a in transformed}
            for a in result:
                if a["at"] in t_to_pos:
                    a["pos"] = t_to_pos[a["at"]]

    fs_data["actions"] = result
    output = args.output or _default_path(args.funscript, "_export.funscript")
    with open(output, "w") as f:
        json.dump(fs_data, f, indent=2)
    print(f"Saved: {output}")


@_cli_command
def cmd_test(_args):
    import unittest  # keep lazy: avoids paying unittest discovery overhead for other commands
    root = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    # Core pipeline tests
    suite.addTests(loader.discover(
        start_dir=os.path.join(root, "tests"),
        pattern="test_*.py",
        top_level_dir=root,
    ))
    # UI common-layer tests
    suite.addTests(loader.discover(
        start_dir=os.path.join(root, "ui", "common", "tests"),
        pattern="test_*.py",
        top_level_dir=root,
    ))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


# ------------------------------------------------------------------
# Project metadata commands
# ------------------------------------------------------------------

@_cli_command
def cmd_project(args):
    """get/set project name and description stored in a .project.json file."""
    from ui.common.project import Project

    project_path = args.project_file
    if not os.path.exists(project_path):
        print(f"Error: project file not found: {project_path}", file=sys.stderr)
        sys.exit(1)

    project = Project.load_project(project_path)
    changed = False

    if args.project_action == "get-name":
        print(project.display_name)

    elif args.project_action == "set-name":
        project.custom_name = args.value
        changed = True
        print(f"Name set to: {project.display_name}")

    elif args.project_action == "get-desc":
        print(project.get_description())

    elif args.project_action == "set-desc":
        project.description = args.value
        changed = True
        print(f"Description set to: {project.description}")

    if changed:
        project.export_project(project_path)


# ------------------------------------------------------------------
# Forge metadata / beats / captions commands
# ------------------------------------------------------------------

@_cli_command
def cmd_meta(args):
    """Derive and print auto-metadata from a funscript (+ optional assessment)."""
    from forge.metadata import derive_metadata, format_metadata_table
    from assessment.analyzer import FunscriptAnalyzer

    analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
    analyzer.load(args.funscript)

    if getattr(args, "assessment", None):
        result = analyzer.load_assessment_result(args.assessment)
    else:
        result = analyzer.analyze()

    stats   = result.to_stats_dict() if hasattr(result, "to_stats_dict") else {}
    phrases = [p if isinstance(p, dict) else p.to_dict() for p in result.phrases]

    meta = derive_metadata(stats, phrases)

    if getattr(args, "format", "table") == "json":
        print(json.dumps(meta, indent=2))
    else:
        print(format_metadata_table(meta))

    if getattr(args, "output", None):
        with open(args.output, "w") as f:
            json.dump(meta, f, indent=2)
        print(f"\nMetadata saved: {args.output}")


@_cli_command
def cmd_suggest_tone(args):
    """Suggest a Tone label from funscript analysis."""
    from forge.metadata import derive_metadata
    from assessment.analyzer import FunscriptAnalyzer

    analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
    analyzer.load(args.funscript)
    result  = analyzer.analyze()
    stats   = result.to_stats_dict() if hasattr(result, "to_stats_dict") else {}
    phrases = [p if isinstance(p, dict) else p.to_dict() for p in result.phrases]

    meta = derive_metadata(stats, phrases)
    print(f"Tone suggestion: {meta['tone_suggestion']}")
    print(f"Rationale:       {meta['tone_rationale']}")


@_cli_command
def cmd_beats(args):
    """Extract beats from a video file and write _beats.json + _beats.csv."""
    from forge.beats import extract_beats

    out_dir = args.output_dir or os.path.dirname(os.path.abspath(args.video))
    result  = extract_beats(
        video_path=args.video,
        output_folder=out_dir,
        audio_path=getattr(args, "audio", None),
    )
    if result is None:
        print("Beat extraction failed (see warnings above).", file=sys.stderr)
        sys.exit(1)

    print(f"Beats extracted:  {result['beat_count']}  ({result['bpm_estimate']:.1f} BPM)")
    print(f"Output folder:    {out_dir}")


@_cli_command
def cmd_audio_peaks(args):
    """Compute pre-computed waveform peaks for a media file.

    Reads or generates <stem>.audio.json next to the media. Sidecar is
    written by default (suppress with --no-write); cached output is reused
    unless --force is passed. Emits the full sidecar dict to stdout (in
    --format json) so the Tauri bridge can consume it without a second
    file read.

    Emits depth-2 stage events (decode / rms / write) via _emit_progress so
    the Tauri bridge can render a live step checklist in the busy footer.
    Skipped entirely on sidecar cache hit — the parse is sub-50ms.
    """
    from forge.audio_peaks import (
        decode_audio, compute_peaks, load_peaks, write_sidecar, sidecar_path,
    )

    cached = None if args.force else load_peaks(args.media)
    if cached is not None:
        data = cached
        from_sidecar = True
    else:
        _emit_progress("start::2::decode")
        samples = decode_audio(args.media)
        if samples is None:
            print("audio-peaks: decode failed (see warnings above).", file=sys.stderr)
            sys.exit(1)
        _emit_progress(f"done::2::decode::{len(samples) / 22050:.1f}s audio")

        _emit_progress("start::2::rms")
        data = compute_peaks(samples, hop_ms=args.hop_ms)
        if data is None:
            print("audio-peaks: compute failed (see warnings above).", file=sys.stderr)
            sys.exit(1)
        _emit_progress(f"done::2::rms::{data['peak_count']} peaks @ {data['hop_ms']}ms")

        if not args.no_write:
            _emit_progress("start::2::write")
            write_sidecar(args.media, data)
            _emit_progress("done::2::write")

        from_sidecar = False

    if args.format == "json":
        out = dict(data)
        out["from_sidecar"] = from_sidecar
        out["sidecar_path"] = sidecar_path(args.media)
        print(json.dumps(out))
    else:
        sp = sidecar_path(args.media)
        n = data.get("peak_count", len(data.get("peaks", [])))
        dur = data.get("duration_ms", 0) / 1000.0
        hop = data.get("hop_ms", "?")
        src = "sidecar" if from_sidecar else "computed"
        print(f"audio-peaks: {n} peaks @ {hop}ms hop · {dur:.1f}s · {src}")
        if not args.no_write or from_sidecar:
            print(f"Sidecar: {sp}")


@_cli_command
def cmd_audio_spectrogram(args):
    """Render a mel spectrogram PNG of a media file's audio track.

    Visualization-only preview to decide whether the frequency-over-time
    view is useful for funscript editing. Writes <stem>.spectrogram.png
    next to the media file by default.
    """
    from forge.audio_spectrogram import render_mel_spectrogram

    out = render_mel_spectrogram(
        args.media,
        output_path=args.output,
        n_mels=args.n_mels,
        fmax=args.fmax,
        cmap=args.cmap,
    )
    if out is None:
        print("audio-spectrogram: rendering failed (see warnings above).", file=sys.stderr)
        sys.exit(1)
    print(f"Spectrogram written: {out}")


@_cli_command
def cmd_parse_captions(args):
    """Parse an SRT or VTT caption file and save _captions.json."""
    from forge.captions import parse_captions, save_captions_json

    captions = parse_captions(args.caption_file)
    if not captions:
        print("No captions found.", file=sys.stderr)
        sys.exit(1)

    out_dir = args.output_dir or os.path.dirname(os.path.abspath(args.caption_file))
    dest    = save_captions_json(captions, out_dir)

    print(f"Parsed {len(captions)} captions -> {dest}")

    if getattr(args, "print", False):
        for c in captions:
            from forge.captions import _ms_to_ts
            print(f"  [{_ms_to_ts(c['start_ms'])} --> {_ms_to_ts(c['end_ms'])}]  {c['text']}")


# ------------------------------------------------------------------
# Chapter resolution / auto-detection (videoflow bridge)
# ------------------------------------------------------------------
#
# These two commands delegate to videoflow so that FunscriptForge and
# forgeplayer see the same chapters from the same resolver and the same
# auto-detector. They normalize the JSON shape
# so end_ms is always present (videoflow.Chapter omits end_ms when
# None — for mp4-embedded chapters that only carry start times).

def _normalize_chapter_list(chapters, duration_ms=None):
    """Normalize videoflow Chapter list to FF's wire shape.

    Guarantees every record has an integer end_ms (fills from next chapter,
    then falls back to *duration_ms* if provided, then to at_ms as a last
    resort). All analytical fields are present with safe defaults.
    """
    records = []
    n = len(chapters)
    for i, ch in enumerate(chapters):
        end_ms = ch.end_ms
        if end_ms is None and i + 1 < n:
            end_ms = chapters[i + 1].at_ms
        if end_ms is None and duration_ms is not None:
            end_ms = duration_ms
        if end_ms is None:
            end_ms = ch.at_ms
        records.append({
            "at_ms": int(ch.at_ms),
            "end_ms": int(end_ms),
            "name": ch.name or "",
            "intent": ch.intent or "",
            "content_type": ch.content_type or "",
            "confidence": float(ch.confidence) if ch.confidence is not None else 0.0,
            "evidence": list(ch.evidence or []),
            "tone": ch.tone or "",
        })
    return records


@_cli_command
def cmd_chapters(args):
    """Resolve chapters for a media or funscript path (videoflow.chapters.load_chapters).

    Priority chain inside videoflow: <stem>.chapters.json sidecar -> embedded mp4
    markers (ffprobe) -> <stem>.analysis.json. When passed a funscript path,
    only the sidecar + analysis.json are honoured (mp4 probe is a no-op on
    non-video suffixes).
    """
    from videoflow.chapters import load_chapters, ChapterError

    try:
        chapters = load_chapters(args.path)
    except ChapterError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    if chapters is None:
        result = {"found": False, "chapters": []}
    else:
        result = {
            "found": True,
            "chapters": _normalize_chapter_list(chapters, duration_ms=args.duration_ms),
        }

    if args.format == "json":
        print(json.dumps(result))
    else:
        if not result["found"]:
            print("No chapters found.")
        else:
            print(f"Resolved {len(result['chapters'])} chapter(s):")
            for c in result["chapters"]:
                print(f"  {c['at_ms']:>10}ms - {c['end_ms']:>10}ms  "
                      f"{c['name'] or '(unnamed)'}  intent={c['intent'] or '-'}  "
                      f"type={c['content_type'] or '-'}")


@_cli_command
def _emit_progress(label: str) -> None:
    """Mirror of `videoflow.cli._emit_progress`. Writes a `progress: <label>`
    line to stderr AND (when VIDEOFLOW_PROGRESS_FILE is set) appends the
    same line to that file. The temp-file side-channel exists because
    Tokio's stderr piping on Windows is unreliable — Tauri bridges poll
    the file for live UI updates."""
    try:
        print(f"progress: {label}", file=sys.stderr, flush=True)
    except OSError:
        pass
    path = os.environ.get("VIDEOFLOW_PROGRESS_FILE")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"progress: {label}\n")
    except OSError:
        pass


def _make_stage_event_emitter():
    """Return an OnProgress callback that turns StageEvents into the
    structured `progress: <kind>::<depth>::<leaf>[::<msg>]` lines our
    Tauri bridge polls. Three kinds:
      start::<depth>::<leaf>             stage opened
      done::<depth>::<leaf>              stage closed
      msg::<depth>::<leaf>::<message>    in-stage status update (counts
                                          like "Classifying chapter 3/4…"
                                          that videoflow emits via
                                          reporter.message())
    The UI mirrors top-level (depth 2) stages as a checklist and bubbles
    the latest msg payload into the headline."""
    def _cb(event):
        depth = len(event.stage_path)
        leaf = (event.stage_path[-1] if event.stage_path else "").replace("::", "_")
        if not leaf:
            return
        if event.kind == "start":
            _emit_progress(f"start::{depth}::{leaf}")
        elif event.kind == "complete":
            # Carry the stage summary through ("13 chapters detected",
            # "1234 beats @ 124.3 BPM", etc.) so the UI can display the
            # per-step result alongside the green check.
            summary = (event.summary or "").replace("::", " ")
            if summary:
                _emit_progress(f"done::{depth}::{leaf}::{summary}")
            else:
                _emit_progress(f"done::{depth}::{leaf}")
        elif event.kind == "progress" and event.message:
            safe = event.message.replace("::", " ")
            _emit_progress(f"msg::{depth}::{leaf}::{safe}")
    return _cb


def _compute_stanza_clusters(stanzas, actions):
    """Bucket stanzas by (mode, length, density) and emit clusters of
    ≥2 members. Singletons stay un-clustered (the rail surfaces only
    groups worth editing as one).

    Length bucketing is log-scale (4 buckets per octave via rounding
    log2(seconds) to the nearest 0.25 — gives natural human-readable
    bucket centers like ~3s, ~4s, ~5.7s, ~8s, ~11s). Density bucketing
    is three coarse bands (sparse/medium/busy at <3, <8, ≥8 actions/sec).

    Returns a list of cluster dicts sorted by member count desc:
        { id, label, stanza_ids, mode, length_bucket, density_bucket }
    """
    import math
    from collections import defaultdict

    # Per-stanza action density. Linear scan over actions guarded by
    # the time window — fast enough for typical funscript sizes
    # (10k actions × hundreds of stanzas = millions of compares; still
    # sub-second). For huge funscripts (>50k actions) we could binary-
    # search instead, but not needed today.
    densities = {}
    for s in stanzas:
        dur_s = max(0.1, (s["end_ms"] - s["at_ms"]) / 1000.0)
        count = 0
        for a in actions:
            at = a.get("at", 0)
            if s["at_ms"] <= at <= s["end_ms"]:
                count += 1
        densities[s["id"]] = count / dur_s

    def density_bucket(d):
        if d < 3:
            return "sparse"
        if d < 8:
            return "medium"
        return "busy"

    def length_bucket_center(ms):
        if ms <= 0:
            return 0.1
        sec = ms / 1000.0
        rounded = round(math.log2(sec) * 4) / 4
        return round(2 ** rounded, 1)

    bucketed: dict = defaultdict(list)
    for s in stanzas:
        mode = s.get("mode") or "unknown"
        lb = length_bucket_center(s["end_ms"] - s["at_ms"])
        db = density_bucket(densities.get(s["id"], 0))
        bucketed[(mode, lb, db)].append(s["id"])

    clusters: list = []
    for (mode, lb, db), ids in bucketed.items():
        if len(ids) < 2:
            continue
        clusters.append({
            "id": f"cl_{mode}_{lb}_{db}",
            "label": f"{mode.capitalize()} · ~{lb}s · {db}",
            "stanza_ids": ids,
            "mode": mode,
            "length_bucket": lb,
            "density_bucket": db,
        })
    clusters.sort(key=lambda c: -len(c["stanza_ids"]))
    return clusters


def cmd_read_stanzas(args):
    """Read videoflow phrases (= "stanzas" in the FF UI) from the
    <stem>.chapters.json sidecar next to a funscript or media file.

    The phrases field is written by `videoflow.structural.auto_chapter`
    on every analysis run. This command just exposes that pre-computed
    payload to the FF UI without re-running analysis — the Stanzas tab
    consumes it.

    Output shape:
        {
          "phrases": [
            { id, number, chapter_idx, at_ms, end_ms, mode, source }, …
          ],
          "clusters": [
            { id, label, stanza_ids, mode, length_bucket, density_bucket }, …
          ],
        }

    `number` is the 1-based ordinal within the chapter (so the user
    sees "#1, #2, #3" per chapter, matching the Phrases tab convention).
    `clusters` is computed here from the phrases + adjacent funscript
    actions (density signal). Empty list when there's nothing to cluster.

    Returns `{"phrases": [], "clusters": []}` when the sidecar is missing
    or has no phrases — the UI handles that as "no stanzas yet, run
    auto-chapter from the Chapters tab first."
    """
    target = Path(args.path)
    if not target.exists():
        print(f"Error: file not found: {target}", file=sys.stderr)
        sys.exit(1)

    # Sidecars live in `<dir>/.<stem>.forge/<stem>.chapters.json` per the
    # videoflow forge-dir layout. `sidecar_path_for` resolves that path
    # whether `target` is a `.funscript` or a media file — both share
    # the same stem.
    from videoflow.sidecar import sidecar_path_for
    sidecar = sidecar_path_for(target)
    if not sidecar.exists():
        print(json.dumps({"phrases": [], "clusters": []}))
        return

    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Error reading sidecar {sidecar}: {exc}", file=sys.stderr)
        sys.exit(1)

    # videoflow schema 3.0+ writes `stanzas:`; older 2.x caches wrote
    # `phrases:` for the same data. Read both so a fresh auto-chapter
    # populates the tab and pre-rename caches still render until the
    # next analyze regenerates them.
    raw_phrases = data.get("stanzas") or data.get("phrases") or []

    # Number stanzas 1..N within each chapter so the UI gets stable
    # "#3 in chapter 2" labels without re-deriving them on every render.
    by_chapter: dict = {}
    out: list[dict] = []
    for i, p in enumerate(raw_phrases):
        ch_idx = int(p.get("chapter_idx", 0))
        by_chapter[ch_idx] = by_chapter.get(ch_idx, 0) + 1
        out.append({
            "id": f"st{i}",
            "number": by_chapter[ch_idx],
            "chapter_idx": ch_idx,
            "at_ms": int(p["at_ms"]),
            "end_ms": int(p["end_ms"]),
            "mode": p.get("mode", "") or "",
            "source": p.get("source", "") or "",
        })

    # Cluster the stanzas. Needs funscript actions for the density
    # signal — read them from the funscript file if the input is one,
    # otherwise we look for an adjacent .funscript next to the media.
    # If neither is available, clusters are computed with density=0
    # (which collapses to mode+length groupings — still useful).
    actions: list = []
    funscript_path: Path | None = None
    if str(target).lower().endswith(".funscript"):
        funscript_path = target
    else:
        cand = target.with_suffix(".funscript")
        if cand.exists():
            funscript_path = cand
    if funscript_path is not None:
        try:
            fs_data = json.loads(funscript_path.read_text(encoding="utf-8"))
            actions = fs_data.get("actions") or []
        except (OSError, json.JSONDecodeError):
            actions = []

    clusters = _compute_stanza_clusters(out, actions) if out else []

    print(json.dumps({"phrases": out, "clusters": clusters}))


def _feel_path(target) -> Path:
    """Resolve `<dir>/.<stem>.forge/<stem>.feel.yml` for a funscript or media
    path. The `.feel.yml` is the canonical middle file holding all haptic
    metadata (events today; devices / compose later). Edger yml is a derived
    export, NOT this file."""
    from videoflow.sidecar import forge_dir
    stem = Path(target).stem
    return forge_dir(target) / f"{stem}.feel.yml"


def _js_event_to_canonical(e: dict) -> dict:
    """Map the EventsTab JS event shape → canonical snake_case for the
    sidecar. Keeps the UI dumb (it sends its own shape); Python owns
    canonicalization (and the future Edger mapping)."""
    return {
        "id": e.get("id"),
        "begin_ms": int(e.get("beginMs", 0)),
        "end_ms": int(e.get("endMs", 0)),
        "effect": e.get("effectId"),
        "intensity": float(e.get("intensity", 0.0)),
        "params": e.get("params") or {},
        "devices": e.get("devices") or [],
        "overrides": e.get("deviceCfg") or {},
    }


def _canonical_to_js(e: dict) -> dict:
    """Inverse of _js_event_to_canonical — feel-read returns the JS shape so
    EventsTab seeds with zero client-side mapping."""
    return {
        "id": e.get("id"),
        "beginMs": int(e.get("begin_ms", 0)),
        "endMs": int(e.get("end_ms", 0)),
        "effectId": e.get("effect"),
        "intensity": float(e.get("intensity", 0.0)),
        "params": e.get("params") or {},
        "devices": e.get("devices") or [],
        "deviceCfg": e.get("overrides") or {},
    }


def cmd_feel_write(args):
    """Write the events list to `<stem>.feel.yml`, preserving any other
    top-level keys already in the file. Events arrive as JSON (the EventsTab
    shape) from --events-json (a path, or '-' for stdin)."""
    import yaml
    target = Path(args.input)
    raw = sys.stdin.read() if args.events_json == "-" \
        else Path(args.events_json).read_text(encoding="utf-8")
    payload = json.loads(raw)
    events = payload if isinstance(payload, list) else (payload.get("events") or [])
    canonical = [_js_event_to_canonical(e) for e in events]

    path = _feel_path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {}
    if path.exists():
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            doc = {}
    if not isinstance(doc, dict):
        doc = {}
    doc["version"] = 1
    doc["events"] = canonical
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True),
                    encoding="utf-8")
    print(json.dumps({"saved": str(path), "count": len(canonical)}))


def cmd_feel_read(args):
    """Read `<stem>.feel.yml` and emit its events in the EventsTab JS shape.
    Returns `{"version": 1, "events": []}` when the file is missing."""
    import yaml
    target = Path(args.input)
    path = _feel_path(target)
    if not path.exists():
        print(json.dumps({"version": 1, "events": []}))
        return
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"Error reading {path}: {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(doc, dict):
        doc = {}
    events = doc.get("events") or []
    print(json.dumps({
        "version": doc.get("version", 1),
        "events": [_canonical_to_js(e) for e in events],
    }))


def _characters_path(target) -> Path:
    """Resolve `<dir>/.<stem>.forge/<stem>.characters.json` — the per-chapter
    character + slider assignments the Channels tab authors. Export reads
    this to run the e-stim channel generation (the Streamlit stim pipeline,
    ported)."""
    from videoflow.sidecar import forge_dir
    stem = Path(target).stem
    return forge_dir(target) / f"{stem}.characters.json"


def cmd_characters_read(args):
    """Read `<stem>.characters.json` → `{version, characters:{chapterId: {...}}}`.
    Returns an empty map when the sidecar is missing."""
    path = _characters_path(Path(args.input))
    if not path.exists():
        print(json.dumps({"version": 1, "characters": {}}))
        return
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Error reading {path}: {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(doc, dict):
        doc = {}
    print(json.dumps({
        "version": doc.get("version", 1),
        "characters": doc.get("characters") or {},
    }))


def cmd_characters_write(args):
    """Write per-chapter character assignments to `<stem>.characters.json`.
    The map arrives as JSON (`{characters:{...}}` or a bare map) via
    --characters-json (a path, or '-' for stdin)."""
    raw = sys.stdin.read() if args.characters_json == "-" \
        else Path(args.characters_json).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if isinstance(payload, dict) and "characters" in payload:
        characters = payload.get("characters") or {}
    else:
        characters = payload if isinstance(payload, dict) else {}

    path = _characters_path(Path(args.input))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "characters": characters}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"saved": str(path), "count": len(characters)}))


def _passages_path(target) -> Path:
    """Resolve `<dir>/.<stem>.forge/<stem>.passages.json` — the span-relative
    intensity envelopes (Channels · Passages) layered over the chapter run.
    Export reads this to scale e-stim volume + multi-axis amplitude."""
    from videoflow.sidecar import forge_dir
    stem = Path(target).stem
    return forge_dir(target) / f"{stem}.passages.json"


def cmd_passages_read(args):
    """Read `<stem>.passages.json` → `{version, passages:[...]}`. Empty when missing."""
    path = _passages_path(Path(args.input))
    if not path.exists():
        print(json.dumps({"version": 1, "passages": []}))
        return
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Error reading {path}: {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(doc, dict):
        doc = {}
    print(json.dumps({
        "version": doc.get("version", 1),
        "passages": doc.get("passages") or [],
    }))


def cmd_passages_write(args):
    """Write passage records to `<stem>.passages.json`. The list arrives as JSON
    (`{passages:[...]}` or a bare list) via --passages-json (a path, or '-' for stdin)."""
    raw = sys.stdin.read() if args.passages_json == "-" \
        else Path(args.passages_json).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if isinstance(payload, dict) and "passages" in payload:
        items = payload.get("passages") or []
    elif isinstance(payload, list):
        items = payload
    else:
        items = []
    path = _passages_path(Path(args.input))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": 1, "passages": items}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"saved": str(path), "count": len(items)}))


def _load_chapters(funscript_path) -> list:
    """The chapters sidecar list (each with at_ms/end_ms), or [] when absent."""
    from videoflow.sidecar import forge_dir
    stem = Path(funscript_path).stem
    p = forge_dir(funscript_path) / f"{stem}.chapters.json"
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("chapters") or []
    except (OSError, json.JSONDecodeError):
        return []


def _load_resolved_passages(funscript_path, chapters=None) -> list:
    """Load `<stem>.passages.json` and resolve to absolute-time spans against the
    chapters (loaded if not supplied). Returns [] when there's nothing usable."""
    from forge import passages as _passages_mod
    if chapters is None:
        chapters = _load_chapters(funscript_path)
    path = _passages_path(funscript_path)
    if not path.exists():
        return []
    try:
        recs = json.loads(path.read_text(encoding="utf-8")).get("passages") or []
    except (OSError, json.JSONDecodeError):
        return []
    return _passages_mod.resolve_passages(recs, chapters)


@_cli_command
def cmd_stim_process(args):
    """Generate e-stim channel funscripts for a window (a chapter) via the
    proven funscript-tools pipeline, and emit them as JSON channel actions.

    This is the React bridge to the same `process()` the Streamlit stim tab
    used. The window (--start-ms/--end-ms) keeps the 2D draw fast by slicing
    to the active chapter — the whole reason long scripts became chapters.
    Full 3-phase generation runs at export, not here."""
    from forge.funscript_tools import AVAILABLE, build_config, process
    if not AVAILABLE:
        print(json.dumps({"available": False, "channels": {},
                          "error": "funscript-tools not found"}))
        return

    from forge.funscript import load_funscript_strict, parse_actions
    times, pos = parse_actions(load_funscript_strict(args.input))
    pairs = list(zip(times, pos))
    if args.start_ms is not None or args.end_ms is not None:
        lo = args.start_ms if args.start_ms is not None else (times[0] if times else 0)
        hi = args.end_ms if args.end_ms is not None else (times[-1] if times else 0)
        pairs = [(t, p) for t, p in pairs if lo <= t <= hi]
    if len(pairs) < 2:
        print(json.dumps({"available": True, "channels": {},
                          "error": "no actions in window"}))
        return

    sliders = {}
    if args.sliders_json:
        raw = sys.stdin.read() if args.sliders_json == "-" \
            else Path(args.sliders_json).read_text(encoding="utf-8")
        sliders = json.loads(raw) or {}

    import tempfile
    import shutil
    tmp = Path(tempfile.mkdtemp(prefix="ff_stim_"))
    try:
        in_path = tmp / f"{Path(args.input).stem}.funscript"
        in_path.write_text(json.dumps({
            "actions": [{"at": int(t), "pos": int(round(p))} for t, p in pairs],
        }), encoding="utf-8")

        # Virtual characters (e.g. Scene Closer) generate from a base Edger
        # preset, then get a post-process below. Real characters pass through.
        from forge.stim_config import resolve_character, apply_virtual_envelope
        base_label, virtual = resolve_character(args.character)
        win_lo, win_hi = pairs[0][0], pairs[-1][0]

        config = build_config(base_label, sliders, output_dir=str(tmp))
        if args.mode == "2d":
            config.setdefault("prostate_generation", {})["generate_prostate_files"] = False
        # funscript-tools' process() logs progress to stdout ("Generated e1
        # axis…"); redirect it to stderr so stdout carries ONLY our JSON
        # (run_cli on the Rust side parses stdout).
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            result = process(str(in_path), config, None)
        if not result.get("success"):
            print(json.dumps({"available": True, "channels": {},
                              "error": result.get("error") or "process failed"}))
            return

        wanted = (["alpha", "beta"] if args.mode == "2d" else
                  ["alpha", "beta", "pulse_frequency", "frequency", "volume",
                   "pulse_rise_time", "alpha-prostate", "beta-prostate",
                   "volume-prostate"])
        stem = in_path.stem
        channels = {}
        for suf in wanted:
            cp = tmp / f"{stem}.{suf}.funscript"
            if not cp.exists():
                continue
            cd = json.loads(cp.read_text(encoding="utf-8"))
            acts = [{"at": a["at"], "pos": a["pos"]} for a in cd.get("actions", [])]
            acts = apply_virtual_envelope(suf, acts, win_lo, win_hi, virtual)
            channels[suf] = {"actions": acts}
        # Layer Passages (span-relative intensity envelope) onto the volume
        # channels so the live draw reflects what export bakes. Spans are
        # absolute time, so a single chapter window gets its correct slice.
        _passages = _load_resolved_passages(args.input)
        if _passages:
            from forge import passages as _passages_mod
            for suf, cdat in channels.items():
                cdat["actions"] = _passages_mod.scale_estim(suf, cdat["actions"], _passages)
        # Flash-safety cap (co-rail catch-all) on the live draw so the preview
        # reflects what ships. The region-targeted clamp needs the analysis
        # screech sidecar and runs at export; the catch-all needs nothing.
        from forge.stim_safety import cap_channels_dict
        cap_channels_dict(channels)
        print(json.dumps({"available": True, "mode": args.mode, "channels": channels}))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def cmd_cap_stim(args):
    """Apply the flash-safety cap to generated e-stim channel files.

    Region-targeted (using the analysis screech sidecar) + co-rail catch-all,
    rewriting the volume channels in place and emitting a ``<stem>.screech.json``
    report. Runs at export and is also the standalone "fix a shipped file" pass.
    """
    from forge.stim_safety import (
        cap_stim_channels, discover_channels, write_sidecar,
    )
    screech_regions = None
    if args.screech_json and Path(args.screech_json).exists():
        raw = json.loads(Path(args.screech_json).read_text(encoding="utf-8"))
        # accept either the full sidecar shape or a bare [{start_s,end_s}] list
        screech_regions = raw.get("source_screech_regions", raw) if isinstance(raw, dict) else raw

    channels = discover_channels(args.output_dir, args.stem)
    if not channels:
        print(json.dumps({"ok": False, "error": "no channel files found"}))
        return
    regions = cap_stim_channels(channels, screech_regions=screech_regions, write=True)

    if args.media:
        from videoflow.sidecar import forge_dir
        sc_dir = forge_dir(args.media)
        sc_path = sc_dir / f"{Path(args.media).stem}.screech.json"
    else:
        sc_path = Path(args.output_dir) / f"{args.stem}.screech.json"
    write_sidecar(sc_path, cap_regions=regions, screech_regions=screech_regions)
    print(json.dumps({
        "ok": True,
        "capped_regions": len(regions),
        "source_screech": sum(1 for r in regions if r.reason == "source_screech"),
        "co_rail": sum(1 for r in regions if r.reason == "co_rail"),
        "sidecar": str(sc_path),
    }))


def cmd_viewer_load(args):
    """Load a project's generated device outputs for the Viewer stage.

    Scans ``<stem>.output/`` for per-device channel funscripts (decimated) and
    attaches the screech note. Pure file IO — reviews what was produced.
    """
    from forge.viewer import load_device_outputs, load_single_channel, load_audio_only
    if getattr(args, "channel", None):
        device, _, chan = args.channel.partition("/")
        result = load_single_channel(args.input, device, chan)
    elif getattr(args, "audio_points", None):
        result = load_audio_only(args.input, points=args.audio_points)
    else:
        result = load_device_outputs(args.input, max_points=args.max_points)
    print(json.dumps(result))


@_cli_command
def cmd_warmup(args):
    """Best-effort prewarm, fired in the background at app launch (lib.rs setup).

    Importing this module already pulled the heavy scientific stack
    (librosa / numba / scipy) off disk into the OS file cache — that's the
    ~15s-cold / <1s-warm cost every fresh `cli.py` spawn would otherwise pay on
    the user's FIRST real analyze/assess. One tiny librosa op also warms the
    numba JIT. Touches no project files; always exits 0."""
    try:
        import numpy as np
        import librosa
        librosa.stft(np.zeros(2048, dtype=np.float32), n_fft=512)
    except Exception:
        pass
    print("warm")


@_cli_command
def cmd_multiaxis_process(args):
    """Generate secondary-axis funscripts for a window (a chapter) via the
    multiaxis engine, emit as JSON axis actions. React bridge to
    `forge.multiaxis.generate_multiaxis` — deterministic, sub-millisecond per
    chapter (pure Python, no subprocess). The Mechanical editor draws these
    live; export writes them as `<stem>.<axis>.funscript`."""
    from forge.multiaxis import generate_multiaxis
    from forge.multiaxis_presets import MULTIAXIS_PRESETS
    from forge.funscript import load_funscript_strict, parse_actions

    times, pos = parse_actions(load_funscript_strict(args.input))
    pairs = list(zip(times, pos))
    if args.start_ms is not None or args.end_ms is not None:
        lo = args.start_ms if args.start_ms is not None else (times[0] if times else 0)
        hi = args.end_ms if args.end_ms is not None else (times[-1] if times else 0)
        pairs = [(t, p) for t, p in pairs if lo <= t <= hi]

    style = args.style
    if len(pairs) < 2 or not style or style == "None" or style not in MULTIAXIS_PRESETS:
        # Nothing to generate (stroke-only / None / unknown style).
        print(json.dumps({"available": True, "style": style, "axes": {}}))
        return

    win = [{"at": int(t), "pos": int(round(p))} for t, p in pairs]
    phrases = [{"start_ms": pairs[0][0], "end_ms": pairs[-1][0]}]
    res = generate_multiaxis(win, phrases, {0: style}, MULTIAXIS_PRESETS)

    _passages = _load_resolved_passages(args.input)
    axes = {}
    for name in ("twist", "roll", "pitch", "surge", "sway"):
        sig = getattr(res, name)
        if sig and sig.times_ms:
            acts = [
                {"at": int(t), "pos": int(round(p))}
                for t, p in zip(sig.times_ms, sig.positions)
            ]
            if _passages:
                from forge import passages as _passages_mod
                acts = _passages_mod.scale_axis(acts, _passages)
            axes[name] = {"actions": acts}
    print(json.dumps({"available": True, "style": style, "axes": axes}))


def _catalog_dir() -> Path:
    return Path(__file__).resolve().parent / "catalog"


def _load_edger_definitions() -> dict:
    """Load the vendored Edger event_definitions.yml (snapshot of
    funscript-tools/config.event_definitions.yml)."""
    import yaml
    p = _catalog_dir() / "edger_event_definitions.yml"
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}


def _load_edger_map() -> dict:
    """Load our SFW/NSFW label + param map, keyed by edger event name."""
    import yaml
    p = _catalog_dir() / "edger_event_map.yml"
    if not p.exists():
        return {}
    doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    by_edger = {}
    for m in (doc.get("mappings") or []):
        if m.get("edger"):
            by_edger[m["edger"]] = m
    return by_edger


def _group_for(name: str, groups: list) -> dict:
    """Pick the group whose prefix the event name starts with (longest
    non-empty prefix wins; '' = General fallback)."""
    best = {"key": "general", "name": "General", "prefix": "", "description": ""}
    best_len = -1
    for g in groups:
        pre = g.get("prefix", "") or ""
        if (pre == "" and best_len < 0) or (pre and name.startswith(pre) and len(pre) > best_len):
            best = {"key": (pre.rstrip("_") or "general"),
                    "name": g.get("name", "General").split("(")[0].strip(),
                    "prefix": pre, "description": g.get("description", "")}
            best_len = len(pre)
    return best


def _pretty_label(name: str, prefix: str) -> str:
    stem = name[len(prefix):] if prefix and name.startswith(prefix) else name
    return stem.replace("_", " ").strip().title() or name


def _param_spec(key: str, default):
    """UI slider range for an event default_param, by name — grounded in the
    Edger normalization table (pulse_frequency max 120 Hz, pulse_width 100%,
    frequency 1200 Hz, volume 1.0) and the observed default ranges across the 32
    events. Rules are ordered so the specific cases win before the generic ones;
    every event's default must land inside its [min, max] (verified by test)."""
    k = key.lower()
    try:
        d = float(default)
    except (TypeError, ValueError):
        d = 0.0

    # Envelope timings (ms) — ramp_in/out/up, ramp_ms, duration. ramp_in_ms
    # reaches 10000 on long oscillation events, so keep generous headroom.
    if "ramp" in k or k.endswith("_ms") or "duration" in k:
        return {"min": 0, "max": 12000, "step": 50, "unit": "ms"}
    # Waveform phase offset (degrees).
    if "phase" in k:
        return {"min": 0, "max": 360, "step": 5, "unit": "°"}
    # Signed carrier-frequency shift (clutch sweeps run ±50 Hz).
    if "freq_shift" in k:
        return {"min": -120, "max": 120, "step": 5, "unit": "Hz"}
    # Pulse rate — the pulse_frequency axis (normalized by 120 Hz).
    if "pulse_rate" in k or "pulse_freq" in k:
        return {"min": 0, "max": 120, "step": 1, "unit": "Hz"}
    # Pulse-width MODULATION swing (wobble) is in % of width, not 0–1.
    if "wobble_amplitude" in k:
        return {"min": 0, "max": 50, "step": 0.5, "unit": "%"}
    # Pulse width itself (%) — guard against the amplitude case above.
    if "width" in k:
        return {"min": 0, "max": 100, "step": 1, "unit": "%"}
    # Slow stroke / carrier rate (0.25–2 on stroke_freq; lone `frequency`=1).
    if "stroke_freq" in k or k == "frequency":
        return {"min": 0, "max": 5, "step": 0.05, "unit": "Hz"}
    # Other oscillation / buzz frequencies (Hz, ~1.5–65; avoid 10-multiples).
    if "freq" in k:
        return {"min": 0, "max": 80, "step": 0.5, "unit": "Hz"}
    # Oscillation / buzz amplitudes — normalized swing, non-negative (≤0.85).
    if "amplitude" in k or "intensity" in k:
        return {"min": 0, "max": 1, "step": 0.01, "unit": ""}
    # Volume-domain offsets / boosts — normalized, signed (−0.4 … 0.2 observed).
    if ("volume" in k or "boost" in k or "offset" in k or "level" in k
            or "drop" in k or "reduction" in k):
        return {"min": -1, "max": 1, "step": 0.01, "unit": ""}
    # Fallback: bracket the default symmetrically if signed, else 0..2·default.
    if d < 0:
        return {"min": min(-1.0, d * 2), "max": 1, "step": 0.01, "unit": ""}
    hi = max(1.0, d * 2) if d > 0 else 1.0
    return {"min": 0, "max": hi, "step": 0.05, "unit": ""}


def cmd_list_event_recipes(args):
    """Project the vendored Edger event_definitions.yml (+ our SFW/NSFW map)
    into the catalog the Events tab consumes: all 32 events grouped by source
    (General / MCB / Clutch / Test), each with labels, real default_params as
    tunables, and the step stack (the 'what this produces' call list). Backend-
    sourced so it never drifts from funscript-tools."""
    defs_doc = _load_edger_definitions()
    groups_cfg = defs_doc.get("groups", [])
    definitions = defs_doc.get("definitions", {})
    emap = _load_edger_map()

    out_groups, seen = [], set()
    for g in groups_cfg:
        nm = g.get("name", "General").split("(")[0].strip()
        key = (g.get("prefix", "") or "").rstrip("_") or "general"
        if key not in seen:
            seen.add(key)
            out_groups.append({"key": key, "name": nm, "desc": g.get("description", "")})

    recipes = []
    for name, definition in definitions.items():
        grp = _group_for(name, groups_cfg)
        m = emap.get(name, {})
        dparams = definition.get("default_params", {}) or {}
        params = []
        for pk, pv in dparams.items():
            if pk == "duration_ms":
                continue  # duration is derived from the event span, not a tunable
            spec = _param_spec(pk, pv)
            params.append({
                "key": pk,
                "label": pk.replace("_", " ").title(),
                "def": pv, **spec,
            })
        steps = []
        for s in definition.get("steps", []):
            steps.append({
                "op": s.get("operation", ""),
                "axis": s.get("axis", ""),
                "params": s.get("params", {}) or {},
            })
        recipes.append({
            "id": name,
            "name": name,
            "group": grp["key"],
            "label": m.get("sfw_label") or _pretty_label(name, grp["prefix"]),
            "sfwLabel": m.get("sfw_label") or _pretty_label(name, grp["prefix"]),
            "nsfwLabel": m.get("nsfw_label") or _pretty_label(name, grp["prefix"]),
            "branded": bool(m.get("sfw_label")),
            "featured": bool(m.get("featured")),
            "desc": m.get("desc", ""),
            "defaultParams": dparams,
            "params": params,
            "steps": steps,
        })

    print(json.dumps({"groups": out_groups, "recipes": recipes}))


# ── Edger export / import (.feel.yml ↔ playable <stem>.events.yml) ──────────
# The .feel.yml is the canonical authoring file; the Edger events.yml is a
# derived, playable projection (funscript-tools format). effectId IS the Edger
# event name, so the effect/name round-trip is lossless; FF-only fields
# (intensity / devices / overrides) have no Edger representation and live only
# in .feel.yml.
def _events_yml_path(target, out=None) -> Path:
    """Edger events file path. Default: `<dir>/<stem>.events.yml` SIBLING of
    the source — funscript-tools resolves `<stem>.<axis>.funscript` next to the
    events file, and its base name MUST be exactly `<stem>.events.yml`."""
    if out:
        return Path(out)
    p = Path(target)
    return p.resolve().parent / f"{p.stem}.events.yml"


def _canonical_to_edger(e: dict) -> dict:
    """One canonical .feel.yml event → an Edger user event `{time, name,
    params}`. The captured span becomes `params.duration_ms` (how Edger
    controls effect length)."""
    begin = int(e.get("begin_ms", 0))
    end = int(e.get("end_ms", begin))
    params = dict(e.get("params") or {})
    params["duration_ms"] = max(0, end - begin)
    return {"time": begin, "name": e.get("effect"), "params": params}


def _edger_to_canonical(ev: dict, idx: int, definitions: dict) -> dict:
    """One Edger user event → canonical .feel.yml event. `duration_ms` (from
    params, else the definition default) sets the span; FF-only fields get
    defaults the UI fills in on first edit."""
    name = ev.get("name")
    time = int(ev.get("time", 0))
    params = dict(ev.get("params") or {})
    dur = params.pop("duration_ms", None)
    if dur is None:
        dur = (definitions.get(name, {}).get("default_params", {}) or {}).get("duration_ms", 5000)
    return {
        "id": f"e-cap-{idx}",
        "begin_ms": time,
        "end_ms": time + int(dur),
        "effect": name,
        "intensity": 0.7,
        "params": params,
        "devices": [],
        "overrides": {},
    }


def _fmt_clock_ms(ms) -> str:
    """ms → mm:ss.mmm — the clock the Events timeline shows, so an exported
    event's raw `time:` (ms) can be eyeballed against the tab."""
    total = max(0, int(ms))
    m, rem = divmod(total, 60000)
    s, f = divmod(rem, 1000)
    return f"{m:02d}:{s:02d}.{f:03d}"


def cmd_edger_export(args):
    """Project the canonical `<stem>.feel.yml` into a playable Edger
    `<stem>.events.yml`. The synthetic Normal baseline is skipped (not an Edger
    event). Each event is annotated with a comment (clock · duration · friendly
    label) so the raw Edger name/ms reconciles to what the tab shows — comments
    are ignored by funscript-tools' parser. Writes the file unless --no-write;
    always echoes the rendered YAML so the UI can preview without writing."""
    import yaml
    target = Path(args.input)
    feel = _feel_path(target)
    events = []
    if feel.exists():
        try:
            doc = yaml.safe_load(feel.read_text(encoding="utf-8")) or {}
            events = (doc.get("events") or []) if isinstance(doc, dict) else []
        except yaml.YAMLError:
            events = []

    edger, skipped = [], []
    for e in events:
        name = e.get("effect")
        if not name or name == "normal":
            if name:
                skipped.append(name)
            continue
        edger.append(_canonical_to_edger(e))
    edger.sort(key=lambda x: x["time"])

    # Render with a reconciliation comment above each event. The map gives the
    # SFW label for the raw Edger name; clock + duration mirror the timeline.
    emap = _load_edger_map()

    def _sfw(nm):
        return (emap.get(nm, {}) or {}).get("sfw_label") or nm

    header = [
        "# FunscriptForge -> Edger events.yml",
        f"# {Path(target).stem} · {len(edger)} event(s)",
        "# Comments below map each raw Edger name to the clock time + friendly",
        "# label shown in the Events tab. They're ignored when the file is played.",
    ]
    if not edger:
        text = "\n".join(header) + "\nevents: []\n"
    else:
        lines = list(header)
        lines.append("events:")
        for e in edger:
            dur_ms = (e.get("params") or {}).get("duration_ms", 0)
            lines.append(f"# {_fmt_clock_ms(e['time'])}  +{int(dur_ms) / 1000:.1f}s  {_sfw(e['name'])}")
            block = yaml.safe_dump([e], sort_keys=False, allow_unicode=True).rstrip("\n")
            lines.extend(block.splitlines())
        text = "\n".join(lines) + "\n"
    written = None
    if not args.no_write:
        out_path = _events_yml_path(target, args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        written = str(out_path)
    print(json.dumps({
        "path": written, "count": len(edger),
        "skipped": skipped, "yaml": text,
    }))


def cmd_edger_import(args):
    """Read an Edger `events.yml` and emit events in the EventsTab JS shape
    (the UI persists them via feel-write). Events whose name isn't in our
    vendored definitions are skipped and reported, not silently dropped."""
    import yaml
    src = Path(args.events_yml)
    try:
        doc = yaml.safe_load(src.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"Error reading {src}: {exc}", file=sys.stderr)
        sys.exit(1)
    raw = (doc.get("events") or []) if isinstance(doc, dict) else []
    definitions = _load_edger_definitions().get("definitions", {})

    canonical, skipped, idx = [], [], 0
    for ev in raw:
        if not isinstance(ev, dict) or "time" not in ev or "name" not in ev:
            skipped.append(ev.get("name") if isinstance(ev, dict) else "?")
            continue
        if ev["name"] not in definitions:
            skipped.append(ev["name"])
            continue
        idx += 1
        canonical.append(_edger_to_canonical(ev, idx, definitions))
    canonical.sort(key=lambda c: c["begin_ms"])

    print(json.dumps({
        "events": [_canonical_to_js(c) for c in canonical],
        "imported": len(canonical),
        "skipped": skipped,
    }))


def cmd_auto_chapter(args):
    """Run videoflow.structural.auto_chapter on a media file.

    Writes <stem>.chapters.json next to the media (unless --no-write).
    Returns the resulting chapter list as JSON so the caller can hydrate
    its UI immediately without re-reading the sidecar.
    """
    from videoflow.structural import auto_chapter, AutoChapterError

    try:
        chapters = auto_chapter(
            args.media,
            target_minutes=args.target_minutes,
            write_sidecar=not args.no_write,
            resume=args.resume,
            on_progress=_make_stage_event_emitter(),
        )
    except AutoChapterError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    records = _normalize_chapter_list(chapters)
    payload = {"chapters": records, "written": not args.no_write}

    if args.format == "json":
        print(json.dumps(payload))
    else:
        print(f"Detected {len(records)} chapter(s) via videoflow.structural:")
        for c in records:
            print(f"  {c['at_ms']:>10}ms - {c['end_ms']:>10}ms  "
                  f"{c['content_type'] or '-':<7}  conf={c['confidence']:.2f}")
        if not args.no_write:
            print(f"\nSidecar written next to: {args.media}")


# ------------------------------------------------------------------
# generate — beat-map → funscript (the videoflow engine, in-app)
# ------------------------------------------------------------------

# The proven-band targets from the data-science work (memory:
# project_forgegen_generation_correctness). Generation aims to land the
# windowed dynamics INSIDE these bands, not to hit a single gold script.
_RATE_COV_BAND = (0.37, 0.46)      # density dynamics across windows
_VELOCITY_COV_BAND = (0.21, 0.30)  # intensity dynamics across windows


def _parse_curve(spec: str | None) -> list[float]:
    """Parse a ``"0.3,0.5,1.0"`` curve spec into a list of [0,1] floats.

    These are control samples spread evenly over the track's [0,1] position
    range — the UI's Range/Pace lanes sample their preset curves to exactly
    this shape. Empty / None → ``[]`` (caller decides the fallback)."""
    if not spec:
        return []
    out: list[float] = []
    for tok in spec.split(","):
        tok = tok.strip()
        if not tok:
            continue
        out.append(max(0.0, min(1.0, float(tok))))
    return out


def _sample_curve_at(samples: list[float], p: float) -> float:
    """Linear-interpolate a control-sample curve at normalised position ``p``.

    ``samples`` are evenly spaced over [0,1]; ``p`` is clamped to [0,1].
    Mirrors ``data/generate.js::sampleCurve`` closely enough for parity (the
    JS uses smoothstep between control points; here we keep it linear because
    the curve is already densely sampled before it reaches the CLI)."""
    if not samples:
        return 0.5
    if len(samples) == 1:
        return samples[0]
    x = max(0.0, min(1.0, p)) * (len(samples) - 1)
    i = int(x)
    if i >= len(samples) - 1:
        return samples[-1]
    frac = x - i
    return samples[i] * (1.0 - frac) + samples[i + 1] * frac


def _curve_to_beat_arc(samples: list[float], beats: list[int]) -> list[float] | None:
    """Resample a control-sample curve onto per-beat positions.

    The shared core for both arcs the engine consumes: each beat's normalised
    track position is mapped through the curve. Empty curve / no beats → None
    (the engine then uses its flat fallback)."""
    if not samples or not beats:
        return None
    b0, b1 = beats[0], beats[-1]
    span = (b1 - b0) or 1
    return [_sample_curve_at(samples, (b - b0) / span) for b in beats]


def _pace_to_density_arc(pace: list[float], beats: list[int]) -> list[float] | None:
    """Pace curve → ``density_arc`` (step 1): the author-declared NARRATIVE
    density arc (energy→density was refuted — busyness is authored, not
    loudness). Thin alias over :func:`_curve_to_beat_arc`."""
    return _curve_to_beat_arc(pace, beats)


def _in_band(value: float, band: tuple[float, float]) -> bool:
    return band[0] <= value <= band[1]


def _beatmap_sidecar_path(media: str):
    """Path to the persisted FULL beat map for *media* (forge dir)."""
    from pathlib import Path
    from videoflow.sidecar import forge_dir
    return forge_dir(media) / f"{Path(media).stem}.beatmap.json"


def _generate_sidecar_path(media: str):
    """Path to the persisted Generate-tab session for *media* (forge dir).

    ``<dir>/.<stem>.forge/<stem>.generate.json`` — the small record that lets
    the Generate tab restore on app restart: the picked curves/start/texture
    (opaque UI blob), the result metadata (band/speed/bpm), and a pointer to
    the already-persisted generated funscript. The actions themselves are NOT
    stored here (they live in the generated .funscript); the UI reads them
    back from the ``output`` pointer. Mirrors ``_beatmap_sidecar_path``.
    """
    from pathlib import Path
    from videoflow.sidecar import forge_dir
    return forge_dir(media) / f"{Path(media).stem}.generate.json"


_GENERATE_SIDECAR_VERSION = 1


# Default time-chunk width (seconds) for analysis. Long files are analysed
# in ~3-minute windows so a multi-hour pass emits per-chunk progress
# ("chunk 4/12") instead of looking hung inside one monolithic librosa call,
# and energy is normalised per window (a quiet intro isn't crushed by a loud
# climax). Mirrors videoflow.audio.DEFAULT_CHUNK_SECS; short files stay a
# single window (no behaviour change). Pass chunk_secs=None to disable.
_DEFAULT_CHUNK_SECS = 180.0


def _load_or_analyze_beatmap(
    media, *, source="full", tracker="plp", chunk_secs=_DEFAULT_CHUNK_SECS,
    force=False, persist=True,
):
    """Return ``(AudioBeatMap, from_cache, sidecar_path)`` for *media*.

    Prefers the persisted full beat map (``<stem>.beatmap.json`` in the forge
    dir); analyzes on a miss (the octave guard is applied inside
    ``analyze_beats``) and persists the result. This is the shared substrate:
    every device generator — 1-axis, shaker, multi-axis — reads the SAME
    beats + energy + stanzas without re-running librosa. Generation rides the
    analyze pass (hide work inside an existing wait).

    Tracker defaults to **PLP** (predominant local pulse), not the global
    ``beat_track``: PLP follows the continuous pulse and places beats through
    weak / non-percussive sections (a soft intro with no bass or click) that
    ``beat_track`` thresholds out entirely. Proven on VO ch8 (2026-06-14):
    beat_track found 0 beats before 61.5s; PLP found 118 in the first minute,
    matching what a hand/PythonDancer script covers. The mode classifier then
    scales those low-energy beats down, so the intro strokes are present but
    gentle — depth still never scales with the signal.

    The cache stores its ``tracker``/``source`` provenance and self-invalidates
    when they differ (so an old beat_track map that misses the intro is not
    silently reused)."""
    from videoflow.audio import AudioBeatMap, analyze_beats
    sidecar = _beatmap_sidecar_path(media)
    # chunk_secs changes the per-window energy normalization, so it is part of
    # the cache identity alongside tracker/source.
    chunk_tag = round(float(chunk_secs), 1) if chunk_secs else 0
    if not force and sidecar.exists():
        try:
            cached = json.loads(sidecar.read_text(encoding="utf-8"))
            if (cached.get("tracker") == tracker
                    and cached.get("source", source) == source
                    and cached.get("chunk_secs", chunk_tag) == chunk_tag):
                return AudioBeatMap.load(sidecar), True, sidecar
        except Exception:
            pass  # corrupt / stale / different-provenance cache → re-analyze
    beat_map = analyze_beats(
        media, source=source, tracker=tracker, chunk_secs=chunk_secs,
        on_progress=_make_stage_event_emitter(),
    )
    if persist:
        sidecar.parent.mkdir(parents=True, exist_ok=True)
        beat_map.save(sidecar)
        # Annotate provenance so the cache can self-invalidate on
        # tracker/source/chunk change (AudioBeatMap.load ignores extra keys).
        try:
            d = json.loads(sidecar.read_text(encoding="utf-8"))
            d["tracker"] = tracker
            d["source"] = source
            d["chunk_secs"] = chunk_tag
            sidecar.write_text(json.dumps(d), encoding="utf-8")
        except Exception:
            pass
    return beat_map, False, sidecar


@_cli_command
def cmd_beatmap(args):
    """Analyze + PERSIST the full AudioBeatMap (the shared generation substrate).

    Runs ``videoflow.analyze_beats`` (octave guard folded in) and saves the
    full map — beats + energy + stanzas + downbeats + corrected BPM — to
    ``<stem>.beatmap.json`` in the forge dir. This is the one analysis every
    device generator reads, so generation never re-runs librosa. Reuses the
    cache unless ``--force``.
    """
    beat_map, from_cache, sidecar = _load_or_analyze_beatmap(
        args.media, source=args.source, tracker=args.tracker,
        chunk_secs=args.chunk_secs, force=args.force,
    )
    payload = {
        "ok": True,
        "beatmap": str(sidecar),
        "from_cache": from_cache,
        "beats": len(beat_map.beats),
        "bpm": round(beat_map.bpm, 1),
        "stanzas": len(beat_map.stanzas),
        "duration_ms": beat_map.duration_ms,
    }
    if args.format == "json":
        print(json.dumps(payload))
    else:
        src = "cache" if from_cache else "analyzed"
        print(f"Beatmap ({src}): {sidecar}")
        print(f"  {len(beat_map.beats)} beats | {beat_map.bpm:.0f} BPM | "
              f"{len(beat_map.stanzas)} stanzas | "
              f"{beat_map.duration_ms / 1000:.0f}s")


@_cli_command
def cmd_generate(args):
    """Generate a funscript from a beat map (videoflow engine, in-process).

    Steps 1-2 of the generation merge. The **Pace** curve drives
    ``density_arc`` (how busy — the proven narrative-density core) and the
    **Range** curve drives ``gain_arc`` (how far — a per-position amplitude
    gain that scales the fixed mode depth, so reach can rise over the track
    without reintroducing the refuted energy→amplitude law). Emits the written
    funscript plus a quality fingerprint (decile shape + dynamics CoV vs the
    proven band) so output is gradeable against the oracle without leaving
    the CLI.

    Beat-map source (exactly one):
      --beats <full AudioBeatMap json>  (energies + stanzas — what generation needs)
      --media <file>                    (analyze on the fly; slow, needs librosa+ffmpeg)
    """
    from videoflow.audio import AudioBeatMap
    from videoflow.generate import generate_from_beats
    from videoflow.funscript_stats import summarize

    if bool(args.beats) == bool(args.media):
        raise ValueError("pass exactly one of --beats <beatmap.json> or --media <file>")

    _emit_progress("start::1::beatmap")
    from_cache = False
    if args.beats:
        beat_map = AudioBeatMap.load(args.beats)
        if not beat_map.energy or not beat_map.stanzas:
            raise ValueError(
                f"{args.beats} is a reduced beat sidecar (no energy/stanzas) — "
                "generation needs a full AudioBeatMap (use --media to analyze, "
                "or persist the full map during the analyze pass)."
            )
    else:
        # Reuse the persisted full beat map when present; analyze + persist on
        # a miss so the next generate (any device) is instant.
        beat_map, from_cache, _ = _load_or_analyze_beatmap(
            args.media, source=args.source, tracker=args.tracker,
            chunk_secs=args.chunk_secs, force=args.force,
        )
    _emit_progress(f"done::1::beatmap::{len(beat_map.beats)} beats @ {beat_map.bpm:.0f} BPM")

    pace = _parse_curve(args.pace_curve)
    rng = _parse_curve(args.range_curve)
    density_arc = _pace_to_density_arc(pace, beat_map.beats)
    # Range curve → per-beat amplitude-GAIN arc (step 2): scales the fixed
    # mode depth, so "Range" can rise over the track without reintroducing
    # the refuted energy→amplitude law. See generate.beats_to_curve(gain_arc=).
    gain_arc = _curve_to_beat_arc(rng, beat_map.beats)

    _emit_progress("start::1::generate")
    path = generate_from_beats(
        beat_map,
        args.output,
        low=args.low,
        high=args.high,
        center=args.center,
        stroke_density=args.stroke_density,
        density_arc=density_arc,
        gain_arc=gain_arc,
        texture=args.texture,
        title=args.title or "",
        # msg::2 so the App footer's rolling headline shows the stage
        # explanation ("Classifying…", "Generating motion curve…") — the
        # footer is where the user watches generation happen.
        progress_callback=lambda label: _emit_progress(f"msg::2::generate::{label}"),
    )
    _emit_progress("done::1::generate")

    # Grade the result against the oracle — the same fingerprint the user
    # diagnostic lens and the generation bench use (videoflow.funscript_stats).
    actions = json.loads(Path(path).read_text(encoding="utf-8"))["actions"]
    fp = summarize(actions)
    dyn = fp.get("dynamics", {})
    rate_cov = dyn.get("rate_cov", 0.0)
    vel_cov = dyn.get("velocity_cov", 0.0)

    payload = {
        "ok": True,
        "output": str(path),
        "title": args.title or "",
        "source": "beats" if args.beats else "media",
        "from_cache": from_cache,
        "beats": len(beat_map.beats),
        "bpm": round(beat_map.bpm, 1),
        "duration_ms": beat_map.duration_ms,
        # Set when the source audio was corrupt past this ms and only the clean
        # head was analyzable — the UI shows a persistent 'damaged audio'
        # warning so a short/sparse result on a broken source isn't a surprise.
        "damaged_after_ms": beat_map.damaged_after_ms,
        "actions": len(actions),
        "pace_points": len(pace),
        "range_points": len(rng),
        "density_arc": density_arc is not None,
        "gain_arc": gain_arc is not None,   # Range arc — honoured (step 2)
        "stats": fp,
        # The UI bridge wants the actions back to render the chart + diagnosis
        # without a second file read (mirrors the stand-in generateFromLanes
        # return shape). Off by default to keep batch/CLI payloads lean.
        "actions_list": actions if args.emit_actions else None,
        "band": {
            "rate_cov": round(rate_cov, 3),
            "rate_cov_band": list(_RATE_COV_BAND),
            "rate_cov_in_band": _in_band(rate_cov, _RATE_COV_BAND),
            "velocity_cov": round(vel_cov, 3),
            "velocity_cov_band": list(_VELOCITY_COV_BAND),
            "velocity_cov_in_band": _in_band(vel_cov, _VELOCITY_COV_BAND),
        },
    }

    # Persist the Generate-tab session (media path only — the sidecar is
    # media-keyed). Lets the tab restore the picked curves + the real result on
    # app restart instead of re-running the 3-10 min analyze+generate. Small by
    # design: result metadata + a pointer to the generated funscript, never the
    # actions (those live in the .funscript and are re-read from `output`). The
    # UI blob (--ui-state) is stored verbatim so JS owns its own shape.
    if args.media:
        ui_state = None
        if getattr(args, "ui_state", None):
            try:
                ui_state = json.loads(args.ui_state)
            except (ValueError, TypeError):
                ui_state = None
        sc = {
            "version": _GENERATE_SIDECAR_VERSION,
            "ok": True,
            "media": str(args.media),
            "output": str(path),
            "sig": (ui_state or {}).get("sig") if isinstance(ui_state, dict) else None,
            "ui": ui_state,
            "bpm": payload["bpm"],
            "duration_ms": payload["duration_ms"],
            "actions": payload["actions"],
            "from_cache": from_cache,
            "damaged_after_ms": beat_map.damaged_after_ms,
            "band": payload["band"],
            "speed": fp.get("speed"),
        }
        try:
            scp = _generate_sidecar_path(args.media)
            scp.parent.mkdir(parents=True, exist_ok=True)
            scp.write_text(json.dumps(sc), encoding="utf-8")
            payload["sidecar"] = str(scp)
        except OSError:
            pass  # non-fatal: generation succeeded; persistence is best-effort

    if args.format == "json":
        print(json.dumps(payload))
    else:
        pos = fp.get("position", {})
        print(f"Generated: {path}")
        print(f"  {len(actions)} actions | {len(beat_map.beats)} beats | "
              f"{beat_map.bpm:.0f} BPM | {beat_map.duration_ms / 1000:.0f}s")
        print(f"  shape: rails {pos.get('rails_pct', 0)}% / "
              f"mid {pos.get('mid_pct', 0)}% "
              f"({'bimodal OK' if pos.get('bimodal') else 'centered BAD'})")
        rmark = "OK " if payload["band"]["rate_cov_in_band"] else "out"
        vmark = "OK " if payload["band"]["velocity_cov_in_band"] else "out"
        print(f"  dynamics: rate CoV {rate_cov:.3f} [{rmark}] "
              f"(band {_RATE_COV_BAND[0]}-{_RATE_COV_BAND[1]}) | "
              f"vel CoV {vel_cov:.3f} [{vmark}] "
              f"(band {_VELOCITY_COV_BAND[0]}-{_VELOCITY_COV_BAND[1]})")
        spd = fp.get("speed", {})
        if spd.get("n"):
            parts = [f"{b} {p}%" for b, p in zip(spd["bins"], spd["pct"]) if p > 0]
            print(f"  speed: {' / '.join(parts)}")


@_cli_command
def cmd_generate_read(args):
    """Read the persisted Generate-tab session for *media* (or report absence).

    The Generate tab calls this on mount: a hit restores the picked curves +
    the real result without re-running analyze+generate. Returns
    ``{ok: false}`` when no sidecar exists (a fresh project) or it's a
    different schema version — the tab then falls back to its defaults.
    """
    scp = _generate_sidecar_path(args.media)
    if not scp.exists():
        print(json.dumps({"ok": False, "reason": "absent"}))
        return
    try:
        data = json.loads(scp.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        print(json.dumps({"ok": False, "reason": "unreadable"}))
        return
    if data.get("version") != _GENERATE_SIDECAR_VERSION:
        print(json.dumps({"ok": False, "reason": "version"}))
        return
    # Don't serve a session whose generated funscript has since been deleted —
    # the actions are read from `output`, so a dangling pointer is a miss.
    out = data.get("output")
    if out and not Path(out).exists():
        print(json.dumps({"ok": False, "reason": "output_missing"}))
        return
    data["ok"] = True
    print(json.dumps(data))


# ------------------------------------------------------------------
# Argument parser
# ------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cli.py",
        description="FunscriptForge — analyze and transform funscripts",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- pipeline ---
    p_pipe = sub.add_parser(
        "pipeline",
        help="Run all three stages (assess -> transform -> customize) in one step",
    )
    p_pipe.add_argument("funscript", help="Path to source .funscript file")
    p_pipe.add_argument(
        "--output-dir", help="Directory for all output files (default: ./output/)"
    )
    p_pipe.add_argument("--perf", help="Performance windows JSON")
    p_pipe.add_argument(
        "--break", dest="break_windows", help="Break windows JSON"
    )
    p_pipe.add_argument("--raw", help="Raw-preserve windows JSON")
    p_pipe.add_argument("--beats", help="Beats JSON (enables beat accents)")
    p_pipe.add_argument("--transformer-config", help="Transformer config JSON")
    p_pipe.add_argument("--customizer-config", help="Customizer config JSON")
    p_pipe.add_argument(
        "--min-phrase-duration", type=float, metavar="SECONDS",
        help="Merge phrases shorter than this many seconds (default: 20)",
    )
    p_pipe.add_argument(
        "--amplitude-tolerance", type=float, metavar="FRACTION",
        help="Phrase break sensitivity fraction (lower = more sensitive; default: 0.30)",
    )

    # --- assess ---
    p_assess = sub.add_parser("assess", help="Step 1: analyze a funscript")
    p_assess.add_argument("funscript", help="Path to input .funscript file")
    p_assess.add_argument("--output", help="Path for the assessment JSON output")
    p_assess.add_argument("--config", help="Path to analyzer config JSON (optional)")
    p_assess.add_argument(
        "--min-phrase-duration", type=float, metavar="SECONDS",
        help="Merge phrases shorter than this many seconds into neighbours (default: 20)",
    )
    p_assess.add_argument(
        "--amplitude-tolerance", type=float, metavar="FRACTION",
        help="Phrase break sensitivity: fraction of amplitude deviation to trigger a new phrase "
             "(lower = more sensitive, e.g. 0.25; default: 0.30)",
    )
    p_assess.add_argument(
        "--format", choices=["table", "json"], default="table",
        help="Output format: 'table' (default, human-readable summary) or 'json' "
             "(structured payload to stdout for programmatic consumers like the Tauri UI).",
    )
    p_assess.add_argument(
        "--no-save", action="store_true",
        help="Skip writing the *_assessment.json sidecar file. Only meaningful with --format json.",
    )

    # --- transform ---
    p_tx = sub.add_parser("transform", help="Step 3: BPM-threshold transform")
    p_tx.add_argument("funscript", help="Path to input .funscript file")
    p_tx.add_argument("--assessment", required=True, help="Path to assessment JSON")
    p_tx.add_argument("--output", help="Path for the output .funscript file")
    p_tx.add_argument("--config", help="Path to transformer config JSON")

    # --- customize ---
    p_cust = sub.add_parser("customize", help="Step 4: apply user-defined windows")
    p_cust.add_argument("funscript", help="Path to transformed .funscript file")
    p_cust.add_argument("--assessment", required=True, help="Path to assessment JSON")
    p_cust.add_argument("--output", help="Path for the customized .funscript file")
    p_cust.add_argument("--config", help="Path to customizer config JSON")
    p_cust.add_argument("--perf", help="Path to performance windows JSON")
    p_cust.add_argument(
        "--break", dest="break_windows", help="Path to break windows JSON"
    )
    p_cust.add_argument("--raw", help="Path to raw-preserve windows JSON")
    p_cust.add_argument("--beats", help="Path to beats JSON (enables beat accents)")

    # --- visualize ---
    p_viz = sub.add_parser("visualize", help="Visualize an assessment (requires matplotlib)")
    p_viz.add_argument("funscript", help="Path to input .funscript file")
    p_viz.add_argument("--assessment", required=True, help="Path to assessment JSON")
    p_viz.add_argument("--output", help="Path for the output PNG file")

    # --- config ---
    p_cfg = sub.add_parser("config", help="Dump default config to JSON")
    p_cfg.add_argument("--output", help="Output path")
    p_cfg.add_argument(
        "--customizer", action="store_true",
        help="Dump customizer config instead of transformer config",
    )
    p_cfg.add_argument(
        "--analyzer", action="store_true",
        help="Dump analyzer config instead of transformer config",
    )

    # --- phrase-transform ---
    p_pt = sub.add_parser(
        "phrase-transform",
        help="Apply a catalog transform to one or all phrases",
    )
    p_pt.add_argument("funscript", help="Path to input .funscript file")
    p_pt.add_argument("--assessment", required=True, help="Path to assessment JSON")
    p_pt.add_argument("--output", help="Path for output .funscript (default: *_phrase_transformed.funscript)")
    p_pt.add_argument(
        "--transform", metavar="KEY",
        help="Transform to apply (see 'python cli.py list-transforms' for all keys).",
    )
    p_pt.add_argument(
        "--phrase", type=int, metavar="N", action="append",
        help="1-based phrase index to transform (repeatable). Mutually exclusive with --all.",
    )
    p_pt.add_argument(
        "--all", action="store_true",
        help="Apply transform to every phrase.",
    )
    p_pt.add_argument(
        "--suggest", action="store_true",
        help="Use suggest_transform() to pick the best transform per phrase automatically.",
    )
    p_pt.add_argument(
        "--bpm-threshold", type=float, default=120.0, metavar="BPM",
        help="BPM threshold used by --suggest (default: 120.0).",
    )
    p_pt.add_argument(
        "--param", metavar="key=value", action="append",
        help="Override a transform parameter, e.g. --param scale=1.8 (repeatable).",
    )
    p_pt.add_argument(
        "--dry-run", action="store_true",
        help="Print the transform plan without writing any file.",
    )

    # --- transform-apply (UI bridge: preview + apply for one transform) ---
    p_ta = sub.add_parser(
        "transform-apply",
        help="Apply one transform to a set of spans (editor preview/apply bridge)",
    )
    p_ta.add_argument("funscript", help="Path to input .funscript file")
    p_ta.add_argument(
        "--transform", required=True, metavar="KEY",
        help="Transform key (see 'python cli.py list-transforms').",
    )
    p_ta.add_argument(
        "--spans", required=True, metavar="FILE|JSON",
        help="List of {start_ms, end_ms} spans (the edit set): a JSON file "
             "path or an inline JSON string.",
    )
    p_ta.add_argument(
        "--param", metavar="key=value", action="append",
        help="Override a transform parameter (repeatable). Keys must match list-transforms.",
    )
    p_ta.add_argument(
        "--params-json", metavar="FILE|JSON",
        help="{param: value} overrides as a JSON file path or inline JSON "
             "string (applied before --param).",
    )
    p_ta.add_argument(
        "--preview", action="store_true",
        help="Emit per-span transformed actions as JSON to stdout; write nothing.",
    )
    p_ta.add_argument(
        "--emit-actions", action="store_true",
        help="Emit the full MERGED action list as JSON {transform, params, "
             "actions} to stdout; write nothing. The editor's in-memory "
             "roll-forward path (Apply) — keeps Python the single source of "
             "the span-merge instead of re-deriving it in JS.",
    )
    p_ta.add_argument(
        "--output", metavar="FILE",
        help="Output .funscript path (apply mode; default: *_transform_applied.funscript).",
    )

    # --- polish-apply (UI bridge: clamp Channels output to device-ready files) ---
    p_pol = sub.add_parser(
        "polish-apply",
        help="Clamp a funscript for one Polish station (preview or write device-ready files)",
    )
    p_pol.add_argument("funscript", help="Path to the ORIGINAL source .funscript (owns stem, sidecars, and e-stim/TCode generation)")
    p_pol.add_argument(
        "--effective", metavar="PATH",
        help="Edited/effective motion funscript to clamp (defaults to the positional path). "
             "Stem, chapter/character sidecars, and generation always use the positional ORIGINAL.",
    )
    p_pol.add_argument(
        "--station", required=True, metavar="ID",
        help="Polish station: estim3p | handy | osr2 | sr6",
    )
    p_pol.add_argument(
        "--params-json", metavar="FILE|JSON",
        help="Knob overrides {key: value} as a JSON file path or inline JSON.",
    )
    p_pol.add_argument(
        "--stem", metavar="STEM",
        help="Output filename stem (default: the source stem).",
    )
    p_pol.add_argument(
        "--preview", action="store_true",
        help="Emit 3-pane trace JSON for a window; write nothing.",
    )
    p_pol.add_argument("--start-ms", type=int, help="Preview window start (ms).")
    p_pol.add_argument("--end-ms", type=int, help="Preview window end (ms).")

    # --- polish-channels (raw e-stim channels for a preview window) ---
    p_pc = sub.add_parser(
        "polish-channels",
        help="Generate raw e-stim channels for a window (Polish preview shows actual channels)",
    )
    p_pc.add_argument("funscript", help="Path to the source .funscript (owns stem + sidecars)")
    p_pc.add_argument("--station", required=True, metavar="ID", help="Polish station (estim3p)")
    p_pc.add_argument("--start-ms", type=int, required=True, help="Window start (ms).")
    p_pc.add_argument("--end-ms", type=int, required=True, help="Window end (ms).")

    # --- polish-read / polish-write (polish.yml stamp record) ---
    p_pr = sub.add_parser("polish-read", help="Read <stem>.polish.yml stamp record")
    p_pr.add_argument("input", help="Path to the source media/funscript")
    p_pw = sub.add_parser("polish-write", help="Write <stem>.polish.yml stamp record")
    p_pw.add_argument("input", help="Path to the source media/funscript")
    p_pw.add_argument(
        "--passes-json", required=True, metavar="FILE|-",
        help="Stamp record JSON (path, or '-' for stdin).",
    )

    # --- export (collect outputs into a loose folder or .forge zip) ---
    p_exp = sub.add_parser(
        "export",
        help="Collect project outputs (motion + Polish stations + events + sidecars) into a loose folder or a .forge zip",
    )
    p_exp.add_argument("funscript", help="Path to the effective input .funscript")
    p_exp.add_argument(
        "--mode", choices=["loose", "forge"], default="forge",
        help="loose = folder of files; forge = single .forge zip (default).",
    )
    p_exp.add_argument(
        "--out", metavar="PATH",
        help="Output path (default: <dir>/<stem>.output/ for loose, <dir>/<stem>.forge for forge).",
    )
    p_exp.add_argument("--stem", metavar="STEM", help="Bundle stem (default: source stem).")
    p_exp.add_argument("--effective", metavar="PATH", help="Edited (work) funscript to pack as motion; the positional arg stays the original (for stem/sidecars/generation).")
    p_exp.add_argument("--media", metavar="PATH", help="Media file for hero + per-chapter frame thumbnails (optional).")
    p_exp.add_argument("--blend-seams", action="store_true", help="Apply blend_seams to the main funscript.")
    p_exp.add_argument("--final-smooth", action="store_true", help="Apply final_smooth to the main funscript.")
    p_exp.add_argument(
        "--match-chapter-volume", action="store_true",
        help=(
            "Match e-stim volume across chapter seams. Channels are generated one "
            "chapter at a time and Edger's ramp restarts from 0, so every boundary "
            "drops; this lifts each chapter to the previous one's ending level and "
            "eases back to its own curve. Scene Builder / Scene Closer chapters are "
            "left alone."
        ),
    )
    p_exp.add_argument("--stim-wav", action="store_true", help="Render audio/stim.wav from the e-stim channels (opt-in).")
    p_exp.add_argument("--stim-mp3", action="store_true", help="Render audio/stim.mp3 from the e-stim channels (opt-in; via ffmpeg).")
    p_exp.add_argument("--beat-mp3", action=argparse.BooleanOptionalAction, default=True, help="Render audio/beat.mp3 (metronome click track) from the beatmap sidecar. On by default; --no-beat-mp3 to skip.")
    p_exp.add_argument("--include-media", action="store_true", help="Embed the source video/audio in the bundle for a standalone handoff (big). Default: lean bundle + manifest relink key.")
    p_exp.add_argument("--exclude", metavar="IDS", default="", help="Comma-separated target groups to leave OUT: strokers,estim,authoring,preview. Default: include all.")
    # Pre-rendered Preview PNGs from the app (the funscript player's EXACT lane
    # render). When supplied, these are packed verbatim instead of the
    # matplotlib stand-ins, so the bundle's previews match the editor. The
    # matplotlib renderers remain the fallback for headless/CLI exports.
    p_exp.add_argument("--preview-funscript", metavar="PNG", default=None, help="Pre-rendered funscript preview PNG (overrides the matplotlib render).")
    p_exp.add_argument("--preview-audio", metavar="PNG", default=None, help="Pre-rendered audio-waveform preview PNG.")
    p_exp.add_argument("--preview-spectrogram", metavar="PNG", default=None, help="Pre-rendered spectrogram preview PNG.")

    # --- import (unpack a .forge bundle into a re-editable project) ---
    p_imp = sub.add_parser(
        "import",
        help="Unpack a .forge bundle (or loose export folder) into a re-editable project on disk",
    )
    p_imp.add_argument("bundle", help="Path to the .forge zip (or an unzipped bundle folder).")
    p_imp.add_argument("--out", metavar="DIR", help="Destination folder (default: the bundle's own folder).")
    p_imp.add_argument("--stem", metavar="STEM", help="Override the project stem (default: manifest stem).")

    # --- finalize ---
    p_fin = sub.add_parser(
        "finalize",
        help="Apply blend_seams + final_smooth to the full action list before saving",
    )
    p_fin.add_argument("funscript", help="Path to input .funscript file")
    p_fin.add_argument("--output", help="Path for output .funscript (default: *_finalized.funscript)")
    p_fin.add_argument(
        "--param", metavar="PREFIX_key=value", action="append",
        help=(
            "Override a transform parameter. Prefix with seam_ for blend_seams params "
            "or smooth_ for final_smooth params. "
            "E.g. --param seam_max_velocity=0.3  --param smooth_strength=0.05"
        ),
    )
    p_fin.add_argument(
        "--skip-seams", action="store_true",
        help="Skip the blend_seams step.",
    )
    p_fin.add_argument(
        "--skip-smooth", action="store_true",
        help="Skip the final_smooth step.",
    )

    # --- catalog ---
    p_cat = sub.add_parser(
        "catalog",
        help="Inspect or manage the cross-funscript pattern catalog",
    )
    p_cat.add_argument(
        "--catalog", metavar="PATH",
        help="Path to catalog JSON (default: output/pattern_catalog.json)",
    )
    p_cat.add_argument(
        "--tag", metavar="KEY",
        help="Show all stored phrases for one behavioral tag (e.g. stingy, giggle)",
    )
    p_cat.add_argument(
        "--remove", metavar="FUNSCRIPT",
        help="Remove the entry for a specific funscript name",
    )
    p_cat.add_argument(
        "--clear", action="store_true",
        help="Remove all entries from the catalog",
    )

    # --- export-plan ---
    p_ep = sub.add_parser(
        "export-plan",
        help="Show the export-tab transform plan (recommended + manual) for a funscript",
    )
    p_ep.add_argument("funscript", help="Path to source .funscript file")
    p_ep.add_argument(
        "--assessment", metavar="PATH",
        help="Path to an existing assessment JSON (omit to run a fresh assessment)",
    )
    p_ep.add_argument(
        "--transforms", metavar="PATH",
        help=(
            "JSON file of per-phrase overrides.  Format: "
            '{\"1\": {\"transform\": \"normalize\", \"params\": {}}, \"3\": \"halve_tempo\", ...}  '
            "(keys are 1-based phrase numbers)"
        ),
    )
    p_ep.add_argument(
        "--no-recommended", action="store_true",
        help="Show only manually-specified transforms; skip auto-suggestions",
    )
    p_ep.add_argument(
        "--bpm-threshold", type=float, default=120.0, metavar="BPM",
        help="BPM threshold for the suggested-transform logic (default: 120.0)",
    )
    p_ep.add_argument(
        "--format", choices=["table", "json"], default="table",
        help="Output format: human-readable table (default) or JSON",
    )
    p_ep.add_argument(
        "--apply", action="store_true",
        help="Apply the plan and write the output funscript (use --output to set path)",
    )
    p_ep.add_argument(
        "--output", metavar="PATH",
        help="Output .funscript path (implies --apply; default: *_export.funscript)",
    )
    p_ep.add_argument(
        "--dry-run", action="store_true",
        help="Print the plan without writing any file",
    )
    p_ep.add_argument(
        "--min-phrase-duration", type=float, metavar="SECONDS",
        help="(fresh assessment only) Merge phrases shorter than this many seconds",
    )
    p_ep.add_argument(
        "--amplitude-tolerance", type=float, metavar="FRACTION",
        help="(fresh assessment only) Phrase break sensitivity",
    )

    # --- list-transforms ---
    p_lt = sub.add_parser(
        "list-transforms",
        help="List all available transforms (built-in + user-loaded)",
    )
    p_lt.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show parameter details for each transform.",
    )
    p_lt.add_argument(
        "--user-only", action="store_true",
        help="Show only user-defined transforms (from user_transforms/ and plugins/).",
    )
    p_lt.add_argument(
        "--format", choices=["table", "json"], default="table",
        help="Output format: human-readable table (default) or JSON.",
    )

    # --- validate-plugins ---
    p_vp = sub.add_parser(
        "validate-plugins",
        help="Validate JSON recipe files and report Python plugin gate status",
    )
    p_vp.add_argument(
        "--verbose", "-v", action="store_true",
        help="Print a result line for every individual recipe entry.",
    )
    p_vp.add_argument(
        "--recipes-dir", default=None,
        help="Override the user_transforms/ directory to scan.",
    )
    p_vp.add_argument(
        "--plugins-dir", default=None,
        help="Override the plugins/ directory to scan.",
    )

    # --- project ---
    p_proj = sub.add_parser(
        "project",
        help="Get or set project metadata (name, description) in a .project.json file",
    )
    p_proj.add_argument("project_file", help="Path to .project.json file")
    p_proj.add_argument(
        "project_action",
        choices=["get-name", "set-name", "get-desc", "set-desc"],
        help="Action to perform",
    )
    p_proj.add_argument(
        "value", nargs="?", default="",
        help="New value (required for set-name and set-desc)",
    )

    # --- meta ---
    p_meta = sub.add_parser(
        "meta",
        help="Derive auto-metadata (pace, intensity, arc, mood, tags, tone) from a funscript",
    )
    p_meta.add_argument("funscript", help="Path to source .funscript file")
    p_meta.add_argument("--assessment", metavar="PATH",
                        help="Path to an existing assessment JSON (omit to run fresh)")
    p_meta.add_argument("--output", metavar="PATH",
                        help="Save metadata to this JSON file")
    p_meta.add_argument("--format", choices=["table", "json"], default="table",
                        help="Output format (default: table)")

    # --- suggest-tone ---
    p_tone = sub.add_parser(
        "suggest-tone",
        help="Print the auto-suggested Tone label for a funscript",
    )
    p_tone.add_argument("funscript", help="Path to source .funscript file")

    # --- beats ---
    p_beats = sub.add_parser(
        "beats",
        help="Extract beat timestamps from a video file (requires av + librosa)",
    )
    p_beats.add_argument("video", help="Path to video file")
    p_beats.add_argument("--audio", metavar="PATH",
                         help="Override: use this audio file instead of the video's audio track")
    p_beats.add_argument("--output-dir", metavar="DIR",
                         help="Directory for _beats.json and _beats.csv (default: same as video)")

    # --- audio-peaks (pre-computed waveform sidecar for MediaViewer Audio mode) ---
    p_ap = sub.add_parser(
        "audio-peaks",
        help="Compute pre-computed waveform peaks sidecar (RMS-per-hop) for the MediaViewer Audio mode",
    )
    p_ap.add_argument("media", help="Path to video or audio file")
    p_ap.add_argument("--hop-ms", type=int, default=10,
                      help="Window size in ms (default: 10 — ~100 peaks/sec)")
    p_ap.add_argument("--force", action="store_true",
                      help="Recompute even if <stem>.audio.json exists")
    p_ap.add_argument("--no-write", action="store_true",
                      help="Skip writing the sidecar (still prints JSON to stdout)")
    p_ap.add_argument("--format", choices=["table", "json"], default="table",
                      help="Output format (default: table)")

    # --- audio-spectrogram (mel spectrogram PNG preview) ---
    p_as = sub.add_parser(
        "audio-spectrogram",
        help="Render a mel spectrogram PNG next to the media file (preview tool)",
    )
    p_as.add_argument("media", help="Path to video or audio file")
    p_as.add_argument("--output", help="Output PNG path (default: <stem>.spectrogram.png)")
    p_as.add_argument("--n-mels", type=int, default=64,
                      help="Number of mel frequency bins (default: 64)")
    p_as.add_argument("--fmax", type=int, default=8000,
                      help="Max frequency in Hz (default: 8000)")
    p_as.add_argument("--cmap", default="magma",
                      help="Matplotlib colormap (default: magma; try inferno/viridis)")

    # --- chapters (videoflow resolver bridge) ---
    p_ch = sub.add_parser(
        "chapters",
        help="Resolve chapters via videoflow (sidecar > mp4 markers > analysis.json)",
    )
    p_ch.add_argument("path",
                      help="Funscript or media file path (stem must match the sidecar)")
    p_ch.add_argument("--duration-ms", type=int, default=None,
                      help="Track duration in ms — used to fill end_ms on the last chapter "
                           "when the source (e.g. mp4 markers) only carries start times")
    p_ch.add_argument("--format", choices=["table", "json"], default="table",
                      help="Output format (default: table)")

    # --- auto-chapter (videoflow.structural analyzer bridge) ---
    p_ac = sub.add_parser(
        "auto-chapter",
        help="Auto-detect chapters from media via videoflow.structural (writes sidecar)",
    )
    p_ac.add_argument("media", help="Path to video or audio file")
    p_ac.add_argument("--target-minutes", type=float, default=5.5,
                      help="Average target chapter length in minutes (default: 5.5)")
    p_ac.add_argument("--no-write", action="store_true",
                      help="Skip writing <stem>.chapters.json (default: write it)")
    p_ac.add_argument("--resume", action="store_true",
                      help="Skip stages whose sidecar already exists "
                           "(resume after a killed analyze) instead of recomputing")
    p_ac.add_argument("--format", choices=["table", "json"], default="table",
                      help="Output format (default: table)")

    # --- read-stanzas (FF Stanzas tab data source) ---
    # Reads videoflow-classified phrases from <stem>.chapters.json next to
    # the given funscript or media. Returns them as JSON for the Tauri
    # bridge. Empty list when no sidecar exists.
    p_rs = sub.add_parser(
        "read-stanzas",
        help="Read videoflow phrases (= stanzas) from the <stem>.chapters.json sidecar",
    )
    p_rs.add_argument("path", help="Path to funscript or media file (sidecar lives next to it)")

    # --- feel-write / feel-read (events <-> .feel.yml) ---
    p_fw = sub.add_parser(
        "feel-write",
        help="Write events to the canonical <stem>.feel.yml sidecar",
    )
    p_fw.add_argument("input", help="funscript or media path (sidecar lives next to it)")
    p_fw.add_argument("--events-json", required=True,
                      help="Path to a JSON events array (EventsTab shape), or - for stdin")

    p_fr = sub.add_parser(
        "feel-read",
        help="Read events from the <stem>.feel.yml sidecar (JS shape)",
    )
    p_fr.add_argument("input", help="funscript or media path (sidecar lives next to it)")

    # --- characters-write / characters-read (per-chapter Channels assignments) ---
    p_chw = sub.add_parser(
        "characters-write",
        help="Write per-chapter character assignments to <stem>.characters.json",
    )
    p_chw.add_argument("input", help="funscript or media path (sidecar lives next to it)")
    p_chw.add_argument("--characters-json", required=True,
                       help="Path to a JSON {characters:{chapterId:{...}}} map, or - for stdin")

    p_chr = sub.add_parser(
        "characters-read",
        help="Read per-chapter character assignments from <stem>.characters.json",
    )
    p_chr.add_argument("input", help="funscript or media path (sidecar lives next to it)")

    # --- passages-write / passages-read (Channels · Passages intensity arcs) ---
    p_psw = sub.add_parser(
        "passages-write",
        help="Write span-relative intensity passages to <stem>.passages.json",
    )
    p_psw.add_argument("input", help="funscript or media path (sidecar lives next to it)")
    p_psw.add_argument("--passages-json", required=True,
                       help="Path to a JSON {passages:[...]} list, or - for stdin")

    p_psr = sub.add_parser(
        "passages-read",
        help="Read span-relative intensity passages from <stem>.passages.json",
    )
    p_psr.add_argument("input", help="funscript or media path (sidecar lives next to it)")

    # --- stim-process (React bridge to the funscript-tools channel pipeline) ---
    p_stp = sub.add_parser(
        "stim-process",
        help="Generate e-stim channel funscripts for a (chapter) window via funscript-tools",
    )
    p_stp.add_argument("input", help="Path to the input funscript")
    p_stp.add_argument("--character", required=True, help="Character/preset name (the preset LABEL)")
    p_stp.add_argument("--sliders-json", default=None,
                       help="Path to a JSON {cv_key: value} overrides map, or - for stdin")
    p_stp.add_argument("--mode", choices=["2d", "3phase"], default="2d",
                       help="2d = alpha+beta (fast); 3phase = all 10 channels (slow, prostate)")
    p_stp.add_argument("--start-ms", type=int, default=None, help="Window start (chapter atMs)")
    p_stp.add_argument("--end-ms", type=int, default=None, help="Window end (chapter endMs)")

    # --- cap-stim (flash-safety cap over generated channel files + sidecar) ---
    p_cap = sub.add_parser(
        "cap-stim",
        help="Cap generated e-stim channels so a screech can't flash; writes <stem>.screech.json",
    )
    p_cap.add_argument("output_dir", help="Directory holding the <stem>.<channel>.funscript files")
    p_cap.add_argument("--stem", required=True, help="Channel filename stem")
    p_cap.add_argument("--screech-json", default=None,
                       help="Path to the analysis screech sidecar (or a {start_s,end_s}[] JSON)")
    p_cap.add_argument("--media", default=None,
                       help="Media/funscript path; sidecar is written to its .forge dir if given")

    # --- warmup (background prewarm of the scientific stack at app launch) ---
    sub.add_parser(
        "warmup",
        help="Prewarm librosa/numba/scipy into the OS file cache (fired at app launch)",
    )

    # --- viewer-load (React bridge: load generated device outputs to review) ---
    p_vl = sub.add_parser(
        "viewer-load",
        help="Load <stem>.output device channel funscripts (+ screech note) for the Viewer",
    )
    p_vl.add_argument("input", help="Project media or funscript path (output dir is its sibling)")
    p_vl.add_argument("--max-points", type=int, default=2000,
                      help="Decimate each channel to ~this many points for transport")
    p_vl.add_argument("--channel", default=None,
                      help="Load ONE channel at full res ('<Device>/<channel>') for the monitor")
    p_vl.add_argument("--audio-points", type=int, default=None,
                      help="Load ONLY the audio envelope at ~this many points (monitor hi-res)")

    # --- multiaxis-process (React bridge to the multiaxis engine) ---
    p_mxp = sub.add_parser(
        "multiaxis-process",
        help="Generate secondary-axis funscripts for a (chapter) window via the multiaxis engine",
    )
    p_mxp.add_argument("input", help="Path to the input funscript")
    p_mxp.add_argument("--style", required=True,
                       help="Position style (MULTIAXIS_PRESETS key: Cowgirl/Missionary/Doggy/Riding/Random/None)")
    p_mxp.add_argument("--start-ms", type=int, default=None, help="Window start (chapter atMs)")
    p_mxp.add_argument("--end-ms", type=int, default=None, help="Window end (chapter endMs)")

    # --- list-event-recipes (Edger catalog → Events tab) ---
    sub.add_parser(
        "list-event-recipes",
        help="Project the Edger event_definitions + SFW/NSFW map into the Events catalog",
    )

    # --- edger-export / edger-import (.feel.yml ↔ playable events.yml) ---
    p_ee = sub.add_parser(
        "edger-export",
        help="Export <stem>.feel.yml to a playable Edger <stem>.events.yml",
    )
    p_ee.add_argument("input", help="funscript or media path (sidecar lives next to it)")
    p_ee.add_argument("--out", default=None,
                      help="Output path (default: <dir>/<stem>.events.yml, sibling of source)")
    p_ee.add_argument("--no-write", action="store_true",
                      help="Don't write the file; just echo the rendered YAML (preview)")

    p_ei = sub.add_parser(
        "edger-import",
        help="Import an Edger events.yml into the EventsTab JS shape (UI persists via feel-write)",
    )
    p_ei.add_argument("events_yml", help="Path to the Edger events.yml to import")

    # --- parse-captions ---
    p_caps = sub.add_parser(
        "parse-captions",
        help="Parse an SRT or VTT file and save _captions.json",
    )
    p_caps.add_argument("caption_file", help="Path to .srt or .vtt file")
    p_caps.add_argument("--output-dir", metavar="DIR",
                        help="Output directory (default: same folder as caption file)")
    p_caps.add_argument("--print", action="store_true",
                        help="Also print all captions to stdout")

    # --- device-aware ---
    p_da = sub.add_parser(
        "device-aware",
        help="Apply device awareness (minimum-fix clamp) to a funscript",
    )
    p_da.add_argument("input", help="Input funscript path")
    p_da.add_argument("--output", "-o", help="Output path (default: <input>.device-aware.funscript)")
    p_da.add_argument(
        "--devices", nargs="+", default=["foc3phase"],
        help="Device keys: handy, osr2, generic, legacy, stereostim, "
             "foc3phase, foc4phase, neostim. Default: foc3phase",
    )
    p_da.add_argument(
        "--spikes", type=float, default=0.0,
        help="Intensity spike fraction 0.0-0.5 (estim only). Default: 0.0",
    )

    # --- stim-config ---
    p_sc = sub.add_parser(
        "stim-config",
        help="Manage the user's stim_presets.json (overrides for built-in characters)",
    )
    p_sc_grp = p_sc.add_mutually_exclusive_group(required=True)
    p_sc_grp.add_argument(
        "--ensure", action="store_true",
        help="Write the built-in defaults to the config file if it does not exist (idempotent).",
    )
    p_sc_grp.add_argument(
        "--show", action="store_true",
        help="Print the config file path and its current contents.",
    )
    p_sc_grp.add_argument(
        "--reset", action="store_true",
        help="Overwrite the config file with built-in defaults (destructive).",
    )

    # --- list-characters ---
    p_lc = sub.add_parser(
        "list-characters",
        help="List stim characters (merged built-in presets + user overrides)",
    )
    p_lc.add_argument(
        "--format", choices=["table", "json"], default="table",
        help="Output format: human-readable table (default) or JSON.",
    )
    p_lc.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show per-character slider details.",
    )

    # --- beatmap ---
    p_bm = sub.add_parser(
        "beatmap",
        help="Analyze + persist the full AudioBeatMap (<stem>.beatmap.json — the generation substrate)",
    )
    p_bm.add_argument("media", help="Media file to analyze")
    p_bm.add_argument("--source", choices=["full", "percussive"], default="full",
                      help="Beat-tracking source (default full)")
    p_bm.add_argument("--tracker", choices=["auto", "beat_track", "plp"], default="plp",
                      help="Beat tracker. Default plp — follows the continuous pulse "
                           "through weak/non-percussive sections beat_track misses.")
    p_bm.add_argument("--chunk-secs", type=float, default=_DEFAULT_CHUNK_SECS,
                      help="Analyze long files in time windows of this many seconds "
                           "(per-chunk progress + energy norm). 0 disables. "
                           f"Default {_DEFAULT_CHUNK_SECS:.0f}.")
    p_bm.add_argument("--force", action="store_true",
                      help="Re-analyze even if a persisted beatmap exists")
    p_bm.add_argument("--format", choices=["json", "text"], default="text",
                      help="Output format (default text)")

    # --- generate ---
    p_gen = sub.add_parser(
        "generate",
        help="Generate a funscript from a beat map (Pace curve -> density arc)",
    )
    p_gen.add_argument("--output", "-o", required=True, help="Output .funscript path")
    g_src = p_gen.add_mutually_exclusive_group(required=True)
    g_src.add_argument("--beats", help="Full AudioBeatMap json (energies + stanzas)")
    g_src.add_argument("--media", help="Media file to analyze on the fly (slow)")
    p_gen.add_argument(
        "--pace-curve", metavar="V0,V1,...",
        help="Comma-separated [0,1] samples of the Pace curve (how busy -> density arc)",
    )
    p_gen.add_argument(
        "--range-curve", metavar="V0,V1,...",
        help="Comma-separated [0,1] samples of the Range curve (how far -> amplitude-gain arc)",
    )
    p_gen.add_argument("--low", type=int, default=10, help="Trough position 0-100 (default 10)")
    p_gen.add_argument("--high", type=int, default=90, help="Peak position 0-100 (default 90)")
    p_gen.add_argument("--center", type=int, default=None,
                       help="Centered stroke model midpoint (default: engine default)")
    p_gen.add_argument("--stroke-density", default="half",
                       help="half|full|1|2|4|8 (actions per beat; default half)")
    p_gen.add_argument("--texture", type=float, default=0.2,
                       help="Bounded amplitude texture 0..1 (pulls quiet beats off "
                            "the rails for the gold mid-shoulder; lowers speed). "
                            "Measured-safe <=0.3 (stays bimodal); default 0.2.")
    p_gen.add_argument("--source", choices=["full", "percussive"], default="full",
                       help="Beat-tracking source when --media is used (default full)")
    p_gen.add_argument("--tracker", choices=["auto", "beat_track", "plp"], default="plp",
                       help="Beat tracker when --media is used. Default plp (covers "
                            "weak-pulse intros beat_track misses).")
    p_gen.add_argument("--chunk-secs", type=float, default=_DEFAULT_CHUNK_SECS,
                       help="Analyze long --media files in time windows of this many "
                            "seconds (per-chunk progress + energy norm). 0 disables. "
                            f"Default {_DEFAULT_CHUNK_SECS:.0f}.")
    p_gen.add_argument("--force", action="store_true",
                       help="Re-analyze the media even if a persisted beatmap exists")
    p_gen.add_argument("--emit-actions", action="store_true",
                       help="Include the generated actions in the JSON payload (for the UI bridge)")
    p_gen.add_argument("--title", default=None, help="Funscript metadata title")
    p_gen.add_argument("--ui-state", default=None,
                       help="Opaque JSON blob (the Generate tab's curves/start/"
                            "texture + sig) stored verbatim in <stem>.generate.json "
                            "so the tab restores on app restart")
    p_gen.add_argument("--format", choices=["json", "text"], default="text",
                       help="Output format (default text)")

    # --- generate-read ---
    p_genr = sub.add_parser(
        "generate-read",
        help="Read the persisted Generate-tab session (<stem>.generate.json)",
    )
    p_genr.add_argument("--media", required=True, help="Media file the session is keyed to")

    # --- probe-media ---
    p_probe = sub.add_parser(
        "probe-media",
        help="Probe a raw video/audio file for duration + dimensions (ffprobe)",
    )
    p_probe.add_argument("--media", required=True, help="Media file to probe")

    # --- contact-sheet ---
    p_cs = sub.add_parser(
        "contact-sheet",
        help="Extract N evenly-spaced frames from a video (video-only Project page)",
    )
    p_cs.add_argument("--media", required=True, help="Video file to sample")
    p_cs.add_argument("--count", type=int, default=9, help="Number of frames (default 9)")
    p_cs.add_argument("--duration-ms", type=int, default=0,
                      help="Known duration in ms (skips a probe; 0 = probe)")
    p_cs.add_argument("--force", action="store_true", help="Re-extract even if cached")

    # --- test ---
    sub.add_parser("test", help="Run unit tests")

    return parser


def cmd_stim_config(args):
    """Manage the user's stim_presets.json file."""
    from forge.stim_config import (
        ensure_user_config,
        load_user_config,
        user_config_path,
    )
    from forge.funscript_tools import AVAILABLE, get_builtin_presets

    path = user_config_path()

    if args.show:
        print(f"Config path: {path}")
        if not path.is_file():
            print("(file does not exist — run with --ensure to create it)")
            return
        data, err = load_user_config()
        if err:
            print(f"Error: {err}", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(data, indent=2))
        return

    if args.ensure:
        if not AVAILABLE:
            print(
                "Error: funscript-tools is not available. "
                "Cannot generate default presets.",
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            written = ensure_user_config()
        except OSError as exc:
            print(f"Error: cannot write {path}: {exc}", file=sys.stderr)
            sys.exit(1)
        if written.stat().st_size > 0 and path.exists():
            print(f"Config file: {written}")
        return

    if args.reset:
        if not AVAILABLE:
            print(
                "Error: funscript-tools is not available. "
                "Cannot generate default presets.",
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            defaults = get_builtin_presets()
            path.write_text(json.dumps(defaults, indent=2), encoding="utf-8")
        except OSError as exc:
            print(f"Error: cannot write {path}: {exc}", file=sys.stderr)
            sys.exit(1)
        print(f"Reset to built-in defaults: {path}")
        return


def cmd_list_characters(args):
    """List stim characters (built-in presets + user overrides).

    Output is the canonical Python source for the UI's Characters tab —
    same data as the Streamlit panel reads. Each record:
      { id, label, description, sliders: [{cv, label, hint, ...}], config }

    `id` is a slugified version of the label (`Scene Builder` → `scene_builder`)
    so the JS catalog (in `data/characters.js`) can match UI-only fields
    (color / tagline / devices) by id without spaces / case issues.
    """
    from forge.stim_config import merged_presets, virtual_character_records

    presets, err = merged_presets()
    if err and args.format != "json":
        print(f"Warning: {err}", file=sys.stderr)

    def _slug(s: str) -> str:
        return s.lower().replace(" ", "_").replace("-", "_")

    records = []
    for label, preset in presets.items():
        records.append({
            "id": _slug(label),
            "label": label,
            "description": preset.get("description", ""),
            "sliders": preset.get("sliders", []),
            "config": preset.get("config", {}),
        })
    # Forge-level virtual characters (e.g. Scene Closer) — generated from a base
    # preset + a post-process at our layer, so they appear in the catalog
    # alongside the real Edger presets.
    records.extend(virtual_character_records())

    if args.format == "json":
        out = {"characters": records}
        if err:
            out["warning"] = err
        print(json.dumps(out, indent=2))
        return

    # --- table output ---
    if not records:
        print("No characters available (funscript-tools missing?).")
        return
    for r in records:
        print(f"{r['id']}  ·  {r['label']}")
        if r["description"]:
            print(f"    {r['description']}")
        if args.verbose and r["sliders"]:
            for s in r["sliders"]:
                cv = s.get("cv", "?")
                lbl = s.get("label", "")
                hint = s.get("hint", "")
                print(f"      {cv}  ·  {lbl}")
                if hint:
                    print(f"        {hint}")
        print()


def cmd_device_aware(args):
    """Apply device awareness (minimum-fix clamp) to a funscript."""
    from forge.device_specs import combined_limits, analyze_violations, apply_minimum_fix

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)

    actions = data.get("actions", [])
    limits = combined_limits(args.devices)
    if limits is None:
        print(f"Error: no valid devices in {args.devices}", file=sys.stderr)
        sys.exit(1)

    # Analyze
    analysis = analyze_violations(actions, limits)
    print(f"Device limits: {limits.name} (speed={limits.max_speed}, delta={limits.max_delta}, bpm={limits.max_bpm})")
    print(f"Actions: {analysis['total_actions']:,}")
    print(f"Violations: {analysis['violation_count']:,} ({analysis['percent_ok']:.0f}% OK)")
    print(f"Max speed found: {analysis['max_speed_found']:.0f} (limit: {limits.max_speed})")

    if analysis["violation_count"] == 0:
        print("Already device aware — no changes needed.")
        if not args.output:
            return
        # Still write output if requested
        out = args.output
    else:
        # Apply fix
        fixed_actions, fix_stats = apply_minimum_fix(
            actions, limits, intensity_spikes=args.spikes,
        )
        print(f"Clamped: {fix_stats['actions_clamped']:,} actions")
        print(f"Spike cycles: {fix_stats['spike_cycles']:,} / {fix_stats['total_cycles']:,}")

        data["actions"] = fixed_actions
        out = args.output or _default_path(args.input, ".device-aware.funscript")

    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f)
    print(f"Written: {out}")


def _polish_path(target) -> Path:
    """Resolve `<dir>/.<stem>.forge/<stem>.polish.yml` — the per-source record
    of which Polish stations were stamped, with their knob values and the
    source hash they were stamped against (to flag staleness)."""
    from videoflow.sidecar import forge_dir
    stem = Path(target).stem
    return forge_dir(target) / f"{stem}.polish.yml"


def _polish_out_dir(target, station_id: str) -> Path:
    """Per-station output folder: `<forge>/polish/<station>/`. Each station
    gets its own folder so TCode multi-axis sibling sets (OSR2/SR6) land
    together for MultiFunPlayer and single-file stations never collide."""
    from videoflow.sidecar import forge_dir
    return forge_dir(target) / "polish" / station_id


def _polish_source_hash(target) -> str:
    """Deterministic hash of the effective funscript + characters sidecar.

    Stamps record this; when the source later changes the recorded hash no
    longer matches and the UI marks that pass `stale`. Best-effort — missing
    inputs simply don't contribute."""
    import hashlib
    h = hashlib.sha1()
    p = Path(target)
    if p.exists():
        h.update(p.read_bytes())
    chars = _characters_path(target)
    if chars.exists():
        h.update(chars.read_bytes())
    return h.hexdigest()[:16]


def _write_funscript_like(path: Path, source_data: dict, actions: list) -> None:
    """Write `actions` into a copy of `source_data` (preserving metadata)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    out = dict(source_data)
    out["actions"] = actions
    path.write_text(json.dumps(out), encoding="utf-8")


# The 9-channel 3-phase e-stim set funscript-tools emits (same as
# cmd_stim_process's non-2d `wanted` list). Order is stable for output.
_ESTIM_CHANNELS = [
    "alpha", "beta", "pulse_frequency", "frequency", "volume",
    "pulse_rise_time", "alpha-prostate", "beta-prostate", "volume-prostate",
]


def _slug_character(s: str) -> str:
    """Mirror cmd_list_characters' `_slug` (label -> characters.json id)."""
    return s.lower().replace(" ", "_").replace("-", "_")


def _bake_events_into_channels(funscript_path: str, stem: str, raw: dict,
                               templates: dict) -> dict:
    """Bake authored events (`<stem>.feel.yml`) into the concatenated e-stim
    channels via funscript-tools' event engine, BEFORE the device clamp.

    restim / forgeplayer play channels, not events — so for events to be felt
    they must be baked into the channel signal at generation (the events.yml
    sidecar that Export also ships is for Edger/event-aware re-gen, which our
    own players never do, so there is no double-apply in our stack).

    Mechanism: write each concatenated channel as `<stem>.<axis>.funscript`
    plus a fresh `<stem>.events.yml` (rendered from feel.yml) into a tmp dir,
    run `funscript_tools.apply_events` (Edger's `process_events`, which globs
    those siblings and modulates them in place against our vendored
    `edger_event_definitions.yml`), then read the modulated channels back.

    Fail-safe: any error logs to stderr and returns `raw` unchanged so
    generation never breaks on a malformed event.
    """
    events_body = _collect_events_yaml(funscript_path)
    if not events_body:
        return raw  # no real events authored — nothing to bake

    import contextlib
    import shutil
    import tempfile

    from forge.funscript_tools import apply_events

    defs_path = _catalog_dir() / "edger_event_definitions.yml"
    if not defs_path.exists():
        print("event bake-in skipped: definitions not found", file=sys.stderr)
        return raw

    evdir = Path(tempfile.mkdtemp(prefix="ff_events_bake_"))
    try:
        # process_events derives the base from <stem>.events.yml and globs
        # <stem>.*.funscript siblings — so the channel files must be named to
        # match and live in the same dir.
        for axis, acts in raw.items():
            doc = {k: v for k, v in templates.get(axis, {}).items()}
            doc["actions"] = sorted(acts, key=lambda a: a["at"])
            (evdir / f"{stem}.{axis}.funscript").write_text(
                json.dumps(doc), encoding="utf-8")
        ev_path = evdir / f"{stem}.events.yml"
        ev_path.write_text(events_body, encoding="utf-8")

        with contextlib.redirect_stdout(sys.stderr):
            apply_events(str(ev_path), str(defs_path))

        baked = {}
        for axis in raw:
            cp = evdir / f"{stem}.{axis}.funscript"
            if cp.exists():
                cd = json.loads(cp.read_text(encoding="utf-8"))
                baked[axis] = [{"at": int(a["at"]), "pos": a["pos"]}
                               for a in cd.get("actions", [])]
            else:
                baked[axis] = raw[axis]
        return baked
    except Exception as exc:
        print(f"event bake-in skipped: {exc}", file=sys.stderr)
        return raw
    finally:
        shutil.rmtree(evdir, ignore_errors=True)


def _polish_generate_estim(
    funscript_path: str,
    knobs: dict | None,
    station,
    *,
    match_chapter_volume: bool = False,
) -> dict:
    """Generate the whole-track e-stim 9-channel set and clamp each channel.

    E-stim characters are assigned per chapter (`<stem>.characters.json`), so
    this walks the chapters, generates each window's channels via the proven
    funscript-tools `process()` (the same path the Channels live draw uses),
    concatenates per channel across chapters, then runs each channel through
    `polish.apply_pass` (rate ceiling / quiet floor / smoothing + the
    foc3phase safety backstop). Unassigned chapters produce no e-stim.

    Returns ``{channel: {"template": {...}, "actions": [...]}}``. Raises
    ValueError when funscript-tools is unavailable or there's nothing to do.
    """
    import contextlib
    import shutil
    import tempfile

    from forge import polish
    from forge.funscript import load_funscript_strict, parse_actions
    from forge.funscript_tools import AVAILABLE, build_config, process
    from videoflow.sidecar import forge_dir

    if not AVAILABLE:
        raise ValueError("funscript-tools not available — cannot generate e-stim")

    from forge.stim_config import merged_presets
    presets, _ = merged_presets()
    slug_to_label = {_slug_character(lbl): lbl for lbl in presets}

    stem = Path(funscript_path).stem
    chap_path = forge_dir(funscript_path) / f"{stem}.chapters.json"
    chapters = []
    if chap_path.exists():
        try:
            chapters = json.loads(chap_path.read_text(encoding="utf-8")).get("chapters") or []
        except (OSError, json.JSONDecodeError):
            chapters = []

    chars_doc = {}
    cp = _characters_path(funscript_path)
    if cp.exists():
        try:
            chars_doc = json.loads(cp.read_text(encoding="utf-8")).get("characters") or {}
        except (OSError, json.JSONDecodeError):
            chars_doc = {}

    times, pos = parse_actions(load_funscript_strict(funscript_path))
    pairs = list(zip(times, pos))
    if len(pairs) < 2:
        raise ValueError("no actions to generate e-stim from")

    # Build the (lo, hi, characterId, params) windows. With chapters, one per
    # chapter; without, the whole track using the single character assignment.
    from forge.channels_defaults import default_character_for
    windows = []
    if chapters:
        # Chapter ids are positional `ch{i+1}` — the sidecar has no id field;
        # the loader (Rust commands.rs) assigns it, and characters.json keys
        # by it. Replicate that here so assignments line up. When a chapter has
        # no assigned character (user skipped Channels), fall back to the
        # position-derived default arc so "skip and export" still produces
        # coherent e-stim.
        n = len(chapters)
        for i, ch in enumerate(chapters):
            cid = f"ch{i + 1}"
            lo = ch.get("at_ms", ch.get("atMs", ch.get("start_ms")))
            hi = ch.get("end_ms", ch.get("endMs"))
            assign = chars_doc.get(cid) or {}
            char_id = assign.get("characterId") or default_character_for(i, n)
            windows.append((lo, hi, char_id, assign.get("params") or {}))
    else:
        # No chapters (bare funscript) — only generate when a character is
        # explicitly assigned; no arc fallback, keep the minimal path minimal.
        assign = next(iter(chars_doc.values()), {}) if chars_doc else {}
        windows.append((pairs[0][0], pairs[-1][0], assign.get("characterId"), assign.get("params") or {}))

    raw = {}        # channel -> concatenated actions (absolute time)
    templates = {}  # channel -> first-seen doc minus actions
    tmp = Path(tempfile.mkdtemp(prefix="ff_polish_estim_"))
    try:
        from forge.stim_config import resolve_character, apply_virtual_envelope
        nwin = len(windows)
        for idx, (lo, hi, cid, params) in enumerate(windows):
            # Per-chapter progress — the whole-track forge runs the full Restim
            # pipeline once per chapter (~2s each), serially, so a 13-chapter
            # track is ~30s. Without this the footer sits on one static line
            # for the duration and reads as a hang (user flagged 2026-06-08).
            _emit_progress(f"Forging E-Stim — chapter {idx + 1} of {nwin}…")
            if not cid:
                continue  # unassigned chapter — no e-stim here
            # Virtual characters (Scene Closer) generate from a base preset and
            # get a post-process below; real ones resolve via slug_to_label.
            base_label, virtual = resolve_character(cid)
            if virtual:
                label = base_label
            else:
                label = slug_to_label.get(cid) or slug_to_label.get(_slug_character(cid))
            if not label:
                continue
            wlo = lo if lo is not None else pairs[0][0]
            whi = hi if hi is not None else pairs[-1][0]
            win = [(t, p) for t, p in pairs if wlo <= t <= whi]
            if len(win) < 2:
                continue
            wdir = tmp / f"w{idx}"
            wdir.mkdir(parents=True, exist_ok=True)
            in_path = wdir / f"{stem}.funscript"
            in_path.write_text(json.dumps({
                "actions": [{"at": int(t), "pos": int(round(p))} for t, p in win],
            }), encoding="utf-8")
            config = build_config(label, params, output_dir=str(wdir))
            # process() logs to stdout; keep our stdout JSON-clean.
            with contextlib.redirect_stdout(sys.stderr):
                result = process(str(in_path), config, None)
            if not result.get("success"):
                continue
            for suf in _ESTIM_CHANNELS:
                cpth = wdir / f"{stem}.{suf}.funscript"
                if not cpth.exists():
                    continue
                cd = json.loads(cpth.read_text(encoding="utf-8"))
                acts = [{"at": a["at"], "pos": a["pos"]} for a in cd.get("actions", [])]
                acts = apply_virtual_envelope(suf, acts, wlo, whi, virtual)
                raw.setdefault(suf, []).extend(acts)
                if suf not in templates:
                    templates[suf] = {k: v for k, v in cd.items() if k != "actions"}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not raw:
        raise ValueError("No e-stim to generate — assign a character to at least one chapter in the Channels tab first.")

    # Repair the volume step at each chapter seam, as close to its source as
    # possible: it is an artifact of generating one window at a time (Edger's
    # ramp restarts from 0 every chapter), and everything downstream — authored
    # events, the Passages contour — is deliberate. Chapters assigned Scene
    # Builder / Scene Closer are left alone; their ramp IS the intent.
    if match_chapter_volume:
        _emit_progress("Forging E-Stim — matching volume across chapters…")
        from forge.stim_config import match_chapter_seams
        for suf in list(raw):
            raw[suf] = match_chapter_seams(suf, raw[suf], windows)

    # Bake authored events into the channels before clamping, so the device
    # signal carries the effects (restim/forgeplayer play channels, not events).
    _emit_progress("Forging E-Stim — baking authored events…")
    raw = _bake_events_into_channels(funscript_path, stem, raw, templates)

    # Layer Passages (span-relative intensity envelope) onto the volume
    # channels before clamping — the slow scene-scale contour the per-chapter
    # character envelope can't carry. Absolute-time spans over the whole track.
    _passages = _load_resolved_passages(funscript_path, chapters)

    _emit_progress("Forging E-Stim — clamping channels to device limits…")
    from forge import passages as _passages_mod
    out = {}
    for name, acts in raw.items():
        acts.sort(key=lambda a: a["at"])
        acts = _passages_mod.scale_estim(name, acts, _passages)
        clamped, _ = polish.apply_pass(acts, station.id, knobs)
        out[name] = {"template": templates.get(name, {}), "actions": clamped}

    # Four-phase devices take per-electrode powers, not a position. Convert
    # AFTER clamping so the rate ceiling and the device_specs backstop still
    # apply to the authored motion — clamping e1..e4 directly would be
    # clamping the derived signal, which is not what the limits describe.
    if getattr(station, "electrodes", False):
        from forge import focstim as _focstim
        _emit_progress("Forging FOC-Stim — mapping position to four electrodes…")
        alpha = out.get("alpha", {}).get("actions") or []
        beta = out.get("beta", {}).get("actions") or []
        if not alpha and not beta:
            raise ValueError(
                "No alpha/beta position channels were generated, so there is "
                "nothing to map onto the four electrodes."
            )
        tmpl = out.get("alpha", {}).get("template", {})
        for ch, acts in _focstim.channels_from_alpha_beta(alpha, beta).items():
            out[ch] = {"template": dict(tmpl), "actions": acts}
        # Drop the position channels: a four-phase device reads none of them,
        # and leaving `alpha` in place would have restim's auto-loader bind it
        # to POSITION_ALPHA for a device that ignores it.
        for ch in _focstim.POSITION_CHANNELS:
            out.pop(ch, None)
    return out


def _polish_preview_estim_channels(funscript_path: str, start_ms: int, end_ms: int) -> dict:
    """Generate RAW e-stim channels (no device clamp, no event bake) for the
    [start_ms, end_ms] preview window, rebased to the window start.

    The Polish 3-pane preview previously showed the position MOTION clamped —
    which is the right signal for a stroker but wrong for e-stim (e-stim plays
    9 modulation channels, not position). This returns the ACTUAL channels for
    the window so the UI can show them and apply the device knobs live in JS
    (the JS engine clamp mirrors `polish.apply_pass`, so the preview matches
    what Stamp writes). Generation mirrors `_polish_generate_estim` for the
    chapter(s) the window touches — same character resolution and default arc.
    """
    import contextlib
    import shutil
    import tempfile

    from forge.funscript import load_funscript_strict, parse_actions
    from forge.funscript_tools import AVAILABLE, build_config, process
    from videoflow.sidecar import forge_dir

    if not AVAILABLE:
        raise ValueError("funscript-tools not available — cannot preview e-stim channels")

    from forge.stim_config import (apply_virtual_envelope, merged_presets,
                                   resolve_character)
    presets, _ = merged_presets()
    slug_to_label = {_slug_character(lbl): lbl for lbl in presets}

    stem = Path(funscript_path).stem
    chap_path = forge_dir(funscript_path) / f"{stem}.chapters.json"
    chapters = []
    if chap_path.exists():
        try:
            chapters = json.loads(chap_path.read_text(encoding="utf-8")).get("chapters") or []
        except (OSError, json.JSONDecodeError):
            chapters = []

    chars_doc = {}
    cp = _characters_path(funscript_path)
    if cp.exists():
        try:
            chars_doc = json.loads(cp.read_text(encoding="utf-8")).get("characters") or {}
        except (OSError, json.JSONDecodeError):
            chars_doc = {}

    times, pos = parse_actions(load_funscript_strict(funscript_path))
    pairs = list(zip(times, pos))
    if len(pairs) < 2:
        raise ValueError("no actions to preview e-stim from")

    from forge.channels_defaults import default_character_for
    windows = []
    if chapters:
        n = len(chapters)
        for i, ch in enumerate(chapters):
            lo = ch.get("at_ms", ch.get("atMs", ch.get("start_ms")))
            hi = ch.get("end_ms", ch.get("endMs"))
            assign = chars_doc.get(f"ch{i + 1}") or {}
            char_id = assign.get("characterId") or default_character_for(i, n)
            windows.append((lo, hi, char_id, assign.get("params") or {}))
    else:
        assign = next(iter(chars_doc.values()), {}) if chars_doc else {}
        windows.append((pairs[0][0], pairs[-1][0], assign.get("characterId"), assign.get("params") or {}))

    raw = {}
    tmp = Path(tempfile.mkdtemp(prefix="ff_polish_prev_"))
    try:
        for idx, (lo, hi, cid, params) in enumerate(windows):
            wlo = lo if lo is not None else pairs[0][0]
            whi = hi if hi is not None else pairs[-1][0]
            if whi < start_ms or wlo > end_ms:
                continue  # window doesn't touch this chapter
            if not cid:
                continue
            base_label, virtual = resolve_character(cid)
            label = base_label if virtual else (
                slug_to_label.get(cid) or slug_to_label.get(_slug_character(cid)))
            if not label:
                continue
            win = [(t, p) for t, p in pairs if wlo <= t <= whi]
            if len(win) < 2:
                continue
            wdir = tmp / f"w{idx}"
            wdir.mkdir(parents=True, exist_ok=True)
            in_path = wdir / f"{stem}.funscript"
            in_path.write_text(json.dumps({
                "actions": [{"at": int(t), "pos": int(round(p))} for t, p in win],
            }), encoding="utf-8")
            config = build_config(label, params, output_dir=str(wdir))
            with contextlib.redirect_stdout(sys.stderr):
                result = process(str(in_path), config, None)
            if not result.get("success"):
                continue
            for suf in _ESTIM_CHANNELS:
                cpth = wdir / f"{stem}.{suf}.funscript"
                if not cpth.exists():
                    continue
                cd = json.loads(cpth.read_text(encoding="utf-8"))
                acts = [{"at": a["at"], "pos": a["pos"]} for a in cd.get("actions", [])]
                acts = apply_virtual_envelope(suf, acts, wlo, whi, virtual)
                raw.setdefault(suf, []).extend(acts)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Clip to the window and rebase to 0 (the UI window is 0-based).
    out = {}
    for suf, acts in raw.items():
        clipped = [{"at": int(a["at"] - start_ms), "pos": a["pos"]}
                   for a in sorted(acts, key=lambda a: a["at"])
                   if start_ms <= a["at"] <= end_ms]
        if len(clipped) >= 2:
            out[suf] = clipped
    return out


# multiaxis engine axis name -> TCode axis code (inverse of polish.TCODE_SUFFIX).
_AXIS_TO_TCODE = {"surge": "L1", "sway": "L2", "twist": "R0", "roll": "R1", "pitch": "R2"}


def _polish_generate_tcode(funscript_path: str, knobs: dict | None, station) -> dict:
    """Generate + clamp the TCode axis set (OSR2/SR6) from per-chapter
    `mechStyle`, mirroring the e-stim path. Walks the chapters, generates each
    window's secondary axes via `multiaxis.generate_multiaxis` (the same engine
    the Mechanical live draw uses), keeps only the axes this station supports,
    concatenates, and clamps each. Always includes the clamped L0 main.

    Returns ``{axis_name|'L0': [actions]}`` (axis_name == sibling suffix), or
    ``{}`` for the axes if no chapter carries a usable mechStyle (caller then
    falls back to clamping any existing sibling sidecars).
    """
    from forge import polish
    from forge.funscript import load_funscript_strict, parse_actions
    from forge.multiaxis import generate_multiaxis
    from forge.multiaxis_presets import MULTIAXIS_PRESETS
    from videoflow.sidecar import forge_dir

    # Which suffixes this station actually writes (L0 excluded — handled apart).
    suffixes = {polish.TCODE_SUFFIX[a] for a in station.axes if a != "L0"}

    stem = Path(funscript_path).stem
    chap_path = forge_dir(funscript_path) / f"{stem}.chapters.json"
    chapters = []
    if chap_path.exists():
        try:
            chapters = json.loads(chap_path.read_text(encoding="utf-8")).get("chapters") or []
        except (OSError, json.JSONDecodeError):
            chapters = []

    chars_doc = {}
    cp = _characters_path(funscript_path)
    if cp.exists():
        try:
            chars_doc = json.loads(cp.read_text(encoding="utf-8")).get("characters") or {}
        except (OSError, json.JSONDecodeError):
            chars_doc = {}

    times, pos = parse_actions(load_funscript_strict(funscript_path))
    pairs = list(zip(times, pos))
    if len(pairs) < 2:
        raise ValueError("no actions to generate axes from")

    from forge.channels_defaults import default_mech_for
    windows = []
    if chapters:
        # Skipped Mechanical -> fall back to the position-derived default arc
        # (only when chapters exist; a bare funscript stays minimal).
        n = len(chapters)
        for i, ch in enumerate(chapters):
            assign = chars_doc.get(f"ch{i + 1}") or {}
            lo = ch.get("at_ms", ch.get("atMs"))
            hi = ch.get("end_ms", ch.get("endMs"))
            windows.append((lo, hi, assign.get("mechStyle") or default_mech_for(i, n)))
    else:
        assign = next(iter(chars_doc.values()), {}) if chars_doc else {}
        windows.append((pairs[0][0], pairs[-1][0], assign.get("mechStyle")))

    raw = {}  # suffix -> concatenated actions
    nwin = len(windows)
    for idx, (lo, hi, style) in enumerate(windows):
        _emit_progress(f"Forging T-Code — chapter {idx + 1} of {nwin}…")
        if not style or style == "None" or style not in MULTIAXIS_PRESETS:
            continue
        wlo = lo if lo is not None else pairs[0][0]
        whi = hi if hi is not None else pairs[-1][0]
        win = [{"at": int(t), "pos": int(round(p))} for t, p in pairs if wlo <= t <= whi]
        if len(win) < 2:
            continue
        res = generate_multiaxis(win, [{"start_ms": win[0]["at"], "end_ms": win[-1]["at"]}],
                                 {0: style}, MULTIAXIS_PRESETS)
        for name in ("twist", "roll", "pitch", "surge", "sway"):
            if name not in suffixes:
                continue
            sig = getattr(res, name)
            if sig and sig.times_ms:
                raw.setdefault(name, []).extend(
                    {"at": int(t), "pos": int(round(p))}
                    for t, p in zip(sig.times_ms, sig.positions)
                )

    # Passages scale the SECONDARY-axis amplitude (toward neutral) — never L0,
    # which is the user's authored stroke. A Release winds the geometry down to
    # stillness while the primary motion stays intact.
    _passages = _load_resolved_passages(funscript_path, chapters)
    from forge import passages as _passages_mod

    out = {}
    # L0 — clamped main, always (untouched by passages).
    main_clamped, _ = polish.apply_pass([{"at": int(t), "pos": int(round(p))} for t, p in pairs],
                                        station.id, knobs)
    out["L0"] = main_clamped
    for name, acts in raw.items():
        acts.sort(key=lambda a: a["at"])
        acts = _passages_mod.scale_axis(acts, _passages)
        clamped, _ = polish.apply_pass(acts, station.id, knobs)
        out[name] = clamped
    return out


@_cli_command
def cmd_polish_apply(args):
    """Polish — clamp Channels output into device-ready files (last step
    before Export). Thin CLI over `forge.polish`; reuses the tested
    device_specs clamp as the safety backstop.

    --preview  → emit the 3-pane trace JSON {station, character, clamped,
                 performed, stats} for a window (--start-ms/--end-ms), write
                 nothing. The live UI preview runs in JS; this is the
                 authoritative/cross-check path.
    apply      → clamp the whole track and write the station's output file(s)
                 under `<forge>/polish/<station>/`. Strokers write one
                 funscript; OSR2/SR6 (TCode) also clamp any existing axis
                 sibling sidecars and write the set. E-Stim 9-channel
                 generation is wired in a follow-up (returns `pending`).
    """
    from forge import polish

    if args.station not in polish.STATIONS:
        raise ValueError(
            f"unknown polish station {args.station!r}. "
            f"Available: {', '.join(polish.STATIONS)}"
        )
    station = polish.STATIONS[args.station]

    # Motion to CLAMP comes from the effective (edited) funscript; stem,
    # sidecars, and e-stim/TCode generation all key off the positional
    # ORIGINAL (args.funscript) below — so a `<stem>.work.funscript` no longer
    # breaks generation by mangling the stem.
    eff = args.effective or args.funscript
    with open(eff, encoding="utf-8") as f:
        data = json.load(f)
    actions = data.get("actions", [])

    knobs = None
    if args.params_json:
        knobs = _load_json_arg(args.params_json) or None

    # --- preview: windowed 3-pane traces, write nothing ---
    if args.preview:
        win = actions
        if (args.start_ms is not None or args.end_ms is not None) and actions:
            lo = args.start_ms if args.start_ms is not None else actions[0]["at"]
            hi = args.end_ms if args.end_ms is not None else actions[-1]["at"]
            win = [a for a in actions if lo <= a["at"] <= hi]
        if station.kind == "shaker":
            # The shaker's three panes tell a different story from a stroker's.
            # Pane 1 stays the SOURCE motion, but panes 2 and 3 are the derived
            # intensity envelope and how the transducer's suspended mass
            # actually delivers it — so the user sees motion becoming rumble,
            # which is the whole transformation this station performs. Feeding
            # the raw positions through unchanged would draw a travel path the
            # hardware has no way to reproduce.
            from forge import shaker as shaker_mod
            _knob = dict(station.default_knobs)
            _knob.update(knobs or {})
            env = shaker_mod.envelope_from_actions(
                win, smoothing=float(_knob.get("smoothing", 0.55)),
            )
            pv = polish.preview_pass(env, station.id, knobs)
            pv["character"] = polish.actions_to_dense(win)
        else:
            pv = polish.preview_pass(win, station.id, knobs)
        json.dump({
            "station": station.id,
            "character": pv["character"],
            "clamped": pv["clamped"],
            "performed": pv["performed"],
            "stats": pv["stats"],
        }, sys.stdout)
        sys.stdout.write("\n")
        return

    # --- apply: clamp whole track, write device-ready file(s) ---
    stem = args.stem or Path(args.funscript).stem
    out_dir = _polish_out_dir(args.funscript, station.id)

    if station.kind == "estim":
        # E-Stim: generate the whole-track 9-channel set from the per-chapter
        # character assignments, clamp each channel, write the set.
        try:
            channels = _polish_generate_estim(args.funscript, knobs, station)
        except ValueError as exc:
            print(json.dumps({"station": station.id, "saved": [], "error": str(exc)}))
            return
        saved = []
        for name, payload in channels.items():
            cpath = out_dir / f"{stem}.{name}.funscript"
            _write_funscript_like(cpath, payload["template"], payload["actions"])
            saved.append(str(cpath))
        print(json.dumps({
            "station": station.id, "saved": saved,
            "channels": len(channels),
            "source_hash": _polish_source_hash(args.funscript),
        }))
        return

    saved = []

    # Bass shaker: the scene's INTENSITY, not its position. Stamps the envelope
    # funscript plus an LFE audio file so the result is usable both by a bridge
    # that drives a transducer from a script and by a bare shaker amp.
    if station.kind == "shaker":
        from forge import shaker as shaker_mod
        knob = dict(station.default_knobs)
        knob.update(knobs or {})
        env = shaker_mod.envelope_from_actions(
            actions, smoothing=float(knob.get("smoothing", 0.55)),
        )
        if not env:
            print(json.dumps({
                "station": station.id, "saved": [],
                "error": "Not enough motion to derive a shaker envelope "
                         "(need at least two actions).",
            }))
            return
        main_path = out_dir / station.output_template.format(stem=stem)
        _write_funscript_like(main_path, data, env)
        saved.append(str(main_path))

        # The audio half is best-effort: a missing/failing soundfile must not
        # cost the user the envelope they just stamped.
        audio_meta = None
        try:
            audio_path = out_dir / f"{stem}.shaker.wav"
            audio_meta = shaker_mod.render_lfe_audio(
                env, str(audio_path),
                carrier_hz=float(knob.get("carrierHz", 40)),
                gain=float(knob.get("gain", 0.85)),
            )
            saved.append(str(audio_path))
        except Exception as exc:  # noqa: BLE001 — report, don't fail the stamp
            audio_meta = {"error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps({
            "station": station.id, "saved": saved,
            "samples": len(env),
            "audio": audio_meta,
            "source_hash": _polish_source_hash(args.funscript),
        }))
        return

    # TCode multi-axis (OSR2/SR6): generate the axis set from per-chapter
    # mechStyle (the live Mechanical engine), clamp each, write the sibling
    # set. Fall back to clamping any existing axis sidecars beside the source
    # when no chapter carries a usable style.
    if station.kind == "stroker-tcode":
        gen = _polish_generate_tcode(args.funscript, knobs, station)
        # L0 main first.
        main_path = out_dir / station.output_template.format(stem=stem)
        _write_funscript_like(main_path, data, gen.pop("L0"))
        saved.append(str(main_path))
        if len(gen) == 0:
            # No generated axes — fall back to existing sidecars.
            src_dir = Path(args.funscript).parent
            src_stem = Path(args.funscript).stem
            for axis in station.axes:
                if axis == "L0":
                    continue
                sib = src_dir / polish.sibling_path(src_stem, axis)
                if not sib.exists():
                    continue
                sdata = json.loads(sib.read_text(encoding="utf-8"))
                sclamped, _ = polish.apply_pass(sdata.get("actions", []), station.id, knobs)
                out_sib = out_dir / polish.sibling_path(stem, axis)
                _write_funscript_like(out_sib, sdata, sclamped)
                saved.append(str(out_sib))
        else:
            for axis_name, acts in gen.items():
                out_sib = out_dir / f"{stem}.{axis_name}.funscript"
                _write_funscript_like(out_sib, data, acts)
                saved.append(str(out_sib))
        print(json.dumps({
            "station": station.id, "saved": saved,
            "source_hash": _polish_source_hash(args.funscript),
        }))
        return

    # Single-axis stroker (Handy): clamp the main funscript and write.
    clamped, stats = polish.apply_pass(actions, station.id, knobs)
    main_path = out_dir / station.output_template.format(stem=stem)
    _write_funscript_like(main_path, data, clamped)
    saved.append(str(main_path))
    print(json.dumps({
        "station": station.id,
        "saved": saved,
        "stats": stats,
        "source_hash": _polish_source_hash(args.funscript),
    }))


@_cli_command
def cmd_polish_channels(args):
    """Polish preview — generate the RAW e-stim channels for a window so the UI
    can show the ACTUAL channels (not the position motion) and clamp them live.

    Returns ``{station, window:{start_ms,end_ms}, channels:{name:[{at,pos}]}}``
    with channel actions rebased to the window start (0-based). E-stim only;
    other stations have nothing to preview here (strokers already preview the
    position motion truthfully).
    """
    from forge import polish as _polish_mod
    if not _polish_mod.is_estim_station(args.station):
        print(json.dumps({"station": args.station, "window": None, "channels": {}}))
        return
    start_ms = int(args.start_ms)
    end_ms = int(args.end_ms)
    channels = _polish_preview_estim_channels(args.funscript, start_ms, end_ms)
    print(json.dumps({
        "station": args.station,
        "window": {"start_ms": start_ms, "end_ms": end_ms},
        "channels": channels,
    }))


@_cli_command
def cmd_polish_read(args):
    """Read `<stem>.polish.yml` → `{version, schema, current_hash, passes:{}}`.

    `current_hash` is the live source hash; the UI compares it to each pass's
    `source_hash` to mark stale stamps. Returns an empty record when missing.
    """
    import yaml
    path = _polish_path(args.input)
    current = _polish_source_hash(args.input)
    if not path.exists():
        print(json.dumps({"version": 1, "schema": "polish/v1",
                          "current_hash": current, "passes": {}}))
        return
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        print(f"Error reading {path}: {exc}", file=sys.stderr)
        sys.exit(1)
    if not isinstance(doc, dict):
        doc = {}
    print(json.dumps({
        "version": doc.get("version", 1),
        "schema": doc.get("schema", "polish/v1"),
        "current_hash": current,
        "passes": doc.get("passes") or {},
    }))


@_cli_command
def cmd_polish_write(args):
    """Write the Polish stamp record to `<stem>.polish.yml`. Passes arrive as
    JSON (`{passes:{station:{accepted, accepted_at, knobs}}}` or a bare map)
    via --passes-json (a path, or '-' for stdin). The source hash is stamped
    here so the UI can detect staleness on the next read."""
    import yaml
    if args.passes_json == "-":
        payload = json.loads(sys.stdin.read())
    else:
        payload = _load_json_arg(args.passes_json)  # inline JSON or file path
    passes = payload.get("passes") if isinstance(payload, dict) and "passes" in payload else payload
    if not isinstance(passes, dict):
        passes = {}

    src_hash = _polish_source_hash(args.input)
    for st in passes.values():
        if isinstance(st, dict) and st.get("accepted") and not st.get("source_hash"):
            st["source_hash"] = src_hash

    path = _polish_path(args.input)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"version": 1, "schema": "polish/v1", "passes": passes}
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True),
                    encoding="utf-8")
    print(json.dumps({"saved": str(path), "count": len(passes), "source_hash": src_hash}))


def _default_path(source: str, suffix: str) -> str:
    base, _ = os.path.splitext(source)
    return base + suffix


def _assessment_path(funscript: str) -> str:
    """Default assessment output: ``<stem>.forge/<stem>.assessment.json`` so it
    lives with the other sidecars (chapters/peaks/spectrogram/beats/phrases)
    instead of scattering a ``<stem>_assessment.json`` next to the source.
    Falls back to a sibling if videoflow's forge_dir isn't importable (mirrors
    _write_phrases_slice_sidecar's guard)."""
    try:
        from pathlib import Path as _Path
        from videoflow.sidecar import forge_dir
        d = forge_dir(funscript)
        d.mkdir(parents=True, exist_ok=True)
        return str(d / f"{_Path(funscript).stem}.assessment.json")
    except Exception:
        return _default_path(funscript, "_assessment.json")


_PHRASES_SIDECAR_VERSION = 1

# Length splitter thresholds. Phrases longer than _SPLIT_TRIGGER_MS get
# divided into floor(duration / _SPLIT_TARGET_MS) pieces. ph_2 in
# VictoriaOaks_separated/8 (273 s) is the canonical case: splits into 2
# pieces of ~136 s each. Snap window is symmetric around the ideal
# midpoint; falls back to the unsnapped ideal when no downbeat lies in
# the window.
_SPLIT_TRIGGER_MS = 240_000
_SPLIT_TARGET_MS = 120_000
_SPLIT_SNAP_WINDOW_MS = 3_000


def _load_downbeats(funscript_path: str) -> list:
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return []
    stem = Path(funscript_path).stem
    beats_path = forge_dir(funscript_path) / f"{stem}.beats.json"
    if not beats_path.exists():
        return []
    try:
        with open(beats_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data.get("downbeats_ms") or []


def _snap_to_downbeat(ideal_ms: int, downbeats: list, window_ms: int) -> Optional[int]:
    if not downbeats:
        return None
    import bisect
    idx = bisect.bisect_left(downbeats, ideal_ms)
    candidates = []
    if idx < len(downbeats):
        candidates.append(downbeats[idx])
    if idx > 0:
        candidates.append(downbeats[idx - 1])
    best = None
    best_delta = window_ms + 1
    for c in candidates:
        delta = abs(c - ideal_ms)
        if delta <= window_ms and delta < best_delta:
            best, best_delta = c, delta
    return best


def _split_long_phrases(phrases: list, funscript_path: str) -> list:
    """Split phrases longer than 4 min into ~2-min pieces snapped to downbeats.

    Children inherit the parent's pattern_label, tags, metrics (with
    duration_ms updated per piece), and oscillation_count + cycle_count
    proportional to their share of the parent's duration. Each child
    gets a runtime ``.evidence`` attribute = ``["length_split"]`` that the
    writer surfaces in the sidecar. Re-classification per piece is
    explicitly v1.x (see plan doc).
    """
    from models import Phrase

    downbeats = _load_downbeats(funscript_path)
    out = []
    for p in phrases:
        duration = p.end_ms - p.start_ms
        if duration <= _SPLIT_TRIGGER_MS:
            out.append(p)
            continue

        n_pieces = duration // _SPLIT_TARGET_MS
        if n_pieces < 2:
            out.append(p)
            continue

        ideal_step = duration / n_pieces
        boundaries = [p.start_ms]
        for k in range(1, n_pieces):
            ideal_t = p.start_ms + round(k * ideal_step)
            snap = _snap_to_downbeat(ideal_t, downbeats, _SPLIT_SNAP_WINDOW_MS)
            boundaries.append(snap if snap is not None else ideal_t)
        boundaries.append(p.end_ms)

        for at_ms, end_ms in zip(boundaries[:-1], boundaries[1:]):
            child_duration = end_ms - at_ms
            ratio = child_duration / duration if duration else 0
            child = Phrase(
                start_ms=int(at_ms),
                end_ms=int(end_ms),
                pattern_label=p.pattern_label,
                cycle_count=int(round((p.cycle_count or 0) * ratio)),
                description=p.description,
                oscillation_count=int(round((p.oscillation_count or 0) * ratio)),
                tags=list(p.tags or []),
                metrics={**(p.metrics or {}), "duration_ms": child_duration},
            )
            child.evidence = ["length_split"]
            # Inherit chapter_id from parent so split children stay tagged
            # with their chapter under the new per-chapter detection model.
            child.chapter_id = getattr(p, "chapter_id", None)
            out.append(child)
    return out


def _load_chapters_for_phrases(funscript_path: str) -> list:
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return []
    stem = Path(funscript_path).stem
    chapters_path = forge_dir(funscript_path) / f"{stem}.chapters.json"
    if not chapters_path.exists():
        return []
    try:
        with open(chapters_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data.get("chapters") or []


def _load_downbeats_for_phrases(funscript_path: str) -> list:
    """Read downbeats (ms) from the beats sidecar. Returns [] when missing — the
    character-drift splitter falls back to even time-ticks for drone-grid."""
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return []
    stem = Path(funscript_path).stem
    beats_path = forge_dir(funscript_path) / f"{stem}.beats.json"
    if not beats_path.exists():
        return []
    try:
        with open(beats_path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return data.get("downbeats_ms") or []


def _chapters_boundary_sig(funscript_path: str):
    """Ordered ``[[at_ms, end_ms], …]`` of the chapters phrase detection is
    scoped to — or ``None`` when there are no chapters (global detection).

    Phrase detection depends ONLY on chapter BOUNDARIES, never on tone/metadata.
    Stamping this signature into the phrases sidecar lets the freshness check
    reuse cached phrases across a chapters.json rewrite that only changed tone
    (mtime bumps, boundaries identical) — killing the spurious full-analyzer
    recalc on a mere Chapters→Phrases hop (D31b)."""
    chapters = _load_chapters_for_phrases(funscript_path)
    if not chapters:
        return None
    return [[int(c.get("at_ms", 0)), int(c.get("end_ms", 0))] for c in chapters]


def _fresh_phrases_payload(funscript_path: str) -> Optional[dict]:
    """Rebuild the assess JSON payload from a FRESH `<stem>.phrases.json`
    sidecar, or ``None`` when it's absent / stale / a different schema version.

    'Fresh' = the sidecar is newer than the funscript AND (if present) the
    chapters sidecar. So a tone edit that rewrote the funscript, or a chapter
    re-detect, correctly invalidates it and forces a real reassess — but a mere
    tab re-entry with no change reuses the cached slices instead of re-running
    the full analyzer (the "aggressive recalc", D27a). The payload mirrors the
    json_mode shape cmd_assess emits so the bridge/consumer can't tell the
    difference (plus a ``cached`` marker for debugging)."""
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return None
    fpath = Path(funscript_path)
    if not fpath.is_file():
        return None
    target_dir = forge_dir(funscript_path)
    sidecar = target_dir / f"{fpath.stem}.phrases.json"
    if not sidecar.is_file():
        return None
    try:
        s_mtime = sidecar.stat().st_mtime
        if s_mtime < fpath.stat().st_mtime:
            return None  # funscript changed after the sidecar → stale
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("version") != _PHRASES_SIDECAR_VERSION:
        return None  # schema bump → recompute
    # Chapter freshness — phrase spans are scoped to chapter BOUNDARIES, so
    # invalidate only when the boundaries actually changed (split/join), NOT
    # when chapters.json was merely rewritten with identical boundaries (a
    # tone-metadata accept bumps its mtime without touching phrase spans — the
    # spurious Chapters→Phrases recalc, D31b). Newer sidecars carry a boundary
    # signature; legacy ones (pre-fix) fall back to the coarse mtime test.
    if "chapters_sig" in data:
        if data.get("chapters_sig") != _chapters_boundary_sig(funscript_path):
            return None  # boundaries changed (or chapters appeared/vanished)
    else:
        chapters = target_dir / f"{fpath.stem}.chapters.json"
        try:
            if chapters.is_file() and s_mtime < chapters.stat().st_mtime:
                return None  # legacy fallback: chapters rewritten after sidecar
        except OSError:
            return None
    slices = data.get("slices")
    if not isinstance(slices, list):
        return None
    phrases = []
    for i, s in enumerate(slices):
        m = s.get("metrics") or {}
        tags = list(m.get("tags") or [])
        phrases.append({
            "at_ms":         int(s.get("at_ms", 0)),
            "end_ms":        int(s.get("end_ms", 0)),
            "number":        i + 1,
            "bpm":           m.get("bpm"),
            "tag":           (tags[0] if tags else None),
            "all_tags":      tags,
            "pattern_label": m.get("pattern_label"),
        })
    return {
        # PhrasesTab only consumes `phrases`; duration is a best-effort derive
        # from the last slice end so the field stays present and sane.
        "duration_ms":  (phrases[-1]["end_ms"] if phrases else 0),
        "bpm":          None,
        "action_count": None,
        "phrases":      phrases,
        "cached":       True,
    }


def _write_phrases_slice_sidecar(funscript_path: str, result) -> Optional[Path]:
    """Write `<funscript_stem>.phrases.json` into the funscript's `.forge/`.

    Returns the written path on success, ``None`` if videoflow isn't
    importable (test environments). ``chapter_id`` is read directly off
    each Phrase's runtime attribute (set by the per-chapter detection
    loop in ``cmd_assess``); ``None`` when the project has no chapters
    sidecar and detection ran globally.
    """
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return None

    target_dir = forge_dir(funscript_path)
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(funscript_path).stem
    out = target_dir / f"{stem}.phrases.json"

    slices = []
    for i, p in enumerate(result.phrases):
        at_ms = int(p.start_ms)
        end_ms = int(p.end_ms)
        # label is the structural shape from assessment/shape_labeler.py
        # (one of steady/pulse/three_one/tide/drift/burst/taper/swell) —
        # the "patterns" lens consumed by PatternsTab. Behavior tags
        # (the "phrases" lens — stingy/drone/etc.) live in metrics.tags
        # as a parallel vocabulary on the same phrase.
        slice_rec = {
            "id":         f"ph_{i}",
            "kind":       "phrase",
            "at_ms":      at_ms,
            "end_ms":     end_ms,
            "label":      getattr(p, "shape_label", "steady"),
            "chapter_id": getattr(p, "chapter_id", None),
            "metrics": {
                "bpm":           float(p.bpm or 0.0),
                "pattern_label": p.pattern_label,
                "cycle_count":   int(getattr(p, "cycle_count", 0) or 0),
                "tags":          list(getattr(p, "tags", []) or []),
                **(getattr(p, "metrics", None) or {}),
            },
        }
        evidence = list(getattr(p, "evidence", []) or [])
        if evidence:
            slice_rec["evidence"] = evidence
        slices.append(slice_rec)

    payload = {
        "version":      _PHRASES_SIDECAR_VERSION,
        "kind":         "phrase",
        "source_file":  str(Path(funscript_path).resolve()),
        # Boundary signature of the chapters detection was scoped to, so the
        # freshness check invalidates on a real boundary change (split/join)
        # but NOT a tone-only chapters.json rewrite (D31b).
        "chapters_sig": _chapters_boundary_sig(funscript_path),
        "slices":       slices,
    }
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out


def main():
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "pipeline":         cmd_pipeline,
        "assess":           cmd_assess,
        "transform":        cmd_transform,
        "phrase-transform": cmd_phrase_transform,
        "transform-apply":  cmd_transform_apply,
        "polish-apply":     cmd_polish_apply,
        "polish-channels":  cmd_polish_channels,
        "polish-read":      cmd_polish_read,
        "polish-write":     cmd_polish_write,
        "export":           cmd_export,
        "import":           cmd_import,
        "customize":        cmd_customize,
        "finalize":         cmd_finalize,
        "export-plan":      cmd_export_plan,
        "catalog":          cmd_catalog,
        "list-transforms":   cmd_list_transforms,
        "validate-plugins":  cmd_validate_plugins,
        "project":          cmd_project,
        "visualize":        cmd_visualize,
        "config":           cmd_config,
        "test":             cmd_test,
        "meta":             cmd_meta,
        "suggest-tone":     cmd_suggest_tone,
        "beats":            cmd_beats,
        "audio-peaks":      cmd_audio_peaks,
        "audio-spectrogram": cmd_audio_spectrogram,
        "chapters":         cmd_chapters,
        "auto-chapter":     cmd_auto_chapter,
        "read-stanzas":     cmd_read_stanzas,
        "feel-write":       cmd_feel_write,
        "feel-read":        cmd_feel_read,
        "characters-write": cmd_characters_write,
        "characters-read":  cmd_characters_read,
        "passages-write":   cmd_passages_write,
        "passages-read":    cmd_passages_read,
        "stim-process":     cmd_stim_process,
        "cap-stim":         cmd_cap_stim,
        "warmup":           cmd_warmup,
        "viewer-load":      cmd_viewer_load,
        "multiaxis-process": cmd_multiaxis_process,
        "list-event-recipes": cmd_list_event_recipes,
        "edger-export":     cmd_edger_export,
        "edger-import":     cmd_edger_import,
        "parse-captions":   cmd_parse_captions,
        "device-aware":     cmd_device_aware,
        "stim-config":      cmd_stim_config,
        "list-characters":  cmd_list_characters,
        "beatmap":          cmd_beatmap,
        "generate":         cmd_generate,
        "generate-read":    cmd_generate_read,
        "probe-media":      cmd_probe_media,
        "contact-sheet":    cmd_contact_sheet,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
