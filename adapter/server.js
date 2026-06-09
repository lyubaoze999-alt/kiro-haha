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

// Cross-platform locations for kiro-cli + Kiro IDE state.
// kiro-cli writes its sqlite to the platform's app-data dir; we scan a list
// of candidates and use the first that exists. Falls back to the canonical
// platform path so a fresh install still has a sensible default.
function pickFirstExisting(candidates, fallback) {
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return fallback || candidates[0];
}

function kiroCliDataDir() {
  if (process.platform === "win32") {
    return pickFirstExisting([
      process.env.APPDATA && path.join(process.env.APPDATA, "kiro-cli"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "kiro-cli"),
      path.join(HOME, "AppData/Roaming/kiro-cli"),
      path.join(HOME, "AppData/Local/kiro-cli"),
    ], path.join(HOME, "AppData/Roaming/kiro-cli"));
  }
  if (process.platform === "darwin") {
    return path.join(HOME, "Library/Application Support/kiro-cli");
  }
  // Linux / other: prefer XDG_DATA_HOME, then XDG_CONFIG_HOME, then defaults.
  return pickFirstExisting([
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, "kiro-cli"),
    path.join(HOME, ".local/share/kiro-cli"),
    process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, "kiro-cli"),
    path.join(HOME, ".config/kiro-cli"),
  ], path.join(HOME, ".local/share/kiro-cli"));
}

function kiroIdeDataDir() {
  // Kiro IDE is an Electron app — same conventions as VS Code.
  if (process.platform === "win32") {
    return pickFirstExisting([
      process.env.APPDATA && path.join(process.env.APPDATA, "Kiro"),
      path.join(HOME, "AppData/Roaming/Kiro"),
    ], path.join(HOME, "AppData/Roaming/Kiro"));
  }
  if (process.platform === "darwin") {
    return path.join(HOME, "Library/Application Support/Kiro");
  }
  return pickFirstExisting([
    process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, "Kiro"),
    path.join(HOME, ".config/Kiro"),
  ], path.join(HOME, ".config/Kiro"));
}

const DB = path.join(kiroCliDataDir(), "data.sqlite3");
const MCP_JSON = path.join(HOME, ".kiro/settings/mcp.json");
const SKILLS_DIR = path.join(HOME, ".agent-shared/skills");
const TITLES_FILE = path.join(HOME, ".kiro-haha-titles.json");
let TITLE_OVERRIDES = {};
try { TITLE_OVERRIDES = JSON.parse(fs.readFileSync(TITLES_FILE, "utf8")); } catch {}
function saveTitles() { try { fs.writeFileSync(TITLES_FILE, JSON.stringify(TITLE_OVERRIDES)); } catch {} }

function kiroBin() {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const out = execSync(`${probe} kiro-cli`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    // `where` may print multiple lines; pick the first.
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first) return first;
  } catch {}
  // Cross-platform fallbacks.
  const candidates = process.platform === "win32"
    ? [
        path.join(HOME, "AppData/Local/Programs/kiro-cli/kiro-cli.exe"),
        path.join(HOME, ".local/bin/kiro-cli.exe"),
        "kiro-cli.exe",
      ]
    : [
        path.join(HOME, ".local/bin/kiro-cli"),
        "/usr/local/bin/kiro-cli",
        "/opt/homebrew/bin/kiro-cli",
        "kiro-cli",
      ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
  return process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli";
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
// Sweep stale .lock files at startup: a `.lock` is created by kiro-cli ACP child
// processes; if the parent adapter was killed with SIGKILL the child may have
// died too and left an orphan lock. Trying to session/load again then fails with
// "Session is active in another process" → 0-credits silent failure on the UI.
// We check each lock's pid; if the process no longer exists, we remove the lock.
function cleanupStaleSessionLocks() {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(CLI_SESSIONS_DIR)) {
      if (!f.endsWith(".lock")) continue;
      const fp = path.join(CLI_SESSIONS_DIR, f);
      try {
        const raw = fs.readFileSync(fp, "utf8");
        const j = JSON.parse(raw);
        const pid = Number(j.pid);
        if (!Number.isFinite(pid)) { fs.unlinkSync(fp); removed++; continue; }
        // process.kill(pid, 0) → ESRCH means process is gone.
        try { process.kill(pid, 0); }
        catch (e) {
          if (e.code === "ESRCH") { fs.unlinkSync(fp); removed++; }
        }
      } catch { /* unreadable lock; leave it alone */ }
    }
  } catch { /* sessions dir missing; fine */ }
  if (removed > 0) console.log(`[adapter] swept ${removed} stale session lock(s)`);
}
cleanupStaleSessionLocks();

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
  // Re-read settings.json so the permissionMode field on each session reflects
  // the latest value (acp.js writes it on set_permission_mode).
  try { Object.assign(USER_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch {}
  const curMode = USER_SETTINGS.permissionMode || "default";
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
    permissionMode: curMode,
  }));
  const seen = new Set(v2.map((s) => s.id));
  const merged = [...v2];
  for (const s of readCliSessionFiles()) if (!seen.has(s.id)) { seen.add(s.id); merged.push({ ...s, permissionMode: curMode }); }
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
  const vdb = path.join(kiroIdeDataDir(), "User/globalStorage/state.vscdb");
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

