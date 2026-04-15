# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""FunscriptForge desktop launcher.

Starts the Streamlit server in a background subprocess and opens a
PyWebView window pointed at it. Tears down the server when the window
closes.

Dual mode:
  - Dev (not frozen): spawns `python -m streamlit run app.py`
  - Bundled (frozen): re-invokes `sys.executable --run-streamlit ...`
    which triggers in-process Streamlit via streamlit.web.cli.main().
    This is the PyInstaller+Streamlit pattern: the frozen executable
    cannot be used as a Python interpreter, so we use a sentinel arg.

Usage (development):
    python desktop.py

Usage (bundled):
    Double-click FunscriptForge.exe (Windows) or FunscriptForge.app (macOS).
    PyInstaller bundles this file as the entry point.

Design notes: internal/design/desktop_app.md
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


APP_NAME = "FunscriptForge"
WINDOW_WIDTH = 1400
WINDOW_HEIGHT = 900
STARTUP_TIMEOUT_S = 30

# Sentinel arg: in bundled mode, the launcher re-invokes itself with this
# flag to trigger in-process Streamlit. Never passed by users.
RUN_STREAMLIT_FLAG = "--run-streamlit"

# File dialog bridge: a tiny HTTP server running inside the launcher
# process so Streamlit (in a subprocess) can request native file dialogs
# via PyWebView. Streamlit reads FUNSCRIPTFORGE_BRIDGE_PORT from env and
# calls http://127.0.0.1:<port>/pick-file.
_bridge_port: int | None = None


