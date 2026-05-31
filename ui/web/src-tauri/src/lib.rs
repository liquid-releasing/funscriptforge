mod commands;
mod library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::list_recents,
            commands::list_tone_templates,
            commands::list_devices,
            commands::load_project,
            commands::create_chapters_sidecar,
            commands::analyze_chapters_with_videoflow,
            commands::write_chapters_sidecar,
            commands::analyze_phrases,
            commands::load_phrases_sidecar,
            commands::read_stanzas_from_chapters_sidecar,
            commands::read_stanzas,
            commands::list_characters,
            commands::list_transforms,
            commands::transform_preview,
            commands::transform_apply,
            commands::transform_apply_actions,
            commands::attach_media,
            commands::analyze_audio_peaks,
            commands::load_audio_peaks,
            commands::load_audio_spectrogram,
            commands::load_audio_beats,
            commands::prewarm_media_range,
            commands::extract_chapter_clip,
            commands::wipe_forge_dir,
            // Library — FsAdapter primitives + config path + native ops
            library::library_fs_readdir,
            library::library_fs_stat,
            library::library_fs_exists,
            library::library_fs_read_json,
            library::library_fs_read_text,
            library::library_fs_write_text,
            library::library_config_path,
            library::library_reveal_in_explorer,
            library::library_pick_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
