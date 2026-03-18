# tests

Unit tests for the core pipeline modules, UI-panel split logic, accessibility, and smoke tests.

789 tests in `tests/` + 60 UI-layer tests in `ui/common/tests/` = **849 total**, all using Python's stdlib `unittest` — no extra dependencies required.

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

### `test_pattern_editor_splits.py` — Pattern Editor split-segment logic

| Class | What it covers |
| --- | --- |
| `TestSegmentHelpers` | `_get_segments` with 0/1/2 splits, contiguous segments, unsorted input sorted, `_get_active_seg` default + clamping |
| `TestTransformState` | `_get_seg_transform` empty/legacy/new-key fallback, precedence; `_set_seg_transform` new key, legacy key sync for seg 0, no cross-seg contamination |
| `TestAddSplitPoint` | Boundary validation (start/end/before/after/duplicate), 2-segment creation, right-half inherits left transform, subsequent segments renumbered +1, multiple accumulating splits |
| `TestRemoveSplitBoundary` | Only-split removal, first/last boundary removal, merged segment keeps left transform, subsequent segments renumbered -1, no-splits and invalid-index rejection |
| `TestCopyInstanceToAll` | No-splits copies transform only, proportional split scaling, all segment transforms copied, source unchanged, dest splits cleared when source has none, split points clamped to dest bounds |
| `TestBuildAllTransforms` | No transforms → unchanged, Apply=False skips instance, invert applied, passthrough unchanged, two segments with independent transforms, multiple instances each transformed, out-of-cycle actions unchanged, result length preserved |

### `test_integration.py` — full pipeline chain

| Class | What it covers |
| --- | --- |
| `TestAssessTransformCustomizeChain` | Assessment stage, transformer stage, customizer stage, `run_pipeline()` writes all outputs, positions in range, log non-empty, missing assessment error, per-item config carried through to window JSON |

### `test_export_integrity.py` — output validation

| Class | What it covers |
| --- | --- |
| `TestClampSortDedup` | Positions clamped to [0, 100], out-of-range flagged, timestamps sorted, duplicates deduplicated (last-write wins), no-op on clean input, empty list, single action |

### `test_media_player.py` — `ui/streamlit/panels/media_player.py` (pure-Python helpers)

| Class | What it covers |
| --- | --- |
| `TestValidateMediaFileHappyPath` | Each of the 9 supported containers (MP3 ID3/ADTS, MP4/M4A/MOV, WAV, OGG, WebM, MKV, AAC MPEG-4/MPEG-2) with correct magic bytes → `None` |
| `TestValidateMediaFileCorrupt` | Garbage bytes for each container → error string |
| `TestValidateMediaFileEdgeCases` | Missing file, empty file, truncated file; `.avi` → helpful ffmpeg hint (not generic error); unknown extension → allowlist message (no `avi` listed) |
| `TestMediaExtsAllowlist` | `.avi` absent from `VIDEO_EXTS`, `AUDIO_EXTS`, and `MEDIA_EXTS`; all 9 supported extensions present |
| `TestFindMatchingMedia` | Finds MP4/MP3 by stem match; no match → `None`; missing uploads dir → `None`; MP4 preferred over MP3 |

### `test_launcher.py` — `_MediaHandler` local media HTTP server

| Class | What it covers |
| --- | --- |
| `TestMediaHandlerBadRequests` | Empty path → 400; relative path → 400; absolute path to missing file → 404 |
| `TestMediaHandlerAllowlist` | `.avi`, `.txt`, `.exe` → 403; MP4/MP3/WebM/MKV/WAV/OGG/AAC/M4A/MOV → 200 |
| `TestMediaHandlerContentType` | MP4 `video/mp4`, MP3 `audio/mpeg`, WebM `video/webm` |
| `TestMediaHandlerRangeRequests` | Range → 206 with correct body length and `Content-Range`; full request → 200 with `Content-Length` and `Accept-Ranges` |
| `TestMediaHandlerSymlinkSecurity` | Symlink named `.mp4` resolving to `.txt` → 403; symlink resolving to real `.mp4` → 200 *(skipped if OS requires elevation for symlinks)* |

### `test_priority2.py` — P2 features

| Class | What it covers |
| --- | --- |
| `TestFileUpload` | Upload saved to `output/uploads/`, prefix in selectbox, auto-selects most recent |
| `TestQualityCheck` | Velocity > 200 warn, velocity > 300 error, interval < 50 ms warn, pass on clean input, 50-row cap |
| `TestProgressCallback` | Callback invoked for each pipeline stage, stage labels non-empty, thread-safe |
| `TestValidateMediaFile` | Basic magic-byte smoke tests; see `test_media_player.py` for full coverage |
| `TestRecentsHelpers` | Save/load recent files, max-recents cap, missing file handled gracefully |

### `test_undo_stack.py` — undo/redo core

| Class | What it covers |
| --- | --- |
| `TestUndoStack` | Push, undo, redo, cap at 50 levels, clear, empty undo/redo no-ops, operation labels, multi-level round-trip |

### `test_undo_helpers.py` — Streamlit undo integration

| Class | What it covers |
| --- | --- |
| `TestUndoHelpers` | `push_undo` stores snapshot, `apply_snapshot` restores state, undo/redo buttons toggle availability, operation label visible in tooltip |

### `test_accessibility.py` — WCAG 2.1 AA

| Class | What it covers |
| --- | --- |
| `TestAudioPlayerAccessibility` | All 5 buttons have `aria-label`, specific label per button, JS `setAttribute` called on play/pause/stop/end (4 locations), `role="timer"` on time display, `aria-live` attributes |
| `TestRejectedRowSrOnly` | `.sr-only` span present in rejected rows, text contains "Rejected", appears in both completed and recommended tables |
| `TestBpmBarTextLogic` | Threshold logic (> 4% width shows label), format `"{bpm:.0f}"`, edge cases (empty, zero width, single phrase) |
| `TestNoCollapsedLabels` | Regex scan confirms no `label_visibility="collapsed"` in any `ui/streamlit/panels/*.py` |
| `TestChartCaptions` | BPM step chart caption present, behavioral tag chart caption present, export preview caption present, captions follow `st.plotly_chart` within 8 lines |
| `TestLangInjection` | `lang="en"` injection present in `app.py`, inside keyboard sentinel block, `.sr-only` CSS injected globally |

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

## Test count by module

| Module | Tests |
| --- | --- |
| `test_analyzer.py` | 33 |
| `test_transformer.py` | 15 |
| `test_customizer.py` | 12 |
| `test_utils.py` | 24 |
| `test_classifier.py` | 36 |
| `test_pattern_catalog.py` | 29 |
| `test_pattern_editor_splits.py` | 47 |
| `test_phrase_transforms.py` | 160 |
| `test_integration.py` | 20 |
| `test_cli.py` | 42 |
| `test_user_transforms.py` | 21 |
| `test_export_integrity.py` | 15 |
| `test_priority2.py` | 47 |
| `test_undo_stack.py` | 20 |
| `test_undo_helpers.py` | 17 |
| `test_accessibility.py` | 32 |
| `test_smoke.py` | 53 |
| `test_input_validation.py` | 23 |
| `test_media_player.py` | 34 |
| `test_launcher.py` | 27 |
| `test_metadata.py` | 45 |
| `test_captions.py` | 28 |
| `test_beats.py` | 17 |
| other modules | *(see `tests/` directory)* |
| `ui/common/tests/` | 60 |
| **Total** | **849** |

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).  Written by human and Claude AI (Claude Sonnet).*
