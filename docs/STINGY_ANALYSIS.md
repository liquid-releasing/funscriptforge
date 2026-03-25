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

## Next Steps

- [ ] Validate CV threshold (0.15) against more community scripts
- [ ] Implement CV measurement in assessment pipeline
- [ ] Design "humanize" algorithm (vary cycle speed ±N% per cycle)
- [ ] Analyze RoD alpha/beta channels vs our generated channels
- [ ] Research what restim's radial conversion does to velocity
- [ ] Consult edger/digit48 community for their comfort parameters
