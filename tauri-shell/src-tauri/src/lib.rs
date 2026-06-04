use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

const SERVER_URL: &str = "http://127.0.0.1:3789";

#[tauri::command]
fn get_server_url() -> String {
    SERVER_URL.to_string()
}

#[tauri::command]
fn get_app_mode() -> String {
    "desktop".to_string()
}

#[tauri::command]
fn detect_portable_dir() -> Option<String> {
    None
}

#[tauri::command]
fn set_app_zoom(_zoom: f64) {}

#[tauri::command]
fn macos_notification_permission_state() -> String {
    "granted".to_string()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// Locate `node` in a cross-platform way: try common install paths first, fall
/// back to PATH lookup. On Windows `where`, on Unix `which`.
fn node_bin() -> String {
    #[cfg(target_os = "windows")]
    let candidates: &[&str] = &["node.exe", "node"];
    #[cfg(not(target_os = "windows"))]
    let candidates: &[&str] = &[
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/bin/node",
        "node",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return c.to_string();
        }
    }
    // Fall back to platform `which`/`where`
    #[cfg(target_os = "windows")]
    let probe = Command::new("where").arg("node").output();
    #[cfg(not(target_os = "windows"))]
    let probe = Command::new("which").arg("node").output();
    if let Ok(out) = probe {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().lines().next().unwrap_or("").to_string();
            if !s.is_empty() {
                return s;
            }
        }
    }
    "node".to_string()
}

/// Resolve the adapter directory. Priority:
/// 1. Bundled resource at `<resource_dir>/adapter` (shipped inside .app/.exe)
/// 2. `~/kiro-adapter` for legacy/dev installs
fn resolve_adapter_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("adapter");
        if bundled.join("server.js").exists() {
            return Some(bundled);
        }
    }
    if let Some(home) = home_dir() {
        let legacy = home.join("kiro-adapter");
        if legacy.join("server.js").exists() {
            return Some(legacy);
        }
    }
    None
}

fn start_adapter(app: &tauri::AppHandle) {
    let Some(dir) = resolve_adapter_dir(app) else {
        eprintln!("[kiro-haha] adapter dir not found in resources or ~/kiro-adapter");
        return;
    };
    // Pre-extend PATH for spawned process so child finds node + kiro-cli reliably.
    let extra_path = if cfg!(target_os = "windows") {
        String::new()
    } else if let Some(home) = home_dir() {
        format!(
            "/usr/local/bin:/opt/homebrew/bin:{}/.local/bin:",
            home.display()
        )
    } else {
        "/usr/local/bin:/opt/homebrew/bin:".to_string()
    };
    let path = format!(
        "{}{}",
        extra_path,
        std::env::var("PATH").unwrap_or_default()
    );
    let result = Command::new(node_bin())
        .arg("server.js")
        .current_dir(&dir)
        .env("PATH", &path)
        .spawn();
    if let Err(e) = result {
        eprintln!("[kiro-haha] failed to spawn adapter: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            start_adapter(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_url,
            get_app_mode,
            detect_portable_dir,
            set_app_zoom,
            macos_notification_permission_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
