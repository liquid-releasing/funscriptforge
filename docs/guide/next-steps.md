# Next Steps

The Next Steps tab appears after export. It shows device-specific playback instructions, project summary, credits, and community links.

---

## Your Project summary

Four metrics summarize what you built:

| Metric | What it shows |
|--------|--------------|
| **Devices** | Which devices you selected (e.g., "handy, stereostim") |
| **Tone** | The tone you applied (e.g., "Tease") |
| **Groove** | Your groove setting from the Device tab (e.g., "0.35") |
| **Status** | "Exported" or "In progress" |

---

## Playback Guide

Expandable sections show step-by-step instructions for each device you selected. Only relevant guides appear — if you only selected mechanical devices, you won't see estim guides.

### The Handy

1. Connect your Handy to Wi-Fi and pair it at **handyfeeling.com**
2. Upload your exported `.funscript` to **handyfeeling.com/upload**
3. Load the matching video in the web player or use **ScriptPlayer**
4. Press play — the Handy syncs automatically

### OSR2 / SR6

1. Connect your OSR2/SR6 via USB or Bluetooth
2. Open **MultiFunPlayer** and load the exported `.funscript`
3. Load the matching video in your preferred player
4. Sync and play

### E-Stim — Audio Devices (2b, 312, Tingler, EstimHero, ZC95)

FunscriptForge exports **stereo WAV audio files** ready to play on audio-based estim devices.

1. Find the `.wav` files in your `estim/` export folder
2. Connect your estim device to your computer's audio output
3. Play the WAV file using any media player (VLC, foobar2000, etc.)
4. Sync with your video using **MultiFunPlayer** or **ScriptPlayer**

Two WAV files match two device families:
- **`.legacy.wav`** — continuous sine carrier for 2b, 312, and similar legacy devices
- **`.stereostim.wav`** — pulse train for Tingler, EstimHero, ZC95, and similar modern devices

The audio file IS the stimulation signal — your device amplifies it directly. No additional software required.

### E-Stim — Protocol Devices (FOC-Stim, NeoStim)

FOC-Stim and NeoStim generate stimulation signals internally from commands sent over serial/USB. They do not use audio files.

1. Download **Restim** from [github.com/diglet48/restim](https://github.com/diglet48/restim/releases)
2. Open Restim and load the channel funscripts from your `estim/` folder
3. Connect your FOC-Stim or NeoStim device
4. Configure your device type in Restim's device wizard
5. Start playback — Restim sends real-time commands to your device

The exported `.alpha.funscript` and `.beta.funscript` files contain the position data Restim needs.

---

## Coming Soon

The Next Steps tab also previews upcoming tools:

- **ForgePlayer** — play funscripts directly on your devices with real-time visualization, tone, and groove. No editing required.

Automatic generation from audio and video — beat detection and scene
analysis — is no longer a separate tool to wait for. It is built in: see
the **Generate** tab, covered in
[Generating Funscripts](generating-funscripts.md).

---

## Community

- [Discord](https://discord.gg/UHdJFhEZF) — feedback, feature requests, sharing
- [GitHub](https://github.com/liquid-releasing/funscriptforge) — issues, contributions

---

## Credits & Attribution

The Next Steps tab displays full credits for the open-source projects FunscriptForge builds on:

- **funscript-tools** by Edger — tone transforms, waveform shaping, eTransform algorithms
- **restim** by Diglet48 — 3-phase synthesis math for audio rendering (MIT license)
- **Tauri**, **React**, **Vite**, **Python**, **ffmpeg**
- **forgemoment** / **forge-ui-components** — shared component libraries

---

## License

FunscriptForge is a trademark of Liquid Releasing.
Licensed under the MIT License.
The `.funscript` file format is a community standard not owned by Liquid Releasing.

---

## Related

- [Export](export.md) — what gets written to disk
- [Glossary](../reference/glossary.md) — device types, channel files, audio synthesis terms
