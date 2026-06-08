# Dogfood test script — Events bake-in + Export restructure

Covers the two features shipped on branch `channels-character-2d` this session:

1. **Events bake into e-stim channels** (commit `c44d946`) — authored events
   (`<stem>.feel.yml`) modulate the generated 9-channel e-stim at generation, so
   restim / ForgePlayer (which play channels, not events) feel them.
2. **Export = Targets · Destinations · Actions** (commit `bf3a3ac`) — the Export
   tab restructured, plus a real **Open in ForgePlayer** hand-off.

Status legend: 🔴 open · 🟡 fixed-uncommitted · ✅ pass. Log every defect in the
**Defects** section at the bottom with a repro.

---

## 0 · Preconditions (do once)

- [ ] `tauri:dev` is running and **recompiled the Rust** this session (both
      features add Rust/CLI paths — HMR alone won't pick up `open_in_forgeplayer`
      or the bake-in).
- [ ] ForgePlayer is launchable: a `forgeplayer/` checkout sits beside
      FunscriptForge **or** `FORGEPLAYER_ROOT` is set. (Verified present:
      `../forgeplayer/main.py` + `.venv`.) Its venv must import (PySide6 + mpv).
- [ ] `ffmpeg` on PATH (for MP3 stim audio + chapter/hero thumbnails).

### Test projects (in `test_funscript/`)

| Project | chapters | characters | feel.yml (events) | Use for |
|---|---|---|---|---|
| **Prisoner** | ✓ | ✓ | ✓ | **Primary** — events bake-in + e-stim auto-gen |
| VictoriaOaks_stingy.original | ✓ | ✓ | — | Scale (17 ch) · e-stim auto, no events |
| Euphoria2 | ✓ | ✓ | — | e-stim auto, no events |
| Timeline1 | ✓ | ✓ | — | has a `.work.funscript` (effective-path edge) |
| LongandCut-hdr | — | — | — | Degraded / bare path |

None have a `polish.yml` stamp, so **e-stim exports in the `auto` state**
(generated from Channels characters at export) — which is what most users hit.

---

## PART 1 · Events bake into e-stim channels

The substantive correctness test. Events should measurably change the e-stim
**volume** channel; absence of events should be a no-op.

### 1A · UI path (Prisoner)
1. [ ] Library → open **Prisoner**. Analyze if prompted.
2. [ ] **Events** tab: confirm the authored events render on the timeline (Prisoner
       has a `feel.yml`). Note one event's effect + time (e.g. an `edge`/`surge`
       around mm:ss).
3. [ ] **Channels** tab: confirm chapters carry characters (assigned or default arc).
4. [ ] **Export** tab → click **Export** (`.forge bundle`, disk). Wait for the
       write (e-stim auto-gen runs funscript-tools per chapter — can take a bit).
5. [ ] **Reveal** the bundle. Expected: `stations/estim3p/` holds 9
       `*.{alpha,beta,…,volume,…}.funscript` files.

**Expected:** export succeeds; e-stim channels present.

### 1B · CLI verification — events actually bake (the real proof)
Run from the repo root under the project venv (`./.venv/Scripts/python.exe`).
This generates the e-stim with events present, then again with `feel.yml`
renamed away, and diffs the volume channel.

> NOTE: the `.venv` python is Windows-native, so its `/tmp` ≠ git-bash's `/tmp`.
> Snapshot to a **repo-relative** file (below), and pass `OUT` to Python via a
> raw string. (`err_*.txt` are read by grep/git-bash, so `/tmp` is fine for them.)

