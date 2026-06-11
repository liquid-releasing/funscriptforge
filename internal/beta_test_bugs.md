# Beta test bugs — dogfood log

Running list of bugs/edge-cases found in live user testing. Newest session
at top. Status: 🔴 open · 🟡 fixed-uncommitted (live in dev build, needs
verify + commit) · ✅ committed.

---

## Session 2026-06-11 (Phase 3 dogfood — consolidated pipeline pass)

### 🔴 Open

D1. **🟡 FIXED-UNCOMMITTED 2026-06-11. Duplicate concurrent `auto-chapter` on
   the same project.** FIX: `commands.rs::kill_existing_analyze(media)` — before
   `analyze_chapters_with_videoflow` spawns, it reaps any pre-existing/orphaned
   python `auto-chapter` proc for the SAME media stem (Windows: PowerShell
   Get-CimInstance filter → `taskkill /PID /T /F`, CREATE_NO_WINDOW, wildcard
   metachars escaped; Unix: `pkill -9 -f`). Lives in the Rust process so it
   survives webview reloads (the JS `dedupedCall` map doesn't); runs BEFORE
   spawn so it only ever targets a stale run, never the new one; stem-matched so
   a legit parallel analyze of a DIFFERENT project is untouched. Compiles clean.
   Covers the reload-orphan + Re-analyze-double-fire cases we hit repeatedly.
   ⚠️ Narrow residual: two TRULY-simultaneous different-trigger fires (both
   pre-scan before either spawns) — mostly covered by the JS same-key dedup;
   escalate to a Mutex-guarded PID registry only if it recurs. NEEDS live
   verify: restart an analyze, trigger a second mid-run → only ONE process.
   _(original report below)_

D1-orig. **Duplicate concurrent `auto-chapter` on the same project.** While
   dogfooding VictoriaOaks (4K) two identical `cli.py auto-chapter
   VictoriaOaks_stingy.original.mp4 --target-minutes 5.5` processes ran at once
   (PIDs 39792 + 35912, same args), both writing to the same
   `.VictoriaOaks_stingy.original.forge/` → racing sidecar/clip writes + 2× the
   ffmpeg load on a 4K source.
   - **Root cause:** forge.js `dedupedCall` map is in-memory JS. A webview
     reload (HMR on startup here — the `Couldn't find callback id` warnings)
     wipes the dedup map but does NOT kill the already-running Rust/python
     process. Sequence: app auto-started analyze (#1) → reload orphaned its
     callback → user clicked Reanalyze → #2 spawned with no dedup memory of #1.
   - **Impact:** orphan's UI callback is dead (output discarded by UI) but it
     still writes to disk = pure waste + corruption race.
   - **Fix direction:** dedup/cancel must survive a reload. Options: (a) on
     analyze-start, have Rust check for & kill any existing `auto-chapter`
     process for the same target before spawning; (b) a lockfile in `.forge/`
     that a second analyze refuses/adopts; (c) persist the in-flight key so a
     reloaded webview can re-attach instead of re-spawning. (a) is simplest and
     also kills true orphans. Production crash-reload could repro, not just HMR.
   - **⚠️ REPRODUCED on IPZZ-125 (4K) with NO HMR reload** — just opening +
     Reanalyze spawned 2 (PIDs 34300 + 39140). So the dedup gap is wider than
     "reload wipes the map": the analyze trigger itself isn't guarded against
     double-spawn (project-open auto-analyze colliding with the manual Reanalyze
     click, OR Reanalyze double-firing). On a 4K source this = TWO concurrent
     4K→720p transcode passes = 2× CPU/time. Output stays correct via
     `.tmp.<pid>` + atomic rename, but it's badly wasteful. Raises severity:
     option (a) (kill-existing-before-spawn in Rust) is the right fix and should
     land before beta.
   - **3rd symptom — progress footer desync.** With 2 streams feeding one
     footer, the headline and the step-list disagree: observed headline
     "Classifying chapter 12/21" while the step list still showed only
     extract ✓ / load ✓ / detect (spinning). Two interleaved progress streams →
     the footer shows an impossible/inconsistent state. Fixing D1 (single
     process) also fixes this.

D5. **★ MAJOR / BETA-GATE — 🟡 FIXED-UNCOMMITTED 2026-06-11. Resume CTA never
   appeared in its primary scenario (interrupted during chapter_clips).**
   FIX: made `deriveAnalysisState` clip-aware. New read-only Rust
   `count_chapter_clips(media_path)` (counts `.forge/clips/*.mp4`, excludes
   `.tmp.<pid>.` partials) → `forge.js countChapterClips` → AnalysisTab counts on
   load + re-counts when `analyzing` flips false → added a `clips` artifact
   (`expected = chapters.length`, present iff count ≥ expected; null count = not
   penalized). Now "all sidecars present + clips short" → `'partial'` → Resume
   CTA shows. LIVE-VERIFIED: simulated 20/21 on IPZZ-125, reopened → banner
   "Partial analysis — 4 of 5 stages … Missing: chapter clips" + Resume button
   appeared. Files: commands.rs (+lib.rs handler), forge.js, AnalysisTab.jsx.
   **D5b — FINAL DESIGN (user, 2026-06-11): no Resume button at all; Accept
   auto-resumes.** Iterated live: (1) tab banner Resume → (2) global footer
   strip → (3) user: "why do I need a button? once the user clicks Accept it
   just resumes." LANDED: lifted `deriveAnalysisState` to `src/lib/analysisState.js`
   (shared by App + AnalysisTab); App computes a global `analysisPartial` from
   trackPeaks/spectrogram/beats + project.chapterList(or .chapters) + an
   App-level `countChapterClips` (recounts when `busy` clears). `handleAccept` is
   now async: when `analysisPartial`, it awaits `handleAnalysisResume`
   (analyze --resume → finishes only the missing clips, busy footer shows
   progress) and only chains on success. Accept label flips to "Finish analysis
   & chain to <next>" when partial. NO gate, NO separate Resume button, NO footer
   strip — the existing AnalysisTab banner stays as the detailed status/escape
   hatch (Re-analyze). vite build green; live-verified the footer strip + resume
   before the pivot. Files: App.jsx, AnalysisTab.jsx (banner now imports from
   lib), lib/analysisState.js, commands.rs/lib.rs/forge.js (count_chapter_clips).
   ⚠️ Pending live retest of the final Accept-auto-resume after a hard reload
   (Fast Refresh stack-overflow from the rapid edits — needs full reload).

   **D5c — single-chapter edge fix (found while testing).** Timeline1 (1 chapter
   = whole 615 MB source) has 0 clips by design — the blob-cap skip means a
   whole-video chapter never extracts a clip (verified: `--resume` produces no
   chapter_clips stage, 0 clips). The naive `clips < chapters → partial` would
   flag it perpetually partial → Accept-resume infinite loop. FIX in
   `deriveAnalysisState`: clips are OPTIONAL when `expectedClips <= 1`; only
   MULTI-chapter projects can be partial-on-clips. Residual (noted, deferred):
   a multi-chapter video with a dominant >50%-of-source chapter that skips its
   own clip could still false-positive — real fix is recording the expected
   clip count in the sidecar. vite build green.

D5-orig. **(original report)**  Killed IPZZ-125 (4K) mid-`chapter_clips`
   (20/21 clips done, ALL 4 sidecars fresh), reopened → Analysis tab shows ONLY
   "Re-analyze", NO "Resume". So the only button wipes 20 clips + 4 sidecars and
   re-runs the entire 2-hour 4K pipeline — the precise waste Resume was supposed
   to prevent. **This defeats the Resume beta gate for the case it was designed
   for.**
   - **Root cause (UI):** `AnalysisTab.jsx::deriveAnalysisState` (~line 791)
     defines `partial` purely from `ANALYSIS_ARTIFACTS = [chapters, peaks,
     spectrogram, beats]` — the 4 audio/chapter SIDECARS. `chapter_clips` is NOT
     an artifact. With all 4 sidecars present, `missing.length === 0` → state =
     `'complete'` (line 809) → `AnalysisStateBanner` returns null (renders only
     on `'partial'`, line 711) → no Resume CTA. Incomplete chapter clips are
     invisible to the state machine.
   - **Backend is fine:** videoflow `auto_chapter(resume=True)` Tier-1 short-
     circuits to chapter_clips when sidecars are fresh. The `--resume` plumbing
     (cli.py → commands.rs → forge.js → handleResume) all exists. The ONLY gap
     is that the UI never enters `'partial'` for this case, so `handleResume`
     (which passes `resume:true`) is never reachable.
   - **Fix:** make `deriveAnalysisState` clip-aware — add chapter_clips
     completeness as an input (expected = chapters.length; present = count of
     clip files in `.forge/clips/`). When clips < chapters AND sidecars done →
     `'partial'` with missing=['chapter clips'], so Resume shows and finishes
     just the clips. Needs a Rust/CLI "count clips" call (or have the merged
     sidecar/manifest record clip completion). Must land before beta.
   - **Related (user-confirmed) — gate accept-and-chain on TRUE completion.**
     While analysis is incomplete (busy footer running, OR partial/missing
     clips) the "accept and chain → Chapters" CTA should be DISABLED so the user
     can't advance downstream with half-baked analysis. Today the state machine
     flips to `'complete'` as soon as the 4 sidecars land (clips can still be
     missing), so accept-and-chain enables too early. The clip-aware fix above
     makes `'complete'` mean "all sidecars + all clips," which both surfaces
     Resume AND lets accept-and-chain gate correctly. Same fix, both behaviors.

D6. **Black box overlaying chapter-12 video playback (IPZZ-125).** Clicking
   chapter 12 (67:42–73:40, "Tone: Build", frame @ 01:07:42.656) shows a large
   solid-black rectangle over the lower-center of the video frame; the rest of
   the frame renders correctly and the iris coloring is intact. Clip plays
   without OOM (it's the >150 MB asset-URL path). UNCLASSIFIED pending a
   play-through test: (a) moves with content = baked into source (not our bug),
   (b) fixed screen position = mis-positioned UI overlay, (c) clears on play =
   WebView2 decode artifact on the asset-URL/first-frame path. TBD.

D4. **🚫 SKIPPED (user, 2026-06-11): Cancel button not wanted in the UI.** The
   underlying problem (orphaned/duplicate analyze) is fixed automatically by D1
   (kill-existing-before-spawn) — no user-facing Cancel needed. User: "I'm not
   sure I want it in the actual UI." Can revisit if a real need surfaces.
   _(original report below)_

D4-orig. **No Cancel button for a running analyze.** User looked for a way to stop
   an in-progress `auto-chapter` run and there is none in the UI — the only
   stops are closing the app or killing the process externally. On a 2-hour 4K
   source (minutes of clip extraction) this is a real gap: a user who started
   the wrong project, or wants to abort, is stuck. Beta should add a Cancel
   that kills the spawned `auto-chapter` process (and its ffmpeg children) and
   returns the tab to its Partial/idle state. Pairs with D1's fix (Rust already
   needs process-handle tracking to kill-existing-before-spawn; Cancel reuses
   the same handle). Note: closing the app mid-analyze exits cleanly (no crash)
   but orphans the python/ffmpeg children unless they're killed — Cancel +
   app-close should both reap them.

D3. **Analysis-tab "Phrases" KPI (+ per-chapter phrase counts) show "—" on a
   freshly-analyzed project.** On IPZZ-125 (4K, fresh): CHAPTERS=21,
   STANZAS=952 populate, but PHRASES = "—" and every "Chapters at a glance"
   card shows "—" on the phrases line. Verified on disk: IPZZ forge dir has
   audio/beats/chapters/spectrogram .json but **no `phrases.json`**; VictoriaOaks
   (where the Phrases tab WAS opened) has `phrases.json` and its KPI populated.
   - **Root cause:** phrases ("editing units", derived from funscript actions via
     `analyzePhrases`→`cmd_assess` Step 1+2 drift analysis) are NOT computed in
     the `auto-chapter` analyze pipeline — they're lazy-on-Phrases-tab-mount.
     AnalysisTab.jsx:177 calls `analyzePhrases(project.path)` but no assess
     process was running (it either didn't fire — gated while `analyzing` — or
     errored to the silent `console.warn` at :180). The read path
     (`loadPhrasesSidecar`, :275/:374) finds nothing because no prior run wrote
     the sidecar. IPZZ HAS a funscript (927 KB) so the data IS computable.
   - **Impact:** a prominent KPI + per-chapter cards render blank right after
     analyze → reads as broken to a first-run user.
   - **Fix:** this is the parked "bundle phrase analysis into the analyze
     pipeline" item — run phrase detection as a stage of `auto-chapter` (it's
     sub-second-to-seconds, funscript-only) so `phrases.json` is written during
     analyze and the KPI populates without visiting the Phrases tab. Confirm:
     does opening the Phrases tab on IPZZ back-fill the Analysis KPI? If yes, the
     compute path works and only the bundling/trigger timing is the gap.
   - **CONFIRMED:** opening the Phrases tab on IPZZ ran the compute (footer:
     Detecting phases → cycles → patterns → phrases → BPM transitions →
     Classifying behaviors) and wrote `IPZZ-...phrases.json` (677 slices) — and
     it was QUICK. So the compute path is fine; the fix is just to run it as an
     auto-chapter stage (it's fast, funscript-only). **KPI back-fill CONFIRMED:**
     after the compute, the Analysis tab PHRASES KPI shows 677 and the
     per-chapter cards fill in their phrase counts (Ch1 20 / Ch2 38 / Ch3 34) on
     tab re-mount. So back-fill works; this is purely a "not in the pipeline"
     gap, NOT a refresh bug.
   - **Sub-note (Checkpoint 7 regression on this path):** the phrase-compute
     busy-footer headline is a bare "Analyzing…" — it does NOT name the
     project/what's being analyzed (the auto-chapter footer DID:
     "Analyzing <project>…"). The inner stages ARE named; just the headline is
     generic. Give it the same "Analyzing phrases — <project>" headline.

D2. **Phrases tab doesn't auto-refresh when analyze completes.** During the
   VictoriaOaks run the Phrases tab showed incomplete data mid-analyze; the
   sidecar on disk was in fact complete (704 phrases across all 17 chapters,
   no empty chapters). Reopening the tab after completion showed everything.
   Proximate cause here was tangled with D1 (the UI "done" callback belonged to
   the orphaned process), but the underlying UX gap stands: a tab that mounted
   before analyze finished should refetch its sidecar on the completion signal
   rather than stay stale. Confirm on a clean single-process run whether this is
   purely a D1 side-effect or a separate missing-refresh bug.



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

### ✅ NOT A BUG — "black box" on JAV is source-baked censoring (2026-06-09)

User saw a large solid black box over explicit content in the player and asked
whether it was a 4K→720p downscale artifact. **Diagnosed: it is in the source
master, not our pipeline.** On `IPZZ-125.molester.omfg_iris3.mp4` (an Ideapocket
/ IPPA release — studio watermark visible in the frame):

- Source is true 4K (3840×2160, h264, ~9.1 Mbps); our chapter clips are 1280×720.
- Pulled the same frame (t≈5550s) from the **4K source** and the **720p clip**:
  the black box is **already present in the 4K source frame**, before any
  downscale. A full-res crop of the box region is **pure solid black** (PNG
  compressed to ~3.7 KB — zero texture), i.e. a hard censor box, **not** a fine
  mosaic that downscaling flattened.
- This title censors with a **solid black box**, not the pixelated mosaic the user
  expected. Our pipeline faithfully passes the source through. **No fix needed.**
  (Diagnostic frames were explicit; extracted, inspected, then deleted — not kept
  in the tree.)
