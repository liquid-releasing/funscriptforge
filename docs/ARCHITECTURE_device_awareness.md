# Architecture: Device Awareness

## Overview

Device awareness ensures funscripts work within the physical limits of target
output devices. It applies once, globally, on the Device tab — before any
creative decisions (Tone, Phrases). Everything downstream is guaranteed to
work on the selected devices.

## Design Principle

**Device tab = engineering. Tone/Phrases = art.**

The user never has to think about device limits after the Device tab. Creative
transforms in Tone and Phrases work on the already-constrained baseline. No
double-constraining, no surprises at export.

## Device Specs

Device limits are stored in `forge/device_specs.json`:

```json
{
  "handy": {
    "type": "stroker",
    "max_speed": 400,        // position-units/sec
    "max_bpm": 120,          // beats per minute
    "min_cycle_ms": 250,     // minimum cycle duration
    "max_delta": 100,        // max position change per action (strokers: 100 = no limit)
    ...
  },
  "estim_foc": {
    "type": "estim",
    "max_speed": 1000,       // electrical signal — effectively unlimited
    "max_delta": 60,         // comfort limit: 50-70 typical for estim
    ...
  }
}
```

### Two constraint types

1. **Speed** (strokers) — max position change per second. The Handy physically
   can't move faster than ~400 pos/s. Exceeding this causes the device to skip
   or stall.

2. **Delta** (estim) — max position change between consecutive actions. Position
   maps to voltage/pulse width. A jump from 0→100 causes a sharp muscle
   contraction. Limiting delta to 50-70 smooths the waveform for comfort.
   Pulse frequency typically capped at 100-150 Hz.

### Combined limits

When multiple devices are selected, the system computes the **most restrictive**
limits across all devices. The tightest constraint wins:

```python
combined = DeviceSpec(
    max_speed = min(handy.max_speed, osr2.max_speed),
    max_delta = min(estim.max_delta, handy.max_delta),
    min_cycle_ms = max(handy.min_cycle_ms, osr2.min_cycle_ms),
    ...
)
```

## Minimum Fix Algorithm

The algorithm applies the smallest correction needed:

1. **Analyze** — scan all actions, identify which violate limits (speed or delta)
2. **Report** — show violation count, max values found, % already OK
3. **Fix** — only touch violating actions, preserve everything else
4. **Verify** — re-analyze to confirm zero violations

```
Checking 2,760 actions against Handy + Estim Stereo limits...
✅ 2,412 actions OK
⚠️ 214 speed violations (max 892 pos/s, limit 400)
⚠️ 134 delta violations (max 98, limit 60)
Applying minimum correction...
✅ Device aware — 87% of original preserved
```

### Fix strategy

For each violating action, clamp the position to stay within limits:

- **Delta clamp** (applied first): if `|pos[i] - pos[i-1]| > max_delta`,
  reduce to `pos[i-1] ± max_delta`
- **Speed clamp** (applied second): if `speed > max_speed`, reduce to
  `pos[i-1] ± max_speed * dt`

This preserves timing and direction — only the magnitude is reduced.

## Vocabulary

Always use "device aware" / "awareness". Never "device safe" — that implies
a guarantee we can't make. We consider device limits, we don't guarantee safety.

## Future: Community Device Specs

The JSON file is designed to be updated without code changes. Plan:
- Ship with conservative defaults
- Ask the community for real-world measurements
- Accept PRs to update device_specs.json
- Support user-defined devices (custom JSON in user config directory)

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
