# FunscriptForge — Desktop App Design

> **Status**: Ready to build. Audio PR shipped (extracted module — path B, as planned).
> **Order**: docs done. Desktop app is the next alpha blocker.
> **Owner**: `lqr`
> **Captured**: 2026-04-11. Updated 2026-04-14.

## Why we want this

FunscriptForge today is a Streamlit app that runs in a browser. That's
fine for development but is the wrong shape for the people we're trying
to reach: hobbyists who want a tool, not a stack.

The browser sandbox creates problems we can't fix in Streamlit:

- **No real disk paths.** Drag-and-drop and file pickers strip the
  source path. Exports land in `tempfile.mkdtemp()` and the user can't
  find them later. (Hit this in user testing 2026-04-11.)
- **No native OS file picker.** "Open file…" requires a desktop dialog,
  not a browser one.
- **Localhost URL exposure.** Users have to know about ports, browser
  tabs, "is the server still running?", and the uvicorn lifecycle.
- **No app icon, no taskbar entry, no double-click-to-open.** It's a
  webpage pretending to be an app.

Shipping as a desktop app makes the entire class of problems disappear.
The user double-clicks an icon, the app opens in its own window, file
pickers return real paths, and they never learn what Streamlit is.

> "We are lowering the barrier to entry to those who want to live their
> lives and never knowing about github." — user, 2026-04-11

## Three runtime options considered

| | PyWebView | Tauri | Electron |
|---|---|---|---|
| Wrapper language | Python | Rust | JavaScript |
| App code language | Python (Streamlit unchanged) | Python via sidecar (Streamlit unchanged) | JavaScript (rewrite) |
| Bundle size | ~250–400 MB | ~30–80 MB | ~150 MB minimum |
| Startup time | ~2 s (one-folder) | <1 s | ~3 s |
| Native feel | Good | Best | Worst (most bloated) |
| Cross-platform | Yes (mac/linux/win) | Yes | Yes |
| Effort from today | Smallest — wraps existing Streamlit code as-is | Medium — Tauri shell + Python sidecar | Large — would mean rewriting the UI |
| **Verdict** | **First ship** | **Phase 2 if size matters** | Skip |

**Decision: PyWebView at first ship.** Smallest jump from where we are,
keeps 100% of the Streamlit code, single-language stack stays Python.
Tauri is the long-term polish answer if binary size becomes a real
complaint.

## What ships in the bundle

The desktop app needs more than just FunscriptForge code. It bundles:

1. **FunscriptForge itself** — `ui/streamlit/`, `forge/`, all dependencies
2. **funscript-tools** — pinned to a specific commit, vendored into the
   bundle. Today the adapter expects a sibling clone at `../funscript-tools`;
   the desktop bundle resolves the same import path differently
   (see "funscript-tools as a library" section below).
3. **restim audio synthesis bits** — only the parts we need to produce
   the two audio files (device audio + prostate audio). NOT the full
   restim player, NOT the multi-device routing, NOT the GUI. Just the
   audio synthesis function call from the audio PR.
4. **forge-ui-components** — already an editable install in dev, frozen
   into the bundle at build time
5. **Python runtime** — embedded by PyInstaller, no system Python required
6. **Numpy / matplotlib / streamlit / pyav stack** — the heavyweights

A minimal `desktop.py` launcher (~40 lines) starts Streamlit on a free
port in a background thread, waits for the port to respond, opens a
PyWebView window pointed at that URL, and tears down Streamlit when the
window closes.

The Streamlit app code is **unchanged**. PyWebView is the chrome around
it; FunscriptForge doesn't know it's running inside a desktop wrapper.

## funscript-tools as a library (related, separate PR)

Today `forge.funscript_tools` is an adapter module that imports from a
sibling clone at `../funscript-tools`. This works on a dev machine but
breaks inside a PyInstaller bundle, which has no concept of "sibling repo."

Two ways to fix it for the desktop app:

- **(a) Vendor it.** Copy `funscript-tools/` *into* the bundle at build
  time and adjust the adapter to look up the bundled location. Pinned
  per release. Simple, no upstream changes.
- **(b) Publish it as a PyPI package.** Separate `funscript-tools` from
  its CLI, add proper packaging metadata, publish to PyPI, FunscriptForge
  installs it like any other dep. Forces a stable API. Requires upstream
  changes and a packaging account.

**Choice for desktop ship: (a) vendor.** Lower effort, ships faster,
unblocks the desktop app. Capture (b) as a follow-up — it's the right
long-term shape but doesn't have to land in the same PR.

## Restim audio bits (related, separate PR)

Even more aggressive than funscript-tools vendoring: we don't want to
ship the whole restim repo, only the audio synthesis function we need
to produce the two audio files (device + prostate).

The audio PR plan in `memory/project_funscriptforge_audio.md` has three
integration paths considered. The one most compatible with the desktop
app is **B — extract audio synthesis into a FunscriptForge module** —
because the extracted module is small, stable, has no native deps the
PyInstaller bundle doesn't already have, and doesn't require the user
to run a separate restim install.

