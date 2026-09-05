# Install FunscriptForge

FunscriptForge is a desktop app. Download an installer, run it, and it opens in
its own window — there is no server to start, no browser tab, and no Python to
install.

---

## System requirements

| | |
|---|---|
| **Windows** | Windows 10 or 11 (64-bit). WebView2 is included with Windows 11 and current Windows 10; the installer adds it if missing. |
| **macOS** | Apple Silicon (M1 or later). There is no Intel build yet. |
| **Linux** | x86-64, with a desktop environment. `.deb` for Debian/Ubuntu, `.AppImage` elsewhere. |
| **Disk** | ~1 GB installed. FunscriptForge bundles its own ffmpeg, so you do not need to install one. |

Everything the app needs is inside the installer. You do not need Python,
ffmpeg, or any command-line tools.

---

## Download

Downloads are on the **[funscriptforge.com](https://funscriptforge.com)** front
page, or directly from the
[releases page](https://github.com/liquid-releasing/funscriptforge-releases/releases).

| OS | File |
|---|---|
| Windows 10 / 11 | `FunscriptForge-Setup-windows.exe` (or `.msi` for managed installs) |
| macOS (Apple Silicon) | `FunscriptForge-macos-arm64.dmg` |
| Debian / Ubuntu | `FunscriptForge-linux-amd64.deb` |
| Other Linux | `FunscriptForge-linux-x86_64.AppImage` |

The installers are large (~250–350 MB) because the app ships its own ffmpeg and
analysis toolchain rather than asking you to install them.

---

## Install

=== "Windows"

    1. Run **`FunscriptForge-Setup-windows.exe`**
    2. Windows SmartScreen may warn that the publisher is unknown — the app is
       not code-signed yet. Choose **More info → Run anyway** if you are happy
       to proceed.
    3. Launch **FunscriptForge** from the Start menu

    Prefer `.msi` if you are deploying through management tooling; the `.exe`
    is the normal choice.

    **Uninstall:** Settings → Apps → FunscriptForge → Uninstall.

=== "macOS"

    1. Open **`FunscriptForge-macos-arm64.dmg`**
    2. Drag **FunscriptForge** to your Applications folder

    **First launch only:** macOS blocks unsigned apps by default.

    - Right-click (or Control-click) **FunscriptForge** → **Open**
    - Click **Open** in the security dialog

    After this one-time approval you can double-click normally.

    ??? warning "macOS says the app is damaged"
        Open Terminal and run:
        ```bash
        xattr -cr /Applications/FunscriptForge.app
        ```
        Then try launching again. This clears the quarantine flag macOS applies
        to downloaded apps.

    **Uninstall:** Drag to Trash.

=== "Linux"

    **Debian / Ubuntu:**
    ```bash
    sudo apt install ./FunscriptForge-linux-amd64.deb
    ```

    **Anything else:**
    ```bash
    chmod +x FunscriptForge-linux-x86_64.AppImage
    ./FunscriptForge-linux-x86_64.AppImage
    ```

    The app uses WebKitGTK. On a minimal system you may need:
    ```bash
    sudo apt install libwebkit2gtk-4.1-0
    ```

    **Uninstall:** `sudo apt remove funscriptforge`, or delete the AppImage.

---

## Confirm it worked

The app opens in its own window with a row of tabs across the top — **Library**,
**Project**, **Generate**, **Analysis**, and the rest of the chain through to
**Export**. The version is shown in the title bar.

If you see that, you are done.

---

## Try it immediately — no funscript needed

You do not need your own material to look around. On the **Project** tab's empty
state, choose **Load sample** to open a synthetic *Big Buck Bunny* project
(9:55) and see the full app with real structure in it.

Two example funscripts also ship in the `demo/` folder next to the app:

| File | What it shows |
| --- | --- |
| `big_buck_bunny.raw.funscript` | A deliberately rough script — every behavioral tag category represented. |
| `big_buck_bunny.forged.funscript` | The same script after forging — each issue corrected. |

!!! tip "Want the video too?"
    Download Big Buck Bunny from the
    [Blender Foundation](https://download.blender.org/demo/movies/BBB/) or
    [Internet Archive](https://archive.org/details/BigBuckBunny_124) and put it
    beside the funscripts. FunscriptForge pairs media with a script by name.

---

## A note on alpha builds

FunscriptForge is pre-release software. Releases are marked *alpha*, ship
without code signing, and change quickly. It never modifies your original
files — everything it produces is written alongside them — but treat your
source scripts as the copy that matters.

---

## Something not working?

[Troubleshoot installation →](../troubleshooting/install.md)

---

## Next step

[Forge your first funscript →](forge-your-first-funscript.md)
