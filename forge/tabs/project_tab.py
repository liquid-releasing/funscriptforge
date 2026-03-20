"""
Tab 1 — Project

Single-column top-to-bottom flow:
  1. Funscript (required)
  2. Export location
  3. Media (optional)
  4. Author & credits (optional)
  5. Summary
  6. Accept

Output device selection is on the Device tab.
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
    """Open a native folder picker dialog. Runs in a temporary thread to avoid
    blocking Streamlit, with tkinter mainloop pumped manually so the dialog
    actually appears on Windows."""
    import threading

    result: list[str | None] = [None]

    def _pick():
        try:
            import tkinter as tk
            from tkinter import filedialog
            last = st.session_state.get("last_browse_dir", str(_ASSETS_OUTPUT))
            root = tk.Tk()
            root.withdraw()
            root.wm_attributes("-topmost", True)
            root.update()  # pump event loop so the dialog can open
            folder = filedialog.askdirectory(
                title="Choose project output folder",
                initialdir=last,
                parent=root,
            )
            root.destroy()
            if folder:
                result[0] = folder
        except Exception:
            pass

    t = threading.Thread(target=_pick, daemon=True)
    t.start()
    t.join(timeout=120)  # wait up to 2 min for user to pick
    if result[0]:
        st.session_state["last_browse_dir"] = str(Path(result[0]).parent)
    return result[0]


def _commit_project_to_disk(project: dict | None) -> None:
    """Create the output folder, write .forge file, and run post-accept analysis.
    Called when the user clicks Accept or Export — not before.
    Shows step-by-step progress so the user knows what's happening."""
    if not project:
        return
    folder = project.get("output_folder", "")
    if not folder:
        return

    status = st.status("Preparing your project…", expanded=True)

    status.update(label="Creating output folder…")
    Path(folder).mkdir(parents=True, exist_ok=True)

    status.update(label="Saving project file…")
    save_forge(project)
    status.write(f"✅ Saved to `{Path(folder).name}.forge`")

    # Run beat analysis if we have audio or video
    beat_cache = Path(folder) / "_beat_data.json"
    if not beat_cache.exists():
        audio_path = get_input_file(project, "audio")
        video_path = get_input_file(project, "video")
        source = None
        if audio_path and Path(audio_path).exists():
            source = audio_path
        elif video_path and Path(video_path).exists():
            source = video_path
        if source:
            status.update(label=f"Analyzing beats… ({Path(source).name})")
            result, err = _analyze_beats(source, folder)
            if result:
                beats = len(result.get("beats", []))
                bpm = result.get("tempo_bpm", 0)
                status.write(f"✅ Beat data: {beats} beats, ~{bpm:.0f} BPM")
            elif err:
                status.write(f"⚠️ Beat analysis skipped: {err}")

    # Run motion analysis if we have video and it hasn't been cached
    motion_cache = Path(folder) / "_video_motion.json"
    if not motion_cache.exists():
        video_path = get_input_file(project, "video")
        if video_path and Path(video_path).exists():
            status.update(label="Analyzing video motion…")
            from forge.video import analyze_motion

            def _motion_progress(sampled, total):
                status.update(label=f"Analyzing video motion… frame {sampled} / {total}")

            motion = analyze_motion(video_path, folder, progress_callback=_motion_progress)
            if motion:
                n_samples = len(motion.get("scores", []))
                status.write(f"✅ Motion heatmap: {n_samples:,} samples from {Path(video_path).name}")

    # Run funscript assessment (phrase detection, patterns, BPM)
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and Path(funscript_path).exists():
        fs_data = load_funscript(funscript_path)
        action_count = len(fs_data.get("actions", [])) if fs_data else 0
        status.update(label=f"Analyzing funscript… {action_count:,} actions")
        from ui.common.project import Project
        from assessment.analyzer import AnalyzerConfig
        min_phrase_s = st.session_state.get("min_phrase_s", 20)
        amp_tol_map = {"Low (0.35)": 0.35, "Medium (0.30)": 0.30, "High (0.25)": 0.25}
        amp_sensitivity = st.session_state.get("amp_sensitivity", "Medium (0.30)")
        analyzer_cfg = AnalyzerConfig(
            min_phrase_duration_ms=min_phrase_s * 1000,
            amplitude_tolerance=amp_tol_map.get(amp_sensitivity, 0.30),
        )

        def _on_stage(stage: str) -> None:
            status.update(label=f"Analyzing: {stage}")

        import time
        t0 = time.time()
        assessed = Project.from_funscript(
            funscript_path,
            analyzer_config=analyzer_cfg,
            progress_callback=_on_stage,
        )
        elapsed = time.time() - t0
        st.session_state.project = assessed
        st.session_state.last_assessment_elapsed = elapsed
        st.session_state.last_loaded_cfg = (funscript_path, min_phrase_s, amp_sensitivity)
        st.session_state.last_loaded_file = Path(funscript_path).name

        s = assessed.summary()
        status.write(
            f"✅ Funscript: **{s['phrases']}** phrases, "
            f"**{s['patterns']}** patterns, "
            f"~**{s['bpm']:.0f}** BPM "
            f"({elapsed:.1f}s)"
        )

        # Save assessment to output folder so later tabs load instantly
        import json as _json
        assessment_path = Path(folder) / "_assessment.json"
        try:
            assessment_path.write_text(
                _json.dumps(assessed.assessment.to_dict(), indent=2),
                encoding="utf-8",
            )
            status.write("✅ Assessment saved")
        except Exception:
            pass

    status.update(label="Project ready!", state="complete", expanded=False)


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

    # Auto-create project in memory from funscript if not yet created.
    # Folder and .forge file are NOT written to disk until the user commits
    # (Export Now / Continue).  This avoids littering empty project folders.
    funscript_path = st.session_state.get("funscript_path", "")
    if funscript_path and not project:
        auto_folder = str(_default_output_for(funscript_path))
        existing = load_forge(auto_folder) if Path(auto_folder).exists() else None
        if existing:
            st.session_state.forge_project = existing
        else:
            stem = Path(funscript_path).name.split(".")[0]
            proj = default_forge(stem, auto_folder)
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

    # Seed once; external changes (browse, funscript drop) pop the key to reseed.
    # The text_input widget reads its value from session_state[key], so we must
    # write the default BEFORE the widget renders.
    if "output_folder_input" not in st.session_state:
        st.session_state["output_folder_input"] = (
            project["output_folder"] if project else auto_output
        )
    if "output_folder_pending" in st.session_state:
        st.session_state["output_folder_input"] = st.session_state.pop("output_folder_pending")
    # If the session key exists but is empty and we have a good default, use it
    if not st.session_state.get("output_folder_input") and auto_output:
        st.session_state["output_folder_input"] = auto_output

    col_path, col_browse, col_set = st.columns([5, 1, 1])
    with col_browse:
        if st.button("Browse…", key="output_folder_browse", width="stretch"):
            picked = _browse_for_folder()
            if picked:
                st.session_state["output_folder_pending"] = picked
                st.rerun()
    with col_path:
        output_folder = st.text_input(
            "Export location path",
            label_visibility="collapsed",
            key="output_folder_input",
        )
    with col_set:
        set_clicked = st.button("Set", key="output_folder_set", width="stretch")

    if set_clicked and output_folder:
        folder = output_folder.strip()
        if folder != (project or {}).get("output_folder", ""):
            existing = load_forge(folder) if Path(folder).exists() else None
            if existing:
                st.session_state.forge_project = existing
                st.success(f"Resumed: **{existing['name']}**")
            else:
                stem = Path(folder).name
                new_proj = default_forge(stem, folder)
                st.session_state.forge_project = new_proj
                st.success(f"Project folder set: **{stem}**")
            st.rerun()

    project = st.session_state.forge_project

    st.divider()

    # ── 3. Media ──────────────────────────────────────────────────────────────
    has_media = bool(
        (get_input_file(project, "video") if project else None)
        or st.session_state.get("video_path")
        or (get_input_file(project, "audio") if project else None)
        or (get_input_file(project, "captions") if project else None)
    )
    with st.expander("Media *(optional)*", expanded=has_media, key="media_expander"):
        _video_section(project, v)
        st.divider()
        _audio_section(project, v)
        st.divider()
        _captions_section(project, v)

    # ── 5. Author & credits ──────────────────────────────────────────────────
    with st.expander("Author & credits *(optional)*"):
        with st.form("author_credits_form", clear_on_submit=False, border=False):
            author = st.text_input("Author", value=(project or {}).get("author", ""))
            website = st.text_input("Website / Patreon URL",
                                    value=(project or {}).get("website", ""))
            contributors_raw = st.text_input(
                "Contributors (comma-separated)",
                value=", ".join((project or {}).get("contributors", [])),
            )
            submitted = st.form_submit_button("Save", width="stretch")
        if submitted and project:
            contributors = [c.strip() for c in contributors_raw.split(",") if c.strip()]
            project["author"] = author
            project["website"] = website
            project["contributors"] = contributors
            save_forge(project)
            st.success("Author & credits saved.")

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

    if st.button(
        "Accept",
        type="primary",
        width="stretch",
        disabled=not has_funscript,
        help="Save project and run analysis." if has_funscript else "Add a funscript first.",
    ):
        _commit_project_to_disk(project)
        st.session_state["project_accepted"] = True
        st.rerun()

    if st.session_state.get("project_accepted"):
        st.success("Your next step in the workflow is the **Device** tab.")
        from forge.tabs._ui_helpers import scroll_to_top
        scroll_to_top()


