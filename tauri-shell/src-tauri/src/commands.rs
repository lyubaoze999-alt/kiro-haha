use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::thread;
use tauri::{AppHandle, Emitter, State};

/// Resolve kiro-cli path: PATH (which) → common locations → fallback name.
pub fn kiro_cli() -> String {
    if let Ok(o) = std::process::Command::new("which").arg("kiro-cli").output() {
        let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !p.is_empty() { return p; }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    for c in [
        format!("{}/.local/bin/kiro-cli", home),
        "/usr/local/bin/kiro-cli".into(),
        "/opt/homebrew/bin/kiro-cli".into(),
    ] {
        if std::path::Path::new(&c).exists() { return c; }
    }
    "kiro-cli".into()
}

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    terminals: Mutex<HashMap<String, Terminal>>,
}

#[derive(serde::Deserialize)]
pub struct SpawnOpts {
    pub id: String,
    pub cwd: String,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub resume_id: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Spawn a kiro-cli chat session inside a PTY
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    opts: SpawnOpts,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: opts.rows,
            cols: opts.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(kiro_cli());
    cmd.arg("chat");
    if let Some(m) = &opts.model {
        if !m.is_empty() {
            cmd.arg("--model");
            cmd.arg(m);
        }
    }
    if let Some(a) = &opts.agent {
        if !a.is_empty() {
            cmd.arg("--agent");
            cmd.arg(a);
        }
    }
    if let Some(r) = &opts.resume_id {
        if !r.is_empty() {
            cmd.arg("--resume-id");
            cmd.arg(r);
        }
    }
    cmd.cwd(&opts.cwd);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = opts.id.clone();
    let app_clone = app.clone();
    // Reader thread: stream output to frontend
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(&format!("pty:data:{}", id), data);
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(&format!("pty:exit:{}", id), ());
    });

    state.terminals.lock().insert(
        opts.id.clone(),
        Terminal {
            master: pair.master,
            writer,
            child,
        },
    );

    Ok(())
}

/// Spawn a plain login shell inside a PTY (terminal panel)
#[tauri::command]
pub fn term_spawn(app: AppHandle, state: State<'_, PtyState>, id: String, cwd: String, cols: u16, rows: u16) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let rid = id.clone();
    let app_clone = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => { let _ = app_clone.emit(&format!("pty:data:{}", rid), String::from_utf8_lossy(&buf[..n]).to_string()); }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(&format!("pty:exit:{}", rid), ());
    });
    state.terminals.lock().insert(id, Terminal { master: pair.master, writer, child });
    Ok(())
}

/// Write user input into a PTY
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut terms = state.terminals.lock();
    if let Some(t) = terms.get_mut(&id) {
        t.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        t.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize a PTY
#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let terms = state.terminals.lock();
    if let Some(t) = terms.get(&id) {
        let _ = t.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

/// Kill a PTY session
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut terms = state.terminals.lock();
    if let Some(mut t) = terms.remove(&id) {
        let _ = t.child.kill();
    }
    Ok(())
}

// ---------- Metadata commands ----------

#[tauri::command]
pub fn list_models() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({"id": "auto", "name": "Auto", "credits": "1.00x"}),
        serde_json::json!({"id": "claude-sonnet-4.6", "name": "Claude Sonnet 4.6", "credits": "1.30x"}),
        serde_json::json!({"id": "claude-opus-4.8", "name": "Claude Opus 4.8", "credits": "2.20x"}),
        serde_json::json!({"id": "claude-opus-4.6", "name": "Claude Opus 4.6", "credits": "2.20x"}),
        serde_json::json!({"id": "claude-haiku-4.5", "name": "Claude Haiku 4.5", "credits": "0.40x"}),
        serde_json::json!({"id": "deepseek-3.2", "name": "DeepSeek 3.2", "credits": "0.25x"}),
        serde_json::json!({"id": "minimax-m2.5", "name": "MiniMax M2.5", "credits": "0.25x"}),
        serde_json::json!({"id": "glm-5", "name": "GLM-5", "credits": "0.50x"}),
        serde_json::json!({"id": "qwen3-coder-next", "name": "Qwen3 Coder Next", "credits": "0.05x"}),
    ]
}