So the audio PR and the desktop app are coupled: doing the audio PR with
path B *also* solves the "how do we ship audio in a desktop bundle"
problem. Doing the audio PR with path A or C means a lot of extra work
to make audio happen inside the desktop bundle later.

**Recommendation**: when we plan the audio PR, let the desktop-app
constraint nudge us toward path B (extracted module).

## File layout

```text
funscript-updater/
  desktop.py                       ← NEW. Launcher: starts Streamlit, opens window
  FunscriptForge.spec              ← NEW. PyInstaller config
  requirements-desktop.txt         ← NEW. pywebview, pyinstaller (dev/build only)
  build/                           ← gitignored. PyInstaller working dir
  dist/                            ← gitignored. PyInstaller output
    FunscriptForge/                ← One-folder bundle
      FunscriptForge.exe           ← The launcher binary
      _internal/                   ← Python runtime + all deps
        forge/                     ← FunscriptForge code
        ui/                        ← Streamlit UI
        funscript_tools/           ← Vendored, pinned
        forge_estim_audio/         ← Vendored audio synthesis (post-audio-PR)
        ...
      assets/                      ← Icon, splash, anything user-visible
  internal/design/desktop_app.md   ← THIS FILE
```

## CI / release flow

Today `funscriptforge-releases` is the GitHub repo we use to host
release artifacts. Adding desktop builds is incremental:

1. **First release** — manual. Build locally with `pyinstaller`,
   `zip dist/FunscriptForge`, drag the zip into a GitHub release on
   `funscriptforge-releases`. Smallest possible first ship.
2. **Once that works** — add a GitHub Actions workflow at
   `.github/workflows/release-desktop.yml` that:
   - Triggers on `v*` tags
   - Runs PyInstaller on Windows / macOS / Linux runners (matrix build)
   - Attaches the resulting zip per platform to the GitHub release
3. **Optional** — code signing (Windows + macOS). ~$300/yr each. Defer
   until a real user complains about SmartScreen/Gatekeeper warnings.

The macOS / Linux story is reportedly already partially debugged (per
the user). The remaining piece is the **distribution webpage** —
funscriptforge-releases needs a real download page, not just a list of
GitHub release artifacts. Captured as a separate gap.

## Open questions

1. **Funscript-tools version pinning policy.** Pin to a specific commit
   on every desktop release? Or pin to a tag? The latter requires
   funscript-tools to start tagging.
2. **Auto-update.** PyInstaller bundles don't auto-update. Either ship
   as a `.exe` and let users re-download each version, or add an in-app
   update check. The former is simpler; the latter is friendlier.
   **Recommendation**: re-download for v1, in-app check for v2.
3. **One-folder vs one-file**. One-folder unpacks at build time (~2s
   startup), one-file unpacks every launch (~10s startup). One-file is
   prettier (single `.exe`) but slower. **Recommendation**: one-folder.
4. **Code signing.** Defer. SmartScreen will warn on first launch but
   the user can click through.
5. **Distribution webpage**. Out of scope for this doc, captured as a
   separate gap.

## What ships in the v1 desktop app

Smallest valuable shape:

- ✅ PyWebView window pointing at embedded Streamlit
- ✅ Vendored funscript-tools (pinned)
- ✅ Vendored audio synthesis bits (depends on audio PR landing first)
- ✅ Native OS file picker (replaces drag-and-drop temp-folder mess)
- ✅ App icon, taskbar entry, double-click to open
- ✅ Single zip per platform on funscriptforge-releases
- ❌ Auto-update — defer to v2
- ❌ Code signing — defer until user complaint
- ❌ One-file mode — defer (one-folder is fine)
- ❌ Distribution webpage — separate gap

## Sequencing

The audio PR and desktop PR are coupled. Recommended order:

1. **Audio PR** with extracted audio synthesis module (path B from
   the audio plan), so the audio code is small, stable, and bundleable.
2. **Desktop app PR** that wraps everything, vendors funscript-tools,
   bundles the audio module, and ships the first `.exe`.
3. **Library PR** (later, optional) — publish funscript-tools as a real
   PyPI package so it doesn't have to be vendored. Cleans up the
   dependency story but doesn't block anything.

## Why we're writing this *now* and not in two weeks

The user testing session today surfaced the disk-path problem (browser
sandbox strips paths → exports land in temp). We came very close to
spending a day adding tkinter file pickers as a workaround. Capturing
the desktop-app plan now means we don't waste effort on browser
workarounds for problems that go away when we wrap the app properly.

## Build plan — concrete steps (2026-04-14)

### Phase 1: Local Windows build (~half day)

Goal: a working `.exe` on the dev machine. Prove the launcher pattern,
catch dependency issues, validate the user experience.

1. **Add dev dependencies** to a new `requirements-desktop.txt`:
   - `pywebview` — desktop wrapper
   - `pyinstaller` — bundler
