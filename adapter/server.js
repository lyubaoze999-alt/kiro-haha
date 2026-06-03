import http from "node:http";
import { WebSocketServer } from "ws";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3789;
const HOME = os.homedir();
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
const DB = path.join(HOME, "Library/Application Support/kiro-cli/data.sqlite3");
const MCP_JSON = path.join(HOME, ".kiro/settings/mcp.json");
const SKILLS_DIR = path.join(HOME, ".agent-shared/skills");
const TITLES_FILE = path.join(HOME, ".kiro-haha-titles.json");
let TITLE_OVERRIDES = {};
try { TITLE_OVERRIDES = JSON.parse(fs.readFileSync(TITLES_FILE, "utf8")); } catch {}
function saveTitles() { try { fs.writeFileSync(TITLES_FILE, JSON.stringify(TITLE_OVERRIDES)); } catch {} }

function kiroBin() {
  try { return execSync("which kiro-cli").toString().trim() || "kiro-cli"; }
  catch { return path.join(HOME, ".local/bin/kiro-cli"); }
}
const KIRO = kiroBin();

function sqlite(sql) {
  try {
    const out = execSync(`sqlite3 -json ${JSON.stringify(DB)} ${JSON.stringify(sql)}`, { maxBuffer: 64 * 1024 * 1024 }).toString();
    return out.trim() ? JSON.parse(out) : [];
  } catch { return []; }
}

