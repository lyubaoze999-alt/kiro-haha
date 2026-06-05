import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-session live metadata pushed by kiro via _kiro.dev/metadata (context %, credits)
export const SESSION_META = new Map();

// Persisted per-ACP-session runtime selection (model). Survives WS reconnects so that
// when a user reopens a session via its real UUID, we restore their last model.
const RUNTIME_FILE = path.join(os.homedir(), ".kiro-haha-runtime.json");
function readRuntimeStore() { try { return JSON.parse(fs.readFileSync(RUNTIME_FILE, "utf8")); } catch { return {}; } }
function writeRuntimeStore(s) { try { fs.writeFileSync(RUNTIME_FILE, JSON.stringify(s, null, 2)); } catch {} }
function saveRuntimeFor(acpSid, sel) {
  if (!acpSid) return;
  const s = readRuntimeStore();
  s[acpSid] = { ...(s[acpSid] || {}), ...sel };
  writeRuntimeStore(s);
}
function loadRuntimeFor(acpSid) { return readRuntimeStore()[acpSid]; }

// Read prior conversation history from kiro-cli's .jsonl as plain text, so we can
// inject it into the first prompt of a fresh ACP session (workaround for the bug
// where session/load+session/prompt returns 0-credit empty replies).
function readPriorTranscript(resumeId) {
  if (!resumeId) return "";
  const file = path.join(os.homedir(), ".kiro/sessions/cli", resumeId.replace(/[^\w.\-]/g, "") + ".jsonl");
  let lines;
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { return ""; }
  const txt = (content) => (content || []).filter((c) => c.kind === "text").map((c) => c.data).join("").trim();
  const turns = [];
  for (const ln of lines) {
    if (!ln.trim()) continue;
    let e; try { e = JSON.parse(ln); } catch { continue; }
    const d = e.data || {};
    if (e.kind === "Prompt") { const t = txt(d.content); if (t) turns.push(`User: ${t}`); }
    else if (e.kind === "AssistantMessage") { const t = txt(d.content); if (t) turns.push(`Assistant: ${t}`); }
  }
  // Cap to last ~80 turns to avoid blowing the context on huge histories
  const recent = turns.slice(-80);
  return recent.join("\n\n");
}

