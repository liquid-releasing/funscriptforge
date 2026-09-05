# Device Awareness

FunscriptForge ensures your funscript works within your target device's
physical limits — and improves its *feel* regardless of device.

**Where this happens: the Polish tab.** Device awareness used to be a single
global pass applied up front, before any creative decisions. It is now applied
**per device, at the end**: each Polish station clamps the finished motion to
what that particular hardware can do, so a Handy file and an OSSM file are each
correct for their own device rather than both being limited by whichever is
tightest.

You can therefore shape freely in the editing tabs without thinking about
limits — Polish is what renders for a device, and it is what enforces them.

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

`combined_limits()` still exists for the case where one output has to satisfy
several devices at once: the tightest constraint wins per parameter. Per-station
Polish is the normal path, and it avoids that compromise entirely — each station
is clamped only by its own device.

---

## How it works

1. You author freely — Analysis, Chapters, Phrases, Events, Channels. No
   device limits apply yet, because nothing has been rendered for a device.
2. **Polish** shows one station per device. Each carries that device's limits
   from `forge/device_specs.json`.
3. Stamping a station clamps the motion to that device and writes its files.
   The bench preview shows the effect before you commit.
4. **Skipping Polish accepts the defaults** — every station is still generated,
   each clamped for its own device.
5. **Export** collects the stamped or generated files, one folder per device.

**Groove** is no longer a step here. Timing variation is a parameter of the
**Tame** transform, which you apply where you are editing rather than globally
up front.

---

## After device awareness

Everything downstream works on the device-aware baseline:

- **Phrases / Stanzas / Events** — creative transforms, no device limits applied
- **Channels** — assign a Character per chapter; the e-stim set is generated from these
- **Polish** — per-device stations; this is where limits are enforced
- **Export** — writes the final files, one folder per device

The user does not have to think about device limits while editing, because the
constraint is applied at the point a file is actually rendered for a device.

---

## Vocabulary

FunscriptForge uses "device aware" and "awareness" — never "device safe". We consider device limits; we don't guarantee safety.

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the MIT License.*
