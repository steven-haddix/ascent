mod ai;
mod db;
mod secrets;
mod transport;

use tauri::{LogicalSize, Manager};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Open (or create) the local SQLite DB in the app data dir. sqlite-vec
            // is registered on this connection for the future SemanticIndex.
            let dir = app.path().app_data_dir().expect("resolve app data dir");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("ascent.sqlite");
            let conn = db::open(db_path.to_str().expect("db path is utf-8")).expect("open ascent.sqlite");
            app.manage(db::Db(std::sync::Mutex::new(conn)));

            // Size the main window to a share of the current monitor so the
            // three-pane layout has room to breathe, then center it. Clamped so
            // it stays sensible on both tiny laptops and huge external displays.
            // Falls back to the static size in tauri.conf.json if no monitor.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let screen = monitor.size().to_logical::<f64>(monitor.scale_factor());
                    let width = (screen.width * 0.85).clamp(1100.0, 1800.0);
                    let height = (screen.height * 0.85).clamp(720.0, 1150.0);
                    let _ = window.set_size(LogicalSize::new(width, height));
                    let _ = window.center();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            secrets::set_secret,
            secrets::has_secret,
            secrets::delete_secret,
            db::db_execute,
            ai::ai_request,
            ai::ai_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