// ---------- sessions from kiro sqlite ----------
const CLI_SESSIONS_DIR = path.join(HOME, ".kiro/sessions/cli");
function readCliSessionFiles() {
  const out = [];
  try {
    for (const f of fs.readdirSync(CLI_SESSIONS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const fp = path.join(CLI_SESSIONS_DIR, f);
      let head = "";
      try { const fd = fs.openSync(fp, "r"); const buf = Buffer.alloc(2048); const n = fs.readSync(fd, buf, 0, 2048, 0); fs.closeSync(fd); head = buf.toString("utf8", 0, n); } catch { continue; }
      const g = (k) => { const m = head.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`)); return m ? m[1].replace(/\\"/g, '"') : null; };
      const id = g("session_id") || f.replace(/\.json$/, "");
      const cwd = g("cwd");
      const title = g("title");
      if (!title) continue; // skip untitled internal sessions
      const created = g("created_at"); const updated = g("updated_at");
      out.push({
        id,
        title: TITLE_OVERRIDES[id] || title,
        workDir: cwd,
        workDirExists: !!cwd && fs.existsSync(cwd),
        projectPath: cwd,
        messageCount: 0,
        createdAt: created ? new Date(created).toISOString() : new Date().toISOString(),
        modifiedAt: updated ? new Date(updated).toISOString() : new Date().toISOString(),
        status: "idle",
      });
    }
  } catch {}
  return out;
}
function listSessions() {
  const rows = sqlite(
    "SELECT key AS cwd, conversation_id AS id, " +
    "substr(json_extract(value,'$.history[0].user.content.Prompt.prompt'),1,80) AS title, " +
    "json_array_length(value,'$.history') AS msgCount, updated_at AS updatedAt, created_at AS createdAt " +
    "FROM conversations_v2 ORDER BY updated_at DESC"
  );
  const v2 = rows.map((r) => ({
    id: r.id,
    title: TITLE_OVERRIDES[r.id] || r.title || "Untitled Session",
    workDir: r.cwd,
    workDirExists: !!r.cwd && fs.existsSync(r.cwd),
    projectPath: r.cwd,
    messageCount: r.msgCount || 0,
    createdAt: new Date(r.createdAt || r.updatedAt).toISOString(),
    modifiedAt: new Date(r.updatedAt).toISOString(),
    status: "idle",
  }));
  const seen = new Set(v2.map((s) => s.id));
  const merged = [...v2];
  for (const s of readCliSessionFiles()) if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
  merged.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return merged;
}

function browseDir(p, includeFiles, search) {
  const dir = p && fs.existsSync(p) ? p : HOME;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .filter((e) => includeFiles || e.isDirectory())
      .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name), isDirectory: e.isDirectory() }))
      .sort((a, b) => (Number(b.isDirectory) - Number(a.isDirectory)) || a.name.localeCompare(b.name));
  } catch {}
  return { currentPath: dir, parentPath: path.dirname(dir), entries, query: search || undefined };
}

function kiroIdeProjects() {
  const vdb = path.join(HOME, "Library/Application Support/Kiro/User/globalStorage/state.vscdb");
  if (!fs.existsSync(vdb)) return [];
  try {
    const out = execSync(`sqlite3 ${JSON.stringify(vdb)} "SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList'"`, { maxBuffer: 16 * 1024 * 1024 }).toString();
    const data = JSON.parse(out);
    return (data.entries || []).filter((e) => e.folderUri).map((e) => decodeURIComponent(e.folderUri.replace(/^file:\/\//, "")));
  } catch { return []; }
}

function recentProjects(limit) {
  const map = new Map();
  const add = (p, modifiedAt, fromSession) => {
    if (!p || !fs.existsSync(p)) return;
    const cur = map.get(p) || { projectPath: p, realPath: p, projectName: path.basename(p) || p, isGit: fs.existsSync(path.join(p, ".git")), repoName: null, branch: null, modifiedAt, sessionCount: 0 };
    if (fromSession) cur.sessionCount++;
    if (modifiedAt > cur.modifiedAt) cur.modifiedAt = modifiedAt;
    map.set(p, cur);
  };
  for (const s of listSessions()) add(s.workDir, s.modifiedAt, true);
  for (const p of kiroIdeProjects()) { let m = new Date().toISOString(); try { m = fs.statSync(p).mtime.toISOString(); } catch {} add(p, m, false); }
  let arr = [...map.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return limit ? arr.slice(0, limit) : arr;
}

function messagesFromJsonl(id) {
  let lines;
  try { lines = fs.readFileSync(path.join(CLI_SESSIONS_DIR, id.replace(/[^\w.\-]/g, "") + ".jsonl"), "utf8").split("\n"); } catch { return []; }
  const out = []; let seq = 0; const base = Date.now() - lines.length * 1000;
  const ts = () => new Date(base + seq * 1000).toISOString();
  const push = (m) => { out.push({ id: `${id}-${seq}`, timestamp: ts(), ...m }); seq++; };
  const txt = (content) => (content || []).filter((c) => c.kind === "text").map((c) => c.data).join("");
  for (const ln of lines) {
    if (!ln.trim()) continue;
    let e; try { e = JSON.parse(ln); } catch { continue; }
    const d = e.data || {};
    if (e.kind === "Prompt") { const t = txt(d.content); if (t) push({ type: "user", content: t }); }
    else if (e.kind === "AssistantMessage") {
      const t = txt(d.content); if (t) push({ type: "assistant", content: t });
      const tools = (d.content || []).filter((c) => /tool/i.test(c.kind || "")).map((c) => ({ type: "tool_use", id: c.data?.toolUseId || c.data?.id, name: c.data?.name, input: c.data?.input || c.data?.args || {} }));
      if (tools.length) push({ type: "assistant", content: tools });
    } else if (e.kind === "ToolResults") {
      const blocks = (d.content || []).filter((c) => c.kind === "toolResult").map((c) => ({ type: "tool_result", tool_use_id: c.data?.toolUseId, content: (c.data?.content || []).map((x) => x.data ?? x.text ?? "").filter(Boolean).join("\n"), is_error: c.data?.status === "error" }));
      if (blocks.length) push({ type: "tool_result", content: blocks });
    }
  }
  return out;
}
function conversationMessages(id) {
  const rows = sqlite(`SELECT value, updated_at FROM conversations_v2 WHERE conversation_id='${id.replace(/'/g, "")}' LIMIT 1`);
  if (!rows[0]) return messagesFromJsonl(id);
  let v; try { v = JSON.parse(rows[0].value); } catch { return []; }
  const base = Number(rows[0].updated_at) || Date.now();
  const out = [];
  let seq = 0;
  const ts = () => new Date(base + seq * 1000).toISOString();
  const push = (m) => { out.push({ id: `${id}-${seq}`, timestamp: ts(), ...m }); seq++; };
  for (const e of v.history || []) {
    const u = e.user?.content;
    if (u?.Prompt?.prompt) push({ type: "user", content: u.Prompt.prompt });
    if (u?.ToolUseResults?.tool_use_results) {
      push({ type: "tool_result", content: u.ToolUseResults.tool_use_results.map((r) => ({
        type: "tool_result", tool_use_id: r.tool_use_id,
        content: (r.content || []).map((c) => c?.Text ?? c?.text ?? "").filter(Boolean).join("\n"),
        is_error: r.status === "Error",
      })) });
    }
    const a = e.assistant;
    if (a?.ToolUse) {
      const blocks = [];
      if (a.ToolUse.content) blocks.push({ type: "text", text: a.ToolUse.content });
      for (const t of a.ToolUse.tool_uses || [])
        blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.args });
      push({ type: "assistant", content: blocks });
    }
    if (a?.Response?.content) push({ type: "assistant", content: a.Response.content });
  }
  return out;
}

