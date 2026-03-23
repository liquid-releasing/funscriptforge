# Device Awareness

FunscriptForge ensures your funscript works within your target device's physical limits. Device awareness is applied once, globally, on the **Device tab** — before any creative decisions.

---

## How it works

1. **Select your devices** on the Device tab
2. FunscriptForge computes the **combined limits** — the most restrictive device wins
3. A **limits table** shows the constraints and which device is the bottleneck
4. The **minimum-fix algorithm** analyzes every action and clamps only what exceeds limits
5. A **side-by-side preview** shows Original vs Device Aware
6. **Accept** applies the fix globally — everything downstream is guaranteed to work

---

## Device limits

Limits are stored in `forge/device_specs.json` and are community-refinable:

| Device | Max speed | Max BPM | Max delta | Notes |
|---|---|---|---|---|
| The Handy | 400 pos/s | 120 | 100 | Linear stroker. Firmware-limited. |
| OSR2 | 500 pos/s | 150 | 100 | Multi-axis servo. Build-dependent. |
| Estim — FOC | 250 pos/s | 125 | 100 | Speed clamp for comfort (~125 BPM at full range). |
| Estim — Stereo | 250 pos/s | 125 | 100 | Same comfort limits as FOC. |
| Generic / Intiface | 300 pos/s | 100 | 100 | Conservative defaults for Bluetooth devices. |

### Two constraint types

- **Speed** (all devices) — max position change per second. For strokers, exceeding this causes skipping. For estim, fast cycles at full amplitude cause stingy sensation. The comfort limit for estim is ~125 BPM at full range.
- **Delta** — max position change between consecutive actions. Strokers have no delta limit (100 = full range). Estim delta is also 100 since the speed clamp handles the comfort constraint.

### Combined limits

When multiple devices are selected, the tightest constraint wins per parameter. The limits table shows which device is the bottleneck.

---

## Minimum-fix algorithm

The algorithm applies the **smallest correction needed**:

- Only modifies actions that violate limits
- Preserves timing and direction — only magnitude is reduced
- Delta clamp applied first, then speed clamp
- Reports percentage of original preserved

---

## Intensity spikes (estim only)

For estim users who want occasional sharp transitions, the **Intensity spikes** slider controls what percentage of cycles are allowed to keep their original full-range delta:

| Setting | Effect |
|---|---|
| **None** | All cycles clamped to comfort delta — smooth output |
| **Rare** (12.5%) | ~1 in 8 cycles may spike |
| **Moderate** (25%) | ~1 in 4 cycles may spike |
| **Frequent** (50%) | ~1 in 2 cycles may spike |

Spikes are placed randomly for unpredictability. The slider doesn't add intensity — it allows existing intensity in the funscript to pass through the clamp.

---

## After device awareness

Everything downstream works on the device-aware baseline:

- **Tone tab** — shapes feel within device limits
- **Phrase editor** — creative transforms, no device checkbox needed
- **Export** — per-device output folders (planned)

The user never has to think about device limits after the Device tab.

---

## Vocabulary

FunscriptForge uses "device aware" and "awareness" — never "device safe". We consider device limits; we don't guarantee safety.

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
