import { spawn } from "node:child_process";
import fs from "node:fs";

// Per-session live metadata pushed by kiro via _kiro.dev/metadata (context %, credits)
export const SESSION_META = new Map();

// Bridge one WS session to a kiro-cli acp child process.
export function startAcpBridge({ ws, sessionId, cwd, model, agent, resumeId, kiro }) {
  const acpArgs = ["acp", "--trust-all-tools"];
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
      // auto-allow
      const opts = v.params?.options || [];
      const allow = opts.find((o) => (o.kind || "").includes("allow")) || opts[0];
      send({ jsonrpc: "2.0", id: v.id, result: { outcome: { outcome: "selected", optionId: allow?.optionId || "allow" } } });
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

  function contentText(c) {
    if (!c) return "";
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((x) => x?.content?.text ?? x?.text ?? "").filter(Boolean).join("\n");
    return "";
  }

  // ---- handshake ----
  (async () => {
    await rpc("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
    if (resumeId) {
      acpSessionId = resumeId;
      const p = { sessionId: resumeId, cwd, mcpServers: [] };
      if (model && model !== "auto") p.model = model;
      replaying = true;
      // wait for the replay to finish (session/load resolves), capped to avoid hanging
      await Promise.race([rpc("session/load", p), new Promise((r) => setTimeout(r, 8000))]);
      replaying = false;
    } else {
      const p = { cwd, mcpServers: [] };
      if (model && model !== "auto") p.model = model;
      if (agent) p.agent = agent;
      const resp = await rpc("session/new", p);
      acpSessionId = resp.result?.sessionId;
    }
    wsSend({ type: "connected", sessionId });
    wsSend({ type: "status", state: "idle" });
  })();

  // ---- WS client messages ----
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "ping") { wsSend({ type: "pong" }); return; }
    if (m.type === "set_runtime_config") {
      if (m.modelId) curModel = m.modelId;
      return;
    }
    if (m.type === "user_message") {
      if (!acpSessionId) return;
      textOpen = false;
      promptId = nextId++;
      wsSend({ type: "status", state: "thinking", verb: "Thinking" });
      const params = { sessionId: acpSessionId, prompt: [{ type: "text", text: m.content }] };
      if (curModel && curModel !== "auto") params.model = curModel;
      send({ jsonrpc: "2.0", id: promptId, method: "session/prompt", params });
    } else if (m.type === "stop_generation") {
      if (acpSessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: acpSessionId } });
      wsSend({ type: "status", state: "idle" });
    }
  });

  ws.on("close", () => { try { child.kill(); } catch {} });
  child.on("exit", () => { try { ws.close(); } catch {} });
}
