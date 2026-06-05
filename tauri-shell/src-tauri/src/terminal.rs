use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;
use tauri::{AppHandle, Emitter};

static SESSION_COUNTER: AtomicU32 = AtomicU32::new(1);
static BASH_PATH_OVERRIDE: Mutex<Option<String>> = Mutex::new(None);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct TerminalState {
    sessions: Mutex<HashMap<u32, TerminalSession>>,
}

impl TerminalState {
    fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

pub fn init() -> TerminalState {
    TerminalState::new()
}

fn pick_default_shell() -> String {
    if let Some(path) = BASH_PATH_OVERRIDE.lock().clone() {
        return path;
    }
    #[cfg(target_os = "windows")]
    {
        return "cmd.exe".to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(shell) = std::env::var("SHELL").ok() {
            let shell_path = std::path::Path::new(&shell);
            if shell_path.exists() {
                return shell;
            }
        }
        if std::path::Path::new("/bin/zsh").exists() {
            return "/bin/zsh".to_string();
        }
        return "/bin/bash".to_string();
    }
}

fn make_shell_login_arg(shell: &str) -> Option<String> {
    let base = std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if base == "zsh" || base == "bash" {
        Some("-l".to_string())
    } else {
        None
    }
}

fn get_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnArgs {
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSpawnResult {
    pub session_id: u32,
    pub shell: String,
    pub cwd: String,
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    args: TerminalSpawnArgs,
) -> Result<TerminalSpawnResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: args.rows,
        cols: args.cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| format!("openpty failed: {}", e))?;

    let shell = pick_default_shell();
    let login_arg = make_shell_login_arg(&shell);

    let mut cmd_builder = CommandBuilder::new(&shell);
    if let Some(arg) = login_arg {
        cmd_builder.arg(arg);
    }

    let cwd = args.cwd.filter(|d| std::path::Path::new(d).is_dir());
    let cwd = cwd.or_else(|| get_home_dir().map(|p| p.to_string_lossy().to_string()));

    let cwd = if let Some(ref dir) = cwd {
        cmd_builder.cwd(dir);
        dir.clone()
    } else {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "/".to_string())
    };

    cmd_builder.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd_builder)
        .map_err(|e| format!("spawn_command failed: {}", e))?;

    drop(pair.slave);

    let reader = pair.master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {}", e))?;

    let writer = pair.master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {}", e))?;

    let mut session_id = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    if session_id == 0 {
        session_id = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    }

    let master = pair.master;

    let session = TerminalSession {
        master,
        writer,
    };
    state.sessions.lock().insert(session_id, session);

    let app_clone = app.clone();
    let sid = session_id;
    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            let data = String::from_utf8_lossy(&buf[..n]).to_string();
            if app_clone.emit("terminal-output", serde_json::json!({
                "session_id": sid,
                "data": data
            })).is_err() {
                break;
            }
        }
    });

    let app_clone = app.clone();
    let sid = session_id;
    let mut child: Box<dyn portable_pty::Child + Send + Sync> = child;
    thread::spawn(move || {
        let _ = child.wait();
        let _ = app_clone.emit("terminal-exit", serde_json::json!({
            "session_id": sid,
            "code": 0,
            "signal": null
        }));
    });

    Ok(TerminalSpawnResult {
        session_id,
        shell,
        cwd,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteArgs {
    pub session_id: u32,
    pub data: String,
}

#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    args: TerminalWriteArgs,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    let session = sessions.get_mut(&args.session_id)
        .ok_or_else(|| "session not found".to_string())?;
    session.writer
        .write_all(args.data.as_bytes())
        .map_err(|e| format!("write failed: {}", e))?;
    session.writer
        .flush()
        .map_err(|e| format!("flush failed: {}", e))?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeArgs {
    pub session_id: u32,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    args: TerminalResizeArgs,
) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let session = sessions.get(&args.session_id)
        .ok_or_else(|| "session not found".to_string())?;
    session.master
        .resize(PtySize {
            rows: args.rows,
            cols: args.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {}", e))?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKillArgs {
    pub session_id: u32,
}

#[tauri::command]
pub fn terminal_kill(
    state: tauri::State<'_, TerminalState>,
    args: TerminalKillArgs,
) -> Result<(), String> {
    let session = state.sessions.lock().remove(&args.session_id);
    if session.is_none() {
        return Err("session not found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_terminal_bash_path() -> Option<String> {
    BASH_PATH_OVERRIDE.lock().clone()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTerminalBashPathArgs {
    pub path: Option<String>,
}

#[tauri::command]
pub fn set_terminal_bash_path(args: SetTerminalBashPathArgs) {
    *BASH_PATH_OVERRIDE.lock() = args.path;
}