// In-memory cache for parsed .jsonl messages. Avoids re-parsing huge sessions
// (>100MB) on every poll. Keyed by id; re-parses only the bytes appended since
// last hit (size grows monotonically; truncation/rotation re-seeds via mtime change).
const JSONL_CACHE = new Map(); // id -> { mtimeMs, size, out, seq, base, leftover }
function messagesFromJsonl(id) {
  const file = path.join(CLI_SESSIONS_DIR, id.replace(/[^\w.\-]/g, "") + ".jsonl");
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  let cache = JSON_CACHE_get(id);
  if (cache && cache.mtimeMs === st.mtimeMs && cache.size === st.size) return cache.out;
  // Re-seed if file truncated/rotated, or first read.
  if (!cache || st.size < cache.size || cache.mtimeMs > st.mtimeMs) {
    cache = { mtimeMs: 0, size: 0, out: [], seq: 0, base: Date.now(), leftover: "" };
  }
  let chunk;
  try {
    const fd = fs.openSync(file, "r");
    const remaining = st.size - cache.size;
    const buf = Buffer.alloc(remaining);
    fs.readSync(fd, buf, 0, remaining, cache.size);
    fs.closeSync(fd);
    chunk = cache.leftover + buf.toString("utf8");
  } catch { return cache.out; }
  const lastNl = chunk.lastIndexOf("\n");
  const ready = lastNl >= 0 ? chunk.slice(0, lastNl) : "";
  const leftover = lastNl >= 0 ? chunk.slice(lastNl + 1) : chunk;
  const lines = ready ? ready.split("\n") : [];
  const out = cache.out;
  const ts = () => new Date(cache.base + cache.seq * 1000).toISOString();
  const push = (m) => { out.push({ id: `${id}-${cache.seq}`, timestamp: ts(), ...m }); cache.seq++; };
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
  cache.mtimeMs = st.mtimeMs; cache.size = st.size; cache.leftover = leftover;
  JSONL_CACHE.set(id, cache);
  return out;
}
function JSON_CACHE_get(id) { return JSONL_CACHE.get(id); }
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
  if (url.pathname === "/api/quota") {
    // Force-refresh on ?refresh=1, otherwise return cached.
    if (url.searchParams.get("refresh") === "1") { fetchKiroQuotaOnce(); }
    return json(res, summarizeKiroQuota());
  }

  // Static file routes for in-app browser webview (cc-haha contract).
  // /preview-fs/:sessionId/<rest>: serve files inside the session's cwd (sandboxed).
  // /local-file/<abs>: serve any absolute file under $HOME (sandboxed).
  if (url.pathname.startsWith("/preview-fs/")) {
    const m = url.pathname.match(/^\/preview-fs\/([^/]+)\/(.*)$/);
    if (!m) { res.writeHead(400); return res.end("bad preview-fs url"); }
    const sid = decodeURIComponent(m[1]);
    const rel = decodeURIComponent(m[2] || "index.html");
    const cwd = sessionInfoCwd(sid);
    if (!cwd || !fs.existsSync(cwd)) { res.writeHead(404); return res.end("session cwd unknown"); }
    return servePreviewFile(res, path.join(cwd, rel), cwd);
  }
  if (url.pathname.startsWith("/local-file/")) {
    const abs = decodeURIComponent(url.pathname.slice("/local-file".length)) || "/";
    return servePreviewFile(res, abs, HOME);
  }

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
        let workDir = (typeof body.workDir === "string" && body.workDir) || body.repository?.workDir || HOME;
        const repo = body.repository || {};
        const id = "new-" + Date.now();
        let worktreeMeta = null;

        // Branch isolation: if the caller asks for a worktree, materialize it
        // under <repoRoot>/.claude/worktrees/<slug> and run the session there.
        // This lets two tabs work on different branches of the same repo
        // simultaneously without `git status` / file edits bleeding across.
        if (repo.worktree && repo.branch) {
          const repoRoot = gitRepoRoot(workDir);
          if (!repoRoot) {
            return json(res, { error: { code: "NOT_A_GIT_REPO", message: "selected folder is not inside a git repository" } }, 400);
          }
          const r = ensureWorktree(repoRoot, String(repo.branch));
          if (!r.ok) {
            return json(res, { error: { code: "WORKTREE_FAILED", message: r.error || "failed to create worktree" } }, 500);
          }
          workDir = r.worktreePath;
          worktreeMeta = { path: r.worktreePath, branch: String(repo.branch), reused: !!r.reused };
        } else if (repo.branch && !repo.worktree) {
          // branch provided but no worktree — we could `git switch` but that
          // would mutate the user's working copy and conflict with another
          // tab using the same dir. Refuse instead and ask the UI to enable
          // the worktree toggle.
          return json(res, {
            error: {
              code: "BRANCH_REQUIRES_WORKTREE",
              message: "to switch branches enable the worktree option (otherwise both tabs would share one working copy)",
            },
          }, 400);
        }

        NEW_SESSIONS.set(id, {
          workDir,
          model: body.model,
          agent: body.agent,
          permissionMode: body.permissionMode,
          worktree: worktreeMeta,
        });
        return json(res, { sessionId: id, workDir, worktree: worktreeMeta });
      }
      if (seg[2] && seg[3] === "messages") return json(res, { messages: conversationMessages(seg[2]) });
      if (seg[2] && seg[3] === "slash-commands") return json(res, { commands: SLASH });
      if (seg[2] && seg[3] === "git-info") return json(res, gitInfo(sessionInfoCwd(seg[2])));
      if (seg[2] && seg[3] === "workspace") return json(res, workspace(seg[4], sessionInfoCwd(seg[2]), url.searchParams.get("path") || "", seg[2]));
      if (seg[2] && seg[3] === "inspection") {
        // Re-read settings so the latest permissionMode (written by acp.js) shows up.
        try { Object.assign(USER_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch {}
        const ctx = contextSnapshot(seg[2]);
        const meta = SESSION_META.get(seg[2]) || {};
        const q = summarizeKiroQuota();
        return json(res, {
          config: { permissionMode: USER_SETTINGS.permissionMode || "default", model: "auto", cwd: sessionInfoCwd(seg[2]) || HOME, tools: [], mcpServers: [], slashCommandCount: SLASH.length, skillCount: 0 },
          usage: {
            input_tokens: 0, output_tokens: 0, totalCostUSD: 0,
            costDisplay: q.available
              ? `${(q.used || 0).toFixed(0)} / ${(q.limit || 0).toFixed(0)} ${q.plan} credits`
              : `${(meta.totalCredits || 0).toFixed(2)} credits`,
            totalCredits: meta.totalCredits || 0,
            models: [],
            quota: q,
          },
          context: ctx,
          contextEstimate: ctx,
          errors: {},
        });
      }
      if (seg[2] && seg[3] === "turn-checkpoints") {
        const id = seg[2];
        const all = messagesFromJsonl(id);
        // Slice messages into per-turn groups (one user message + everything until the next user).
        // For each group, collect file paths from all tool_use entries whose input has `path` or `file_path`.
        // Treat any tool with such an input field as a file-touching tool — matches cc-haha's ToolCallBlock heuristic.
        const groups = [];
        let cur = null;
        for (const m of all) {
          if (m.type === "user") { cur = { user: m, paths: new Set() }; groups.push(cur); continue; }
          if (!cur) continue;
          if (m.type === "assistant" && Array.isArray(m.content)) {
            for (const block of m.content) {
              if (block?.type !== "tool_use") continue;
              const inp = block.input || {};
              const p = (typeof inp.path === "string" && inp.path)
                || (typeof inp.file_path === "string" && inp.file_path)
                || null;
              if (p) cur.paths.add(p);
            }
          }
        }
        const total = groups.length;
        const checkpoints = groups.map((g, i) => ({
          target: { targetUserMessageId: g.user.id, userMessageIndex: i, userMessageCount: total },
          code: {
            available: g.paths.size > 0,
            reason: g.paths.size > 0 ? "ok" : "no-changes",
            filesChanged: [...g.paths],
            insertions: 0, deletions: 0,
          },
        }));
        return json(res, { checkpoints });
      }
      if (seg[2] && seg[3] === "rewind" && req.method === "POST") {
        const id = seg[2];
        const body = await readBody(req);
        const targetIndex = Number(body?.userMessageIndex);
        if (!Number.isInteger(targetIndex) || targetIndex < 0) {
          res.statusCode = 400; return json(res, { error: "invalid userMessageIndex" });
        }
        const file = path.join(CLI_SESSIONS_DIR, id.replace(/[^\w.\-]/g, "") + ".jsonl");
        let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch { res.statusCode = 404; return json(res, { error: "session file not found" }); }
        // Walk lines; find the byte offset of the targetIndex-th Prompt that has text content.
        let promptCount = 0; let truncateAt = -1; let removed = 0; let offset = 0;
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          const lineLen = Buffer.byteLength(ln, "utf8") + 1; // include \n
          if (ln.trim()) {
            try {
              const e = JSON.parse(ln);
              if (e.kind === "Prompt") {
                const txt = (e.data?.content || []).filter((c) => c.kind === "text").map((c) => c.data).join("").trim();
                if (txt) {
                  if (promptCount === targetIndex) { truncateAt = offset; }
                  promptCount++;
                }
              }
            } catch {}
          }
          if (truncateAt >= 0 && i >= 0) { /* counting removed lines below */ }
          offset += lineLen;
        }
        if (truncateAt < 0) { res.statusCode = 400; return json(res, { error: "user message not found at index" }); }
        // Count entries to be removed (rough: total non-empty lines after truncate point)
        for (const ln of text.slice(truncateAt).split("\n")) if (ln.trim()) removed++;
        // Truncate file in-place. Keep header (everything before truncateAt) intact.
        try { fs.writeFileSync(file, text.slice(0, truncateAt)); } catch (e) { res.statusCode = 500; return json(res, { error: String(e) }); }
        // Drop our parser cache so /messages re-reads from the truncated file.
        try { JSONL_CACHE.delete(id); } catch {}
        // Force-disconnect any active WS for this session so frontend reconnects with
        // a fresh ACP child that picks up the truncated history (the old child's
        // in-memory state is now stale).
        try {
          for (const cli of wss.clients) {
            if (cli.sessionId === id) cli.terminate();
          }
        } catch {}
        return json(res, {
          target: { targetUserMessageId: body.targetUserMessageId, userMessageIndex: targetIndex, userMessageCount: promptCount },
          conversation: { messagesRemoved: removed, removedMessageIds: [] },
          code: { available: false, reason: "no-git", filesChanged: [], insertions: 0, deletions: 0 },
        });
      }
      if (seg[2] === "repository-context") {
        const wd = url.searchParams.get("workDir") || HOME;
        const g = gitInfo(wd);
        const repoRoot = g.isRepo ? gitRepoRoot(wd) : null;
        const branches = repoRoot ? gitBranches(repoRoot) : [];
        const worktrees = repoRoot ? gitWorktrees(repoRoot) : [];
        // defaultBranch heuristic: prefer 'main', then 'master', else current.
        let defaultBranch = g.branch;
        const names = new Set(branches.filter((b) => b.local).map((b) => b.name));
        if (names.has("main")) defaultBranch = "main";
        else if (names.has("master")) defaultBranch = "master";
        return json(res, {
          state: fs.existsSync(wd) ? "ok" : "missing_workdir",
          workDir: wd,
          repoRoot,
          repoName: g.repoName,
          currentBranch: g.branch,
          defaultBranch,
          dirty: g.changedFiles > 0,
          branches,
          worktrees,
        });
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
        mcpToggle(decodeURIComponent(seg[2]), body.enabled, body.cwd || cwd);
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
    if (r === "doctor") return json(res, runDoctor());
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
    if (r === "workspaces") {
      // GET /api/workspaces  -> { workspaces, currentWorkspaceId }
      // POST /api/workspaces { rootPath, name?, agentName? } -> { workspace }
      // POST /api/workspaces/validate { rootPath } -> WorkspaceValidationResult
      // POST /api/workspaces/switch { workspaceId } -> { workspace }
      // PATCH /api/workspaces/:id { name?, agentName? } -> { workspace }
      // DELETE /api/workspaces/:id -> { ok: true }
      if (seg[2] === "validate" && req.method === "POST") {
        const body = await readBody(req);
        return json(res, validateWorkspace(body.rootPath));
      }
      if (seg[2] === "switch" && req.method === "POST") {
        const body = await readBody(req);
        const ws = switchWorkspace(body.workspaceId);
        if (!ws) { res.statusCode = 404; return json(res, { error: { code: "WORKSPACE_NOT_FOUND", message: "workspace not found" } }); }
        return json(res, { workspace: ws });
      }
      if (seg.length === 2 && req.method === "POST") {
        const body = await readBody(req);
        try {
          const ws = createWorkspace(body.rootPath, body.name, body.agentName);
          return json(res, { workspace: ws });
        } catch (e) {
          res.statusCode = 400;
          return json(res, { error: { code: "WORKSPACE_INVALID", message: String(e?.message || e) } });
        }
      }
      if (seg[2] && req.method === "PATCH") {
        const body = await readBody(req);
        const ws = updateWorkspace(decodeURIComponent(seg[2]), body);
        if (!ws) { res.statusCode = 404; return json(res, { error: { code: "WORKSPACE_NOT_FOUND", message: "workspace not found" } }); }
        return json(res, { workspace: ws });
      }
      if (seg[2] && req.method === "DELETE") {
        deleteWorkspace(decodeURIComponent(seg[2]));
        return json(res, { ok: true });
      }
      return json(res, {
        workspaces: listWorkspaces(),
        currentWorkspaceId: getCurrentWorkspaceId(),
      });
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
  theme: "light", language: "zh-CN", permissionMode: "default",
  defaultModel: "auto", defaultAgent: "kiro_default",
  fontSize: 14, sendShortcut: "enter", autoAccept: true,
};
const SETTINGS_FILE = path.join(HOME, ".kiro-haha-settings.json");
try { Object.assign(USER_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch {}

// ---------- Kiro quota / usage limits poller ----------
// kiro-cli ACP doesn't expose subscription quota; we hit the same control-plane
// endpoint that kiro IDE / desktop uses (`AmazonCodeWhispererService.GetUsageLimits`),
// reading the access token written by kiro's own auth flow. Doesn't consume LLM
// credits — this is account metadata, not inference.
const KIRO_QUOTA = {
  data: null,           // last successful response (full body)
  fetchedAt: 0,         // ms epoch
  error: null,          // last error message (if any)
  inFlight: false,
};
const KIRO_QUOTA_ENDPOINTS = {
  // Region prefix → endpoint. Default to us-east-1; switch by `region` field in token cache.
  default: "https://management.us-east-1.kiro.dev/",
  "eu-central-1": "https://management.eu-central-1.kiro.dev/",
};
const KIRO_AUTH_TOKEN_FILES = [
  path.join(HOME, ".aws/sso/cache/kiro-auth-token.json"),       // desktop token (preferred, kiro IDE refreshes)
  path.join(HOME, ".aws/sso/cache/kiro-auth-token-cli.json"),   // cli token (fallback)
];

function readKiroAuthToken() {
  // Priority 1 — sqlite auth_kv (kiro-cli's primary store; refreshed in
  // the background by `kiro-cli` itself). The legacy json file under
  // ~/.aws/sso/cache is sometimes stale because kiro-cli only flushes it
  // opportunistically; sqlite is always fresh.
  try {
    const rows = sqlite(`SELECT value FROM auth_kv WHERE key='kirocli:odic:token' LIMIT 1`);
    const v = rows[0]?.value;
    if (v) {
      const j = JSON.parse(v);
      const exp = j.expires_at || j.expiresAt;
      const accessToken = j.access_token || j.accessToken;
      if (accessToken && exp && new Date(exp).getTime() > Date.now()) {
        return { accessToken, region: j.region || "us-east-1", source: "sqlite" };
      }
    }
  } catch {}

  // Priority 2 — json file (older path, still used by AWS SSO tooling).
  for (const f of KIRO_AUTH_TOKEN_FILES) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!j.accessToken || !j.expiresAt) continue;
      // Skip expired tokens (kiro keeps refreshing the .json file in place).
      if (new Date(j.expiresAt).getTime() < Date.now()) continue;
      return { accessToken: j.accessToken, region: j.region || "us-east-1", source: "file" };
    } catch {}
  }
  return null;
}

function readKiroProfileArn() {
  try {
    const rows = sqlite(`SELECT value FROM state WHERE key='api.codewhisperer.profile' LIMIT 1`);
    if (!rows[0]?.value) return null;
    const j = JSON.parse(rows[0].value);
    return j.arn || null;
  } catch { return null; }
}

async function fetchKiroQuotaOnce() {
  if (KIRO_QUOTA.inFlight) return;
  const tok = readKiroAuthToken();
  const arn = readKiroProfileArn();
  if (!tok || !arn) {
    KIRO_QUOTA.error = !tok ? "no valid kiro auth token (re-login may be needed)" : "no profileArn in kiro state";
    return;
  }
  KIRO_QUOTA.inFlight = true;
  try {
    // Endpoint follows the token's home region; falls back to us-east-1.
    const url = KIRO_QUOTA_ENDPOINTS.default;
    const body = JSON.stringify({ profileArn: arn });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.0",
        "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
        "Authorization": `Bearer ${tok.accessToken}`,
      },
      body,
    });
    const text = await resp.text();
    if (!resp.ok) {
      KIRO_QUOTA.error = `HTTP ${resp.status}: ${text.slice(0, 200)}`;
      return;
    }
    const json = JSON.parse(text);
    KIRO_QUOTA.data = json;
    KIRO_QUOTA.fetchedAt = Date.now();
    KIRO_QUOTA.error = null;
  } catch (e) {
    KIRO_QUOTA.error = String(e?.message || e);
  } finally {
    KIRO_QUOTA.inFlight = false;
  }
}