// ---------- HTTP ----------
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const seg = url.pathname.split("/").filter(Boolean); console.log("REQ",req.method,url.pathname);
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }); return res.end(); }
  if (url.pathname === "/health") return json(res, { status: "ok", ready: true });
  const r = seg[1];

  try {
    if (r === "sessions") {
      if (seg.length === 2 && req.method === "GET") return json(res, { sessions: listSessions() });
      if (seg[2] === "batch-delete" && req.method === "POST") {
        const body = await readBody(req);
        const successes = [], failures = [];
        for (const id of body.sessionIds || []) {
          try { execSync(`${JSON.stringify(KIRO)} chat -d ${JSON.stringify(id)}`, { stdio: "ignore" }); delete TITLE_OVERRIDES[id]; successes.push(id); }
          catch (e) { failures.push({ sessionId: id, message: String(e) }); }
        }
        saveTitles();
        return json(res, { ok: failures.length === 0, successes, failures });
      }
      if (seg.length === 2 && req.method === "POST") {
        const body = await readBody(req);
        const workDir = (typeof body.workDir === "string" && body.workDir) || body.repository?.workDir || HOME;
        const id = "new-" + Date.now();
        NEW_SESSIONS.set(id, { workDir, model: body.model, agent: body.agent });
        return json(res, { sessionId: id, workDir });
      }
      if (seg[2] && seg[3] === "messages") return json(res, { messages: conversationMessages(seg[2]) });
      if (seg[2] && seg[3] === "slash-commands") return json(res, { commands: SLASH });
      if (seg[2] && seg[3] === "git-info") return json(res, gitInfo(sessionInfoCwd(seg[2])));
      if (seg[2] && seg[3] === "workspace") return json(res, workspace(seg[4], sessionInfoCwd(seg[2]), url.searchParams.get("path") || ""));
      if (seg[2] && seg[3] === "inspection") {
        const ctx = contextSnapshot(seg[2]);
        const meta = SESSION_META.get(seg[2]) || {};
        return json(res, {
          config: { permissionMode: "auto", model: "auto", cwd: sessionInfoCwd(seg[2]) || HOME, tools: [], mcpServers: [], slashCommandCount: SLASH.length, skillCount: 0 },
          usage: { input_tokens: 0, output_tokens: 0, totalCostUSD: 0, costDisplay: `${(meta.totalCredits || 0).toFixed(2)} credits`, totalCredits: meta.totalCredits || 0, models: [] },
          context: ctx,
          contextEstimate: ctx,
          errors: {},
        });
      }
      if (seg[2] && seg[3] === "turn-checkpoints") return json(res, { checkpoints: [] });
      if (seg[2] === "repository-context") {
        const wd = url.searchParams.get("workDir") || HOME;
        const g = gitInfo(wd);
        return json(res, { state: fs.existsSync(wd) ? "ok" : "missing_workdir", workDir: wd, repoRoot: g.isRepo ? wd : null, repoName: g.repoName, currentBranch: g.branch, defaultBranch: g.branch, dirty: g.changedFiles > 0, branches: [], worktrees: [] });
      }
      if (seg[2] === "recent-projects") return json(res, { projects: recentProjects(Number(url.searchParams.get("limit")) || 0) });
      if (seg[2] && req.method === "DELETE") {
        try { execSync(`${JSON.stringify(KIRO)} chat -d ${JSON.stringify(seg[2])}`, { stdio: "ignore" }); } catch {}
        delete TITLE_OVERRIDES[seg[2]]; saveTitles();
        return json(res, { ok: true });
      }
      if (seg[2] && req.method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.title === "string") { TITLE_OVERRIDES[seg[2]] = body.title; saveTitles(); }
        return json(res, { ok: true });
      }
      return json(res, { sessions: listSessions() });
    }
    if (r === "models") {
      const models = loadModels();
      if (seg[2] === "current") return json(res, { model: models.find((m) => m.id === USER_SETTINGS.defaultModel) || models[0] });
      return json(res, { models, provider: { id: "kiro", name: "Kiro CLI" } });
    }
    if (r === "skills") return json(res, { skills: listSkills(url.searchParams.get("cwd")) });
    if (r === "mcp") {
      const cwd = url.searchParams.get("cwd");
      if (seg[2] === "project-paths") return json(res, { projectPaths: mcpProjectPaths() });
      if (seg[2] && seg[3] === "status") return json(res, { server: listMcp(cwd).find((s) => s.name === decodeURIComponent(seg[2])) || null });
      if (seg[2] && seg[3] === "toggle" && req.method === "POST") {
        const body = await readBody(req);
        mcpToggle(decodeURIComponent(seg[2]), body.enabled);
        return json(res, { server: listMcp(cwd).find((s) => s.name === decodeURIComponent(seg[2])) || null });
      }
      if (seg.length === 2 && req.method === "POST") {
        const body = await readBody(req); mcpAdd(body);
        return json(res, { server: listMcp(cwd).find((s) => s.name === body.name) || null });
      }
      if (seg[2] && req.method === "DELETE") { mcpRemove(decodeURIComponent(seg[2])); return json(res, { ok: true }); }
      return json(res, { servers: listMcp(cwd) });
    }
    if (r === "status") return json(res, { ok: true, ready: true });
    if (r === "providers") {
      if (seg[2] === "presets") return json(res, { presets: [] });
      if (seg[2] === "auth-status") return json(res, { authenticated: true, methods: [] });
      if (req.method === "POST") return json(res, { ok: true });
      return json(res, { providers: [{ id: "kiro", name: "Kiro CLI", type: "official", isActive: true, models: { main: "auto", haiku: "claude-haiku-4.5", sonnet: "claude-sonnet-4.6", opus: "claude-opus-4.8" } }], activeId: "kiro" });
    }
    if (r === "settings") {
      if (seg[2] === "cli-launcher") return json(res, { available: true, path: KIRO, status: "ok" });
      if (seg[2] === "user" && req.method === "PATCH") {
        const body = await readBody(req);
        Object.assign(USER_SETTINGS, body);
        try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(USER_SETTINGS, null, 2)); } catch {}
        return json(res, USER_SETTINGS);
      }
      if (seg[2] === "user") return json(res, USER_SETTINGS);
      return json(res, USER_SETTINGS);
    }
    if (r === "agents") return json(res, { activeAgents: AGENTS, allAgents: AGENTS });
    if (r === "tasks") return json(res, { tasks: [], lists: [] });
    if (r === "scheduled-tasks") {
      if (seg[2] === "runs") return json(res, { runs: [] });
      return json(res, { tasks: [] });
    }
    if (r === "diagnostics") return json(res, { ok: true, events: [] });
    if (r === "doctor") return json(res, { checks: [], ok: true });
    if (r === "specs") {
      const cwd = url.searchParams.get("cwd") || HOME;
      if (seg.length === 2 && req.method === "POST") {
        const body = await readBody(req);
        const name = (body.name || "untitled").trim().replace(/[^\w.\-一-龥]+/g, "-");
        fs.mkdirSync(path.join(specsRoot(body.cwd || cwd), name), { recursive: true });
        return json(res, { spec: { name } });
      }
      if (seg[2] && seg[3] === "generate" && req.method === "POST") {
        const body = await readBody(req);
        const content = await specGenerate(body.cwd || cwd, decodeURIComponent(seg[2]), body.phase, body.idea);
        return json(res, { content, ok: !!content });
      }
      if (seg[2] && seg[3] && req.method === "PUT") {
        const body = await readBody(req);
        specWrite(body.cwd || cwd, decodeURIComponent(seg[2]), seg[3], body.content);
        return json(res, { ok: true });
      }
      if (seg[2] && seg[3]) return json(res, { content: specRead(cwd, decodeURIComponent(seg[2]), seg[3]) });
      if (seg[2] && req.method === "DELETE") {
        try { fs.rmSync(path.join(specsRoot(cwd), decodeURIComponent(seg[2])), { recursive: true, force: true }); } catch {}
        return json(res, { ok: true });
      }
      return json(res, { specs: listSpecs(cwd) });
    }
    if (r === "hooks") {
      if (req.method === "PUT") { const body = await readBody(req); return json(res, { hooks: setHooks(body.hooks || {}), triggers: HOOK_TRIGGERS }); }
      return json(res, { hooks: getHooks(), triggers: HOOK_TRIGGERS });
    }
    if (r === "memory") {
      if (seg[2] === "projects") return json(res, { projects: memoryProjects(url.searchParams.get("cwd")) });
      if (seg[2] === "files") return json(res, { files: memoryFiles(url.searchParams.get("projectId")) });
      if (seg[2] === "file" && req.method === "PUT") {
        const body = await readBody(req);
        return json(res, { ok: true, file: memorySaveFile(body.projectId, body.path, body.content) });
      }
      if (seg[2] === "file") return json(res, { file: memoryReadFile(url.searchParams.get("path")) });
      return json(res, { projects: memoryProjects(url.searchParams.get("cwd")) });
    }
    if (r === "teams") return json(res, { teams: [] });
    if (r === "plugins") return json(res, { plugins: [] });
    if (r === "adapters") return json(res, { adapters: [] });
    if (r === "computer-use") return json(res, { enabled: false, applications: [] });
    if (r === "activity-stats") return json(res, { stats: [], daily: [] });
    if (r === "open-targets") {
      if (seg[2] === "open" && req.method === "POST") {
        const body = await readBody(req);
        try { execSync(`open ${JSON.stringify(body.path)}`); } catch (e) { return json(res, { error: String(e) }, 500); }
        return json(res, { ok: true, targetId: body.targetId, path: body.path });
      }
      return json(res, { platform: "darwin", primaryTargetId: "finder", cachedAt: Date.now(), ttlMs: 60000,
        targets: [{ id: "finder", kind: "file_manager", label: "访达", icon: "finder", platform: "darwin" }] });
    }
    if (r === "desktop-ui") return json(res, { preferences: {} });
    if (r === "h5-access") return json(res, { enabled: false });
    if (r === "effort") return json(res, { effort: "default", options: ["low", "default", "high"] });
    if (r === "search") return json(res, { results: [] });
    if (r === "filesystem") {
      const dir = url.searchParams.get("path");
      const includeFiles = url.searchParams.get("includeFiles") === "true";
      const search = url.searchParams.get("search") || "";
      return json(res, browseDir(dir, includeFiles, search));
    }
    // generic empty ok for the rest
    return json(res, { ok: true });
  } catch (e) {
    return json(res, { error: String(e) }, 500);
  }
});

