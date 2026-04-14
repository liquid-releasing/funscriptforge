# Stingy Analysis — EDA on Funscript Corpus

**Date:** 2026-03-25
**Status:** Initial findings, needs deeper analysis

## Corpus

| Script | Type | Actions | Duration | Source |
|--------|------|---------|----------|--------|
| Euphoria2 | Curated | 10,281 | 68 min | digitalparkinglot handwritten |
| RoD (Rhythms of Desire) | Curated | 22,686 | 91 min | restim-mile community |
| IPZZ-125 | Suspect | 33,290 | 123 min | PythonDancer generated |
| Timeline1 pydancer | Suspect | 2,760 | 10 min | PythonDancer generated |
| VictoriaOaks stingy | Suspect | 23,710 | 93 min | PythonDancer (fast) |
| VictoriaOaks pydancer | Suspect | 23,710 | 93 min | PythonDancer (120 BPM) |
| BigBuckBunny raw | Test | 2,211 | 10 min | Generated |

## Key Metrics

| Script | Vel_med | Vel_p95 | Delta_med | BPM_med | BPM_p95 | V>250% |
|--------|---------|---------|-----------|---------|---------|--------|
| Euphoria2 (curated) | 259 | 862 | 100 | 240 | 261 | 63% |
| RoD (curated) | **719** | **1333** | 100 | 201 | 400 | **95%** |
| IPZZ-125 (suspect) | 120 | 290 | 26 | 136 | 144 | 7% |
| Timeline1 (suspect) | 144 | 399 | 32 | 134 | 148 | 27% |
| VictOaks stingy | 410 | 431 | 98 | 126 | 136 | 94% |
| VictOaks pydancer | 218 | 297 | 52 | 129 | 136 | 24% |

## Surprising Finding

**Curated estim scripts are FASTER than the "stingy" PythonDancer scripts.**

- Curated p95 velocity: ~1098 pos/s
- Suspect p95 velocity: ~354 pos/s
- Curated median BPM: ~220
- Suspect median BPM: ~131

## Open Questions

1. **Is funscript velocity the right metric for estim stinginess?**
   - Funscript velocity = position change per second
   - For strokers: maps directly to physical speed
   - For estim: maps to electrode path traversal speed via restim conversion
   - The restim radial conversion transforms velocity into something different

2. **What makes VictoriaOaks "stingy" vs RoD "comfortable"?**
   - Both have high velocity (410 vs 719 median)
   - RoD has MORE variation (p95=1333, wider range)
   - VictOaks is relentless: narrow BPM range (126-136), constant high velocity
   - Hypothesis: **stingy = sustained high intensity without rest**, not just high velocity

3. **Should we analyze the alpha/beta output instead?**
   - The curated RoD has both FOC and stereo channel files
   - Comparing our Stim tab output to these reference files would validate the conversion
   - The channel files are what actually drives the device

4. **Is our 250 pos/s clamp too aggressive?**
   - Current limit flags 63-95% of curated scripts
   - This means we're fundamentally changing scripts that experts designed
   - Possibly the clamp should be much higher (500-800?) or based on a different metric

## Smoking Gun: Velocity Coefficient of Variation (CV)

Micro-level cycle analysis comparing 1-minute windows at 5, 30, and 60 minutes:

| Metric | RoD (curated, comfortable) | VictoriaOaks (stingy) |
|--------|---------------------------|----------------------|
| **Velocity CV** | **0.42–0.47** | **0.05–0.12** |
| Unique positions | 2–5 | 17–21 |
| Amplitude std | 0–1.9 | 4–11.5 |

**Finding:** Stingy is NOT about speed. It's about **velocity consistency.**

- RoD: high velocity (mean 343–691 pos/s) but HIGH variation (CV ~0.45). Each cycle is a different speed. This creates micro-rest — some cycles fast, some slower. The beat is relentless but the body gets micro-breaks.
- VictoriaOaks: moderate velocity (mean 395–401 pos/s) but NEAR-ZERO variation (CV ~0.05–0.12). Every cycle is mechanically identical. This is what burns over time.

**Stingy metric: CV < 0.15 sustained = stingy. CV > 0.30 = comfortable variation.**

RoD uses fewer unique positions (simple 0→100→0) but varies the SPEED of each cycle.
VictoriaOaks uses more positions but at relentlessly constant speed. It's a metronome.

The "bump in the uptake" that makes RoD work is naturally varying cycle speed while preserving the beat.

## Actionable Design

### Hidden (automatic safety net)
- Device awareness auto-detects segments with CV < 0.15
- Applies minimum "humanize" — adds velocity variation to reach CV ~0.30
- User never sees it, script won't burn
- Like the speed clamp but for monotony

### Visible (creative choice)
- "Humanize" / "Groove" slider in Tone tab or Behavior catalog
- 0.0 = mechanical precision, 1.0 = jazzy variation
- Slightly varies cycle speed while preserving the beat pattern
- Power users can turn it off

### Where it lives
- **Device tab:** flag CV < 0.15 like speed violations
- **Tone tab:** tones naturally add CV variation (Tender = more, Dominant = less)
- **Behavior catalog:** standalone "Humanize" transform

## Retrospective: How Did Our Speed Clamp Actually Work?

Our current approach (clamp velocity to 250 pos/s) reduced Victoria Oaks stinginess,
but **for the wrong reason.** The clamp forced cycles to slow down, and as a side
effect introduced velocity variation — because the clamp hits different cycles
differently depending on their original speed. This accidentally raised the CV.