// Initial fetch — refresh on demand only (WS connect, frontend mount, user click).
// Match kiro IDE's behavior: no background polling.
fetchKiroQuotaOnce();

function summarizeKiroQuota() {
  const d = KIRO_QUOTA.data;
  if (!d) return { available: false, error: KIRO_QUOTA.error };
  const credit = (d.usageBreakdownList || []).find((b) => b.resourceType === "CREDIT") || {};
  return {
    available: true,
    fetchedAt: KIRO_QUOTA.fetchedAt,
    plan: d.subscriptionInfo?.subscriptionTitle || d.subscriptionInfo?.type || "Unknown",
    used: credit.currentUsageWithPrecision ?? credit.currentUsage ?? 0,
    limit: credit.usageLimitWithPrecision ?? credit.usageLimit ?? 0,
    overage: credit.currentOveragesWithPrecision ?? credit.currentOverages ?? 0,
    overageCap: credit.overageCapWithPrecision ?? credit.overageCap ?? 0,
    overageEnabled: d.overageConfiguration?.overageStatus === "ENABLED",
    nextResetAt: d.nextDateReset ? d.nextDateReset * 1000 : null,
    raw: d, // full body for power users
  };
}

// First-launch self-check: are the things kiro-haha needs in place?
//   - kiro-cli binary discoverable
//   - a non-expired auth token (sqlite preferred, json fallback)
//   - kiro-cli sqlite reachable (would mean the user has launched kiro-cli at
//     least once, since it creates the db on first run)
// Returns { ok, checks: [{ id, label, status: 'ok'|'warn'|'error', detail?, action? }] }
// The frontend uses this to decide whether to surface a first-run guide modal.
function runDoctor() {
  const checks = [];

  // 1) kiro-cli binary
  let kiroBinPath = null;
  try {
    const which = process.platform === "win32" ? "where" : "which";
    kiroBinPath = execSync(`${which} kiro-cli`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split(/\r?\n/)[0] || null;
  } catch {}
  if (!kiroBinPath) {
    // try the canonical fallback paths kiroBin() probes
    try { if (fs.existsSync(KIRO)) kiroBinPath = KIRO; } catch {}
  }
  checks.push(kiroBinPath
    ? { id: "kiro-cli", label: "kiro-cli", status: "ok", detail: kiroBinPath }
    : {
        id: "kiro-cli",
        label: "kiro-cli",
        status: "error",
        detail: "Install kiro-cli first — see https://kiro.dev/cli",
        action: "install_kiro_cli",
      });

  // 2) kiro-cli sqlite (created on first chat invocation)
  const dbExists = (() => { try { return fs.existsSync(DB); } catch { return false; } })();
  checks.push(dbExists
    ? { id: "kiro-data", label: "kiro-cli data store", status: "ok", detail: DB }
    : { id: "kiro-data", label: "kiro-cli data store", status: "warn", detail: `Not found at ${DB}. Will be created after the first kiro-cli invocation.` });

  // 3) auth token (sqlite primary, json fallback) — same lookup that quota uses
  const tok = readKiroAuthToken();
  if (tok) {
    checks.push({ id: "auth-token", label: "Login token", status: "ok", detail: `source=${tok.source} region=${tok.region}` });
  } else {
    checks.push({
      id: "auth-token",
      label: "Login token",
      status: "error",
      detail: "No valid token. Run `kiro-cli login` in a terminal, then click retry.",
      action: "kiro_cli_login",
    });
  }

  // 4) profile arn (set after first session)
  const arn = readKiroProfileArn();
  checks.push(arn
    ? { id: "profile-arn", label: "Codewhisperer profile", status: "ok", detail: arn.slice(0, 80) }
    : { id: "profile-arn", label: "Codewhisperer profile", status: "warn", detail: "Not set yet. Will appear after the first kiro-cli session." });

  const ok = checks.every((c) => c.status === "ok");
  const blocking = checks.some((c) => c.status === "error");
  return { ok, blocking, checks, platform: process.platform, kiroBinPath };
}

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
function mcpToggle(name, enabled, cwd) {
  // Resolve target file: project-level if cwd provided and file exists, else global.
  const projectFile = cwd ? path.join(cwd, ".kiro/settings/mcp.json") : null;
  const target = (projectFile && fs.existsSync(projectFile)) ? projectFile : MCP_JSON;
  try {
    const cfg = JSON.parse(fs.readFileSync(target, "utf8"));
    if (!cfg.mcpServers?.[name]) return;
    // If `enabled` is provided explicitly use it; otherwise flip current state (toggle semantics).
    if (typeof enabled === "boolean") {
      cfg.mcpServers[name].disabled = !enabled;
    } else {
      cfg.mcpServers[name].disabled = !cfg.mcpServers[name].disabled;
    }
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2));
  } catch {}
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

