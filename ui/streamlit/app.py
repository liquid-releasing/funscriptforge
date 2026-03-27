# Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
# Written by human and Claude AI (Claude Sonnet).

"""FunscriptForge — Streamlit UI entry point.

Launch with:
    streamlit run ui/streamlit/app.py

Layout
------
Sidebar
  • File picker (local path / recent files) or upload (web mode)
  • Optional media file for context playback

Main area  (tabs)
  1. Phrase Selector   — full-funscript chart; click a phrase to edit it
                         (Assessment details collapsible at the bottom)
  2. Pattern Editor    — batch transform + per-instance waveform shaping
                         (Pattern Behaviors catalog collapsible at the top)
  3. Transform Catalog — reference guide for all phrase transforms
  4. Export            — quality gate, transform plan, download
"""

from __future__ import annotations

import json
import os
import sys

# Ensure project root is importable from any working directory.
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import streamlit as st

# Pre-import Matplotlib to avoid cold-start delay on first chart render.
import matplotlib
matplotlib.use("Agg")

# True when launched from launcher.py (desktop / PyInstaller).
# False when accessed via the web UI or plain `streamlit run`.
_IS_LOCAL = os.environ.get("FUNSCRIPT_FORGE_LOCAL") == "1"

from ui.common.project import Project
from ui.common.view_state import ViewState
from ui.common.work_items import ItemType, WorkItem  # WorkItem kept for sidebar manual-add
from ui.streamlit.panels import assessment as assessment_panel
from ui.streamlit.panels import catalog_view as catalog_view_panel
from ui.streamlit.panels import export_panel
from ui.streamlit.panels import pattern_editor as pattern_editor_panel
from ui.streamlit.panels import transform_catalog as transform_catalog_panel
from ui.streamlit.panels import stim_panel
from ui.streamlit.panels import viewer as viewer_panel
from forge.tabs import project_tab, device_tab, tone_tab, next_steps_tab

# ------------------------------------------------------------------
# Page config (must be the first Streamlit call)
# ------------------------------------------------------------------

_LOGO    = os.path.join(_ROOT, "media", "funscriptforge.png")
_FAVICON = os.path.join(_ROOT, "media", "anvil.png")

def _load_favicon():
    """Return a PIL Image for the favicon, falling back to emoji."""
    from PIL import Image
    for path in (_FAVICON, _LOGO):
        if os.path.exists(path):
            return Image.open(path)
    return "🔨"

st.set_page_config(
    page_title="FunscriptForge",
    page_icon=_load_favicon(),
    layout="wide",
    initial_sidebar_state="expanded",
)

# ------------------------------------------------------------------
# Global accessibility CSS
# ------------------------------------------------------------------
# .sr-only: visually hidden but readable by screen readers (WCAG C2, M4).
st.markdown(
    """<style>
    .sr-only {
        position: absolute; width: 1px; height: 1px;
        padding: 0; margin: -1px; overflow: hidden;
        clip: rect(0,0,0,0); white-space: nowrap; border: 0;
    }
    </style>""",
    unsafe_allow_html=True,
)

# ------------------------------------------------------------------
# Session state initialisation
# ------------------------------------------------------------------

if "project" not in st.session_state:
    st.session_state.project: Project | None = None

if "output_dir" not in st.session_state:
    # G32: the launcher sets FUNSCRIPT_FORGE_DATA_DIR to the writable root
    # beside the executable (frozen) or the project root (dev). Without the
    # launcher (plain `streamlit run`), fall back to writable_base_dir().
    _env_data = os.environ.get("FUNSCRIPT_FORGE_DATA_DIR")
    if _env_data:
        st.session_state.output_dir = os.path.join(_env_data, "output")
    else:
        from utils import writable_base_dir as _writable_base_dir
        st.session_state.output_dir = os.path.join(_writable_base_dir(), "output")

if "pattern_catalog" not in st.session_state:
    from catalog.pattern_catalog import PatternCatalog
    _catalog_path = os.path.join(st.session_state.output_dir, "pattern_catalog.json")
    try:
        st.session_state.pattern_catalog = PatternCatalog(_catalog_path)
    except Exception:
        # Corrupt catalog — back it up and start fresh so the app can still load.
        if os.path.exists(_catalog_path):
            os.rename(_catalog_path, _catalog_path + ".bak")
        st.session_state.pattern_catalog = PatternCatalog(_catalog_path)
        st.session_state["_catalog_reset_warning"] = True

if "view_state" not in st.session_state:
    st.session_state.view_state = ViewState()

if "proposed_actions" not in st.session_state:
    st.session_state.proposed_actions = None

if "last_loaded_file" not in st.session_state:
    st.session_state.last_loaded_file = None

if "large_funscript_threshold" not in st.session_state:
    st.session_state.large_funscript_threshold = 100_000  # force vibrant colors for all funscripts

if "last_assessment_elapsed" not in st.session_state:
    st.session_state.last_assessment_elapsed = None

if "bpm_threshold" not in st.session_state:
    st.session_state.bpm_threshold = 120.0

if "min_phrase_s" not in st.session_state:
    st.session_state.min_phrase_s = 20

if "amp_sensitivity" not in st.session_state:
    st.session_state.amp_sensitivity = "Medium (0.30)"

if "last_loaded_cfg" not in st.session_state:
    st.session_state.last_loaded_cfg = None

