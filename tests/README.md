# tests

Unit tests for the core Python pipeline modules (`cli.py` and friends), the e-stim /
device / transform engines, and integration smoke tests.

These cover the **Python backend** that the Tauri + React desktop app drives via
`cli.py`. The React frontend has its own JS/Vitest tests under `ui/web/` (`npm test`);
this suite is the Python side. Tests use Python's stdlib `unittest` — no extra
dependencies required.

> `test_beats.py` integration tests are automatically skipped when `av`, `librosa`, or `numpy` are not installed. All other tests run with no optional dependencies.

## Running

```bash
# All core tests
python -m unittest discover -s tests -v

# Via CLI shortcut
python cli.py test

# Single module
python -m unittest tests.test_analyzer -v
```

For the UI-layer tests (WorkItem / Project):

```bash
python -m unittest discover -s ui/common/tests -v
```

## Test modules

### `test_analyzer.py` — `FunscriptAnalyzer`

| Class | What it covers |
| --- | --- |
| `TestFunscriptAnalyzer` | Load, analyze, phase/cycle/pattern/phrase detection, timestamp consistency, `phrase_at()`, error on analyze-without-load |
| `TestBpmTransitionDetection` | Threshold at 0 flags all changes; threshold at 9999 flags none; transition field types |
| `TestAssessmentResultSerialization` | `to_dict()` structure, dual ms/ts fields on phases, full save → load round-trip |
| `TestAnalyzerConfig` | Default values, custom threshold |

### `test_transformer.py` — `FunscriptTransformer`

| Class | What it covers |
| --- | --- |
| `TestFunscriptTransformer` | Load, transform output shape, positions in `[0, 100]`, timestamps non-negative, save → valid JSON, log output, pass-through at high threshold, all-transform at zero threshold, time-scale applied globally |
| `TestTransformerConfig` | Default values, dict round-trip, file save/load, unknown keys ignored |

### `test_customizer.py` — `WindowCustomizer`

| Class | What it covers |
| --- | --- |
| `TestWindowCustomizer` | Load funscript + assessment, customize output shape, positions in `[0, 100]`, save → valid JSON, manual performance window loaded correctly, missing window file treated as empty, log output |
| `TestCustomizerConfig` | Default values, dict round-trip, file save/load, unknown keys ignored |

### `test_utils.py` — `utils.py`

| Class | What it covers |
| --- | --- |
| `TestParseTimestamp` | Full `HH:MM:SS.mmm`, `MM:SS.mmm`, `SS.mmm` formats, no-millis, zero, millis padding, whitespace stripping |
| `TestMsToTimestamp` | Basic conversion, zero, negative clamps to zero, one minute, one hour |
| `TestRoundTrip` | `parse_timestamp(ms_to_timestamp(ms)) == ms` for 8 representative values |
| `TestOverlaps` | Overlapping, non-overlapping, touching at endpoint, contained, identical, adjacent |
| `TestLowPassFilter` | Zero strength = pass-through, full strength = locks to first value, output length, empty list, single element |

### `test_cli.py` — CLI subcommands

| Class | What it covers |
| --- | --- |
| `TestCliAssess` | Exit code, output JSON structure, default path, summary output, analyzer config round-trip |
| `TestCliTransform` | Exit code, valid funscript output, positions in range, transformer config flag |
| `TestCliCustomize` | Exit code, valid funscript output, perf window flag, missing window file handled gracefully |
| `TestCliPipeline` | Exit code, all three output files written, positions in range, perf window flag, stage summaries printed |
| `TestCliConfig` | Transformer/customizer/analyzer config dump, config round-trip into transform command |
| `TestCliFinalize` | Exit code, valid funscript output, default output path, `--skip-seams`, `--skip-smooth`, skip-both still writes |
| `TestCliExportPlan` | Exit code, table header output, `--no-recommended` empty plan, `--format json` valid JSON, `--transforms` file override, `--apply` writes valid funscript, `--dry-run` writes no file |
| `TestCliListTransforms` | Exit code, built-in keys present, `--user-only` shows user/not-builtin, `--verbose` shows `--param` details, `--format json` valid JSON, source tag `builtin`/`user`, verbose JSON includes params |

### `test_classifier.py` — `assessment/classifier.py`