// ---------- Kiro ACP Client: WorkspaceService ----------
let WORKSPACES_STATE = { workspaces: [], currentWorkspaceId: null };
try { WORKSPACES_STATE = JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8")); } catch {}
if (!Array.isArray(WORKSPACES_STATE.workspaces)) WORKSPACES_STATE.workspaces = [];

function saveWorkspaces() {
  try { fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(WORKSPACES_STATE, null, 2)); } catch {}
}
function listWorkspaces() { return WORKSPACES_STATE.workspaces; }
function getCurrentWorkspaceId() { return WORKSPACES_STATE.currentWorkspaceId; }
function findWorkspace(id) { return WORKSPACES_STATE.workspaces.find((w) => w.id === id); }

function createWorkspace(rootPath, name, agentName) {
  if (!rootPath || typeof rootPath !== "string") throw new Error("rootPath is required");
  const abs = path.resolve(rootPath);
  if (!fs.existsSync(abs)) throw new Error(`directory not found: ${abs}`);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${abs}`);
  const exist = WORKSPACES_STATE.workspaces.find((w) => w.rootPath === abs);
  if (exist) {
    WORKSPACES_STATE.currentWorkspaceId = exist.id;
    saveWorkspaces();
    return exist;
  }
  const id = "ws-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const ws = {
    id, name: (name || path.basename(abs)).trim(), rootPath: abs,
    agentName: agentName || undefined, createdAt: now, updatedAt: now,
  };
  WORKSPACES_STATE.workspaces.push(ws);
  WORKSPACES_STATE.currentWorkspaceId = id;
  saveWorkspaces();
  return ws;
}

function switchWorkspace(workspaceId) {
  const ws = findWorkspace(workspaceId);
  if (!ws) return null;
  WORKSPACES_STATE.currentWorkspaceId = workspaceId;
  saveWorkspaces();
  return ws;
}

function updateWorkspace(workspaceId, patch) {
  const ws = findWorkspace(workspaceId);
  if (!ws) return null;
  if (patch.name) ws.name = String(patch.name).trim();
  if (patch.agentName !== undefined) ws.agentName = patch.agentName || undefined;
  ws.updatedAt = Date.now();
  saveWorkspaces();
  return ws;
}

function deleteWorkspace(workspaceId) {
  WORKSPACES_STATE.workspaces = WORKSPACES_STATE.workspaces.filter((w) => w.id !== workspaceId);
  if (WORKSPACES_STATE.currentWorkspaceId === workspaceId) {
    WORKSPACES_STATE.currentWorkspaceId = WORKSPACES_STATE.workspaces[0]?.id || null;
  }
  saveWorkspaces();
}

function validateWorkspace(rootPath) {
  const result = {
    rootPath: rootPath || "", exists: false, hasKiroDir: false,
    skillsCount: 0, steeringCount: 0, hasSettings: false, warnings: [],
  };
  if (!rootPath) { result.warnings.push("rootPath 为空"); return result; }
  const abs = path.resolve(rootPath);
  result.rootPath = abs;
  result.exists = fs.existsSync(abs);
  if (!result.exists) { result.warnings.push("目录不存在"); return result; }
  const kiroDir = path.join(abs, ".kiro");
  result.hasKiroDir = fs.existsSync(kiroDir);
  if (!result.hasKiroDir) { result.warnings.push("未发现 .kiro 目录"); return result; }
  try {
    const skillsDir = path.join(kiroDir, "skills");
    if (fs.existsSync(skillsDir)) {
      result.skillsCount = fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).length;
    }
  } catch {}
  try {
    const steeringDir = path.join(kiroDir, "steering");
    if (fs.existsSync(steeringDir)) {
      result.steeringCount = fs.readdirSync(steeringDir).filter((f) => /\.(md|markdown)$/i.test(f)).length;
    }
  } catch {}
  result.hasSettings = fs.existsSync(path.join(kiroDir, "settings"));
  return result;
}

// ---------- Kiro ACP Client: KiroConfig ----------
function getKiroConfig() {
  return {
    cliPath: USER_SETTINGS.kiroCliPath || KIRO,
    defaultAgent: USER_SETTINGS.kiroDefaultAgent || USER_SETTINGS.defaultAgent || "kiro_default",
    trustAllTools: USER_SETTINGS.kiroTrustAllTools === true,
    globalSkillRoot: USER_SETTINGS.kiroGlobalSkillRoot || DEFAULT_GLOBAL_SKILLS_DIR,
  };
}
function updateKiroConfig(patch) {
  if (typeof patch.cliPath === "string") USER_SETTINGS.kiroCliPath = patch.cliPath;
  if (typeof patch.defaultAgent === "string") USER_SETTINGS.kiroDefaultAgent = patch.defaultAgent;
  if (typeof patch.trustAllTools === "boolean") USER_SETTINGS.kiroTrustAllTools = patch.trustAllTools;
  if (typeof patch.globalSkillRoot === "string") USER_SETTINGS.kiroGlobalSkillRoot = patch.globalSkillRoot;
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(USER_SETTINGS, null, 2)); } catch {}
  return getKiroConfig();
}

// ---------- Kiro ACP Client: SkillService ----------
import crypto from "node:crypto";

function computeSkillHash(skillMdPath) {
  try {
    const c = fs.readFileSync(skillMdPath, "utf8");
    return crypto.createHash("sha256").update(c).digest("hex").slice(0, 16);
  } catch { return ""; }
}

function parseSkillFrontmatter(content) {
  // 支持 YAML frontmatter（--- ... ---）或顶部行式键值
  const fm = { name: "", description: "", inclusionMode: "unknown", version: "" };
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const block = fmMatch ? fmMatch[1] : content.slice(0, 800);
  const get = (k) => {
    const m = block.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, "m"));
    return m ? m[1].replace(/^['"]|['"]$/g, "").trim() : "";
  };
  fm.name = get("name");
  fm.description = get("description");
  const inc = get("inclusionMode") || get("inclusion");
  if (["always", "auto", "manual", "fileMatch"].includes(inc)) fm.inclusionMode = inc;
  fm.version = get("version");
  return fm;
}

function checkSkillHealth(skill) {
  const warnings = [];
  if (!skill.skillMdPath) return { ...skill, status: "error", warnings: ["缺少 SKILL.md"] };
  if (!skill.description || skill.description.trim().length === 0) warnings.push("description 为空");
  else if (skill.description.length < 40) warnings.push("description 太短，可能不利于 auto 命中");
  if (skill.inclusionMode === "manual") warnings.push("manual 在 ACP 场景下不易自动触发");
  if (skill.inclusionMode === "fileMatch") warnings.push("fileMatch 依赖 IDE 文件上下文，ACP 场景不稳定");
  return { ...skill, status: warnings.length > 0 ? "warning" : "ok", warnings };
}

function buildSkillMeta(skillDir, source) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) return null;
  const content = fs.readFileSync(skillMdPath, "utf8");
  const fm = parseSkillFrontmatter(content);
  const dirName = path.basename(skillDir);
  const meta = {
    id: `${source}:${dirName}`,
    name: fm.name || dirName,
    path: skillDir,
    skillMdPath,
    inclusionMode: fm.inclusionMode || "unknown",
    description: fm.description || "",
    version: fm.version || undefined,
    hash: computeSkillHash(skillMdPath),
    status: "ok",
    warnings: [],
  };
  return checkSkillHealth(meta);
}

function scanGlobalSkills(globalSkillRoot) {
  const root = globalSkillRoot || getKiroConfig().globalSkillRoot;
  const out = [];
  try {
    if (!fs.existsSync(root)) return out;
    for (const d of fs.readdirSync(root)) {
      const skillDir = path.join(root, d);
      if (!fs.statSync(skillDir).isDirectory()) continue;
      const meta = buildSkillMeta(skillDir, "global");
      if (meta) {
        let updatedAt = 0;
        try { updatedAt = fs.statSync(meta.skillMdPath).mtimeMs; } catch {}
        out.push({ ...meta, rootPath: root, updatedAt });
      }
    }
  } catch {}
  return out;
}

function readSyncMeta(projectSkillDir) {
  const f = path.join(projectSkillDir, ".cc-haha-sync.json");
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

function getSyncStatus(globalHash, projectHash, syncMeta) {
  if (!projectHash) return "not_installed";
  if (!syncMeta) return "local";
  if (projectHash === globalHash) return "synced";
  const sourceHash = syncMeta.sourceHash;
  if (projectHash === sourceHash && globalHash !== sourceHash) return "outdated";
  if (projectHash !== sourceHash && globalHash === sourceHash) return "modified";
  if (projectHash !== sourceHash && globalHash !== sourceHash) return "conflict";
  return "synced";
}

function scanProjectSkills(projectRoot) {
  const out = [];
  if (!projectRoot) return out;
  const skillsRoot = path.join(projectRoot, ".kiro/skills");
  if (!fs.existsSync(skillsRoot)) return out;
  const globalIndex = new Map(scanGlobalSkills().map((s) => [s.name, s]));
  try {
    for (const d of fs.readdirSync(skillsRoot)) {
      const skillDir = path.join(skillsRoot, d);
      if (!fs.statSync(skillDir).isDirectory()) continue;
      const meta = buildSkillMeta(skillDir, "project");
      if (!meta) continue;
      const syncMeta = readSyncMeta(skillDir);
      const sourceSkill = syncMeta ? globalIndex.get(syncMeta.globalSkillId) : globalIndex.get(meta.name);
      const syncStatus = getSyncStatus(sourceSkill?.hash, meta.hash, syncMeta);
      out.push({
        ...meta, projectRoot,
        source: syncMeta ? "global" : "project",
        sourceSkillId: syncMeta?.globalSkillId,
        installedAt: syncMeta?.syncedAt,
        lastSyncedAt: syncMeta?.syncedAt,
        syncStatus,
      });
    }
  } catch {}
  return out;
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name); const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyDirRecursive(sp, dp);
    else if (e.isFile()) fs.copyFileSync(sp, dp);
  }
}

function installGlobalSkillToProject(globalSkillId, projectRoot, overwrite) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const all = scanGlobalSkills();
  const skill = all.find((s) => s.id === globalSkillId || s.name === globalSkillId);
  if (!skill) throw new Error(`global skill not found: ${globalSkillId}`);
  const dst = path.join(projectRoot, ".kiro/skills", path.basename(skill.path));
  if (fs.existsSync(dst) && !overwrite) {
    const syncMeta = readSyncMeta(dst);
    if (!syncMeta) throw new Error("项目已存在同名 Skill 且无 sync meta，默认不覆盖");
  }
  if (fs.existsSync(dst) && overwrite) fs.rmSync(dst, { recursive: true, force: true });
  copyDirRecursive(skill.path, dst);
  const meta = {
    source: "global", globalSkillId: skill.id, globalPath: skill.path,
    syncedAt: Date.now(), sourceHash: skill.hash,
  };
  fs.writeFileSync(path.join(dst, ".cc-haha-sync.json"), JSON.stringify(meta, null, 2));
}

function syncGlobalSkillToProject(globalSkillId, projectRoot, overwrite) {
  // 重新覆盖：把全局最新版本同步到项目
  return installGlobalSkillToProject(globalSkillId, projectRoot, overwrite === undefined ? true : overwrite);
}

// ---------- Kiro ACP Client: SteeringService ----------
function projectSteeringDir(projectRoot) {
  return path.join(projectRoot, ".kiro/steering");
}

function checkSteeringHealth(file, content) {
  const warnings = [];
  if (!file.name.endsWith(".md") && !file.name.endsWith(".markdown")) warnings.push("建议使用 Markdown 文件，便于 Kiro 和用户阅读");
  if (!content.trim()) warnings.push("文件内容为空");
  else if (content.length < 80) warnings.push("内容较短，可能无法形成有效项目规则");
  if (content.length > 12000) warnings.push("内容较长，建议拆成多个 steering 文件");
  return { ...file, status: warnings.length > 0 ? "warning" : "ok", warnings };
}

function buildSteeringMeta(projectRoot, dir, name) {
  const fp = path.join(dir, name);
  const stat = fs.statSync(fp);
  if (!stat.isFile()) return null;
  const content = fs.readFileSync(fp, "utf8");
  // description: 取 frontmatter description 或第一段
  let description = "";
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fm) {
    const m = fm[1].match(/^description\s*:\s*(.+)$/m);
    if (m) description = m[1].replace(/^['"]|['"]$/g, "").trim();
  }
  if (!description) {
    const body = fm ? content.slice(fm[0].length) : content;
    const para = body.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith("#"));
    description = (para || "").trim().slice(0, 200);
  }
  const relativePath = path.relative(projectSteeringDir(projectRoot), fp);
  const meta = {
    id: relativePath,
    name,
    path: fp,
    projectRoot,
    relativePath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    description,
    status: "ok",
    warnings: [],
  };
  return checkSteeringHealth(meta, content);
}

function scanProjectSteering(projectRoot) {
  const out = [];
  if (!projectRoot) return out;
  const dir = projectSteeringDir(projectRoot);
  if (!fs.existsSync(dir)) return out;
  try {
    for (const name of fs.readdirSync(dir)) {
      const meta = buildSteeringMeta(projectRoot, dir, name);
      if (meta) out.push(meta);
    }
  } catch {}
  return out;
}

function readSteeringFile(projectRoot, relativePath) {
  const fp = path.join(projectSteeringDir(projectRoot), relativePath);
  try { return fs.readFileSync(fp, "utf8"); } catch { return ""; }
}

function createSteeringFile(projectRoot, fileName, content) {
  if (!projectRoot || !fileName) throw new Error("projectRoot and fileName are required");
  const dir = projectSteeringDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const safe = fileName.replace(/[^\w.\-一-龥]+/g, "-");
  const finalName = /\.(md|markdown)$/i.test(safe) ? safe : `${safe}.md`;
  const fp = path.join(dir, finalName);
  fs.writeFileSync(fp, content || "");
  return buildSteeringMeta(projectRoot, dir, finalName);
}

function updateSteeringFile(projectRoot, relativePath, content) {
  const fp = path.join(projectSteeringDir(projectRoot), relativePath);
  fs.writeFileSync(fp, content);
  return buildSteeringMeta(projectRoot, path.dirname(fp), path.basename(fp));
}

function deleteSteeringFile(projectRoot, relativePath) {
  const fp = path.join(projectSteeringDir(projectRoot), relativePath);
  try { fs.unlinkSync(fp); } catch {}
}

function openSteeringFolder(projectRoot) {
  const dir = projectSteeringDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (process.platform === "darwin") execSync(`open ${JSON.stringify(dir)}`);
    else if (process.platform === "win32") execSync(`start "" ${JSON.stringify(dir)}`);
    else execSync(`xdg-open ${JSON.stringify(dir)}`);
    return { ok: true, path: dir };
  } catch (e) { return { ok: false, path: dir, error: String(e) }; }
}


// ---------- ACP bridge + WS ----------
import { startAcpBridge, SESSION_META } from "./acp.js";
const wss = new WebSocketServer({ server, path: undefined });
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/\/ws\/([^/]+)/);
  if (!m) { ws.close(); return; }
  const sessionId = decodeURIComponent(m[1]);
  ws.sessionId = sessionId;
  const meta = NEW_SESSIONS.get(sessionId);
  const cwd = meta?.workDir || sessionInfoCwd(sessionId) || HOME;
  // "new-*" ids are in-memory placeholders; if their meta is gone (adapter restarted),
  // start a fresh session instead of trying to load a non-existent conversation (which hangs).
  const resumeId = (meta || sessionId.startsWith("new-")) ? null : sessionId; // else existing kiro conversation → load
  let agent = meta?.agent;
  if (!resumeId && (!agent || agent === "kiro_default")) {
    // Always use kiro-haha agent on new sessions so the skill index in its prompt is loaded.
    // (Was previously only when hooksConfigured(); but skills need this even without hooks.)
    syncSkillIndexToHookAgent();
    agent = ensureHookAgent();
  }
  // Re-read settings from disk so that permissionMode persisted by acp.js (set_permission_mode)
  // is picked up on the next WS connect, even if this server.js process never received the PATCH.
  try { Object.assign(USER_SETTINGS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))); } catch {}
  // Refresh quota on each new WS connect (mirrors kiro IDE: only refresh on session start).
  fetchKiroQuotaOnce();
  startAcpBridge({ ws, sessionId, cwd, model: meta?.model, agent, resumeId, permissionMode: meta?.permissionMode || USER_SETTINGS.permissionMode, kiro: KIRO });
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

// Sync skill discovery into the kiro-haha agent's resources field using kiro's
// official `skill://` URI scheme. This is exactly how kiro IDE / kiro_default agent
// loads skills: progressive disclosure — startup loads only name+description per
// SKILL.md frontmatter; full body loads only when description matches the user's
// request. Near-zero token overhead per turn.
//
// Why we need this: custom agents don't auto-load skills. Our `kiro-haha` is a
// custom agent (we use it for hooks). Without this, users see "skill not found".
function syncSkillIndexToHookAgent() {
  try {
    ensureHookAgent();
    const agent = readHookAgent();
    const wantResources = [
      "skill://.kiro/skills/*/SKILL.md",
      "skill://~/.kiro/skills/*/SKILL.md",
    ];
    const cur = Array.isArray(agent.resources) ? agent.resources : [];
    // Strip any prior full-text skill index from prompt (cleanup from earlier impl).
    if (typeof agent.prompt === "string" && agent.prompt.includes(SKILL_INDEX_START)) {
      agent.prompt = agent.prompt.replace(new RegExp(SKILL_INDEX_START + "[\\s\\S]*?" + SKILL_INDEX_END), "").trim() || null;
    }
    // Merge skill:// URIs into resources without duplicates.
    const next = [...cur.filter((r) => !wantResources.includes(r)), ...wantResources];
    if (JSON.stringify(next) === JSON.stringify(cur) && agent.prompt === readHookAgent().prompt) return;
    agent.resources = next;
    fs.writeFileSync(HOOK_AGENT_FILE, JSON.stringify(agent, null, 2));
    console.log(`[adapter] kiro-haha agent.resources synced (${next.length} entries)`);
  } catch (e) { console.warn("[adapter] skill resources sync failed:", e?.message || e); }
}
const SKILL_INDEX_START = "<!-- KIRO-HAHA-SKILL-INDEX-START -->";
const SKILL_INDEX_END = "<!-- KIRO-HAHA-SKILL-INDEX-END -->";
syncSkillIndexToHookAgent();
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

// ─── git branches + worktrees (multi-tab branch isolation) ────────
//
// We model each tab's session as a session-cwd. Two tabs working on the
// same repo but different branches must use separate worktrees so their
// `git status` / file edits don't bleed across each other.
//
// Convention (matches cc-haha): worktree path = <repoRoot>/.claude/worktrees/<slug>

const WORKTREE_DIR = ".claude/worktrees";

function gitRepoRoot(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  try {
    return execSync(`git -C ${JSON.stringify(cwd)} rev-parse --show-toplevel`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch { return null; }
}

function gitBranches(cwd) {
  // Returns RepositoryBranchInfo[]:
  //   { name, current, local, remote, remoteRef?, checkedOut, worktreePath? }
  const repoRoot = gitRepoRoot(cwd);
  if (!repoRoot) return [];
  let raw = "";
  try {
    raw = execSync(
      `git -C ${JSON.stringify(repoRoot)} for-each-ref --format='%(HEAD)|%(refname:short)|%(refname)|%(upstream:short)|%(worktreepath)' refs/heads refs/remotes`,
      { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 * 1024 * 1024 },
    ).toString();
  } catch { return []; }

  const map = new Map(); // name -> RepositoryBranchInfo
  for (const line0 of raw.split("\n")) {
    // for-each-ref --format='X' wraps each row in single quotes; strip them.
    const line = line0.replace(/^'/, "").replace(/'$/, "").trim();
    if (!line) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const head = parts[0];
    const shortName = parts[1];
    const refname = parts[2];
    const upstream = parts[3];
    const worktreePath = parts[4];

    if (!shortName) continue;
    const isRemote = refname.startsWith("refs/remotes/");
    if (isRemote) {
      // skip HEAD aliases — refname looks like 'refs/remotes/origin/HEAD',
      // shortName is 'origin' (not 'origin/HEAD'), so we must check refname.
      if (refname.endsWith("/HEAD")) continue;
      // For remote-only branches, store under the local-equivalent name
      // (so feat-A from origin/feat-A shows up as a selectable branch).
      const localEquiv = shortName.replace(/^[^/]+\//, "");
      const existing = map.get(localEquiv);
      if (existing) {
        existing.remote = true;
        existing.remoteRef = shortName;
      } else {
        map.set(localEquiv, {
          name: localEquiv,
          current: false,
          local: false,
          remote: true,
          remoteRef: shortName,
          checkedOut: false,
        });
      }
    } else {
      // Local branch
      const existing = map.get(shortName);
      const info = existing || {
        name: shortName,
        current: false,
        local: false,
        remote: false,
        checkedOut: false,
      };
      info.local = true;
      info.current = head === "*";
      info.checkedOut = !!worktreePath;
      if (worktreePath) info.worktreePath = worktreePath;
      if (upstream) info.remoteRef = upstream;
      map.set(shortName, info);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.local !== b.local) return a.local ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function gitWorktrees(cwd) {
  // Returns RepositoryWorktreeInfo[]: { path, branch, current }
  const repoRoot = gitRepoRoot(cwd);
  if (!repoRoot) return [];
  let raw = "";
  try {
    raw = execSync(`git -C ${JSON.stringify(repoRoot)} worktree list --porcelain`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch { return []; }
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.path) out.push({ path: cur.path, branch: cur.branch || null, current: !!cur.current });
    cur = null;
  };
  // The cwd we started from belongs to one of these worktrees.
  const cwdAbs = path.resolve(cwd);
  for (const line of raw.split("\n")) {
    if (!line) { flush(); continue; }
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice("worktree ".length).trim() };
      cur.current = path.resolve(cur.path) === cwdAbs;
    } else if (cur && line.startsWith("branch ")) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
    // detached / bare / locked lines we don't care about for now
  }
  flush();
  return out;
}

function branchSlug(branch) {
  return String(branch || "").trim().replace(/[\s/\\:]+/g, "-").replace(/^-+|-+$/g, "") || "branch";
}

// Materialize a worktree for `branch` under `<repoRoot>/.claude/worktrees/<slug>`.
// Idempotent: if a worktree for that branch already exists anywhere, reuse it.
// Returns { ok: true, worktreePath } or { ok: false, error }.
function ensureWorktree(repoRoot, branch) {
  if (!repoRoot || !branch) return { ok: false, error: "missing repoRoot or branch" };
  // 1) Reuse existing worktree for this branch if any (anywhere on disk).
  const existing = gitWorktrees(repoRoot).find((w) => w.branch === branch && fs.existsSync(w.path));
  if (existing) return { ok: true, worktreePath: existing.path, reused: true };

  // 2) Reserve target dir <repoRoot>/.claude/worktrees/<slug>
  const targetBase = path.join(repoRoot, WORKTREE_DIR);
  fs.mkdirSync(targetBase, { recursive: true });
  let target = path.join(targetBase, branchSlug(branch));
  let suffix = 0;
  while (fs.existsSync(target)) {
    suffix += 1;
    target = path.join(targetBase, `${branchSlug(branch)}-${suffix}`);
    if (suffix > 50) return { ok: false, error: "could not reserve worktree path (too many collisions)" };
  }

  // 3) Decide whether `branch` exists locally / on origin / not at all.
  const branches = gitBranches(repoRoot);
  const local = branches.find((b) => b.name === branch && b.local);
  const remoteOnly = !local && branches.find((b) => b.name === branch && b.remote);

  let cmd;
  if (local) {
    cmd = `git -C ${JSON.stringify(repoRoot)} worktree add ${JSON.stringify(target)} ${JSON.stringify(branch)}`;
  } else if (remoteOnly && remoteOnly.remoteRef) {
    // create local branch tracking the remote ref
    cmd = `git -C ${JSON.stringify(repoRoot)} worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(target)} ${JSON.stringify(remoteOnly.remoteRef)}`;
  } else {
    // Brand new branch — create from current HEAD.
    cmd = `git -C ${JSON.stringify(repoRoot)} worktree add -b ${JSON.stringify(branch)} ${JSON.stringify(target)}`;
  }

  try {
    execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, worktreePath: target, reused: false };
  } catch (e) {
    const stderr = (e.stderr ? e.stderr.toString() : "") || (e.stdout ? e.stdout.toString() : "") || String(e?.message || e);
    return { ok: false, error: stderr.trim().slice(0, 300) };
  }
}

function workspace(kind, cwd, rel, sessionId) {
  let abs = rel ? (path.isAbsolute(rel) ? rel : path.join(cwd || HOME, rel)) : (cwd || HOME);
  // Fallback: if relative path resolved against cwd doesn't exist (e.g. cli session cwd=HOME but
  // file actually lives elsewhere), scan the session's jsonl for a tool_use path that endsWith(rel).
  if (rel && !path.isAbsolute(rel) && !fs.existsSync(abs) && sessionId) {
    try {
      const all = messagesFromJsonl(sessionId);
      const want = "/" + rel.replace(/^\.?\//, "");
      let found = null;
      // Prefer the most recent matching path.
      for (let i = all.length - 1; i >= 0 && !found; i--) {
        const m = all[i];
        if (m.type !== "assistant" || !Array.isArray(m.content)) continue;
        for (const b of m.content) {
          if (b?.type !== "tool_use") continue;
          const p = (typeof b.input?.path === "string" && b.input.path)
            || (typeof b.input?.file_path === "string" && b.input.file_path)
            || null;
          if (p && (p === abs || p.endsWith(want) || p.endsWith("/" + rel))) { found = p; break; }
        }
      }
      if (found) abs = found;
    } catch {}
  }
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
      if (st.size > 5 * 1024 * 1024) return { state: "too_large", path: abs, language: "", size: st.size };
      const ext = path.extname(abs).toLowerCase();
      const lang = ext.slice(1) || "text";
      // Image: read binary, base64 → data URL.
      const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".bmp": "image/bmp" };
      if (IMAGE_MIME[ext]) {
        const buf = fs.readFileSync(abs);
        const dataUrl = `data:${IMAGE_MIME[ext]};base64,${buf.toString("base64")}`;
        return { state: "ok", path: abs, previewType: "image", dataUrl, mimeType: IMAGE_MIME[ext], language: lang, size: st.size };
      }
      // Non-text binary: don't try to read as utf8.
      const BINARY_EXT = new Set([".pdf",".zip",".tar",".gz",".tgz",".bz2",".xz",".7z",".rar",
        ".exe",".dll",".so",".dylib",".bin",".dat",".db",".sqlite",".sqlite3",
        ".woff",".woff2",".ttf",".otf",".eot",".mp3",".mp4",".mov",".avi",".mkv",
        ".wav",".flac",".ogg",".webm",".pptx",".docx",".xlsx",".odt",".ods",".odp",
        ".class",".jar",".pyc",".pyo",".o",".a",".lib",".pdb",".node"]);
      if (BINARY_EXT.has(ext)) {
        return { state: "binary", path: abs, language: lang, size: st.size };
      }
      // Default: utf8 text.
      const content = fs.readFileSync(abs, "utf8");
      return { state: "ok", path: abs, previewType: "text", content, language: lang, size: st.size };
    } catch { return { state: "missing", path: abs, language: "", size: 0 }; }
  }
  if (kind === "diff") {
    // Find the git repo root by walking up from the file's directory.
    // Don't trust session cwd — cli sessions may have cwd=HOME while the file lives elsewhere.
    let repoRoot = null;
    try {
      const startDir = fs.existsSync(abs) ? (fs.statSync(abs).isDirectory() ? abs : path.dirname(abs)) : path.dirname(abs);
      repoRoot = execSync(`git -C ${JSON.stringify(startDir)} rev-parse --show-toplevel`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {}
    if (repoRoot) {
      try {
        const diff = execSync(`git -C ${JSON.stringify(repoRoot)} diff HEAD -- ${JSON.stringify(abs)}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
        if (diff.trim()) return { state: "ok", path: abs, diff };
        // Fall through to jsonl fallback if git diff is empty (file unchanged in git).
      } catch {}
    }
    // Non-git fallback: synthesize a unified-style diff from this session's strReplace tool history.
    // Lets the user see what the agent changed even when the workspace isn't tracked by git.
    if (sessionId) {
      try {
        const all = messagesFromJsonl(sessionId);
        const blocks = [];
        let blockIdx = 0;
        for (const m of all) {
          if (m.type !== "assistant" || !Array.isArray(m.content)) continue;
          for (const b of m.content) {
            if (b?.type !== "tool_use") continue;
            const inp = b.input || {};
            if (inp.command !== "strReplace") continue;
            const p = inp.path || inp.file_path;
            if (!p || (p !== abs && !p.endsWith("/" + (rel || "").replace(/^\.?\//, "")))) continue;
            const oldStr = inp.oldStr || inp.old_str || inp.old_string || "";
            const newStr = inp.newStr || inp.new_str || inp.new_string || "";
            if (!oldStr && !newStr) continue;
            blockIdx++;
            const oldLines = oldStr.split("\n");
            const newLines = newStr.split("\n");
            blocks.push(
              `@@ edit ${blockIdx} @@\n` +
              oldLines.map((l) => "-" + l).join("\n") + "\n" +
              newLines.map((l) => "+" + l).join("\n")
            );
          }
        }
        if (blocks.length > 0) {
          const diff = `--- a/${rel || path.basename(abs)} (会话历史 ${blocks.length} 处修改)\n+++ b/${rel || path.basename(abs)}\n` + blocks.join("\n");
          return { state: "ok", path: abs, diff };
        }
      } catch {}
    }
    return { state: "not_git_repo", path: abs };
  }
  return { state: "error", path: abs, error: "unknown workspace resource" };
}

function sessionInfoCwd(id) {
  if (!id) return null;
  // 1) Check conversations_v2 (legacy / TUI sessions)
  const rows = sqlite(`SELECT key AS cwd FROM conversations_v2 WHERE conversation_id='${id.replace(/'/g, "")}' LIMIT 1`);
  if (rows[0]?.cwd) return rows[0].cwd;
  // 2) Check ~/.kiro/sessions/cli/<id>.json (ACP / kiro-haha sessions)
  try {
    const fp = path.join(CLI_SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(fp)) {
      const fd = fs.openSync(fp, "r"); const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, 2048, 0); fs.closeSync(fd);
      const head = buf.toString("utf8", 0, n);
      const m = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return m[1].replace(/\\"/g, '"');
    }
  } catch {}
  return null;
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

// ---------- Preview static file helper ----------
const PREVIEW_MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf":  "font/ttf",
};
function previewMimeOf(p) {
  return PREVIEW_MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}
function servePreviewFile(res, requestedPath, sandboxRoot) {
  // Sandbox: realpath both, refuse if target escapes sandboxRoot.
  let target = path.resolve(requestedPath);
  let rootResolved;
  try { rootResolved = fs.realpathSync(path.resolve(sandboxRoot)); }
  catch { res.writeHead(500); return res.end("sandbox root unreadable"); }
  // Allow target itself to not exist yet—still must lexically be inside root.
  if (!(target === rootResolved || target.startsWith(rootResolved + path.sep))) {
    res.writeHead(403); return res.end("path outside sandbox");
  }
  // After existence check, resolve symlinks and re-verify.
  let st;
  try { st = fs.statSync(target); }
  catch { res.writeHead(404); return res.end("not found"); }
  if (st.isDirectory()) target = path.join(target, "index.html");
  let realTarget;
  try { realTarget = fs.realpathSync(target); }
  catch { res.writeHead(404); return res.end("not found"); }
  if (!(realTarget === rootResolved || realTarget.startsWith(rootResolved + path.sep))) {
    res.writeHead(403); return res.end("symlink outside sandbox");
  }
  let content;
  try { content = fs.readFileSync(realTarget); }
  catch { res.writeHead(404); return res.end("not readable"); }
  res.writeHead(200, {
    "content-type": previewMimeOf(realTarget),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(content);
}
