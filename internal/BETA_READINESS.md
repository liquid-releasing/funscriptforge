# FunscriptForge — Beta Readiness Checklist

_Living doc. Status: ✅ done · 🟡 code-complete, not live-verified · 🔴 not built · 🔁 in progress._
_Last updated 2026-06-16._

This is the durable home for "what's left before the beta cut." It supersedes the scattered
gate notes in memory; when an item lands, tick it here.

---

## PRE-BETA GATES (must close before the cut)

### 1. Consolidated dogfood pass 🟡
One deliberate Library → Analyze → Channels → Polish → Export walk on a 4K source. Much is
validated piecemeal (VictoriaOaks full save 2026-06-16, beat bar, intensity arc, channels,
tones persist). Still needs a single end-to-end tick of:
- [ ] 4K clip downscale → ~100 MB/720p, **iris color survives** (✅ color confirmed 2026-06-16), no WebView2 OOM
- [ ] Export **both** modes (loose + `.forge`) incl. auto-generated stim/multi-axis without a Polish stamp
- [ ] **Bare-funscript live click-through** (static audit ✅; live pass not done)
- [ ] Progress/busy footer never shows a bare "Working…"

### 2. Process management — D1 + D7 ✅ (LIVE-VERIFIED 2026-06-16, `494fea2`)
- D1 (serialize analyzes): ✅ done — `kill_existing_analyze` reaps the prior auto-chapter before spawning.
- D7 (reap children on window-close): ✅ **LIVE-VERIFIED.** `ACTIVE_CHILDREN` registry tracks every
  backend spawn's PID; `reap_active_children` kills each tree on `WindowEvent::Destroyed` +
  `RunEvent::Exit`. **Test result:** closed the window DURING chapter-clip extraction (ffmpeg live,
  holding the source video) → both python workers (incl. the 1.6 GB analyze worker) AND ffmpeg gone
  to zero; fan wound down (no orphan CPU). The dealbreaker bug (orphans burning CPU + locking the
  source video after close) is fixed.

### 3. WebView2 memory 🟡 (partially mitigated)
The VictoriaOaks freeze cause: the viewer holds full-track heavy data (20 MB spectrogram parsed
into JS + per-chapter canvas re-renders) and never releases. **Mitigated** by restart-is-safe
(everything write-through to `.forge`) + the per-confirm recompute framing. Deeper fix (don't keep
full spectrogram in JS, debounce per-confirm recompute, reuse canvases) may be deferrable if it's
not freezing in practice. **Re-confirm under the dogfood pass.**

**Already closed (FYI):** Windows release pipeline ✅ (v0.1.0-alpha, MSI+NSIS), Streamlit removal ✅,
Resume analysis ✅.

---

## DOGFOOD ISSUES — 2026-06-16 (triaged; reconsider as blockers)