```bash
PY=.venv/Scripts/python.exe
SRC=test_funscript/Prisoner.funscript
FEEL=test_funscript/.Prisoner.forge/Prisoner.feel.yml
OUT=test_funscript/.Prisoner.forge/polish/estim3p/Prisoner.volume.funscript

# WITH events
$PY cli.py polish-apply "$SRC" --station estim3p 2>/tmp/err_yes.txt >/dev/null
cp "$OUT" ./_vol_yes.json

# WITHOUT events (move feel.yml aside, regenerate, restore)
mv "$FEEL" "$FEEL.bak"
$PY cli.py polish-apply "$SRC" --station estim3p 2>/tmp/err_no.txt >/dev/null
mv "$FEEL.bak" "$FEEL"

# Compare the volume channel + confirm the event engine ran only WITH events
$PY -c "import json,statistics as s;y=json.load(open('_vol_yes.json'))['actions'];n=json.load(open(r'$OUT'))['actions'];print('volume channels differ:', y!=n, '(expect True)');print('mean pos  with=%.1f  without=%.1f'%(s.mean(a['pos'] for a in y), s.mean(a['pos'] for a in n)))"
grep -iq ff_events_bake /tmp/err_yes.txt && echo 'WITH events: bake ran OK' || echo 'WITH events: bake did NOT run FAIL'
grep -iq ff_events_bake /tmp/err_no.txt && echo 'WITHOUT events: bake ran FAIL' || echo 'WITHOUT events: no bake OK'
rm -f ./_vol_yes.json
$PY cli.py polish-apply "$SRC" --station estim3p 2>/dev/null >/dev/null   # leave disk in the normal (with-events) state
```

- [ ] **with-events vs without-events volume channels DIFFER** (`differ: True`) and
      the bake line (`Saved … files to …ff_events_bake_…`) appears **only** in the
      with-events run.

> ✅ **Confirmed on real data 2026-06-08** (Prisoner, one `edge` event):
> `differ: True`, mean pos **with=80.9 / without=89.9**, `WITH events: bake ran OK`,
> `WITHOUT events: no bake OK`.
- [ ] **Fail-safe:** temporarily corrupt `feel.yml` (write `events: [{time: 0}]`
      — missing `name`). Re-run `polish-apply estim3p`. Expected: generation still
      succeeds, stderr logs `event bake-in skipped: …`, channels are the
      un-modulated baseline (never a crash).

> Automated regression already covers this: `tests/test_polish.py::test_estim_bakes_authored_events` + `_noop` (run under `.venv`).

### 1C · No-events project (Euphoria2 or VictoriaOaks)
1. [ ] Open a project **without** `feel.yml`, Export.
2. [ ] Expected: e-stim channels generate normally; **no** `event bake-in` /
       `Saved N files to ff_events_bake` line in logs (nothing to bake). No error.

---

## PART 2 · Export — TARGETS (readiness cards)

Open **Export** on **Prisoner** (no Polish stamps → "auto" e-stim).

- [ ] Four target cards render: **Strokers · E-stim · Authoring · Preview**.
- [ ] **Strokers** → state chip `ready`; consumer line "MultiFunPlayer · Intiface ·
      Handy"; stat shows action count + "motion + auto" (no stamped strokers).
- [ ] **E-stim** → chip `auto` (blue); hint mentions "Auto-generated … from your
      per-chapter Channels characters". (This is honest — no fake "ready".)
- [ ] **Authoring** → chip `present`; lists chapters/phrases/characters + events.yml.
- [ ] **Preview** → with Prisoner (no media attached?) chip is `opt-in` and hint
      says "Attach media for hero + per-chapter frames"; **with** a media project
      it flips to `ready` (hero + chapters).
- [ ] Header pill reads `N/4 targets` and updates to match the ready cards.
- [ ] **Honesty check:** there are **no checkboxes** on target cards — they reflect
      what the packager will write, not a selection that could lie.

### 2B · Stamp changes E-stim state
1. [ ] **Polish** tab → stamp **E-Stim** for the project. Return to Export.
2. [ ] E-stim card flips from `auto` → `ready` ("Polish-stamped 9-channel set");
       header station pill increments.

---

## PART 3 · Export — DESTINATIONS (the new interactive axis)

- [ ] Three destination cards: **Disk · Open in ForgePlayer · Autoblow cloud**.
- [ ] **Disk** has a segmented `.forge bundle | Loose files`; switching to
      **Loose files** reveals the **stem** input; switching back hides it.
