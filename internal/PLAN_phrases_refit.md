# Phrases v1 refit — plan

**Date:** 2026-05-26
**Status:** Chapter-scoped detection landed. Splitter retained.

## Goal

Detect editing phrases independently inside each chapter so the
analyzer's `auto_scale_phrases` widens or tightens tolerances based on
each chapter's natural duration — not the full funscript's. Phrases
become a chapter-scoped editing unit, distinct from videoflow's
chapter-scoped *stanzas* (16-beat rhythmic groupings).

## Why chapter-scoped

Validated empirically before landing: a 93-minute VictoriaOaks mashup
yielded 37 phrases under global detection (auto_scale widened the
tolerances aggressively), but the same source content analyzed as 16
individual clips produced 111 phrases (tight per-clip thresholds).
3× discrepancy — not a free choice; a window-size artifact.

After the refactor, the mashup yields 67 phrases — still not 111, but
closer in spirit because each chapter now scales tolerances to its own
3–7 min window rather than the full 93 min. Boundary drift vs the
per-clip baseline dropped 40% (56s → 34s); tag agreement climbed 5×
(6% → 30%).

Two collateral wins fall out:

- **`chapter_id` is known at detection time.** The midpoint-lookup
  resolver from the previous design is gone — each per-chapter pass
  tags its phrases directly.
- **Straddling is impossible by construction.** Actions are pre-filtered
  to chapter bounds, so no phrase crosses a chapter seam. The
  straddling diagnostic and `straddles:chN→chM` evidence tag are gone.

The length splitter survives intact — within a single long chapter, a
4 + min uniform phrase still benefits from being divided into
~2 min pieces snapped to nearest downbeat.

## On-disk schema (`<stem>.phrases.json`, v1)

```json
{
  "version": 1,
  "kind": "phrase",
  "source_file": "<absolute path to .funscript>",
  "slices": [
    {
      "id": "ph_0",
      "kind": "phrase",
      "at_ms": 174,
      "end_ms": 61463,
      "label": "steady",
      "chapter_id": 0,
      "metrics": {
        "bpm": 124.33,
        "pattern_label": "flat → up → down",
        "cycle_count": 127,
        "tags": [],
        "mean_pos": 53.9,
        "span": 67,
        "mean_velocity": 0.1808,
        "peak_velocity": 0.2112,
        "cv_bpm": 0.0327,
        "duration_ms": 61289,
        "ramp_delta": -0.8
      }
    },
    {
      "id": "ph_3",
      "kind": "phrase",
      "at_ms": 99869,
      "end_ms": 236472,
      "label": "steady",
      "chapter_id": 0,
      "metrics": { "...": "(inherited from parent ph_2 pre-split)" },
      "evidence": ["length_split"]
    }
  ]
}
```

`evidence` is optional and absent on most phrases. The only tag emitted
in v1 is `"length_split"` (carried on synthesized children when a
parent phrase exceeded the 4 min splitter threshold).

## Algorithm

```
result = analyzer.analyze(...)
chapters = _load_chapters_for_phrases(funscript_path)

if chapters:
    per_chapter_phrases = []
    for ch_idx, ch in enumerate(chapters):
        ch_actions = [a for a in analyzer._actions
                      if ch.at_ms <= a["at"] < ch.end_ms]
        if not ch_actions:
            continue
        sub = FunscriptAnalyzer(config=...)
        sub._actions = ch_actions
        sub._source_file = analyzer._source_file
        sub_result = sub.analyze()
        for p in sub_result.phrases:
            p.chapter_id = ch_idx
        per_chapter_phrases.extend(sub_result.phrases)
    result.phrases = per_chapter_phrases

result.phrases = _split_long_phrases(result.phrases, funscript_path)
_write_phrases_slice_sidecar(funscript_path, result)
```

