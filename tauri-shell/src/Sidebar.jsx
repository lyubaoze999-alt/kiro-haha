import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

function timeAgo(ms) {
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

function projectName(cwd) {
  if (!cwd || cwd === "/") return "(root)";
  return cwd.split("/").filter(Boolean).pop() || cwd;
}

export default function Sidebar({ activeTab, onResume, onNew, onOpenSettings }) {
  const [sessions, setSessions] = useState([]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());

  const load = useCallback(() => invoke("list_all_sessions").then(setSessions), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function del(s, e) {
    e.stopPropagation();
    await invoke("delete_session", { cwd: s.cwd, id: s.id });
    load();
  }

  const groups = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = sessions.filter(
      (s) => !q || (s.title || "").toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)
    );
    const map = new Map();
    for (const s of filtered) {
      if (!map.has(s.cwd)) map.set(s.cwd, []);
      map.get(s.cwd).push(s);
    }
    // sort groups by most recent session
    return [...map.entries()]
      .map(([cwd, list]) => ({ cwd, list, latest: Math.max(...list.map((x) => x.updatedAt)) }))
      .sort((a, b) => b.latest - a.latest);
  }, [sessions, query]);

  function toggle(cwd) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(cwd) ? next.delete(cwd) : next.add(cwd);
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="sb-top">
        <span className="sb-logo"><span className="spark">✦</span> Kiro GUI</span>
        <span className="sb-collapse">‹</span>
      </div>

      <button className="sb-rowbtn" onClick={onNew}>
        <span className="rb-ico">＋</span> 新建会话
      </button>
      <button className="sb-rowbtn" onClick={onOpenSettings}>
        <span className="rb-ico">⏱</span> 定时任务
      </button>

      <div className="sb-search">
        <span className="icon">⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话..."
        />
      </div>

      <div className="sb-projects-label">项目</div>

      <div className="sb-list">
        {groups.length === 0 && <div className="sb-empty">暂无会话</div>}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.cwd);
          return (
            <div className="sb-group" key={g.cwd}>
              <div className="sb-group-head" onClick={() => toggle(g.cwd)}>
                <span className={`chev ${isCollapsed ? "collapsed" : ""}`}>▾</span>
                <span className="sb-group-name" title={g.cwd}>📁 {projectName(g.cwd)}</span>
                <span className="sb-group-count">{g.list.length}</span>
              </div>
              {!isCollapsed &&
                g.list.map((s) => (
                  <div
                    key={s.id}
                    className={`sb-item ${activeTab?.resumeId === s.id ? "active" : ""}`}
                    onClick={() => onResume(s)}
                  >
                    <div className="sb-item-title">{s.title || "(无标题)"}</div>
                    <div className="sb-item-meta">{s.msgCount} 条 · {timeAgo(s.updatedAt)}</div>
                    <span className="sb-item-del" onClick={(e) => del(s, e)}>🗑</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      <div className="sb-footer2">
        <button className="sb-foot2" onClick={onOpenSettings}><span className="ico">⚙</span> 设置</button>
        <button className="sb-foot2" onClick={onOpenSettings}><span className="ico">ⓘ</span> 关于</button>
      </div>
    </aside>
  );
}
