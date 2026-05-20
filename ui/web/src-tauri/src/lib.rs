mod commands;

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
            commands::analyze_phrases,
            commands::read_stanzas,
            commands::list_characters,
            commands::attach_media,
            commands::analyze_audio_peaks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
