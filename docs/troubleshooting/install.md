# Troubleshooting — Installing FunscriptForge

Find your situation below. Each question is written the way you might actually
think it — not the way a manual would phrase it.

---

## The app won't open at all

*You might be searching for: "FunscriptForge won't start", "nothing happens when I double-click",
"app doesn't launch"*

**Windows** — run the installer (`FunscriptForge-Setup-windows.exe`) rather
than trying to run anything from inside the download. Once installed, launch it
from the Start menu. If SmartScreen blocked the installer, see below.

**macOS** — you must approve the app on first launch. Right-click → **Open** →
**Open** in the dialog. Skipping this means Gatekeeper blocks it silently.

**Linux** — an AppImage needs the executable bit:

```bash
chmod +x FunscriptForge-linux-x86_64.AppImage
./FunscriptForge-linux-x86_64.AppImage
```

---

## The window opens but stays blank or white

*You might be searching for: "white screen", "blank window", "empty app window"*

FunscriptForge draws its interface with the system web view, and a blank window
usually means that component is missing or out of date.

**Windows** — the app needs **WebView2**. Windows 11 and current Windows 10
include it, and the installer adds it if missing, but a locked-down or offline
machine can end up without it. Install the
[Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
and relaunch.

**Linux** — install WebKitGTK:

```bash
sudo apt install libwebkit2gtk-4.1-0
```

---

## macOS says the app is damaged and can't be opened

*You might be searching for: "app is damaged", "can't be opened because Apple cannot check it",
"move to trash"*

This is a macOS quarantine flag, not actual damage — the app is not
code-signed. Open Terminal and run:

```bash
xattr -cr /Applications/FunscriptForge.app
```

Then try launching again. If you installed it elsewhere, use that path instead.

---

## macOS says it can't be opened on this Mac

*You might be searching for: "not supported on this Mac", "Intel Mac", "x86 macOS"*

The macOS build is **Apple Silicon only** (M1 or later). There is no Intel
build. On an Intel Mac, use the Windows or Linux build instead.

---

## Windows Defender or my antivirus is blocking it

*You might be searching for: "antivirus blocking FunscriptForge", "Windows Defender flagged it",
"virus warning", "false positive", "unknown publisher"*

Two separate things can happen.

**SmartScreen: "Windows protected your PC"** — the installer is not
code-signed, so Windows does not recognise the publisher. Choose **More info →
Run anyway** if you are happy to proceed.

**Antivirus heuristics** — the app bundles a packaged Python toolchain, which
some scanners flag on shape rather than content. Add the install folder as an
exception, or temporarily disable real-time protection for the install.

FunscriptForge is open-source; you can read the source before running it.

---

## The app opens but crashes or freezes immediately

*You might be searching for: "FunscriptForge crashes on startup", "app freezes",
"app is unresponsive"*

Check you have at least 4 GB of RAM free and close other heavy applications
(browsers with many tabs, video editors, games), then try again.

If it reproduces every time, that is worth reporting — include your OS, the
version from the title bar, and what you were opening.

---

## The first analysis takes a long time

*You might be searching for: "FunscriptForge slow", "takes forever", "stuck analyzing"*

The first analysis of a project is genuinely slow: it decodes the audio, finds
chapters and beats, and builds several caches. Progress streams in the footer —
if steps are still ticking over, it is working.

Later opens of the same project reuse those caches and are much faster.

---

## Do I need Python or ffmpeg installed?

No. The installers bundle everything, including ffmpeg. If you had an older
version that asked for Python, that is no longer how it ships.

---

## My question isn't here

Open an issue on
[GitHub](https://github.com/liquid-releasing/funscriptforge/issues) — include
your OS and the version shown in the title bar. If it is a question others are
likely to hit, it will be added to this page.

---

← [Back to: Install FunscriptForge](../getting-started/install.md)
