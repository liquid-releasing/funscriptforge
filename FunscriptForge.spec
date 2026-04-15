# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for FunscriptForge desktop app.
#
# Build with:
#     pyinstaller FunscriptForge.spec --clean
#
# Output: dist/FunscriptForge/ (one-folder bundle)
# Entry point: dist/FunscriptForge/FunscriptForge.exe (or .app, or .bin)
#
# Design notes: internal/design/desktop_app.md

import sys
from pathlib import Path
from PyInstaller.utils.hooks import (
    collect_all,
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

# ── Paths ──────────────────────────────────────────────────────────────
SPEC_DIR = Path(SPECPATH).resolve()
APP_DIR = SPEC_DIR
FT_SIBLING = SPEC_DIR.parent / "funscript-tools"
FUC_SIBLING = SPEC_DIR.parent / "forge-ui-components"

if not FT_SIBLING.exists():
    raise SystemExit(
        f"ERROR: funscript-tools not found at {FT_SIBLING}\n"
        "Clone it next to funscript-updater: git clone <repo> ../funscript-tools"
    )
if not FUC_SIBLING.exists():
    raise SystemExit(
        f"ERROR: forge-ui-components not found at {FUC_SIBLING}\n"
        "Clone it next to funscript-updater."
    )

# ── Streamlit collection (the tricky part) ────────────────────────────
streamlit_datas, streamlit_binaries, streamlit_hiddenimports = collect_all("streamlit")
# Streamlit uses importlib.metadata to discover itself at runtime
streamlit_datas += copy_metadata("streamlit")

# Other packages that use metadata or dynamic imports
extra_metadata = []
for pkg in (
    "streamlit",
    "altair",
    "pyarrow",
    "numpy",
    "pandas",
    "matplotlib",
    "pydeck",
    "tornado",
    "click",
    "rich",
):
    try:
        extra_metadata += copy_metadata(pkg)
    except Exception:
        pass  # Skip any that aren't installed

# Top-level packages and modules in this repo that the runtime needs.
_CODE_PACKAGES = [
    "forge",
    "ui",
    "assessment",
    "catalog",
    "pattern_catalog",
    "visualizations",
    "user_customization",
    "plugins",
]
_CODE_MODULES = [
    "utils.py",
    "models.py",
    "cli.py",
]

# Hidden imports Streamlit needs at runtime
hidden_imports = list(streamlit_hiddenimports) + [
    "streamlit.web.cli",
    "streamlit.runtime.scriptrunner.magic_funcs",
    "streamlit.runtime.caching",
    "streamlit.runtime.state",
    "streamlit.components.v1",
    "altair",
    "pyarrow",
    "pydeck",
    "watchdog",
    "importlib_metadata",
]

# FunscriptForge submodules
for pkg in _CODE_PACKAGES:
    try:
        hidden_imports += collect_submodules(pkg)
    except Exception:
        pass
hidden_imports += collect_submodules("forge_ui_components")
# Top-level modules that are imported bare (from X import Y)
hidden_imports += ["models", "utils"]

# ── Data files ─────────────────────────────────────────────────────────
datas = list(streamlit_datas) + list(extra_metadata)
for pkg in _CODE_PACKAGES:
    datas += [(str(APP_DIR / pkg), pkg)]
for mod in _CODE_MODULES:
    p = APP_DIR / mod
    if p.exists():
        datas += [(str(p), ".")]

# Static asset folders
datas += [
    (str(APP_DIR / "assets"), "assets"),
    (str(APP_DIR / "demo"), "demo"),
    (str(APP_DIR / "media"), "media"),
    # Streamlit theme config — dark theme, upload limit
    (str(APP_DIR / ".streamlit" / "config.toml"), ".streamlit"),
]

# Device specs + other JSON config
datas += [
    (str(APP_DIR / "forge" / "device_specs.json"), "forge"),
]

# forge-ui-components (editable install — copy source into bundle)
datas += [
    (str(FUC_SIBLING / "forge_ui_components"), "forge_ui_components"),
]

# Vendored funscript-tools
datas += [
    (str(FT_SIBLING), "_vendored/funscript_tools"),
]

# matplotlib and pymediainfo data
try:
    datas += collect_data_files("matplotlib")
except Exception:
    pass
try:
    datas += collect_data_files("pymediainfo")
except Exception:
    pass

# ── Binaries ───────────────────────────────────────────────────────────
binaries = list(streamlit_binaries)

# ── PyInstaller pipeline ───────────────────────────────────────────────
block_cipher = None

a = Analysis(
    ["desktop.py"],
    pathex=[str(APP_DIR), str(FUC_SIBLING)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Strip heavy packages that aren't used at runtime
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "notebook",
        "jupyter",
        "IPython",
        "pytest",
        "sphinx",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FunscriptForge",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX can cause antivirus false positives
    console=False,  # no console window on Windows
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,  # TODO: add assets/icon.ico
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="FunscriptForge",
)

# macOS .app bundle wrapper
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="FunscriptForge.app",
        icon=None,
        bundle_identifier="com.liquidreleasing.funscriptforge",
    )

# ── Post-build: copy demo files NEXT TO the exe (not inside _internal) ──
# So users immediately see a `demo/examples/` folder beside FunscriptForge.exe
# and can find the sample funscripts without digging into _internal.
import shutil as _shutil
_dist_app = SPEC_DIR / "dist" / "FunscriptForge"
_demo_src = SPEC_DIR / "demo"
_demo_dst = _dist_app / "demo"
if _demo_src.exists() and _dist_app.exists():
    if _demo_dst.exists():
        _shutil.rmtree(_demo_dst)
    _shutil.copytree(_demo_src, _demo_dst)
    print(f"Copied demo files to {_demo_dst}")
