"""
Tab 1 — Project

Landing page. Output folder = the project.
Required: project name, output folder, funscript.
Everything else optional.
"""

import json
import tempfile
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

from forge.project import (
    add_input_file,
    default_forge,
    get_input_file,
    load_forge,
    save_forge,
)
from forge.funscript import funscript_stats, load_funscript, parse_actions


def _browse_for_folder() -> str | None:
    """Open an OS folder picker dialog. Returns path or None if cancelled."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Choose project output folder")
        root.destroy()
        return folder or None
    except Exception:
        return None


def render():
    # ── session state init ──────────────────────────────────────────────────
    if "forge_project" not in st.session_state:
        st.session_state.forge_project = None

    project = st.session_state.forge_project

    # ── Funscript (required) — inspect only, no saving yet ───────────────────
    st.subheader("Funscript")
    _funscript_section()

    # ── Optional media ───────────────────────────────────────────────────────
    st.markdown("""<style>
    div[data-testid="stExpander"] summary p { font-size: 1.25rem; font-weight: 600; }
    </style>""", unsafe_allow_html=True)
    with st.expander("Media *(optional)*"):
        _video_section(project if project else {})
        _audio_section(project if project else {})
        _captions_section(project if project else {})

    # ── Output folder (required, last) ───────────────────────────────────────
    st.subheader("Output folder")
    st.caption("All output goes here. Input files are never touched.")

    col_path, col_browse = st.columns([5, 1])
    with col_path:
        output_folder = st.text_input(
            "Output folder path",
            value=project["output_folder"] if project else "",
            placeholder="/path/to/my-project/",
            label_visibility="collapsed",
            key="output_folder_input",
        )
    with col_browse:
        if st.button("Browse…", use_container_width=True):
            picked = _browse_for_folder()
            if picked:
                st.session_state["output_folder_input"] = picked
                output_folder = picked

    if output_folder and output_folder != (project or {}).get("output_folder", ""):
        existing = load_forge(output_folder)
        if existing:
            st.session_state.forge_project = existing
            st.success(f"Resumed project: **{existing['name']}**")
        else:
            folder = Path(output_folder)
            proj_name = name or folder.name
            st.session_state.forge_project = default_forge(proj_name, output_folder)
            save_forge(st.session_state.forge_project)
            st.success(f"Created project: **{proj_name}**")
        st.rerun()

    project = st.session_state.forge_project
    if not project:
        st.info("Enter a project name, funscript, and output folder to get started.")
        return

    # ── Output targets ───────────────────────────────────────────────────────
    st.subheader("Output targets")
    st.caption("Choose which devices to export for. All selected targets are generated automatically at export.")

    _TARGETS = [
        ("estim_foc",    "Estim — Focus",   "Single-channel estim. Classic waveform."),
        ("estim_stereo", "Estim — Stereo",  "Dual-channel estim. Left/right separation."),
        ("handy",        "The Handy",       "Linear stroker. Industry standard."),
        ("osr2",         "OSR2",            "Multi-axis stroker. Twist + stroke."),
    ]
    saved_targets = project.get("output_targets", ["estim_foc", "handy"])
    selected = []
    cols = st.columns(len(_TARGETS))
    for col, (key, label, desc) in zip(cols, _TARGETS):
        with col:
            checked = col.checkbox(label, value=key in saved_targets, help=desc, key=f"target_{key}")
            if checked:
                selected.append(key)

    if selected != saved_targets:
        project["output_targets"] = selected
        save_forge(project)

    # ── Project metadata ────────────────────────────────────────────────────
    st.divider()
    with st.expander("Author & credits (optional)"):
        author = st.text_input("Author", value=project.get("author", ""))
        website = st.text_input("Website / Patreon URL", value=project.get("website", ""))
        contributors_raw = st.text_input(
            "Contributors (comma-separated)",
            value=", ".join(project.get("contributors", [])),
        )
        contributors = [c.strip() for c in contributors_raw.split(",") if c.strip()]

        if (author != project.get("author") or
                website != project.get("website") or
                contributors != project.get("contributors")):
            project["author"] = author
            project["website"] = website
            project["contributors"] = contributors
            save_forge(project)

    # ── Summary ─────────────────────────────────────────────────────────────
    st.divider()
    _summary(project)

    # ── Navigation ──────────────────────────────────────────────────────────
    st.divider()
    col1, col2 = st.columns([1, 1])
    with col1:
        if st.button("→ Next Step", type="primary", use_container_width=True):
            _go_next(project)
    with col2:
        if st.button("New Project", use_container_width=True):
            save_forge(project)
            st.session_state.forge_project = None
            st.rerun()


# ── Media sections ──────────────────────────────────────────────────────────

def _browse_for_file(title: str, filetypes: list) -> str | None:
    """Open an OS file picker. filetypes e.g. [('Funscript', '*.funscript')]"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
        root.destroy()
        return path or None
    except Exception:
        return None


