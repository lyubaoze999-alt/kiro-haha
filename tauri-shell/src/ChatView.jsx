import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";

marked.setOptions({ breaks: true });
const md = (t) => ({ __html: marked.parse(t || "") });

function contentToText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => c?.content?.text ?? c?.text ?? (typeof c === "string" ? c : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// Message shape:
// { role:'user'|'assistant', kind:'text'|'tool'|'thought', text, toolName, toolStatus, toolId }
export default function ChatView({ tab, active }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState([]);
  const [curModel, setCurModel] = useState(tab.model || "auto");
  const [modelOpen, setModelOpen] = useState(false);
  const [autoAccept, setAutoAccept] = useState(true);
  const [commands, setCommands] = useState([]);
  const [slashSel, setSlashSel] = useState(0);
  const endRef = useRef(null);
  const msgsRef = useRef([]);
  const spawnedRef = useRef(false);
  const acpSidRef = useRef(tab.resumeId || "");

  const setMsgs = (updater) => {
    msgsRef.current = typeof updater === "function" ? updater(msgsRef.current) : updater;
    setMessages(msgsRef.current);
  };

  // Append/replace streaming assistant text into the last assistant text block
  const appendText = useCallback((delta, kind = "text") => {
    setMsgs((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.kind === kind && last.streaming) {
        next[next.length - 1] = { ...last, text: last.text + delta };
      } else {
        next.push({ role: "assistant", kind, text: delta, streaming: true });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (spawnedRef.current) return;
    spawnedRef.current = true;
    let unUpdate, unDone, unExit, unMeta;

    (async () => {
      unUpdate = await listen(`acp:update:${tab.id}`, (e) => {
        const u = e.payload;
        const t = u.sessionUpdate;
        if (t === "agent_message_chunk") {
          const txt = u.content?.text ?? "";
          if (txt) appendText(txt, "text");
        } else if (t === "user_message_chunk") {
          const txt = u.content?.text ?? "";
          if (txt) setMsgs((prev) => {
            const next = prev.map((x) => (x.streaming ? { ...x, streaming: false } : x));
            const last = next[next.length - 1];
            if (last && last.role === "user" && last.streaming2) {
              next[next.length - 1] = { ...last, text: last.text + txt };
            } else {
              next.push({ role: "user", kind: "text", text: txt, streaming2: true });
            }
            return next;
          });
        } else if (t === "agent_thought_chunk") {
          const txt = u.content?.text ?? "";
          if (txt) appendText(txt, "thought");
        } else if (t === "tool_call") {
          setStatus("Running tool");
          setMsgs((prev) => [
            ...prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
            {
              role: "assistant",
              kind: "tool",
              toolId: u.toolCallId,
              toolName: u.title || u.kind || "tool",
              toolKind: u.kind || "",
              toolStatus: u.status || "pending",
              toolInput: u.rawInput || null,
              toolContent: contentToText(u.content),
            },
          ]);
        } else if (t === "tool_call_update") {
          setMsgs((prev) =>
            prev.map((m) => {
              if (m.kind !== "tool" || m.toolId !== u.toolCallId) return m;
              const out = contentToText(u.content);
              return {
                ...m,
                toolStatus: u.status || m.toolStatus,
                toolInput: u.rawInput || m.toolInput,
                toolContent: out || m.toolContent,
              };
            })
          );
        } else if (t === "plan") {
          setStatus("Planning");
        }
      });

      unDone = await listen(`acp:done:${tab.id}`, () => {
        setMsgs((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
        setBusy(false);
        setStatus("");
      });

      unExit = await listen(`acp:exit:${tab.id}`, () => {
        setReady(false);
        setStatus("session ended");
      });

      unMeta = await listen(`acp:meta:${tab.id}`, (e) => {
        const v = e.payload;
        if (v?.method === "_kiro.dev/commands/available" && Array.isArray(v.params?.commands)) {
          setCommands(v.params.commands);
        }
      });

      try {
        setStatus("Starting Kiro...");
        invoke("list_models").then(setModels);
        const sid = await invoke("acp_spawn", {
          opts: { tab_id: tab.id, cwd: tab.cwd, model: curModel || null, agent: tab.agent || null, resume_id: tab.resumeId || null },
        });
        if (sid) acpSidRef.current = sid;
        setReady(true);
        setStatus("");
      } catch (err) {
        setStatus(`Failed: ${err}`);
      }
    })();

    return () => {
      unUpdate && unUpdate();
      unMeta && unMeta();
      unDone && unDone();
      unExit && unExit();
      invoke("acp_kill", { tabId: tab.id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, active]);

  function send() {
    if (!input.trim() || busy || !ready) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setStatus("Thinking");
    setMsgs((prev) => [...prev, { role: "user", kind: "text", text }]);
    invoke("acp_prompt", { tabId: tab.id, text });
  }

  function cancel() {
    invoke("acp_cancel", { tabId: tab.id });
    setBusy(false);
    setStatus("");
  }

  async function attachFile() {
    const sel = await open({ multiple: false });
    if (sel) setInput((v) => (v ? v + " " : "") + `@${sel} `);
  }

  function runSlash(cmd) {
    if (!cmd) return;
    const text = cmd.name;
    setInput("");
    setSlashSel(0);
    setBusy(true);
    setStatus(cmd.name.slice(1));
    setMsgs((prev) => [...prev, { role: "user", kind: "text", text }]);
    invoke("acp_prompt", { tabId: tab.id, text });
  }

  async function switchModel(id) {
    setModelOpen(false);
    if (id === curModel) return;
    setCurModel(id);
    setReady(false);
    setStatus("切换模型...");
    await invoke("acp_kill", { tabId: tab.id });
    try {
      const sid = await invoke("acp_spawn", {
        opts: { tab_id: tab.id, cwd: tab.cwd, model: id, agent: tab.agent || null, resume_id: acpSidRef.current || null },
      });
      if (sid) acpSidRef.current = sid;
      setReady(true);
      setStatus("");
    } catch (err) {
      setStatus(`Failed: ${err}`);
    }
  }

  return (
    <div className="chat-view" style={{ display: active ? "flex" : "none" }}>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-hint">
            <div className="chat-logo">✦</div>
            <div className="chat-cwd">{tab.cwd}</div>
            <div className="chat-sub">{tab.model} · {tab.agent}</div>
          </div>
        )}
        {messages.map((m, i) => <Block key={i} m={m} />)}
        {busy && (
          <div className="stream-pill">
            <span className="sparkle">✦</span>
            <span>{status || "Working"}...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        {input.startsWith("/") && (() => {
          const q = input.slice(1).toLowerCase();
          const list = commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(q));
          if (list.length === 0) return null;
          return (
            <div className="slash-menu">
              {list.slice(0, 8).map((c, i) => (
                <div
                  key={c.name}
                  className={`slash-item ${i === slashSel ? "active" : ""}`}
                  onMouseEnter={() => setSlashSel(i)}
                  onClick={() => runSlash(c)}
                >
                  <span className="slash-name">{c.name}</span>
                  <span className="slash-desc">{c.description}</span>
                </div>
              ))}
            </div>
          );
        })()}
        <textarea
          className="composer-input"
          value={input}
          onChange={(e) => { setInput(e.target.value); setSlashSel(0); }}
          onKeyDown={(e) => {
            const slashList = input.startsWith("/")
              ? commands.filter((c) => c.name.slice(1).toLowerCase().startsWith(input.slice(1).toLowerCase()))
              : [];
            if (slashList.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => Math.min(s + 1, slashList.length - 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => Math.max(s - 1, 0)); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runSlash(slashList[slashSel]); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={ready ? "让 Kiro 编辑、调试或解释代码... (输入 / 查看命令)" : "正在启动会话..."}
          disabled={!ready}
          rows={2}
        />
        <div className="composer-bar">
          <button className="comp-icon" title="附件" onClick={attachFile}>＋</button>
          <button
            className="comp-chip"
            onClick={() => setAutoAccept((v) => !v)}
            title="工具执行模式"
          >
            {autoAccept ? "⚡ 自动接受" : "✋ 手动确认"}
          </button>
          <div className="comp-spacer" />
          <div className="comp-model-wrap">
            <button className="comp-model" onClick={() => setModelOpen((o) => !o)}>
              {curModel} ▾
            </button>
            {modelOpen && (
              <div className="comp-model-menu">
                {models.map((m) => (
                  <div
                    key={m.id}
                    className={`comp-model-item ${m.id === curModel ? "active" : ""}`}
                    onClick={() => switchModel(m.id)}
                  >
                    <span>{m.name}</span>
                    <span className="cm-credit">{m.credits}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {busy ? (
            <button className="comp-run stop" onClick={cancel}>■ 停止</button>
          ) : (
            <button className="comp-run" onClick={send} disabled={!ready || !input.trim()}>→ 运行</button>
          )}
        </div>
      </div>
      <div className="composer-foot">📁 {tab.cwd.split("/").filter(Boolean).pop()}</div>
    </div>
  );
}

function Block({ m }) {
  if (m.kind === "tool") return <ToolCard m={m} />;
  if (m.kind === "thought") {
    return (
      <div className="thought">
        <div className="thought-label">Thinking</div>
        <div className="thought-body" dangerouslySetInnerHTML={md(m.text)} />
      </div>
    );
  }
  if (m.role === "user") {
    return (
      <div className="row user">
        <div className="bubble-user">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="row assistant">
      <div className="assistant-text">
        <div className="markdown" dangerouslySetInnerHTML={md(m.text)} />
        {m.streaming && <span className="caret" />}
      </div>
    </div>
  );
}

function ToolCard({ m }) {
  const [open, setOpen] = useState(false);
  const done = m.toolStatus === "completed" || m.toolStatus === "success";
  const failed = m.toolStatus === "failed" || m.toolStatus === "error";
  const running = !done && !failed;
  const inputStr = m.toolInput ? JSON.stringify(m.toolInput, null, 2) : "";
  const cmd = m.toolInput?.command || m.toolInput?.path || "";
  return (
    <div className="row assistant">
      <div className={`tool-card ${failed ? "fail" : ""}`}>
        <div className="tool-card-head" onClick={() => setOpen((o) => !o)}>
          <span className="tc-icon">⌘</span>
          <span className="tc-name">{m.toolName}</span>
          {cmd && <span className="tc-cmd">{String(cmd).slice(0, 80)}</span>}
          <span className={`tc-status ${failed ? "fail" : done ? "done" : "run"}`}>
            {running ? <span className="tool-spin" /> : failed ? "✕" : "✓"}
          </span>
          <span className="tc-chev">{open ? "▾" : "▸"}</span>
        </div>
        {open && (
          <div className="tool-card-body">
            {inputStr && (
              <>
                <div className="tc-label">输入</div>
                <pre className="tc-code">{inputStr}</pre>
              </>
            )}
            {m.toolContent && (
              <>
                <div className="tc-label">输出</div>
                <pre className="tc-code">{m.toolContent.slice(0, 4000)}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
