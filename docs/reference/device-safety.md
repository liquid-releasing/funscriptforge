# Device Awareness

FunscriptForge ensures your funscript works within your target device's physical limits — and improves its *feel* regardless of device. Device awareness is applied once, globally, on the **Device tab** — before any creative decisions.

---

## Two things, not one

Device awareness does two distinct operations. They're independent and serve different purposes:

### 1. Groove (humanize) — improves feel for all devices

Many funscripts — especially auto-generated ones — have **mechanically uniform timing**: every cycle is exactly the same speed. The body adapts to uniform stimulus and stops responding. This is the "stingy" problem.

Groove adds **timing variation** to monotone sections by jittering action timestamps within each cycle. The positions don't change — only the *timing* between them. Some half-cycles become slightly faster, others slightly slower. The result is a script that feels like a live drummer instead of a drum machine.

Groove benefits **every device**, including estim. It's not a safety measure — it's a quality-of-life improvement for scripts that were authored (or generated) without variation.

The **Groove slider** controls how much variation: 0.0 = no change (mechanical), 0.35 = natural (like expert-crafted scripts), 0.50 = maximum variation.

### 2. Speed clamp — caps velocity for mechanical devices

Mechanical devices (The Handy, OSR2, etc.) have a physical speed ceiling. If the funscript asks the device to move faster than the motor can go, the device **skips** — it falls behind the commanded position and catches up later, producing jerky, unpredictable motion.

The speed clamp **reduces position magnitude** on actions that exceed the device's max speed. Timing is preserved; only the size of the movement is reduced. The result is a script that stays within the motor's capability at the cost of some amplitude in the fastest sections.

Estim devices generally **don't need speed clamping** because their "limit" is perceptual (how fast can sensation change before the user stops feeling it), not mechanical. The hardware can follow any rate the funscript asks for. FunscriptForge still shows the numbers so estim users can see where their script sits, but clamping is optional.

### When to use which

| Your devices | Groove? | Speed clamp? |
| --- | --- | --- |
| Estim only (FOC, Stereostim, etc.) | **Yes** — fixes stingy scripts | **Optional** — skip if you want the original feel |
| Mechanical only (Handy, OSR2) | **Yes** — improves feel | **Yes** — prevents device skipping |
| Both | **Yes** | **Yes for mechanical targets** — the clamping is driven by the most restrictive mechanical device |

### The clamping opt-out

When the script was authored for faster hardware (e.g., an estim-native script at 664 pos/s targeting a 400 pos/s Handy), clamping more than ~25% of the actions means the result is a fundamentally different script. FunscriptForge shows a warning and lets you **uncheck "Apply device-aware clamping"** to keep the original as-is. You can still accept and move forward — you're just telling FunscriptForge "I know this exceeds the device, I want the original."

---

## Device limits

Limits are stored in `forge/device_specs.json` and are community-refinable. See [Device Limits →](device-limits.md) for the full table with sources and confidence levels.

### Combined limits

When multiple devices are selected, the tightest constraint wins per parameter. The limits table on the Device tab shows which device is the bottleneck for each parameter.

---

## How it works

1. **Select your devices** on the Device tab
2. FunscriptForge computes the **combined limits** — the most restrictive device wins
3. A **limits table** shows the constraints and which device is the bottleneck
4. **Groove** adds timing variation to monotone sections (adjustable via slider)
5. **Speed clamp** caps actions that exceed the combined max speed
6. A **side-by-side preview** shows Original vs Device Aware
7. A **post-fix verification** shows how many actions were clamped, with a warning if the ratio is high
8. **Accept** applies the fix — or, if you unchecked clamping, saves the original as-is

---

## After device awareness

Everything downstream works on the device-aware baseline:

- **Tone tab** — shapes feel within device limits
- **Phrase editor** — creative transforms
- **Stim tab** — estim channel generation from the device-aware funscript
- **Export tab** — writes the final files to mechanical/ and estim/ subfolders

The user doesn't have to think about device limits after the Device tab — the constraint is baked in at the start.

---

## Vocabulary

FunscriptForge uses "device aware" and "awareness" — never "device safe". We consider device limits; we don't guarantee safety.

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
