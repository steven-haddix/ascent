//! Frontend → process-stderr log bridge. The webview calls `frontend_log` for
//! genuine errors so they surface in the `tauri dev` terminal — a place a developer
//! reliably sees without opening the web inspector (whose console is easy to filter
//! away or miss). Intentionally minimal: no log crate, no levels beyond a string.
#[tauri::command]
pub fn frontend_log(level: String, scope: String, message: String) {
    eprintln!("[ascent:{scope}] {level}: {message}");
}