const STATIC_MODELS = [
  { id: "auto", name: "Auto", description: "自动选择 · 1.00x", context: "1M" },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "1.30x credits", context: "1M" },
];
function fmtCtx(n) { return !n ? "" : n >= 1000000 ? `${Math.round(n / 1000000)}M` : `${Math.round(n / 1000)}K`; }
let MODELS_CACHE = null;
function loadModels() {
  if (MODELS_CACHE) return MODELS_CACHE;
  try {
    const out = execSync(`${JSON.stringify(KIRO)} chat --list-models -f json`, { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4 * 1024 * 1024 }).toString();
    const data = JSON.parse(out);
    const models = (data.models || []).map((m) => ({
      id: m.model_id,
      name: m.model_name === "auto" ? "Auto" : m.model_name,
      description: `${(m.rate_multiplier ?? 1).toFixed(2)}x credits`,
      context: fmtCtx(m.context_window_tokens),
    }));
    if (models.length) { MODELS_CACHE = models; return models; }
  } catch {}
  return STATIC_MODELS;
}
const AGENTS = [
  { agentType: "kiro_default", description: "默认 agent", model: "auto", modelDisplay: "Auto", source: "builtin", color: "#AD5F45", tools: [] },
  { agentType: "kiro_planner", description: "规划 agent，拆解需求为实现计划", model: "auto", modelDisplay: "Auto", source: "builtin", color: "#2D628F", tools: [] },
  { agentType: "kiro_help", description: "帮助 agent，回答 Kiro CLI 功能问题", model: "auto", modelDisplay: "Auto", source: "builtin", color: "#4F6237", tools: [] },
];
const SLASH = [
  { name: "/clear", description: "清空对话" }, { name: "/compact", description: "压缩对话" },
  { name: "/model", description: "切换模型" }, { name: "/agent", description: "切换 agent" },
  { name: "/context", description: "上下文管理" }, { name: "/usage", description: "用量" },
  { name: "/tools", description: "工具" }, { name: "/help", description: "帮助" },
];
const NEW_SESSIONS = new Map();
const EMPTY_CONTEXT = {
  categories: [], totalTokens: 0, maxTokens: 200000, rawMaxTokens: 200000, percentage: 0,
  gridRows: [], model: "auto", memoryFiles: [], mcpTools: [], agents: [],
};
function contextSnapshot(id) {
  const pct = SESSION_META.get(id)?.contextPct;
  if (typeof pct !== "number") return EMPTY_CONTEXT;
  const rawMaxTokens = 1000000;
  const totalTokens = Math.round((pct / 100) * rawMaxTokens);
  return {
    categories: [{ name: "Conversation", tokens: totalTokens, color: "#4F6237" }],
    totalTokens, maxTokens: rawMaxTokens, rawMaxTokens, percentage: pct,
    gridRows: [], model: "auto", memoryFiles: [], mcpTools: [], agents: [],
  };
}
const USER_SETTINGS = {
  theme: "light", language: "zh-CN", permissionMode: "auto",
  defaultModel: "auto", defaultAgent: "kiro_default",
  fontSize: 14, sendShortcut: "enter", autoAccept: true,
};
const SETTINGS_FILE = path.join(HOME, ".kiro-haha-settings.json");
try { Object.assign(USER_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch {}

function readMcpFile(file, scope, projectPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.entries(cfg.mcpServers || {}).map(([name, v]) => {
      const transport = v.url ? (v.url.includes("/sse") ? "sse" : "http") : "stdio";
      const enabled = !v.disabled;
      const config = transport === "stdio"
        ? { type: "stdio", command: v.command || "", args: v.args || [], env: v.env || {} }
        : { type: transport, url: v.url || "", headers: v.headers || {} };
      return {
        name, scope, transport, enabled,
        status: enabled ? "connected" : "disabled",
        statusLabel: enabled ? "已连接" : "已禁用",
        configLocation: file,
        ...(projectPath ? { projectPath } : {}),
        summary: transport === "stdio" ? `${v.command || ""} ${(v.args || []).join(" ")}`.trim() : (v.url || ""),
        canEdit: true, canRemove: true, canReconnect: enabled, canToggle: true,
        config,
      };
    });
  } catch { return []; }
}
function projectMcpFile(cwd) { return path.join(cwd, ".kiro/settings/mcp.json"); }
function mcpProjectPaths() {
  const seen = new Set();
  for (const s of listSessions()) { const c = s.workDir; if (c && !seen.has(c) && fs.existsSync(c)) seen.add(c); }
  for (const c of kiroIdeProjects()) { if (c && !seen.has(c) && fs.existsSync(c)) seen.add(c); }
  return [...seen];
}
function listMcp(cwd) {
  const out = readMcpFile(MCP_JSON, "user");
  if (cwd) out.push(...readMcpFile(projectMcpFile(cwd), "project", cwd));
  return out;
}
function mcpToggle(name, enabled) {
  try { const cfg = JSON.parse(fs.readFileSync(MCP_JSON, "utf8")); if (cfg.mcpServers?.[name]) { cfg.mcpServers[name].disabled = !enabled; fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2)); } } catch {}
}
function mcpRemove(name) {
  try { const cfg = JSON.parse(fs.readFileSync(MCP_JSON, "utf8")); if (cfg.mcpServers) { delete cfg.mcpServers[name]; fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2)); } } catch {}
}
function mcpAdd(b) {
  try {
    const cfg = JSON.parse(fs.readFileSync(MCP_JSON, "utf8"));
    cfg.mcpServers = cfg.mcpServers || {};
    const cf = b.config || b;
    const entry = cf.type === "stdio" || cf.command ? { command: cf.command, args: cf.args || [], env: cf.env || {}, disabled: false } : { url: cf.url, headers: cf.headers || {}, disabled: false };
    cfg.mcpServers[b.name] = entry;
    fs.writeFileSync(MCP_JSON, JSON.stringify(cfg, null, 2));
  } catch {}
}

