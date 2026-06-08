# Beta test bugs — dogfood log

Running list of bugs/edge-cases found in live user testing. Newest session
at top. Status: 🔴 open · 🟡 fixed-uncommitted (live in dev build, needs
verify + commit) · ✅ committed.

---

## Session 2026-06-08 (export restructure + events bake-in dogfood)

### 🟡 Fixed — live in dev build (HMR, pure JS), NOT yet committed

1. **Bare "Working…" with no description** after several changes in Chapters.
   The recalc/apply busy banner should say what it's doing (like the Assess
   phase). Root cause = the known issue #11: three sites called the busy
   indicator with a bare boolean (`setBusy?.(true)`), and App renders a neutral
   "Working…" fallback when `busy` carries no `.message`. Fixed all three to
   pass a descriptive message + clear with `null`:
   - `ChaptersTab.jsx` (Tame) → "Applying Tame to <chapter>…"
   - `PhrasesTab.jsx` (Apply transform) → "Applying <transform> to N phrases…"
   - `StanzasTab.jsx` (Apply transform) → "Applying <transform> to N stanzas…"
   → **Re-test:** apply Tame on a chapter / a transform on phrases — the footer
   names the operation, never bare "Working…".

2. **Phrase playback didn't stop at the focused phrase's end.** Playing p10
   (after editing p11/p12 — incidental) ran straight past p10's end into the
   next phrase. Root cause: focused-phrase `onTimeChange` was hard-coded to
   "play straight through, no loop-back" (the 2026-06-01 decision #9), so it
   never stopped at the boundary. Refined: when a phrase is **focused**,
   playback now **stops at its end** (pins to the boundary; no loop-back, no
   bleed into the next phrase). Re-pressing play replays the phrase from the
   top. Chapter scope (no focus) still plays straight through. (`PhrasesTab.jsx`
   onTimeChange + onPlayPause.)
   → **Re-test:** focus a phrase, play — it stops at the phrase end; press play
   again → replays from the start.
   → **Note:** reverses part of the 2026-06-01 "play straight through" call
   (#9) for the *focused* case, per the 2026-06-08 report. **StanzasTab has the
   identical handler — mirror this once phrases feel right** (left unchanged
   for now to verify on the reported surface first).

---

## Session 2026-06-01 (Timeline1 / large 6-min, 500 MB source)

### 🟡 Fixed today — live in dev build, NOT yet committed
Verify on a clean boot tomorrow, then commit.

1. **Project tab didn't reflect edits.** Hero Beat (Stanzas) / Tone / Apply
   updated the funscript everywhere *except* the Project tab — its chart
   showed the pre-edit shape. Root cause: `handleActionsPatch` only set
   `openedProject`, but ProjectTab renders the `loadedProjects` entry.
   Fix: patch both + set `hasWorkingEdits`. (`App.jsx`)

2. **Revert-to-original button never appeared.** Same root cause — the
   button + "Edited — working copy" pill gate on `project.hasWorkingEdits`,
   which was never set true. Fixed by the same `handleActionsPatch` change.
   → **Re-test:** make an edit → Project tab should show the amber pill +
   Revert button.

3. **Tone "jumps to tender" after Accept.** Accepting a chapter's tone
   auto-advances to the next chapter, which showed its own analyzer seed
   (often Tender/Build). Now **carries the accepted tone forward** to the
   next un-accepted chapter (tone + tuned params). (`ChaptersTab.jsx`)
   → Confirmed working in session (all 3 chapters became Tease).

4. **Library stuck on "Loading library…" with invisible error.** If
   `loadConfig()` rejected, `config` stayed null so the spinner showed
   forever and the error was never rendered (Header is gated out while
   loading). Now surfaces the error + a Retry button + logs the cause.
   (`LibraryScreen.jsx`)

### 🔴 Open — for tomorrow

5. **Split → new chapter's video doesn't load.** After a successful
   re-split (following a "playhead too close to boundary" error), the
   MediaViewer doesn't load the clip for the newly-created chapter.
   Under investigation when the session ended — not yet root-caused.
   - The active chapter feeds `useChapterClip` (deps `id/startMs/endMs`),
     so a new span *should* re-extract. Suspects: clip extraction failing
     on a non-keyframe split boundary (PIPELINE_ERROR_DECODE history), or
     `chapterClip.chapterId === active.id` guard mismatch after id
     renumber. **Need the console line** (`useChapterClip: … failed`) to
     confirm.
   - Repro: large file, split a chapter at the playhead, watch the
     right-side video for the new chapter.

6. **Library wedges under WebView2 memory pressure.** On this 500 MB
   source, loading many 250–508 MB chapter clips during rapid tab
   navigation made the WebView sluggish and stalled new IPC (library
   config load). Page reload does NOT clear it (WebView2 doesn't reclaim
   native video memory on reload) — only a full app restart does.
   - NOTE: Rust ffmpeg extraction is already async/non-blocking — this is
     a WebView-side resource issue, not Rust runtime starvation.
   - Possible mitigations to discuss: cap concurrent large-clip loads;
     downscale long clips regardless of width (the >1920px gate stays, but
     a long native-res chapter is still huge); release `<video>` buffers
     on tab switch; don't re-extract on every split.

7. **Split cascade is expensive.** One split = re-extract 2 large clips +
   re-run chapter-scoped phrase detection. Correct behavior, but the cost
   is what generates the memory pressure in #6 on large files. Worth
   making incremental / cheaper. (Architectural — user flagged this.)

8. **CharactersTab React key warning.** "Each child in a list should have
   a unique key prop" in `CharacterPanel` (`CharactersTab.jsx:727`). Minor
   but real — add keys.

9. 🟡 **Phrase/Stanza playback: removed loop-back — "just play."**
   DECIDED + DONE (uncommitted). Chapters keep their loop (edit scope);
   phrases & stanzas now play straight through with NO loop and NO jump,
   and the highlighted slice **stays put** (no auto-advance) until you
   stop. Replay is one click on the prev/back transport.
   - Fix: `onTimeChange` in `PhrasesTab.jsx` and `StanzasTab.jsx` is now
     just `setCurrentMs(ms)` (was: loop back to `sliceScope.start` on
     overshoot).
   - This also dissolves the original inconsistency (first/unfocused
     phrase played through because its `sliceScope` was the whole chapter;
     focused phrases looped at the phrase end). With no loop, all slices
     behave the same.
   - Left as-is for now: manual-scrub (`onSeek`) still clamps to the slice
     — only playback was changed. Revisit if scrubbing past a slice feels
     wanted.

### ⏳ Queued feature (decided, not a bug)

- **Precompute phrases + stanzas during Analyze** so the Analysis page is
  genuinely complete instead of recalculating when those tabs are opened.
  User chose "precompute" (folds the wait into Analyze — the wait already
  expected). Larger backend change.

### ✅ Confirmed working this session
Tame tone · Ramp up/down · Hero Beat ("beat change from a wall of red") ·
carry-forward tone · the before/after image preview.
