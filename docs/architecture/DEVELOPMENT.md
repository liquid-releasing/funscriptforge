# Development Notes

## Test assets

### Funscript
`assets/samples/big_buck_bunny.raw.funscript` ships with the repo and loads automatically.

### Video
Video files are not committed to the repo (file size). To test the video metadata panel
in the Project tab, bring your own MP4 and drop it into the Media expander.

Any MP4 works. The test file used during development:
```
C:\Users\bruce\OneDrive\ai books\9781788997713\Package\videos\video1_1.mp4
```

The stats table shows Duration, Resolution, Frame rate, File size, Video codec, and Audio codec.
Duration gets a ✅ if it matches the loaded funscript within 5 seconds, ⚠️ if not.

---

## Running the app (Windows)

FunscriptForge is a Tauri 2 + React + Vite desktop app. The frontend lives in
`ui/web/`; the Rust shell drives the repo-root Python backend (`cli.py`) as a
subprocess. From `ui/web/`:

```bash
npm install            # once
npm run tauri:dev      # full desktop app (Rust shell + React + Python backend)
```

In development the Rust shell invokes the backend through the project `.venv`
(`python cli.py <command>`), with `ffmpeg` / `ffprobe` resolved on PATH.

Useful variants:

```bash
npm run dev            # browser-only UI loop (forge.js returns mock data)
npx tauri build        # production installers → src-tauri/target/release/bundle/
```

> Rust commands in `ui/web/src-tauri/src/commands.rs` only recompile on a fresh
> `npm run tauri:dev`. After editing Rust, restart the dev server — React HMR
> alone will not pick up new bridge commands.

See [`ui/web/README.md`](../../ui/web/README.md) for prerequisites (Node, Rust,
WebView2) and the `forge.js` platform adapter.

---

## Python environment

The Python backend (`cli.py` and its modules) runs in a project virtualenv:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

For distribution the backend is frozen into a `forge-cli` binary with PyInstaller
(`pyinstaller forge-cli.spec`) and bundled into the Tauri build as a resource; the
release CI does this automatically. See `.github/workflows/release.yml`.

Required: `pandas`, `plotly`, `pymediainfo` (plus the analysis stack below)

### Optional — beat detection

The `beats` CLI command and beat-detection panel require two additional packages:

```bash
pip install av librosa
```

- `av` (PyAV) — bundles FFmpeg libs; extracts audio from video without an external `ffmpeg` binary
- `librosa` — beat tracking via `librosa.beat.beat_track()`

When these packages are absent the UI degrades gracefully (beat-data features are unavailable) and `cli.py beats` exits with a clear error message.

### Optional — captions

SRT / WebVTT parsing (`forge/captions.py`, `cli.py parse-captions`) uses only the Python standard library. No additional packages required.
