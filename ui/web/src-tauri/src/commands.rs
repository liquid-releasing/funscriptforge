// Tauri commands — the Rust side of the platform adapter.
//
// Bridge strategy (matches forgegen): spawn-per-call to the funscriptforge
// Python CLI, capture JSON from stdout, return to React. Long-running
// commands stream progress via tauri::Emitter events.
//
// Commands still pending real backends (list_recents, list_tone_templates)
// return fixture data inline so the desktop dev loop matches the browser
// mode in forge.js. They get replaced one by one as the corresponding
// Python pipeline stages land.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

#[derive(Serialize)]
pub struct Pong {
    runtime: &'static str,
    version: &'static str,
}

#[tauri::command]
pub fn ping() -> Pong {
    Pong {
        runtime: "tauri",
        version: env!("CARGO_PKG_VERSION"),
    }
}

// ---------------------------------------------------------------------------
// Stub commands — return fixture data until the Python bridge lands. These
// must match the shape used by the browser-mode mocks in src/api/forge.js;
// if the shape changes, update both sides.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    id: &'static str,
    title: &'static str,
    duration: &'static str,
    edited: &'static str,
    phrases: u32,
    chapters: u32,
    media_kind: &'static str,
    status: &'static str,
    color: &'static str,
}

#[tauri::command]
pub fn list_recents() -> Vec<RecentProject> {
    vec![
        RecentProject { id: "r1", title: "Aftermath — Director's Cut", duration: "9:32",  edited: "just now",   phrases: 23, chapters: 4, media_kind: "video", status: "in-progress", color: "#e74c3c" },
        RecentProject { id: "r2", title: "Slow Burn",                  duration: "8:12",  edited: "yesterday",  phrases: 18, chapters: 3, media_kind: "audio", status: "exported",    color: "#f39c12" },
        RecentProject { id: "r3", title: "Quiet Rain (collab)",        duration: "21:05", edited: "3 days ago", phrases: 47, chapters: 6, media_kind: "audio", status: "in-progress", color: "#4a90d9" },
        RecentProject { id: "r4", title: "Untitled draft",             duration: "4:30",  edited: "last week",  phrases:  9, chapters: 2, media_kind: "video", status: "draft",       color: "#9b59b6" },
    ]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetDevice {
    id: &'static str,
    label: &'static str,
    icon: &'static str,
    max_bpm: u32,
    axes: &'static str,
    summary: &'static str,
}

#[tauri::command]
pub fn list_devices() -> Vec<TargetDevice> {
    vec![
        TargetDevice { id: "handy",   label: "The Handy",   icon: "cpu",     max_bpm: 600, axes: "linear",     summary: "Linear stroker · 600 BPM ceiling" },
        TargetDevice { id: "ohmibod", label: "OhMiBod",     icon: "radio",   max_bpm: 0,   axes: "vibration",  summary: "Vibrator · vibration intensity" },
        TargetDevice { id: "kiiroo", label: "Kiiroo Keon",  icon: "cpu",     max_bpm: 240, axes: "linear",     summary: "Linear stroker · 240 BPM ceiling" },
        TargetDevice { id: "estim",   label: "E-stim",      icon: "zap",     max_bpm: 0,   axes: "estim",      summary: "Electrostim · driven by Stim tab" },
        TargetDevice { id: "sr6",     label: "OSR2 / SR6",  icon: "axis-3d", max_bpm: 300, axes: "multi-axis", summary: "Multi-axis · L0 + roll/pitch/sway" },
        TargetDevice { id: "lovense", label: "Lovense",     icon: "radio",   max_bpm: 0,   axes: "vibration",  summary: "Vibrator · vibration intensity" },
    ]
}

#[derive(Serialize)]
pub struct ToneTemplate {
    id: &'static str,
    label: &'static str,
    tagline: &'static str,
    color: &'static str,
    icon: &'static str,
}

// The six canonical tones, in intensity order (softest → hardest). Source of
// truth: forge/tabs/tone_tab.py::_TONES. Adding or renaming a tone is a
// breaking change across the whole funscriptforge pipeline — treat them as
// locked vocabulary. Icons are served from /public/tones/ in the web bundle.
#[tauri::command]
pub fn list_tone_templates() -> Vec<ToneTemplate> {
    vec![
        ToneTemplate { id: "tender",   label: "Tender",   tagline: "Slow and close",        color: "#4a90d9", icon: "/tones/tender.png"   },
        ToneTemplate { id: "build",    label: "Build",    tagline: "Tension grows",         color: "#2ecc71", icon: "/tones/build.png"    },
        ToneTemplate { id: "tease",    label: "Tease",    tagline: "Pull back at the peak", color: "#9b59b6", icon: "/tones/tease.png"    },
        ToneTemplate { id: "edge",     label: "Edge",     tagline: "Hold there",            color: "#f39c12", icon: "/tones/edge.png"     },
        ToneTemplate { id: "climax",   label: "Climax",   tagline: "Everything, now",       color: "#e74c3c", icon: "/tones/climax.png"   },
        ToneTemplate { id: "dominant", label: "Dominant", tagline: "Driving, relentless",   color: "#2c3e50", icon: "/tones/dominant.png" },
    ]
}

// ---------------------------------------------------------------------------
// load_project — the real CLI bridge for opening a funscript.
//
// Flow:
//   1. Read <path>.funscript directly via serde_json (the file *is* JSON, no
//      Python needed for the basics).
//   2. Downsample actions to ~1200 points for chart-quality preview.
//   3. Probe for adjacent sidecars (.ffmeta.json, .chapters.json).
//   4. Shell out to `python cli.py meta <path> --format json` to enrich
//      with pace / intensity / tone suggestion / auto tags from
//      forge.metadata.derive_metadata. Non-fatal: if the CLI fails (missing
//      venv, malformed funscript for the analyzer, etc.) the project still
//      loads, just without derived metadata.
//
// Path resolution: FUNSCRIPTFORGE_ROOT env var, else hardcoded dev path.
// Production will swap to a PyInstaller-bundled sidecar binary (forgegen
// uses Command::new_sidecar("videoflow") for the same shape).
// ---------------------------------------------------------------------------

const DEV_FUNSCRIPTFORGE_ROOT: &str = r"C:\Users\bruce\Projects\_lqr\funscriptforge";

#[derive(Deserialize)]
struct FunscriptFile {
    actions: Vec<FunscriptAction>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FunscriptAction {
    at: u64,
    pos: u8,
}

// Chapter sidecar schema lives in videoflow now — see
// [videoflow.chapters](videoflow/src/videoflow/chapters.py). We consume it via
// `cli.py chapters` (resolver) and `cli.py auto-chapter` (analyzer); see
// CliChapter / CliChaptersResolved / CliChaptersAuto below.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRecord {
    id: String,
    at_ms: u64,
    end_ms: u64,
    name: String,
    intent: String,
    content_type: String,
    confidence: f32,
    evidence: Vec<String>,
    // Per-chapter UI tint. Deterministic from index so two loads of the same
    // file color chapters the same way. Tone-set assignments override on the
    // Chapters tab.
    color: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedProject {
    id: String,
    path: String,
    title: String,
    duration: String,
    duration_ms: u64,
    media_kind: String,
    media_path: Option<String>,
    color: String,
    phrases: u32,
    // Count of parsed chapters (denormalized for the rail row / pill). The
    // full chapter list lives in `chapter_list` and drives the Chapters tab.
    chapters: u32,
    chapter_list: Vec<ChapterRecord>,
    edited: String,
    // True when a `<stem>.work.funscript` is present — the loaded actions
    // are edited working state, not the pristine original. Drives the
    // "edited / Revert to original" affordance.
    has_working_edits: bool,
    actions: Vec<FunscriptAction>,
    action_count: usize,
    // Stats over the *full* action set, not the downsampled `actions`. JS-side
    // stat computation runs on `actions` which is too sparse to give correct
    // numbers for the footer; we pre-compute here so the chart shows real
    // values regardless of preview density.
    min_pos: i32,
    max_pos: i32,
    avg_speed: f64,  // |Δpos|·1000 / Δt, averaged across the funscript
    sidecars_found: Vec<String>,
    // From cli.py meta — None if the CLI call failed.
    pace: Option<String>,
    intensity: Option<String>,
    depth: Option<String>,
    duration_category: Option<String>,
    dominant_mood: Option<String>,
    arc_type: Option<String>,
    variety: Option<String>,
    tone_suggestion: Option<String>,
    tone_rationale: Option<String>,
    auto_tags: Vec<String>,
    // Parsed `.ffmeta.json` sidecar (scaffolding 2026-05-17). Raw JSON
    // passthrough for now — the schema isn't stable yet. Frontend consumes
    // as-is; when fields stabilize we'll lift them into LoadedProject
    // proper. None when no sidecar is adjacent. The `.forge` zip-bundle
    // load path (unzip → read manifest.ffmeta) is a separate future task.
    ffmeta: Option<serde_json::Value>,
}

fn compute_funscript_stats(actions: &[FunscriptAction]) -> (i32, i32, f64) {
    if actions.is_empty() {
        return (0, 0, 0.0);
    }
    let mut min_pos = 100i32;
    let mut max_pos = 0i32;
    let mut total_vel = 0.0f64;
    let mut vel_count = 0u64;
    for (i, a) in actions.iter().enumerate() {
        let p = a.pos as i32;
        if p < min_pos { min_pos = p; }
        if p > max_pos { max_pos = p; }
        if i > 0 {
            let dt = (a.at as i64 - actions[i - 1].at as i64).max(1) as f64;
            let dpos = (a.pos as i32 - actions[i - 1].pos as i32).unsigned_abs() as f64;
            total_vel += (dpos / dt) * 1000.0;
            vel_count += 1;
        }
    }
    let avg = if vel_count > 0 { total_vel / vel_count as f64 } else { 0.0 };
    (min_pos, max_pos, avg)
}

#[tauri::command]
pub async fn load_project(path: String) -> Result<LoadedProject, String> {
    // ── Read the funscript ────────────────────────────────────────────
    // If a working copy exists in the forge dir (edits made in a prior
    // session), load THAT — it's the durable save state. The original stays
    // pristine for Revert. `path` remains the original everywhere else so
    // stem/forge/sidecar resolution is unchanged; only the actions swap.
    let work_path = working_funscript_path(Path::new(&path));
    let has_working_edits = tokio::fs::metadata(&work_path).await.is_ok();
    let read_path = if has_working_edits {
        work_path.to_string_lossy().into_owned()
    } else {
        path.clone()
    };
    let raw = tokio::fs::read_to_string(&read_path)
        .await
        .map_err(|e| format!("Could not read {}: {}", &read_path, e))?;
    let funscript: FunscriptFile = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid funscript JSON in {}: {}", &read_path, e))?;
    let action_count = funscript.actions.len();
    let duration_ms = funscript.actions.last().map(|a| a.at).unwrap_or(0);

    let (min_pos, max_pos, avg_speed) = compute_funscript_stats(&funscript.actions);
    // Return the full action set. Earlier shape downsampled to 1200 points
    // for chart-quality preview, but the close-up Funscript view in
    // MediaViewer zooms to a ~12s window and needs real per-stroke density
    // to show beats (a 10-minute high-BPM script downsampled to 1200 leaves
    // 2 actions/sec — strokes vanish into smooth curves). Overview charts
    // that want a sparse preview can downsample client-side. Memory cost:
    // typical 30-minute funscript = ~30k actions ≈ 660KB JSON, fine.
    let actions = funscript.actions.clone();

    // ── Sidecar probe ────────────────────────────────────────────────
    // Probe the per-project forge dir for ffmeta + chapters sidecars.
    // Mirrors videoflow.sidecar.forge_dir — every sidecar this project
    // writes lives in <funscript_dir>/.<stem>.forge/ regardless of who
    // wrote it (videoflow's Analyze, the Tauri auto-split command,
    // hand-edits, etc.).
    let stem = strip_funscript_ext(&path);
    let stem_name = Path::new(&stem)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let forge = forge_dir(Path::new(&path));
    let mut sidecars_found = Vec::new();
    let mut ffmeta: Option<serde_json::Value> = None;
    for suffix in ["ffmeta.json", "chapters.json"] {
        let p = forge.join(format!("{}.{}", stem_name, suffix));
        if tokio::fs::metadata(&p).await.is_ok() {
            let p_str = p.to_string_lossy().into_owned();
            sidecars_found.push(p_str.clone());
            // ffmeta.json: parse it through. Other sidecars (chapters.json)
            // are consumed by their dedicated paths; we just record presence.
            if suffix == "ffmeta.json" {
                if let Ok(raw) = tokio::fs::read_to_string(&p).await {
                    match serde_json::from_str::<serde_json::Value>(&raw) {
                        Ok(v)  => ffmeta = Some(v),
                        Err(e) => eprintln!("ffmeta.json parse error at {}: {}", p_str, e),
                    }
                }
            }
        }
    }

    // ── Adjacent media file probe ────────────────────────────────────
    // Look for a video/audio file with the same stem next to the funscript.
    // Video extensions take priority over audio (since most funscripts are
    // authored against video). Returns the first hit. Done before chapter
    // resolution so we can pass the media path through to videoflow when
    // it exists (enables mp4-embedded chapter markers via ffprobe).
    let (media_path, media_kind) = find_adjacent_media(&stem);

    // ── Chapters via videoflow resolver ──────────────────────────────
    // Shells out to `cli.py chapters` which calls videoflow.chapters.load_chapters
    // with the priority chain: sidecar > mp4 markers > analysis.json. When media
    // is adjacent we pass that path so mp4 markers fire; otherwise we pass the
    // funscript and only the sidecar / analysis.json paths are exercised.
    let resolution_path = media_path.as_deref().unwrap_or(&path);
    let chapter_list = resolve_chapters_via_cli(resolution_path, duration_ms).await;
    let chapter_count = chapter_list.len() as u32;

    // ── Title from filename ──────────────────────────────────────────
    let title = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    // ── Derived metadata via cli.py meta ─────────────────────────────
    let meta = run_cli_meta(&path).await.unwrap_or_default();

    Ok(LoadedProject {
        id: format!("loaded:{}", path),
        path: path.clone(),
        title,
        duration: format_duration(duration_ms),
        duration_ms,
        media_kind,
        media_path,
        color: tone_color(meta.tone_suggestion.as_deref()),
        phrases: 0,  // populated when we parse phrase sidecars
        chapters: chapter_count,
        chapter_list,
        edited: "just now".to_string(),
        has_working_edits,
        actions,
        action_count,
        min_pos,
        max_pos,
        avg_speed,
        sidecars_found,
        pace: meta.pace,
        intensity: meta.intensity,
        depth: meta.depth,
        duration_category: meta.duration_category,
        dominant_mood: meta.dominant_mood,
        arc_type: meta.arc_type,
        variety: meta.variety,
        tone_suggestion: meta.tone_suggestion,
        tone_rationale: meta.tone_rationale,
        auto_tags: meta.auto_tags,
        ffmeta,
    })
}

#[derive(Default, Deserialize)]
struct CliMeta {
    pace: Option<String>,
    intensity: Option<String>,
    depth: Option<String>,
    duration_category: Option<String>,
    dominant_mood: Option<String>,
    arc_type: Option<String>,
    variety: Option<String>,
    tone_suggestion: Option<String>,
    tone_rationale: Option<String>,
    #[serde(default)]
    auto_tags: Vec<String>,
}

// Generic cli.py runner. Resolves the venv python + script path from env
// (FUNSCRIPTFORGE_ROOT / FUNSCRIPTFORGE_PYTHON), runs `cli.py <args...>` with
// the project root as cwd, and returns stdout as a String. Non-zero exits
// surface stderr in the error.
async fn run_cli(args: &[&str]) -> Result<String, String> {
    let root = std::env::var("FUNSCRIPTFORGE_ROOT")
        .unwrap_or_else(|_| DEV_FUNSCRIPTFORGE_ROOT.to_string());
    let python = std::env::var("FUNSCRIPTFORGE_PYTHON").unwrap_or_else(|_| {
        format!(r"{}\.venv\Scripts\python.exe", root)
    });
    let cli_py = format!(r"{}\cli.py", root);

    let mut cmd = Command::new(&python);
    cmd.arg(&cli_py);
    for a in args {
        cmd.arg(a);
    }
    let output = cmd
        .current_dir(&root)
        .output()
        .await
        .map_err(|e| format!("spawn python failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cli.py {} exited non-zero: {}", args.first().unwrap_or(&""), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// Streaming variant of run_cli. Spawns the CLI with VIDEOFLOW_PROGRESS_FILE
// set to a unique temp path, and runs a parallel polling task that tails
// the file, emitting each new `progress: <label>` line as a Tauri event
// for the React side to consume. Long-running commands (auto-chapter,
// assess) wire through this so the AcceptBar footer can show live stage
// updates. Returns stdout exactly like run_cli once the process exits.
async fn run_cli_with_progress(
    app: &AppHandle,
    event_name: &str,
    args: &[&str],
) -> Result<String, String> {
    let root = std::env::var("FUNSCRIPTFORGE_ROOT")
        .unwrap_or_else(|_| DEV_FUNSCRIPTFORGE_ROOT.to_string());
    let python = std::env::var("FUNSCRIPTFORGE_PYTHON").unwrap_or_else(|_| {
        format!(r"{}\.venv\Scripts\python.exe", root)
    });
    let cli_py = format!(r"{}\cli.py", root);

    // Unique temp file for this run. PID + microseconds = unique enough
    // for concurrent commands; isolated from other apps' progress files.
    let pid = std::process::id();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros())
        .unwrap_or(0);
    let temp_path: PathBuf = std::env::temp_dir()
        .join(format!("ff-progress-{}-{}.log", pid, ts));
    // Create empty so the poller can open it without racing the child.
    let _ = std::fs::write(&temp_path, "");

    let mut cmd = Command::new(&python);
    cmd.arg(&cli_py);
    for a in args { cmd.arg(a); }
    cmd.env("VIDEOFLOW_PROGRESS_FILE", &temp_path)
       .current_dir(&root);

    // Poller: tail the temp file, emit each new line as a Tauri event.
    // Cancelled via oneshot when the child exits. One final flush after
    // cancel catches lines that landed between the last tick and exit.
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    let app_for_task = app.clone();
    let event_name_owned = event_name.to_string();
    let temp_path_for_task = temp_path.clone();
    let polling = tokio::spawn(async move {
        let mut offset: usize = 0;
        let drain = |offset: &mut usize| -> () {
            if let Ok(data) = std::fs::read(&temp_path_for_task) {
                if data.len() > *offset {
                    let new_text = String::from_utf8_lossy(&data[*offset..]);
                    for line in new_text.lines() {
                        let line = line.trim();
                        if !line.is_empty() {
                            let _ = app_for_task.emit(&event_name_owned, line.to_string());
                        }
                    }
                    *offset = data.len();
                }
            }
        };
        loop {
            drain(&mut offset);
            tokio::select! {
                _ = &mut cancel_rx => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {},
            }
        }
        drain(&mut offset);
    });

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("spawn python failed: {}", e))?;

    let _ = cancel_tx.send(());
    let _ = polling.await;
    let _ = tokio::fs::remove_file(&temp_path).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cli.py {} exited non-zero: {}", args.first().unwrap_or(&""), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn run_cli_meta(funscript_path: &str) -> Result<CliMeta, String> {
    let stdout = run_cli(&["meta", funscript_path, "--format", "json"]).await?;
    serde_json::from_str::<CliMeta>(&stdout)
        .map_err(|e| format!("could not parse cli.py meta output: {}", e))
}

// Wire shape returned by `cli.py chapters` / `cli.py auto-chapter`.
// Normalized: every chapter has at_ms + end_ms; analytical fields have
// safe defaults so this slots into ChapterRecord without further parsing.
#[derive(Deserialize)]
struct CliChapter {
    at_ms: u64,
    end_ms: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    intent: String,
    #[serde(default)]
    content_type: String,
    #[serde(default)]
    confidence: f32,
    #[serde(default)]
    evidence: Vec<String>,
}

#[derive(Deserialize)]
struct CliChaptersResolved {
    #[serde(default)]
    found: bool,
    #[serde(default)]
    chapters: Vec<CliChapter>,
}

#[derive(Deserialize)]
struct CliChaptersAuto {
    #[serde(default)]
    chapters: Vec<CliChapter>,
}

fn cli_chapters_to_records(chapters: Vec<CliChapter>) -> Vec<ChapterRecord> {
    chapters
        .into_iter()
        .enumerate()
        .map(|(i, c)| ChapterRecord {
            id: format!("ch{}", i + 1),
            at_ms: c.at_ms,
            end_ms: c.end_ms,
            name: c.name,
            intent: c.intent,
            content_type: c.content_type,
            confidence: c.confidence,
            evidence: c.evidence,
            color: CHAPTER_PALETTE[i % CHAPTER_PALETTE.len()].to_string(),
        })
        .collect()
}

// Resolve chapters via videoflow's priority chain (sidecar > mp4 markers >
// analysis.json). Pass *media_path* when available so embedded mp4 markers
// are honoured; otherwise pass the funscript path and only the sidecar /
// analysis.json paths fire. *duration_ms* lets the CLI fill end_ms on the
// last chapter when the source carries only start times.
async fn resolve_chapters_via_cli(path_for_resolution: &str, duration_ms: u64) -> Vec<ChapterRecord> {
    let duration_arg = duration_ms.to_string();
    let stdout = match run_cli(&[
        "chapters",
        path_for_resolution,
        "--duration-ms",
        &duration_arg,
        "--format",
        "json",
    ])
    .await
    {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: CliChaptersResolved = match serde_json::from_str(&stdout) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    if !parsed.found {
        return Vec::new();
    }
    cli_chapters_to_records(parsed.chapters)
}

// Build an equal-split chapter list and write the .chapters.json sidecar
// next to the funscript. Used from the Chapters tab when the user kicks
// off chapter creation on a project that has no existing sidecar. Logs
// videoflow-style provenance under generated_by so a future analyzer pass
// can distinguish hand-split vs analyzer-derived chapters.
#[tauri::command]
pub async fn create_chapters_sidecar(
    funscript_path: String,
    n: u32,
) -> Result<Vec<ChapterRecord>, String> {
    let raw = tokio::fs::read_to_string(&funscript_path)
        .await
        .map_err(|e| format!("could not read funscript: {}", e))?;
    let funscript: FunscriptFile = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse funscript: {}", e))?;
    let duration_ms = funscript.actions.last().map(|a| a.at).unwrap_or(0);
    if n == 0 || duration_ms == 0 {
        return Ok(Vec::new());
    }

    let n64 = n as u64;
    let mut chapters: Vec<ChapterRecord> = Vec::with_capacity(n as usize);
    for i in 0..n {
        let at_ms = (duration_ms * i as u64) / n64;
        let end_ms = (duration_ms * (i as u64 + 1)) / n64;
        chapters.push(ChapterRecord {
            id: format!("ch{}", i + 1),
            at_ms,
            end_ms,
            name: format!("Chapter {}", i + 1),
            intent: String::new(),
            content_type: String::new(),
            confidence: 0.0,
            evidence: vec!["manual_split".to_string()],
            color: CHAPTER_PALETTE[(i as usize) % CHAPTER_PALETTE.len()].to_string(),
        });
    }

    let stem = strip_funscript_ext(&funscript_path);
    // Per-project forge dir mirrors videoflow.sidecar.forge_dir —
    // sidecars live next to clips inside <dir>/.<stem>.forge/.
    let forge = forge_dir(Path::new(&funscript_path));
    tokio::fs::create_dir_all(&forge)
        .await
        .map_err(|e| format!("could not create forge dir: {}", e))?;
    let stem_name = Path::new(&stem)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let sidecar_path = forge
        .join(format!("{}.chapters.json", stem_name))
        .to_string_lossy()
        .into_owned();
    let payload = serde_json::json!({
        "version": "1.0",
        "auto_generated": true,
        "generated_by": {
            "tool": "funscriptforge.ui",
            "method": "manual_split",
            "n_chapters": n,
        },
        "chapters": chapters.iter().map(|c| serde_json::json!({
            "at_ms": c.at_ms,
            "end_ms": c.end_ms,
            "name": c.name,
            "intent": c.intent,
            "content_type": c.content_type,
            "confidence": c.confidence,
            "evidence": c.evidence,
        })).collect::<Vec<_>>(),
    });
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("could not serialize sidecar: {}", e))?;
    tokio::fs::write(&sidecar_path, json)
        .await
        .map_err(|e| format!("could not write sidecar: {}", e))?;

    Ok(chapters)
}

// Run videoflow.structural.auto_chapter on the funscript's adjacent media,
// write the sidecar, and return the resulting chapters. The audio analyzer
// needs real media — return an error if no media is adjacent to the funscript.
// This is the "Analyze with videoflow" path from the Chapters tab empty state,
// the canonical alternative to manual equal-split.
#[tauri::command]
pub async fn analyze_chapters_with_videoflow(
    app: AppHandle,
    funscript_path: String,
    target_minutes: Option<f64>,
    // Optional explicit media path — the frontend's "Add or replace…"
    // picker (2026-05-17) lets users attach media that doesn't share the
    // funscript's stem or live in the same folder. When provided, skip
    // the adjacent-stem scan and use this path directly.
    media_path: Option<String>,
) -> Result<Vec<ChapterRecord>, String> {
    let media = match media_path.filter(|p| !p.is_empty()) {
        Some(p) => p,
        None => {
            let stem = strip_funscript_ext(&funscript_path);
            let (found, _) = find_adjacent_media(&stem);
            found.ok_or_else(|| {
                "No adjacent media file found. Attach a video or audio file via \
                 the Project tab \"Add or replace…\" picker, or place one with \
                 the same name next to the funscript.".to_string()
            })?
        }
    };

    let target = target_minutes.unwrap_or(5.5).to_string();
    let stdout = run_cli_with_progress(
        &app,
        "ff:progress",
        &[
            "auto-chapter",
            &media,
            "--target-minutes",
            &target,
            "--format",
            "json",
        ],
    )
    .await?;

    let parsed: CliChaptersAuto = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py auto-chapter output: {}", e))?;
    Ok(cli_chapters_to_records(parsed.chapters))
}

// ---------------------------------------------------------------------------
// Audio peaks — pre-computed waveform sidecar for the MediaViewer Audio mode.
//
// Shells out to `cli.py audio-peaks <media>` which writes <stem>.audio.json
// next to the media file. The CLI reuses the cached sidecar on subsequent
// calls, so this command is cheap on second visit (~10ms parse vs. tens of
// seconds librosa decode on first compute).
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPeaksResponse {
    pub hop_ms: u32,
    pub duration_ms: u64,
    pub peaks: Vec<f32>,
    pub peak_count: usize,
    pub from_sidecar: bool,
}

#[derive(Deserialize)]
struct CliAudioPeaks {
    #[serde(default = "default_hop_ms")]
    hop_ms: u32,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    peaks: Vec<f32>,
    #[serde(default)]
    peak_count: usize,
    #[serde(default)]
    from_sidecar: bool,
}

fn default_hop_ms() -> u32 { 10 }

#[tauri::command]
pub async fn analyze_audio_peaks(
    app: AppHandle,
    media_path: String,
    hop_ms: Option<u32>,
    force: Option<bool>,
) -> Result<AudioPeaksResponse, String> {
    if !std::path::Path::new(&media_path).exists() {
        return Err(format!("media file not found: {}", media_path));
    }
    let hop_arg = hop_ms.unwrap_or(10).to_string();
    let mut args: Vec<&str> = vec!["audio-peaks", &media_path, "--hop-ms", &hop_arg, "--format", "json"];
    if force.unwrap_or(false) {
        args.push("--force");
    }
    // Stream depth-2 stage events ("decode" / "rms" / "write") into the
    // global busy footer via the same `ff:progress` channel used by
    // analyze_chapters_with_videoflow and analyze_phrases. Skipped events
    // on sidecar cache hit (decode is bypassed entirely) — the consumer
    // sees a brief busy banner with no steps, then the result lands.
    let stdout = run_cli_with_progress(&app, "ff:progress", &args).await?;
    let parsed: CliAudioPeaks = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py audio-peaks output: {}", e))?;

    let peak_count = if parsed.peak_count > 0 { parsed.peak_count } else { parsed.peaks.len() };
    Ok(AudioPeaksResponse {
        hop_ms: parsed.hop_ms,
        duration_ms: parsed.duration_ms,
        peaks: parsed.peaks,
        peak_count,
        from_sidecar: parsed.from_sidecar,
    })
}

// ---------------------------------------------------------------------------
// Sidecar loaders — read existing `<stem>.audio.json` and `<stem>.spectrogram.json`
// produced by `videoflow.structural.auto_chapter`. These are NOT analyze
// commands — they only read what's already on disk. The build is owned by
// the chapter-analysis pass (one user trigger, one deterministic build,
// no video-burping lazy decodes mid-playback).
//
// Returns Ok(None) when the sidecar is absent so the frontend can render
// an empty state nudging the user to run chapter analysis.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAudioPeaks {
    pub hop_ms: u32,
    pub duration_ms: u64,
    pub peaks: Vec<f32>,
    pub peak_count: usize,
    pub from_sidecar: bool,
}

#[derive(Deserialize)]
struct DiskAudioPeaks {
    #[serde(default = "default_hop_ms")]
    hop_ms: u32,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    peaks: Vec<f32>,
    #[serde(default)]
    peak_count: usize,
}

// Sidecar path computation. Mirrors videoflow's per-module `sidecar_path`
// functions: every sidecar lives inside the per-project forge dir as
// `<.stem.forge>/<stem><suffix>`. Pre-forge-dir sidecars next to source
// are NOT read (clean break — re-Analyze rebuilds them).
fn forge_sidecar_path(media_path: &str, suffix: &str) -> String {
    let p = Path::new(media_path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("media");
    forge_dir(p)
        .join(format!("{}{}", stem, suffix))
        .to_string_lossy()
        .into_owned()
}

fn peaks_sidecar_path(media_path: &str) -> String {
    forge_sidecar_path(media_path, ".audio.json")
}

// ─── read_stanzas_from_chapters_sidecar ─────────────────────────────
//
// Stanzas produced by videoflow's auto_chapter pipeline are merged into
// the chapters sidecar (not a separate `.stanzas.json` file). Reads
// `.forge/<stem>.chapters.json` and returns just the `stanzas` array.
// Returns an empty Vec if the file is missing or the array is absent —
// callers render an empty state, not an error.
//
// Stanza shape mirrors videoflow's Stanza.to_dict(): snake_case fields
// matching what the JS side (forgemoment StanzasCategoryBody) reads
// directly. NO camelCase rename here. Distinct from the editing-phrase
// `PhraseRecord` used by `analyze_phrases` — that one carries
// FunscriptAnalyzer's `tag` / `pattern_label` vocabulary; this one
// carries videoflow auto_chapter's `mode` vocabulary
// (tease/steady/edging/break/fast/slow).
#[derive(Serialize, Deserialize, Clone)]
pub struct AutoChapterStanza {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub at_ms: u64,
    #[serde(default)]
    pub end_ms: u64,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub chapter_idx: Option<u32>,
    // Pass any other fields through as a flat extension. videoflow may
    // add fields (intensity, confidence, etc.) and we don't want a
    // strict deserializer to reject the file when it does.
    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct ChaptersSidecarFile {
    #[serde(default)]
    stanzas: Vec<AutoChapterStanza>,
}

// Input shape for write_chapters_sidecar. JS sends chapters in the
// camelCase shape that ChapterRecord serializes (because that's what
// load_project returns and what the frontend stores). On disk the
// sidecar uses snake_case — this struct deserializes camelCase from
// the Tauri command then we transcribe to snake_case JSON below.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInput {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub at_ms: u64,
    #[serde(default)]
    pub end_ms: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub intent: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub color: String,
}

// Overwrite the chapters sidecar with a user-edited chapter list.
// Used by ChaptersTab's split / join handlers. Read-merge-write so
// videoflow's `stanzas` + `energy` keys (written by auto_chapter's
// sidecar stage) survive — we only replace `chapters` and mark the
// file as user-edited so a future detector run can decide whether
// to respect manual boundaries.
//
// `source_path` is whichever path the sidecar belongs to — caller
// passes `mediaPath ?? funscriptPath` matching the priority chain
// load_project / cli.py chapters resolver use to find chapters.
#[tauri::command]
pub async fn write_chapters_sidecar(
    source_path: String,
    chapters: Vec<ChapterInput>,
) -> Result<(), String> {
    let sidecar_path = forge_sidecar_path(&source_path, ".chapters.json");
    // Ensure parent .forge/ dir exists. Should be there already if
    // anything else wrote a sidecar before, but defensive create.
    if let Some(parent) = Path::new(&sidecar_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("could not create forge dir: {}", e))?;
    }

    // Read existing payload (if any) so we preserve stanzas / energy /
    // generated_by / etc. Empty object if file is absent or unparseable
    // — the chapters write still succeeds; other keys re-populate on
    // the next analyze.
    let mut payload: serde_json::Value = if Path::new(&sidecar_path).exists() {
        let raw = tokio::fs::read_to_string(&sidecar_path)
            .await
            .map_err(|e| format!("could not read existing sidecar: {}", e))?;
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Replace the chapters array. snake_case keys for on-disk format
    // (the videoflow + cli.py side reads this).
    payload["chapters"] = serde_json::json!(
        chapters.iter().map(|c| serde_json::json!({
            "id": c.id,
            "at_ms": c.at_ms,
            "end_ms": c.end_ms,
            "name": c.name,
            "intent": c.intent,
            "content_type": c.content_type,
            "confidence": c.confidence,
            "evidence": c.evidence,
            "color": c.color,
        })).collect::<Vec<_>>()
    );

    // Stamp the edit so a future detector pass (or a debug surface)
    // can see this file was modified outside the analyzer pipeline.
    // Doesn't change the schema — auto_chapter ignores unknown keys.
    payload["edited_by_user"] = serde_json::json!(true);

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("could not serialize sidecar: {}", e))?;
    tokio::fs::write(&sidecar_path, json)
        .await
        .map_err(|e| format!("could not write sidecar: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn read_stanzas_from_chapters_sidecar(
    media_path: String,
) -> Result<Vec<AutoChapterStanza>, String> {
    let sp = forge_sidecar_path(&media_path, ".chapters.json");
    if !Path::new(&sp).exists() {
        return Ok(Vec::new());
    }
    let raw = tokio::fs::read_to_string(&sp)
        .await
        .map_err(|e| format!("could not read chapters sidecar at {}: {}", sp, e))?;
    // Tolerant parse — if the file exists but doesn't have a `stanzas`
    // array yet (e.g. read between chapters_sidecar and sidecar stages),
    // we return an empty Vec instead of erroring out.
    let parsed: ChaptersSidecarFile = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse chapters sidecar at {}: {}", sp, e))?;
    Ok(parsed.stanzas)
}

#[tauri::command]
pub async fn load_audio_peaks(
    media_path: String,
) -> Result<Option<LoadedAudioPeaks>, String> {
    let sp = peaks_sidecar_path(&media_path);
    if !Path::new(&sp).exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&sp)
        .await
        .map_err(|e| format!("could not read peaks sidecar at {}: {}", sp, e))?;
    let parsed: DiskAudioPeaks = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse peaks sidecar at {}: {}", sp, e))?;
    let peak_count = if parsed.peak_count > 0 {
        parsed.peak_count
    } else {
        parsed.peaks.len()
    };
    Ok(Some(LoadedAudioPeaks {
        hop_ms: parsed.hop_ms,
        duration_ms: parsed.duration_ms,
        peaks: parsed.peaks,
        peak_count,
        from_sidecar: true,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAudioSpectrogram {
    pub hop_ms: u32,
    pub n_mels: u32,
    pub n_frames: u32,
    pub duration_ms: u64,
    pub fmax: u32,
    pub db_floor: f32,
    pub db_ceiling: f32,
    /// Base64-encoded uint8 Uint8Array[n_frames * n_mels], time-major.
    /// The frontend atob() decodes into a Uint8Array and feeds the magma
    /// LUT directly — each byte is the colormap index for one mel cell.
    pub cells_b64: String,
    pub from_sidecar: bool,
}

#[derive(Deserialize)]
struct DiskAudioSpectrogram {
    #[serde(default = "default_hop_ms")]
    hop_ms: u32,
    #[serde(default)]
    n_mels: u32,
    #[serde(default)]
    n_frames: u32,
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    fmax: u32,
    #[serde(default)]
    db_floor: f32,
    #[serde(default)]
    db_ceiling: f32,
    #[serde(default)]
    cells_b64: String,
}

fn spectrogram_sidecar_path(media_path: &str) -> String {
    forge_sidecar_path(media_path, ".spectrogram.json")
}

#[tauri::command]
pub async fn load_audio_spectrogram(
    media_path: String,
) -> Result<Option<LoadedAudioSpectrogram>, String> {
    let sp = spectrogram_sidecar_path(&media_path);
    if !Path::new(&sp).exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&sp)
        .await
        .map_err(|e| format!("could not read spectrogram sidecar at {}: {}", sp, e))?;
    let parsed: DiskAudioSpectrogram = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse spectrogram sidecar at {}: {}", sp, e))?;
    Ok(Some(LoadedAudioSpectrogram {
        hop_ms: parsed.hop_ms,
        n_mels: parsed.n_mels,
        n_frames: parsed.n_frames,
        duration_ms: parsed.duration_ms,
        fmax: parsed.fmax,
        db_floor: parsed.db_floor,
        db_ceiling: parsed.db_ceiling,
        cells_b64: parsed.cells_b64,
        from_sidecar: true,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAudioBeats {
    pub duration_ms: u64,
    pub bpm: f32,
    pub beats_ms: Vec<u64>,
    pub downbeats_ms: Vec<u64>,
    pub from_sidecar: bool,
}

#[derive(Deserialize)]
struct DiskAudioBeats {
    #[serde(default)]
    duration_ms: u64,
    #[serde(default)]
    bpm: f32,
    #[serde(default)]
    beats_ms: Vec<u64>,
    #[serde(default)]
    downbeats_ms: Vec<u64>,
}

fn beats_sidecar_path(media_path: &str) -> String {
    forge_sidecar_path(media_path, ".beats.json")
}

#[tauri::command]
pub async fn load_audio_beats(
    media_path: String,
) -> Result<Option<LoadedAudioBeats>, String> {
    let sp = beats_sidecar_path(&media_path);
    if !Path::new(&sp).exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&sp)
        .await
        .map_err(|e| format!("could not read beats sidecar at {}: {}", sp, e))?;
    let parsed: DiskAudioBeats = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse beats sidecar at {}: {}", sp, e))?;
    Ok(Some(LoadedAudioBeats {
        duration_ms: parsed.duration_ms,
        bpm: parsed.bpm,
        beats_ms: parsed.beats_ms,
        downbeats_ms: parsed.downbeats_ms,
        from_sidecar: true,
    }))
}

// ---------------------------------------------------------------------------
// Attach media — wire a video/audio file to an existing project. Scaffolding
// only today: validates the file exists and echoes the paths back to the
// frontend so it can update its project state. Later: write into the
// project's .ffmeta sidecar so the attachment survives restarts.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct AttachMediaResult {
    #[serde(rename = "funscriptPath")]
    funscript_path: String,
    #[serde(rename = "mediaPath")]
    media_path: String,
    #[serde(rename = "mediaKind")]
    media_kind: String, // "video" | "audio"
}

#[tauri::command]
pub async fn attach_media(
    funscript_path: String,
    media_path: String,
) -> Result<AttachMediaResult, String> {
    if !std::path::Path::new(&media_path).exists() {
        return Err(format!("media file not found: {}", media_path));
    }
    let lower = media_path.to_lowercase();
    let media_kind = if ["mp4", "mkv", "mov", "avi", "webm", "m4v"]
        .iter().any(|e| lower.ends_with(&format!(".{}", e)))
    {
        "video"
    } else if ["mp3", "wav", "flac", "ogg", "m4a", "aac"]
        .iter().any(|e| lower.ends_with(&format!(".{}", e)))
    {
        "audio"
    } else {
        return Err(format!(
            "unrecognized media extension: {}. Expected one of mp3/wav/flac/ogg/m4a/aac or mp4/mkv/mov/avi/webm/m4v.",
            media_path
        ));
    };
    Ok(AttachMediaResult {
        funscript_path,
        media_path,
        media_kind: media_kind.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Phrases — wire shape returned by `cli.py assess --format json`. The Python
// command runs the FunscriptAnalyzer end-to-end and emits one record per
// detected phrase. PhraseRecord is what we hand to the React side.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CliPhrase {
    at_ms: u64,
    end_ms: u64,
    #[serde(default)]
    number: u32,
    #[serde(default)]
    bpm: f32,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    all_tags: Vec<String>,
    #[serde(default)]
    pattern_label: String,
}

#[derive(Deserialize)]
struct CliPhrasesResult {
    #[serde(default)]
    phrases: Vec<CliPhrase>,
}

#[derive(Serialize)]
pub struct PhraseRecord {
    id: String,
    at_ms: u64,
    end_ms: u64,
    number: u32,
    bpm: f32,
    tag: Option<String>,
    all_tags: Vec<String>,
    pattern_label: String,
}

// Run `cli.py assess <funscript> --format json --no-save` and return the
// parsed phrase records. Used by the Phrases tab to hydrate the action
// table; called lazily when the tab first mounts (rather than on every
// project load) so the assess cost only lands when the user opts in.
// Routes through run_cli_with_progress so the analyzer's six pipeline
// stages (Detecting phases / cycles / patterns / phrases / BPM
// transitions / Classifying behaviors) stream into the AcceptBar footer
// checklist the same way auto-chapter does.
#[tauri::command]
pub async fn analyze_phrases(
    app: AppHandle,
    funscript_path: String,
) -> Result<Vec<PhraseRecord>, String> {
    // No --no-save: writing the phrases sidecar means AnalysisTab can
    // read the same data via loadPhrasesSidecar. Without the write, the
    // Structure cards' "phrases" column shows em-dash because the
    // sidecar that bucket logic depends on doesn't exist.
    let stdout = run_cli_with_progress(
        &app,
        "ff:progress",
        &[
            "assess",
            &funscript_path,
            "--format",
            "json",
        ],
    )
    .await?;

    let parsed: CliPhrasesResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py assess output: {}", e))?;
    Ok(parsed
        .phrases
        .into_iter()
        .map(|p| PhraseRecord {
            id: format!("ph{}", p.number),
            at_ms: p.at_ms,
            end_ms: p.end_ms,
            number: p.number,
            bpm: p.bpm,
            tag: p.tag,
            all_tags: p.all_tags,
            pattern_label: p.pattern_label,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Phrase slice sidecar — cached reader for `.<stem>.forge/<stem>.phrases.json`,
// the slice-schema file `cli.py assess` writes on every run. PatternsTab
// reads this instead of re-running analyze on tab mount — the chapter
// resolution happens client-side via at_ms ∈ chapter membership.
//
// Returns Ok(None) when the sidecar is missing so the tab can render an
// "analyze first" CTA without an error surface. Parse errors DO bubble
// up — a corrupt sidecar is worth noticing.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DiskPhraseSlice {
    #[serde(default)]
    id: String,
    at_ms: u64,
    end_ms: u64,
    #[serde(default)]
    label: String,
    // chapter_id's type drifted: the per-chapter phrase-detection work made
    // the Python writer emit an integer chapter index (0, 1, …); older
    // sidecars wrote a string or null. Accept any JSON shape so a type
    // change in the writer can't break parsing again (Rust-mirror-drift
    // guard). Consumers that need it can coerce client-side.
    #[serde(default)]
    chapter_id: serde_json::Value,
    #[serde(default)]
    metrics: serde_json::Value,
}

#[derive(Deserialize)]
struct DiskPhrasesSidecar {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    slices: Vec<DiskPhraseSlice>,
}

#[derive(Serialize)]
pub struct PhraseSlice {
    pub id: String,
    pub at_ms: u64,
    pub end_ms: u64,
    pub label: String,
    pub chapter_id: serde_json::Value,
    pub metrics: serde_json::Value,
}

#[derive(Serialize)]
pub struct LoadedPhrases {
    pub version: u32,
    pub slices: Vec<PhraseSlice>,
}

fn phrases_sidecar_path(funscript_path: &str) -> String {
    let p = Path::new(funscript_path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("media");
    forge_dir(p)
        .join(format!("{}.phrases.json", stem))
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub async fn load_phrases_sidecar(
    funscript_path: String,
) -> Result<Option<LoadedPhrases>, String> {
    let sp = phrases_sidecar_path(&funscript_path);
    if !Path::new(&sp).exists() {
        return Ok(None);
    }
    let raw = tokio::fs::read_to_string(&sp)
        .await
        .map_err(|e| format!("could not read phrases sidecar at {}: {}", sp, e))?;
    let parsed: DiskPhrasesSidecar = serde_json::from_str(&raw)
        .map_err(|e| format!("could not parse phrases sidecar at {}: {}", sp, e))?;
    Ok(Some(LoadedPhrases {
        version: parsed.version,
        slices: parsed
            .slices
            .into_iter()
            .map(|s| PhraseSlice {
                id: s.id,
                at_ms: s.at_ms,
                end_ms: s.end_ms,
                label: s.label,
                chapter_id: s.chapter_id,
                metrics: s.metrics,
            })
            .collect(),
    }))
}

// ---------------------------------------------------------------------------
// Stanzas — wire shape returned by `cli.py read-stanzas`. These are
// videoflow-classified phrases pulled directly out of the existing
// <stem>.chapters.json sidecar. No analysis is run; the sidecar must
// already exist (written by `auto-chapter` or manual editing).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CliStanza {
    #[serde(default)]
    id: String,
    #[serde(default)]
    number: u32,
    chapter_idx: u32,
    at_ms: u64,
    end_ms: u64,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    source: String,
}

#[derive(Deserialize)]
struct CliStanzaCluster {
    id: String,
    label: String,
    #[serde(default)]
    stanza_ids: Vec<String>,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    length_bucket: f32,
    #[serde(default)]
    density_bucket: String,
}

#[derive(Deserialize)]
struct CliStanzasResult {
    #[serde(default)]
    phrases: Vec<CliStanza>,
    #[serde(default)]
    clusters: Vec<CliStanzaCluster>,
}

#[derive(Serialize)]
pub struct StanzaRecord {
    id: String,
    number: u32,
    chapter_idx: u32,
    at_ms: u64,
    end_ms: u64,
    mode: String,
    source: String,
}

#[derive(Serialize)]
pub struct StanzaCluster {
    id: String,
    label: String,
    stanza_ids: Vec<String>,
    mode: String,
    length_bucket: f32,
    density_bucket: String,
}

#[derive(Serialize)]
pub struct StanzasResponse {
    stanzas: Vec<StanzaRecord>,
    clusters: Vec<StanzaCluster>,
}

// Run `cli.py read-stanzas <path>` and return the parsed stanza records
// plus the computed clusters (mode × length × density buckets). Cheap
// operation (just reads the sidecar JSON + funscript actions for density),
// so no progress streaming. Returns an empty response when the sidecar
// is missing — the frontend renders an empty state nudging the user to
// run auto-chapter.
#[tauri::command]
pub async fn read_stanzas(funscript_path: String) -> Result<StanzasResponse, String> {
    let stdout = run_cli(&["read-stanzas", &funscript_path]).await?;
    let parsed: CliStanzasResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py read-stanzas output: {}", e))?;
    Ok(StanzasResponse {
        stanzas: parsed
            .phrases
            .into_iter()
            .map(|p| StanzaRecord {
                id: if p.id.is_empty() { format!("st{}", p.number) } else { p.id },
                number: p.number,
                chapter_idx: p.chapter_idx,
                at_ms: p.at_ms,
                end_ms: p.end_ms,
                mode: p.mode,
                source: p.source,
            })
            .collect(),
        clusters: parsed
            .clusters
            .into_iter()
            .map(|c| StanzaCluster {
                id: c.id,
                label: c.label,
                stanza_ids: c.stanza_ids,
                mode: c.mode,
                length_bucket: c.length_bucket,
                density_bucket: c.density_bucket,
            })
            .collect(),
    })
}

// ─── list_characters ────────────────────────────────────────────────
//
// Surfaces the canonical Python character catalog (built-in stim presets
// merged with the user's stim_presets.json overrides) to the React UI.
// Slider records pass through as raw JSON — the schema lives in
// funscript-tools' BUILTIN_PRESETS, and pinning Rust types here would
// force a sync every time the slider shape changes. The frontend
// destructures `cv` / `label` / `hint` / `from_` / `to_` / `min_label` /
// `max_label` directly.

#[derive(Deserialize, Serialize)]
pub struct CharacterRecord {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub sliders: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct CliCharactersResult {
    #[serde(default)]
    characters: Vec<CharacterRecord>,
    #[serde(default)]
    warning: Option<String>,
}

#[derive(Serialize)]
pub struct CharactersResponse {
    pub characters: Vec<CharacterRecord>,
    pub warning: Option<String>,
}

#[tauri::command]
pub async fn list_characters() -> Result<CharactersResponse, String> {
    let stdout = run_cli(&["list-characters", "--format", "json"]).await?;
    let parsed: CliCharactersResult = serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py list-characters output: {}", e))?;
    Ok(CharactersResponse {
        characters: parsed.characters,
        warning: parsed.warning,
    })
}

// ─── Transforms — catalog + preview/apply bridge ────────────────────
// The editor's TransformPanel drives these. The authoritative catalog
// (ids, param keys/types/defaults) lives in pattern_catalog; the UI must
// source it from here rather than a hand-port, which drifted (center vs
// target_center, every_n vs every_nth, …) and made sliders silently
// no-op. See cli.py `transform-apply` / `list-transforms`.

/// Full transform catalog as JSON (ids, category, params with types/
/// defaults/ranges). The UI builds its picker from this — single source.
#[tauri::command]
pub async fn list_transforms() -> Result<serde_json::Value, String> {
    let stdout = run_cli(&["list-transforms", "--format", "json", "--verbose"]).await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse cli.py list-transforms output: {}", e))
}

/// Preview ONE transform over a set of spans. Returns
/// {transform, params, spans:[{start_ms,end_ms,actions:[{at,pos}]}]}.
/// Writes nothing — drives the before/after charts. Spans + params are
/// passed as inline JSON (small payloads) so no temp files are needed.
#[tauri::command]
pub async fn transform_preview(
    funscript_path: String,
    transform: String,
    params: serde_json::Value,
    spans: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let spans_s = serde_json::to_string(&spans).map_err(|e| format!("serialize spans: {}", e))?;
    let params_s = serde_json::to_string(&params).map_err(|e| format!("serialize params: {}", e))?;
    // Read the EFFECTIVE funscript (working copy once edits begin) so the
    // before/after reflects cumulative state, not the pristine original.
    let src = effective_funscript_path(&funscript_path);
    let stdout = run_cli(&[
        "transform-apply", &src,
        "--transform", &transform,
        "--spans", &spans_s,
        "--params-json", &params_s,
        "--preview",
    ])
    .await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse transform-apply preview: {}", e))
}

/// Apply ONE transform over a set of spans and return the full MERGED
/// action list — {transform, params, actions:[{at,pos}]}. Writes nothing.
/// This is the editor's in-memory roll-forward (Apply button): the result
/// is patched into the session's working funscript so charts reflect it,
/// while disk persistence rides the later chain-write. Python owns the
/// span-merge so session state and a future chain-write stay identical.
#[tauri::command]
pub async fn transform_apply_actions(
    funscript_path: String,
    transform: String,
    params: serde_json::Value,
    spans: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let spans_s = serde_json::to_string(&spans).map_err(|e| format!("serialize spans: {}", e))?;
    let params_s = serde_json::to_string(&params).map_err(|e| format!("serialize params: {}", e))?;
    // Merge against the EFFECTIVE funscript (working copy once edits begin)
    // so successive applies stack instead of each re-deriving from original.
    let src = effective_funscript_path(&funscript_path);
    let stdout = run_cli(&[
        "transform-apply", &src,
        "--transform", &transform,
        "--spans", &spans_s,
        "--params-json", &params_s,
        "--emit-actions",
    ])
    .await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse transform-apply actions: {}", e))
}

/// Apply ONE transform over a set of spans and write the merged funscript
/// to `output_path`. Returns {saved, transform, spans}.
#[tauri::command]
pub async fn transform_apply(
    funscript_path: String,
    transform: String,
    params: serde_json::Value,
    spans: serde_json::Value,
    output_path: String,
) -> Result<serde_json::Value, String> {
    let spans_s = serde_json::to_string(&spans).map_err(|e| format!("serialize spans: {}", e))?;
    let params_s = serde_json::to_string(&params).map_err(|e| format!("serialize params: {}", e))?;
    let stdout = run_cli(&[
        "transform-apply", &funscript_path,
        "--transform", &transform,
        "--spans", &spans_s,
        "--params-json", &params_s,
        "--output", &output_path,
    ])
    .await?;
    serde_json::from_str(&stdout)
        .map_err(|e| format!("could not parse transform-apply result: {}", e))
}

/// Persist the current working actions to `<stem>.work.funscript` in the
/// forge dir — the durable save state Export reads and reopen restores. The
/// ORIGINAL funscript is never touched (Revert = delete the work file).
///
/// Reads the original as generic JSON so every non-`actions` field
/// (metadata, range, inverted, …) is preserved; only `actions` is replaced.
/// Upserts a minimal `<stem>.ffmeta.json` manifest pointing at the work
/// file + an `edited_at` stamp so the UI/Export can tell a project carries
/// unsaved-to-original edits. Write-through happens on every Apply, so this
/// is crash-safe: closing without an explicit Accept loses nothing.
#[tauri::command]
pub async fn save_working_funscript(
    funscript_path: String,
    actions: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let original = Path::new(&funscript_path);
    let forge = forge_dir(original);
    tokio::fs::create_dir_all(&forge)
        .await
        .map_err(|e| format!("create forge dir {}: {}", forge.display(), e))?;

    // Preserve all non-action fields from the pristine original.
    let raw = tokio::fs::read_to_string(&funscript_path)
        .await
        .map_err(|e| format!("read original {}: {}", &funscript_path, e))?;
    let mut doc: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("parse original funscript: {}", e))?;
    if !doc.is_object() {
        return Err("original funscript is not a JSON object".into());
    }
    doc["actions"] = actions;

    let work = working_funscript_path(original);
    let work_str = work.to_string_lossy().into_owned();
    let body = serde_json::to_string(&doc).map_err(|e| format!("serialize work fs: {}", e))?;
    tokio::fs::write(&work, body)
        .await
        .map_err(|e| format!("write {}: {}", work_str, e))?;

    // Upsert the authoring manifest. Minimal for now — version, the work-fs
    // basename, the source basename, and an edited_at stamp. Export + load
    // read it; richer per-tab fields land with the chain pass.
    let stem_name = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let edited_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let manifest_path = forge.join(format!("{}.ffmeta.json", stem_name));
    let mut manifest = match tokio::fs::read_to_string(&manifest_path).await {
        Ok(s) => serde_json::from_str::<serde_json::Value>(&s).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    if !manifest.is_object() {
        manifest = serde_json::json!({});
    }
    manifest["version"] = serde_json::json!(1);
    manifest["source"] = serde_json::json!(format!("{}.funscript", stem_name));
    manifest["work_funscript"] = serde_json::json!(format!("{}.work.funscript", stem_name));
    manifest["edited_at"] = serde_json::json!(edited_at);
    let manifest_body =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize manifest: {}", e))?;
    tokio::fs::write(&manifest_path, manifest_body)
        .await
        .map_err(|e| format!("write manifest {}: {}", manifest_path.display(), e))?;

    Ok(serde_json::json!({ "saved": work_str, "edited_at": edited_at }))
}

/// Revert to the original funscript by deleting the working copy + its
/// manifest work pointer. The next load_project falls back to the pristine
/// original. No-op (Ok) if there's nothing to revert.
#[tauri::command]
pub async fn revert_working_funscript(
    funscript_path: String,
) -> Result<serde_json::Value, String> {
    let original = Path::new(&funscript_path);
    let work = working_funscript_path(original);
    let existed = tokio::fs::metadata(&work).await.is_ok();
    if existed {
        tokio::fs::remove_file(&work)
            .await
            .map_err(|e| format!("remove {}: {}", work.display(), e))?;
    }
    // Drop the work pointer from the manifest (leave other fields intact).
    let stem_name = original
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let manifest_path = forge_dir(original).join(format!("{}.ffmeta.json", stem_name));
    if let Ok(s) = tokio::fs::read_to_string(&manifest_path).await {
        if let Ok(mut m) = serde_json::from_str::<serde_json::Value>(&s) {
            if let Some(obj) = m.as_object_mut() {
                obj.remove("work_funscript");
                obj.remove("edited_at");
                let body = serde_json::to_string_pretty(&m).unwrap_or(s);
                let _ = tokio::fs::write(&manifest_path, body).await;
            }
        }
    }
    Ok(serde_json::json!({ "reverted": existed }))
}

/// Project the Edger event_definitions + SFW/NSFW map into the Events
/// catalog: `{ groups, recipes[] }` (all 32 events, grouped, with labels,
/// real params, and the step stack). Backend-sourced; no args.
#[tauri::command]
pub async fn list_event_recipes() -> Result<serde_json::Value, String> {
    let out = run_cli(&["list-event-recipes"]).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse list-event-recipes output: {}", e))
}

/// Read the Events tab's `<stem>.feel.yml` events (canonical middle file)
/// in the EventsTab JS shape. The `.feel.yml` path is computed Python-side
/// (forge_dir), so no path mirroring is needed here. Returns
/// `{ version, events: [] }` when the sidecar is missing.
#[tauri::command]
pub async fn read_feel_events(funscript_path: String) -> Result<serde_json::Value, String> {
    let out = run_cli(&["feel-read", &funscript_path]).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse feel-read output: {}", e))
}

/// Write the Events tab's events to `<stem>.feel.yml`. `run_cli` has no
/// stdin, so the events JSON is staged to a temp file and passed via
/// --events-json; the temp file is removed afterward.
#[tauri::command]
pub async fn save_feel_events(
    funscript_path: String,
    events: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let body = serde_json::to_string(&events).map_err(|e| format!("serialize events: {}", e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("ff_feel_{}.json", nanos));
    tokio::fs::write(&tmp, body)
        .await
        .map_err(|e| format!("write temp events: {}", e))?;
    let tmp_str = tmp.to_string_lossy().into_owned();
    let res = run_cli(&["feel-write", &funscript_path, "--events-json", &tmp_str]).await;
    let _ = tokio::fs::remove_file(&tmp).await;
    let out = res?;
    serde_json::from_str(&out).map_err(|e| format!("parse feel-write output: {}", e))
}

/// Read the Channels tab's per-chapter character assignments from
/// `<stem>.characters.json`. Returns `{ version, characters: {} }` when the
/// sidecar is missing. The path is computed Python-side (forge_dir).
#[tauri::command]
pub async fn read_characters(funscript_path: String) -> Result<serde_json::Value, String> {
    let out = run_cli(&["characters-read", &funscript_path]).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse characters-read output: {}", e))
}

/// Write the Channels tab's per-chapter character assignments to
/// `<stem>.characters.json`. The map is staged to a temp file (run_cli has no
/// stdin) and passed via --characters-json; the temp file is removed after.
#[tauri::command]
pub async fn save_characters(
    funscript_path: String,
    characters: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let body = serde_json::to_string(&characters)
        .map_err(|e| format!("serialize characters: {}", e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("ff_characters_{}.json", nanos));
    tokio::fs::write(&tmp, body)
        .await
        .map_err(|e| format!("write temp characters: {}", e))?;
    let tmp_str = tmp.to_string_lossy().into_owned();
    let res = run_cli(&["characters-write", &funscript_path, "--characters-json", &tmp_str]).await;
    let _ = tokio::fs::remove_file(&tmp).await;
    let out = res?;
    serde_json::from_str(&out).map_err(|e| format!("parse characters-write output: {}", e))
}

/// Generate e-stim channel funscripts for a window (a chapter) via the
/// funscript-tools pipeline — the React bridge to the same `process()` the
/// Streamlit stim tab used. `mode` is "2d" (alpha+beta, fast) or "3phase"
/// (10 channels, slow). The slider overrides are staged to a temp file.
/// Returns `{ available, mode, channels: { suffix: { actions[] } } }`.
#[tauri::command]
pub async fn stim_process(
    funscript_path: String,
    character: String,
    sliders: serde_json::Value,
    mode: String,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    let body = serde_json::to_string(&sliders).map_err(|e| format!("serialize sliders: {}", e))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("ff_sliders_{}.json", nanos));
    tokio::fs::write(&tmp, body)
        .await
        .map_err(|e| format!("write temp sliders: {}", e))?;
    let tmp_str = tmp.to_string_lossy().into_owned();

    let mut args: Vec<String> = vec![
        "stim-process".into(),
        funscript_path,
        "--character".into(),
        character,
        "--sliders-json".into(),
        tmp_str.clone(),
        "--mode".into(),
        mode,
    ];
    if let Some(s) = start_ms {
        args.push("--start-ms".into());
        args.push(s.to_string());
    }
    if let Some(e) = end_ms {
        args.push("--end-ms".into());
        args.push(e.to_string());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let res = run_cli(&argv).await;
    let _ = tokio::fs::remove_file(&tmp).await;
    let out = res?;
    serde_json::from_str(&out).map_err(|e| format!("parse stim-process output: {}", e))
}

/// Generate secondary-axis funscripts for a window (a chapter) via the
/// multiaxis engine — the React bridge to `forge.multiaxis.generate_multiaxis`.
/// Deterministic + sub-millisecond per chapter (pure Python, no subprocess),
/// so no temp-file staging needed. Returns
/// `{ available, style, axes: { twist|roll|pitch|surge|sway: { actions[] } } }`.
#[tauri::command]
pub async fn multiaxis_process(
    funscript_path: String,
    style: String,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec![
        "multiaxis-process".into(),
        funscript_path,
        "--style".into(),
        style,
    ];
    if let Some(s) = start_ms {
        args.push("--start-ms".into());
        args.push(s.to_string());
    }
    if let Some(e) = end_ms {
        args.push("--end-ms".into());
        args.push(e.to_string());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_cli(&argv).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse multiaxis-process output: {}", e))
}

/// Polish — preview the 3-pane device-clamp trace for one station over a
/// window. Reads the EFFECTIVE funscript (working copy once edits begin).
/// Returns `{ station, character, clamped, performed, stats }`.
#[tauri::command]
pub async fn polish_preview(
    funscript_path: String,
    station: String,
    params: serde_json::Value,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<serde_json::Value, String> {
    let params_s = serde_json::to_string(&params).map_err(|e| format!("serialize params: {}", e))?;
    let src = effective_funscript_path(&funscript_path);
    let mut args: Vec<String> = vec![
        "polish-apply".into(), src,
        "--station".into(), station,
        "--params-json".into(), params_s,
        "--preview".into(),
    ];
    if let Some(s) = start_ms {
        args.push("--start-ms".into());
        args.push(s.to_string());
    }
    if let Some(e) = end_ms {
        args.push("--end-ms".into());
        args.push(e.to_string());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_cli(&argv).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse polish preview: {}", e))
}

/// Polish — clamp the whole track for one station and write its device-ready
/// file(s) under `<forge>/polish/<station>/`. Reads the EFFECTIVE funscript.
/// Returns `{ station, saved[], stats, source_hash }` (or `pending` for
/// stations whose generation isn't wired yet, e.g. e-stim).
#[tauri::command]
pub async fn polish_apply(
    funscript_path: String,
    station: String,
    params: serde_json::Value,
    stem: Option<String>,
) -> Result<serde_json::Value, String> {
    let params_s = serde_json::to_string(&params).map_err(|e| format!("serialize params: {}", e))?;
    let src = effective_funscript_path(&funscript_path);
    let mut args: Vec<String> = vec![
        "polish-apply".into(), src,
        "--station".into(), station,
        "--params-json".into(), params_s,
    ];
    if let Some(s) = stem {
        args.push("--stem".into());
        args.push(s);
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_cli(&argv).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse polish apply: {}", e))
}

/// Read the `<stem>.polish.yml` stamp record. Returns
/// `{ version, schema, current_hash, passes }` (empty when absent).
#[tauri::command]
pub async fn polish_read(input: String) -> Result<serde_json::Value, String> {
    let out = run_cli(&["polish-read", &input]).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse polish-read: {}", e))
}

/// Write the `<stem>.polish.yml` stamp record. `passes` is the per-station
/// map; the source hash is stamped on the Python side. Returns
/// `{ saved, count, source_hash }`.
#[tauri::command]
pub async fn polish_write(
    input: String,
    passes: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let passes_s = serde_json::to_string(&passes).map_err(|e| format!("serialize passes: {}", e))?;
    let out = run_cli(&["polish-write", &input, "--passes-json", &passes_s]).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse polish-write: {}", e))
}

/// Export — collect the project's outputs into a loose folder or a `.forge`
/// zip. Reads the EFFECTIVE funscript; packs the main motion track, Polish's
/// stamped station files, a fresh events.yml, authoring sidecars, and a
/// manifest.ffmeta. Returns `{ mode, path, artifacts, stations, manifest }`.
#[tauri::command]
pub async fn export_write(
    funscript_path: String,
    mode: String,
    out: Option<String>,
    blend_seams: bool,
    final_smooth: bool,
    stem: Option<String>,
    media: Option<String>,
    stim_audio: bool,
) -> Result<serde_json::Value, String> {
    let src = effective_funscript_path(&funscript_path);
    let mut args: Vec<String> = vec!["export".into(), src, "--mode".into(), mode];
    if let Some(o) = out {
        args.push("--out".into());
        args.push(o);
    }
    if let Some(s) = stem {
        args.push("--stem".into());
        args.push(s);
    }
    if let Some(m) = media {
        args.push("--media".into());
        args.push(m);
    }
    if blend_seams {
        args.push("--blend-seams".into());
    }
    if final_smooth {
        args.push("--final-smooth".into());
    }
    if stim_audio {
        args.push("--stim-audio".into());
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = run_cli(&argv).await?;
    serde_json::from_str(&out).map_err(|e| format!("parse export result: {}", e))
}

/// Reveal a path in the OS file manager (selects the file on Windows). Best
/// effort — Explorer returns a non-zero exit even on success, so we don't
/// check status.
#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let mut cmd = std::process::Command::new("explorer");
    if p.is_file() {
        cmd.arg("/select,").arg(&path);
    } else {
        cmd.arg(&path);
    }
    let _ = cmd.spawn().map_err(|e| format!("reveal {}: {}", path, e))?;
    Ok(())
}

/// Export `<stem>.feel.yml` to a playable Edger `<stem>.events.yml`. With
/// `write=false` nothing is written — the rendered YAML is still returned
/// (Preview). Returns `{ path, count, skipped[], yaml }`.
#[tauri::command]
pub async fn edger_export(
    funscript_path: String,
    out: Option<String>,
    write: bool,
) -> Result<serde_json::Value, String> {
    let mut args: Vec<String> = vec!["edger-export".into(), funscript_path];
    if !write {
        args.push("--no-write".into());
    }
    if let Some(o) = out {
        args.push("--out".into());
        args.push(o);
    }
    let argv: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_cli(&argv).await?;
    serde_json::from_str(&stdout).map_err(|e| format!("parse edger-export output: {}", e))
}

/// Import an Edger `events.yml` into the EventsTab JS shape (the UI persists
/// them via save_feel_events). Returns `{ events[], imported, skipped[] }`;
/// events whose name isn't in our vendored definitions are skipped, not dropped.
#[tauri::command]
pub async fn edger_import(events_yml_path: String) -> Result<serde_json::Value, String> {
    let stdout = run_cli(&["edger-import", &events_yml_path]).await?;
    serde_json::from_str(&stdout).map_err(|e| format!("parse edger-import output: {}", e))
}

// Deterministic chapter color cycle. Matches the prototype's ChapterBands
// where each chapter has a stable swatch independent of tone selection.
const CHAPTER_PALETTE: &[&str] = &[
    "#4a90d9", "#56e0a0", "#f39c12", "#9b59b6", "#e74c3c", "#2ecc71", "#5a8eff", "#ff8c47",
];

fn strip_funscript_ext(path: &str) -> String {
    if path.to_lowercase().ends_with(".funscript") {
        path[..path.len() - ".funscript".len()].to_string()
    } else {
        path.to_string()
    }
}

// Look for a media file (video / audio) with the same stem as the funscript.
// Video extensions checked first — most funscripts are authored against video.
// If neither exists, returns (None, "audio") so the UI has a safe default.
fn find_adjacent_media(stem: &str) -> (Option<String>, String) {
    const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "mov", "avi", "webm", "m4v"];
    const AUDIO_EXTS: &[&str] = &["mp3", "wav", "flac", "ogg", "m4a", "aac"];
    for ext in VIDEO_EXTS {
        let p = format!("{}.{}", stem, ext);
        if std::fs::metadata(&p).is_ok() {
            return (Some(p), "video".to_string());
        }
    }
    for ext in AUDIO_EXTS {
        let p = format!("{}.{}", stem, ext);
        if std::fs::metadata(&p).is_ok() {
            return (Some(p), "audio".to_string());
        }
    }
    (None, "audio".to_string())
}

fn format_duration(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}:{:02}", s / 60, s % 60)
}

// Map the canonical tone suggestion to its brand color (mirrors
// forge/tabs/tone_tab.py::_TONES). Used as the project's accent tint until
// the user attaches a different color via media metadata.
fn tone_color(tone: Option<&str>) -> String {
    match tone {
        Some("Tender")   => "#4a90d9",
        Some("Build")    => "#2ecc71",
        Some("Tease")    => "#9b59b6",
        Some("Edge")     => "#f39c12",
        Some("Climax")   => "#e74c3c",
        Some("Dominant") => "#2c3e50",
        _ => "#56e0a0",
    }
    .to_string()
}

// ─── prewarm_media_range ────────────────────────────────────────────
//
// Read a chapter's byte range from the media file into the kernel page
// cache, then discard. The Chromium <video> element's subsequent
// range requests for that region hit warm cache instead of cold disk,
// which is the difference between "stutters on a 90-min 18GB file" and
// "plays smooth as a small file."
//
// Why this is needed: Chromium / WebView2 silently drops video frames
// when its decoder is starved by slow asset:// I/O — `waiting` never
// fires, so we can't even pause-to-buffer cleanly. Pre-warming the
// kernel cache eliminates the cold-read latency that's actually the
// root cause.
//
// Byte range is estimated linearly from the ms range. That's
// approximate (variable-bitrate files won't be exact) but the kernel
// cache holds adjacent bytes anyway, so a ~10% slop just means a bit
// of extra cache churn — harmless.
//
// Reads in 1MB chunks via tokio so the command yields back to the
// runtime regularly. For a 5-min chapter in an 18GB / 9601s file the
// range is ~570MB, takes ~3s on local SSD. Frontend shows
// "Loading chapter…" until this returns.
#[tauri::command]
pub async fn prewarm_media_range(
    media_path: String,
    start_ms: u64,
    end_ms: u64,
    total_ms: u64,
) -> Result<u64, String> {
    use tokio::fs::File;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};

    if total_ms == 0 || end_ms <= start_ms {
        return Ok(0);
    }

    let mut file = File::open(&media_path)
        .await
        .map_err(|e| format!("open {}: {}", media_path, e))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|e| format!("stat {}: {}", media_path, e))?;
    let file_size = metadata.len();

    // Linear ms→byte estimation. VBR will be approximate but the
    // kernel page cache is byte-addressable so slop is fine.
    let start_byte =
        ((start_ms as f64 / total_ms as f64) * file_size as f64) as u64;
    let end_byte_raw =
        ((end_ms as f64 / total_ms as f64) * file_size as f64) as u64;
    let end_byte = end_byte_raw.min(file_size);
    if end_byte <= start_byte {
        return Ok(0);
    }
    let read_len = end_byte - start_byte;

    file.seek(SeekFrom::Start(start_byte))
        .await
        .map_err(|e| format!("seek: {}", e))?;

    let mut buf = vec![0u8; 1024 * 1024];
    let mut total_read: u64 = 0;
    while total_read < read_len {
        let to_read = std::cmp::min(buf.len() as u64, read_len - total_read) as usize;
        let n = file
            .read(&mut buf[..to_read])
            .await
            .map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            break;
        }
        total_read += n as u64;
    }
    Ok(total_read)
}

// ─── extract_chapter_clip helpers ────────────────────────────────────
//
// Encode args mirror videoflow's chapter_clips.py — keep both sides
// in sync and bump CACHE_VERSION below when the args change. The two
// paths share a cache directory; identical args = identical bytes =
// cache hits across paths.

// Sources wider than this get the 720p downscale path. 1920 catches
// 4K (3840), 5K (5120), 8K (7680), and 1440p (2560-wide). 1080p and
// below keep the SDR args verbatim.
const DOWNSCALE_WIDTH_THRESHOLD: u32 = 1920;

// SDR encode args (≤1920px sources). Native-resolution H.264 re-encode
// to baseline profile + 30fps + 48 kHz AAC. v11's `-avoid_negative_ts
// make_zero` is the critical bit for Chromium playback — see
// CACHE_VERSION comment in extract_chapter_clip.
const FFMPEG_ENCODE_ARGS_SDR: &[&str] = &[
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-preset", "ultrafast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-f", "mp4",
    "-y",
];

// 4K downscale encode args (>1920px sources). Lanczos scale to 1280x720
// + explicit BT.709 color flags so graded sources (iris coloring etc)
// survive the re-encode without desaturating. CRF tightened to 20
// because lanczos cleans the codec input. WebView2 plays 720p clips
// cleanly where it OOMs / decode-errors on multi-GB 4K clips.
//
// HDR / BT.2020 sources get tonemap-less conversion to SDR BT.709 —
// acceptable for editor preview (the funscript output ignores pixel
// colour). Proper HDR tonemapping needs zscale + a heavier pipeline.
const FFMPEG_ENCODE_ARGS_4K_DOWNSCALE: &[&str] = &[
    "-c:v", "libx264",
    "-profile:v", "baseline",
    "-level", "3.1",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-vf", "scale=1280:720:flags=lanczos",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-colorspace", "bt709",
    "-color_range", "tv",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    "-f", "mp4",
    "-y",
];

// Probe the source's first video stream width × height by running
// `ffmpeg -i <path>` with no output. ffmpeg prints stream info to
// stderr and exits 1 (no output file). Returns None on probe failure
// — callers fall back to SDR args, which is safe (just no downscale).
async fn probe_video_dimensions(
    media_path: &str, ffmpeg_bin: &str,
) -> Option<(u32, u32)> {
    let output = Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-loglevel", "info", "-i", media_path])
        .output()
        .await
        .ok()?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_video_dims(&stderr)
}

// Walk ffmpeg stderr looking for the first "Video:" line, then the
// first WIDTHxHEIGHT token on that line (must be ≥100 in each dim
// so we don't grab a SAR/DAR ratio like "4x3" or pixel-format digits).
fn parse_video_dims(stderr: &str) -> Option<(u32, u32)> {
    for line in stderr.lines() {
        if !line.contains("Video:") {
            continue;
        }
        for token in line.split([' ', ',']) {
            let token = token.trim_matches(|c: char| !c.is_ascii_digit() && c != 'x');
            let Some(x_pos) = token.find('x') else { continue };
            let w_str = &token[..x_pos];
            let h_str = &token[x_pos + 1..];
            if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
                if w >= 100 && h >= 100 {
                    return Some((w, h));
                }
            }
        }
    }
    None
}

// ─── extract_chapter_clip ───────────────────────────────────────────
//
// Stream-copy a chapter slice from a long source media file into a
// small temp file. The Chromium <video> element then plays the temp
// file (which is a real small file, not byte-ranged off a 18GB blob)
// and the per-range-request overhead that was breaking long-file
// playback disappears entirely.
//
// Stream copy (-c copy) doesn't re-encode — it remuxes the original
// packets into a new container. Fast (~200MB/s on local SSD ~ a few
// seconds per typical chapter) but key-frame-snapped: ffmpeg can only
// cut on keyframe boundaries, so the actual clip start may sit a few
// seconds before the requested start_ms (the nearest preceding I-frame).
// We accept that slop and report it back via actual_start_ms so the
// frontend can offset playback accordingly.
//
// Cache: clips live inside the per-project forge dir
// (``<source_dir>/.<stem>.forge/clips/``), named deterministically by
// (sanitized_stem + cache_version + start + end). Re-entering a chapter
// that's already been extracted is instant. Delete the whole
// ``.<stem>.forge/`` folder to evict everything for one project — the
// clips and sidecars share the same per-project home.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterClipResult {
    pub temp_path: String,
    pub actual_start_ms: u64,
    pub actual_end_ms: u64,
    pub cached: bool,
}

#[tauri::command]
pub async fn extract_chapter_clip(
    media_path: String,
    start_ms: u64,
    end_ms: u64,
) -> Result<ChapterClipResult, String> {
    if end_ms <= start_ms {
        return Err(format!(
            "extract_chapter_clip: end_ms ({}) must exceed start_ms ({})",
            end_ms, start_ms
        ));
    }

    // Deterministic clip filename. Mirrors videoflow's
    // ``chapter_clip_path`` exactly so the videoflow auto_chapter
    // pipeline pre-builds into the same cache this command reads
    // from. After Analyze, every chapter click is a cache hit —
    // this function only re-extracts for projects analyzed under an
    // older cache version or before the videoflow stage existed.
    //
    // Cache version. v2-v5 chased AAC decode errors (resample,
    // profile, aresample filter, full re-encode). v6: -an diagnostic
    // — confirmed silent video also stutters on Victoria/Prisoner.
    // v7: baseline H.264 profile + level 3.1 + constant 30fps to test
    // if the source's H.264 profile/B-frame structure was triggering
    // WebView2 stutter. v8: still -an. v9: AAC failed with
    // PIPELINE_ERROR_DECODE on the first frame. v10: same failure
    // with MP3 — ruled out the audio codec. v11 adds the missing
    // `-avoid_negative_ts make_zero` flag: with `-ss` before `-i`
    // ffmpeg does a fast keyframe-snapped seek that can produce
    // negative timestamps on the first audio packet (because the
    // audio sample timeline doesn't share the video keyframe grid).
    // Chromium rejects packets with negative TS — that was the
    // actual root cause masquerading as a codec issue for v9/v10.
    //
    // v12: Conditional 720p downscale for sources wider than 1920px.
    // Extraction time on 4K sources drops ~10x; WebView2 OOMs and
    // PIPELINE_ERROR_DECODE failures on stream-copied 4K audio go
    // away because the audio gets re-encoded through Chromium-friendly
    // AAC. SDR (≤1920px) keeps v11 args verbatim. Mirrors videoflow's
    // chapter_clips.py CACHE_VERSION — both paths produce the same
    // bytes for the same source so they share cache hits.
    const CACHE_VERSION: &str = "v12";

    let src_path = Path::new(&media_path);
    let ext = src_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let stem = src_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let safe_stem = sanitize_stem(stem);

    // Clip cache lives inside the per-project hidden forge directory
    // (``<source_dir>/.<source_stem>.forge/clips/``). Mirrors videoflow's
    // ``videoflow.chapter_clips.chapter_clips_dir`` so both writers
    // produce paths each other will hit as cache hits. The forge dir
    // also holds all the sidecars Analyze writes (peaks, spectrogram,
    // beats, chapters) — one folder per project, deletable as a unit.
    let temp_dir = forge_clips_dir(src_path);
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("create forge clips dir: {}", e))?;
    }
    let mut temp_path = temp_dir.clone();
    temp_path.push(format!(
        "{}_{}_{}_{}.{}",
        safe_stem, CACHE_VERSION, start_ms, end_ms, ext,
    ));
    let temp_str = temp_path
        .to_str()
        .ok_or_else(|| "temp path is not utf-8".to_string())?
        .to_string();

    // Cache hit: return existing clip immediately. Common case after
    // videoflow's auto_chapter pre-built every chapter.
    if temp_path.exists() {
        return Ok(ChapterClipResult {
            temp_path: temp_str,
            actual_start_ms: start_ms,
            actual_end_ms: end_ms,
            cached: true,
        });
    }

    // Write to a process-scoped temp filename, then atomic-rename to the
    // final path on success. Without this, the Python videoflow pipeline
    // and this Rust command can both target the same final path
    // concurrently when the user clicks a chapter while Analyze is
    // running — two ffmpeg processes interleave their writes and
    // produce a structurally-corrupt MP4 (duplicated MOOV atom,
    // garbled H.264 NAL units; 2026-05-22 dogfood). The atomic rename
    // gives a winner-takes-all semantic: if another process finishes
    // first, our tmp file gets deleted and we serve their result.
    //
    // CRITICAL: keep the `.mp4` (or source) extension at the END of
    // the tmp filename so ffmpeg can auto-detect the output container.
    // First attempt used `<final>.mp4.tmp.<pid>` and ffmpeg threw
    // "Unable to choose an output format" because the trailing
    // `.<pid>` isn't a recognized extension. The pid suffix slots
    // between the stem and the real extension instead.
    let pid = std::process::id();
    let file_stem = temp_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "final path missing stem".to_string())?;
    let mut tmp_path = temp_dir.clone();
    tmp_path.push(format!("{}.tmp.{}.{}", file_stem, pid, ext));
    let tmp_str = tmp_path
        .to_str()
        .ok_or_else(|| "tmp path is not utf-8".to_string())?
        .to_string();

    // ffmpeg invocation. The encode args are picked based on source
    // resolution — sources wider than DOWNSCALE_WIDTH_THRESHOLD (1920px)
    // get scaled to 720p with explicit BT.709 color flags; smaller
    // sources keep the v11 native-resolution path. Both arg sets share
    // `-avoid_negative_ts make_zero`, which is the bit Chromium needs
    // — with `-ss` before `-i` ffmpeg fast-seeks to the nearest keyframe,
    // which can leave the audio stream's first PTS negative. Chromium
    // rejects negative-TS packets with PIPELINE_ERROR_DECODE; `make_zero`
    // shifts every stream so the smallest TS becomes 0.
    let ffmpeg_bin = find_bundled_ffmpeg();
    let start_sec = start_ms as f64 / 1000.0;
    let to_sec = end_ms as f64 / 1000.0;
    let start_str = format!("{:.3}", start_sec);
    let to_str = format!("{:.3}", to_sec);

    // Probe before encoding so the encode args match the source. The
    // probe is one extra ffmpeg invocation per non-cached clip — header
    // read only, ~50ms. Cache hits short-circuit way above this point,
    // so cached chapters skip the probe entirely.
    let dims = probe_video_dimensions(&media_path, &ffmpeg_bin).await;
    let encode_args: &[&str] = match dims {
        Some((w, _)) if w > DOWNSCALE_WIDTH_THRESHOLD => FFMPEG_ENCODE_ARGS_4K_DOWNSCALE,
        _ => FFMPEG_ENCODE_ARGS_SDR,
    };

    let mut ff_args: Vec<&str> = vec![
        "-hide_banner",
        "-loglevel", "error",
        "-ss", &start_str,
        "-to", &to_str,
        "-i", &media_path,
    ];
    ff_args.extend_from_slice(encode_args);
    ff_args.push(&tmp_str);

    let output = Command::new(&ffmpeg_bin)
        .args(&ff_args)
        .output()
        .await
        .map_err(|e| format!("spawn ffmpeg ({}): {}", ffmpeg_bin, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up partial file on failure so we don't cache garbage.
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!(
            "ffmpeg extract failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }

    // Atomic publish. If another process beat us to the final path
    // (e.g. videoflow's auto_chapter ran in parallel), keep their copy
    // and drop ours — rename would clobber a complete file. On Windows
    // `rename` to an existing path fails with ERROR_ALREADY_EXISTS, so
    // we explicitly re-check before renaming.
    if temp_path.exists() {
        let _ = std::fs::remove_file(&tmp_path);
        return Ok(ChapterClipResult {
            temp_path: temp_str,
            actual_start_ms: start_ms,
            actual_end_ms: end_ms,
            cached: true,
        });
    }
    if let Err(e) = std::fs::rename(&tmp_path, &temp_path) {
        // Another process may have published the final between our
        // existence check and the rename. Re-check; if so, keep theirs.
        if temp_path.exists() {
            let _ = std::fs::remove_file(&tmp_path);
            return Ok(ChapterClipResult {
                temp_path: temp_str,
                actual_start_ms: start_ms,
                actual_end_ms: end_ms,
                cached: true,
            });
        }
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("rename clip into cache: {}", e));
    }

    // Use the requested duration as the actual_end_ms. ffmpeg's
    // keyframe-snapped output may differ by a few seconds but that's
    // close enough for playback bounds — the video element naturally
    // stops at the real EOF.
    Ok(ChapterClipResult {
        temp_path: temp_str,
        actual_start_ms: start_ms,
        actual_end_ms: end_ms,
        cached: false,
    })
}

// Compute the per-project hidden forge directory for a media file.
// Mirrors ``videoflow.sidecar.forge_dir``:
//   <source_dir>/.<source_stem>.forge/
// The forge dir holds every sidecar Analyze writes (peaks, spectrogram,
// beats, chapters) plus the clips/ subdirectory. Tests verify both
// languages produce the same path string.
fn forge_dir(media_path: &Path) -> PathBuf {
    let stem = media_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let parent = media_path.parent().unwrap_or(Path::new("."));
    parent.join(format!(".{}.forge", stem))
}

// Per-project chapter-clip cache directory. The clips/ subfolder inside
// the forge dir. Returned as-is — caller mkdir's before writing.
fn forge_clips_dir(media_path: &Path) -> PathBuf {
    forge_dir(media_path).join("clips")
}

// ── Working funscript (durable edit state) ──────────────────────────────
// Edits made in the editor (transform Apply, tone bake, …) accumulate into
// a SEPARATE working funscript inside the forge dir — the original is never
// mutated, so "Revert to original" is just deleting the work file. This is
// the durable save state that survives close/reopen and is what Export
// reads. See project-transforms-wiring / project-export-bundle-design.
//
// Named `<stem>.work.funscript` so it sorts next to the source sidecars and
// reads obviously in a file browser.
fn working_funscript_path(funscript_path: &Path) -> PathBuf {
    let stem = funscript_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    forge_dir(funscript_path).join(format!("{}.work.funscript", stem))
}

// The funscript an EDIT operation should read: the working copy if edits
// have begun, else the pristine original. Every transform/preview/export
// op routes through this so successive edits stack (apply #2 sees apply
// #1's result) instead of each re-deriving from the original. `path` stays
// the original everywhere else (stem/forge/sidecar resolution) — only the
// action source swaps.
fn effective_funscript_path(funscript_path: &str) -> String {
    let work = working_funscript_path(Path::new(funscript_path));
    if std::fs::metadata(&work).is_ok() {
        work.to_string_lossy().into_owned()
    } else {
        funscript_path.to_string()
    }
}

// Reduce a filename stem to a filesystem-safe subset of characters.
// Must match `videoflow.chapter_clips._sanitize_stem` exactly: any
// character outside `[A-Za-z0-9_.-]` collapses to `_`, runs collapse
// to a single underscore, and leading/trailing `.` / `_` are stripped.
// Empty inputs map to `"media"`. Both languages need identical output
// or the cache they share would silently miss.
fn sanitize_stem(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    // Tracks whether the previous emit was a SUBSTITUTED underscore so
    // runs of disallowed characters collapse to a single underscore.
    // An *allowed* underscore in the source doesn't suppress the next
    // substitution — `"foo_ bar"` matches Python's regex output of
    // `"foo__bar"`, not `"foo_bar"`.
    let mut just_substituted = false;
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-' {
            out.push(c);
            just_substituted = false;
        } else if !just_substituted {
            out.push('_');
            just_substituted = true;
        }
    }
    let trimmed = out.trim_matches(|c: char| c == '.' || c == '_');
    if trimmed.is_empty() {
        "media".to_string()
    } else {
        trimmed.to_string()
    }
}

// Locate the bundled ffmpeg binary. Mirrors videoflow.chapters._find_ffmpeg
// in spirit — check known bundled locations first, fall back to PATH.
//
// The funscriptforge venv installs imageio_ffmpeg which ships a Windows
// ffmpeg.exe under its binaries/ dir. That's the canonical bundled
// binary for this app — same one videoflow's audio extraction uses.
fn find_bundled_ffmpeg() -> String {
    let root = std::env::var("FUNSCRIPTFORGE_ROOT")
        .unwrap_or_else(|_| DEV_FUNSCRIPTFORGE_ROOT.to_string());

    let candidates = [
        format!(
            r"{}\.venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe",
            root
        ),
        format!(r"{}\.venv\Scripts\ffmpeg.exe", root),
        format!(r"{}\ffmpeg.exe", root),
    ];

    for c in &candidates {
        if std::path::Path::new(c).is_file() {
            return c.clone();
        }
    }
    // Fall back to PATH lookup. If ffmpeg isn't on PATH the spawn
    // returns an OS error which propagates up as an extract failure.
    "ffmpeg".to_string()
}

// Wipe a project's entire `.forge/` cache (all sidecars + clips) so the
// next analyze runs fresh from extract. Used by the AnalysisTab's
// "Re-analyze" button to give the user a way out of stale or partial
// cache states without manually deleting folders in the file manager.
//
// Returns Ok(true) if the forge dir was removed, Ok(false) if it didn't
// exist (a clean no-op). Errors propagate so the React side can surface
// a meaningful message if the removal failed (locked files, permission
// denied, etc.).
#[tauri::command]
pub async fn wipe_forge_dir(media_path: String) -> Result<bool, String> {
    let p = Path::new(&media_path);
    let forge = forge_dir(p);
    if !forge.exists() {
        return Ok(false);
    }
    tokio::fs::remove_dir_all(&forge)
        .await
        .map_err(|e| format!(
            "could not remove forge dir at {}: {}",
            forge.display(), e,
        ))?;
    Ok(true)
}

// ---------------------------------------------------------------------------
// Regression: phrase sidecar parsing across chapter_id type drift.
//
// The phrase sidecar's `chapter_id` field changed type when per-chapter
// phrase detection landed — the Python writer began emitting an integer
// chapter index (0, 1, …) where older sidecars wrote a string or null.
// The Rust reader's struct still demanded `Option<String>`, so serde
// rejected the ENTIRE file (`invalid type: integer`), silently emptying
// Patterns / Adv. Patterns. These tests pin the reader to every shape the
// writer can emit, using REAL sidecars pulled from `.forge/` dirs.
// See memory feedback_rust_mirror_drift.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod phrases_sidecar_tests {
    use super::DiskPhrasesSidecar;

    #[test]
    fn parses_integer_chapter_id() {
        // Real sidecar (project "8") with the integer-`chapter_id` format
        // that originally broke the reader.
        let raw = include_str!("../tests/fixtures/phrases_int_chapter_id.json");
        let parsed: DiskPhrasesSidecar =
            serde_json::from_str(raw).expect("integer chapter_id sidecar must parse");
        assert!(!parsed.slices.is_empty(), "expected slices");
        let cid = &parsed.slices[0].chapter_id;
        assert!(
            cid.is_i64() || cid.is_u64(),
            "chapter_id should be an integer, got {cid:?}"
        );
        // motion-shape rides in metrics — the field the Patterns rail groups by.
        assert!(
            parsed.slices[0].metrics.get("pattern_label").is_some(),
            "metrics.pattern_label must be present"
        );
    }

    #[test]
    fn parses_null_chapter_id() {
        // Old-format sidecar (chapter_id: null) must still parse.
        let raw = include_str!("../tests/fixtures/phrases_null_chapter_id.json");
        let parsed: DiskPhrasesSidecar =
            serde_json::from_str(raw).expect("null chapter_id (old format) must still parse");
        assert!(!parsed.slices.is_empty());
        assert!(parsed.slices[0].chapter_id.is_null());
    }

    #[test]
    fn parses_string_chapter_id() {
        // A string chapter_id (the original declared type) must also parse,
        // so the reader is type-agnostic in both directions.
        let raw = r#"{"version":1,"slices":[{"id":"ph0","at_ms":0,"end_ms":1000,"label":"steady","chapter_id":"ch_1","metrics":{"pattern_label":"up -> down"}}]}"#;
        let parsed: DiskPhrasesSidecar =
            serde_json::from_str(raw).expect("string chapter_id must parse");
        assert_eq!(parsed.slices[0].chapter_id.as_str(), Some("ch_1"));
    }
}
