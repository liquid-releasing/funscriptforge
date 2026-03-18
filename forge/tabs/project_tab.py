"""
Tab 1 — Project

Single-column top-to-bottom flow:
  1. Funscript (required)
  2. Export location
  3. Output targets
  4. Media (optional)
  5. Author & credits (optional)
  6. Summary
  7. Continue → / New Project
"""

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
from forge.video import analyze_motion, video_stats

_APP_ROOT = Path(__file__).parents[2]
_ASSETS_OUTPUT = _APP_ROOT / "assets" / "output"


def _default_output_for(funscript_path: str) -> Path:
    stem = Path(funscript_path).name.split(".")[0]
    return _ASSETS_OUTPUT / stem


def _browse_for_folder() -> str | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
        last = st.session_state.get("last_browse_dir", str(_ASSETS_OUTPUT))
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        folder = filedialog.askdirectory(
            title="Choose project output folder",
            initialdir=last,
        )
        root.destroy()
        if folder:
            st.session_state["last_browse_dir"] = str(Path(folder).parent)
            return folder
        return None
    except Exception:
        return None


def _ver() -> int:
    """Widget version counter — incremented on Clear Project to reset all widgets."""
    return st.session_state.get("project_ver", 0)


def render():
    if "forge_project" not in st.session_state:
        st.session_state.forge_project = None

    project = st.session_state.forge_project
    v = _ver()

    # ── 1. Funscript ─────────────────────────────────────────────────────────
    st.subheader("Funscript")
    _funscript_section(v)

    # Auto-create project from funscript if not yet created
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and not project:
        auto_folder = str(_default_output_for(funscript_path))
        _ASSETS_OUTPUT.mkdir(parents=True, exist_ok=True)
        existing = load_forge(auto_folder)
        if existing:
            st.session_state.forge_project = existing
        else:
            stem = Path(funscript_path).name.split(".")[0]
            proj = default_forge(stem, auto_folder)
            Path(auto_folder).mkdir(parents=True, exist_ok=True)
            save_forge(proj)
            st.session_state.forge_project = proj
        # Seed export location input for the new project
        st.session_state.pop("output_folder_input", None)
        st.rerun()

    project = st.session_state.forge_project

    # Reconcile funscript path into project
    if project:
        funscript_path = st.session_state.get("funscript_path", "")
        if funscript_path and funscript_path != get_input_file(project, "funscript"):
            add_input_file(project, "funscript", funscript_path)
            save_forge(project)

    st.divider()

    # ── 2. Export location ───────────────────────────────────────────────────
    st.subheader("Export location")
    st.caption("All output goes here. Input files are never touched.")

    funscript_path = st.session_state.get("funscript_path", "")
    auto_output = str(_default_output_for(funscript_path)) if funscript_path else ""

    # Seed once; external changes (browse, funscript drop) pop the key to reseed
    if "output_folder_input" not in st.session_state:
        st.session_state["output_folder_input"] = (
            project["output_folder"] if project else auto_output
        )
    if "output_folder_pending" in st.session_state:
        st.session_state["output_folder_input"] = st.session_state.pop("output_folder_pending")

    col_path, col_browse, col_set = st.columns([5, 1, 1])
    with col_browse:
        if st.button("Browse…", key="output_folder_browse", use_container_width=True):
            picked = _browse_for_folder()
            if picked:
                st.session_state["output_folder_pending"] = picked
                st.rerun()
    with col_path:
        output_folder = st.text_input(
            "Export location path",
            placeholder=auto_output or r"C:\Users\you\Videos\my-scene",
            label_visibility="collapsed",
            key="output_folder_input",
        )
    with col_set:
        set_clicked = st.button("Set", key="output_folder_set", use_container_width=True)

    if set_clicked and output_folder:
        folder = output_folder.strip()
        if folder != (project or {}).get("output_folder", ""):
            existing = load_forge(folder)
            if existing:
                st.session_state.forge_project = existing
                st.success(f"Resumed: **{existing['name']}**")
            else:
                stem = Path(folder).name
                new_proj = default_forge(stem, folder)
                st.session_state.forge_project = new_proj
                save_forge(new_proj)
                st.success(f"Project folder set: **{stem}**")
            st.rerun()

    project = st.session_state.forge_project

    st.divider()

    # ── 3. Output targets ────────────────────────────────────────────────────
    st.subheader("Output targets")
    st.caption("All checked targets are generated automatically at export.")

    _TARGETS = [
        ("estim_foc",    "Estim — FOC",    "Single-channel estim. Classic waveform."),
        ("estim_stereo", "Estim — Stereo", "Dual-channel estim. Left/right separation."),
        ("handy",        "The Handy",      "Linear stroker. Industry standard."),
        ("osr2",         "OSR2",           "Multi-axis stroker. Twist + stroke."),
    ]
    saved_targets = (project or {}).get("output_targets", ["handy"])
    selected = []
    cols = st.columns(len(_TARGETS))
    for col, (key, label, desc) in zip(cols, _TARGETS):
        with col:
            if col.checkbox(label, value=key in saved_targets, help=desc,
                            key=f"target_{key}_{v}"):
                selected.append(key)

    if project and selected != saved_targets:
        project["output_targets"] = selected
        save_forge(project)

    st.divider()

    # ── 4. Media ─────────────────────────────────────────────────────────────
    has_media = bool(
        get_input_file(project, "video") if project else None or
        st.session_state.get("video_path") or
        (get_input_file(project, "audio") if project else None) or
        (get_input_file(project, "captions") if project else None)
    )
    with st.expander("Media *(optional)*", expanded=has_media, key="media_expander"):
        _video_section(project, v)
        st.divider()
        _audio_section(project, v)
        st.divider()
        _captions_section(project, v)

    # ── 5. Author & credits ──────────────────────────────────────────────────
    with st.expander("Author & credits *(optional)*"):
        author = st.text_input("Author", value=(project or {}).get("author", ""))
        website = st.text_input("Website / Patreon URL",
                                value=(project or {}).get("website", ""))
        contributors_raw = st.text_input(
            "Contributors (comma-separated)",
            value=", ".join((project or {}).get("contributors", [])),
        )
        if project:
            contributors = [c.strip() for c in contributors_raw.split(",") if c.strip()]
            if (author != project.get("author") or
                    website != project.get("website") or
                    contributors != project.get("contributors")):
                project["author"] = author
                project["website"] = website
                project["contributors"] = contributors
                save_forge(project)

    st.divider()

    # ── 6. Summary ───────────────────────────────────────────────────────────
    st.subheader("Summary")
    _summary(project)

    st.divider()

    # ── 7. Navigation ────────────────────────────────────────────────────────
    diff = st.session_state.get("duration_mismatch_s")
    if diff:
        st.warning(
            f"Video and funscript differ by **{diff:.0f}s**. Double-check your files before continuing."
        )

    has_funscript = bool(st.session_state.get("funscript_path"))
    col_export, col_phrases = st.columns(2)
    with col_export:
        if st.button(
            "Export Now",
            use_container_width=True,
            disabled=not has_funscript,
            help=None if has_funscript else "Add a funscript first.",
        ):
            st.session_state["nav_hint"] = "export"
            st.rerun()
    with col_phrases:
        if st.button(
            "Continue to Edit Phrases →",
            type="primary",
            use_container_width=True,
            disabled=not has_funscript,
            help=None if has_funscript else "Add a funscript first.",
        ):
            st.session_state["nav_hint"] = "phrases"
            st.rerun()

    hint = st.session_state.pop("nav_hint", None)
    if hint == "export":
        st.info("Click the **Export** tab above.")
    elif hint == "phrases":
        st.info("Click the **Phrases** tab above.")


