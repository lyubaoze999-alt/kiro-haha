import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export default function TerminalView({ tab, active }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || spawnedRef.current) return;
    spawnedRef.current = true;

    const term = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#3a3a3a",
      },
      cursorBlink: true,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const cols = term.cols;
    const rows = term.rows;

    // Listen for PTY output
    const unlistenData = listen(`pty:data:${tab.id}`, (e) => {
      term.write(e.payload);
    });
    const unlistenExit = listen(`pty:exit:${tab.id}`, () => {
      term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    });

    // Spawn the PTY
    invoke("pty_spawn", {
      opts: {
        id: tab.id,
        cwd: tab.cwd,
        model: tab.model || null,
        agent: tab.agent || null,
        resume_id: tab.resumeId || null,
        cols,
        rows,
      },
    }).catch((err) => {
      term.write(`\r\n\x1b[31mFailed to start: ${err}\x1b[0m\r\n`);
    });

    // Send keystrokes to PTY
    term.onData((data) => {
      invoke("pty_write", { id: tab.id, data });
    });

    // Resize handling
    const handleResize = () => {
      try {
        fit.fit();
        invoke("pty_resize", { id: tab.id, cols: term.cols, rows: term.rows });
      } catch {}
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      unlistenData.then((f) => f());
      unlistenExit.then((f) => f());
      invoke("pty_kill", { id: tab.id });
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refit when becoming active
  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      setTimeout(() => {
        try {
          fitRef.current.fit();
          invoke("pty_resize", {
            id: tab.id,
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          });
          termRef.current.focus();
        } catch {}
      }, 50);
    }
  }, [active, tab.id]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: active ? "block" : "none",
        padding: "8px",
      }}
    />
  );
}
