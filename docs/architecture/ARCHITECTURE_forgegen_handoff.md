# forgegen → FunscriptForge handoff

> **DEPRECATED — forgegen is no longer a separate product.** Generation
> now runs inside FunscriptForge itself: the Generate tab drives the
> videoflow engine directly, so there is no second app to hand off
> *from*. Nothing here describes a workflow a user can follow today.
>
> **Kept, not deleted**, because the artifact it specifies is still
> real. `<stem>.analysis.json` remains a format FunscriptForge can read,
> and this is the record of what its fields mean and why the sidecar
> (rather than IPC or a URL handler) was chosen as the vehicle. If a
> future tool writes analysis alongside a funscript, this is still the
> contract to implement.
>
> Read the rest as history: statements about "what forgegen writes" mean
> "what an external analysis producer would write."

_Original document follows._

> When a user opens a funscript that forgegen produced, FunscriptForge
> picks up forgegen's analysis context (chapters first, more later)
> rather than re-deriving it. This doc records the decision and scopes
> what FF reads in each phase.

## Decision (2026-04-29)

The handoff vehicle is the canonical **`<stem>.analysis.json`** sidecar
defined in forgegen's `docs/architecture/analysis-schema.md`.
forgegen writes it next to the funscript; FunscriptForge reads it on
funscript load.

No new protocol, no IPC, no URL handler. The sidecar pattern was already
specced for cross-app data sharing across the forge family — FF becomes
one consumer among many (alongside ForgePlayer, forgevents, FF Pro).

### What this changes for FF

- FF stops re-deriving chapter boundaries from a funscript that forgegen
  already analyzed. The chapters forgegen used to bias generation are the
  chapters FF receives.
- FF's existing `_*.json` cache files (`_beats.json`, `_assessment.json`,
  `_video_motion.json`, etc.) are **not** affected in Phase 1 — analysis.json
  is read-only on FF's side.
- The eventual destination (Phase 3) is for FF's caches to fold into the
  canonical schema, but that's a separate migration.

## Phased rollout (FF perspective)

### Phase 1 — v0.1: read chapters from analysis.json

FF gains a chapter reader. Inputs go one direction only: forgegen → FF.

**Reader contract:**

- On funscript load, look for `<stem>.analysis.json` in the same directory.
- If present:
  - Validate `version`. v1.0 only for now; reject newer majors with a clear
    error; ignore newer minors and read what we recognize.
  - Read `structural.chapter_proposals[]`. Empty array is valid (means
    "forgegen looked, found nothing").
  - Populate FF's chapter representation (see "FF chapter model" below).
- If absent, missing, or malformed: fall back to current behavior (no
  chapters). Do not block funscript load on analysis.json problems.

**FF chapter model (new):**

FF currently has no chapter representation in `forge/project.py`. Phase 1
adds a minimal one:

```python
# in forge/project.py default_forge()
"chapters": []  # list of {at_ms, end_ms, intent, source}
```

`source` records provenance — `"forgegen_analysis"` for chapters loaded from
analysis.json, vs. user-authored later. This matters for Phase 3 round-trips:
we don't want to round-trip auto-generated chapters back through analysis.json
without distinguishing them from human-curated ones.

**Reader location:**

The funscript load path in `forge/tabs/project_tab.py` (around the
`load_funscript` calls near lines 222 and 566) is the natural hook. Add an
`load_analysis_sidecar()` helper in `forge/project.py` that returns chapter
records, and call it after the funscript is loaded.

### Phase 2 — read more sections

As forgegen begins emitting `audio_features`, `structural.phrases`, and
`generation_choices`, FF reads what's relevant:

- `audio_features.beats` → satisfies what FF currently computes into
  `_beats.json`. FF can skip the recomputation when analysis.json is present
  and source md5 matches.
- `structural.phrases` → maps to FF's existing assessment/phrases representation.
- `generation_choices` → "this section was generated as an `edge` chapter
  with full density" — informational overlay in the UI.

Backwards compatible: FF reads what it recognizes, ignores the rest.

### Phase 3 — FF migrates its caches

FF's scattered `_*.json` files fold into the canonical `analysis.json`.
Round-trip works both ways: forgegen produces, FF augments, forgegen reads
back what FF added (e.g. user-curated chapters).

This is a real migration. Decide scope after Phase 2 ships and we know which
field shapes diverge from forgegen's emit shape vs. converge cleanly.

Affected files (today):

- `forge/beats.py` — `_beats.json` writer/reader
- `forge/video.py` — `_video_motion.json`
- `forge/assessment` (via `_assessment.json`)
- `forge/captions.py` — `_captions.json`
- `forge/project.py` chain caches (`_funscript_*.json`)

## Open questions

1. **Where does analysis.json live when FF creates a project from an existing
   funscript?** If the user opens `~/scripts/track.funscript` and FF's project
   output_folder is `~/projects/myproject/`, does FF look for the sidecar next
   to the funscript (source-adjacent) or in the project folder? **Decision:
   source-adjacent for v0.1** (matches forgegen's write location). FF can
   copy/promote it into the project folder later.
2. **Stale analysis.json detection.** `source.audio_md5` lets FF detect that
   the source has changed since analysis. Phase 1: report it but read anyway.
   Phase 2+: option to re-run analysis when stale.
3. **Conflict between `<stem>.chapters.json` and analysis.json's
   `chapter_proposals`.** videoflow's resolver priority (per
   `videoflow.chapters` docstring) handles this for chapter loading. FF
   should defer to the same priority order rather than reinventing.

## Cross-references

- **Canonical schema:** `forgegen/docs/architecture/analysis-schema.md`
- **Cross-app principle:** `forgegen/docs/architecture/canonical-emit-pattern.md`
- **Chapter resolver:** `videoflow/src/videoflow/chapters.py`
- **forgegen side of this decision:** `forgegen/docs/architecture/funscriptforge-handoff.md`

## Implementation checklist (Phase 1)

- [ ] Add `videoflow` to FF's dependencies (it's the chapter-resolver source of truth)
- [ ] Add `chapters: list` to `default_forge()` in `forge/project.py`
- [ ] Add `load_analysis_sidecar(funscript_path) -> dict | None` helper in `forge/project.py`
- [ ] Wire the loader into `forge/tabs/project_tab.py` funscript-load flow
- [ ] Map `analysis.structural.chapter_proposals[]` → FF chapter records (`{at_ms, end_ms, intent, source: "forgegen_analysis"}`)
- [ ] Surface chapters in the project UI (read-only display in v0.1; editing comes later)
- [ ] Test: funscript with adjacent analysis.json → chapters loaded
- [ ] Test: funscript without analysis.json → load succeeds with empty chapters
- [ ] Test: malformed analysis.json → load succeeds with empty chapters + warning
- [ ] Test: analysis.json with newer major version → load fails with clear error
