# Installing FunscriptForge

> **Pre-release software.** Provided as-is, without warranty of any kind. Use at your own risk.

**FunscriptForge™** is a trademark of Liquid Releasing.

---

## System requirements

| | Minimum | Recommended |
| --- | --- | --- |
| OS | Windows 10 (64-bit, build 1903+) | Windows 10/11 |
| RAM | 4 GB | 8 GB or more |
| Display | 1920 × 1080 | 2560 × 1440 QHD |
| Runtime | [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11; the installer fetches it if missing) | — |
| Python | Not required — the backend is bundled | — |

> **Windows-first.** FunscriptForge is a Tauri desktop app. The current
> `v0.1.0-alpha` ships a Windows installer; macOS and Linux builds are a
> post-beta follow-up.

---

## Windows — Quick install

### 1. Download

Download the latest installer from the
[releases page](https://github.com/liquid-releasing/funscriptforge-releases/releases/latest).
Two formats are published:

- **`.msi`** — Windows Installer package
- **`.exe`** (NSIS) — a self-contained setup wizard

Either one installs the same app; pick whichever your environment prefers.

### 2. Install

Run the downloaded installer and follow the prompts.

- If Windows SmartScreen warns about an unrecognized publisher (the build is not
  yet code-signed), click **More info → Run anyway**.
- WebView2 is installed automatically if it is not already present.

### 3. Run

Launch **FunscriptForge** from the Start menu (or its desktop shortcut).

The app is fully self-contained: the Python backend (`forge-cli`) and a static
`ffmpeg` / `ffprobe` are bundled inside the install. No Python, pip, or separate
ffmpeg install is required, and no internet connection is needed after install.

### 4. Load a funscript

Use the **Library / Project** screen to open a `.funscript` file (and optional
media), or import an existing `.forge` bundle.

### Uninstall (Windows)

Uninstall **FunscriptForge** from **Settings → Apps → Installed apps** (or
Control Panel → Programs), the same as any other Windows program.

---

## macOS / Linux

macOS and Linux installers are a **post-beta follow-up** and are not yet
published. Until then, run from source on those platforms (Tauri dev build).
See [`docs/architecture/DEVELOPMENT.md`](architecture/DEVELOPMENT.md).

---

## SmartScreen / antivirus false positives

The alpha builds are not yet code-signed, so Windows SmartScreen or some
antivirus tools may warn about an unrecognized publisher. FunscriptForge is
open-source — you can inspect the full source code on GitHub.

- Click **More info → Run anyway** on the SmartScreen prompt, or
- Add an antivirus exception / submit the file to your vendor as a false positive.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Installer blocked by SmartScreen | Click **More info → Run anyway** (the alpha is not yet code-signed) |
| App window is blank on first launch | Ensure the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) is installed, then relaunch |
| Funscript file not loading | Open it from the **Library / Project** screen; use a full absolute path if typing one |
| Analyze / media features fail | The bundled `ffmpeg` should resolve automatically; reinstall if the bundle is incomplete |
| App crashes on startup | Check that you have at least 4 GB RAM free; close other heavy apps |

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).*