# ── Funscript ────────────────────────────────────────────────────────────────

def _funscript_section(v: int):
    uploaded = st.file_uploader(
        "Drag and drop your funscript here",
        type=["funscript"],
        key=f"funscript_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded and st.session_state.get("_funscript_processed") != uploaded.name:
        tmp = Path(tempfile.mkdtemp()) / uploaded.name
        tmp.write_bytes(uploaded.read())
        st.session_state["funscript_path"] = str(tmp)
        st.session_state["_funscript_processed"] = uploaded.name
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
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
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
    if uploaded and st.session_state.get("_video_processed") != uploaded.name:
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
        st.session_state["_video_processed"] = uploaded.name
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
        if st.button("Analyze motion", key="analyze_motion_btn", width="stretch"):
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
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})


def _audio_section(project: dict | None, v: int):
    st.subheader("Alternate audio")
    st.caption("Optional replacement audio track. Beat data is generated from video by default.")
    existing = get_input_file(project, "audio") if project else None

    uploaded = st.file_uploader(
        "Drag and drop audio here",
        type=["mp3", "wav", "flac", "ogg"],
        key=f"audio_upload_{v}",
        label_visibility="collapsed",
    )
    if uploaded and project and project.get("output_folder") and st.session_state.get("_audio_processed") != uploaded.name:
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "audio", str(dest))
        save_forge(project)
        st.session_state["_audio_processed"] = uploaded.name
        st.rerun()

    audio_path = existing if (existing and Path(existing).exists()) else None
    if audio_path:
        st.caption(f"♪ {Path(audio_path).name}")
        _audio_stats_row(audio_path)


