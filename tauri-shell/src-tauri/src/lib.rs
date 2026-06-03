use std::process::Command;

const SERVER_URL: &str = "http://127.0.0.1:3789";

#[tauri::command]
fn get_server_url() -> String {
    SERVER_URL.to_string()
}

#[tauri::command]
fn get_app_mode() -> String { "desktop".to_string() }

#[tauri::command]
fn detect_portable_dir() -> Option<String> { None }

#[tauri::command]
fn set_app_zoom(_zoom: f64) {}

#[tauri::command]
fn macos_notification_permission_state() -> String { "granted".to_string() }

fn home() -> String { std::env::var("HOME").unwrap_or_default() }

fn node_bin() -> String {
    for c in ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"] {
        if std::path::Path::new(c).exists() { return c.to_string(); }
    }
    "node".to_string()
}

fn start_adapter() {
    let dir = format!("{}/kiro-adapter", home());
    if !std::path::Path::new(&dir).exists() { return; }
    let _ = Command::new(node_bin())
        .arg("server.js")
        .current_dir(&dir)
        .env("PATH", format!("/usr/local/bin:/opt/homebrew/bin:{}", std::env::var("PATH").unwrap_or_default()))
        .spawn();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_adapter();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_server_url, get_app_mode, detect_portable_dir, set_app_zoom, macos_notification_permission_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
