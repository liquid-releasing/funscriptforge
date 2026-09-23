// library.rs — Tauri commands for the Library tab's filesystem adapter.
//
// We satisfy the FsAdapter interface defined in forgemoment's
// src/library/types.js (used by scanRoot + config helpers). JS-side
// scan code runs unchanged; this module wraps Rust's `tokio::fs::*`
// and platform-native shell ops so the same scan algorithm runs in
// FunscriptForge as runs in the in-memory unit tests.
//
// One Tauri command per FsAdapter method. Per-call IPC overhead is
// ~1ms; for a v1 library with tens-to-hundreds of files this is
// fine. If folders grow into the thousands, swap to a single Rust-
// native `library_scan_root` that returns the full ScanResult in
// one call (see forgemoment/docs/library-implementation-plan.md
// "scan execution path" — Option α).

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
    #[serde(rename = "isFile")]
    is_file: bool,
}

#[derive(Serialize)]
pub struct FileStat {
    size: u64,
    #[serde(rename = "mtimeMs")]
    mtime_ms: u64,
}

// ── FsAdapter primitives ───────────────────────────────────────────────

#[tauri::command]
pub async fn library_fs_readdir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut rd = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("readdir {}: {}", path, e))?;
    let mut entries = Vec::new();
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| format!("readdir next {}: {}", path, e))?
    {
        let file_type = entry
            .file_type()
            .await
            .map_err(|e| format!("file_type: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(DirEntry {
            name,
            is_directory: file_type.is_dir(),
            is_file: file_type.is_file(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn library_fs_stat(path: String) -> Result<FileStat, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("stat {}: {}", path, e))?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime_ms,
    })
}

#[tauri::command]
pub async fn library_fs_exists(path: String) -> bool {
    // `try_exists` returns Err on permission issues; treat those as
    // "does not exist" for scan purposes — a card that requires
    // elevated privs is effectively invisible.
    tokio::fs::try_exists(&path).await.unwrap_or(false)
}

#[tauri::command]
pub async fn library_fs_read_json(path: String) -> Result<serde_json::Value, String> {
    let text = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read_text {}: {}", path, e))?;
    serde_json::from_str(&text).map_err(|e| format!("parse_json {}: {}", path, e))
}

#[tauri::command]
pub async fn library_fs_read_text(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read_text {}: {}", path, e))
}

#[tauri::command]
pub async fn library_fs_write_text(path: String, text: String) -> Result<(), String> {
    // Ensure parent dir exists — the consuming JS code expects to be
    // able to write the config file on first use without explicitly
    // creating the AppConfig directory beforehand.
    if let Some(parent) = std::path::Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir_p {}: {}", parent.display(), e))?;
    }
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| format!("write_text {}: {}", path, e))
}

// ── Config path resolution ─────────────────────────────────────────────

/// Returns the absolute path of the library config file —
///   Windows: %APPDATA%\LQR\library.json
///   macOS:   ~/Library/Application Support/LQR/library.json
///   Linux:   ~/.config/LQR/library.json
///
/// Uses the bundle's app-config dir. The "LQR" directory name comes from
/// the tauri.conf.json `identifier` — we don't hardcode here.
#[tauri::command]
pub fn library_config_path(app: AppHandle) -> Result<String, String> {
    let dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("app_config_dir: {}", e))?;
    let p = dir.join("library.json");
    Ok(p.to_string_lossy().to_string())
}

// ── Native operations ──────────────────────────────────────────────────

/// The exact text Explorer needs appended to its command line.
///
/// Pure, and deliberately NOT `#[cfg(windows)]`, because the whole bug lived in
/// this string and a rule worth testing should be tested on every platform that
/// builds the app -- not only on the one where it happens to run.
///
///   file:       /select,"C:\dir\file.funscript"
///   directory:  "C:\dir"
///
/// Callers pass it to `raw_arg`, which appends it verbatim. Quoting the path
/// but NOT the `/select,` switch is the rule std's normal quoting cannot
/// express, and getting it wrong makes Explorer open the user's Documents
/// folder without any error at all.
fn explorer_raw_arg(path: &str, is_dir: bool) -> String {
    let native = path.replace('/', "\\");
    if is_dir {
        format!("\"{}\"", native)
    } else {
        format!("/select,\"{}\"", native)
    }
}