#[tauri::command]
pub fn list_agents() -> Vec<String> {
    vec![
        "kiro_default".to_string(),
        "kiro_planner".to_string(),
        "kiro_help".to_string(),
    ]
}

/// Run git diff in a directory, return changed files + diff text
#[tauri::command]
pub fn git_status(cwd: String) -> serde_json::Value {
    let run = |args: &[&str]| -> String {
        std::process::Command::new("git")
            .args(args)
            .current_dir(&cwd)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default()
    };
    let files = run(&["status", "--porcelain"]);
    let diff = run(&["diff", "--stat"]);
    serde_json::json!({ "files": files, "diff": diff })
}

/// Get git diff for a single file
#[tauri::command]
pub fn git_file_diff(cwd: String, file: String) -> String {
    std::process::Command::new("git")
        .args(["diff", "--", &file])
        .current_dir(&cwd)
        .output()
        .map(|o| {
            let mut s = String::from_utf8_lossy(&o.stdout).to_string();
            if s.trim().is_empty() {
                // maybe staged or untracked
                let staged = std::process::Command::new("git")
                    .args(["diff", "--cached", "--", &file])
                    .current_dir(&cwd)
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
                    .unwrap_or_default();
                s = staged;
            }
            s
        })
        .unwrap_or_default()
}

// ---------- Session history (global) ----------

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

const DB_REL: &str = "Library/Application Support/kiro-cli/data.sqlite3";
const MCP_REL: &str = ".kiro/settings/mcp.json";
const SKILLS_REL: &str = ".agent-shared/skills";

