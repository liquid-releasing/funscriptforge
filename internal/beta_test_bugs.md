# Beta test bugs — dogfood log

Running list of bugs/edge-cases found in live user testing. Newest session
at top. Status: 🔴 open · 🟡 fixed-uncommitted (live in dev build, needs
verify + commit) · ✅ committed.

---

## Session 2026-08-09 (D22 verification dogfood — Madmartigan vol2/vol6)

Found while confirming the D22 audio-cache fix (which passed — see D22 above).
None of these are caused by that change.

### 🔴 Open

D32. **★ 2.5K sources (>1920 wide) take the full clip-transcode path, and it
   reads as a hang.** Repro: open `-Madmartigan- - It's Just AI Sex (vol2)`
   (2560×1440) or `(vol6)` (2520×1440) → analysis reaches `chapter_clips` →
   the app appears frozen for minutes. **NOT a hang** — verified live via the
   process tree: `funscriptforge → cli.py auto-chapter --resume → ffmpeg`, with
   ffmpeg mid-transcode (`-ss 553.123 -to 974.634 … -vf scale=1280:720`), i.e.
   a 7-MINUTE chapter being re-encoded to 720p. Real work, no feedback.
   - **Root cause = the direct-play width gate, not detection.** `_verdict_direct_playable`
     requires ≤1920w; at 1440p these sources are disqualified, so EVERY chapter
     gets a full 720p re-encode. Working as designed — but the design was aimed
     at RAW 4K (heavy decode / WebView2 OOM), and 2.5K is a much lighter decode
     than the 4K case the gate was written for.
   - **⚠️ MISDIAGNOSIS WORTH RECORDING:** first read was "chapter over-merge."
     WRONG — measured chapter lengths are ON TARGET (`target_minutes=5.5`):
     vol6 11.6min → 2 chapters (6.1, 5.5); vol2 16.2min → 3 (4.6, 4.6, 7.0).
     Detection is correct here; "fix the over-merge" would have changed a
     healthy algorithm and left the hang in place. (The separate LongandCut
     single-616s-chapter over-merge in [[project_funscriptforge_pending]] is a
     REAL but DIFFERENT bug — don't conflate them.)
   - **Fix directions:** (a) raise the direct-play width gate (is 1440p really
     too heavy to stream? measure before assuming), or (b) the already-planned
     **single whole-file 720p proxy** — transcode once, stream + seek per
     chapter, instead of N per-chapter clips. (b) is the logged follow-up for
     4K and would cover this case too. Either way, (c) **clip extraction needs
     progress in the footer** — minutes of silent ffmpeg is the actual
     user-facing defect.
   - **✅ (c) FIXED 2026-08-09.** `chapter_clips._run_ffmpeg_clip` runs the
     encode with `-progress <file> -nostats` and a 0.5s poller thread that
     turns ffmpeg's `out_time_us` into a 0–1 fraction (whole-percent throttled);
     `structural._extract_chapter_clips` renders it as
     `Extracting chapter clip 2/3 (7.0 min) — 44%`. The clip's LENGTH is now in
     the label too, which is the honest explanation for the wait. Verified on
     the real 2.5K source: 14 monotonic updates reaching 91%. Progress is
     strictly best-effort — no callback, a zero duration, or a callback that
     raises all leave the encode untouched (7 tests).
     ⚠️ **Known residual:** the first ~20s of a COLD encode are still silent —
     that window is source I/O (re-running the same slice warm took 6.5s total
     vs 26.7s cold), not the encoder. The pre-encode label covers it, but a
     "seeking…" state would cover it better.
   - **✅ (a) FIXED + LIVE-CONFIRMED 2026-08-09.** `DIRECT_PLAY_MAX_WIDTH`
     1920 → **2560** (a NAMED constant now, replacing a bare literal, in BOTH
     `cli.py::_verdict_direct_playable` and
     `videoflow chapter_clips.is_direct_playable`). 1440p / 2.5K sources now
     stream raw and **skip clip extraction entirely** — backend confirmed
     `progress: done::2::chapter_clips::skipped (direct-play)` on vol6, and the
     user confirmed live: "able to continue edit vol6 · viewer seems to play as
     expected on various tabs · overall editing is very smooth."
     Verified both implementations agree on real files (2520 ✓, 2560 ✓,
     3840 ✗ width, 5568 ✗ hevc+width). 14 tests pin each disqualifier
     independently incl. the inclusive 2560 boundary and 2561 falling through.
     **This — not the D35 preset — is the fix for the minutes-long waits.**
     ⚠️ To revert: set `DIRECT_PLAY_MAX_WIDTH` back to 1920 in BOTH files.
     NOTE it is independent of `DOWNSCALE_WIDTH_THRESHOLD` (still 1920), which
     decides how a clip is encoded once we've decided to make one; everything
     still clipping is >2560 so it all downscales as before.
   - **(b) single whole-file proxy still OPEN** — now only needed for true 4K+.

D33. **Channels per-chapter preview costs ~22s on a real chapter.** Measured
   directly: `cli.py stim-process <fs> --character Reactive --mode 3phase
   --start-ms 0 --end-ms 365970` → rc=0, all 9 channels (alpha/beta 3630,
   prostate trio 9134/9134/3640), **22 seconds**. Generation is CORRECT, just
   slow, and the user saw no preview at all.
   - **The design assumption is stale.** The per-chapter draw was benchmarked at
     ~0.7s on a **30s** window ([[project_channels_character_merge]]), and that
     is what justified drawing all 9 channels live per chapter. But at
     `target_minutes=5.5` a real chapter is 5–7 min = ~10× that window, so the
     cost is ~20s+, with only an inline "generating…" and no progress.
   - **Why no preview appeared is still UNCONFIRMED.** Backend succeeds, so the
     failure is UI-side across a 22s round trip. Leading hypothesis: the draw
     effect is debounced + cancel-safe, so a re-render during those 22s
     supersedes the in-flight request and nothing lands (the session was also
     under 7.2GB WebView2 pressure = plenty of re-renders). **Confirm on a
     clean renderer before fixing.**
   - Note `<stem>.characters.json` was ABSENT for vol6 — consistent with the
     draw never completing / never being written through.

D35. **★ Chapter clips are ~3–5× larger than the design intended — `-preset
   ultrafast` costs 2.5× the size and buys almost no speed.** Found while
   fixing D32. MEASURED on the vol2 2560×1440 source, same 60s slice, same
   720p downscale args, only preset/CRF varied:

   | variant | time | size | bitrate | projected 7-min chapter |
   |---|---|---|---|---|
   | `ultrafast`/20 **(current)** | 6.5s | 119.9 MB | 16.0 Mbps | **839 MB** |
   | `superfast`/20 | 6.8s | 84.8 MB | 11.3 Mbps | 593 MB |
   | `veryfast`/20 | 7.8s | 73.2 MB | 9.8 Mbps | 512 MB |
   | `veryfast`/23 | 7.8s | 49.8 MB | 6.6 Mbps | 348 MB |
   | `faster`/23 | 9.1s | 48.1 MB | 6.4 Mbps | 337 MB |

   - **`ultrafast` is nearly free to leave.** It saves ~1.3s over `veryfast`
     on a 60s slice while producing 2.4× the bytes — the encode is dominated by
     source I/O and scaling, not by x264's tools. 16 Mbps for 720p is ~4× a
     normal 720p rate.
   - **Consequence:** the [[feedback_chapter_clip_blob_cap]] ~150 MB threshold
     is blown by every chapter on these sources (the design note in
     [[project_funscriptforge_pending]] expected "~100 MB" clips). Clips over
     the cap skip `createObjectURL` and fall back, so this degrades rather than
     crashes — but it also means large temp writes on a disk that is currently
     98% full.
   - **⚠️ NOT a free change:** encode args are pinned in BOTH
     `videoflow/chapter_clips.py` (`FFMPEG_CLIP_ARGS*`) AND the Rust mirror
     `commands.rs::extract_chapter_clip`, and changing them requires bumping
     `CACHE_VERSION` in both so stale clips age out. See
     [[feedback_rust_mirror_drift]]. Not applied — needs the paired change.
   - Even `faster`/23 projects 337 MB for a 7-min chapter, so preset alone
     does not reach the cap; pairing it with the D32 single-file 720p proxy
     (or a lower CRF target) is the real answer.

D34. **`load_funscript` returns `None` on ANY failure and callers don't check.**
   `forge/funscript.py:11-15` swallows every exception → `None`; `cli.py:3321`
   (`cmd_stim_process`) does `parse_actions(load_funscript(args.input))` →
   `AttributeError: 'NoneType' object has no attribute 'get'`. A missing or
   unreadable funscript reports a Python attribute error instead of naming the
   file it could not read. Violates [[feedback_user_actionable_errors]]. Found
   by accident (passing a Git-Bash-style path to a Windows Python), but the
   failure mode is real for any missing/corrupt input. Audit other
   `load_funscript` callers for the same unguarded pattern.

### ✅ Confirmed working this session

- **D7 process reaping — LIVE-VERIFIED AGAIN under the hardest case.** Closed
  the window DURING chapter-clip extraction (ffmpeg actively holding the 2.5K
  source): `funscriptforge`, both `python` workers and `ffmpeg` all reaped to
  zero, source immediately free. Gate #2 holds.
- **D22 `--resume` reaching the backend**, confirmed in the live process
  command line: `cli.py auto-chapter … --format json --resume`.
- **Audio cache self-bounds.** Peaked at 473MB / 3 slots, and `sweep_audio_temp`
  had reclaimed it to 41MB / 2 slots unprompted. A size cap was considered and
  is NOT needed — the existing 1-hour sweep is sufficient.

### 🟡 Environment / known-issue data points

- **WebView2 renderer hit 7,195 MB** (1,280s CPU) after a normal working
  session — same signature as the VictoriaOaks freeze. It did not freeze, but
  it degraded real work (this is what made D33 feel like a hang). Live evidence
  for **pre-beta gate #3**, which currently reads "may be deferrable if it's not
  freezing in practice." It isn't freezing; it IS degrading. Cleared by restart.
- **`C:` is 98% full** (52 GB free of 1.9 TB). Not a cause today, but Windows
  stalls on large writes at that fill level and chapter clips are exactly that.

---

## Session 2026-07-02 (Accept/Undo polish + Short Beats dogfood)

### ✅ Investigated — SAFE

D31. **Loud transient safety — alarm-clock sound at 5:56–6:01 in
   `forgeassembler/test_media/victoriaoaks/fixed/15.mp4`. CHECKED 2026-07-02:
   NOT unsafe.** Inspected the generated `15.funscript` window (356000–361000ms)
   vs the whole file:
   - **Beat-grid quantization is the safety net.** The whole script sits on a
     FIXED 232ms grid (global min == p1 == median inter-point gap == 232ms). At
     most one reversal per 232ms — a transient physically can't insert extra
     strokes between beats, so it can't machine-gun. This bounds stroke rate by
     construction, independent of audio spikes.
   - **In-envelope velocity.** Window max = 405 u/s = the SAME ceiling hit
     throughout the file (whole-file max also 405 = amplitude94 ÷ 232ms). The
     file's genuinely fastest strokes are at 6:13–6:21, not the alarm.
   - **No micro-oscillation.** Clean 232ms spacing (18→79→21→81…), steady rhythm.
   - **The audio there is actually QUIETER than the song** (window peak median
     0.497 vs global 0.605; max 0.853 vs ~1.0 elsewhere; 0% near-clip). The alarm
     beep is a narrow-band tone — perceptually salient, low broadband energy.
   **Remaining (fidelity, NOT safety):** the generator DID map the alarm's
   beeping rhythm to strokes (the 232ms 18↔80 oscillation in-window). "Do you
   want the alarm stroked?" is an Events/edit correction, not a safety fix.
   **Latent hardening idea (not needed for this file):** there is no EXPLICIT
   per-step velocity clamp in `videoflow/generate.py` — safety is emergent from
   the beat grid. If a future source ever has a very fast detected BPM, an
   explicit max-velocity / min-interval floor (tie to [[project_tame_tone]])
   would be belt-and-suspenders. Log-only for now.

---

## Session 2026-06-27 (Generate → Analysis dogfood, ddt483)

### 🔴 Open

D22. **✅ FIXED 2026-08-08 (option (c) + the flag flip) — needs a live dogfood
   confirm.** Shipped the shared extraction cache the investigation below called
   for: new `videoflow/audio_cache.py` keys an extracted WAV on source
   path+mtime+size+sample-rate and publishes it atomically (`os.replace`) into
   the existing `forge-audio` temp dir, so BOTH `structural._prepare_audio`
   (analysis) and `audio.analyze_beats`' extractor (generation) reuse one
   decode. Lifetime is delegated to the existing `sweep_audio_temp` orphan
   sweep — no `.forge/` bloat, no new cleanup policy. `damaged_after_ms` is
   persisted beside the WAV so a cache HIT still raises the damaged-source
   banner. Both callers now get `tmp=None` for a cache-owned WAV so their
   cleanup `finally` can't delete it. Paired with the UI half:
   `AnalysisTab.jsx` auto-trigger passes `resume: !versionStale` — a stale
   ANALYZER VERSION still forces a full pass (that stamp exists to rerun the
   algorithm); Re-analyze stays full (it wipes `.forge/` first anyway).
   Chose (c) over (a)/(b) because it changes NO detection semantics — (b) would
   have swapped generation's `chunk_secs=180` beat pass for analysis's
   chapter-windowed one, which are different computations. 20 new tests
   (`videoflow/tests/test_audio_cache.py`) incl. the regression proper: patch
   ffmpeg, run both stages, assert ONE invocation. No new failures either repo
   (verified against a stashed baseline).
   **✅ LIVE-CONFIRMED 2026-08-09 dogfood** (no Rust changed, so no recompile —
   videoflow is editable-installed and AnalysisTab hot-reloads): Generate→
   Analysis now shows "Reusing extracted audio (cached)…" instead of a second
   "Extracting audio…", chapters unchanged; a cold never-analyzed project still
   extracts exactly once.
   **⚠️ The damaged-source path could NOT be live-verified — no corrupt source
   remains on disk.** ddt483 was the D22 *session's* file but its defect was a
   truncated VIDEO (repaired + swapped 2026-07-02), not damaged audio; the
   damaged-audio case was Astrid, and BOTH
   `E:\wowgirls\Astrid_FreyaMayer_NancyA_NewSensations_{3840x2160,5568x3132}_60fps.mp4`
   now decode their full audio clean (rc=0, mono downmix — re-downloaded since
   June), with no `.forge` dir left to hold the old `damaged_after_ms`. Covered
   instead by unit tests + a code trace: `audio.py` assigns `_damaged_after_ms`
   from the cache hit (:448) or from ffmpeg (:471) and BOTH converge on the
   single stamp at :611, so the cached value cannot diverge from the fresh one.
   If a corrupt source ever reappears, run Generate→Analysis and confirm the
   amber "audio is damaged after MM:SS" banner still shows on the cached pass.

   _(original report:)_ **★ Analysis RE-EXTRACTS audio that generation just
   extracted (the D9
   "separate over-eager-reanalyze trigger" — now confirmed).** Repro: build a
   funscript from a video on the Generate tab → land on Analysis → it runs the
   full pipeline and re-extracts audio ("Extracting audio… 40:38 done") even
   though generation already did the audio/beat work on the same source. **Root
   cause:** the Analysis auto-trigger calls
   `analyzeChaptersWithVideoflow(project.path, 5.5, project.mediaPath, resume=false)`
   (`AnalysisTab.jsx:170`). `resume=false` = a FULL pass — videoflow recomputes
   every stage incl. audio extraction. Only the (now-removed-by-D5b) Partial-
   banner Resume CTA ever passed `resume=true`; the auto-trigger and Re-analyze
   always force a full recompute. So generation's reusable, video-derived
   sidecars (audio/beats/spectrogram) are thrown away and recomputed. **Fix
   direction:** the AUTO trigger should pass `resume=true` (videoflow's Tier-1/2
   freshness check skips stages whose sidecar already exists, computing only the
   missing chapter detection/clips). An explicit user "Re-analyze" stays a full
   pass. Exactly the D9 design note: video-derived stages are reusable; only
   phrases/stanzas/assessment (funscript-derived) need recompute.
   **★ INVESTIGATED 2026-06-27 — the one-line flag flip is NOT enough.**
   Generation (`cli.py::cmd_generate` → `_load_or_analyze_beatmap`) extracts
   audio + detects beats but persists them ONLY as `<stem>.beatmap.json` (the
   FULL AudioBeatMap: beats + energy + stanzas, keyed by tracker/source/
   chunk_secs provenance — `_beatmap_sidecar_path`). `auto_chapter --resume`
   does NOT read `beatmap.json`; its freshness check looks for its OWN sidecars
   (`audio_peaks` / `spectrogram` / `audio_beats` reduced + `chapters`). The two
   artifact sets don't overlap, so even with `resume=true` auto_chapter
   re-extracts audio + re-detects beats. **Real fix (videoflow/Python, not a UI
   one-liner) — make the two share the cache.** Options: (a) generation also
   emits the auto_chapter audio sidecars (audio_peaks/spectrogram + reduced
   audio_beats) from the same extraction it already runs, so resume skips them;
   (b) `auto_chapter --resume` recognizes a fresh `beatmap.json` and derives its
   reduced beats sidecar from it instead of re-detecting; (c) persist the
   extracted-audio artifact once and have both stages reuse it (kills the
   duplicate ffmpeg extract regardless of detection). (a) or (c) is the
   substrate the D9 note ("video-derived stages are reusable") implies. Pair the
   `resume=true` auto-trigger flip WITH one of these — the flag alone is
   necessary but not sufficient. NOT applied (user mid-build; also Rust/Python →
   would force a tauri:dev recompile + relaunch).

D23. **"No media attached" on Analysis + Accept-and-chain right after generating
   from a video.** Screenshot: "Reviewing ddt483.HD_3_apo8_nyx3 · No media
   attached — attach a video or audio file on the Project tab." `hasMedia =
   !!project?.mediaPath` (`AnalysisTab.jsx:140`). Generation REQUIRES
   `project.mediaPath` to run the real engine (`GenerateTab.jsx:304-306`), so it
   was set at gen time; the adopt→reopen path passes `mediaPath` through
   (`App.jsx:545`, `699-702`) and `handleProjectOpened` preserves it as-is
   (`App.jsx:449`). On paper `mediaPath` should survive the adopt — **could not
   pin the loss by reading alone.** Needs a live repro to capture the actual
   project record at the moment Analysis renders (one-line debug log of
   `openedProject.mediaPath` after adopt) to see whether (a) the promoted sibling
   funscript reopened without mediaPath, or (b) the user reached Analysis via a
   path that never set it. Likely same family as D22 (both are "the new funscript
   isn't linked back to its source video"). NOT root-caused.

D24. **Harmless: `[TAURI] Couldn't find callback id …` console spam.** Async
   callbacks resolving after an HMR/webview reload (forgemoment rebuild + reloads
   this session), not a real bug — same class as the D1 reload-orphan note.

D25. **★ Analysis KPI/Structure don't progressively reveal — they wait on the
   slow `chapter_clips` tail even though chapters + phrases are already on disk.**
   Repro (screenshot, ddt483, 167 min / 27 chapters): the progress footer shows
   the whole structure pipeline DONE — `detect — 27 chapters detected`,
   `chapters_sidecar — 27 chapters on disk`, `beats — 18869 beats / 1193
   stanzas`, `classify — 1193 stanzas classified`, `audio_peaks`, `spectrogram`,
   `audio_beats`, `sidecar — merged: 27 chapters, 1193 stanzas` — and is now only
   on `chapter_clips` ("Extracting chapter clip 1/27…", the minutes-long tail).
   Yet the KPI strip still reads **CHAPTERS 0** + "Chapters at a glance: No
   chapters", **PHRASES —**, while **STANZAS 1193** DID populate. So phrases were
   built + the merged sidecar (27 ch) is on disk, but neither the chapter list
   nor the phrases KPI surface until clip extraction finishes. **Root cause:**
   `triggerAnalysis` lifts the chapter list via `onChaptersChange(newChapters)`
   only AFTER `await analyzeChaptersWithVideoflow(...)` resolves
   (`AnalysisTab.jsx:170-175`), and that await is gated on the FULL pipeline incl.
   `chapter_clips`. The `chapters_sidecar` progress event lands early (footer
   proves it) but the progress-event handler refreshes audio sidecars, NOT the
   chapter list or the phrases/phrase-KPI. Phrase analysis was de-coupled to fire
   on `chapters_sidecar` (the :186-191 comment) and clearly ran (phrases on disk),
   but the Analysis PHRASES KPI cell isn't re-read from the new `phrases.json`
   mid-pipeline. **Asymmetry to exploit:** STANZAS surfaced but CHAPTERS didn't —
   pin which path lifts stanzas (works) vs chapters (post-await only) and mirror
   it. **Fix direction:** on the `chapters_sidecar` / merged-`sidecar` progress
   events, lift the chapter list to App + refresh the phrases/stanzas KPI from
   disk — `chapter_clips` only produces video clips for in-app playback, NOT the
   structure/phrase data, so the KPI + "Chapters at a glance" should fill in as
   soon as the merged sidecar lands (seconds/minutes in), not after all 27 clips
   extract. Same progressive-reveal theme as D2/D3/D14. UI fix
   (`AnalysisTab.jsx`, maybe `App.jsx`) — staged, NOT applied (user mid-build).
   **★ D25 IS THE SPINE — it cascades into D26 + the gates (see below).**

D26. **No "Accept and next chapter" button in the Chapters footer.** User on
   Chapters sees no Accept button at all. **Root cause = D25 cascade, two
   compounding gates:** (1) ChaptersTab registers the footer nav ONLY when
   `chapters.length > 0` (`ChaptersTab.jsx:949`); while D25 holds the chapter list
   out of App memory (`chapterArr` empty until clips finish), ChaptersTab has 0
   chapters → registers `null` → no button. (2) Even once registered, the footer
   secondary is gated on `!busy && !gateMsg` (`App.jsx:1057`), and `analysisUnready
   = !chapterArr?.length` (`App.jsx:922-923`) makes every consuming tab show the
   "Analyzing… finish on the Analysis tab" gate (`App.jsx:960-963`) for the same
   reason — empty `chapterArr`. So fixing D25 (lift the chapter list on the
   merged-`sidecar` event, not after clips) restores the Accept button AND clears
   the false "finish analyzing" gate in one move. Secondary hardening (D12 class):
   don't let a transient `busy` fully HIDE the Accept button — disable+grey it
   instead of removing it, so it never silently vanishes. UI fix — NOT applied.

D27. **Phrase assess re-runs redundantly + opaque "Analyzing…" footer with no
   "why" / no progress, on a long file ("I thought we fixed this").** Two parts.
   **✅ (a) FIXED 2026-06-28 (backend fast-path):** `cmd_assess` (json_mode)
   now short-circuits to a FRESH `<stem>.phrases.json` via
   `_fresh_phrases_payload` — reuses the cached slices when the sidecar is
   newer than the funscript AND the chapters sidecar (schema-version gated),
   so re-entering Phrases is a quick JSON read instead of the full pipeline.
   A tone edit (funscript rewrite) or chapter re-detect makes the sidecar
   stale → correct reassess. Live in `tauri:dev` (source cli.py, no recompile);
   bundled forge-cli needs a PyInstaller rebuild for the shipped build. Regression
   test `tests/test_assess_freshness.py` (5 cases). (b) below still stands.
   (a) **Redundant recompute:** analyze already computed `phrases.json` on disk
   (the de-coupled fire on `chapters_sidecar`), but PhrasesTab's cache gate is
   `phrasesByPath[project.path]?.loaded` (`PhrasesTab.jsx:308`) — an IN-MEMORY
   App cache the backend compute never populated. So opening Phrases sees no cache
   hit and re-runs `analyzePhrases` (full `cmd_assess`) even though a fresh sidecar
   exists; `cmd_assess` itself also doesn't short-circuit on a fresh `phrases.json`.
   Fix: PhrasesTab should treat a fresh on-disk `phrases.json` as a cache hit
   (load it) rather than re-assessing; or `cmd_assess` skips when the sidecar is
   newer than the funscript. (b) **Legit-but-painful invalidation:** changing +
   Accept-and-chaining a tone runs `commitAll` → `mergeWorkingActions` →
   `onActionsPatch` (the funscript actually changes) → phrase cache invalidated →
   assess re-runs. On a 167-min file that's the D16 ~12-min assess. So the
   recompute is *correct* (funscript changed), but slow + the footer headline is a
   bare **"Analyzing…"** with no project name and no plain-language "why" — the D3
   sub-note flagged as fixed that evidently never landed (PhrasesTab sets
   "Assessing phrases…" at `:312`, so the bare "Analyzing…" came from a DIFFERENT
   path — pin it: candidates = ChaptersTab `recomputePhrasesAfterChapterChange`
   (:828) or the busy-banner default). Fixes: (1) name the headline ("Assessing
   phrases — <project>…") on EVERY assess trigger; (2) make the recompute a
   cache-hit when the sidecar is fresh (part a); (3) the D16 assess-speed item
   stands. UI + possibly Python (`cmd_assess` freshness) — NOT applied.

D28. **Editor ↔ viewer desync after applying a tone: player shows the toned
   funscript, the Chapters editor reverts to the pre-tone shape on return.**
   Repro (ddt483): apply Climax to a chapter (bars move to top/bottom — the
   "After · Climax · impact 50%" preview looks right), navigate away, come back →
   the **viewer/player** shows the correct (toned) funscript but the **editor
   chart** shows the OLD pre-Climax shape. **Likely root cause:** the player reads
   the patched in-memory `project.actions` (updated via `onActionsPatch` when the
   tone is applied/accepted), but the Chapters editor re-derives its baseline from
   `originalActions` (the pristine original funscript), which never received the
   applied tone — so on remount the editor reseeds from stale memory while the
   viewer keeps the patched copy. Same family as D15 (in-memory `chapterList` /
   `originalActions` not updated after Accept — the sidecar gets written but the
   in-memory baseline doesn't). Fix: after a tone is committed, update the
   in-memory baseline (`originalActions`/`chapterList`) the editor reseeds from,
   so editor + viewer read the same actions. UI fix — NOT applied.

D29. **★ SHIP-BLOCKER — chapter-clip extraction can silently produce AUDIO-ONLY
   clips that poison the cache (no video, sound only).** Repro (ddt483, 4K HEVC
   2h47m): ch22–ch27 (the last 6 chapters) play audio but show NO video. ffprobe:
   those 6 clip files exist but have `video=[]` (no video stream); ch1–21 are
   fine. The 38 GB source HAS full video at those timestamps (verified: hevc
   3840×2160, 27 frames/2s at ch23/25/27) — so it's an EXTRACTION defect, not a
   source problem. **Root cause:** `extract_chapter_clip`
   (`videoflow/chapter_clips.py:370-395`) uses INPUT-side fast seek (`-ss`/`-to`
   BEFORE `-i`) and validates success by `returncode == 0` ONLY. On a long-GOP 4K
   HEVC source, a deep input seek can land where ffmpeg passes the window's audio
   through but decodes ZERO video frames (no usable keyframe in range / scale
   filter gets no frames) and STILL exits 0. The audio-only tmp passes the
   returncode check → atomic-published → cached. `--resume` then sees the file
   present and skips it forever → the broken clip is permanent. Correlates exactly
   with seek depth (only the deepest 6 fail). **Fix (do BOTH):** (1) after encode,
   **ffprobe the tmp for a video stream before publishing** — if the source had
   video but the clip has none, treat as FAILURE (unlink tmp + raise) so it's
   re-extracted, never cached; (2) make the deep seek robust — use accurate/
   output-side seek (move `-ss` after `-i`, or `-ss` before + `-t <dur>` after +
   `-noaccurate_seek` off) so video actually decodes from a real keyframe at deep
   offsets. **Mirror the same validation in the Rust `extract_chapter_clip`
   command** (commands.rs) — both paths write the same cache. Add a regression
   test: extract a deep slice of a long HEVC fixture → assert the clip has a video
   stream. Until fixed, a 4K-HEVC user gets silently video-less reference clips on
   the chapter tail. (User on ddt483 deferred re-extraction — doesn't need the
   video now — but flagged: do NOT ship this.)

D30. **Oversized chapter clips (181–452 MB) → cumulative WebView2 video-memory
   pressure; later chapters fail to render.** ch21 (199 MB, valid h264 720p)
   showed no video even though the clip is fine — after a session of loading
   ch1–20 (each 280–452 MB), WebView2 runs out of video-decode memory and can't
   paint new clips (the bug-#6 / D6 wedge, now reproduced via clip size). Root:
   the v12 downscale caps RESOLUTION (720p) but not DURATION — a long chapter
   (5–7 min) at 720p is still 300–450 MB, and several held at once exhaust the
   webview. Fix directions: cap clip BITRATE/size (lower CRF won't help much;
   consider a hard size target or segmenting very long chapters), and/or release
   the previous chapter's `<video>` buffer on chapter switch so memory doesn't
   accumulate. Pairs with the standing large-file WebView2 pressure items.

### ✅ Fix LANDED this session (D25/D26 chapter-keying) + on-disk verification

- **Threaded the known `mediaPath` into `load_project`** so chapter resolution
  uses the real media instead of strict same-stem guessing: Rust
  `load_project(path, media_hint)` + `media_kind_from_path` helper
  (`commands.rs`); `loadProject(path, mediaPath)` → `{ mediaHint }` (`forge.js`);
  callers pass it (`App.jsx` handleOpenScript + handleSelectProject,
  `AnalysisTab.jsx` chapter-lift, `GenerateTab.jsx` restore). cargo check + vite
  build green. ⚠️ Built + running but the user's same-stem case (funscript stem
  == media stem) means strict `find_adjacent_media` already paired the media, so
  the hint is belt-and-suspenders here — NOT yet proven to be the fix for the
  re-analyze trigger.
- **On-disk verification (ddt483, `D:\funscriptforge_complete\wip\ddt483\`):** all
  data is INTACT and valid. `cli.py chapters <media>` resolves **27 chapters in
  seconds** by reading the existing sidecar (no re-analysis). `chapters.json`
  `analyzer_version='1'` == current `ANALYZER_VERSION='1'` → NOT version-stale, so
  the re-analyze trigger is case (a) `chapterList` empty in-app, NOT case (b)
  staleness. phrases/beats/audio/spectrogram/beatmap + clips all present; the
  sibling `.funscript` exists (adopt completed).
- **The "long load / hang" on reopen was the WebView2 memory wedge (bug #6), NOT
  re-analysis:** host + WebView2 both 0% CPU, but WebView2 held **7.8 GB across 41
  procs** (big 4K project + many chapter clips + a session's worth of reloads).
  Only a full app restart reclaims it (page reload doesn't). Restarted clean.
  **★ Open perf question:** why does in-app `load_project` return empty chapters
  (triggering re-analyze) when the CLI returns 27 from the same sidecar? Next
  live test: open ddt483 via Library → Resume on the fresh build; if it still
  re-analyzes, add a one-line log of the project's `mediaPath` + resolved chapter
  count at open to pin whether the open carries the media link.

---

## Session 2026-06-18 (beta dogfood — Prisoner, post-recompile)

### 🔴 Open — found in the 4K/Generate dogfood (2026-06-18, hovixag935 4k60 + others)

D12. **First "Generate new funscript" tap on Project is unresponsive; works on
   the 2nd tap.** The Project footer primary "Generate new funscript" just does
   `setTab('generate')` (App.jsx:1010-1011), but that whole footer block is gated
   on `!busy` (App.jsx:1009). On first landing on Project a transient `busy`
   (project load / a background pass) reverts the primary to the generic "Accept
   and chain to Generate" (and/or disables it), so the first tap no-ops; once
   busy clears it works. Fix: don't let a transient load-busy swallow the first
   tap — either keep the Generate-new handler wired during load, or disable +
   visibly grey the button while busy (don't silently no-op).

D13. **No busy band in the footer while generating** (noticeable on longer
   files — long enough to want the band). BUT the plumbing IS wired:
   `GenerateTab` calls `onBusy({message:'Generating from the beats…', steps:[]})`
   on start and `onBusy(null)` on finish (GenerateTab.jsx:348/383), and App
   passes `onBusy={setBusy}` (App.jsx:1195). So the band *should* show — needs a
   live repro to see why it isn't visible: candidates = the debounced generate
   effect (setTimeout, GenerateTab:341) setting/clearing busy in a way the footer
   band doesn't surface, or the band being suppressed on the Generate tab.
   **Positive:** generation itself works well — 2nd pass found the funscript +
   remembered Range/Pace and scored **95**.

D14. **Phrases not built during analyze; appeared ~a minute later (lazy).** On a
   fresh analyze the Phrases data wasn't there immediately — the analyze "did not
   start it up," then it showed up later (lazy-on-Phrases-tab-mount). This is the
   parked **D3** class ("bundle phrase analysis into the analyze pipeline"), but
   note hovixag935's analyze DID write `phrases.json` in-pipeline — so confirm
   whether this was a different file or a timing/refresh gap (D2-class).

D15. **★ CONFIRMED DATA LOSS — chapter TONES not remembered across a tab
   switch.** Repro: set tones on chapters → go to Phrases → come back to Chapters
   → ALL chapters show "Untoned" again. **Diagnosed:** `tonesByChapter` is
   component-local `useState` (ChaptersTab.jsx:349) seeded by `seedTones(chapters)`,
   which reads `project.chapterList[].tone`. Picking a tone only mutates that
   local state; it's persisted to the chapters sidecar ONLY by the per-chapter
   Accept (`handleAcceptTone`→`writeChaptersSidecar`). So leaving the Chapters tab
   unmounts it → state lost → remount reseeds from chapterList (no unaccepted
   tones) → everything reverts to Untoned. Same root as "Accept and chain doesn't
   accept the last chapter changes." **Fix options:** (a) lift `tonesByChapter` +
   `acceptedChapterIds` to App session state keyed by project path (survives tab
   switches; minimal, matches the complaint); (b) auto-persist tones to the
   sidecar / `.characters.json` on every change (survives app restart too,
   debounced) — the more complete fix. Lean (a) now, (b) post-beta. This is a
   beta blocker — silent loss of user work.
   **🟡 FIXED-UNCOMMITTED 2026-06-18 (option a, JS/HMR):** lifted `tonesByChapter`
   + `paramsByChapter` + `acceptedChapterIds` to App session state
   `chapterEditsByPath[path]` (App.jsx) + passed `chapterEdits`/`onChapterEditsChange`
   to ChaptersTab. ChaptersTab SEEDS the three maps from `chapterEdits`
   (initializers + the project-path reseed effect) and MIRRORS them back up via a
   ref-stable effect. Tones now survive a Chapters↔other-tab switch; Accept still
   writes the sidecar for restart. ⚠️ Residual (post-beta, option b): UNaccepted
   tones still don't survive an app RESTART. Verify: set tones → Phrases → back
   to Chapters → tones still there (not Untoned).
   **+ PRIMARY "Accept and chain" now COMMITS (user: "Accept SHOULD accept the
   tones!"):** ChaptersTab registers a `commit` (commitAll) on `chapterNav` that
   applies ALL selected tones via `mergeWorkingActions` + persists the whole tone
   map to the sidecar (no advance); App `handleAccept` awaits `chapterNav.commit()`
   before chaining. So BOTH accept paths now commit: secondary "Accept and next
   chapter" (`handleAcceptTone`, already did) AND primary "Accept and chain to
   <next>" (new). Root of the original loss: `handleAcceptTone` writes the sidecar
   but never updates in-memory `chapterList`, so a remount reseeded from stale
   memory → Untoned — the D15 session-lift fixes that; the primary just never
   committed at all. ('tame' chapters: selection persisted; its backend transform
   still needs the per-chapter Accept.)
   **✅ COMMITTED + LIVE-VERIFIED 2026-06-18 (`f3f8096`):** after a restart the app
   remembered the tones the user had set + accepted. Blocker cleared.

D18. **Chapter mini-card heatmap colors disagree with the editor.** The chapter
   strip card (e.g. ch3) renders mostly BLUE, but the same chapter in the editor
   lane is red/green/red. **Checked:** they SHARE the colormap — `ChapterRibbon.jsx`
   imports `magmaRGB` from `TrackStack.jsx` (the "canonical velocity colormap"),
   so the palette code is the same. The mismatch is therefore in the
   NORMALIZATION (velocity→[0,1] scaling before the colormap): the card and the
   editor must use a different velocity reference (per-chapter max vs visible-
   window max vs a fixed/global scale), so identical strokes map to different
   colors. Fix = make both normalize speed against the same reference. (Still
   "may or may not be a bug" per user; cosmetic but real.) Confirm the exact
   denominators in ChapterRibbon's band waveform vs TrackStack's funscript lane.

D19. **Tone/chapter panel times should be ABSOLUTE (video-relative), continuous
   across chapters — NOT reset to 0 per chapter.** (Clarified by user — the
   opposite of the first read.) Ch1 = 0:00–3:37; moving to ch2, the small tone
   boxes should read 3:37→(its end) measured from the START OF THE VIDEO, not
   chapter-relative (not 0:00→). So wherever a focused-chapter panel currently
   resets its time axis/labels to 0 at the chapter start, it should show the
   absolute video time instead. Bounded UX change. (NOTE: the Chapters LIST cards
   already show absolute 0:00-2:38 / 2:38-6:05 — so the offending panel is a
   specific in-chapter view that re-bases to 0; pin which one on next repro.)
   **✅ FIXED-UNCOMMITTED 2026-06-18:** pinned it — the Chapters tone before/after
   cards (`BeforeAfterCol` → `FunscriptChart`, ChaptersTab.jsx ~1266/1287). They
   re-base the slice actions to 0 for drawing but never passed the chart's existing
   `axisOffsetMs` prop, so the time axis read 0:29 instead of 38:44+. Passed
   `axisOffsetMs={active.atMs}` to both charts (the same prop Phrases/Stanzas slice
   previews already use). Verified on next reload: ch9 axis should read ~38:44→43:57.

D20. **Phrase similarity/shape not grouping visually-identical phrases.** In ch1,
   P7/P8/P9/P10/P12/P13 look like the same behavior/shape but aren't recognized
   as similar; "No shapes were selected." Only P15/P16/P17 (ch2) group as the
   same. User asks if applying the Dominant tone interfered — but tones (if
   unaccepted, per D15) don't change the funscript, and Shape detection is
   funscript-shape-based, so this is more likely a **shape_labeler
   detection-quality** gap (not recognizing recurring similar phrases) than a
   tone side-effect. Detection-quality item; needs a look at shape_labeler
   sensitivity on near-identical phrases. **User hypothesis (likely right): the
   un-grouped phrases simply aren't assigned a NAMED shape** (shape_labeler leaves
   them unlabeled / below confidence), so the Shape lens has nothing to group on
   — vs P15-17 which got a shared shape_label. So the gap = labeler COVERAGE
   (too many phrases left unnamed), not a grouping bug. Check shape_labeler's
   label-vs-null rate on this file.

D16. **Phrase/assessment pass is SLOW on long files (~12 min on a 60-min 4K).**
   hovixag935: chapters done 14:04 → assessment done 14:16 = ~12 min of phrase
   drift analysis over the whole funscript. Not a hang — genuinely slow. Perf
   item: the assess/drift pass doesn't scale well to long sources.

D17. **Lost "done" signal → footer stuck on "Analyzing…" (appears hung) after the
   work actually finished.** After the ~12-min assess wrote phrases.json +
   assessment.json (14:16) and the backend process exited, the footer stayed on
   "Analyzing… in progress" indefinitely — no process running, work complete on
   disk. Orphaned-callback class (D1/D2); likely an accidental "Accept and chain"
   fired a second analyze/resume that raced the in-flight assess and one
   completion callback was dropped. Recovery = reload the app (re-reads disk).
   Fix direction: the footer should reconcile against disk / time out a lost
   callback rather than spin forever.

D21. **Events on the LAST chapter read as "not accepted" — Accept did nothing
   visible.** Repro: add a Scene Closer event to ch12 (the last chapter), click
   the footer "Accept chapter" → no feedback; user can't tell the event was
   committed. **Root cause:** the Events footer-nav `run` was `goNextRef.current()`,
   which only advances the scope to the NEXT chapter — on the last chapter there is
   no next, so it was a literal no-op. The event itself WAS saved (Events write
   through to `<stem>.feel.yml` on every add/edit, fire-and-forget), but the button
   gave zero confirmation. **✅ FIXED-UNCOMMITTED 2026-06-18 (EventsTab.jsx):** the
   last-chapter Accept now (a) flush-persists the events list and (b) pulses a
   fixed "✓ Events saved for this chapter" toast; label is now the consistent
   "Accept last chapter changes" (was "Accept chapter"). Non-last chapters still
   advance as before. NOTE: events bake into the e-stim signal at EXPORT, not on
   Accept — Accept on Events = "save + confirm", by design.

### ✅ Fixed this session (videoflow source — LIVE in dev, no rebuild)

D9. **★ Chapters→Phrases nav crashed analyze: `tone: 'none'` rejected by the
   sidecar validator.** Moving Chapters→Phrases triggered an analyze/resume that
   re-extracted audio from the 67-min Prisoner source and then crashed:
   `SidecarError: chapters[11].tone must be one of ['', 'build', 'climax',
   'dominant', 'edge', 'tease', 'tender'], got 'none'`.
   - **Root cause = FF↔videoflow contract mismatch.** `ChaptersTab.jsx` uses
     `'none'` as a UI-only "Untoned" sentinel (explicitly "no Python
     counterpart", line 77-89) and **persists it to `<stem>.chapters.json`** on
     Accept / as the default for untoned chapters (line 74). videoflow's
     `_VALID_TONE_LABELS` only accepts `''` for untoned and **rejects `'none'`**.
     On the next analyze, `write_sidecar`→`read_sidecar` re-reads + validates the
     existing doc → crash. (Prisoner had `'none'` on chapters[11] AND [12].)
   - **Fix:** `videoflow/src/videoflow/sidecar.py::_coerce_legacy_tone()` maps
     `tone: 'none'` → `''` in `_normalise` (both the chapters and stanzas loops).
     Since BOTH `read_sidecar` and `write_sidecar` route through `_normalise`,
     this heals the on-disk doc on read AND stops `'none'` ever being persisted
     again. Mirrors videoflow's existing `content_type` "accepted on write,
     mapped on read" policy. VERIFIED against the real corrupted Prisoner sidecar
     (none→'', no error); adds zero new test failures.
   - **⚠️ FOLLOW-UP (suspected, unconfirmed): this 'none' crash may ALSO be why a
     FULL re-analyze fired on the Chapters→Phrases nav** instead of a cheap
     resume/no-op. Hypothesis: the `--resume` Tier-1 freshness check reads the
     existing sidecar, hit the `SidecarError` on `'none'`, treated the sidecar as
     invalid → fell through to a full re-detect (+ audio re-extract). With
     `'none'` coerced, the freshness read should now succeed → resume should
     short-circuit. **Test on retry: does Chapters→Phrases now finish FAST (clips
     only / no-op), or does it still re-extract 67-min audio?** If it still
     re-extracts, there's a separate over-eager-reanalyze trigger to chase
     (phrases are funscript-derived + cheap; they must NOT trigger auto_chapter).
   - **Design note (user, 2026-06-18):** building a new funscript should NOT
     re-run `auto_chapter` — chapters/beats/spectrogram/audio are video-derived
     and reusable; only phrases/stanzas/assessment (funscript-derived) need a
     cheap recompute. Confirmed `auto_chapter` never reads the funscript.

D11. **★ FIXED (JS, HMR) — false "Partial analysis" banner on a direct-play
   source (the D5c residual).** After D9, Prisoner (960×540) showed
   "Partial analysis — 4 of 5 stages … Missing: chapter clips" with a Resume
   CTA — but Resume correctly did nothing (audio NOT re-extracted, sidecars
   untouched, still 0 clips). **Not a failure: 0 clips is CORRECT.** Prisoner is
   `direct_playable` (small/clean source streams into WebView2 without a
   normalising re-encode), so `structural.py` SKIPS clip extraction entirely
   ("Source streams directly — skipping clip extraction") → 0 clips for all 13
   chapters by design.
   - **Root cause:** `deriveAnalysisState` assumed `expectedClips =
     chapterList.length`, so a multi-chapter direct-play source (0 clips) was
     perpetually 'partial' → false Resume CTA + a no-op auto-resume on every
     Accept. Exactly the D5c "dominant chapter skips its clip" residual, but
     wider (ALL chapters skip on a direct-play source). Hits any clean small
     source (common).
   - **Fix (frontend-only, no rebuild):** thread the cached `direct_playable`
     probe verdict (the same one `useChapterClip` uses — exported
     `probeMediaCached`) into `deriveAnalysisState` as `directPlay`. Clips are
     considered done when `directPlay === true`. **Conservative:** only an
     EXPLICIT true suppresses the clip requirement — unknown (probe
     pending/failed) or false still falls through to the count check, so the
     real "killed during chapter_clips on a 4K source" D5 Resume case is
     preserved. Files: `lib/analysisState.js` (logic), `hooks/useChapterClip.js`
     (export the cached probe), `App.jsx` + `screens/AnalysisTab.jsx` (probe
     verdict state + effect + pass to derive). vite build green.
   - **Verify:** reload the app on Prisoner → the Partial banner clears →
     Analysis reads 'complete'. Confirm a genuinely-interrupted 4K analyze
     (clips short, NOT direct-play) STILL shows Resume.

### 🟡 Test-maintenance (not a blocker)

D10. **`videoflow/tests/test_sidecar.py` — 25/38 pre-existing failures from path
   drift.** The `_chapters(td)` test helper writes the sidecar to the old
   `<stem>.chapters.json` SIBLING location, but `read_sidecar` now resolves to
   the hidden `.<stem>.forge/` forge_dir → returns `None` (file-not-found) → the
   Read/Merge/Provenance assertions fail. Confirmed identical with/without the D9
   fix (so it's drift, not a regression). Update the test fixtures to write into
   `forge_dir`. Tracked, deferred.

---

## Session 2026-06-11 (Phase 3 dogfood — consolidated pipeline pass)

### 🔴 Open

D8. **🟡 FIXED-UNCOMMITTED 2026-06-11. `assessment.json` written OUTSIDE the
   `.forge` sidecar folder.** `cli.py assess` defaulted its output to
   `_default_path(funscript, "_assessment.json")` = a `<stem>_assessment.json`
   sibling of the source (every OTHER sidecar lives in `.<stem>.forge/`). The
   app writes it on every Phrases-tab visit (`analyze_phrases` → `cli.py assess`
   without `--no-save`). FIX: new `cli.py _assessment_path()` → writes
   `<stem>.forge/<stem>.assessment.json` (mirrors `_write_phrases_slice_sidecar`'s
   forge_dir guard + mkdir; falls back to the sibling if videoflow isn't
   importable). Both save sites in the assess handler updated. Verified on
   Timeline1: new run lands in `.Timeline1.forge/Timeline1.assessment.json`,
   sibling untouched. Phrases sidecar write is separate/unaffected. ⚠️ Standalone
   needs a forge-cli rebuild to pick it up (dev uses source cli.py). Old legacy
   siblings in test_funscript/ are stale clutter (cleanup pending user OK).

D7. **🔴 Open — BETA BUG (affects the SHIPPED standalone build, not just dev).
   App does NOT reap analyze children on window close (the hot-laptop cause).**
   Confirmed it hits the standalone app too: same Rust path spawns the bundled
   `forge-cli.exe` + bundled ffmpeg with no lifecycle management, so a tester who
   closes the app mid-analyze on a long 4K source gets a runaway forge-cli +
   ffmpeg eating CPU AND locking their video file until Task-Manager-killed.
   Live-repro 2026-06-11: closing the app left MULTIPLE orphaned python analyzes
   piled up (35912 @ 324 CPU, 13672, 40456) + ffmpeg, holding a file lock.
   Promote D1+D7 from "next session" to PRE-BETA. Verified: `src-tauri/src` has ZERO `kill_on_drop`,
   `CloseRequested`, `on_window_event`, `RunEvent`, or `ExitRequested`. Closing
   the window mid-analyze terminates `funscriptforge.exe` but the spawned python
   `auto-chapter` + ffmpeg children orphan and keep running (Windows doesn't
   auto-reap; tokio Command doesn't kill_on_drop by default). This is why
   closing the app during the 4K run left the fan blasting until killed
   manually. NOTE: resume-AFTER-close already works via disk state (D5 — no
   "was-running" memory needed; reopen → partial → Accept resumes). Only the
   process CLEANUP is missing. **Fix = same structure as D1:** a Rust registry
   of in-flight analyze PIDs, used by both kill-existing-before-spawn (D1) AND a
   `RunEvent::ExitRequested`/`on_window_event(CloseRequested)` handler that
   taskkills the tree on exit. Land D1 + D7 together.

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