function readSkillDir(dir, source) {
  const out = [];
  try {
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d, "SKILL.md");
      if (fs.existsSync(p)) {
        const c = fs.readFileSync(p, "utf8");
        const name = ((c.match(/^name:\s*(.+)$/m) || [])[1] || d).trim();
        const description = ((c.match(/^description:\s*(.+)$/m) || [])[1] || "").trim();
        out.push({ name, displayName: name, description, source, userInvocable: true, contentLength: c.length, hasDirectory: true });
      }
    }
  } catch {}
  return out;
}
function listSkills(cwd) {
  const out = readSkillDir(SKILLS_DIR, "user");
  if (cwd) out.push(...readSkillDir(path.join(cwd, ".kiro/skills"), "project"));
  return out;
}

// ---------- ACP bridge + WS ----------
import { startAcpBridge, SESSION_META } from "./acp.js";
const wss = new WebSocketServer({ server, path: undefined });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/\/ws\/([^/]+)/);
  if (!m) { ws.close(); return; }
  const sessionId = decodeURIComponent(m[1]);
  const meta = NEW_SESSIONS.get(sessionId);
  const cwd = meta?.workDir || sessionInfoCwd(sessionId) || HOME;
  const resumeId = meta ? null : sessionId; // existing kiro conversation → load
  let agent = meta?.agent;
  if (!resumeId && hooksConfigured() && (!agent || agent === "kiro_default")) agent = ensureHookAgent();
  startAcpBridge({ ws, sessionId, cwd, model: meta?.model, agent, resumeId, kiro: KIRO });
});

