# Third-party notices

FunscriptForge itself is © 2026 Liquid Releasing, licensed under the
[MIT License](LICENSE). The desktop installer **redistributes** the
third-party components below, each under its own license. This file documents
those licenses and, where required, where to obtain corresponding source.

---

## FFmpeg (bundled binary) — GPL

The installer ships a static **FFmpeg** build (`ffmpeg.exe` / `ffprobe.exe`)
used by the Python backend for audio extraction and chapter-clip transcoding.

- This is a **`--enable-gpl`** build (it includes **libx264** for H.264
  encoding), so the FFmpeg binary is licensed under the **GNU General Public
  License (GPL)**. The exact version and full build configuration are recorded
  in the `LICENSE.txt` and `README.txt` shipped **alongside the binary** in the
  installed app's `resources/ffmpeg/` folder.
- FunscriptForge invokes FFmpeg as a **separate executable** (an arms-length
  subprocess via the command line). It does not link FFmpeg's libraries into
  its own code. FunscriptForge therefore remains under the MIT License; the GPL
  applies to the redistributed FFmpeg binary, not to FunscriptForge.
- **Corresponding source.** FFmpeg's complete source is available from the
  FFmpeg project at <https://ffmpeg.org/download.html> (and per-build sources
  from the build provider noted in the bundled `README.txt`). The exact
  upstream version is recorded in the bundled `README.txt` / `ffmpeg -version`.
- libx264 source: <https://www.videolan.org/developers/x264.html>.

> Note: we use exactly one GPL-licensed FFmpeg library — **libx264**. All other
> FFmpeg features we invoke (native AAC encoder, libmp3lame, the `scale` and
> `thumbnail` filters, stream `copy`, and audio decode/demux) are LGPL.

## Python backend (bundled in the `forge-cli` freeze)

The frozen backend bundles the scientific-Python stack, all under permissive
licenses: **librosa** (ISC), **NumPy / SciPy / numba** (BSD), **matplotlib**
(matplotlib/PSF), **onnxruntime** (MIT). **libsndfile** (via `soundfile`) is
**LGPL** — used as a shared library and replaceable, consistent with the LGPL.

## Haptics tooling

- **funscript-tools** by Edger — tone transforms + eTransform algorithms behind
  Stim channel generation. <https://github.com/edger477/funscript-tools>
  *(No explicit license is declared on the upstream project; the algorithms are
  used with credit to the author. A formal license/permission should be
  confirmed with Edger before public 1.0.)*
- **restim** by Diglet48 — 3-phase synthesis math for e-stim audio
  (**MIT License**). <https://github.com/diglet48/restim>

## App shell

Tauri, React, Vite (MIT / Apache-2.0) and Lucide icons (ISC), plus the shared
`forgemoment` / `forge-ui-components` libraries (Liquid Releasing).

---

The `.funscript` file format is a community standard, not owned by Liquid
Releasing. This notice is provided for license compliance and is not legal
advice; a formal review is advised before public 1.0.
