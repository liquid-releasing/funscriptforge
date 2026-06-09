# FunscriptForge — Beta cut checklist

The single source of truth for "what's left before we cut the beta." Compiled
2026-06-09 from the pending punch list + the dogfood log. Beta is **Windows-first**
(macOS/Linux are an explicit post-beta follow-up).

Status: 🔴 not started · 🟡 in progress / uncommitted · ✅ done

---

## A. Hard gates — must be green to cut beta

### A1. Tauri release / distribution pipeline ✅
`release.yml` is the Tauri pipeline (forge-cli PyInstaller sidecar + bundled
ffmpeg); **`v0.1.0-alpha` published** to funscriptforge-releases (MSI + NSIS,
4 CI runs, freeze proven). Done.

### A2. Streamlit removal ✅
Whole Streamlit tree + tests + build scripts removed (`74b4fc8`); docs swept
(`392ae1a`). Done.

### A3. Resume analysis 🟡 — BUILT, needs live confirm
videoflow per-stage skip-if-exists + Tier-1 short-circuit + Partial-banner
Resume CTA all built and unit-tested. **Remaining: live test** — analyze →
close app mid-run → reopen → Partial banner shows **Resume** as default →
re-runs only missing stages (footer reads "cached (resume)"). _(Reminder: with
Cancel deferred, closing the app IS the mid-run kill — that's the test path.)_

### A4. 4K chapter clips 🟡 — confirmed downscaling, needs in-app playback confirm
Both paths downscale 4K→720p (v12, lanczos + BT.709). **Verified 2026-06-09**
via the mosaic diagnostic: IPZZ-125 source is 3840×2160, its `.forge` clips are
1280×720 with iris color intact. **Remaining: confirm clips play in WebView2
with no OOM** during the live walk (open a 4K project, jump chapters fast).

### A5. Consolidated dogfood pass 🟡 — IN PROGRESS (the umbrella gate)
One deliberate walk of Library → Analyze → Channels → Polish → Export on real
projects incl. a 4K source. Beta does not cut until this is clean.
- [ ] **4K clips** (A4) — play in WebView2, no OOM, iris color survives.
- [ ] **Resume** (A3) — kill mid-Analyze → reopen → Resume.
- [ ] **Channels** — character + mechanical arcs auto-assign; skipping the tab
      still yields sane defaults; e-stim draws live per chapter.
- [ ] **Polish** — stations stamp (E-Stim · Handy · OSR2 · SR6/TCode); 3-pane
      preview + knobs; files land at `<forge>/polish/<station>/`; no clipping.
- [ ] **Export — both modes** — `.forge` zip AND loose `<stem>.output/` (new
      multi-select), motion + sidecars + auto-generated e-stim/multi-axis from
      Channels (no Polish stamp needed) + WAV/MP3 opt-ins + manifest; Reveal
      opens it; the `.forge` re-imports.
- [ ] **Bare-funscript degradation** — open a `.funscript` with no media/sidecars,
      click every tab: correct empty states, no console errors, no lying
      "auto-detected" rows.
- [ ] **Progress footer** — trigger a recalc; footer says what it's doing (no
      bare "Working…").

### A6. Commit this session's dogfood fixes 🟡
All live in the dev build, uncommitted (one needs the recompiled Rust cmd):
- **Export multi-select** — tick both shapes, one Export writes both.
- **WAV/MP3 gate relaxed** — stim audio enabled whenever e-stim is in the
  bundle (stamped *or* auto from Channels); misleading "needs a stamped station"
  copy fixed.
- **About-box links open in the system browser** — new `open_external` Rust
  command + `forge.js` wrapper + wired both link lists.

---

## B. Compliance — confirm before PUBLIC beta (flagged, not code)

- **funscript-tools (Edger)** — upstream declares **no license**. We use the
  tone/eTransform algorithms with credit. Get explicit license/permission from
  Edger before public distribution. (About box + `THIRD_PARTY_NOTICES.md` name it.)
- **GPL ffmpeg** — we bundle a `--enable-gpl` build (libx264) inside an MIT app.
  Aggregation (subprocess) keeps our code MIT; we ship ffmpeg's LICENSE + source
  pointer. Worth a formal license review before public 1.0.

---

## C. Explicitly deferred — NOT beta gates (post-beta)

Parked by user decision; listed so they're not mistaken for open gates.
- **Cancel a running analysis** — close-app is the interrupt for beta.
- macOS / Linux release jobs.
- Chapter over-merge on very long single-chapter sources (clip is 720p/~100MB
  now, so no OOM — detection-quality only).
- Per-chapter phrase detection refactor; phrase⊂chapter boundary split.
- Stanza detector quality (over-merge repeats, "Steady" label fit).
- MediaViewer baton windowing (3 modes disagree on scope).
- Analysis sub-tab UX polish (pitch/structure/phrases/energy/beats).
- Videoflow pipeline parallelization.
- Project-tab × to remove from recents; auto-play-on-focus preference.
- Drag-to-scrub in the strip; chrome nits.

---

## Recently closed (this session / sprint)
Release pipeline + alpha publish · Streamlit removal · Resume build · Export
images (hero/preview) · `.forge` import + selectable output folder + versioning ·
title-bar filter removed · real version string · About dialog · MediaViewer
non-passive wheel-absorb · mosaic "black box" diagnosed (source-baked, not us) ·
docs de-Streamlit'd.