def _audio_stats_row(audio_path: str):
    """Show basic audio metadata."""
    try:
        from pymediainfo import MediaInfo
        info = MediaInfo.parse(audio_path)
    except Exception:
        return

    audio = next((t for t in info.tracks if t.track_type == "Audio"), None)
    general = next((t for t in info.tracks if t.track_type == "General"), None)
    if not audio:
        return

    duration_ms = getattr(general, "duration", None) or getattr(audio, "duration", None)
    duration_s = int(duration_ms) / 1000.0 if duration_ms else None
    sample_rate = getattr(audio, "sampling_rate", None)
    channels = getattr(audio, "channel_s", None)
    codec = getattr(audio, "format", None) or "—"
    file_size = getattr(general, "file_size", None)
    bit_rate = getattr(audio, "bit_rate", None)

    cols = st.columns(5)
    if duration_s:
        m, s = divmod(int(duration_s), 60)
        cols[0].metric("Duration", f"{m}:{s:02d}")
    else:
        cols[0].metric("Duration", "—")
    cols[1].metric("Format", codec)
    cols[2].metric("Sample rate", f"{int(sample_rate):,} Hz" if sample_rate else "—")
    cols[3].metric("Channels", str(channels) if channels else "—")
    cols[4].metric("Bit rate", f"{int(bit_rate) // 1000} kbps" if bit_rate else "—")


