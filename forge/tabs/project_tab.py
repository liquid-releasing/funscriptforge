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

import streamlit as st

from forge.project import (
    add_input_file,
    default_forge,
    get_input_file,
    load_forge,
    remove_input_file,
    save_forge,
)
from forge.funscript import funscript_stats, load_funscript
from forge_ui_components.funscript_chart.streamlit import render_monochrome, render_static, render_stats_row
from forge_ui_components.file_picker.core import (
    AUDIO_PICKER, CAPTIONS_PICKER, FUNSCRIPT_PICKER, VIDEO_PICKER,
    is_new_upload, mark_processed, resolve_file_path,
)
from forge_ui_components.file_picker.streamlit import render_upload
from forge.video import analyze_motion, video_stats

_APP_ROOT = Path(__file__).parents[2]
_ASSETS_OUTPUT = _APP_ROOT / "assets" / "output"


def _reset_downstream_state():
    """Clear all downstream state when a new funscript is loaded.

    Resets: media paths, output folder, device/tone/project acceptance,
    chain funscript, assessment cache, tone selection, and cached charts.
    """
    _keys_to_clear = [
        # Media
        "video_path", "_video_processed", "_audio_processed", "_captions_processed",
        # Output folder
        "output_folder_input",
        # Acceptance flags
        "project_accepted", "device_accepted", "tone_accepted",
        "phrases_accepted", "stim_accepted", "export_complete",
        # Device tab state
        "device_apply_scope",
        # Tone tab state
        "tone_global", "show_tone_suggestions", "cached_tone_chart",
        # Chain
        "chain_funscript_path",
        # Assessment / analysis
        "last_loaded_cfg", "last_loaded_file",
        # Project objects (force re-init)
        "project", "forge_project",
        # Sidebar project picker
        "project_picker",
    ]
    for key in _keys_to_clear:
        st.session_state.pop(key, None)
    # Clear dynamic keys (tone sliders, motion cache, phrase chains, vibrant cache)
    for key in list(st.session_state.keys()):
        if key.startswith("tone_impact_") or key.startswith("tone_s") \
                or key.startswith("motion_") \
                or key.startswith("phrase_transform_chain_") \
                or key.startswith("_phrase_chain_snapshot_") \
                or key.startswith("_phrase_last_applied_") \
                or key.startswith("cached_vibrant"):
            st.session_state.pop(key, None)


def _default_output_for(funscript_path: str) -> Path:
    stem = Path(funscript_path).name.split(".")[0]
    return _ASSETS_OUTPUT / stem



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
            try:
                from forge_ui_components.beat_bar.core import analyze_beats, save_beats
                beat_map = analyze_beats(source)
                save_beats(beat_map, beat_cache)
                status.write(f"✅ Beat data: {len(beat_map.beats)} beats, ~{beat_map.bpm:.0f} BPM")
            except Exception as e:
                status.write(f"⚠️ Beat analysis skipped: {e}")

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
    # Skip if cached assessment exists on disk (resume case)
    funscript_path = st.session_state.get("funscript_path", "")
    import json as _json
    assessment_path = Path(folder) / "_assessment.json"

    if funscript_path and Path(funscript_path).exists():
        if assessment_path.exists() and not st.session_state.get("project"):
            # Resume: load cached assessment instead of re-running
            status.update(label="Loading cached assessment…")
            from ui.common.project import Project
            try:
                assessed = Project.from_funscript(
                    funscript_path,
                    existing_assessment_path=str(assessment_path),
                )
                st.session_state.project = assessed
                s = assessed.summary()
                status.write(
                    f"✅ Funscript: **{s['phrases']}** phrases, "
                    f"**{s['patterns']}** patterns, "
                    f"~**{s['bpm']:.0f}** BPM (cached)"
                )
            except Exception:
                # Cache corrupt — fall through to full analysis
                assessment_path.unlink(missing_ok=True)

        if not st.session_state.get("project"):
            # Full analysis (first time or cache miss)
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

            # Save assessment to output folder for future resume
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

    # Auto-set output folder from funscript name or project config
    output_folder = (project or {}).get("output_folder", "") or auto_output
    if output_folder:
        st.code(output_folder, language=None)
        # Auto-create or resume project
        if not project or project.get("output_folder") != output_folder:
            existing = load_forge(output_folder) if Path(output_folder).exists() else None
            if existing:
                st.session_state.forge_project = existing
            else:
                stem = Path(output_folder).name
                st.session_state.forge_project = default_forge(stem, output_folder)
    else:
        st.info("Load a funscript to set the output location.")

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
        with st.spinner("Analysing funscript…"):
            _commit_project_to_disk(project)
        st.session_state["project_accepted"] = True
        st.rerun()

    if st.session_state.get("project_accepted"):
        from forge.tabs._ui_helpers import success_guidance
        success_guidance(
            "Scroll to top to select Devices you want for this funscript."
        )


# ── Funscript ────────────────────────────────────────────────────────────────

