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
use std::path::Path;
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
    chapters: u32,
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
    for suffix in ["ffmeta.json", "chapters.json"] {
        let p = format!("{}.{}", stem, suffix);
        if tokio::fs::metadata(&p).await.is_ok() {
            sidecars_found.push(p);
        }
    }

    // ── Adjacent media file probe ────────────────────────────────────
    // Look for a video/audio file with the same stem next to the funscript.
    // Video extensions take priority over audio (since most funscripts are
    // authored against video). Returns the first hit.
    let (media_path, media_kind) = find_adjacent_media(&stem);

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
        chapters: 0,
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

async fn run_cli_meta(funscript_path: &str) -> Result<CliMeta, String> {
    let root = std::env::var("FUNSCRIPTFORGE_ROOT")
        .unwrap_or_else(|_| DEV_FUNSCRIPTFORGE_ROOT.to_string());
    let python = std::env::var("FUNSCRIPTFORGE_PYTHON").unwrap_or_else(|_| {
        format!(r"{}\.venv\Scripts\python.exe", root)
    });
    let cli_py = format!(r"{}\cli.py", root);

    let output = Command::new(&python)
        .arg(&cli_py)
        .arg("meta")
        .arg(funscript_path)
        .arg("--format")
        .arg("json")
        .current_dir(&root)
        .output()
        .await
        .map_err(|e| format!("spawn python failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cli.py meta exited non-zero: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<CliMeta>(&stdout)
        .map_err(|e| format!("could not parse cli.py meta output: {}", e))
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