function steeringDir(base) { return path.join(base, ".kiro/steering"); }
const HOOK_AGENT = "kiro-haha";
const HOOK_AGENT_FILE = path.join(HOME, ".kiro/agents", `${HOOK_AGENT}.json`);
const HOOK_TRIGGERS = ["userPromptSubmit", "preToolUse", "postToolUse"];
function readHookAgent() {
  try { return JSON.parse(fs.readFileSync(HOOK_AGENT_FILE, "utf8")); } catch {}
  return { name: HOOK_AGENT, description: "kiro-haha hooks agent", prompt: null, mcpServers: {},
    tools: ["read", "write", "shell", "aws", "report", "introspect", "knowledge", "thinking", "todo", "delegate", "grep", "glob"],
    toolAliases: {}, allowedTools: [], resources: [], hooks: {}, toolsSettings: {}, includeMcpJson: true, model: null };
}
function ensureHookAgent() {
  if (!fs.existsSync(HOOK_AGENT_FILE)) {
    fs.mkdirSync(path.dirname(HOOK_AGENT_FILE), { recursive: true });
    fs.writeFileSync(HOOK_AGENT_FILE, JSON.stringify(readHookAgent(), null, 2));
  }
  return HOOK_AGENT;
}
function getHooks() { const h = readHookAgent().hooks || {}; return Object.fromEntries(HOOK_TRIGGERS.map((t) => [t, h[t] || []])); }
function setHooks(hooks) {
  const agent = readHookAgent();
  agent.hooks = Object.fromEntries(HOOK_TRIGGERS.filter((t) => Array.isArray(hooks[t]) && hooks[t].length).map((t) => [t, hooks[t]]));
  fs.mkdirSync(path.dirname(HOOK_AGENT_FILE), { recursive: true });
  fs.writeFileSync(HOOK_AGENT_FILE, JSON.stringify(agent, null, 2));
  return getHooks();
}
function hooksConfigured() { const h = readHookAgent().hooks || {}; return HOOK_TRIGGERS.some((t) => (h[t] || []).length); }

