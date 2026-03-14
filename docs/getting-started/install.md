# Install FunscriptForge

FunscriptForge is a standalone app — no Python, no dependencies, no installer. Download, extract, and run.

---

## System requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10, macOS 10.15, Ubuntu 24.04 (x86-64) | Windows 11, macOS 14, Ubuntu 24.04 |
| **RAM** | 4 GB | 8 GB |
| **Display** | 1366×768 | 1920×1080 or higher |
| **Browser** | Chrome, Edge, Firefox, Safari | Chrome or Edge |

Python is **not required**. FunscriptForge bundles everything it needs.

---

## Download

Go to the [Releases page](https://github.com/liquid-releasing/funscriptforge/releases) and download the file for your OS:

| OS | File |
|---|---|
| Windows 10 / 11 | `FunscriptForge-windows.zip` |
| macOS | `FunscriptForge-macos.zip` |
| Linux (x86-64) | `FunscriptForge-linux.tar.gz` |

<!-- SCREENSHOT: GitHub Releases page showing the three download assets highlighted. Caption: "Download the file for your operating system from the Releases page." -->

---

## Install

=== "Windows"

    1. Right-click `FunscriptForge-windows.zip` → **Extract All…**
    2. Choose a folder — Desktop, Documents, or `C:\Program Files\FunscriptForge\`
    3. Double-click **FunscriptForge.exe** inside the extracted folder

    A terminal window may flash briefly — that is normal. Your browser opens automatically.

    **Uninstall:** Delete the folder.

=== "macOS"

    1. Double-click `FunscriptForge-macos.zip` to extract
    2. Drag **FunscriptForge.app** to your Applications folder

    **First launch only:** macOS blocks unsigned apps by default.

    - Right-click (or Control-click) **FunscriptForge.app** → **Open**
    - Click **Open** in the security dialog

    After this one-time approval you can double-click normally.

    ??? warning "macOS says the app is damaged"
        Open Terminal and run:
        ```bash
        xattr -cr /Applications/FunscriptForge.app
        ```
        Then try launching again. This removes the quarantine flag macOS applies to downloaded apps.

    **Uninstall:** Drag to Trash.

=== "Linux"

    ```bash
    tar -xzf FunscriptForge-linux.tar.gz
    cd FunscriptForge
    ./FunscriptForge
    ```

    If your browser does not open automatically, go to `http://localhost:6789`.

    **WSL2 on Windows 11:** Same process. `xdg-open` routes to your Windows default browser automatically.

    **Missing ffmpeg:** The media player requires ffprobe. Install it with:
    ```bash
    sudo apt install ffmpeg
    ```

    **Uninstall:** Delete the folder.

---

## Confirm it worked

Within 5–10 seconds your browser should open to `http://localhost:6789` showing the FunscriptForge interface — a sidebar on the left and a chart area on the right.

<!-- SCREENSHOT: The app open in browser, empty state — sidebar visible with file path input, main area showing "No funscript loaded" or blank chart. Caption: "FunscriptForge running in your browser. The sidebar is on the left; the chart area fills the rest." -->

If you see this, you are done.

!!! tip "Bookmark it"
    `http://localhost:6789` is always the address. Bookmark it for quick access after the first launch.

---

## Try it immediately — no funscript needed

FunscriptForge ships with two example funscripts based on Big Buck Bunny (9:56), a free
open-source film by the Blender Foundation. They appear in the sidebar dropdown marked
with 📋 — no path to paste, no file to find.

| File | What it shows |
| --- | --- |
| 📋 `big_buck_bunny.raw.funscript` | A deliberately broken script — all 8 behavioral problems present across 16 phrases. |
| 📋 `big_buck_bunny.forged.funscript` | The same script after forging — each issue corrected. |

Select either one from the sidebar to load it instantly and see the full app in action.

!!! tip "Want the video too?"
    Download Big Buck Bunny from the
    [Blender Foundation](https://download.blender.org/demo/movies/BBB/) or
    [Internet Archive](https://archive.org/details/BigBuckBunny_124) and place it
    in the `demo/` folder next to the funscripts. The media player detects it automatically.

---

## Keeping it running

FunscriptForge runs in the background as long as the launcher window is open. Close the terminal or launcher to shut it down.

---

## Something not working?

[Troubleshoot installation →](../troubleshooting/install.md)

---

## Next step

[Forge your first funscript →](forge-your-first-funscript.md)