if "project_dirty" not in st.session_state:
    st.session_state.project_dirty = False

if "undo_stack" not in st.session_state:
    from ui.common.undo_stack import UndoStack
    st.session_state.undo_stack = UndoStack(max_size=50)

# ------------------------------------------------------------------
# Local-mode helpers: recent-files list and path pickers
# ------------------------------------------------------------------

_RECENTS_FILE = "recent_funscripts.json"
_RECENTS_MAX  = 10


def _load_recents(output_dir: str) -> list[str]:
    """Load the list of recently used funscript paths from disk."""
    path = os.path.join(output_dir, _RECENTS_FILE)
    try:
        with open(path) as fh:
            data = json.load(fh)
        return [p for p in data if isinstance(p, str) and os.path.isfile(p)]
    except Exception:
        return []


def _save_recents(output_dir: str, file_path: str) -> None:
    """Prepend *file_path* to the recents list and persist."""
    recents = _load_recents(output_dir)
    if file_path in recents:
        recents.remove(file_path)
    recents.insert(0, file_path)
    recents = recents[:_RECENTS_MAX]
    path = os.path.join(output_dir, _RECENTS_FILE)
    os.makedirs(output_dir, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(recents, fh, indent=2)


_BROWSE_SENTINEL = "— enter a path below —"


def _project_picker_local(output_dir: str) -> None:
    """Show a dropdown of recent .forge projects for quick resume."""
    _assets_output = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), "assets", "output")
    forge_files = []
    if os.path.isdir(_assets_output):
        for d in sorted(os.listdir(_assets_output), reverse=True):
            dpath = os.path.join(_assets_output, d)
            if os.path.isdir(dpath):
                for f in os.listdir(dpath):
                    if f.endswith(".forge"):
                        forge_files.append((d, os.path.join(dpath, f)))

    if forge_files:
        st.sidebar.subheader("Recent Projects")
        _NEW_PROJECT = "— new project —"
        options = [_NEW_PROJECT] + [name for name, _ in forge_files]
        sel = st.sidebar.selectbox(
            "Resume a project",
            options=options,
            key="project_picker",
            label_visibility="collapsed",
        )
        if sel != _NEW_PROJECT:
            forge_path = next(p for n, p in forge_files if n == sel)
            folder = os.path.dirname(forge_path)
            # Load the forge project if not already loaded
            current = st.session_state.get("forge_project")
            if not current or current.get("output_folder") != folder:
                from forge.project import load_forge
                loaded = load_forge(folder)
                if loaded:
                    st.session_state.forge_project = loaded
                    # Restore funscript path from project
                    from forge.project import get_input_file
                    fs = get_input_file(loaded, "funscript")
                    if fs:
                        st.session_state["funscript_path"] = fs
                    # Restore chain path
                    for stage in ["phrases", "tone", "device"]:
                        chain_file = os.path.join(folder, f"_funscript_{stage}.json")
                        if os.path.isfile(chain_file):
                            st.session_state["chain_funscript_path"] = chain_file
                            break
                    # Restore accepted flags from progress
                    _prog = loaded.get("progress", {})
                    if loaded.get("output_targets"):
                        st.session_state["device_accepted"] = True
                    if _prog.get("tone_applied"):
                        st.session_state["tone_accepted"] = True
                        st.session_state["tone_global"] = loaded.get("tone")
                    if _prog.get("phrases_edited"):
                        pass  # phrase chains restored via chain_funscript_path
                    st.session_state["project_accepted"] = True
                    st.rerun()
        st.sidebar.markdown("---")


def _funscript_picker_local(output_dir: str) -> str | None:
    """Local-mode funscript picker.

    If a forge project is loaded (via Project tab), shows the path as readonly.
    Otherwise shows selectbox of recents + text-input fallback.
    Returns the selected absolute path, or ``None`` if nothing valid is chosen.
    """
    st.sidebar.subheader("Funscript Project")

    # If a forge project is active, show readonly info instead of picker
    _forge = st.session_state.get("forge_project")
    _fs_path = st.session_state.get("funscript_path", "")
    if _forge and _fs_path and os.path.isfile(_fs_path):
        st.sidebar.markdown(f"**{_forge.get('name', 'Project')}**")
        st.sidebar.caption(f"📄 {os.path.basename(_fs_path)}")
        # Still show assessment stats if available
        _proj = st.session_state.get("project")
        if _proj and _proj.is_loaded:
            _desc = _proj.get_description()
            if _desc:
                st.sidebar.caption(_desc)
        return _fs_path

    _proj = st.session_state.get("project")
    if _proj and _proj.is_loaded:
        st.sidebar.markdown(f"**{_proj.display_name}**")
        _desc = _proj.get_description()
        if _desc:
            st.sidebar.caption(_desc)
    recents = _load_recents(output_dir)
    options = recents + [_BROWSE_SENTINEL]
    sel = st.sidebar.selectbox(
        "Recent files",
        options=options,
        format_func=lambda p: os.path.basename(p) if p != _BROWSE_SENTINEL else p,
        key="local_funscript_sel",
        label_visibility="collapsed",
    )

    if sel == _BROWSE_SENTINEL:
        typed = st.sidebar.text_input(
            "Path to .funscript",
            key="local_funscript_typed",
            placeholder=r"C:\path\to\video.funscript",
            label_visibility="collapsed",
        ).strip()
        if not typed:
            st.sidebar.caption("Paste or type the full path to a .funscript file.")
            return None
        if not os.path.isfile(typed):
            st.sidebar.warning("File not found.")
            return None
        return typed

    return sel  # already validated by _load_recents


