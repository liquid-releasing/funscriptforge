# Phrases v1 refit — plan

**Date:** 2026-05-26
**Status:** Design locked, implementation pending.

## Goal

Re-instate the `.phrases.json` slice-sidecar writer for the funscript
editing-phrase detector, with three new behaviors on top:

1. **chapter_id resolver** — replace hardcoded `null` with the chapter
   index whose range contains the phrase's midpoint.
2. **Length splitter** — phrases longer than 4 min get divided into
   `floor(duration / 2min)` pieces, snapped to the nearest downbeat
   within ±3 s, falling back to the ideal split timestamp.
3. **Straddling diagnostic** — when a phrase's time range crosses its
   assigned chapter's bounds, append `evidence: ["straddles:ch<N>→ch<M>"]`.

Detector itself is untouched — `assessment/analyzer.py` already produces
`AssessmentResult.phrases` with the metrics we want. The held shape
labeler (reverted 2026-05-23) stays out of scope; `label` defaults to
`"steady"` and the field is reserved for shape_labeler revival.

## What this is NOT

- Not a new boundary-detection algorithm. The analyzer's existing
  phrase boundaries are kept verbatim; the splitter is a *post-pass*.
- Not a rewrite of the detector's `max_phrase_duration_ms=300_000` (5 min)
  in-detection cap. That stays as a safety net; the refit splitter sits
  at the stricter 4-min musical threshold.
- Not editable phrase boundaries in the UI. Per
  `feedback-phrases-not-editable`, phrases stay detection-only; the
  Events surface is where users will correct.
- Not pattern-tab repair. Separate thread.

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
      "evidence": ["length_split", "straddles:ch0→ch1"]
    }
  ]
}
```

### Field decisions

| field          | type             | notes                                                                                                                                    |
|----------------|------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `version`      | int = `1`        | Additive changes only; bump when breaking.                                                                                               |
| `kind`         | `"phrase"`       | Matches slice data model.                                                                                                                |
| `source_file`  | absolute path    | The `.funscript` analyzed.                                                                                                               |
| `slices[].id`  | `ph_<n>`         | Re-numbered sequentially after the splitter runs (no parent_id field; parent reference lives in the `length_split` evidence tag).        |
| `chapter_id`   | int \| null      | Index into `chapters.json::chapters[]`. Null when no chapters sidecar available; never crashes.                                          |
| `label`        | string           | Reserved for shape_labeler. Hardcoded `"steady"` in v1. Code comment notes this is a placeholder.                                        |
| `metrics`      | dict             | Flat copy of the classifier's per-phrase metrics + `pattern_label`, `cycle_count`, `tags` from the Phrase dataclass.                     |
| `evidence`     | list[str], optional | Convention matches `chapters.json::chapters[].evidence`. Tags: `"length_split"`, `"straddles:ch<N>→ch<M>"`. Field absent when no evidence. |

## Algorithms

### chapter_id resolver

```
chapters = load("<stem>.chapters.json").get("chapters", [])
if not chapters:
    chapter_id = None
else:
    midpoint = (at_ms + end_ms) // 2
    chapter_id = index of chapter where at_ms <= midpoint < end_ms
                 (or null if midpoint falls outside all chapters)
```

Chapters are contiguous in practice, so the null branch should be
unreachable on real data; we still handle it.

### Length splitter

Trigger: `end_ms - at_ms > 240_000` (4 min).

```
n_pieces = floor(duration_ms / 120_000)   # ~2 min per piece
ideal_step = duration_ms / n_pieces

beats = load("<stem>.beats.json").get("downbeats_ms", [])
splits = []
for k in range(1, n_pieces):
    ideal_t = at_ms + round(k * ideal_step)
    # Snap to nearest downbeat within ±3 s, else use ideal.
    snap_t = nearest(beats, ideal_t, window_ms=3000)
    splits.append(snap_t if snap_t is not None else ideal_t)
```

Children inherit the parent's full `metrics` dict + `label`. Each child
gets `evidence: ["length_split", ...]` (additional tags appended by
straddling pass). Per-piece re-classification is **explicitly v1.x** —
re-running the classifier per child without confidence in the
boundaries would introduce noise.

If `beats.json` is absent, fall back to ideal split (no snap).

### Straddling diagnostic

After chapter_id assignment:

```
spans = [chapters[i] for i in range(len(chapters))
         if chapters[i].at_ms < phrase.end_ms and chapters[i].end_ms > phrase.at_ms]
