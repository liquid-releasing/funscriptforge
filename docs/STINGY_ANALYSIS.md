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

## Next Steps

- [ ] Analyze RoD alpha/beta channels vs our generated channels
- [ ] Research what restim's radial conversion does to velocity
- [ ] Consider BPM + variation as the stingy metric instead of velocity
- [ ] Consult edger/digit48 community for their comfort parameters
- [ ] Re-evaluate device_specs.json thresholds based on findings