def _beat_generation_button(project: dict, audio_path: str | None):
    """Show a button to generate beat data from audio (or video fallback)."""
    output_folder = project.get("output_folder", "")
    beat_cache = Path(output_folder) / "_beat_data.json"

    if beat_cache.exists():
        import json as _json
        try:
            beat_data = _json.loads(beat_cache.read_text())
            beat_count = len(beat_data.get("beats", []))
            tempo = beat_data.get("tempo_bpm", 0)
            st.caption(f"🥁 Beat data: **{beat_count}** beats detected, ~**{tempo:.0f}** BPM")
        except Exception:
            pass
        return

    source = audio_path
    if not source:
        video_path = get_input_file(project, "video")
        if video_path and Path(video_path).exists():
            source = video_path

    if source:
        if st.button("🥁 Generate beat data", key="generate_beats_btn", width="stretch"):
            with st.spinner("Analyzing beats… (runs once, cached after)"):
                beat_data, err = _analyze_beats(source, output_folder)
                if beat_data:
                    st.success(f"Found **{len(beat_data.get('beats', []))}** beats at ~**{beat_data.get('tempo_bpm', 0):.0f}** BPM")
                    st.rerun()
                else:
                    st.error(f"Beat analysis failed: {err}")


def _analyze_beats(source_path: str, output_folder: str) -> tuple[dict | None, str]:
    """Run beat detection on audio/video file using librosa.
    Returns (result_dict, error_string). One will be None."""
    try:
        import librosa
        import json as _json
    except ImportError:
        return None, "librosa is not installed. Run: pip install librosa"

    try:
        y, sr = librosa.load(source_path, sr=22050, mono=True)
    except Exception as e:
        return None, f"Could not load audio from file: {e}"

    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        # tempo may be an array in some librosa versions
        if hasattr(tempo, '__len__'):
            tempo = float(tempo[0]) if len(tempo) > 0 else 0.0
        else:
            tempo = float(tempo)
    except Exception as e:
        return None, f"Beat detection failed: {e}"

    result = {
        "source_path": source_path,
        "tempo_bpm": tempo,
        "beats": [{"time_s": t, "beat_number": i + 1} for i, t in enumerate(beat_times)],
    }

    if output_folder:
        cache_path = Path(output_folder) / "_beat_data.json"
        try:
            Path(output_folder).mkdir(parents=True, exist_ok=True)
            cache_path.write_text(_json.dumps(result, indent=2))
        except Exception:
            pass  # cache write failure is non-fatal

    return result, ""


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
    if uploaded and project and project.get("output_folder") and st.session_state.get("_captions_processed") != uploaded.name:
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "captions", str(dest))
        save_forge(project)
        st.session_state["_captions_processed"] = uploaded.name
        st.rerun()

    if existing and Path(existing).exists():
        st.caption(f"💬 {Path(existing).name}")
        _captions_stats_row(existing)


def _captions_stats_row(captions_path: str):
    """Show basic caption file stats."""
    try:
        text = Path(captions_path).read_text(encoding="utf-8", errors="replace")
    except Exception:
        return

    ext = Path(captions_path).suffix.lower()
    lines = text.strip().splitlines()

    # Count cue blocks (rough: count lines that look like timestamps)
    import re
    if ext in (".srt", ".vtt"):
        cue_count = sum(1 for line in lines if "-->" in line)
    elif ext == ".ass":
        cue_count = sum(1 for line in lines if line.startswith("Dialogue:"))
    else:
        cue_count = 0

    cols = st.columns(3)
    cols[0].metric("Format", ext.lstrip(".").upper())
    cols[1].metric("Cues", f"{cue_count:,}")
    cols[2].metric("File size", f"{len(text):,} chars")


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


