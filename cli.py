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

    # Length splitter post-pass — phrases > 4 min get divided into
    # ~2-min pieces snapped to nearest downbeat. Mutates result.phrases so
    # the json_mode stdout payload reflects the split too.
    result.phrases = _split_long_phrases(result.phrases, args.funscript)

    # Phrase slice sidecar — `<stem>.forge/<stem>.phrases.json`. Read by
    # PhrasesTab / PatternsTab. chapter_id resolved via midpoint lookup
    # into the chapters sidecar; null when no chapters available.
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
            output = args.output or _default_path(args.funscript, "_assessment.json")
            result.save(output)
        print(json.dumps(payload))
        return

    output = args.output or _default_path(args.funscript, "_assessment.json")
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
            entry = {
                "name": spec.name,
                "description": spec.description,
                "structural": spec.structural,
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
# These two commands delegate to videoflow so that FunscriptForge,
# forgegen, and forgeplayer all see the same chapters from the same
# resolver and the same auto-detector. They normalize the JSON shape
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

    raw_phrases = data.get("phrases") or []

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
    from forge.stim_config import merged_presets

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


def _default_path(source: str, suffix: str) -> str:
    base, _ = os.path.splitext(source)
    return base + suffix


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


def _resolve_chapter_id(at_ms: int, end_ms: int, chapters: list) -> Optional[int]:
    if not chapters:
        return None
    midpoint = (at_ms + end_ms) // 2
    for idx, ch in enumerate(chapters):
        if ch.get("at_ms", 0) <= midpoint < ch.get("end_ms", 0):
            return idx
    return None


def _detect_straddling(at_ms: int, end_ms: int, chapters: list) -> Optional[str]:
    """Return ``"straddles:ch<N>→ch<M>"`` if the phrase covers >1 chapter, else None.

    Uses half-open overlap (chapter.at_ms < phrase.end_ms and
    chapter.end_ms > phrase.at_ms). Span is leftmost→rightmost; the
    assigned chapter_id (midpoint) is still the primary chapter — this
    is observational diagnostic only.
    """
    if not chapters:
        return None
    spans = [
        idx for idx, ch in enumerate(chapters)
        if ch.get("at_ms", 0) < end_ms and ch.get("end_ms", 0) > at_ms
    ]
    if len(spans) > 1:
        return f"straddles:ch{spans[0]}→ch{spans[-1]}"
    return None


def _write_phrases_slice_sidecar(funscript_path: str, result) -> Optional[Path]:
    """Write `<funscript_stem>.phrases.json` into the funscript's `.forge/`.

    Returns the written path on success, ``None`` if videoflow isn't
    importable (test environments).
    """
    try:
        from videoflow.sidecar import forge_dir
    except ImportError:
        return None

    target_dir = forge_dir(funscript_path)
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(funscript_path).stem
    out = target_dir / f"{stem}.phrases.json"

    chapters = _load_chapters_for_phrases(funscript_path)

    slices = []
    for i, p in enumerate(result.phrases):
        at_ms = int(p.start_ms)
        end_ms = int(p.end_ms)
        # label is reserved for the shape_labeler when it returns (see
        # project-held-shape-labeler). Hardcode "steady" in v1; behavioral
        # info lives in metrics.tags.
        slice_rec = {
            "id":         f"ph_{i}",
            "kind":       "phrase",
            "at_ms":      at_ms,
            "end_ms":     end_ms,
            "label":      "steady",
            "chapter_id": _resolve_chapter_id(at_ms, end_ms, chapters),
            "metrics": {
                "bpm":           float(p.bpm or 0.0),
                "pattern_label": p.pattern_label,
                "cycle_count":   int(getattr(p, "cycle_count", 0) or 0),
                "tags":          list(getattr(p, "tags", []) or []),
                **(getattr(p, "metrics", None) or {}),
            },
        }
        evidence = list(getattr(p, "evidence", []) or [])
        straddle = _detect_straddling(at_ms, end_ms, chapters)
        if straddle:
            evidence.append(straddle)
        if evidence:
            slice_rec["evidence"] = evidence
        slices.append(slice_rec)

    payload = {
        "version":     _PHRASES_SIDECAR_VERSION,
        "kind":        "phrase",
        "source_file": str(Path(funscript_path).resolve()),
        "slices":      slices,
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
        "parse-captions":   cmd_parse_captions,
        "device-aware":     cmd_device_aware,
        "stim-config":      cmd_stim_config,
        "list-characters":  cmd_list_characters,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