def _funscript_section(v: int):
    def _on_funscript_upload(uploaded, cfg):
        tmp = Path(tempfile.mkdtemp()) / uploaded.name
        tmp.write_bytes(uploaded.read())
        _reset_downstream_state()
        return str(tmp)

    def _on_funscript_clear(cfg):
        _reset_downstream_state()

    funscript_path = st.session_state.get("funscript_path", "")
    render_upload(
        FUNSCRIPT_PICKER,
        version=v,
        on_upload=_on_funscript_upload,
        on_clear=_on_funscript_clear,
        current_path=funscript_path,
    )

    if funscript_path and Path(funscript_path).exists():
        data = load_funscript(funscript_path)
        if data:
            actions = data.get("actions", [])
            render_static(actions, color_mode="velocity")
            stats = funscript_stats(data)
            render_stats_row(stats)
        else:
            st.error("Could not parse funscript file.")


# ── Media sections ───────────────────────────────────────────────────────────

def _video_section(project: dict | None, v: int):
    st.subheader("Source video")
    existing = get_input_file(project, "video") if project else None

    def _on_video_upload(uploaded, cfg):
        try:
            tmp = Path(tempfile.mkdtemp()) / uploaded.name
            tmp.write_bytes(uploaded.read())
        except OSError as e:
            if e.errno == 28:
                st.error("Not enough disk space to load this video. Free up space and try again.")
            else:
                st.error(f"Could not save video: {e}")
            return None
        resolved = str(tmp)
        if project and project.get("output_folder"):
            import shutil
            Path(project["output_folder"]).mkdir(parents=True, exist_ok=True)
            dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
            try:
                shutil.copy2(str(tmp), str(dest))
            except OSError as e:
                st.error(f"Could not copy video to output folder: {e}")
                return None
            add_input_file(project, "video", str(dest))
            save_forge(project)
            resolved = str(dest)
        return resolved

    def _on_video_clear(cfg):
        if project:
            remove_input_file(project, "video")
            save_forge(project)
        st.session_state["_media_only_change"] = True

    video_path = resolve_file_path(VIDEO_PICKER, st.session_state, project_path=existing)
    render_upload(
        VIDEO_PICKER,
        version=v,
        on_upload=_on_video_upload,
        on_clear=_on_video_clear,
        current_path=video_path,
    )
    if video_path:
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

    def _on_audio_upload(uploaded, cfg):
        if not project or not project.get("output_folder"):
            return None
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "audio", str(dest))
        save_forge(project)
        return str(dest)

    def _on_audio_clear(cfg):
        if project:
            remove_input_file(project, "audio")
            save_forge(project)
        st.session_state["_media_only_change"] = True

    audio_path = resolve_file_path(AUDIO_PICKER, st.session_state, project_path=existing)
    render_upload(
        AUDIO_PICKER,
        version=v,
        on_upload=_on_audio_upload,
        on_clear=_on_audio_clear,
        current_path=audio_path,
    )
    if audio_path:
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
    from forge_ui_components.beat_bar.core import load_cached_beats, analyze_beats, save_beats

    output_folder = project.get("output_folder", "")
    beat_cache = Path(output_folder) / "_beat_data.json"

    cached = load_cached_beats(beat_cache)
    if cached is not None:
        st.caption(
            f"🥁 Beat data: **{len(cached.beats)}** beats detected, "
            f"~**{cached.bpm:.0f}** BPM · "
            f"{len(cached.downbeats)} downbeats · "
            f"{len(cached.phrases)} phrases"
        )
        return

    source = audio_path
    if not source:
        video_path = get_input_file(project, "video")
        if video_path and Path(video_path).exists():
            source = video_path

    if source:
        if st.button("🥁 Generate beat data", key="generate_beats_btn", width="stretch"):
            with st.spinner("Analyzing beats… (runs once, cached after)"):
                try:
                    beat_map = analyze_beats(source)
                    Path(output_folder).mkdir(parents=True, exist_ok=True)
                    save_beats(beat_map, beat_cache)
                    st.success(
                        f"Found **{len(beat_map.beats)}** beats at "
                        f"~**{beat_map.bpm:.0f}** BPM"
                    )
                    st.rerun()
                except Exception as e:
                    st.error(f"Beat analysis failed: {e}")


def _captions_section(project: dict | None, v: int):
    st.subheader("Captions")
    st.caption("SRT/VTT for caption display and V2 emotion-aware haptics.")
    existing = get_input_file(project, "captions") if project else None

    def _on_captions_upload(uploaded, cfg):
        if not project or not project.get("output_folder"):
            return None
        dest = Path(project["output_folder"]) / f"_input_{uploaded.name}"
        dest.write_bytes(uploaded.read())
        add_input_file(project, "captions", str(dest))
        save_forge(project)
        return str(dest)

    def _on_captions_clear(cfg):
        if project:
            remove_input_file(project, "captions")
            save_forge(project)
        st.session_state["_media_only_change"] = True

    captions_path = resolve_file_path(CAPTIONS_PICKER, st.session_state, project_path=existing)
    render_upload(
        CAPTIONS_PICKER,
        version=v,
        on_upload=_on_captions_upload,
        on_clear=_on_captions_clear,
        current_path=captions_path,
    )
    if captions_path:
        _captions_stats_row(captions_path)


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


