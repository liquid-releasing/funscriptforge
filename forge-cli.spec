# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the FunscriptForge CLI sidecar (the Tauri app's Python
# backend). Freezes `cli.py` + the scientific stack (videoflow → librosa /
# numba / scipy / soundfile / matplotlib) + funscript-tools + data files into a
# self-contained ONEDIR bundle the Tauri app ships as a resource and invokes
# per command.
#
#   pyinstaller forge-cli.spec --clean   ->   dist/forge-cli/forge-cli(.exe)
#
# ONEDIR (not onefile): the Tauri app calls the CLI many times per session;
# onefile re-extracts the whole payload on every call. console=True: commands.rs
# reads stdout. This bundle has NO streamlit / pywebview / Qt — it's the headless
# backend, independent of the (to-be-removed) streamlit desktop app.

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files

SPEC_DIR = Path(SPECPATH).resolve()
APP_DIR = SPEC_DIR
FT_SIBLING = SPEC_DIR.parent / "funscript-tools"
FUC_SIBLING = SPEC_DIR.parent / "forge-ui-components"
VF_SIBLING = SPEC_DIR.parent / "videoflow"

datas, binaries, hiddenimports = [], [], []

# ── Scientific stack — collect_all grabs datas + binaries + submodules in one
# shot, which is what the numba/llvmlite/librosa/scipy stack needs (binary
# extensions, data files, and the lazy_loader-hidden submodules). Broad on
# purpose: a too-thin freeze fails at runtime with cryptic ImportErrors. ──
for pkg in (
    "librosa", "numba", "llvmlite", "scipy", "soundfile", "soxr",
    "audioread", "pooch", "lazy_loader", "joblib", "decorator", "msgpack",
    "matplotlib", "videoflow",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # noqa: BLE001 — skip anything not installed
        print(f"[forge-cli.spec] collect_all({pkg!r}) skipped: {exc}")

# onnxruntime (videoflow Silero VAD voice axis) — optional; include if present.
try:
    d, b, h = collect_all("onnxruntime")
    datas += d
    binaries += b
    hiddenimports += h
except Exception:
    pass

# Repo packages cli.py reaches (top-level + lazy videoflow imports).
_CODE_PACKAGES = [
    "forge", "assessment", "catalog", "pattern_catalog",
    "user_customization", "visualizations",
]
for pkg in _CODE_PACKAGES:
    try:
        hiddenimports += collect_submodules(pkg)
    except Exception:
        pass
    datas += [(str(APP_DIR / pkg), pkg)]
# Bare top-level modules imported as `from models import ...` / `from utils ...`.
hiddenimports += ["models", "utils"]
for mod in ("models.py", "utils.py", "cli.py"):
    p = APP_DIR / mod
    if p.exists():
        datas += [(str(p), ".")]

# forge-ui-components (editable sibling) — some forge/* + read-stanzas paths use it.
try:
    hiddenimports += collect_submodules("forge_ui_components")
    if FUC_SIBLING.exists():
        datas += [(str(FUC_SIBLING / "forge_ui_components"), "forge_ui_components")]
except Exception:
    pass

# Vendored funscript-tools (the Edger e-stim engine cli.py wraps).
if FT_SIBLING.exists():
    datas += [(str(FT_SIBLING), "_vendored/funscript_tools")]

# Explicit data files (belt-and-suspenders over collect_all):
#  - device clamp limits + the Edger event catalog/map the CLI reads
#  - videoflow's bundled Silero VAD model (editable installs can miss package data)
datas += [(str(APP_DIR / "forge" / "device_specs.json"), "forge")]
_onnx = VF_SIBLING / "src" / "videoflow" / "silero_vad.onnx"
if _onnx.exists():
    datas += [(str(_onnx), "videoflow")]
try:
    datas += collect_data_files("librosa")
    datas += collect_data_files("matplotlib")
except Exception:
    pass

a = Analysis(
    ["cli.py"],
    pathex=[str(APP_DIR), str(FUC_SIBLING), str(VF_SIBLING / "src")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Headless backend — strip GUI toolkits + the streamlit/desktop stack.
        "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6",
        "streamlit", "altair", "pyarrow", "pydeck", "pandas",
        "webview", "pywebview",
        "notebook", "jupyter", "IPython", "pytest", "sphinx",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="forge-cli",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,            # UPX trips antivirus false positives
    console=True,         # the Tauri Rust side reads stdout
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="forge-cli",
)