// Bridge one WS session to a kiro-cli acp child process.
export function startAcpBridge({ ws, sessionId, cwd, model, agent, resumeId, permissionMode, kiro }) {
  const acpArgs = ["acp"];
  if (agent) acpArgs.push("--agent", agent);
  const spawnCwd = cwd && fs.existsSync(cwd) ? cwd : process.env.HOME;
  const child = spawn(kiro, acpArgs, { cwd: spawnCwd, env: { ...process.env, NO_COLOR: "1" } });
  child.on("error", (e) => { try { ws.send(JSON.stringify({ type: "error", message: `kiro-cli 启动失败: ${e.message || e}` })); } catch {} try { ws.close(); } catch {} });
  let buf = "";
  let nextId = 2;
  let acpSessionId = resumeId || null;
  let promptId = -1;
  const pending = {};
  let curToolId = null;
  let replaying = false; // true while session/load replays history as session/update
  let curModel = model;  // active model id, updatable mid-session via set_runtime_config
  let permMode = permissionMode || "default"; // default|acceptEdits|plan|bypassPermissions|dontAsk
  // Session-level allowlist of tool names: when user clicks "Allow for session" on a permission
  // dialog, we add the tool name here. Subsequent session/request_permission for the same tool
  // is auto-allowed without re-asking. Resets on WS reconnect (acceptable).
  const sessionAllowToolNames = new Set();
  const pendingPerms = {}; // requestId -> { acpId, allowOpt, rejectOpt }

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  const wsSend = (m) => { try { ws.send(JSON.stringify(m)); } catch {} };

  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve) => { pending[id] = resolve; send({ jsonrpc: "2.0", id, method, params }); });
  }

  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let v; try { v = JSON.parse(line); } catch { continue; }
      handle(v);
    }
  });

  function handle(v) {
    const method = v.method;
    if (method === "session/update") {
      mapUpdate(v.params?.update || {});
      return;
    }
    if (method === "session/request_permission") {
      const opts = v.params?.options || [];
      const allow = opts.find((o) => (o.kind || "").includes("allow")) || opts[0];
      const reject = opts.find((o) => (o.kind || "").includes("reject"));
      const tc = v.params?.toolCall || {};
      const toolName = tc.title || tc.kind || "tool";
      // Session-level allowlist (set by user clicking "Allow for session"): bypass ask.
      if (sessionAllowToolNames.has(toolName)) {
        send({ jsonrpc: "2.0", id: v.id, result: { outcome: { outcome: "selected", optionId: allow?.optionId || "allow" } } });
        return;
      }
      const decision = decidePermission(permMode, tc);
      console.log(`[acp ${sessionId.slice(0,8)}] perm: "${toolName}" mode=${permMode} → ${decision}`);
      if (decision === "allow") {
        send({ jsonrpc: "2.0", id: v.id, result: { outcome: { outcome: "selected", optionId: allow?.optionId || "allow" } } });
        return;
      }
      if (decision === "reject") {
        send({ jsonrpc: "2.0", id: v.id, result: reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } } });
        return;
      }
      // ask the user: forward to frontend, resolve on permission_response
      const reqId = String(v.id);
      pendingPerms[reqId] = { acpId: v.id, allowOpt: allow?.optionId, rejectOpt: reject?.optionId, toolName };
      wsSend({ type: "permission_request", requestId: reqId, toolName, toolUseId: tc.toolCallId, input: tc.rawInput || {}, description: tc.title });
      return;
    }
    if (method === "fs/read_text_file") {
      let content = ""; try { content = fs.readFileSync(v.params.path, "utf8"); } catch {}
      send({ jsonrpc: "2.0", id: v.id, result: { content } });
      return;
    }
    if (method === "fs/write_text_file") {
      try { fs.writeFileSync(v.params.path, v.params.content ?? ""); } catch {}
      send({ jsonrpc: "2.0", id: v.id, result: {} });
      return;
    }
    if (method === "_kiro.dev/metadata") {
      const p = v.params || {};
      const m = SESSION_META.get(sessionId) || { totalCredits: 0 };
      if (typeof p.contextUsagePercentage === "number") m.contextPct = p.contextUsagePercentage;
      if (Array.isArray(p.meteringUsage)) {
        const c = p.meteringUsage.reduce((s, x) => s + (x.unit === "credit" ? (x.value || 0) : 0), 0);
        m.turnCredits = c;
        m.totalCredits = (m.totalCredits || 0) + c;
      }
      SESSION_META.set(sessionId, m);
      return;
    }
    if (method && method.startsWith("_kiro.dev/")) return;
    if (method && v.id != null) { send({ jsonrpc: "2.0", id: v.id, error: { code: -32601, message: "nf" } }); return; }
    // response
    if (v.id != null) {
      if (pending[v.id]) { pending[v.id](v); delete pending[v.id]; }
      if (v.id === promptId) {
        const m = SESSION_META.get(sessionId) || {};
        console.log(`[acp ${sessionId.slice(0,8)}] message_complete (credits=${(m.turnCredits||0).toFixed(3)})`);
        wsSend({ type: "message_complete", usage: { input_tokens: 0, output_tokens: 0, credits: m.turnCredits || 0, totalCredits: m.totalCredits || 0 } });
        wsSend({ type: "status", state: "idle" });
        m.turnCredits = 0; SESSION_META.set(sessionId, m);
      }
    }
  }

  let textOpen = false;
  function mapUpdate(u) {
    if (replaying) return; // history replay handled via /api/sessions/:id/messages
    const t = u.sessionUpdate;
    if (t === "agent_message_chunk") {
      if (!textOpen) { wsSend({ type: "content_start", blockType: "text" }); textOpen = true; }
      wsSend({ type: "content_delta", text: u.content?.text || "" });
    } else if (t === "agent_thought_chunk") {
      wsSend({ type: "thinking", text: u.content?.text || "" });
    } else if (t === "tool_call") {
      textOpen = false;
      curToolId = u.toolCallId;
      wsSend({ type: "content_start", blockType: "tool_use", toolName: u.title || u.kind, toolUseId: u.toolCallId });
      wsSend({ type: "tool_use_complete", toolName: u.title || u.kind || "tool", toolUseId: u.toolCallId, input: u.rawInput || {} });
    } else if (t === "tool_call_update") {
      const done = u.status === "completed" || u.status === "failed";
      if (done) {
        const out = rawOutputText(u.rawOutput) || contentText(u.content);
        wsSend({ type: "tool_result", toolUseId: u.toolCallId, content: out, isError: u.status === "failed" });
      }
    }
  }

  function rawOutputText(o) {
    if (!o) return "";
    if (Array.isArray(o.items)) return o.items.map((x) => x?.Text ?? x?.text ?? (typeof x === "string" ? x : "")).filter(Boolean).join("\n");
    if (typeof o === "string") return o;
    return "";
  }

  function contentText(c) {    if (!c) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => x?.content?.text ?? x?.text ?? "").filter(Boolean).join("\n");
    return "";
  }

  // Decide permission for a tool call given the active mode + ACP tool info.
  // Kiro often omits `kind`, so we also scan the human-readable title.
  // Returns "allow" | "reject" | "ask".
  function decidePermission(mode, tc) {
    if (mode === "bypassPermissions" || mode === "dontAsk") return "allow";
    const s = `${tc.kind || ""} ${tc.title || ""}`.toLowerCase();
    const readonly = /\b(read|fetch|search|list|view|grep|glob|cat|ls)\b|reading|listing|searching|fetching/.test(s);
    const edit = /\b(edit|write|create|modify|move|append|replace|delete|mkdir)\b|editing|writing|creating|modifying/.test(s);
    if (mode === "plan") return readonly ? "allow" : "reject";
    if (mode === "acceptEdits") return (readonly || edit) ? "allow" : "ask";
    // default: auto-allow read-only, ask before anything that acts
    return readonly ? "allow" : "ask";
  }

  // ---- handshake ----
  (async () => {
    await rpc("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    if (resumeId) {
      acpSessionId = resumeId;
      const restored = loadRuntimeFor(resumeId);
      if (restored?.modelId) curModel = restored.modelId;
      const p = { sessionId: resumeId, cwd, mcpServers: [], model: curModel || "auto" };
      replaying = true;
      // wait for the replay to finish (session/load resolves), capped to avoid hanging
      const loadResp = await Promise.race([rpc("session/load", p), new Promise((r) => setTimeout(() => r({ timeout: true }), 12000))]);
      replaying = false;
      if (loadResp?.error) {
        const err = loadResp.error;
        console.log(`[acp ${sessionId.slice(0,8)}] session/load FAILED: ${err.message} | ${err.data || ""}`);
        wsSend({ type: "error", message: `加载会话失败: ${err.data || err.message}` });
        try { child.kill(); } catch {}
        return;
      }
    } else {
      const np = { cwd, mcpServers: [] };
      if (model && model !== "auto") np.model = model;
      if (agent) np.agent = agent;
      const resp = await rpc("session/new", np);
      acpSessionId = resp.result?.sessionId;
    }
    // Restore last-used model for this ACP session (if any) so reopening a tab
    // doesn't silently fall back to "auto".
    const stored = loadRuntimeFor(acpSessionId);
    if (stored?.modelId) curModel = stored.modelId;
    wsSend({ type: "connected", sessionId, runtimeSelection: stored || null, acpSessionId });
    wsSend({ type: "status", state: "idle" });
    console.log(`[acp ${sessionId.slice(0,8)}] ready (resume=${!!resumeId}, acpSid=${acpSessionId?.slice(0,8)}, model=${curModel || "auto"})`);
  })();

  // ---- WS client messages ----
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "ping") { wsSend({ type: "pong" }); return; }
    if (m.type === "set_permission_mode") {
      permMode = m.mode || "default";
      // Persist user's choice so it survives ws reconnects / app restarts.
      try {
        const SETTINGS_FILE = path.join(os.homedir(), ".kiro-haha-settings.json");
        let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch {}
        cfg.permissionMode = permMode;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cfg, null, 2));
      } catch (e) { console.warn(`[acp ${sessionId.slice(0,8)}] persist permissionMode failed: ${e}`); }
      return;
    }
    if (m.type === "permission_response") {
      const p = pendingPerms[m.requestId];
      if (p) {
        // "Allow for session" → remember this toolName for the rest of this WS connection.
        if (m.allowed && m.rule === "always" && p.toolName) {
          sessionAllowToolNames.add(p.toolName);
          console.log(`[acp ${sessionId.slice(0,8)}] session-allow added: "${p.toolName}" (allowlist size=${sessionAllowToolNames.size})`);
        }
        const optId = m.allowed ? p.allowOpt : p.rejectOpt;
        send({ jsonrpc: "2.0", id: p.acpId, result: (optId ? { outcome: { outcome: "selected", optionId: optId } } : { outcome: { outcome: "cancelled" } }) });
        delete pendingPerms[m.requestId];
      }
      return;
    }
    if (m.type === "set_runtime_config") {
      if (m.modelId) curModel = m.modelId;
      saveRuntimeFor(acpSessionId, { modelId: m.modelId, providerId: m.providerId });
      return;
    }
    if (m.type === "user_message") {
      if (!acpSessionId) { console.log(`[acp ${sessionId.slice(0,8)}] user_message DROPPED: no acpSessionId yet (replaying=${replaying})`); return; }
      console.log(`[acp ${sessionId.slice(0,8)}] user_message → prompt (model=${curModel || 'auto'}, mode=${permMode}, attachments=${(m.attachments || []).length})`);
      textOpen = false;
      promptId = nextId++;
      wsSend({ type: "status", state: "thinking", verb: "Thinking" });
      // Build ACP prompt content blocks: text first, then any image attachments. File
      // attachments without data are referenced as @path mentions in the text.
      const blocks = [];
      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      let textContent = m.content || "";
      const fileMentions = attachments
        .filter((a) => a && a.type === "file" && typeof a.path === "string")
        .map((a) => `@${a.path}`);
      if (fileMentions.length) textContent = `${textContent}${textContent ? "\n\n" : ""}${fileMentions.join(" ")}`;
      blocks.push({ type: "text", text: textContent });
      for (const att of attachments) {
        if (!att || att.type !== "image") continue;
        let raw = typeof att.data === "string" ? att.data : "";
        let mimeType = att.mimeType || "image/png";
        const m2 = /^data:([^;]+);base64,(.*)$/.exec(raw);
        if (m2) { mimeType = m2[1]; raw = m2[2]; }
        if (raw) blocks.push({ type: "image", data: raw, mimeType });
      }
      const params = { sessionId: acpSessionId, prompt: blocks, model: curModel || "auto" };
      send({ jsonrpc: "2.0", id: promptId, method: "session/prompt", params });
    } else if (m.type === "stop_generation") {
      if (acpSessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpSessionId } });
      wsSend({ type: "status", state: "idle" });
    }
  });

  ws.on("close", () => { try { child.kill(); } catch {} });
  child.on("exit", () => { try { ws.close(); } catch {} });
}
