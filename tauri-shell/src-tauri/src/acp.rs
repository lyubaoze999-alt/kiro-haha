use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

use crate::commands::kiro_cli;

type Writer = Arc<Mutex<Box<dyn Write + Send>>>;

struct AcpSession {
    writer: Writer,
    child: Child,
    next_id: AtomicI64,
    acp_session_id: String,
    prompt_id: Arc<Mutex<i64>>,
}

#[derive(Default)]
pub struct AcpState {
    sessions: Mutex<HashMap<String, AcpSession>>,
}

#[derive(serde::Deserialize)]
pub struct AcpSpawnOpts {
    pub tab_id: String,
    pub cwd: String,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub resume_id: Option<String>,
}

fn write_msg(writer: &Writer, v: &serde_json::Value) {
    let mut w = writer.lock();
    let _ = w.write_all(v.to_string().as_bytes());
    let _ = w.write_all(b"\n");
    let _ = w.flush();
}

/// Blocking read of one JSON message that is a RESPONSE to the given id.
/// Ignores notifications during handshake.
fn read_response(reader: &mut BufReader<ChildStdout>, want_id: i64) -> Option<serde_json::Value> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if v.get("method").is_none() && v["id"].as_i64() == Some(want_id) {
                return Some(v);
            }
            // ignore notifications/requests during handshake
        }
    }
}

#[tauri::command]
pub async fn acp_spawn(app: AppHandle, state: State<'_, AcpState>, opts: AcpSpawnOpts) -> Result<String, String> {
    let mut child = Command::new(kiro_cli())
        .args(["acp", "--trust-all-tools"])
        .current_dir(&opts.cwd)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn kiro-cli acp: {}", e))?;

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let writer: Writer = Arc::new(Mutex::new(Box::new(stdin)));
    let mut reader = BufReader::new(stdout);

    // 1. initialize
    write_msg(&writer, &serde_json::json!({
        "jsonrpc":"2.0","id":0,"method":"initialize",
        "params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true}}}
    }));
    read_response(&mut reader, 0).ok_or("no initialize response")?;

    let prompt_id = Arc::new(Mutex::new(-1i64));
    let resume = opts.resume_id.clone().filter(|s| !s.is_empty());

    let acp_session_id;
    if let Some(rid) = resume {
        // Resume: start reader first so replayed history streams in, then session/load
        acp_session_id = rid.clone();
        spawn_reader(app, reader, writer.clone(), opts.tab_id.clone(), prompt_id.clone());
        let mut load_params = serde_json::json!({"sessionId": rid, "cwd": opts.cwd, "mcpServers": []});
        if let Some(m) = &opts.model { if !m.is_empty() && m != "auto" { load_params["model"] = serde_json::json!(m); } }
        write_msg(&writer, &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"session/load","params":load_params}));
    } else {
        // New session (sync read response for sessionId)
        let mut new_params = serde_json::json!({"cwd": opts.cwd, "mcpServers": []});
        if let Some(m) = &opts.model { if !m.is_empty() && m != "auto" { new_params["model"] = serde_json::json!(m); } }
        if let Some(a) = &opts.agent { if !a.is_empty() { new_params["agent"] = serde_json::json!(a); } }
        write_msg(&writer, &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":new_params}));
        let resp = read_response(&mut reader, 1).ok_or("no session/new response")?;
        acp_session_id = resp["result"]["sessionId"].as_str().unwrap_or("").to_string();
        if acp_session_id.is_empty() {
            return Err(format!("session/new failed: {}", resp));
        }
        spawn_reader(app, reader, writer.clone(), opts.tab_id.clone(), prompt_id.clone());
    }

    state.sessions.lock().insert(opts.tab_id.clone(), AcpSession {
        writer,
        child,
        next_id: AtomicI64::new(2),
        acp_session_id: acp_session_id.clone(),
        prompt_id,
    });

    Ok(acp_session_id)
}