if len(spans) > 1:
    tag = f"straddles:ch{spans[0].idx}→ch{spans[-1].idx}"
    phrase.evidence.append(tag)
```

Phrase's assigned `chapter_id` stays = midpoint chapter (the "primary"
chapter); straddling describes the leftmost→rightmost extent.

## Pipeline placement (in `cli.py::cmd_assess`)

```
result = analyzer.run(...)

# NEW: length splitter post-pass
result.phrases = split_long_phrases(result.phrases, beats_path=<beats sidecar>)

# NEW: write slice sidecar with chapter_id + straddling
_write_phrases_slice_sidecar(args.funscript, result, chapters_path=<chapters sidecar>)
```

Sidecar paths are derived from the funscript path via
`videoflow.sidecar.forge_dir()`. Both lookups are best-effort; missing
sidecars → chapter_id null and no snap, never an exception.

## Order of commits

1. **Re-instate writer** — paste `_write_phrases_slice_sidecar` back from
   the held shape_labeler memory, minus shape_labeler import. Label
   hardcoded `"steady"`. `chapter_id: None`. Re-establishes the on-disk
   sidecar; no behavior changes for downstream consumers (none read it
   today). Test: `cmd_assess` on `8.funscript` produces a valid v1
   sidecar.

2. **chapter_id resolver** — midpoint lookup. Test: same `8.funscript`
   run; chapter_id = 0 for all three phrases (single-chapter project).
   Dogfood on mashup: each phrase carries a real int chapter_id.

3. **Length splitter** — pure function on `List[Phrase]`. Unit tests
   covering: (a) phrase below threshold pass-through, (b) phrase at
   exactly 240 s = no split, (c) phrase = 273 s (VictoriaOaks ph_2)
   splits into 2 pieces ~136 s each, (d) split snaps to a downbeat when
   one exists in window, (e) falls back to ideal when no downbeat in
   window, (f) handles missing beats sidecar gracefully.

4. **Straddling diagnostic** — appended in the writer after splitter
   runs. Tests: phrase wholly inside one chapter → no tag; phrase
   crossing one boundary → `["straddles:ch0→ch1"]`; phrase spanning
   three chapters → `["straddles:ch0→ch2"]`.

Steps 1+2 land together (smallest coherent commit). Steps 3 and 4 land
independently.

## Dogfood targets

**VictoriaOaks_stingy.original.mp4** is the primary dogfood —
17-chapter mashup of 16 source clips at
`forgeassembler/test_media/victoriaoats/`. Cumulative source-clip
durations give exact seam ground truth (table below). The current
chapter detector hits ~8/16 seams within 30 s, misses 4 by >60 s, and
inserts 3 boundaries inside real clips.

Ground-truth seam timestamps (cumulative end-of-clip, ms):

```
211242, 531442, 886648, 1340724, 1713879, 2003535, 2348802, 2758273,
3131846, 3517613, 3909280, 4168819, 4519919, 4799686, 5203119, 5592719
```

After dogfood the funscript analyzer runs on
`VictoriaOaks_stingy.original.funscript`, we expect:
- Some phrases >4 min → splitter fires, length_split evidence appears.
- Many phrases will likely carry `straddles:` evidence (the mashup is
  heterogeneous by design — phrases that survive across a seam are the
  interesting cases for future data science).
- `chapter_id` is a valid int (0..16) on every phrase.

## Out of scope (v1.x candidates)

- Per-piece re-classification after splitter.
- Real downbeat detection (current implementation = every 4th beat
  assumption — see `project-stanza-rename-pending`).
- Ground-truth seam wiring into `evidence` (e.g.
  `["gt_seam:8", "straddles:ch7→ch9"]`). Requires routing forgeassembler
  output into the detection pipeline; nice for future scoring runs.
- Shape labeler revival (per `project-held-shape-labeler`, the source is
  preserved in memory and pastes back when a consumer exists).
- Rename of videoflow's `classify_phrases` → `classify_stanzas` (separate
  v1.x work — `project-stanza-rename-pending`).
