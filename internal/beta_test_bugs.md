# Beta test bugs — dogfood log

Running list of bugs/edge-cases found in live user testing. Newest session
at top. Status: 🔴 open · 🟡 fixed-uncommitted (live in dev build, needs
verify + commit) · ✅ committed.

---

## Session 2026-06-09 (Phase 3 dogfood — post streamlit-removal + Resume build)

### 🟡 Fixed-uncommitted (live in dev build, needs verify + commit)

4. **Title-bar filter dropdown removed** (user: "remove the filter dropdown in
   the title bar"). Dropped the `ScopePicker` (label="Filter") from `TopBar` in
   App.jsx + its now-dead `scopeId`/`scopes` state; StatusBar scope is now a
   static "all chapters".

5. **Hardcoded version "scaffold v0.0.1" → real version from package.json**
   (user: "update scaffold v0.0.1 to an actual version number"). New
   `src/appVersion.js` imports `package.json` version (auto-tracks the
   cut-release bump). Wired the title bar, StatusBar, and AboutDialog to it;
   dropped the "scaffold" codename. Now shows **v0.1.0-alpha**.

6. **About dialog fleshed out** (user: "About menu item with the hero and
   liquid releasing white-on-transparent logo, copyright, license, github,
   acknowledgements"). Source of truth = `forge/about.py` (the old Streamlit
   About expander), ported to the React `AboutDialog.jsx` + updated for the
   Tauri build (dropped the stale "Streamlit/PyWebView" tech line). Now has:
   hero banner (`/hero-forge.png`), LR white-on-transparent logo in the footer
   (`media/…White-on-Transparent….svg` copied to `public/liquid-releasing-white.svg`),
   tagline, **real acknowledgements** (funscript-tools/Edger, restim/Diglet48
   MIT, FFmpeg LGPL/GPL, librosa·numba·SciPy, Tauri·React·Vite·Lucide — each
   linked, under its own license), GitHub links, and a footer with
   trademark + © 2026 Liquid Releasing + MIT. Opens from the existing TopBar
   help button. ⚠️ **Compliance flag (not blocking):** we bundle a GPL ffmpeg
   (gyan essentials includes libx264/GPL) inside an MIT app — redistributing
   GPL binaries has obligations (offer corresponding source / honor GPL). Worth
   a real license review before public beta; the About now at least names it.

1. **MediaViewer wheel-absorb broken — passive `preventDefault` no-op.**
   Console spam `MediaViewer.jsx:675 Unable to preventDefault inside passive
   event listener invocation`, and the actual symptom: wheeling over the media
   surface still scrolls the outer editor page (the absorb it was meant to do
   never worked). Root cause: `onWheel={handleWheelAbsorb}` → React onWheel is
   passive. Fix: bound via `useNativeWheel(rootRef, …)` (non-passive
   addEventListener). forgemoment `MediaViewer.jsx`. Matches the standing
   `feedback_react_wheel_passive` rule. → **Re-test:** wheel over the viewer =
   no page scroll, no console warning.

### ✅ Resolved during triage (not a bug)

2. **Large chapter clips (268–655 MB) — RESOLVED: 1080p native, expected.**
   ffprobe of the local VictoriaOaks `.forge/clips/*.mp4` = **1920×1080** at
   282–587 MB (same ballpark as the console's 268–655 MB). A 1080p source
   passes through at native res by design (downscale only triggers above
   1920px — `feedback_chapter_clip_threshold`), so large 1080p clips are
   expected and the blob-cap fallback handling them (no OOM) is the system
   working as intended. NOT the 4K-downscale bug. (Couldn't probe the user's
   exact downloaded file — but every local VictoriaOaks copy that has clips is
   1080p; the common VO distribution is 1080p.) Side-note still true: a 655 MB
   clip = a long / possibly over-merged chapter (separate detection-quality
   item, already tracked in pending).

### 🟡 Fixed-uncommitted — no-op Reset removed

3. **Footer Reset (no-op stub) removed** (user: "remove the noop reset
   button"). `App.handleReset` was an intentional no-op ("so the button doesn't
   pretend to work") and reading as a broken Cancel during analysis. Gated the
   Reset button on `onReset` presence in shared `forgemoment/AppShell.jsx`
   (clean opt-in API — other forge apps that pass onReset keep theirs), then
   dropped `onReset` + the stub from App.jsx.

### ⏳ Deferred — POST-BETA (user decision)

- **Cancel a running analysis (footer Cancel).** Real feature, parked for
  post-beta. `run_cli_with_progress` (commands.rs ~528) uses
  `cmd.output().await` (no killable child). To build later: spawn → keep the
  `Child` in managed state (`State<Mutex<Option<Child>>>` / abort registry by
  run token) → `cancel_analysis` command that `.kill()`s it → footer **Cancel**
  shown while `busy`/`analyzing` that calls it + clears busy. See
  project_funscriptforge_post_beta.

### ✅ Confirmed working this session
- Full accept-and-chain navigation project→analysis→chapters→phrases→events→
  stim→polish→export (App.jsx chain logs clean).
- Chapter-clip blob-cap fallback (no OOM on 268–655 MB clips).

---

## Session 2026-06-08b (post-compact re-test: Events lane + Polish forge progress)

### ✅ Committed this session

1. **Events funscript lane mis-rendered on sparser chapters** (VictoriaOaks
   ch1/ch5/ch12 = near-empty low line; ch10/ch13 correct). Stanzas/Chapters
   drew the same data correctly. Root cause: different renderers — Stanzas uses
   `Charts.Sparkline` (connects a line through every action → real motion at any
   density); Events used `TrackStack`'s per-pixel min→max envelope BARS, which
   collapse to a 1px dot when a chapter has fewer actions than pixels. Rewrote
   the Events lane to the connected-polyline model, still bucketed into ~16
   velocity paths (HMR stack-overflow guard). forgemoment `c7a78ff`.
   → **Re-test:** VictoriaOaks ch1/ch5/ch12 now show the velocity heatmap.

2. **Polish forge "does not return" / no real progress.** The whole-track
   e-stim/TCode forge runs the full Restim/multiaxis pipeline once per chapter,
   serially, then bakes events + clamps. Footer sat on ONE static line the whole
   time → read as a hang. **CLI proof: VictoriaOaks (17 ch, 23.7k actions) =
   28.6s exit 0; Prisoner (13 ch + events) = 31s. Returns cleanly; stderr only
   ~87 lines (no pipe-buffer deadlock).** Added per-chapter `progress:` lines
   (`_polish_generate_estim`/`_tcode`) → `run_cli_with_progress` → `ff:progress`
   → PolishTab footer ("Forging E-Stim — chapter 7 of 17…" + bake/clamp).
   funscriptforge `d12ba15`. ⚠️ Rust changed → tauri:dev MUST recompile.

### 🔴 OPEN — needs repro on the recompiled (progress) build

3. **In-app forge reportedly ran 5+ min without returning** — but CLI is ~29s
   for the same file. So it's NOT Python slowness. Either the user was on the
   pre-recompile build, or a bridge stall. The new per-chapter progress is the
   diagnostic: if it still hangs, note the LAST progress line shown (which
   chapter / "baking" / "clamping") to localize it. tokio `output().await`
   drains both pipes, and funscript-tools is pure-Python (no lingering
   grandchild to hold the pipe), so a classic pipe deadlock is unlikely.

4. **Polish 3-pane preview funscripts don't match the actual stamped channels**
   (user: OK monochrome; goal = show how the SLIDERS reshape values; "will show
   in next pass"). Cause: preview runs `polishEngine.previewPass` on a 30s
   window of the MOTION funscript (clamp-only) — for e-stim it does NOT run the
   9-channel generation (too slow live), so it previews the wrong signal.
   Honest for strokers (Handy); misleading for e-stim/TCode. DEFERRED.

5. **Polish re-runs "Assessing phrases" on tab nav (before forging).** PolishTab
   itself never touches phrases, so a parent/shared effect is firing it. Needs
   devtools/repro to pin.

6. **Analysis Structure cards show "—"** (phrases/stanzas count not precomputed
   during Analyze — known queued gap) AND **re-Analyze does not rebuild values
   on the tabs.** The rebuild part is potentially real; needs repro.

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