def _media_picker_local(funscript_path: str, output_dir: str) -> None:
    """Local-mode media picker: auto-detect by stem, or type a path manually."""
    # Auto-detect once per funscript switch.
    if st.session_state.get("media_auto_for") != funscript_path:
        from ui.streamlit.panels.media_player import find_matching_media, MEDIA_EXTS
        _auto = find_matching_media(funscript_path, os.path.dirname(funscript_path))
        if _auto:
            st.session_state["media_path"] = _auto
        st.session_state["media_auto_for"] = funscript_path

    # Show current media + clear button.
    _mp = st.session_state.get("media_path")
    if _mp and os.path.exists(_mp):
        _mc1, _mc2 = st.sidebar.columns([5, 1])
        _mc1.caption(f"🎵 {os.path.basename(_mp)}")
        if _mc2.button("✕", key="clear_media", help="Remove media"):
            st.session_state.pop("media_path", None)
            st.session_state.pop("media_auto_for", None)
            st.rerun()
        return  # don't show picker when a file is already loaded

    # Manual path entry.
    typed = st.sidebar.text_input(
        "Audio/video path (optional)",
        key="local_media_typed",
        placeholder=r"C:\path\to\video.mp4",
        label_visibility="collapsed",
    ).strip()
    if typed:
        if not os.path.isfile(typed):
            st.sidebar.warning("Media file not found.")
        else:
            from ui.streamlit.panels.media_player import validate_media_file
            _err = validate_media_file(typed)
            if _err:
                st.sidebar.warning(f"Media file may be corrupt: {_err}")
            else:
                st.session_state["media_path"] = typed
                st.rerun()


# ------------------------------------------------------------------
# Sidebar
# ------------------------------------------------------------------


# ------------------------------------------------------------------
# Undo + workflow guidance helpers
# ------------------------------------------------------------------

_WORKFLOW_GUIDANCE = {
    "Project": "Set up your funscript, media, and export location",
    "Device": "Make your funscript device-aware",
    "Tone": "Choose how your output feels",
    "Phrases": "Fine-tune individual sections",
    "Export": "Generate device-aware output files",
}


def _undo_description(history_entry: dict) -> str:
    """Human-readable description of what a history entry did."""
    tab = history_entry.get("tab", "")
    if tab == "device":
        fixes = history_entry.get("fix_strategies", [])
        return f"Applied {', '.join(fixes) if fixes else 'device fixes'}"
    elif tab == "tone":
        tone = history_entry.get("tone", "")
        return f"Applied {tone} tone"
    elif tab == "export":
        targets = history_entry.get("targets", [])
        return f"Exported to {', '.join(targets)}"
    return "Changes applied"


def _next_workflow_step(workflow: list[tuple[str, bool]]) -> tuple[str, str] | None:
    """Find the next incomplete step in the workflow."""
    for name, done in workflow:
        if not done:
            return name, _WORKFLOW_GUIDANCE.get(name, "")
    return None


def _perform_undo(forge_project: dict) -> None:
    """Undo the last Accept by popping history and restoring chain state."""
    from forge.project import save_forge, load_chain_funscript
    from pathlib import Path

    history = forge_project.get("history", [])
    if not history:
        return

    last = history.pop()
    tab = last.get("tab", "")

    # Restore state based on which tab was undone
    if tab == "device":
        st.session_state.pop("device_accepted", None)
        forge_project.pop("device_fix_strategies", None)
        forge_project.pop("device_apply_scope", None)
        # Remove device chain file
        folder = forge_project.get("output_folder", "")
        chain_file = os.path.join(folder, "_funscript_device.json")
        if os.path.isfile(chain_file):
            os.remove(chain_file)
        # Reset chain path to original
        st.session_state.pop("chain_funscript_path", None)

    elif tab == "tone":
        st.session_state.pop("tone_accepted", None)
        forge_project["tone"] = None
        forge_project["tone_sliders"] = {}
        forge_project["progress"]["tone_applied"] = False
        # Remove tone chain file
        folder = forge_project.get("output_folder", "")
        chain_file = os.path.join(folder, "_funscript_tone.json")
        if os.path.isfile(chain_file):
            os.remove(chain_file)
        # Reset chain path to device stage (or nothing)
        device_chain = os.path.join(folder, "_funscript_device.json")
        if os.path.isfile(device_chain):
            st.session_state["chain_funscript_path"] = device_chain
        else:
            st.session_state.pop("chain_funscript_path", None)

    elif tab == "export":
        forge_project["progress"]["exported"] = False
        st.session_state.pop("export_complete", None)

    # Save updated forge
    if Path(forge_project.get("output_folder", "")).exists():
        save_forge(forge_project)