2. **Write `desktop.py`** — the launcher. Pseudocode:
   ```python
   import socket, subprocess, sys, time, webview
   from pathlib import Path

   def find_free_port():
       with socket.socket() as s:
           s.bind(('', 0))
           return s.getsockname()[1]

   port = find_free_port()
   app_dir = Path(__file__).parent
   proc = subprocess.Popen(
       [sys.executable, '-m', 'streamlit', 'run',
        str(app_dir / 'ui' / 'streamlit' / 'app.py'),
        '--server.port', str(port),
        '--server.headless', 'true',
        '--browser.gatherUsageStats', 'false'],
   )
   # Poll until port responds (max ~10s)
   _wait_for_port(port, timeout=10)
   try:
       window = webview.create_window(
           'FunscriptForge', f'http://localhost:{port}',
           width=1400, height=900,
       )
       webview.start()
   finally:
       proc.terminate()
   ```
3. **Write `FunscriptForge.spec`** — PyInstaller config. Datas: vendored
   `funscript-tools/`, `forge_ui_components/`, `assets/`, `demo/`. Hidden
   imports for streamlit's runtime modules.
4. **Vendor funscript-tools** at build time — copy `../funscript-tools/`
   into `_vendored/funscript_tools/` and adjust `forge.funscript_tools`
   adapter to look in either location (sibling clone in dev, vendored in
   bundle).
5. **First build** — `pyinstaller FunscriptForge.spec --clean`. Test
   `dist/FunscriptForge/FunscriptForge.exe`. Iterate on missing imports.
6. **Smoke test** — full workflow on the demo funscript: load → device →
   tone → export. Verify output files written to the right location.

### Phase 2: GitHub Actions multi-platform build

Once local Windows works, add CI matrix for all three platforms.

**`.github/workflows/release-desktop.yml`**:
```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: liquid-releasing/funscript-tools
          path: _vendored/funscript_tools
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r requirements.txt -r requirements-desktop.txt
      - run: pyinstaller FunscriptForge.spec --clean
      - uses: actions/upload-artifact@v4
        with:
          name: FunscriptForge-${{ matrix.os }}
          path: dist/FunscriptForge/

  release:
    needs: build
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/')
    steps:
      - uses: actions/download-artifact@v4
      - name: Zip per platform
        run: |
          for d in FunscriptForge-*; do zip -r "$d.zip" "$d"; done
      - uses: softprops/action-gh-release@v2
        with:
          files: '*.zip'
          repository: liquid-releasing/funscriptforge-releases
```

### Phase 3: Polish (defer if time-short)

- App icon (use existing FunscriptForge logo, convert to .ico/.icns/.png)
- Splash screen during Streamlit startup (PyWebView supports HTML splash)
- macOS notarization (~$99/yr Apple Developer + scripted notarytool)
- Windows code signing (~$200/yr cert + signtool)
- AppImage packaging for Linux (vs raw folder)

## Linux support — yes, free

PyWebView uses GTK WebKit on Linux. Same `desktop.py` launcher works
unchanged. PyInstaller produces a Linux folder bundle on `ubuntu-latest`
runners. Distribute as a tarball or AppImage. Linux is essentially free
once Windows works.

## Bundle size estimate

| Component | Approx size |
|---|---|
| Python runtime | 30-40 MB |
| streamlit + tornado + watchdog | 40-50 MB |
| numpy + matplotlib | 80-100 MB |
| pandas | 30-40 MB |
| librosa + soundfile + audioread | 60-80 MB |
| pyav (if bundled) | 40-60 MB |
| FunscriptForge code + vendored funscript-tools | 5-10 MB |
| **Total per platform** | **~300-400 MB** |

Acceptable for alpha. Tauri (Phase 2) would cut this to ~80 MB but
requires the JS rewrite tradeoff.

## Risks / unknowns

1. **Streamlit subprocess teardown on Windows.** `proc.terminate()`
   doesn't always kill child threads cleanly. May need `psutil` to walk
   the process tree.
2. **PyAV native libraries.** PyAV bundles ffmpeg shared libs. PyInstaller
   sometimes misses these. Pre-tested workaround: explicit `binaries`
   entry in the spec file.
3. **PyInstaller false-positive virus scans.** Common with unsigned
   PyInstaller binaries. SmartScreen warning on first launch is the
   user-visible symptom. Defer signing until alpha feedback.
4. **macOS Apple Silicon vs Intel.** `macos-latest` runner is now ARM
   (M-series). Producing an Intel build requires `macos-13` runner.
   For alpha: ship ARM only and call out Intel as "coming soon."
5. **Streamlit hot-reload in bundled mode.** Disable file watcher
   (`server.fileWatcherType = "none"`) — bundled apps don't need it
   and it crashes on read-only locations.

## References

- Audio plan: `memory/project_funscriptforge_audio.md` (path B chosen, shipped)
- Project tab spec: `internal/tab_updates/project_tab_update.md`
- Devops pipeline spec: `xolvco-web/roadmap/platform/specs/01-devops-pipeline.md`
  (needs section on desktop deploy target)
- funscriptforge-releases repo (release artifacts host)
- PyWebView docs: https://pywebview.flowrl.com/
- PyInstaller docs: https://pyinstaller.org/en/stable/
