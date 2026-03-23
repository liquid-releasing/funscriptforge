# Architecture: Device Awareness

## Overview

Device awareness ensures funscripts work within the physical limits of target
output devices. It applies once, globally, on the **Device tab** — before any
creative decisions (Tone, Phrases). Everything downstream is guaranteed to
work on the selected devices.

## Design Principle

**Device tab = engineering (what the device CAN do).**
**Tone/Phrases = art (what the user WANTS).**

The user never has to think about device limits after the Device tab. Creative
transforms in Tone and Phrases work on the already-constrained baseline.

## Stingy = Speed, Not Delta

The key insight for estim: stingy sensation comes from **fast cycles at full
amplitude**, not from large position jumps per se. A 0→100 jump at 60 BPM is
comfortable. The same jump at 250 BPM burns.

- **Estim comfort limit**: ~125 BPM at full range (0-100)
- **PythonDancer** optimizes to 250 BPM — 2x too fast for long sessions
- **Our approach**: speed-clamp the original pattern, preserving the musical DNA
- PythonDancer rebuilds from scratch → loses original structure
- FunScriptForge clamps → same beat, different intensity ceiling

## Device Specs

Limits are stored in `forge/device_specs.json`:

| Device | Max speed | Max BPM | Max delta | Key constraint |
|---|---|---|---|---|
| The Handy | 400 pos/s | 120 | 100 | Speed (mechanical) |
| OSR2 | 500 pos/s | 150 | 100 | Speed (mechanical) |
| Estim — FOC | 250 pos/s | 125 | 100 | Speed (comfort, not hardware) |
| Estim — Stereo | 250 pos/s | 125 | 100 | Speed (comfort, not hardware) |
| Generic / Intiface | 300 pos/s | 100 | 100 | Speed (conservative) |

### Combined limits

When multiple devices are selected, the tightest constraint wins per parameter.
The limits table on the Device tab shows which device is the bottleneck.

## Minimum Fix Algorithm

1. **Analyze** — scan all actions, identify speed and delta violations
2. **Report** — violation count, max values found, % already OK
3. **Fix** — delta clamp first, then speed clamp. Only touch violating actions.
4. **Stats** — report actions clamped, spike cycles, total cycles

Returns `(fixed_actions, fix_stats)` tuple.

## Intensity Spikes (estim only)

Allows a percentage of cycles to keep their original full-speed intensity
through the clamp. Not adding spikes — allowing existing intensity to survive.

| Setting | Effect |
|---|---|
| **None** | All cycles clamped — smooth output |
| **⅛ Rare** | ~1 in 8 cycles unclamped |
| **¼ Moderate** | ~1 in 4 cycles unclamped |
| **½ Frequent** | ~1 in 2 cycles unclamped |

Random placement via seed for reproducibility. Spike cycles skip both delta
and speed clamps.

## Re-clamp After Transforms

**Every transform that modifies positions must re-clamp to device limits.**

Currently implemented:
- ✅ Device tab Accept (initial clamp)
- ✅ Tone tab preview + Accept (re-clamp after tone)

TODO:
- Phrase editor transforms
- Pattern editor transforms

The `_reclamp_to_device_limits()` helper reads selected devices + spike
setting from the forge project and applies the same clamp.

## CLI

```bash
python cli.py device-aware input.funscript --devices estim_foc --spikes 0.125
```

## Vocabulary

Always "device aware" / "awareness". Never "device safe" — liability concern.

## Shared Library (planned)

Extract `device_specs.py` + `device_specs.json` to a shared location for reuse
across FunScriptForge, ForgePlayer, SyncPlayer, and forgegen. Any app that
plays or generates funscripts needs device awareness.

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