def _sidebar() -> None:
    if st.session_state.pop("_catalog_reset_warning", False):
        st.sidebar.warning(
            "Pattern catalog was corrupt and has been reset. "
            "The old file was backed up as `pattern_catalog.json.bak`."
        )

    _logo = os.path.join(_ROOT, "media", "funscriptforge.png")
    if os.path.exists(_logo):
        st.sidebar.image(_logo, width="stretch")
    else:
        st.sidebar.title("FunscriptForge")
    st.sidebar.markdown("---")

    # --- Project picker (resume recent projects) ---
    output_dir = st.session_state.output_dir
    if _IS_LOCAL:
        _project_picker_local(output_dir)

    # --- Sidebar project status (read-only) ---
    _forge = st.session_state.get("forge_project")
    _fs_path = st.session_state.get("funscript_path", "")

    if _forge and _fs_path:
        st.sidebar.subheader("Project")
        st.sidebar.markdown(f"**{_forge.get('name', 'Project')}**")
        st.sidebar.caption(f"📄 {os.path.basename(_fs_path)}")
        if _forge.get("output_folder"):
            st.sidebar.caption(f"📁 `{_forge['output_folder']}`")
    else:
        st.sidebar.subheader("Project")
        st.sidebar.caption("Drop a funscript on the **Project** tab to get started.")

    # For backward compatibility: set funscript_path for downstream code
    funscript_path = _fs_path or None
    if funscript_path is None:
        # No funscript loaded — still render the rest of the sidebar but skip
        # assessment-dependent sections
        pass

    if not _IS_LOCAL:
        # Web mode: keep upload path for SaaS deployment
        _mp = st.session_state.get("media_path")
        if _mp and os.path.exists(_mp):
            _mc1, _mc2 = st.sidebar.columns([5, 1])
            _mc1.caption(f"🎵 {os.path.basename(_mp)}")
            if _mc2.button("✕", key="clear_media", help="Remove media"):
                st.session_state.pop("media_path", None)
                st.session_state.pop("media_auto_for", None)
                st.rerun()

    if not funscript_path:
        _render_sidebar_footer()
        return

    selected_file = os.path.basename(funscript_path)

    # Detection settings live in the Phrase Selector tab; read from session state here.
    min_phrase_s    = st.session_state.get("min_phrase_s", 20)
    amp_sensitivity = st.session_state.get("amp_sensitivity", "Medium (0.30)")

    # --- Chart / transform settings ---
    with st.sidebar.expander("Chart settings"):
        large_funscript_threshold = st.number_input(
            "Fast rendering threshold (actions)",
            min_value=100,
            max_value=200_000,
            value=100_000,
            step=500,
            help=(
                "Funscripts with more actions than this use a single grey "
                "connecting line for speed.  Smaller funscripts use per-segment "
                "coloured lines that match the dot colours."
            ),
        )
        bpm_threshold = st.number_input(
            "Transform BPM threshold",
            min_value=40,
            max_value=300,
            value=120,
            step=5,
            help=(
                "Phrases at or above this BPM are suggested the Amplitude Scale "
                "transform; phrases below are suggested Passthrough."
            ),
        )
    st.session_state.large_funscript_threshold = int(large_funscript_threshold)
    st.session_state.bpm_threshold = float(bpm_threshold)

    amp_tol_map = {"Low (0.35)": 0.35, "Medium (0.30)": 0.30, "High (0.25)": 0.25}

    from assessment.analyzer import AnalyzerConfig
    analyzer_cfg = AnalyzerConfig(
        min_phrase_duration_ms=min_phrase_s * 1000,
        amplitude_tolerance=amp_tol_map[amp_sensitivity],
    )
    # Include chain path in config key so assessment re-runs after Device/Tone Accept
    _chain_path = st.session_state.get("chain_funscript_path", "")
    _effective_path = _chain_path if (_chain_path and os.path.isfile(_chain_path)) else funscript_path
    cfg_key = (_effective_path, min_phrase_s, amp_sensitivity)

    # Auto-load only when the effective file changes (chain or original);
    # settings changes require an explicit Re-analyse click so rapid slider
    # adjustments don't trigger a full re-assessment on every interaction.
    _last_cfg = st.session_state.last_loaded_cfg
    file_changed     = _last_cfg is None or cfg_key[0] != _last_cfg[0]
    settings_changed = not file_changed and cfg_key != _last_cfg

    _reanalyse_requested = st.session_state.pop("reanalyse_requested", False)

    _media_only = st.session_state.pop("_media_only_change", False)

    # Only auto-analyze if: (a) reanalyse explicitly requested, or
    # (b) file changed AND we have a cached assessment to load (fast resume).
    # Full analysis on first load runs on Project Accept, not here.
    _forge_proj = st.session_state.get("forge_project")
    _output_folder = _forge_proj.get("output_folder", "") if _forge_proj else ""
    _cached_assessment = os.path.join(_output_folder, "_assessment.json") if _output_folder else ""
    _has_cache = _cached_assessment and os.path.isfile(_cached_assessment)

    _should_analyze = not _media_only and (_reanalyse_requested or (file_changed and _has_cache))
    if _should_analyze:
        import time

        # Use chain funscript if available, otherwise original
        _chain_path = st.session_state.get("chain_funscript_path")
        _analyse_path = _chain_path if (_chain_path and os.path.isfile(_chain_path)) else funscript_path

        _used_cache = False

        if file_changed and not _reanalyse_requested and _has_cache:
            try:
                st.session_state.project = Project.from_funscript(
                    _analyse_path,
                    existing_assessment_path=_cached_assessment,
                )
                _used_cache = True
            except Exception:
                pass  # fall through to full analysis

        if not _used_cache:
            # Count actions for progress display
            try:
                import json as _json_count
                with open(_analyse_path, encoding="utf-8") as _fc:
                    _action_count = len(_json_count.load(_fc).get("actions", []))
            except Exception:
                _action_count = 0

            _status = st.sidebar.status(f"Analysing {_action_count:,} actions…", expanded=True)

            def _on_stage(stage: str) -> None:
                _status.update(label=f"Analysing: {stage}")

            _t0 = time.time()
            st.session_state.project = Project.from_funscript(
                _analyse_path,
                analyzer_config=analyzer_cfg,
                progress_callback=_on_stage,
            )
            _elapsed = time.time() - _t0
            st.session_state.last_assessment_elapsed = _elapsed

        st.session_state.last_loaded_cfg  = cfg_key
        st.session_state.last_loaded_file = selected_file
        st.session_state.view_state       = ViewState()
        # Invalidate chart cache bands (phrase boundaries changed)
        _cc = st.session_state.get("_chart_cache")
        if _cc:
            _cc.set_bands([])  # Force rebuild on next render
            _cc._png_cache.clear()
        if _IS_LOCAL:
            _save_recents(output_dir, funscript_path)
        st.session_state.export_rejected  = set()
        st.session_state.export_accepted  = set()

        _s = st.session_state.project.summary()
        if not _used_cache:
            _status.write(
                f"✅ {_s['phrases']} phrases, {_s['patterns']} patterns, "
                f"~{_s['bpm']:.0f} BPM ({_elapsed:.1f}s)"
            )
            _status.update(label="Assessment complete!", state="complete", expanded=False)

        # Auto-update the pattern catalog with this funscript's tagged phrases
        try:
            _proj    = st.session_state.project
            _phrases = _proj.assessment.to_dict().get("phrases", [])
            _cat     = st.session_state.pattern_catalog
            _cat.add_assessment(
                funscript_name=selected_file,
                phrases=_phrases,
                duration_ms=_proj.assessment.duration_ms,
            )
            _cat.save()
        except Exception as _cat_err:
            # Best-effort — never block the UI, but surface disk/permission errors.
            st.sidebar.warning(f"Pattern catalog could not be saved: {_cat_err}")

        st.rerun()

    st.sidebar.markdown("---")

    # --- Build ProjectStatus snapshot and render via component ---
    from forge_ui_components.project_status.core import ProjectStatus
    from forge_ui_components.project_status.streamlit import render_full_sidebar_status

    _forge = st.session_state.get("forge_project")
    _status = ProjectStatus()

    if _forge:
        _progress = _forge.get("progress", {})
        _status.tabs_completed = {
            "Project": st.session_state.get("project_accepted", False),
            "Device": st.session_state.get("device_accepted", False),
            "Tone": _progress.get("tone_applied", False),
            "Phrases": _progress.get("phrases_edited", False),
            "Patterns": _progress.get("patterns_edited", False),
            "Export": _progress.get("exported", False),
        }
        _status.tone_name = _forge.get("tone", "")
        _status.device_targets = _forge.get("output_targets", [])

        # Undo
        _history = _forge.get("history", [])
        if _history:
            _last = _history[-1]
            _status.has_undo = True
            _status.last_action_tab = _last.get("tab", "unknown").title()
            _status.last_action_desc = _undo_description(_last)

        # Next step
        _workflow = list(_status.tabs_completed.items())
        _next = _next_workflow_step(_workflow)
        if _next:
            _status.next_step_name = _next[0]
            _status.next_step_desc = _next[1]

    # Assessment stats
    project: Project | None = st.session_state.project
    if project and project.is_loaded:
        s = project.summary()
        _status.project_name = _forge.get("name", "Project") if _forge else project.name
        _status.funscript_name = os.path.basename(st.session_state.get("funscript_path", ""))
        _status.phrase_count = s["phrases"]
        _status.transition_count = s["bpm_transitions"]
        _status.pattern_count = s["patterns"]
        _status.bpm_avg = s["bpm"]
        _status.assessment_elapsed_s = st.session_state.last_assessment_elapsed

        _phrases_data = project.assessment.to_dict().get("phrases", [])
        _bpms = [p["bpm"] for p in _phrases_data if p.get("bpm")]
        if _bpms:
            _status.bpm_min = min(_bpms)
            _status.bpm_max = max(_bpms)

        # Transform categories
        from pattern_catalog.phrase_transforms import get_transforms_by_category
        _status.transform_categories = {
            cat: len(pairs) for cat, pairs in get_transforms_by_category().items()
        }

        # Editing progress
        _status.phrases_edited = sum(
            1 for i in range(s["phrases"])
            if st.session_state.get(f"phrase_transform_chain_{i}")
        )
        _status.pattern_instances_applied = sum(
            1 for k, v in st.session_state.items()
            if k.startswith("pe_apply_") and v is True
        )

    with st.sidebar:
        # New Project button — prominent, at the top of status area
        if st.button("🔨 New Project", use_container_width=True,
                      help="Start a new project. Recent projects are kept."):
            _clear_keys = [
                "forge_project", "funscript_path", "video_path",
                "output_folder_input", "output_folder_pending",
                "_funscript_processed", "_video_processed",
                "_audio_processed", "_captions_processed",
                "chain_funscript_path",
                "project_accepted", "device_accepted", "tone_accepted",
                "tone_global", "show_tone_suggestions", "export_complete",
            ]
            _motion_keys = [k for k in st.session_state if k.startswith("motion_")]
            _tone_keys = [k for k in st.session_state if k.startswith("tone_flip_") or k.startswith("tone_impact_")]
            for _k in _clear_keys + _motion_keys + _tone_keys:
                st.session_state.pop(_k, None)
            st.session_state["project_ver"] = st.session_state.get("project_ver", 0) + 1
            st.rerun()

        render_full_sidebar_status(_status)

        # Undo button (interactive — stays in app.py)
        if _status.has_undo:
            if st.button("↩ Undo", help=f"Undo {_status.last_action_tab} Accept", use_container_width=True):
                _perform_undo(_forge)
                st.rerun()

    _render_sidebar_footer()