def _app_dir() -> Path:
    """Return the root directory containing ui/streamlit/app.py.

    In dev: the repo root.
    In a PyInstaller bundle: sys._MEIPASS (onefile) or the executable's
    parent (onefolder). We use the bundled data location either way.
    """
    if getattr(sys, "frozen", False):
        # Bundled — data files live alongside the executable or in _MEIPASS
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(url: str, timeout_s: int) -> bool:
    """Poll the server until it responds or timeout expires."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def _streamlit_env() -> dict:
    """Return env vars that configure Streamlit for desktop/headless mode."""
    env = os.environ.copy()
    # Disable Streamlit's file watcher — bundled apps don't need it and it
    # can crash on read-only locations inside the bundle.
    env["STREAMLIT_SERVER_FILE_WATCHER_TYPE"] = "none"
    env["STREAMLIT_SERVER_HEADLESS"] = "true"
    env["STREAMLIT_BROWSER_GATHER_USAGE_STATS"] = "false"
    env["STREAMLIT_GLOBAL_DEVELOPMENT_MODE"] = "false"
    # Hide the "Deploy" button (Streamlit Community Cloud) — irrelevant
    # for a desktop app and confusing to users.
    env["STREAMLIT_CLIENT_TOOLBAR_MODE"] = "minimal"
    # Signal to app code that it's running inside the desktop wrapper.
    env["FUNSCRIPTFORGE_DESKTOP"] = "1"
    # File dialog bridge port (set after we reserve it — see main()).
    if _bridge_port is not None:
        env["FUNSCRIPTFORGE_BRIDGE_PORT"] = str(_bridge_port)
    return env


def _start_bridge_server(port: int) -> None:
    """Start the file-dialog HTTP bridge on 127.0.0.1:<port>.

    Runs in a daemon thread so it dies with the process. One endpoint:

      GET /pick-file?type=funscript
        → {"path": "<chosen path>"} on success
        → {"path": ""}               if user cancelled
        → {"error": "..."}           on error

    Called from PyWebView's start(func=...) callback, so the webview
    window already exists and we can safely invoke create_file_dialog.
    """
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    import json as _json
    import webview

    class BridgeHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # silence default access logging

        def do_GET(self):
            if not self.path.startswith("/pick-file"):
                self.send_response(404)
                self.end_headers()
                return
            try:
                # Ask PyWebView for a native file dialog on the GUI thread.
                # Recent pywebview (>=4) is thread-safe here.
                file_types = ("Funscript files (*.funscript)", "All files (*.*)")
                result = webview.windows[0].create_file_dialog(
                    webview.OPEN_DIALOG,
                    allow_multiple=False,
                    file_types=file_types,
                )
                path = ""
                if result:
                    # result is a tuple/list of paths; take the first
                    path = result[0] if isinstance(result, (tuple, list)) else str(result)
                body = _json.dumps({"path": path}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                body = _json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

    server = HTTPServer(("127.0.0.1", port), BridgeHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"[{APP_NAME}] File dialog bridge listening on 127.0.0.1:{port}")


def _start_streamlit(app_dir: Path, port: int) -> subprocess.Popen:
    """Launch Streamlit as a subprocess on the given port.

    Dev mode: `python -m streamlit run app.py ...`
    Bundled mode: `FunscriptForge.exe --run-streamlit app.py port`
    """
    app_script = app_dir / "ui" / "streamlit" / "app.py"
    if not app_script.exists():
        raise FileNotFoundError(f"Streamlit app not found: {app_script}")

    env = _streamlit_env()
    env["PYTHONPATH"] = str(app_dir) + os.pathsep + env.get("PYTHONPATH", "")

    if getattr(sys, "frozen", False):
        # Bundled: re-invoke self with sentinel arg
        cmd = [
            sys.executable,
            RUN_STREAMLIT_FLAG,
            str(app_script),
            str(port),
        ]
    else:
        # Dev: normal `python -m streamlit run`
        cmd = [
            sys.executable,
            "-m",
            "streamlit",
            "run",
            str(app_script),
            "--server.port",
            str(port),
            "--server.address",
            "127.0.0.1",
            "--server.headless",
            "true",
            "--browser.gatherUsageStats",
            "false",
        ]

    # On Windows, CREATE_NO_WINDOW hides the subprocess console.
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    return subprocess.Popen(
        cmd,
        env=env,
        cwd=str(app_dir),
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _run_streamlit_in_process(app_script: str, port: str) -> int:
    """Second-process mode: imported only when --run-streamlit is passed.

    This is how the bundled executable actually runs Streamlit — the
    frozen exe re-invokes itself with RUN_STREAMLIT_FLAG, and that
    invocation falls through to here and calls Streamlit's CLI directly.
    """
    from streamlit.web import cli as stcli

    sys.argv = [
        "streamlit",
        "run",
        app_script,
        "--server.port",
        port,
        "--server.address",
        "127.0.0.1",
        "--server.headless",
        "true",
        "--browser.gatherUsageStats",
        "false",
    ]
    return stcli.main(standalone_mode=False) or 0


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """Terminate Streamlit and any children. Windows needs psutil to walk
    the tree; POSIX terminate() cascades via the process group."""
    if proc.poll() is not None:
        return
    try:
        import psutil

        parent = psutil.Process(proc.pid)
        for child in parent.children(recursive=True):
            try:
                child.terminate()
            except psutil.NoSuchProcess:
                pass
        parent.terminate()
        gone, alive = psutil.wait_procs(
            [parent, *parent.children(recursive=True)], timeout=5
        )
        for p in alive:
            try:
                p.kill()
            except psutil.NoSuchProcess:
                pass
    except Exception:
        # Fallback: plain terminate
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> int:
    # Bundled self-re-exec: run Streamlit in this process and exit
    if len(sys.argv) >= 2 and sys.argv[1] == RUN_STREAMLIT_FLAG:
        if len(sys.argv) < 4:
            print(f"Usage: {sys.argv[0]} {RUN_STREAMLIT_FLAG} <app_script> <port>")
            return 2
        return _run_streamlit_in_process(sys.argv[2], sys.argv[3])

    import webview

    global _bridge_port

    app_dir = _app_dir()
    port = _find_free_port()
    _bridge_port = _find_free_port()
    url = f"http://127.0.0.1:{port}"

    print(f"[{APP_NAME}] Starting Streamlit on {url}")
    streamlit_proc = _start_streamlit(app_dir, port)

    try:
        print(f"[{APP_NAME}] Waiting for server...")
        if not _wait_for_server(url, STARTUP_TIMEOUT_S):
            print(f"[{APP_NAME}] Server did not start within {STARTUP_TIMEOUT_S}s")
            _kill_process_tree(streamlit_proc)
            return 1

        print(f"[{APP_NAME}] Opening window")
        webview.create_window(
            APP_NAME,
            url,
            width=WINDOW_WIDTH,
            height=WINDOW_HEIGHT,
            resizable=True,
            min_size=(1000, 700),
        )
        # func runs after window creation but before event loop — the right
        # spot to start the bridge since webview.windows[0] now exists.
        webview.start(func=_start_bridge_server, args=(_bridge_port,))
        return 0
    finally:
        print(f"[{APP_NAME}] Shutting down Streamlit")
        _kill_process_tree(streamlit_proc)


if __name__ == "__main__":
    sys.exit(main())