// ---------- Specs (self-built Kiro-style spec workflow) ----------
const SPEC_PHASES = { requirements: "requirements.md", design: "design.md", tasks: "tasks.md" };
function specsRoot(cwd) { return path.join(cwd || HOME, ".kiro/specs"); }
function listSpecs(cwd) {
  const root = specsRoot(cwd); const out = [];
  try {
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const has = (f) => fs.existsSync(path.join(dir, f));
      let updatedAt = 0; try { updatedAt = fs.statSync(dir).mtimeMs; } catch {}
      out.push({ name, dir, requirements: has("requirements.md"), design: has("design.md"), tasks: has("tasks.md"), updatedAt: new Date(updatedAt).toISOString() });
    }
  } catch {}
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function specRead(cwd, name, phase) {
  const f = SPEC_PHASES[phase]; if (!f) return "";
  try { return fs.readFileSync(path.join(specsRoot(cwd), name, f), "utf8"); } catch { return ""; }
}
function specWrite(cwd, name, phase, content) {
  const f = SPEC_PHASES[phase]; if (!f) return;
  const dir = path.join(specsRoot(cwd), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, f), content ?? "");
}
function runCli(args, cwd) {
  return new Promise((resolve) => {
    const p = spawn(KIRO, args, { cwd: cwd || HOME, env: { ...process.env, NO_COLOR: "1" } });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", () => {});
    p.on("close", () => resolve(out)); p.on("error", () => resolve(""));
  });
}
async function specGenerate(cwd, name, phase, idea) {
  const dir = path.join(specsRoot(cwd), name);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, SPEC_PHASES[phase]);
  let prompt;
  if (phase === "requirements") {
    prompt = `你是 Kiro spec 助手。为下面的功能编写需求文档，使用 EARS 格式（含"引言"、编号的用户故事，每条用户故事下用"WHEN <条件> THE SYSTEM SHALL <行为>"形式列验收标准）。用文件写入工具把完整 markdown 写入 ${abs}（覆盖）。不要询问、不要多余解释。功能：${idea || name}`;
  } else if (phase === "design") {
    prompt = `基于以下需求文档，编写技术设计文档（含 概述、架构、组件与接口、数据模型、错误处理、测试策略）。用文件写入工具把完整 markdown 写入 ${abs}（覆盖）。不要询问。\n\n需求文档:\n${specRead(cwd, name, "requirements") || idea || name}`;
  } else {
    prompt = `基于以下设计文档，编写实现任务清单：编号的 markdown 复选框列表（形如 "- [ ] 1. 任务描述"，可有子任务 "- [ ] 1.1 ..."），每个任务是离散、可执行的编码步骤，并在末尾标注关联的需求。用文件写入工具把完整 markdown 写入 ${abs}（覆盖）。不要询问。\n\n设计文档:\n${specRead(cwd, name, "design") || specRead(cwd, name, "requirements") || idea || name}`;
  }
  await runCli(["chat", "--no-interactive", "--trust-all-tools", prompt], cwd);
  return specRead(cwd, name, phase);
}
function memoryProjects(cwd) {
  const out = [];
  const seen = new Set();
  const add = (dir, label, isCurrent) => {
    if (seen.has(dir)) return; seen.add(dir);
    let fileCount = 0; let exists = false;
    try { exists = fs.statSync(dir).isDirectory(); if (exists) fileCount = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).length; } catch {}
    out.push({ id: dir, label, memoryDir: dir, exists, fileCount, isCurrent: !!isCurrent });
  };
  const globalDir = path.join(HOME, ".kiro/steering");
  add(globalDir, "全局 (Global steering)", !cwd);
  if (cwd) add(steeringDir(cwd), `项目 (${path.basename(cwd)})`, true);
  return out;
}
function memoryFiles(dir) {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((name) => {
      const p = path.join(dir, name); const st = fs.statSync(p);
      return { path: p, name, bytes: st.size, updatedAt: st.mtime.toISOString(), title: name.replace(/\.md$/, ""), isIndex: name.toLowerCase() === "readme.md" };
    });
  } catch { return []; }
}
function memoryReadFile(p) {
  try { const st = fs.statSync(p); return { path: p, content: fs.readFileSync(p, "utf8"), updatedAt: st.mtime.toISOString(), bytes: st.size }; }
  catch { return { path: p || "", content: "", updatedAt: new Date().toISOString(), bytes: 0 }; }
}
function memorySaveFile(dir, p, content) {
  const full = p && path.isAbsolute(p) ? p : path.join(dir || path.join(HOME, ".kiro/steering"), p || "untitled.md");
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content ?? "");
  const st = fs.statSync(full);
  return { path: full, updatedAt: st.mtime.toISOString(), bytes: st.size };
}

