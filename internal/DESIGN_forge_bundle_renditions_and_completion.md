# `.forge` bundle — renditions and completion

**Status:** proposal, not built. Owner: FunscriptForge (it authors `ffmeta`).
**Consumers to change:** FunscriptForge, ForgeAssembler, ForgePlayer.
**Breaking is acceptable** — as of 2026-09-28 the only user of FSF and
ForgeAssembler is the author, and `.forge` files have not been released to
ForgePlayer users yet. That window will close; do this while it is open.

Two additions, unrelated in purpose but landing in the same file:

1. **Renditions** — one scene, several video files at different sizes.
2. **Completion** — "I am finished with this", recorded where it survives.

---

## What the manifest looks like today

Written by `cli.py` (FSF, the `export` command) and mirrored by
ForgeAssembler's `bundle_out.py`, which exists specifically so there is not a
second dialect.

```json
{
  "version": 1,
  "schema": "ffmeta/v1",
  "stem": "JPVT1109 - OurDream AI-Generated PMV (part 1)",
  "pipeline_version": 3,
  "created_with": "FunscriptForge",
  "duration_ms": 3597000,
  "project_id": "…",
  "project_version": 7,
  "exported_at": "2026-09-26T…Z",
  "artifacts": [ … ],
  "stations": { … },
  "assessment": { … },
  "media": {
    "filename": "JPVT1109 - OurDream AI-Generated PMV (part 1).mp4",
    "size": 1911965368,
    "head_sha256": "71f3d87c…",
    "kind": "video",
    "bundled": false
  }
}
```

`media` is a **single object**. That is the thing both additions push against.

---

## 1. Renditions

### Why

A compilation wants more than one video out of it: 4K to keep and watch,
1080p to send to someone else. Same edit, same joins, same funscripts —
different pixels. ForgeAssembler already names them so they can coexist:

```
Best Of.4k25.mp4
Best Of.1080p25.mp4
```

The bundle should know about both, so ForgePlayer can offer a quality picker
instead of the user hunting for the right file.

This is semantically right, not a hack: **the bundle is the scene**, and the
videos are renditions of one timeline. Verified by measurement, not memory —
`concat_funscript.py`, `concat_audio_estim.py` and `bundle_out.py` contain
**zero** references to resolution, width or height between them. A stroke at
00:42:17 is at 00:42:17 whichever render you play.

### Shape

Add a sibling; do not retype `media`.

```json
"media": { …unchanged, the default/primary rendition… },
"renditions": [
  { "filename": "Best Of.4k25.mp4",    "size": 9499555522, "head_sha256": "…",
    "width": 3840, "height": 2160, "fps": 25, "tag": "4k25",  "kind": "video", "bundled": false },
  { "filename": "Best Of.1080p25.mp4", "size": 2011…,      "head_sha256": "…",
    "width": 1920, "height": 1080, "fps": 25, "tag": "1080p25", "kind": "video", "bundled": false }
]
```

Each entry carries its own relink key (`filename` + `size` + `head_sha256`,
the same triple `media` uses) plus the dimensions, so a picker can label
"4K / 1080p" without opening a single file.

**Why additive rather than making `media` an array:** FSF and ForgePlayer both
read `media` as an object today. Retyping a field that existing readers
consume is the mistake that turned a float into a `u32` in ForgePlayer's Rust
and took a release to unpick. A reader that knows nothing about `renditions`
keeps working on `media`; a reader that does gets the list. We are allowed a
breaking change here — we do not need one.

### The rule that matters

**`renditions` is a list of candidates, not a promise.**

The user keeps the 4K and ships the 1080p. The recipient's bundle will
reference a file they do not have, and that is normal, not an error. A
consumer must:

- offer only the renditions it can actually resolve on disk;
- fall back to `media` when none resolve;
- never fail to open a bundle because a rendition is missing.

### Consequence for re-renders

A video-only re-render must **append to the manifest**, not re-export the
bundle. Re-exporting would rebuild every funscript and sidecar to change one
list entry, and would bump `project_version` for something that did not
change the project.

---

## 2. Completion

### Why

A pipeline that ends with nothing to press just trails off. FunscriptForge's
Viewer already has a red accept/checkmark at the end of its chain, and its
value is exactly that it marks a moment — "yep, I am finished with this" —
even though it changes no bytes.

ForgeAssembler is adding the same at the end of its chain (Viewer, stage 04).
Both should record it somewhere that survives the session, and the `.forge`
file is where a scene's truth lives.

### Shape

```json
"completion": {
  "state": "complete",
  "at": "2026-09-28T11:42:00Z",
  "by": "ForgeAssembler"
}
```

`state` is an enum so it can grow (`complete`, and later perhaps `wip` or
`needs-rework`) without another retype. `by` distinguishes a scene the author
finished in FSF from a compilation finished in ForgeAssembler.

### What reads it

- **Home / recents** in both apps: a finished project should look finished
  next time you open the app. This is the whole point — the marker exists to
  be seen later, not to gate anything.
- **ForgePlayer library**: could surface "finished" scenes distinctly.
  Optional.

### What it must not do

Gate anything. Completion is a note the author left themselves. Nothing may
refuse to forge, export or play because of its value.

---

## Order of work

1. **FSF** writes and reads both fields; it owns the schema.
2. **ForgeAssembler** writes both (`bundle_out.py` mirrors FSF), and marks
   completion from its Viewer stage.
3. **ForgePlayer** reads `renditions` for a quality picker and may surface
   `completion` in the library.

Bump `schema` to `ffmeta/v2` only if a reader would be *wrong* rather than
merely uninformed. Both additions here are ignorable by an old reader, so v1
can stand — decide at implementation time, not now.

## Open questions

- Should `media` stay the "primary" rendition, or become purely a
  back-compatibility alias for `renditions[0]`? Alias is cleaner long-term
  and costs a line.
- Does ForgePlayer want the picker per-scene, or a global "prefer 1080p"
  preference with per-scene override? The second is probably what a user
  actually wants and does not change this format.