def _render_sidebar_footer() -> None:
    """Liquid Releasing logo + copyright notice at the bottom of the sidebar."""
    _lr_logo = os.path.join(_ROOT, "media", "liquid-releasing-Color-Logo.svg")
    st.sidebar.markdown("---")
    if os.path.exists(_lr_logo):
        with open(_lr_logo, encoding="utf-8") as _f:
            _svg = _f.read()
        # Render as an inline HTML block — Streamlit supports SVG via unsafe_allow_html.
        st.sidebar.markdown(
            f'<div style="text-align:center;opacity:0.65;padding:4px 0;">'
            f'<div style="max-width:50%;margin:0 auto;">{_svg}</div>'
            f'<div style="font-size:10px;color:#888;margin-top:4px;line-height:1.4;">'
            f'© 2026 Liquid Releasing<br>MIT License</div>'
            f'</div>',
            unsafe_allow_html=True,
        )
    else:
        st.sidebar.caption("© 2026 Liquid Releasing · MIT License")


# ------------------------------------------------------------------
# Main area
# ------------------------------------------------------------------


def _main() -> None:
    project: Project | None = st.session_state.project

    tab_project, tab_device, tab_tone, tab_phrase, tab_pattern, tab_transforms, tab_stim, tab_export, tab_next = st.tabs(
        ["Project", "Device", "Tone", "Phrases", "Patterns", "Catalogs", "Stim", "Export", "Next Steps"]
    )

    with tab_project:
        project_tab.render()

    with tab_device:
        device_tab.render()

    with tab_tone:
        tone_tab.render()

    if project is None or not project.is_loaded:
        with tab_phrase:
            st.info("Load a project in the **Project** tab to get started.")
        with tab_pattern:
            st.info("Load a project in the **Project** tab to get started.")
        with tab_transforms:
            st.info("Load a project in the **Project** tab to get started.")
        with tab_stim:
            st.info("Load a project in the **Project** tab to get started.")
        with tab_export:
            st.info("Load a project in the **Project** tab to get started.")
        with tab_next:
            next_steps_tab.render()
        return

    with tab_phrase:
        _render_phrase_tab(project)

    with tab_pattern:
        _render_pattern_editor_tab(project)

    with tab_transforms:
        transform_catalog_panel.render()

    with tab_stim:
        stim_panel.render(project)

    with tab_export:
        export_panel.render(project)

    with tab_next:
        next_steps_tab.render()

    # Keyboard shortcuts — registered once per page load via a sentinel flag on
    # window.parent so reruns don't stack duplicate listeners.
    #   Ctrl+Z        → Undo
    #   Ctrl+Y        → Redo
    #   Ctrl+Shift+Z  → Redo (macOS convention)
    #   Ctrl+S        → Save project
    import streamlit.components.v1 as _comp
    _comp.html(
        """<script>
        (function() {
            var p = window.parent;
            if (p.__forgeKeysRegistered) return;
            p.__forgeKeysRegistered = true;

            // M5: ensure screen readers use English pronunciation rules.
            p.document.documentElement.lang = 'en';

            function clickButton(startsWith) {
                var btns = p.document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if (btns[i].textContent.trim().startsWith(startsWith)
                            && !btns[i].disabled) {
                        btns[i].click();
                        return true;
                    }
                }
                return false;
            }

            p.document.addEventListener('keydown', function(e) {
                var ctrl = e.ctrlKey || e.metaKey;
                if (!ctrl) return;

                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    clickButton('\u21a9');        // ↩ Undo
                } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                    e.preventDefault();
                    clickButton('\u21aa');        // ↪ Redo
                } else if (e.key === 's') {
                    e.preventDefault();
                    clickButton('Save project'); // sidebar Save project
                }
            });
        })();
        </script>""",
        height=0,
    )


