# E-stim screech / flash safety — incident, forensics, and architecture

**Status:** Design accepted 2026-06-30. Implementation in progress.
**Owner:** lqr
**Repos touched:** `videoflow`, `funscriptforge`, `forgeplayer`

---

## 1. The incident

While playing **`VictoriaOaks - Wet Dreams 1080p 30fps`** in **forgeplayer**, a sharp
"screech" was heard in the scene audio and felt as a **painful electrical flash**
through the e-stim at roughly **1:20–1:21** ("the last part" of a ~93 min / 5592 s
file). The user reported it as "an order of magnitude louder than the rest."

Source bundle under analysis:
`C:\Users\bruce\Projects\_lqr\funscriptforge_complete\Victoriaoaks - Wet Dreams\`

---

## 2. Forensic findings

Audio was decoded with ffmpeg and analyzed with numpy/FFT (mono, multiple
sample rates). Two **distinct** source-audio defects sit back to back, both
**clipping past the digital ceiling** (peak amplitudes 1.3–1.7 where 1.0 is full
scale):

| Time | Event | Character | Peak |
|------|-------|-----------|------|
| **1:21:01.8** | the *screech* | broadband transient, **34 % of energy >4 kHz** in a 40 ms frame (vs. mostly <500 Hz around it) — the bright "screech" timbre; +17 dB / 7.3× the surrounding HF energy | 1.37 |
| **1:21:07.9** | the *thump* | heavy low-frequency clip, **99 % energy <500 Hz** | 1.61 |

The 1:21:00–1:22:30 stretch is broadly clipped: thousands of samples pinned at
the ceiling.

### It is in the source master, not our transcode
- `Victoriaoaks - Wet Dreams 1080p 30fps.mp4`: 24,338 clipped samples in the window
- `VictoriaOaks - Wet Dreams 4k.mp4` (original master): **24,716 clipped samples** — same defect
- `wetdreams 4k60-...-Full_SBS.mp4` (VR master): **only 462 clipped samples** — a different, **much cleaner cut**

→ The defect is baked into the standard masters. A cleaner source exists in the
VR/SBS lineage.

### Traced to a specific source clip
The 1080p final is `forgeassembler`'s splice of 16 raw Victoria Oaks clips at
`C:\Users\bruce\Projects\_lqr\forgeassembler\test_media\victoriaoaks\{0..15}.mp4`
(numeric concat order; cumulative durations total 5592.73 s, matching the final).
The 4861.84 s screech maps to **clip 14, ~62 s in** (peak 1.52, **30,712 clipped
samples**, HF burst at 58.76 s). Clip 13's tail is also hot (7,397 clipped
samples near its end at 4799.7 s) — the defect straddles the 13→14 splice
boundary. **The clipping is in Victoria Oaks' delivered raw clips**, present
before any forgeassembler/FSF processing.

### The burst is plainly visible in the funscript
In the ~7 s before 1:21:08, every e-stim channel climbs and rails:
`frequency` pinned ~99, `volume` ~90, `beta` and `volume-prostate` ramping to
**100** — then **all channels hard-cut to ~6** at 1:21:07.9. That sustained
all-channels-at-max stretch **is** the painful flash; the violent cut is the
"thump." Chart: `scratchpad/screech_burst.png` (generation forensic).

---

## 3. Root cause

**The e-stim over-reacted to a brief loud audio moment — that is the bug, not the
sound itself.**

Key evidence: the scene audio plays **fine in VLC** — on normal video playback the
defect reads as merely "loud," not painful (AAC decodes to float, players
soft-limit, ears shrug). The pain came entirely from the e-stim translating that
loud moment into **simultaneous near-max carrier frequency AND near-max volume** —
a real electrical jolt.

Therefore:
- **De-screech (source cleanup) is defensive / secondary.** It helps future
  generations but does nothing for already-shipped scripts.
- **The e-stim output cap and the player runtime guard are the real safety
  fixes.** They must forbid "frequency and volume both railing at once."

---

## 4. Architecture discovery (changes where fix #2 lands)

Recon of the two repos established the actual division of labor:

- **videoflow** generates only the **mono *motion* funscript** (position 0–100 from
  beats + energy). It does **not** generate the multi-channel e-stim.
- **funscriptforge** generates the multi-channel e-stim (`frequency`,
  `pulse_frequency`, `volume`, `volume-prostate`, `alpha`, `beta`, …) via the
  restim-style process in `forge/` (`forge/audio_synthesis.py` renders the carrier;
  channel values are produced in the forge channel pipeline).
- **forgeplayer** re-synthesizes e-stim audio at playback time from those channels
  (`app/stim_synth.py` → vendored `restim_stim_math`).

So the **e-stim generation cap (fix #2) lands in funscriptforge**, not videoflow.

### Insertion points (from recon)

| Fix | Repo | File / location | Detail |
|-----|------|------------------|--------|
| **#1 de-screech** | videoflow | `src/videoflow/audio.py` ~L476, right after `librosa.load(...)`, **before** HPSS/beat tracking (`analyze_beats`) | limiter / de-clip so glitches don't spawn false onsets/energy |
| **#2 output cap** | funscriptforge | `forge/` channel generation + `forge/audio_synthesis.py` (`MIN/MAX_CARRIER_FREQ` already exist ~L37) | forbid carrier-freq **and** volume both near-max simultaneously |
| **#3 player guard** | forgeplayer | `app/stim_synth.py` `generate_block_with_clocks()` (~L212), pre-synthesis | slew-limit a sudden simultaneous near-max freq+vol jump |
| **#5 notify** | funscriptforge | sidecar report + viewer markers | see §6 |
| **#6 viewer** | funscriptforge | new "last stage" tab | renders channels; would have caught this by eye |

forgeplayer **already** clamps carrier to **500–1000 Hz** (`SafetyParams`) and
volume to [0,1] at multiple layers, and has play/pause (5 ms) + seek (500 ms)
fades — but **nothing detects or limits a sudden simultaneous freq+vol flash**,
which is exactly this bug. The new guard is additive.

---

## 5. The plan (6 parts)

1. **De-screech before analysis** — videoflow source-side limiter/de-clip.
2. **Cap the e-stim generation** — FSF: never emit freq AND volume both railed.
3. **Runtime player guard** — forgeplayer: slew-limit the flash; protects **every**
   script, including already-shipped ones, even before re-rendering.
4. **Re-render** the VictoriaOaks stim with the fixes; confirm the burst is gone.
5. **Tell the user** a screech was detected/fixed.
6. **Funscript viewer** as the last stage in FunscriptForge.

---

## 6. Decisions (2026-06-30)

- **Build all three clamps together** (#1 videoflow + #2 FSF + #3 forgeplayer) in
  one pass, then re-render to validate. (Rejected: ship the player guard alone
  first.)
- **Notification UX = sidecar report + viewer markers.** Detected/limited regions
  are written to a durable **sidecar** (e.g. `*.screech.json` / folded into the
  manifest) **and** drawn as **markers on the funscript-viewer timeline**. This
  couples naturally with fix #6.

### Defaults to use (initial, tunable)
- "Near-max" rails ≈ top ~10 % of each channel's range; "sudden" ≈ a large
  step within a short window (~tens of ms).
- Player guard ramp ≈ 10–12 ms (longer than the existing 5 ms play/pause fade,
  short enough to stay imperceptible).
- De-screech: dynamic limiter (threshold ≈ −20 dBFS, soft-knee) operating on the
  loaded mono buffer **for analysis only** — the user explicitly scoped #1 to
  "before analysis," so the rendered stim path is governed by #2/#3, not by
  altering the analysis buffer.

### Safety invariant (the rule all three enforce)
> The device must never be commanded to **near-max carrier frequency and near-max
> volume simultaneously as a sudden jump.** A genuine sweep of one parameter with
> the other steady is allowed; a fast co-rail of both is the glitch signature and
> must be clamped/ramped.

---

## 6b. Can a transcoder "fix" the clipping? (declipping)

**Short answer: partially — clipping is lossy, but declipping can meaningfully
repair it, and for our purposes we don't need perfection.**

**Measured on this real defect (clip 14, 58–72 s) — declipping does NOT apply,
limiting/de-essing does:**

| Treatment | peak RMS (40 ms, energy) | maxHF >4 kHz (screech timbre) |
|-----------|--------------------------|-------------------------------|
| RAW | 0.907 | 0.500 |
| ffmpeg `adeclip` | 0.907 (**no change**) | 0.500 (**no change**) |
| `acompressor` (thr 0.3, ratio 6) + limit | **0.489 (−46 %)** | 0.494 |
| `deesser` + limit | 0.89 | **0.353 (−29 %)** |

**`adeclip` was a no-op** because this is not flat-top digital clipping — the AAC
decode produces variable *overshoots* >1.0 (a hot/overdriven master), so there are
no constant-value plateaus for peak-reconstruction to fill. Peak-restoration
declippers (A-SPADE/S-SPADE, ML) target flat-top clipping and are therefore the
**wrong tool for this defect.**

What *does* work, and why it's enough for us:
- **`acompressor`** squashes the brief energy spike ~in half. This is the key win:
  it stops librosa's onset/energy from seeing a giant false onset, which is the
  thing that makes the e-stim co-rail. We don't need to *restore* the audio, just
  flatten the spike the analyzer reacts to.
- **`deesser`** softens the bright >4 kHz screech harmonics specifically.
- **True-peak limiter** (`alimiter` / `loudnorm` TP target) guarantees nothing
  re-clips downstream. (Note: `alimiter`'s auto-`level` makeup gain can *raise*
  RMS — disable makeup for an analysis-cleanup pass.)

**For our pipeline the bar is lower than broadcast restoration.** We do not need a
pristine peak — we need (a) analysis not to spawn a false high-energy onset, and
(b) the e-stim not to co-rail. So a practical "forge transcoder" stage is
(empirically tuned above):

```
detect clip/screech regions  →  acompressor on flagged spans (kill the energy spike, −46%)
                             →  deesser (tame screech HF timbre, −29%)
                             →  true-peak limit (-1 dBTP, makeup OFF) so nothing re-clips
                             →  feed clean buffer to analysis (= fix #1)
```

This is a superset of the §5 fix #1 "de-screech." Building it as a real transcoder
buys two extra things beyond analysis safety:
1. A **cleaner scene-audio render** if we ever pass processed audio to playback.
2. A reusable **"repair a hot master" pass** for any title, logged to the sidecar.

**But for *this* specific title the cleanest fix is re-sourcing, not repair:** the
VR/SBS master is a different, near-unclipped cut (462 vs. 24,716 clipped samples).
A "transcoder" worth building should therefore *also* detect when a clipped master
has a cleaner sibling in the lineage and prefer re-sourcing over declipping. (See
follow-up in §7.)

## 6c. Implementation status (2026-06-30)

- **#3 forgeplayer guard — DONE.** `forgeplayer/app/stim_safety.py`
  (`apply_flash_guard`) + wired into `StimSynth.__init__`; 33 tests green
  (`tests/test_stim_safety.py`). Recalibrated against real data: rails set to
  **0.99/0.99** because the scene legitimately sits near-max ~20 % of the time;
  only true co-max anomalies clamp (**8 on volume, 11 on volume-prostate** across
  the file — vs. 2,382 at the naive 0.92/0.90 rails, which would have neutered
  the scene). **Honest limitation:** at the 1:21 flash the volume channel was only
  0.90 — indistinguishable from intended intensity at channel level — so the
  player guard does **not** catch this specific case. It's a backstop for egregious
  co-max; the real fix for screech-driven flashes is upstream (#1/#2).
- **#1 videoflow de-screech — DONE (analysis side).**
  `videoflow/src/videoflow/descreech.py` (vectorized peak limiter, scipy.ndimage)
  + wired after `librosa.load` in `analyze_beats`; new
  `AudioBeatMap.screech_regions` carries the tamed spans out. 5 tests green.
  Measured on the real screech: **−38 % peak, −29 % energy**, **9.4 s for a 93-min
  file**. (Two failing tests in `test_audio_peaks`/`test_audio_spectrogram` are a
  pre-existing Windows sidecar-fixture bug, unrelated.)
- **#2 FSF e-stim cap — TODO.** Locate the channel generator that produced
  `frequency`/`volume`; apply the same co-rail invariant where the audio context
  is still available.
- **#5 sidecar + viewer markers — partially scaffolded.** `screech_regions` now
  flows out of videoflow analysis and `FlashRegion`/`ScreechRegion` both have
  `as_dict()`; still need persistence to a sidecar and the viewer overlay.
- **#4 re-render** and **#6 viewer** — TODO.

## 7. Open questions / follow-ups

- Exact home for the FSF channel-cap (channel generator vs. `audio_synthesis.py`
  render) — confirm during implementation.
- Whether to also offer "re-source from the cleaner VR/SBS master" as a one-click
  fix when a clipped master is detected.
- Threshold tuning against real scripts to avoid neutering intentional climaxes
  (the e-stim *should* still be able to peak — just not co-rail both axes in a
  glitch step). Target a BAND, don't overfit one file.
- Viewer: should the markers be clickable (seek-to) and show the detected
  category (screech vs. thump vs. limited)?