/// List all chat sessions across all directories, newest first.
/// Uses SQL json_extract so we never transfer/parse the full conversation blob.
#[tauri::command]
pub fn list_all_sessions() -> Vec<serde_json::Value> {
    let db = format!("{}/{}", home(), DB_REL);
    let out = std::process::Command::new("sqlite3")
        .args([
            "-json",
            &db,
            "SELECT key AS cwd, conversation_id AS id, \
             substr(json_extract(value,'$.history[0].user.content.Prompt.prompt'),1,80) AS title, \
             json_array_length(value,'$.history') AS msgCount, \
             updated_at AS updatedAt \
             FROM conversations_v2 ORDER BY updated_at DESC",
        ])
        .output();

    match out {
        Ok(o) => serde_json::from_slice(&o.stdout).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[tauri::command]
pub fn delete_session(cwd: String, id: String) -> Result<(), String> {
    std::process::Command::new(kiro_cli())
        .args(["chat", "--delete-session", &id])
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- MCP management ----------

fn read_mcp() -> serde_json::Value {
    let path = format!("{}/{}", home(), MCP_REL);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({"mcpServers": {}}))
}

#[tauri::command]
pub fn mcp_list() -> Vec<serde_json::Value> {
    let cfg = read_mcp();
    let servers = cfg["mcpServers"].as_object().cloned().unwrap_or_default();
    let mut list: Vec<serde_json::Value> = servers
        .into_iter()
        .map(|(name, v)| {
            let kind = if v.get("url").is_some() { "http" } else { "stdio" };
            let cmd = v["command"].as_str().unwrap_or("").to_string();
            let env_keys: Vec<String> = v["env"]
                .as_object()
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();
            serde_json::json!({
                "name": name,
                "type": kind,
                "command": cmd,
                "url": v["url"].as_str().unwrap_or(""),
                "disabled": v["disabled"].as_bool().unwrap_or(false),
                "envKeys": env_keys,
            })
        })
        .collect();
    list.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    list
}

#[tauri::command]
pub fn mcp_toggle(name: String, disabled: bool) -> Result<(), String> {
    let path = format!("{}/{}", home(), MCP_REL);
    let mut cfg = read_mcp();
    if let Some(server) = cfg["mcpServers"].get_mut(&name) {
        server["disabled"] = serde_json::Value::Bool(disabled);
    } else {
        return Err(format!("server {} not found", name));
    }
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mcp_remove(name: String) -> Result<(), String> {
    let path = format!("{}/{}", home(), MCP_REL);
    let mut cfg = read_mcp();
    if let Some(obj) = cfg["mcpServers"].as_object_mut() {
        obj.remove(&name);
    }
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Add or replace an MCP server. transport: "stdio" | "http".
#[tauri::command]
pub fn mcp_add(name: String, transport: String, command: String, args: String, url: String, env: String) -> Result<(), String> {
    if name.trim().is_empty() { return Err("name required".into()); }
    let path = format!("{}/{}", home(), MCP_REL);
    let mut cfg = read_mcp();
    let mut server = serde_json::Map::new();
    if transport == "http" {
        if url.trim().is_empty() { return Err("url required".into()); }
        server.insert("url".into(), serde_json::json!(url.trim()));
    } else {
        if command.trim().is_empty() { return Err("command required".into()); }
        server.insert("command".into(), serde_json::json!(command.trim()));
        let arg_vec: Vec<String> = args.split_whitespace().map(|s| s.to_string()).collect();
        if !arg_vec.is_empty() { server.insert("args".into(), serde_json::json!(arg_vec)); }
    }
    // env: "KEY=VAL" per line
    let mut env_map = serde_json::Map::new();
    for line in env.lines() {
        if let Some((k, v)) = line.split_once('=') {
            if !k.trim().is_empty() { env_map.insert(k.trim().into(), serde_json::json!(v.trim())); }
        }
    }
    if !env_map.is_empty() { server.insert("env".into(), serde_json::Value::Object(env_map)); }
    server.insert("disabled".into(), serde_json::json!(false));
    if cfg["mcpServers"].as_object().is_none() {
        cfg["mcpServers"] = serde_json::json!({});
    }
    cfg["mcpServers"].as_object_mut().unwrap().insert(name.trim().into(), serde_json::Value::Object(server));
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Skill management ----------

#[tauri::command]
pub fn list_skills() -> Vec<serde_json::Value> {
    let dir = format!("{}/{}", home(), SKILLS_REL);
    let mut skills = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let skill_md = entry.path().join("SKILL.md");
            if let Ok(content) = std::fs::read_to_string(&skill_md) {
                let (name, desc) = parse_frontmatter(&content);
                skills.push(serde_json::json!({
                    "name": if name.is_empty() { entry.file_name().to_string_lossy().to_string() } else { name },
                    "description": desc,
                    "path": skill_md.to_string_lossy().to_string(),
                }));
            }
        }
    }
    skills.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    skills
}

fn parse_frontmatter(content: &str) -> (String, String) {
    let mut name = String::new();
    let mut desc = String::new();
    let mut in_fm = false;
    for line in content.lines() {
        if line.trim() == "---" {
            if in_fm {
                break;
            }
            in_fm = true;
            continue;
        }
        if in_fm {
            if let Some(v) = line.strip_prefix("name:") {
                name = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("description:") {
                desc = v.trim().to_string();
            }
        }
    }
    (name, desc)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Search file contents in a project dir (uses ripgrep if available, else grep).
#[tauri::command]
pub fn search_files(cwd: String, query: String) -> Vec<serde_json::Value> {
    if query.trim().is_empty() { return Vec::new(); }
    let rg = which("rg");
    let output = if rg {
        std::process::Command::new("rg")
            .args(["--line-number", "--no-heading", "--max-count", "5", "--max-columns", "200", "-i", &query])
            .current_dir(&cwd).output()
    } else {
        std::process::Command::new("grep")
            .args(["-rniI", "--max-count=5", &query, "."])
            .current_dir(&cwd).output()
    };
    let out = match output { Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(), Err(_) => return Vec::new() };
    out.lines().take(60).filter_map(|l| {
        let l = l.trim_start_matches("./");
        let parts: Vec<&str> = l.splitn(3, ':').collect();
        if parts.len() == 3 {
            Some(serde_json::json!({"file": parts[0], "line": parts[1], "text": parts[2].trim()}))
        } else { None }
    }).collect()
}

fn which(bin: &str) -> bool {
    std::process::Command::new("which").arg(bin).output().map(|o| o.status.success()).unwrap_or(false)
}

// ---------- Chat (Codex-style) ----------

fn read_conversation_value(id: &str) -> Option<serde_json::Value> {
    let db = format!("{}/{}", home(), DB_REL);
    let out = std::process::Command::new("sqlite3")
        .args([
            "-json",
            &db,
            &format!(
                "SELECT value FROM conversations_v2 WHERE conversation_id='{}' LIMIT 1",
                id.replace('\'', "")
            ),
        ])
        .output()
        .ok()?;
    let rows: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).ok()?;
    let raw = rows.first()?["value"].as_str()?;
    serde_json::from_str(raw).ok()
}

/// Return a conversation as clean chat messages for bubble rendering.
#[tauri::command]
pub fn get_conversation(id: String) -> Vec<serde_json::Value> {
    let value = match read_conversation_value(&id) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let history = value["history"].as_array().cloned().unwrap_or_default();
    let mut msgs = Vec::new();

    for entry in history {
        let user = &entry["user"]["content"];
        // user prompt
        if let Some(p) = user["Prompt"]["prompt"].as_str() {
            msgs.push(serde_json::json!({"role":"user","kind":"text","text":p}));
        }
        // assistant
        let assistant = &entry["assistant"];
        if let Some(resp) = assistant["Response"]["content"].as_str() {
            if !resp.is_empty() {
                msgs.push(serde_json::json!({"role":"assistant","kind":"text","text":resp}));
            }
        }
        if let Some(tu) = assistant["ToolUse"].as_object() {
            // optional preamble text
            if let Some(c) = tu.get("content").and_then(|v| v.as_str()) {
                if !c.trim().is_empty() {
                    msgs.push(serde_json::json!({"role":"assistant","kind":"text","text":c}));
                }
            }
            if let Some(uses) = tu.get("tool_uses").and_then(|v| v.as_array()) {
                for u in uses {
                    msgs.push(serde_json::json!({
                        "role":"assistant",
                        "kind":"tool",
                        "toolName": u["name"].as_str().unwrap_or(""),
                        "toolArgs": u["args"].clone(),
                    }));
                }
            }
        }
    }
    msgs
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // skip until a letter (CSI) or bell (OSC)
            while let Some(&n) = chars.peek() {
                chars.next();
                if n.is_ascii_alphabetic() || n == '\u{7}' {
                    break;
                }
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out
}

fn latest_session_in(cwd: &str) -> Option<String> {
    let db = format!("{}/{}", home(), DB_REL);
    let out = std::process::Command::new("sqlite3")
        .args([
            &db,
            &format!(
                "SELECT conversation_id FROM conversations_v2 WHERE key='{}' ORDER BY updated_at DESC LIMIT 1",
                cwd.replace('\'', "")
            ),
        ])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[derive(serde::Deserialize)]
pub struct ChatOpts {
    pub stream_id: String,
    pub cwd: String,
    pub message: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
}

/// Send a message via kiro-cli --no-interactive, stream progress, resolve session id from DB.
#[tauri::command]
pub fn send_chat(app: AppHandle, opts: ChatOpts) {
    std::thread::spawn(move || {
        let mut args = vec![
            "chat".to_string(),
            "--no-interactive".to_string(),
            "--trust-all-tools".to_string(),
        ];
        if let Some(s) = &opts.session_id {
            if !s.is_empty() {
                args.push("--resume-id".to_string());
                args.push(s.clone());
            }
        }
        if let Some(m) = &opts.model {
            if !m.is_empty() && m != "auto" {
                args.push("--model".to_string());
                args.push(m.clone());
            }
        }
        if let Some(a) = &opts.agent {
            if !a.is_empty() {
                args.push("--agent".to_string());
                args.push(a.clone());
            }
        }
        args.push(opts.message.clone());

        use std::io::Read;
        let mut child = match std::process::Command::new(kiro_cli())
            .args(&args)
            .current_dir(&opts.cwd)
            .env("NO_COLOR", "1")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(&format!("chat:error:{}", opts.stream_id), e.to_string());
                return;
            }
        };

        if let Some(mut stdout) = child.stdout.take() {
            let app2 = app.clone();
            let sid = opts.stream_id.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 2048];
                loop {
                    match stdout.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let txt = strip_ansi(&String::from_utf8_lossy(&buf[..n]));
                            if !txt.trim().is_empty() {
                                let _ = app2.emit(&format!("chat:progress:{}", sid), txt);
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        let _ = child.wait();

        // Resolve session id (new sessions: latest in cwd)
        let resolved = opts
            .session_id
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| latest_session_in(&opts.cwd))
            .unwrap_or_default();

        let _ = app.emit(&format!("chat:done:{}", opts.stream_id), resolved);
    });
}
