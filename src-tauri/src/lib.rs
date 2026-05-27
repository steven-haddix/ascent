mod ai;
mod db;
mod secrets;
mod transport;

use tauri::Manager;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            secrets::set_secret,
            secrets::has_secret,
            secrets::delete_secret,
            db::db_execute,
            ai::ai_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
