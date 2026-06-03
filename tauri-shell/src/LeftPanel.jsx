import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function timeAgo(ms) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function HistoryView({ onResume }) {
  const [sessions, setSessions] = useState([]);
  const [filter, setFilter] = useState("");

  const load = () => invoke("list_all_sessions").then(setSessions);
  useEffect(() => {
    load();
  }, []);

  async function del(s, e) {
    e.stopPropagation();
    await invoke("delete_session", { cwd: s.cwd, id: s.id });
    load();
  }

  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(filter.toLowerCase()) ||
      s.cwd.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="lp-view">
      <div className="lp-header">
        <span>History ({sessions.length})</span>
        <button onClick={load} title="Refresh">⟳</button>
      </div>
      <input
        className="lp-search"
        placeholder="Search sessions..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="lp-list">
        {filtered.map((s) => (
          <div key={s.id} className="hist-item" onClick={() => onResume(s)}>
            <div className="hist-title">{s.title}</div>
            <div className="hist-meta">
              <span className="hist-cwd">{s.cwd.split("/").slice(-2).join("/")}</span>
              <span>{s.msgCount} msgs · {timeAgo(s.updatedAt)}</span>
            </div>
            <span className="hist-del" onClick={(e) => del(s, e)}>🗑</span>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty">No sessions</div>}
      </div>
    </div>
  );
}

export function McpView() {
  const [servers, setServers] = useState([]);
  const load = () => invoke("mcp_list").then(setServers);
  useEffect(() => {
    load();
  }, []);

  async function toggle(s) {
    await invoke("mcp_toggle", { name: s.name, disabled: !s.disabled });
    load();
  }
  async function remove(s, e) {
    e.stopPropagation();
    if (confirm(`Remove MCP server "${s.name}"?`)) {
      await invoke("mcp_remove", { name: s.name });
      load();
    }
  }

  const enabled = servers.filter((s) => !s.disabled).length;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", transport: "stdio", command: "", args: "", url: "", env: "" });

  async function addServer() {
    try {
      await invoke("mcp_add", { ...form });
      setAdding(false);
      setForm({ name: "", transport: "stdio", command: "", args: "", url: "", env: "" });
      load();
    } catch (e) { alert(e); }
  }

  return (
    <div className="lp-view">
      <div className="lp-header">
        <span>MCP Servers ({enabled}/{servers.length})</span>
        <span>
          <button onClick={() => setAdding((a) => !a)} title="Add" style={{ marginRight: 8 }}>＋</button>
          <button onClick={load} title="Refresh">⟳</button>
        </span>
      </div>
      {adding && (
        <div className="mcp-form">
          <input placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
          {form.transport === "stdio" ? (
            <>
              <input placeholder="命令 (如 npx)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              <input placeholder="参数 (空格分隔)" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} />
            </>
          ) : (
            <input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          )}
          <textarea placeholder="环境变量 KEY=VAL 每行一个" rows={2} value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} />
          <div className="mcp-form-actions">
            <button className="secondary" onClick={() => setAdding(false)}>取消</button>
            <button className="primary" onClick={addServer}>添加</button>
          </div>
        </div>
      )}
      <div className="lp-list">
        {servers.map((s) => (
          <div key={s.name} className={`mcp-item ${s.disabled ? "disabled" : ""}`}>
            <div className="mcp-main">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={!s.disabled}
                  onChange={() => toggle(s)}
                />
                <span className="slider" />
              </label>
              <div className="mcp-info">
                <div className="mcp-name">{s.name}</div>
                <div className="mcp-sub">
                  {s.type === "http" ? "HTTP" : s.command || "stdio"}
                  {s.envKeys.length > 0 && ` · ${s.envKeys.length} env`}
                </div>
              </div>
              <span className="mcp-del" onClick={(e) => remove(s, e)}>🗑</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkillsView() {
  const [skills, setSkills] = useState([]);
  const [active, setActive] = useState(null);
  const [content, setContent] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    invoke("list_skills").then(setSkills);
  }, []);

  async function view(s) {
    setActive(s.name);
    const c = await invoke("read_file", { path: s.path });
    setContent(c);
  }

  const filtered = skills.filter((s) =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.description || "").toLowerCase().includes(q.toLowerCase())
  );
  const tokens = skills.reduce((a, s) => a + Math.round(((s.description || "").length + 200) / 4), 0);

  return (
    <div className="lp-view">
      <div className="skill-browser">
        <div className="skill-browser-title">✦ 浏览已安装技能</div>
        <div className="skill-browser-sub">查看内置、项目和用户技能，打开技能目录阅读文档。</div>
        <input className="skill-search" placeholder="搜索技能名称、描述或来源..." value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="skill-stats">
          <div className="skill-stat"><div className="ss-label">✦ 技能总数</div><div className="ss-val">{skills.length}</div></div>
          <div className="skill-stat"><div className="ss-label">◈ 来源类型</div><div className="ss-val">1</div></div>
          <div className="skill-stat"><div className="ss-label">≡ 预估 TOKENS</div><div className="ss-val">约 {tokens}</div></div>
        </div>
      </div>
      <div className="skill-group-head">👤 用户 {filtered.length}</div>
      <div className="lp-list">
        {filtered.map((s) => (
          <div
            key={s.name}
            className={`skill-item ${active === s.name ? "active" : ""}`}
            onClick={() => view(s)}
          >
            <div className="skill-name-row">
              <span className="skill-name">✦ {s.name}</span>
              <span className="skill-badge">/斜杠命令</span>
            </div>
            <div className="skill-desc">{s.description}</div>
            <div className="skill-meta">用户 · 约 {Math.round(((s.description || "").length + 200) / 4)} · 可查看</div>
          </div>
        ))}
      </div>
      {active && (
        <div className="skill-detail">
          <div className="skill-detail-head">
            {active}
            <button onClick={() => setActive(null)}>×</button>
          </div>
          <pre>{content}</pre>
        </div>
      )}
    </div>
  );
}
