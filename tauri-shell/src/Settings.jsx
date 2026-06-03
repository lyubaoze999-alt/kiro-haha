import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { McpView, SkillsView } from "./LeftPanel";

const NAV = [
  { id: "general", icon: "⚙", label: "通用" },
  { id: "models", icon: "✦", label: "模型" },
  { id: "mcp", icon: "🔌", label: "MCP" },
  { id: "skills", icon: "⚡", label: "Skills" },
  { id: "agents", icon: "🤖", label: "Agents" },
  { id: "about", icon: "ⓘ", label: "关于" },
];

export default function Settings({ onClose }) {
  const [tab, setTab] = useState("general");
  return (
    <div className="settings-page">
      <div className="settings-nav">
        <div className="settings-nav-head">
          <span>设置</span>
          <button onClick={onClose}>×</button>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`settings-nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
            <span className="sn-ico">{n.icon}</span> {n.label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {tab === "general" && <General />}
        {tab === "models" && <Models />}
        {tab === "mcp" && <McpView />}
        {tab === "skills" && <SkillsView />}
        {tab === "agents" && <Agents />}
        {tab === "about" && <About />}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="settings-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function General() {
  return (
    <Section title="通用">
      <div className="set-row"><span>主题</span><span className="set-val">浅色（cc-haha 暖色）</span></div>
      <div className="set-row"><span>语言</span><span className="set-val">简体中文</span></div>
      <div className="set-row"><span>CLI 路径</span><span className="set-val">/Users/lvbaoze/.local/bin/kiro-cli</span></div>
    </Section>
  );
}

function Models() {
  const [models, setModels] = useState([]);
  useEffect(() => { invoke("list_models").then(setModels); }, []);
  return (
    <Section title="可用模型">
      {models.map((m) => (
        <div className="set-row" key={m.id}>
          <span>{m.name}</span>
          <span className="set-val">{m.credits}</span>
        </div>
      ))}
    </Section>
  );
}

function Agents() {
  const [agents, setAgents] = useState([]);
  useEffect(() => { invoke("list_agents").then(setAgents); }, []);
  return (
    <Section title="Agents">
      {agents.map((a) => (
        <div className="set-row" key={a}><span>🤖 {a}</span></div>
      ))}
    </Section>
  );
}

function About() {
  return (
    <Section title="关于">
      <div className="set-row"><span>Kiro GUI</span><span className="set-val">v0.1.0</span></div>
      <div className="set-row"><span>引擎</span><span className="set-val">Kiro CLI · ACP 协议</span></div>
    </Section>
  );
}
