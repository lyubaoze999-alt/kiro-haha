import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import TerminalPanel from "./TerminalPanel";

export default function SidePanel({ cwd }) {
  const [view, setView] = useState("changes"); // changes | browser
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diff, setDiff] = useState("");
  const [fileMode, setFileMode] = useState("diff"); // diff | preview
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("http://localhost:3000");
  const [iframeUrl, setIframeUrl] = useState("");
  const [sq, setSq] = useState("");
  const [results, setResults] = useState([]);

  async function doSearch() {
    if (!sq.trim()) return;
    const r = await invoke("search_files", { cwd, query: sq });
    setResults(r);
  }

  const refresh = useCallback(async () => {
    if (!cwd) return;
    const status = await invoke("git_status", { cwd });
    const parsed = (status.files || "")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
    setFiles(parsed);
  }, [cwd]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function viewDiff(file) {
    setSelectedFile(file);
    const d = await invoke("git_file_diff", { cwd, file });
    setDiff(d);
    const c = await invoke("read_file", { path: `${cwd}/${file}` }).catch(() => "");
    setContent(c);
  }

  function go() {
    setIframeUrl(url);
  }

  return (
    <div className="side-panel">
      <div className="panel-tabs">
        <button
          className={view === "changes" ? "active" : ""}
          onClick={() => setView("changes")}
        >
          Changes {files.length > 0 && `(${files.length})`}
        </button>
        <button
          className={view === "browser" ? "active" : ""}
          onClick={() => setView("browser")}
        >
          Browser
        </button>
        <button
          className={view === "terminal" ? "active" : ""}
          onClick={() => setView("terminal")}
        >
          Terminal
        </button>
        <button
          className={view === "search" ? "active" : ""}
          onClick={() => setView("search")}
        >
          搜索
        </button>
      </div>

      {view === "changes" && (
        <div className="changes-view">
          <div className="file-list">
            {files.length === 0 && <div className="empty">No changes</div>}
            {files.map((f) => (
              <div
                key={f.path}
                className={`file-item ${selectedFile === f.path ? "active" : ""}`}
                onClick={() => viewDiff(f.path)}
              >
                <span className={`badge badge-${f.status}`}>{f.status || "M"}</span>
                <span className="file-path">{f.path}</span>
              </div>
            ))}
          </div>
          {selectedFile && (
            <>
              <div className="file-mode-bar">
                <span className="fm-name">{selectedFile.split("/").pop()}</span>
                <div className="fm-toggle">
                  <button className={fileMode === "diff" ? "active" : ""} onClick={() => setFileMode("diff")}>Diff</button>
                  <button className={fileMode === "preview" ? "active" : ""} onClick={() => setFileMode("preview")}>预览</button>
                </div>
              </div>
              {fileMode === "diff" ? (
                <pre className="diff-view">
                  {diff.split("\n").map((line, i) => {
                    let cls = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
                    else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
                    else if (line.startsWith("@@")) cls = "diff-hunk";
                    return <div key={i} className={cls}>{line || " "}</div>;
                  })}
                </pre>
              ) : (
                <pre className="preview-view">{content}</pre>
              )}
            </>
          )}
        </div>
      )}

      {view === "browser" && (
        <div className="browser-view">
          <div className="browser-bar">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
            />
            <button onClick={go}>Go</button>
            <button onClick={() => setIframeUrl(url + "?_=" + Date.now())}>⟳</button>
          </div>
          {iframeUrl ? (
            <iframe className="browser-frame" src={iframeUrl} title="preview" />
          ) : (
            <div className="empty">Enter a URL and click Go</div>
          )}
        </div>
      )}
      {view === "terminal" && <TerminalPanel cwd={cwd} />}

      {view === "search" && (
        <div className="search-view">
          <div className="browser-bar">
            <input value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} placeholder="搜索项目内容..." />
            <button onClick={doSearch}>搜</button>
          </div>
          <div className="search-results">
            {results.length === 0 && <div className="empty">输入关键词搜索</div>}
            {results.map((r, i) => (
              <div key={i} className="search-item" onClick={() => viewDiff(r.file)}>
                <div className="sr-file">{r.file}:{r.line}</div>
                <div className="sr-text">{r.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
