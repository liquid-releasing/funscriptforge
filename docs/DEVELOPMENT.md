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

Hot reload is unreliable on Windows. Always do a full restart:

```bash
taskkill /F /IM python.exe /T
find . -name "__pycache__" -exec rm -rf {} +
streamlit run ui/streamlit/app.py --server.port 8560 --server.fileWatcherType poll
```

Use an incrementing port (8551, 8552…) each restart to avoid browser cache. Open a fresh tab.

---

## Python environment

```bash
pip install -r ui/streamlit/requirements.txt
```

Required: `streamlit`, `pandas`, `plotly`, `pymediainfo`

### Optional — beat detection

The `beats` CLI command and beat-detection panel require two additional packages:

```bash
pip install av librosa
```

- `av` (PyAV) — bundles FFmpeg libs; extracts audio from video without an external `ffmpeg` binary
- `librosa` — beat tracking via `librosa.beat.beat_track()`

When these packages are absent the UI degrades gracefully (the Generate beat data button is hidden) and `cli.py beats` exits with a clear error message.

### Optional — captions

SRT / WebVTT parsing (`forge/captions.py`, `cli.py parse-captions`) uses only the Python standard library. No additional packages required.