`result.phases`, `result.cycles`, `result.patterns`, and
`result.bpm_transitions` continue to come from the original global
analyzer pass; they stay accurate for the full funscript and feed
`_assessment.json` unchanged.

When no chapters sidecar exists, the global single-pass detection runs
as before; phrases get `chapter_id: null`.

## Length splitter (retained)

Trigger: `end_ms - at_ms > 240_000` (4 min).

```
n_pieces   = floor(duration_ms / 120_000)
ideal_step = duration_ms / n_pieces
beats      = load("<stem>.beats.json").downbeats_ms
splits     = []
for k in range(1, n_pieces):
    ideal_t = at_ms + round(k * ideal_step)
    snap_t  = nearest(beats, ideal_t, window_ms=3000)
    splits.append(snap_t or ideal_t)
```

Children inherit the parent's full `metrics`, `tags`, `label`, and
`chapter_id`. Each child gets `evidence: ["length_split"]`. Per-piece
re-classification stays explicitly v1.x — re-running the classifier
per child without confidence in the new boundaries would introduce
noise.

If `beats.json` is absent, fall back to the unsnapped ideal split.

## What's NOT in v1

- New boundary detection algorithm. The analyzer's existing
  cycle-character segmentation is unchanged.
- Detector cap rewrite (`max_phrase_duration_ms=300_000` stays as a
  safety net at 5 min; the refit splitter is the stricter 4 min musical
  refinement on top).
- Editable phrase boundaries in the UI. Per
  `feedback-phrases-not-editable`, phrases stay detection-only; Events
  is the user-correction surface.
- Per-piece re-classification after splitter.
- Shape labeler revival (held in `project-held-shape-labeler` memory;
  `label` defaults to `"steady"` until that consumer returns).

## Dogfood (VictoriaOaks)

- Single-chapter clip 8: 4 phrases (3 detected + 1 split), all
  `chapter_id: 0`, splitter still fires on the 273 s phrase, downbeat
  snap exact.
- 93-min, 17-chapter mashup: 67 phrases across all 17 chapters, 0 null
  chapter_id, 0 straddling tags, 2 length-split children. Phrases-per-
  chapter range 1–6.
- Per-clip-vs-mashup comparison: boundary drift 56 s → 34 s
  (-40%), tag agreement 6% → 30% (5×).

## Critical files

- [funscriptforge/cli.py](funscriptforge/cli.py) — `cmd_assess`
  per-chapter loop; writer reads `chapter_id` runtime attribute;
  splitter propagates `chapter_id` to children.
- [funscriptforge/internal/scripts/compare_individual_vs_mashup.py](internal/scripts/compare_individual_vs_mashup.py)
  — diagnostic script used for the dogfood scoring.

## Ground truth dataset

`VictoriaOaks_stingy.original.mp4` is a concatenation of 16 source
clips at `forgeassembler/test_media/victoriaoats/0.mp4..15.mp4`. Their
cumulative durations give exact chapter-seam timestamps for scoring
the chapter detector. Current detector hits ~8/16 seams within 30 s
and inserts 2-3 spurious boundaries; the refit is decoupled from
chapter quality (we just consume whatever boundaries the chapter
detector produces).

## Out of scope (parked follow-ups)

- Pattern catalog → per-chapter scoping (current pattern detection
  still runs globally — irrelevant since `Pattern` is a category not a
  segment).
- AnalysisTab "Phrases" KPI label cleanup (still shows stanza data with
  the label "Phrases"); chapter-card breakdown should display patterns,
  phrases, AND stanzas by type rather than conflating them.
- Bottom-up "phrases = collections of similar stanzas" algorithm —
  would replace the current cycle-driven detector with one that reads
  the stanza sidecar. Deferred until we see how chapter-scoped
  detection feels in practice.
- Shape labeler revival.
- Stanza rename + downbeat fix (videoflow), per
  `project-stanza-rename-pending` — first half of the rename landed
  this session; downbeat alignment is still v1.x.