| Class | What it covers |
| --- | --- |
| `TestTagRegistry` | All 8 tags present, each has required fields (key, label, description, color, suggested_transform, fix_hint) |
| `TestComputePhraseMetrics` | Empty window defaults, span, mean_pos, duration_ms, peak_velocity ≥ mean, cv_bpm with/without cycles, out-of-window actions excluded |
| `TestClassifyPhrase` | Each of the 8 tags detected and not detected, multi-tag co-existence, clean phrase produces empty list |
| `TestAnnotatePhrases` | tags/metrics added in-place, `_cycles` temp key removed, multiple phrases, drone threshold respected, cv_bpm computed from cycles |

### `test_pattern_catalog.py` — `catalog/pattern_catalog.py`

| Class | What it covers |
| --- | --- |
| `TestPatternCatalog` | Empty summary, add_assessment (tagged vs untagged, replace, duration stored), save/load round-trip, corrupted file fallback, remove, get_tag_stats (count, funscripts, BPM range, all keys), get_phrases_for_tag (filter, _funscript key), funscript_names, summary tags sorted |

### `test_phrase_transforms.py` — `pattern_catalog/phrase_transforms.py`

| Class | What it covers |
| --- | --- |
| `TestCatalogStructure` | All 17 keys present, each entry is a `PhraseTransform`, key matches `spec.key`, name/description non-empty, params are `TransformParam` instances; `TRANSFORM_ORDER` covers all catalog keys, contains no unknown keys, has no duplicates |
| `TestTransformApply` | Each transform's `apply()` output: length, position range `[0, 100]`, structural transforms, edge cases (empty/short input) |
| `TestSuggestTransform` | Returns `(key, params)` tuple; all 8 tag rules (frantic → halve_tempo; giggle/plateau/lazy → amplitude_scale amplify; stingy → amplitude_scale reduce; drift/half_stroke → recenter; drone → beat_accent); tag rules take priority over BPM fallbacks; scale targets peak hi ≈ 65; BPM fallbacks (transition → smooth, low BPM → passthrough, narrow → normalize, high BPM → amplitude_scale) |
| `TestTransformParam` | Required fields present, optional fields default to None/empty |

### `test_integration.py` — full pipeline chain

| Class | What it covers |
| --- | --- |
| `TestAssessTransformCustomizeChain` | Assessment stage, transformer stage, customizer stage, `run_pipeline()` writes all outputs, positions in range, log non-empty, missing assessment error, per-item config carried through to window JSON |

### `test_export_integrity.py` — output validation

| Class | What it covers |
| --- | --- |
| `TestClampSortDedup` | Positions clamped to [0, 100], out-of-range flagged, timestamps sorted, duplicates deduplicated (last-write wins), no-op on clean input, empty list, single action |

### `test_priority2.py` — P2 features

| Class | What it covers |
| --- | --- |
| `TestFileUpload` | Imported funscript saved under the project folder, prefix applied, auto-selects most recent |
| `TestQualityCheck` | Velocity > 200 warn, velocity > 300 error, interval < 50 ms warn, pass on clean input, 50-row cap |
| `TestProgressCallback` | Callback invoked for each pipeline stage, stage labels non-empty, thread-safe |
| `TestValidateMediaFile` | Magic-byte media validation across the supported containers |
| `TestRecentsHelpers` | Save/load recent files, max-recents cap, missing file handled gracefully |

### `test_undo_stack.py` — undo/redo core

| Class | What it covers |
| --- | --- |
| `TestUndoStack` | Push, undo, redo, cap at 50 levels, clear, empty undo/redo no-ops, operation labels, multi-level round-trip |

### `test_input_validation.py` — corrupted and truncated funscript input

| Class | What it covers |
| --- | --- |
| `TestAnalyzerBadInput` | Missing file, empty file, truncated JSON, binary garbage, bare-string JSON, JSON array, missing `actions` key, `actions` is null/string/number — each must raise `FileNotFoundError` or `ValueError` with a clear message; empty `actions` list and single-action file must succeed |
| `TestCliBadInput` | Same inputs via `cli.py assess` — exit code 1 for every bad input, `"Error:"` in stderr, no Python traceback; valid funscript still exits 0 |
| `TestProjectBadInput` | `Project.from_funscript()` propagates `FileNotFoundError` / `ValueError` for missing, corrupt, truncated, and schema-invalid files |

### `test_metadata.py` — `forge/metadata.py`