/// Reveal a path in the platform's native file explorer: a FILE is selected
/// inside its parent, a DIRECTORY is opened. The single implementation for the
/// whole app -- `commands::reveal_path` delegates here rather than keeping a
/// second copy (they had drifted, and both copies were broken).
///
/// Best effort: Explorer returns a non-zero exit even on success, so nothing
/// waits on the child or checks its status.
#[tauri::command]
pub fn library_reveal_in_explorer(path: String) -> Result<(), String> {
    let is_dir = std::path::Path::new(&path).is_dir();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        // Explorer does NOT parse its command line the way argv-based programs
        // do, and getting it wrong fails SILENTLY -- it opens the user's
        // Documents folder instead of erroring, so it reads as "the button goes
        // to the wrong place" rather than as a bug (dogfood 2026-09-23).
        //
        // Two rules:
        //   1. `/select,` and the path are ONE argument, and only the PATH may
        //      be quoted: `/select,"C:\dir\file"`. Passing them as two args
        //      loses the path entirely; letting Rust quote the whole argument
        //      -- which std does automatically as soon as it contains a space
        //      -- produces `"/select,C:\dir\file"`, which Explorer cannot
        //      read. That second case is why this worked for every test path
        //      without a space in it and failed on a real project
        //      ("D:\hovixag935\hovixag935 - bikinis vs Baylee.funscript").
        //   2. Separators must be BACKSLASHES. A forward slash sends Explorer
        //      to the default folder just as quietly.
        //
        // `raw_arg` appends the string to the command line verbatim, bypassing
        // std's quoting, which is the only way to express rule 1. Embedding the
        // path in a raw command line is safe here because a Windows path cannot
        // contain a double quote.
        let mut cmd = std::process::Command::new("explorer");
        cmd.raw_arg(explorer_raw_arg(&path, is_dir));
        cmd.spawn().map_err(|e| format!("explorer: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        // `open` takes a normal argv, so std's quoting is correct here.
        let mut cmd = std::process::Command::new("open");
        if is_dir { cmd.arg(&path); } else { cmd.args(["-R", &path]); }
        cmd.spawn().map_err(|e| format!("open: {}", e))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        // No portable "select" semantic, so a file reveals its parent.
        let target = if is_dir {
            std::path::PathBuf::from(&path)
        } else {
            std::path::Path::new(&path)
                .parent()
                .ok_or_else(|| "no parent dir".to_string())?
                .to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("xdg-open: {}", e))?;
        Ok(())
    }
}

/// Open the system folder picker and return the user's choice (None if
/// they cancelled). Uses tauri-plugin-dialog under the hood; we already
/// have the plugin registered for other dialogs.
#[tauri::command]
pub async fn library_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |maybe_path| {
        // FilePath is an enum (Path | Url in v2); take the path variant.
        let s = maybe_path.and_then(|fp| fp.as_path().map(|p| p.to_string_lossy().to_string()));
        let _ = tx.send(s);
    });
    rx.await.map_err(|_| "folder picker cancelled internally".to_string())
}
#[cfg(test)]
mod tests {
    use super::explorer_raw_arg;

    // The reveal button in the Library card and on the `.forge` folder row both
    // opened C:\Users\<user>\Documents instead of the project, for every
    // project whose path contains a space -- which is most of them. Reported
    // during release dogfood, 2026-09-23, on
    // "D:\hovixag935\hovixag935 - bikinis vs Baylee.funscript".
    //
    // It failed silently: Explorer does not error on a command line it cannot
    // parse, it just opens the default folder. And it worked for every path
    // WITHOUT a space, which is why it shipped.

    const SPACED: &str = r"D:\hovixag935\hovixag935 - bikinis vs Baylee.funscript";

    #[test]
    fn a_file_is_selected_with_only_the_path_quoted() {
        // THE regression. std quotes an argument as soon as it contains a
        // space, which produced `"/select,D:\...\a b.funscript"` -- the switch
        // swallowed inside the quotes, which Explorer cannot read.
        assert_eq!(
            explorer_raw_arg(SPACED, false),
            r#"/select,"D:\hovixag935\hovixag935 - bikinis vs Baylee.funscript""#,
        );
    }

    #[test]
    fn the_switch_is_never_inside_the_quotes() {
        let arg = explorer_raw_arg(SPACED, false);
        assert!(arg.starts_with("/select,\""), "switch must precede the quote: {arg}");
        assert!(arg.ends_with('"'), "path must be closed: {arg}");
    }

    #[test]
    fn a_directory_is_opened_rather_than_selected() {
        // `/select` on a directory opens its PARENT with the folder
        // highlighted, which is not what "open the forge folder" means.
        assert_eq!(
            explorer_raw_arg(r"D:\hovixag935\.scene.forge", true),
            r#""D:\hovixag935\.scene.forge""#,
        );
    }

    #[test]
    fn forward_slashes_become_backslashes() {
        // Paths reach Rust from JS, which is happy with either. Explorer is
        // not: a forward slash sends it to the default folder just as quietly
        // as bad quoting does.
        assert_eq!(
            explorer_raw_arg("D:/hovixag935/scene.funscript", false),
            r#"/select,"D:\hovixag935\scene.funscript""#,
        );
    }

    #[test]
    fn a_path_without_spaces_still_works() {
        // The case that always worked and hid the bug -- it must keep working.
        assert_eq!(
            explorer_raw_arg(r"D:\media\scene.funscript", false),
            r#"/select,"D:\media\scene.funscript""#,
        );
    }
}