- [ ] Folder line shows the project folder path (picker tagged "picker — next").
- [ ] **Open in ForgePlayer** is a real toggle (checkbox-square fills when on,
      card border lights green). Copy notes "dev launcher · full .forge auto-import
      is a ForgePlayer follow-up".
- [ ] **Autoblow cloud** is dimmed with a `later` pill and is **not** clickable
      into an active state (post-beta).

---

## PART 4 · Export — ACTIONS + ForgePlayer hand-off

### 4A · Export to disk
1. [ ] Disk = `.forge bundle`, ForgePlayer **off**. Click **Export (N → .forge
       bundle)**. Button shows "Writing…", then a green result line:
       `N artifacts · M stations → …/<stem>.forge`.
2. [ ] **Reveal** opens Explorer with the bundle selected.
3. [ ] **Copy path** copies the bundle path (paste somewhere to confirm).
4. [ ] Switch Disk → **Loose files**, change the **stem**, Export again. Expected:
       loose sidecars land in the project folder with the new stem; action label
       reads `(N → loose folder)`.

### 4B · ForgePlayer hand-off (the device-push)
1. [ ] Tick **Open in ForgePlayer**. Action button now reads `(N → .forge
       bundle · ForgePlayer)`.
2. [ ] Click **Export**. Expected: bundle writes **and** ForgePlayer **launches**
       (its window opens), and FunscriptForge **reveals** the exported file in
       Explorer (so you can drop it into a stim slot).
3. [ ] After any successful write, the standalone **Open in ForgePlayer →** action
       (in the Actions row) launches the player on demand; shows "Launching…".
4. [ ] **Negative:** temporarily unset the sibling (rename `../forgeplayer` or
       clear `FORGEPLAYER_ROOT`). Click Open in ForgePlayer. Expected: a clear
       error in the Actions row ("ForgePlayer not found — set FORGEPLAYER_ROOT…"),
       **no crash**. Restore afterward.

> Known limitation (by design this pass): ForgePlayer does **not** auto-load the
> `.forge` bundle — it just launches; you open the funscript via its slot dialog.
> Confirm the copy says so; this is a ForgePlayer-side follow-up, not a bug.

---

## PART 5 · Regression / edge cases

- [ ] **Sample project** (`sample://…`): Export button disabled with "Export needs
      a real project on disk." No target/destination interaction errors.
- [ ] **Bare funscript** (LongandCut-hdr, no sidecars): Export still works; targets
      degrade honestly (E-stim shows `auto`/skipped, Authoring minimal, Preview
      waveform-only). No console errors, no lying "ready".
- [ ] **Timeline1** (has `.work.funscript`): Export packs the edited work funscript
      as motion but derives sidecars/stem from the original — bundle is coherent.
- [ ] **Options** section: `Blend seams` / `Final smooth` toggle freely; **Stim
      audio WAV/MP3** are **disabled** ("stamp e-stim first") until an e-stim
      station is stamped, then enable and produce `audio/stim.{wav,mp3}` in the
      bundle.
- [ ] No regressions vs the old Export: bundle structure unchanged
      (`motion.funscript`, `stations/`, `events.yml`, sidecars, `thumbnails/`,
      `manifest.ffmeta`); only the **UI** changed.
- [ ] No bare "Working…" — write progress is descriptive.

---

## Defects found

> One block per defect. Include: project, exact steps, expected vs actual, and
> any console / `tauri:dev` log lines.

| # | Severity | Where | Repro | Expected | Actual | Status |
|---|---|---|---|---|---|---|
|   |          |       |       |          |        | 🔴     |

---

## Sign-off

- [ ] Part 1 (events bake-in) clean
- [ ] Part 2 (targets) clean
- [ ] Part 3 (destinations) clean
- [ ] Part 4 (actions + ForgePlayer) clean
- [ ] Part 5 (regression) clean

Tester: ____________   Date: ____________   Build: `channels-character-2d @ bf3a3ac`