def _render_welcome() -> None:
    """Onboarding welcome screen shown before any funscript is loaded."""
    _media = lambda name: os.path.join(_ROOT, "media", name)  # noqa: E731

    # Centered wide wordmark logo
    _il, _ic, _ir = st.columns([1, 4, 1])
    with _ic:
        if os.path.exists(_media("funscriptforge-logo-wide.png")):
            st.image(_media("funscriptforge-logo-wide.png"), width="stretch")
        elif os.path.exists(_media("funscriptforge.png")):
            st.image(_media("funscriptforge.png"), width="stretch")

    st.markdown(
        "**FunscriptForge** analyses funscripts, detects phrase structure and motion "
        "patterns, and lets you apply per-phrase transforms before exporting a clean, "
        "device-aware output file."
    )
    st.divider()

    # Workflow icon row — one column per main tab
    _icons = [
        ("anvil.png",     "Phrase Selector",   "Analyse & select phrases"),
        ("worktable.png", "Pattern Editor",     "Shape motion patterns"),
        ("oven.png",      "Catalogs",           "Browse transforms & tag reference"),
    ]
    icon_cols = st.columns(len(_icons))
    for col, (img, label, desc) in zip(icon_cols, _icons):
        with col:
            if os.path.exists(_media(img)):
                st.image(_media(img), width="stretch")
            st.markdown(
                f'<div style="text-align:center"><strong>{label}</strong><br>{desc}</div>',
                unsafe_allow_html=True,
            )

    st.divider()

    c1, c2 = st.columns(2)
    with c1:
        st.markdown(
            "#### How to get started\n\n"
            "1. **Open a funscript** — paste the file path in the sidebar "
            "(or upload it if using the web UI).\n\n"
            "2. **Add matching media** *(optional)* — point to the audio or video "
            "file so you can hear each phrase while editing.\n\n"
            "3. **Select a phrase** — the **Phrase Selector** tab shows the full "
            "funscript as a chart.  Click any phrase band or use the Edit buttons "
            "to open it for detail editing.\n\n"
            "4. **Shape patterns** — the **Pattern Editor** tab lets you batch-apply "
            "transforms to every phrase sharing the same motion pattern.\n\n"
            "5. **Export** — the **Export** tab runs a quality check, previews all "
            "accepted transforms, and downloads the final funscript."
        )
    with c2:
        st.markdown(
            "#### What the assessment detects\n\n"
            "| Stage | What it finds |\n"
            "| --- | --- |\n"
            "| Phases | Individual up/down strokes |\n"
            "| Cycles | Complete oscillations (one full stroke pair) |\n"
            "| Patterns | Runs of similar cycles grouped by tempo & depth |\n"
            "| Phrases | Contiguous sections with stable motion character |\n"
            "| BPM transitions | Points where tempo shifts significantly |\n\n"
            "Each phrase is automatically tagged with a **behavioural label** "
            "(frantic, edging, teasing, build, etc.) that drives transform suggestions."
        )

    st.divider()
    st.caption(
        "Tip: **Phrase detection settings** in the Phrase Selector tab control how "
        "aggressively short phrases are merged and how sensitive the amplitude-change "
        "detector is. Re-analyse any time after adjusting them."
    )


