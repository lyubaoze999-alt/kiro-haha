import { useState } from "react";
import ChatView from "./ChatView";
import NewTabDialog from "./NewTabDialog";
import SidePanel from "./SidePanel";
import Sidebar from "./Sidebar";
import Settings from "./Settings";
import "./App.css";

let counter = 0;

function App() {
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  function createTab({ cwd, model, agent, resumeId, name }) {
    const id = `tab-${Date.now()}-${counter++}`;
    const tab = { id, cwd, model, agent, resumeId, name: name || cwd.split("/").pop() || "session" };
    setTabs((p) => [...p, tab]);
    setActiveId(id);
    setShowDialog(false);
  }

  function resumeSession(s) {
    // reuse existing tab if already open for this session
    const existing = tabs.find((t) => t.resumeId === s.id);
    if (existing) { setActiveId(existing.id); return; }
    createTab({ cwd: s.cwd, model: "auto", agent: "kiro_default", resumeId: s.id, name: (s.title || "会话").slice(0, 18) });
  }

  function closeTab(id, e) {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next.length ? next[next.length - 1].id : null);
      return next;
    });
  }

  const activeTab = tabs.find((t) => t.id === activeId);

  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        onResume={resumeSession}
        onNew={() => setShowDialog(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="main">
        <div className="tab-bar">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab ${activeId === t.id ? "active" : ""}`}
              onClick={() => setActiveId(t.id)}
            >
              <span className="tab-dot" />
              <span className="tab-name">{t.name}</span>
              <span className="tab-close" onClick={(e) => closeTab(t.id, e)}>×</span>
            </div>
          ))}
          {tabs.length > 0 && (
            <button
              className="tab"
              style={{ background: "transparent" }}
              onClick={() => setShowPanel((p) => !p)}
              title="切换右侧面板"
            >
              {showPanel ? "▶" : "◀"} 面板
            </button>
          )}
        </div>

        <div className="content">
          {tabs.length === 0 && (
            <div className="welcome">
              <div className="big">✦</div>
              <h2>Kiro GUI</h2>
              <p>新建会话，或从左侧恢复历史会话</p>
              <button className="primary" onClick={() => setShowDialog(true)}>新建会话</button>
            </div>
          )}
          {tabs.map((t) => (
            <div key={t.id} style={{ position: "absolute", inset: 0, display: t.id === activeId ? "flex" : "none" }}>
              <ChatView tab={t} active={t.id === activeId} />
              {showPanel && <SidePanel cwd={t.cwd} />}
            </div>
          ))}
        </div>
      </div>

      {showDialog && <NewTabDialog onCreate={createTab} onCancel={() => setShowDialog(false)} />}

      {showSettings && (
        <div className="overlay-panel" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <Settings onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
