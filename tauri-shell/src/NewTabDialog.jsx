import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export default function NewTabDialog({ onCreate, onCancel }) {
  const [cwd, setCwd] = useState("");
  const [models, setModels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [model, setModel] = useState("auto");
  const [agent, setAgent] = useState("kiro_default");

  useEffect(() => {
    invoke("list_models").then(setModels);
    invoke("list_agents").then(setAgents);
  }, []);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) setCwd(selected);
  }

  function create() {
    if (!cwd) {
      pickFolder();
      return;
    }
    onCreate({ cwd, model, agent });
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>New Session</h3>

        <label>Working Directory</label>
        <div className="folder-row">
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Select a project folder..."
          />
          <button onClick={pickFolder}>Browse</button>
        </div>

        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.credits})
            </option>
          ))}
        </select>

        <label>Agent</label>
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <div className="dialog-actions">
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" onClick={create} disabled={!cwd}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