def _render_phrase_tab(project: Project) -> None:
    """Phrases tab — shows Selector when nothing is selected, Editor when a phrase is selected.

    Switching between the two views is driven entirely by view_state.has_selection(),
    so Done/Close simply clears the selection and reruns — no JS tab clicks needed.

    The table selection is pre-processed HERE, before deciding which view to render,
    to avoid a one-render lag where the Editor would open for the previously-selected
    phrase rather than the one just clicked.
    """
    if project.assessment is None:
        st.info("Run **Accept** on the Project tab first to analyse your funscript.", icon="ℹ️")
        return

    view_state = st.session_state.view_state
    assessment_dict = project.assessment.to_dict()
    phrases = assessment_dict.get("phrases", [])

    # Read pending table-row click straight from widget session state.
    # on_select="rerun" stores the selection in st.session_state[key] before
    # the rerun fires, so we can process it here, at the very top, and set
    # view_state.selection before choosing which view to render.
    _tver = st.session_state.get("phrase_table_ver", 0)
    _tstate = st.session_state.get(f"phrase_table_{_tver}")
    if _tstate is not None and phrases:
        _rows = getattr(getattr(_tstate, "selection", None), "rows", [])
        if _rows and 0 <= _rows[0] < len(phrases):
            ph = phrases[_rows[0]]
            view_state.selection_start_ms = ph["start_ms"]
            view_state.selection_end_ms   = ph["end_ms"]
            # Bump version so the widget reinitialises with no selection next render.
            st.session_state["phrase_table_ver"] = _tver + 1

    if view_state.has_selection():
        _render_phrase_editor_tab(project)
    else:
        _render_phrase_selector_tab(project)


