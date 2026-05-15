# funscriptforge — Tauri + React app

The desktop UI that replaces the Streamlit frontend ([../streamlit/](../streamlit/)).

Same React codebase ships to:

- **Desktop** (Windows / macOS / Linux) via Tauri 2.x
- **Web** (future) via the same Vite build, talking to a Python HTTP server

The dual-target pattern is enforced by [src/api/forge.js](src/api/forge.js) — every backend call routes through it. Components must not import `@tauri-apps/api` directly, or the web build breaks.

## Prerequisites

- Node 18+ and npm
- Rust 1.77+ with `cargo` (for `tauri:dev` / `tauri:build`)
- On Windows: the Tauri prereqs ([WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) + Visual Studio Build Tools)
- On Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, etc. — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)
- The sibling [forgemoment](../../../forgemoment/) repo on disk (resolved at build time via a Vite alias in [vite.config.js](vite.config.js) — edits in `forgemoment/src/` HMR live without a rebuild)

## Run modes

```sh
# Browser-only — fastest UI dev loop. forge.js calls return mock data.
npm install
npm run dev          # → http://localhost:1430

# Tauri desktop — real bridge into Rust commands in src-tauri/.
npm run tauri:dev

# Production builds.
npm run build        # web bundle → dist/
npm run tauri:build  # platform installers → src-tauri/target/release/bundle/
```

## Layout

```
ui/web/
├── index.html
├── package.json           # forgemoment linked via file:../../../forgemoment
├── vite.config.js         # port 1430 (1420 belongs to forgegen)
├── src/
│   ├── main.jsx
│   ├── App.jsx            # tab strip + env badge (Tauri vs browser)
│   ├── App.css            # layout only; design tokens come from forgemoment
│   └── api/
│       └── forge.js       # platform adapter (Tauri IPC / HTTP / mock)
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    ├── icons/             # icon.ico + icon.png (copied from ../../media/)
    └── src/
        ├── main.rs
        ├── lib.rs
        └── commands.rs    # `ping` only; real commands land here as flows port
```

## Web deploy

The same React codebase can deploy to web by:

1. Setting `VITE_API_BASE_URL` to a Python HTTP server wrapping the funscriptforge CLI (FastAPI / uvicorn).
2. Running `npm run build` and serving `dist/` from any static host (Cloudflare Pages, S3, nginx, etc.).

`forge.js` will route calls to `fetch(${VITE_API_BASE_URL}/${command})` instead of Tauri IPC. The HTTP server doesn't exist yet; out of scope for the desktop-first milestone.

## Icons

Currently a single 128×128 PNG + Windows `.ico` copied from [../../media/](../../media/). To generate the full cross-platform set (macOS `.icns`, multiple PNG sizes, Android/iOS variants) before the first non-Windows build:

```sh
npx tauri icon ../../media/funscriptforge_icon.png
```

Then add the new files to `bundle.icon` in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json).

## Bridge to Python

The Rust commands in [src-tauri/src/commands.rs](src-tauri/src/commands.rs) will spawn the existing `funscriptforge` Python CLI per call, capture JSON from stdout, and return it to React — same pattern as [forgegen/BRIDGE_DESIGN.md](../../../forgegen/BRIDGE_DESIGN.md). Long-running commands stream stage labels via `tauri::Emitter` events.

The Python side of the bridge lives at [../common/](../common/) (`pipeline.py`, `project.py`, `undo_stack.py`, `view_state.py`, `work_items.py`).

## What's ported, what's not

- [x] Toolchain scaffold (Vite + React + Tauri 2.x)
- [x] Platform adapter (`forge.js`)
- [x] `ping` round-trip command
- [ ] Library screen (port from [../../ui_design/ui_kits/funscriptforge-app/LibraryScreen.jsx](../../ui_design/ui_kits/funscriptforge-app/LibraryScreen.jsx))
- [ ] Project tab
- [ ] Device tab
- [ ] Chapters tab
- [ ] Edit tab
- [ ] Stim tab
- [ ] Phrases tab
- [ ] Export tab
- [ ] Real Python-CLI bridge commands

## Migration note

The browser-loaded prototype at [../../ui_design/ui_kits/funscriptforge-app/](../../ui_design/ui_kits/funscriptforge-app/) is the **design source** — it uses Babel-script-tag JSX and CDN React. It stays in place as a reference; screens get rewritten here as bundled ES modules pulling components from [forgemoment](../../../forgemoment/) (AppShell, Charts, MediaViewer, TransformPanel, primitives) rather than duplicating them.