def _funscript_section():
    """Inspect a funscript — drag-drop, chart preview. No saving."""
    uploaded = st.file_uploader(
        "Drag and drop or browse",
        type=["funscript"],
        key="funscript_upload",
        label_visibility="collapsed",
    )
    if uploaded:
        current = st.session_state.get("funscript_path", "")
        if Path(current).name != uploaded.name:
            tmp = Path(tempfile.mkdtemp()) / uploaded.name
            tmp.write_bytes(uploaded.read())
            st.session_state["funscript_path"] = str(tmp)

    # Preview
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and Path(funscript_path).exists():
        data = load_funscript(funscript_path)
        if data:
            _funscript_chart(data, funscript_path)
            _funscript_stats_table(data)
        else:
            st.error("Could not parse funscript file.")


def _funscript_chart(data: dict, path: str):
    times, positions = parse_actions(data)
    if not times:
        return

    times_s = [t / 1000.0 for t in times]

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=times_s,
        y=positions,
        mode="lines",
        line=dict(color="#4C8BF5", width=1.5),
        name="position",
    ))
    fig.update_layout(
        height=180,
        margin=dict(l=0, r=0, t=0, b=0),
        xaxis=dict(title="time (s)", showgrid=False),
        yaxis=dict(title="pos", range=[0, 100], showgrid=False),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0.05)",
        showlegend=False,
    )
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
    st.caption(f"📄 {Path(path).name}")


def _funscript_stats_table(data: dict):
    stats = funscript_stats(data)
    if not stats:
        return
    cols = st.columns(5)
    cols[0].metric("Duration", stats["duration_fmt"])
    cols[1].metric("Actions", f"{stats['action_count']:,}")
    cols[2].metric("Avg speed", f"{stats['avg_speed']:.0f}")
    cols[3].metric("Min pos", stats["min_pos"])
    cols[4].metric("Max pos", stats["max_pos"])


def _video_section(project: dict):
    st.markdown("**Source video** *(optional)*")
    existing = get_input_file(project, "video")

    uploaded_video = st.file_uploader(
        "Drag and drop or browse",
        type=["mp4", "mov", "avi", "mkv"],
        key="video_upload",
        label_visibility="collapsed",
    )
    if uploaded_video and project.get("output_folder"):
        dest = Path(project["output_folder"]) / f"_input_{uploaded_video.name}"
        dest.write_bytes(uploaded_video.read())
        add_input_file(project, "video", str(dest))
        save_forge(project)
        st.rerun()

    if existing:
        st.caption(f"📹 {Path(existing).name}")
        _duration_match_check(project, "video")


def _audio_section(project: dict):
    st.markdown("**Audio** *(optional)* — beat track or alternative audio")
    existing = get_input_file(project, "audio")

    uploaded = st.file_uploader(
        "Upload audio",
        type=["mp3", "wav", "flac", "ogg"],
        key="audio_upload",
        label_visibility="collapsed",
    )
    if uploaded:
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "audio", str(dest))
        save_forge(project)
        st.rerun()

    if existing and Path(existing).exists():
        st.caption(f"♪ {Path(existing).name}")
        use_for_playback = st.checkbox(
            "Use this audio for playback in FunScriptForge",
            value=project.get("audio_playback", False),
            key="audio_playback_checkbox",
        )
        if use_for_playback != project.get("audio_playback", False):
            project["audio_playback"] = use_for_playback
            save_forge(project)


def _captions_section(project: dict):
    st.markdown("**Captions** *(optional)* — .srt for semantic haptic generation")
    existing = get_input_file(project, "captions")

    uploaded = st.file_uploader(
        "Upload captions",
        type=["srt", "vtt", "ass"],
        key="captions_upload",
        label_visibility="collapsed",
    )
    if uploaded:
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "captions", str(dest))
        save_forge(project)
        st.rerun()

    if existing:
        st.caption(f"💬 {Path(existing).name}")


def _duration_match_check(project: dict, role: str):
    """Show green check if media duration ≈ funscript duration."""
    funscript_path = get_input_file(project, "funscript")
    if not funscript_path:
        return
    data = load_funscript(funscript_path)
    if not data:
        return
    stats = funscript_stats(data)
    if stats:
        st.caption(f"Funscript duration: {stats['duration_fmt']}")


# ── Summary ──────────────────────────────────────────────────────────────────

def _summary(project: dict):
    st.markdown("**Summary**")
    p = project.get("progress", {})

    has_funscript = bool(get_input_file(project, "funscript"))

    items = [
        ("Output folder", True),
        ("Funscript", has_funscript),
        ("Tone applied", p.get("tone_applied", False)),
        ("Exported", p.get("exported", False)),
    ]
    for label, done in items:
        icon = "✅" if done else "⬜"
        st.write(f"{icon} {label}")


# ── Navigation ───────────────────────────────────────────────────────────────

def _go_next(project: dict):
    has_funscript = bool(get_input_file(project, "funscript"))
    if not has_funscript:
        st.warning("Add a funscript before continuing.")
        return
    # signal to app.py to switch tab
    st.session_state.active_tab = "tone"
    st.rerun()