# ── Funscript ────────────────────────────────────────────────────────────────

def _funscript_section(v: int):
    uploaded = st.file_uploader(
        "Drag and drop your funscript here",
        type=["funscript"],
        key=f"funscript_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded:
        tmp = Path(tempfile.mkdtemp()) / uploaded.name
        tmp.write_bytes(uploaded.read())
        st.session_state["funscript_path"] = str(tmp)
        st.session_state.pop("output_folder_input", None)  # reseed export path
        st.rerun()

    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and Path(funscript_path).exists():
        data = load_funscript(funscript_path)
        if data:
            _funscript_chart(data, funscript_path)
            _funscript_stats_row(data)
        else:
            st.error("Could not parse funscript file.")


def _funscript_chart(data: dict, path: str):
    times, positions = parse_actions(data)
    if not times:
        return
    times_s = [t / 1000.0 for t in times]
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=times_s, y=positions,
        mode="lines",
        line=dict(color="#4C8BF5", width=1.5),
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


def _funscript_stats_row(data: dict):
    stats = funscript_stats(data)
    if not stats:
        return
    cols = st.columns(5)
    cols[0].metric("Duration", stats["duration_fmt"])
    cols[1].metric("Actions", f"{stats['action_count']:,}")
    cols[2].metric("Avg speed", f"{stats['avg_speed']:.0f}")
    cols[3].metric("Min pos", stats["min_pos"])
    cols[4].metric("Max pos", stats["max_pos"])


# ── Media sections ───────────────────────────────────────────────────────────

def _video_section(project: dict | None, v: int):
    st.subheader("Source video")
    existing = get_input_file(project, "video") if project else None

    uploaded = st.file_uploader(
        "Drag and drop your video here",
        type=["mp4", "mov", "avi", "mkv"],
        key=f"video_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded:
        try:
            tmp = Path(tempfile.mkdtemp()) / uploaded.name
            tmp.write_bytes(uploaded.read())
        except OSError as e:
            if e.errno == 28:
                st.error("Not enough disk space to load this video. Free up space and try again.")
            else:
                st.error(f"Could not save video: {e}")
            return
        st.session_state["video_path"] = str(tmp)
        if project and project.get("output_folder"):
            import shutil
            Path(project["output_folder"]).mkdir(parents=True, exist_ok=True)
            dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
            try:
                shutil.copy2(str(tmp), str(dest))
            except OSError as e:
                st.error(f"Could not copy video to output folder: {e}")
                return
            add_input_file(project, "video", str(dest))
            save_forge(project)
            st.session_state["video_path"] = str(dest)
        st.rerun()

    # Prefer project-stored path (persistent), fall back to session state
    video_path = existing if (existing and Path(existing).exists()) else ""
    if not video_path:
        sp = st.session_state.get("video_path", "")
        if sp and Path(sp).exists():
            video_path = sp

    if video_path:
        st.caption(f"📹 {Path(video_path).name}")
        stats = video_stats(video_path)
        if stats:
            _video_stats_row(stats)
        if project and project.get("output_folder"):
            _video_heatmap(video_path, project)


_DURATION_WARN_S = 15  # warn if funscript and video differ by more than this


def _video_stats_row(stats: dict):
    funscript_path = st.session_state.get("funscript_path", "")
    match_icon = ""
    st.session_state.pop("duration_mismatch_s", None)
    if funscript_path and Path(funscript_path).exists():
        fs_data = load_funscript(funscript_path)
        if fs_data:
            fs_stats = funscript_stats(fs_data)
            if fs_stats and stats.get("duration_s"):
                diff = abs(stats["duration_s"] - fs_stats["duration_s"])
                if diff <= 5:
                    match_icon = " ✅"
                elif diff <= _DURATION_WARN_S:
                    match_icon = " ⚠️"
                else:
                    match_icon = " ⚠️"
                    st.session_state["duration_mismatch_s"] = diff
    cols = st.columns(6)
    cols[0].metric("Duration", stats["duration_fmt"] + match_icon)
    cols[1].metric("Resolution", stats["resolution"])
    cols[2].metric("Frame rate", stats["fps_fmt"])
    cols[3].metric("File size", stats["size_fmt"])
    cols[4].metric("Video", stats["video_codec"])
    cols[5].metric("Audio", stats["audio_codec"])
    diff = st.session_state.get("duration_mismatch_s")
    if diff:
        st.warning(
            f"Funscript and video durations differ by **{diff:.0f} seconds** "
            f"({_DURATION_WARN_S}s limit). Check that you have the right files. "
            "You can still continue."
        )


def _video_heatmap(video_path: str, project: dict):
    output_folder = project.get("output_folder", "")
    cache_key = f"motion_{video_path}"
    data = st.session_state.get(cache_key)

    if data is None:
        import json as _json
        cache_file = Path(output_folder) / "_video_motion.json"
        if cache_file.exists():
            try:
                cached = _json.loads(cache_file.read_text())
                if cached.get("source_path") == video_path:
                    st.session_state[cache_key] = cached
                    data = cached
            except Exception:
                pass

    if data is None:
        if st.button("Analyze motion", key="analyze_motion_btn", use_container_width=True):
            with st.spinner("Analyzing video motion… (runs once, cached after)"):
                data = analyze_motion(video_path, output_folder)
                if data:
                    st.session_state[cache_key] = data
                else:
                    st.error("Could not analyze video. Is opencv-python-headless installed?")
        return

    _video_heatmap_chart(data)


def _video_heatmap_chart(data: dict):
    times = data.get("times", [])
    scores = data.get("scores", [])
    if not times:
        return
    fig = go.Figure()
    fig.add_trace(go.Heatmap(
        z=[scores], x=times,
        colorscale="Plasma", zmin=0, zmax=100,
        showscale=False,
        hovertemplate="t=%{x:.1f}s<br>motion=%{z:.0f}<extra></extra>",
    ))
    fig.update_layout(
        height=48,
        margin=dict(l=0, r=0, t=0, b=0),
        xaxis=dict(showticklabels=False, showgrid=False, zeroline=False),
        yaxis=dict(showticklabels=False, showgrid=False, zeroline=False),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
    )
    col_label, col_legend = st.columns([1, 3])
    col_label.caption("**Video motion**")
    col_legend.caption("black → purple → orange → yellow")
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})


