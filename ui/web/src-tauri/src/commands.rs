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
    // Return the full action set. Earlier shape downsampled to 1200 points
    // for chart-quality preview, but the close-up Funscript view in
    // MediaViewer zooms to a ~12s window and needs real per-stroke density
    // to show beats (a 10-minute high-BPM script downsampled to 1200 leaves
    // 2 actions/sec — strokes vanish into smooth curves). Overview charts
    // that want a sparse preview can downsample client-side. Memory cost:
    // typical 30-minute funscript = ~30k actions ≈ 660KB JSON, fine.
    let actions = funscript.actions.clone();

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

fn peaks_sidecar_path(media_path: &str) -> String {
    Path::new(media_path)
        .with_extension("audio.json")
        .to_string_lossy()
        .into_owned()
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
    Path::new(media_path)
        .with_extension("spectrogram.json")
        .to_string_lossy()
        .into_owned()
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
    Path::new(media_path)
        .with_extension("beats.json")
        .to_string_lossy()
        .into_owned()
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
// Cache: temp files live in the OS temp dir under funscriptforge_clips/,
// content-addressed by (media_path stem + start + end). Re-entering a
// chapter that's already been extracted is instant. Stale clips age
// out via the OS temp cleanup; we don't reap explicitly.
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
    const CACHE_VERSION: &str = "v11";

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

    let mut temp_dir = std::env::temp_dir();
    temp_dir.push("funscriptforge_clips");
    if !temp_dir.exists() {
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("create temp dir: {}", e))?;
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

    // ffmpeg invocation. Video stream-copies (-c:v copy) — fast,
    // key-frame-snapped. Audio re-encodes to 48 kHz AAC (-c:a aac
    // -ar 48000) to fix the WebView2/Chromium stutter on 44.1 kHz
    // sources: Chromium's audio output runs at 48 kHz internally, and
    // its per-chunk resampler 44.1→48 causes timing drift that the
    // decoder compensates for by silently dropping video frames. Re-
    // sampling once during extract is cheap (audio is tiny relative
    // to video) and produces a clip the video element can play clean.
    //
    // -avoid_negative_ts make_zero: clip timestamps start at 0
    //   regardless of where the keyframe sat
    // -movflags +faststart: moov atom at the front for fast video-
    //   element startup
    // -y: overwrite
    let ffmpeg_bin = find_bundled_ffmpeg();
    let start_sec = start_ms as f64 / 1000.0;
    let to_sec = end_ms as f64 / 1000.0;
    let output = Command::new(&ffmpeg_bin)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{:.3}", start_sec),
            "-to",
            &format!("{:.3}", to_sec),
            "-i",
            &media_path,
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-level",
            "3.1",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            // Audio: re-encode to 48 kHz AAC stereo. Chromium's audio
            // output runs at 48 kHz internally; matching the source rate
            // avoids the per-chunk resampler that was masking the
            // original stutter cause.
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "48000",
            "-ac",
            "2",
            // Force output timestamps to start at zero. With `-ss`
            // before `-i` ffmpeg fast-seeks to the nearest keyframe,
            // which can leave the audio stream's first PTS negative.
            // Chromium rejects negative-TS packets with
            // PIPELINE_ERROR_DECODE. `make_zero` shifts every stream
            // so the smallest TS becomes 0 — both audio and video
            // stay aligned, packets stay positive.
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            // Explicit output container. Defense against any future
            // tmp-name shenanigans confusing ffmpeg's extension-based
            // format guesser; the final extension is mp4 anyway.
            "-f",
            "mp4",
            "-y",
            &tmp_str,
        ])
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
