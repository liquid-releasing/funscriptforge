# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.

"""FunscriptForge desktop launcher.

Starts the Streamlit server in a background subprocess and opens a
PyWebView window pointed at it. Tears down the server when the window
closes.

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


def _start_streamlit(app_dir: Path, port: int) -> subprocess.Popen:
    """Launch Streamlit as a subprocess on the given port."""
    app_script = app_dir / "ui" / "streamlit" / "app.py"
    if not app_script.exists():
        raise FileNotFoundError(f"Streamlit app not found: {app_script}")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(app_dir) + os.pathsep + env.get("PYTHONPATH", "")
    # Disable Streamlit's file watcher — bundled apps don't need it and it
    # can crash on read-only locations inside the bundle.
    env["STREAMLIT_SERVER_FILE_WATCHER_TYPE"] = "none"
    env["STREAMLIT_SERVER_HEADLESS"] = "true"
    env["STREAMLIT_BROWSER_GATHER_USAGE_STATS"] = "false"
    env["STREAMLIT_GLOBAL_DEVELOPMENT_MODE"] = "false"
    # Hide the "Deploy" button (Streamlit Community Cloud) — irrelevant
    # for a desktop app and confusing to users.
    env["STREAMLIT_CLIENT_TOOLBAR_MODE"] = "minimal"

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
    import webview

    app_dir = _app_dir()
    port = _find_free_port()
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
        webview.start()
        return 0
    finally:
        print(f"[{APP_NAME}] Shutting down Streamlit")
        _kill_process_tree(streamlit_proc)


if __name__ == "__main__":
    sys.exit(main())