1. **Beat bar — two distinct problems. RECONSIDER as a blocker (it's a hero feature).**
   NOTE: beat DETECTION is good — VictoriaOaks "a wall of beats… varying speeds," and the
   **funscript built off the beats is excellent** (user, 2026-06-16). The DATA is right; the
   VIEWER clock is off. Two parts:
   - **(1a) Baton rarely lands on the tick** — 🔴 the bigger one. Diagnose before fixing.
     Hypotheses, in priority order: **(i)** chapter-clip timestamp drift — clips are RE-ENCODED
     720p with `-avoid_negative_ts make_zero`, so clip t=0 may not map exactly to `chapter.atMs`
     where beats were detected (absolute `beatsMs`) → a systematic offset that grows with varying
     tempo. **(ii)** the 10 Hz throttled clock — at 129 BPM ticks are 465 ms apart, so a ~100 ms
     stale baton reads as ~¼-beat behind on a dense wall. **(iii)** `videoSrcOffsetMs` not added
     back into `currentMs` for the BeatsLane baton.
     **Test/diagnose:** play a dense VictoriaOaks chapter; (a) check whether the miss is a CONSTANT
     offset (→ clip drift / offset bug) or GROWS with tempo / is jittery (→ throttle); (b) compare
     a DIRECT-PLAY chapter (1080p, no clip — Prisoner) vs a clipped one — if direct-play lands but
     clipped misses, it's clip drift (i). That A/B isolates it cleanly.
   - **(1b) ♩BPM badge is whole-track average** — 🔴 near-term, JS-only. Never changes as you
     scrub. Fix: windowed local-BPM (median IOI near the playhead) in forgemoment `BeatsLane`.
     **Test:** scrub a variable-tempo file (Euphoria2 outro 65→129) slow vs fast section → badge
     should change >10%.

2. **Iris color survives the 720p downshift** — ✅ CONFIRMED GOOD (don't regress).
   **Test:** open a graded 4K source (IPZZ-125 / VictoriaOaks-4K), play a chapter clip, color holds.

3. **Playback inconsistent toward the viewer edges** — 🟡 RECONSIDER as blocker; needs a crisp repro.
   Likely the known baton-windowing nit: funscript lane is chapter-scoped, audio/spectro are
   track-scoped → they disagree mid-chapter (see pending "MediaViewer baton windowing").
   **Test:** in EACH viewer mode (funscript / audio / spectro), scrub to within ~2 s of a chapter's
   start and its end. Note for each: does the video frame update, does the baton reach the edge,
   do the lanes scroll. PASS = all three lanes + the video agree on position at the edges.
   _Action: capture which mode + which chapter when it next happens so we can pin it._

4. **Chapters break near-but-not-on the real scene breaks** — 🔴 POST-BETA (detection quality).
   Chapters are AUDIO-ONLY today; the real fix is video-aware chapters (scene-cut signal, already
   greenlit post-beta). **Near-term mitigation:** manual split/join already exists; consider an
   **"import known breaks"** path (user has ground-truth break lists). **Test/validate:** load the
   user's ground-truth breaks → measure detected-vs-true boundary delta per chapter → quantify.
   _Action: get the ground-truth breaks file from the user → build a regression fixture + decide if
   a cheap snap-to-nearest-onset helps before the video-CV work._

5. **Events must terminate at a chapter boundary (can't cross)** — 🟡 DESIGN RECONSIDER.
   Consequence of today's chapter-scoped Events (capture clamp + begin-only homing + viewer/playhead
   clamped to the active chapter). Painful mainly BECAUSE the boundary is misplaced (#4). Options:
   (a) fix boundaries (#4) so termination lands right — keeps the clean one-chapter model; or
   (b) let events extend across a boundary — conflicts with the chapter-scoped viewer/playhead, a
   bigger change. **Lean: (a) first** (correct boundaries), revisit (b) if still painful.

---

## NEAR-TERM FOLLOW-UPS (this session's offshoots)

- **`.forge` (editor) vs `.forgeplay` (player) split** 🔴 — `.forge` opens FunscriptForge (resume
  editing), `.forgeplay` opens forgeplayer (play/share). Resolves the long-standing `.forge` overload.
- **forgeplayer opens an adjacent `.forge` / `.forgeplay`** 🔴 (user, 2026-06-16) — double-click a
  bundle → forgeplayer loads it. An `open_in_forgeplayer` Rust command already exists in FSF; the
  player side needs to accept a `.forge`/`.forgeplay` path arg (file association + CLI/open handler).
- **Save button** in the TopBar (Open · Save · Export) 🔴 — confidence affordance (already write-through).
- **session.json in `.forge`** 🔴 — portable resume (tab + playhead + selection); today localStorage, tab-only.
- **Library hide/remove** card + Project-tab × from recents 🔴.
- **Docs staleness cleanup** 🔴 — user + arch docs Streamlit-era stale (audit ✅, edits not).

---

## POST-BETA — features & quality

**Detection quality**
- Video-aware chapters + a "Video" row in Analysis (scene-cut signal) — greenlit.
- Per-chapter phrase detection + phrase ⊂ chapter boundary contract.
- Chapter over-merge upper-bound (long single-chapter videos).
- Stanza algorithm tuning (over-merges repeats; "Steady" label fit).

**Performance / pipeline**
- Release-foundry prep tool + 4K single-file 720p proxy (single-file streaming half done on
  `video-stream-streamline`, not merged).
- Videoflow pipeline parallelization.
- WebView2 deep fix (virtualize spectrogram, debounce recompute) — if #3 above proves it's needed.

**Polish nits**
- Beat bar local-BPM (if not pulled pre-beta).
- Character-select stops the video.
- MediaViewer baton windowing — three modes disagree in phrase scope (also dogfood #3).
- 5 Analysis-tab refinements (mel-bin label, L-R chapter grids, energy sort toggle, beats chart).
- Loose-folder export remaps `beat.mp3` under `E-Stim/` (manifest mismatch).
- Drag-to-scrub in strip; auto-play-on-focus preference.
- Direct ffmpeg spawns (Rust `extract_chapter_clip` / prewarm) aren't in the D7 child registry yet
  — fold in if they ever orphan.

**Distribution / output**
- **Export to MEGA** (cloud upload of the `.forge`/`.forgeplay` bundle) — post-beta (user, 2026-06-16).
- **Output view page** — a dedicated screen to review what was exported / the produced artifacts —
  post-beta (user, 2026-06-16). Pairs with the [[project_funscript_viewer_app]] "see it + siblings" idea.

**Strategy (logged, not scheduled)**
- demofoundry.app, marketing tour, post-beta AI/GPU roadmap, quality-metric linter/diagnostic.
