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
    analyzer = FunscriptAnalyzer(config=_build_analyzer_config(args))
    analyzer.load(args.funscript)
    t0 = time.time()
    def _progress(stage: str) -> None:
        print(f"  {stage}")

    result = analyzer.analyze(progress_callback=_progress)
    elapsed = time.time() - t0

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
    root = os.path.dirname(__file__)
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    # Core pipeline tests
    suite.addTests(loader.discover(start_dir=os.path.join(root, "tests"), pattern="test_*.py"))
    # UI common-layer tests
    suite.addTests(loader.discover(start_dir=os.path.join(root, "ui", "common", "tests"), pattern="test_*.py"))
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

    # --- test ---
    sub.add_parser("test", help="Run unit tests")

    return parser


def _default_path(source: str, suffix: str) -> str:
    base, _ = os.path.splitext(source)
    return base + suffix


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
        "parse-captions":   cmd_parse_captions,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
