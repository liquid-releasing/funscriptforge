# Device Safety

FunscriptForge exports two separate files for two different use cases. Understanding the difference protects your device and ensures the best experience on your hardware.

---

## The two outputs

| | Device | Estim |
| --- | --- | --- |
| **File** | `.device.funscript` | `.estim.funscript` |
| **Target** | Mechanical devices | Electrostim devices |
| **Velocity cap** | 200 pos/s | None |
| **Quality gate** | Yes | No |
| **Use with** | MultiFunPlayer, Intiface, ScriptPlayer | funscript-tools, Restim |

---

## Mechanical devices

Mechanical devices — the Handy, OSR2, SR6, and similar — move a physical actuator. That actuator has a maximum speed it can follow reliably. Commanding it faster than it can move causes:

- **Skipping** — the device falls behind and snaps to catch up, producing a jarring jump
- **Mechanical strain** — repeated high-velocity commands accelerate wear
- **At extreme velocities** — potential damage to the drive mechanism

The safe limit for most mechanical devices is **200 pos/s**. FunscriptForge caps the device output at this value.

### What the cap does

The velocity cap smooths any action pair where the velocity between them exceeds 200 pos/s. The timestamps are preserved; the positions are adjusted to bring the velocity within limit.

This is applied at export time to the Device output only. Your original funscript and your Estim output are not affected.

### Quality gate

Before you download the Device output, the quality gate checks every action:

| Severity | Condition | What it means |
| --- | --- | --- |
| ⚠ Warning | Velocity > 200 pos/s | Approaching device limits |
| ✗ Error | Velocity > 300 pos/s | Likely to cause skipping or damage |
| ⚠ Warning | Action interval < 50 ms | Actions too close together for reliable execution |

Each issue shows a timestamp so you can find the phrase in the editor and fix it at the source, rather than relying on the cap alone.

---

## Electrostim devices

Electrostim devices — Mk312, 2B, ET312, and others — do not have a physical actuator that can be overstressed by high velocity. The funscript waveform is converted into electrical signal parameters (channel levels, pulse width, frequency) by tools like [funscript-tools](https://github.com/edger477/funscript-tools).

For estim, **the full waveform matters**. Peaks, transitions, and high-velocity sections in the funscript translate to signal intensity characteristics. Capping or smoothing the waveform before it reaches funscript-tools would alter the electrical output in unintended ways.

The Estim output is therefore clean — no velocity cap, no quality gate, no safety smoothing beyond what you have explicitly applied with transforms.

### Workflow with funscript-tools

1. Export `.estim.funscript` from FunscriptForge
2. Load into [funscript-tools](https://github.com/edger477/funscript-tools)
3. funscript-tools generates per-channel files: alpha, beta, pulse, volume
4. Route to your estim box

---

## Device safety in the Phrase Editor

The **Device safety** checkbox in the Phrase Editor applies the 200 pos/s velocity cap to the **preview chart only**. This lets you see what the Device output will look like while editing — so you can judge whether a transform is producing device-safe motion before you accept it.

The checkbox does not affect your export. The cap is always applied at export time to the Device output regardless of this setting.

---

## Per-device guidance

| Device | Max reliable BPM | Notes |
| --- | --- | --- |
| The Handy | ~200 BPM | Firmware and stroke length dependent |
| OSR2 | ~200 BPM | Servo-limited; higher stroke lengths reduce max speed |
| SR6 | ~150 BPM | Multi-axis; each axis has independent limits |
| Launch | ~150 BPM | Older motor; conservative limit |

These are general guidelines. Your specific device, firmware version, and stroke length settings affect the actual safe limit. When in doubt, use the quality gate and check for warnings before playing.

---

## Related

- [Export →](../guide/export.md) — the full export workflow
- [Transforms — Performance →](../guide/transforms.md#performance) — the transform specifically designed for high-velocity phrases
- [Transforms — Halve Tempo →](../guide/transforms.md#halve-tempo) — the primary fix for frantic (> 200 BPM) phrases
