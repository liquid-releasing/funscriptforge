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
    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Could not read {}: {}", &path, e))?;
    let funscript: FunscriptFile = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid funscript JSON in {}: {}", &path, e))?;
    let action_count = funscript.actions.len();
    let duration_ms = funscript.actions.last().map(|a| a.at).unwrap_or(0);

    let (min_pos, max_pos, avg_speed) = compute_funscript_stats(&funscript.actions);
    let actions = downsample_actions(&funscript.actions, 1200);

    // ── Sidecar probe ────────────────────────────────────────────────
    let stem = strip_funscript_ext(&path);
    let mut sidecars_found = Vec::new();
    let mut ffmeta: Option<serde_json::Value> = None;
    for suffix in ["ffmeta.json", "chapters.json"] {
        let p = format!("{}.{}", stem, suffix);
        if tokio::fs::metadata(&p).await.is_ok() {
            sidecars_found.push(p.clone());
            // ffmeta.json: parse it through. Other sidecars (chapters.json)
            // are consumed by their dedicated paths; we just record presence.
            if suffix == "ffmeta.json" {
                if let Ok(raw) = tokio::fs::read_to_string(&p).await {
                    match serde_json::from_str::<serde_json::Value>(&raw) {
                        Ok(v)  => ffmeta = Some(v),
                        Err(e) => eprintln!("ffmeta.json parse error at {}: {}", p, e),
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

// Pick from min(N, max_count) evenly-spaced indices. Crude but cheap and gives
// the velocity chart enough texture across the whole timeline.
fn downsample_actions(actions: &[FunscriptAction], max_count: usize) -> Vec<FunscriptAction> {
    if actions.len() <= max_count {
        return actions.to_vec();
    }
    let n = actions.len();
    let step = n as f64 / max_count as f64;
    (0..max_count)
        .map(|i| actions[((i as f64) * step) as usize].clone())
        .collect()
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
    let sidecar_path = format!("{}.chapters.json", stem);
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
    let stdout = run_cli_with_progress(
        &app,
        "ff:progress",
        &[
            "assess",
            &funscript_path,
            "--format",
            "json",
            "--no-save",
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