function gitInfo(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return { branch: null, repoName: null, workDir: cwd || "", changedFiles: 0, worktree: null, isRepo: false };
  try {
    const branch = execSync(`git -C ${JSON.stringify(cwd)} rev-parse --abbrev-ref HEAD`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const changed = execSync(`git -C ${JSON.stringify(cwd)} status --porcelain`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { branch, repoName: path.basename(cwd), workDir: cwd, changedFiles: changed ? changed.split("\n").length : 0, worktree: null, isRepo: true };
  } catch { return { branch: null, repoName: null, workDir: cwd, changedFiles: 0, worktree: null, isRepo: false }; }
}

function workspace(kind, cwd, rel) {
  const abs = rel ? (path.isAbsolute(rel) ? rel : path.join(cwd || HOME, rel)) : (cwd || HOME);
  if (kind === "status") {
    const g = gitInfo(cwd);
    let changedFiles = [];
    if (g.isRepo) {
      try {
        const out = execSync(`git -C ${JSON.stringify(cwd)} status --porcelain`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        changedFiles = out ? out.split("\n").map((l) => {
          const x = l.slice(0, 2).trim(); const p = l.slice(3).trim();
          const map = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "??": "untracked" };
          return { path: p, status: map[x] || map[l.slice(0, 2).trim()] || "unknown", additions: 0, deletions: 0 };
        }) : [];
      } catch {}
    }
    return { state: cwd && fs.existsSync(cwd) ? "ok" : "missing_workdir", workDir: cwd || "", repoName: g.repoName, branch: g.branch, isGitRepo: g.isRepo, changedFiles };
  }
  if (kind === "tree") {
    try {
      const entries = fs.readdirSync(abs, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".git"))
        .map((e) => ({ name: e.name, path: path.join(abs, e.name), isDirectory: e.isDirectory() }))
        .sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
      return { state: "ok", path: abs, entries };
    } catch { return { state: "missing", path: abs, entries: [] }; }
  }
  if (kind === "file") {
    try {
      const st = fs.statSync(abs);
      if (st.size > 2 * 1024 * 1024) return { state: "too_large", path: abs, language: "", size: st.size };
      const content = fs.readFileSync(abs, "utf8");
      return { state: "ok", path: abs, previewType: "text", content, language: (path.extname(abs).slice(1) || "text"), size: st.size };
    } catch { return { state: "missing", path: abs, language: "", size: 0 }; }
  }
  if (kind === "diff") {
    try {
      const diff = execSync(`git -C ${JSON.stringify(cwd)} diff -- ${JSON.stringify(abs)}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
      return { state: "ok", path: abs, diff };
    } catch { return { state: "not_git_repo", path: abs }; }
  }
  return { state: "error", path: abs, error: "unknown workspace resource" };
}

function sessionInfoCwd(id) {
  const rows = sqlite(`SELECT key AS cwd FROM conversations_v2 WHERE conversation_id='${id.replace(/'/g, "")}' LIMIT 1`);
  return rows[0]?.cwd;
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    // A healthy adapter is already serving on this port. Exit quietly and let it
    // keep serving — killing it would create a gap that breaks the frontend's
    // startup fetches (settings/sessions). To deploy new adapter code, kill the
    // running adapter manually first (lsof -ti:3789 | xargs kill).
    console.log(`kiro-adapter: port ${PORT} already in use, leaving existing adapter running`);
    process.exit(0);
  }
  console.error("[server error]", e?.stack || e);
});
server.listen(PORT, "127.0.0.1", () => console.log(`kiro-adapter on http://127.0.0.1:${PORT}`));