fn spawn_reader(
    app: AppHandle,
    mut reader: BufReader<ChildStdout>,
    writer: Writer,
    tab_id: String,
    prompt_id: Arc<Mutex<i64>>,
) {
    thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => break,
            }
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            let v: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let method = v["method"].as_str();
            match method {
                Some("session/update") => {
                    let _ = app.emit(&format!("acp:update:{}", tab_id), v["params"]["update"].clone());
                }
                Some("session/request_permission") => {
                    // auto-approve: pick an "allow" option
                    let id = v["id"].clone();
                    let opt = v["params"]["options"].as_array()
                        .and_then(|opts| opts.iter().find(|o| {
                            o["kind"].as_str().map(|k| k.contains("allow")).unwrap_or(false)
                        }).or_else(|| v["params"]["options"].as_array().and_then(|a| a.first())))
                        .and_then(|o| o["optionId"].as_str())
                        .unwrap_or("allow").to_string();
                    write_msg(&writer, &serde_json::json!({
                        "jsonrpc":"2.0","id":id,
                        "result":{"outcome":{"outcome":"selected","optionId":opt}}
                    }));
                }
                Some("fs/read_text_file") => {
                    let id = v["id"].clone();
                    let path = v["params"]["path"].as_str().unwrap_or("");
                    let content = std::fs::read_to_string(path).unwrap_or_default();
                    write_msg(&writer, &serde_json::json!({"jsonrpc":"2.0","id":id,"result":{"content":content}}));
                }
                Some("fs/write_text_file") => {
                    let id = v["id"].clone();
                    let path = v["params"]["path"].as_str().unwrap_or("");
                    let content = v["params"]["content"].as_str().unwrap_or("");
                    let _ = std::fs::write(path, content);
                    write_msg(&writer, &serde_json::json!({"jsonrpc":"2.0","id":id,"result":{}}));
                }
                Some(m) if m.starts_with("_kiro.dev/") => {
                    // custom: forward commands/available etc. (optional)
                    let _ = app.emit(&format!("acp:meta:{}", tab_id), v.clone());
                }
                Some(_) => {
                    // unknown request: if it has id, reply with empty error to avoid hang
                    if v.get("id").is_some() {
                        write_msg(&writer, &serde_json::json!({
                            "jsonrpc":"2.0","id":v["id"].clone(),
                            "error":{"code":-32601,"message":"method not found"}
                        }));
                    }
                }
                None => {
                    // response to one of our requests
                    let cur = *prompt_id.lock();
                    if v["id"].as_i64() == Some(cur) {
                        let stop = v["result"]["stopReason"].as_str().unwrap_or("end_turn").to_string();
                        let _ = app.emit(&format!("acp:done:{}", tab_id), stop);
                    }
                }
            }
        }
        let _ = app.emit(&format!("acp:exit:{}", tab_id), ());
    });
}

#[tauri::command]
pub fn acp_prompt(state: State<'_, AcpState>, tab_id: String, text: String) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let s = sessions.get(&tab_id).ok_or("session not found")?;
    let id = s.next_id.fetch_add(1, Ordering::SeqCst);
    *s.prompt_id.lock() = id;
    write_msg(&s.writer, &serde_json::json!({
        "jsonrpc":"2.0","id":id,"method":"session/prompt",
        "params":{
            "sessionId": s.acp_session_id,
            "prompt":[{"type":"text","text":text}]
        }
    }));
    Ok(())
}

#[tauri::command]
pub fn acp_cancel(state: State<'_, AcpState>, tab_id: String) -> Result<(), String> {
    let sessions = state.sessions.lock();
    if let Some(s) = sessions.get(&tab_id) {
        write_msg(&s.writer, &serde_json::json!({
            "jsonrpc":"2.0","method":"session/cancel",
            "params":{"sessionId": s.acp_session_id}
        }));
    }
    Ok(())
}

#[tauri::command]
pub fn acp_kill(state: State<'_, AcpState>, tab_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(mut s) = sessions.remove(&tab_id) {
        let _ = s.child.kill();
    }
    Ok(())
}