def _audio_section(project: dict | None, v: int):
    st.subheader("Audio")
    st.caption("Beat track or alternative audio. Beat data generated from video if not provided.")
    existing = get_input_file(project, "audio") if project else None

    uploaded = st.file_uploader(
        "Drag and drop audio here",
        type=["mp3", "wav", "flac", "ogg"],
        key=f"audio_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded and project and project.get("output_folder"):
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "audio", str(dest))
        save_forge(project)
        st.rerun()

    if existing and Path(existing).exists():
        st.caption(f"♪ {Path(existing).name}")


def _captions_section(project: dict | None, v: int):
    st.subheader("Captions")
    st.caption("SRT/VTT for caption display and V2 emotion-aware haptics.")
    existing = get_input_file(project, "captions") if project else None

    uploaded = st.file_uploader(
        "Drag and drop captions here",
        type=["srt", "vtt", "ass"],
        key=f"captions_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded and project and project.get("output_folder"):
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "captions", str(dest))
        save_forge(project)
        st.rerun()

    if existing and Path(existing).exists():
        st.caption(f"💬 {Path(existing).name}")


# ── Summary ───────────────────────────────────────────────────────────────────

def _summary(project: dict | None):
    p = (project or {}).get("progress", {})
    has_funscript = bool(project and get_input_file(project, "funscript"))
    items = [
        ("Export location", bool(project)),
        ("Funscript", has_funscript),
        ("Tone applied", p.get("tone_applied", False)),
        ("Exported", p.get("exported", False)),
    ]
    for label, done in items:
        st.write(f"{'✅' if done else '⬜'} {label}")