But it also fundamentally changed the script's character. We compressed a 410 pos/s
median down to 250, which is more aggressive than necessary. The curated RoD runs
at **700+ pos/s** and feels great because of its high CV (0.45).

**What we should have done:** leave the speed mostly alone, add velocity variation
(humanize). Victoria Oaks at 400 pos/s with CV=0.40 would probably feel amazing —
fast, relentless beat, but with the micro-rest that makes it sustainable.

**What we actually did:** brute-force slow it down. It works but it's like fixing a
racecar by putting on smaller tires instead of adding better suspension.

The intensity spikes slider was the right instinct — let some cycles punch through.
But the real fix is the opposite: don't slow the fast ones, speed-vary ALL of them.

We got lucky that the result still felt good. Now we know why, and we can do it
intentionally.

**Implication for device_specs.json:** The estim max_speed of 250 pos/s is too low.
Curated scripts run 700+ safely. The real protection is CV-based humanize, not
velocity clamping. Speed clamp should be raised significantly (500–800?) or replaced
entirely by CV-aware humanize.

## Expanded Corpus (2026-03-25, 14 scripts total)

| Script | V_med | CV | Streak | Low% | Quiet | Build | V*1-CV | Verdict |
|--------|-------|-----|--------|------|-------|-------|--------|---------|
| A Sinful XXX | 500 | 0.35 | 2m | 9% | 2m | **1.61** | 324 | Exceptional — escalates per section |
| Celestial Succubus | 529 | 0.35 | 0m | 0% | 0m | **1.50** | 346 | Good variation, builds |
| Magik3 Pt1 | 263 | 0.39 | 2m | 14% | 0m | 1.32 | 160 | Moderate, good CV |
| Magik3 Pt2 | 281 | 0.10 | 6m | 52% | 0m | 1.28 | 252 | Low CV but builds |
| Optikon Alpha | 258 | 0.02 | **26m** | **80%** | 0m | **2.29** | 253 | Hypnotic — massive escalation |
| Optikon rest | 353 | 0.02 | **22m** | **93%** | 0m | 0.66 | 344 | Rest version — de-escalates |
| Zer0 Game | 142 | 0.37 | 5m | 27% | **14m** | **2.40** | 93 | Slow burn — most rest, highest build |
| Euphoria2 | 259 | 0.03 | 11m | 67% | **7m** | **2.06** | 252 | Hypnotic — slow deliberate, breaks |
| RoD | **719** | 0.36 | 1m | 4% | 1m | 1.60 | 460 | Breathtaker — fast + varied |
| **VictOaks STINGY** | 410 | 0.11 | 7m | 67% | **0m** | **1.05** | **363** | **STINGY — flat, no rest, monotone** |
| IPZZ-125 | 120 | 0.36 | 0m | 0% | 1m | 1.28 | 77 | Generated, low intensity |

### The Three Red Flags of Stingy

A script is stingy when ALL THREE are present:

1. **Low CV (< 0.15)** — mechanically uniform cycles, no micro-variation
2. **Flat Build (≈ 1.0)** — no escalation over time, same intensity start to finish
3. **Zero quiet windows** — no macro rest periods, relentless without breaks

VictoriaOaks stingy is the ONLY script with all three: CV=0.11, Build=1.05, Quiet=0.

Scripts with low CV that feel great compensate with:
- **Escalation** (Optikon Build=2.29, Euphoria2 Build=2.06) — the journey keeps changing
- **Rest periods** (Zer0 Game Quiet=14m, Euphoria2 Quiet=7m) — the body recovers
- **Both** (Zer0 Game: Build=2.40 + Quiet=14m)

### User-Described Experiences Match the Data

- **A Sinful XXX** — "exceptional, increases in intensity each section" → Build=1.61, CV=0.35
- **RoD** — "has me gasping, incredible edging build" → V=719, CV=0.36, Build=1.60
- **Euphoria2** — "slow and deliberate, hypnotic, clearly defined patterns" → V=259, CV=0.03, Build=2.06, Quiet=7m
- **Zer0 Game** — slow burn archetype → V=142, Build=2.40, Quiet=14m

## FOC vs Stereo Comparison

Analyzed Magik3 Pt1, Magik3 Pt2, and Zer0 Game with both FOC and stereo exports:

| Channel | FOC vs Stereo |
|---------|--------------|
| Alpha | **IDENTICAL** |
| Beta | **IDENTICAL** |
| Pulse frequency | **IDENTICAL** |
| Pulse rise time | **IDENTICAL** |
| Pulse width | **IDENTICAL** |
| **Volume** | **DIFFERENT** (action count and ranges differ) |
| Frequency | **IDENTICAL** |

**Finding:** The only difference between FOC and stereo is the volume channel,
which controls L/R intensity balance for dual-electrode setups. Our Stim tab
can use identical conversion for both; just generate different volume profiles.

## Next Steps

- [ ] Implement three-factor stingy detection (CV + Build + Quiet) in assessment
- [ ] Design "humanize" algorithm (vary cycle speed ±N% per cycle, target CV ~0.35)
- [ ] Raise estim speed clamp significantly — curated scripts run 500-700+ pos/s safely
- [ ] Add Build detection to assessment (escalation arc)
- [ ] Add quiet/rest detection to assessment (macro breaks)
- [ ] Generate different volume channels for FOC vs stereo export
- [ ] Analyze RoD alpha/beta channels vs our generated channels
- [ ] Research what restim's radial conversion does to velocity
- [ ] Consult edger/digit48 community for their comfort parameters
