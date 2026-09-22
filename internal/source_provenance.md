# Chapter source provenance (incoming contract)

> **Status:** forward contract / not yet built. Read before wiring video-aware
> refine defaults. Companion to forgegen's decision note,
> `forgegen/architecture/VIDEO_VIA_EXTERNAL_GENERATOR.md`.

## What's coming

forgegen is gaining **per-chapter source selection**: each chapter's strokes can
come from the audio influence mix *or* from an external video-derived track
(Funscript-Flow CV today; FunGen / a user's own script later — all ingested
through one "external source track" path). When that ships, the chapter sidecar
carries a per-chapter **`source`** field:

```jsonc
{ "id": "ch-3", "source": "video", ... }   // "audio" | "video" | "external"
```

FunscriptForge is the **refiner** (stage 8 in forgegen's video pipeline). It
reads this provenance; it does not set it.

## Why FunscriptForge cares

The refine defaults that feel right differ by source:

- **`video`** — CV tracks (optical-flow / keypoint) are **jittery**: noisy
  micro-motion, occasional tracking dropouts, unrealistic spikes. Sensible
  defaults: stronger **smoothing / low-pass**, **velocity cap**, jitter
  suppression. The existing `tame` transform + Polish smoothing are the right
  tools — just biased on by default for video chapters.
- **`audio`** — synth tracks are already clean but generic; default to **light**
  smoothing (don't sand off intentional shaping).
- **`external`** — unknown provenance (hand/AI script): treat as `audio`-clean
  by default, no aggressive smoothing.

## When we build this

1. **Read-only first:** surface `source` per chapter (a small chip on the
   chapter row — "video" / "audio") so the user *sees* provenance. No behavior
   change. Safe, immediately useful.
2. **Then bias refine defaults** by source (above). Make it a default, never a
   lock — the user can always dial smoothing back.
3. Tolerate absence: chapters without a `source` field = today's behavior
   (treat as `audio`). The field is additive; old projects keep working.

## Cross-references

- [`.forgegen-internal/architecture/funscript-flow.md`](../../.forgegen-internal/architecture/funscript-flow.md) — the upstream decision (external source tracks, per-chapter selection, why CV is jittery).
- [`internal/ARCHITECTURE_stim.md`](ARCHITECTURE_stim.md) · [`internal/definitions.md`](definitions.md) — current sidecar/chapter vocabulary this field extends.
- `tame` transform + Polish smoothing — the existing tools the video-default would lean on.