def _render_phrase_selector_tab(project: Project) -> None:
    """Phrase Selector view — full chart + phrase table."""
    view_state = st.session_state.view_state
    assessment_dict = project.assessment.to_dict()

    with st.expander("Phrase detection settings", expanded=False):
        _dc1, _dc2 = st.columns(2)
        _min_phrase_s = _dc1.slider(
            "Min phrase length (s)", min_value=5, max_value=120,
            value=st.session_state.get("min_phrase_s", 20), step=5,
            key="min_phrase_s",
            help="Phrases shorter than this are merged into a neighbour.",
        )
        _amp_sensitivity = _dc2.select_slider(
            "Amplitude sensitivity",
            options=["Low (0.35)", "Medium (0.30)", "High (0.25)"],
            value=st.session_state.get("amp_sensitivity", "Medium (0.30)"),
            key="amp_sensitivity",
            help="How much stroke-depth change triggers a new phrase.",
        )
        _last_cfg = st.session_state.get("last_loaded_cfg")
        _loaded_file = st.session_state.get("last_loaded_file", "")
        _settings_changed = (
            _last_cfg is not None
            and (_min_phrase_s, _amp_sensitivity) != (_last_cfg[1], _last_cfg[2])
        )
        if _settings_changed:
            st.info("Settings changed — click **Re-analyse** to apply.")
        if st.button("Re-analyse", type="primary", key="reanalyse_btn"):
            st.session_state.reanalyse_requested = True
            st.rerun()

    viewer_panel.render(
        project, view_state,
        large_funscript_threshold=st.session_state.large_funscript_threshold,
    )

    with st.expander("Assessment details", expanded=False):
        assessment_panel.render(project)

    # ── Phrases Accept ────────────────────────────────────────────────────
    st.divider()

    # Check if any phrases have been edited
    _n_phrases = len(assessment_dict.get("phrases", []))
    _phrases_edited = sum(
        1 for i in range(_n_phrases)
        if st.session_state.get(f"phrase_transform_chain_{i}")
    )
    _has_edits = _phrases_edited > 0

    if _has_edits:
        st.info(
            f"**{_phrases_edited}** of **{_n_phrases}** phrases edited. "
            "Click **Accept** to save all phrase edits to the project."
        )

    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        help="Save phrase edits and continue to the next step.",
    ):
        from ui.streamlit.panels.phrase_detail import _save_phrase_edits_to_chain
        _forge = st.session_state.get("forge_project")

        status = st.status("Saving phrase edits…", expanded=True)

        phrases = assessment_dict.get("phrases", [])
        _save_phrase_edits_to_chain(phrases)
        status.write(f"✅ Phrase edits saved ({_phrases_edited} phrases modified)")

        # Rebuild vibrant chart cache with edited actions
        status.update(label="Rebuilding chart data…")
        from forge_ui_components.funscript_chart.core import compute_chart_data
        import json
        _chain_path = st.session_state.get("chain_funscript_path")
        if _chain_path and os.path.isfile(_chain_path):
            with open(_chain_path) as f:
                _edited_actions = json.load(f).get("actions", [])
            st.session_state["cached_vibrant_series"] = compute_chart_data(_edited_actions)
            status.write(f"✅ Chart data updated: {len(_edited_actions):,} actions")

        # Update workflow progress
        if _forge:
            _forge.setdefault("progress", {})["phrases_edited"] = True
            from forge.project import save_forge
            save_forge(_forge)

        status.update(label="Phrases complete!", state="complete", expanded=False)
        st.session_state["phrases_accepted"] = True
        st.rerun()

    if st.session_state.get("phrases_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        _forge = st.session_state.get("forge_project")
        _targets = _forge.get("output_targets", []) if _forge else []
        _has_estim = any("estim" in t for t in _targets)
        _next_options = ["**Patterns**"]
        if _has_estim:
            _next_options.append("**Stim**")
        _next_options.append("**Export**")
        success_guidance(
            f"Scroll to top to select your next tab: {', '.join(_next_options)}."
        )


def _render_phrase_editor_tab(project: Project) -> None:
    """Phrase Editor view — single-phrase editor with prev/next navigation."""
    from ui.streamlit.panels import phrase_detail

    view_state = st.session_state.view_state
    assessment_dict = project.assessment.to_dict()
    phrases     = assessment_dict.get("phrases", [])
    duration_ms = project.assessment.duration_ms

    # Close button — clearing selection switches the Phrase tab back to Selector view.
    if st.button("✕  Close and return to Phrase Selector", key="editor_close"):
        view_state.clear_selection()
        view_state.reset_zoom()
        st.session_state["phrase_table_ver"] = st.session_state.get("phrase_table_ver", 0) + 1
        st.rerun()

    phrase_detail.render(
        phrases=phrases,
        view_state=view_state,
        duration_ms=duration_ms,
        bpm_threshold=st.session_state.get("bpm_threshold", 120.0),
    )


def _render_pattern_editor_tab(project: Project) -> None:
    """Tab 2 — Pattern Behaviors catalog (collapsible) then Pattern Editor."""
    if project.assessment is None:
        st.info("Run **Accept** on the Project tab first to analyse your funscript.", icon="ℹ️")
        return
    with st.expander("Pattern Behaviors catalog", expanded=False):
        catalog_view_panel.render(project)
    pattern_editor_panel.render(project)


def _commit_actions(project: Project, committed_actions: list) -> None:
    """Replace the project's funscript data with committed_actions and re-assess."""
    import json
    import tempfile
    import streamlit as st
    from ui.streamlit.undo_helpers import push_undo

    push_undo("Edit phrase actions")

    with tempfile.NamedTemporaryFile(
        suffix=".funscript", delete=False, mode="w"
    ) as tmp:
        with open(project.funscript_path) as src:
            data = json.load(src)
        data["actions"] = committed_actions
        json.dump(data, tmp)
        tmp_path = tmp.name

    with st.spinner("Re-assessing…"):
        updated = Project.from_funscript(tmp_path)
        # Carry the funscript path back so future loads still work
        updated.funscript_path = project.funscript_path
        st.session_state.project = updated
        st.session_state.proposed_actions = None
        st.session_state.view_state = ViewState()

    os.unlink(tmp_path)
    st.success("Committed. Assessment rebuilt.")
    st.rerun()


# ------------------------------------------------------------------
# Entry
# ------------------------------------------------------------------

_sidebar()
_main()