| Class | What it covers |
| --- | --- |
| `TestDerivePace` | Empty phrases → Unknown; Slow/Medium/Fast/Intense thresholds; average over multiple phrases; phrases without BPM ignored |
| `TestDeriveIntensity` | Low/Medium/High/Extreme thresholds; missing `avg_speed` defaults to Low |
| `TestDeriveDepth` | Shallow/Mid/Deep/Full span thresholds; `"0%"/"100%"` string positions parsed; invalid values → Unknown |
| `TestDeriveDuration` | Short/Medium/Long/Feature thresholds |
| `TestDeriveMoodVariety` | No phrases → Unknown/Focused; single tone → Focused; two tones → Varied; four tones → Complex; unmapped tags ignored; dominant = most-common |
| `TestDeriveArc` | Empty → Unknown; <3 phrases → Short; Climactic/Building/Flat detection |
| `TestSuggestTone` | Climactic → Climax; Building → Build; dominant mood passthrough; high-intensity fallback → Dominant; slow+low → Tender; rationale prefix |
| `TestBuildTags` | All six dimensions present; mood tag added/omitted; all lowercase |
| `TestDeriveMetadata` | All keys returned; auto_tags is list; tone is valid label; empty phrases/stats don't crash |
| `TestFormatMetadataTable` | Returns string; key labels present; Auto tags header present |

### `test_captions.py` — `forge/captions.py`

| Class | What it covers |
| --- | --- |
| `TestTimestampHelpers` | SRT and VTT timestamp parsing; zero; one hour; ms→ts zero/hours; round-trip |
| `TestStripTags` | `<b>`, `<i>`, VTT `<c.color>` removed; plain text unchanged |
| `TestParseSRT` | Basic parse; multi-line joined; HTML stripped; empty blocks ignored; FileNotFoundError; sample SRT loads |
| `TestParseVTT` | Basic parse; cue identifiers; VTT tag stripping |
| `TestSaveLoadCaptions` | File created; valid JSON; human-readable timestamps; round-trip; None when missing; unicode text |

### `test_beats.py` — `forge/beats.py`

| Class | What it covers |
| --- | --- |
| `TestSaveHelpers` | `_save_json` creates file and round-trips; `_save_csv` creates file, correct header/rows, index starts at 1, empty list |
| `TestLoadBeats` | Returns None when missing; returns dict when cached; returns None on corrupt JSON |
| `TestExtractBeatsMocked` | Writes JSON+CSV with mocked deps; returns None when deps missing; returns None when no audio |
| `TestExtractBeatsIntegration` | Real WAV via `audio_path` override (skipped without av/librosa) |

### `test_smoke.py` — integration smoke tests

| Class | What it covers |
| --- | --- |
| `SmokeTest_Timeline` | Full assess → export on `Timeline1.original.funscript`: required keys, non-empty phases/cycles/patterns/phrases, positive BPM, contiguous boundaries, duration matches last action, passthrough export valid JSON |
| `SmokeTest_LongAndCut` | Same 16-test suite on `LongandCut-hdr.original.funscript` |
| `SmokeTest_Victoria` | Same 16-test suite on `VictoriaOaks_stingy.original.funscript` |
| `TestVictoriaOaksUniformTempo` | Confirms issue #2 fix: >1 phrase produced, no phrase exceeds 300 s cap, contiguous boundaries, all BPMs positive |
| `TestAllAvailableFunscriptsParse` | Every `.original.funscript` in `test_funscript/` loads and analyzes without error (subTest per file) |

## Fixture

`fixtures/sample.funscript` — a small synthetic funscript used by all modules.
It is intentionally short so tests run in < 0.1 s.

## Test modules at a glance

The suite spans the pipeline (analyzer, transformer, customizer, classifier,
phrase transforms, integration, smoke), the CLI surface (`test_cli.py`), input
validation, metadata/captions/beats, and the e-stim / device / polish / export
engines (`test_device_specs.py`, `test_stim_config.py`, `test_audio_synthesis.py`,
`test_multiaxis.py`, `test_polish.py`, `test_export.py`, `test_events_feel.py`,
`test_channels_defaults.py`, `test_character_drift.py`, `test_scene_closer.py`,
`test_transform_apply.py`, `test_funscript_tools_adapter.py`, and more).

> For the authoritative module list and live test counts, run `python cli.py test`
> (or `python -m unittest discover -s tests -v`) — counts drift as modules are added.
> The Streamlit-era panel/launcher/accessibility test modules were removed along with
> the Streamlit UI; the React frontend is tested separately under `ui/web/` (`npm test`).

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).  Written by human and Claude AI (Claude Sonnet).*
