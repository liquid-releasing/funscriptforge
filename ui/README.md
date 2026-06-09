# ui — FunscriptForge frontend

FunscriptForge is a **Tauri 2 + React + Vite** desktop application. The interactive
UI lives at [`web/`](web/); it drives the repo-root Python backend ([`../cli.py`](../cli.py))
as a subprocess.

> The earlier Streamlit prototype has been removed. There is no `streamlit run`,
> no `launcher.py`, and no pywebview desktop shell — the app is the Tauri build.

## Quick start

```bash
cd ui/web
npm install
npm run tauri:dev      # full desktop app (Rust shell + React + Python backend)
```

In development the Rust shell invokes the backend through the project `.venv`
(`python cli.py <command>`). For a production build it invokes the frozen
`forge-cli` binary instead (see below). A static `ffmpeg` / `ffprobe` is resolved
on PATH (bundled in packaged builds).

Other run modes:

```bash
npm run dev            # browser-only UI dev loop (forge.js returns mock data)
npx tauri build        # platform installers → src-tauri/target/release/bundle/
```

See [`web/README.md`](web/README.md) for prerequisites (Node, Rust, WebView2),
run modes, the `forge.js` platform adapter, and the tab flow.

---

## Subdirectories

| Directory | Contents |
| --- | --- |
| `web/` | Tauri + React + Vite desktop app. React source in `web/src/`, Rust shell in `web/src-tauri/`. See [`web/README.md`](web/README.md). |
| `common/` | Framework-agnostic business logic: `Project`, `WorkItem`, pipeline helpers. No UI-framework dependency. See [`common/README.md`](common/README.md). |

## Backend & distribution

- **Backend** — the repo-root [`cli.py`](../cli.py) command-line interface. For
  distribution it is frozen into a `forge-cli` binary via PyInstaller using
  [`../forge-cli.spec`](../forge-cli.spec); the Rust shell spawns it per call.
- **Distribution** — Windows-first. The GitHub Actions workflow
  [`../.github/workflows/release.yml`](../.github/workflows/release.yml) builds the
  Tauri app + frozen backend + bundled ffmpeg and publishes an MSI + NSIS installer
  to the [`liquid-releasing/funscriptforge-releases`](https://github.com/liquid-releasing/funscriptforge-releases)
  repo. macOS / Linux are a post-beta follow-up.

## Tests

```bash
# React / frontend tests
cd ui/web && npm test

# Python UI-common layer tests
python -m unittest discover -s ui/common/tests -v

# Full Python test suite
python cli.py test
```

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](../LICENSE).  Written by human and Claude AI.*
