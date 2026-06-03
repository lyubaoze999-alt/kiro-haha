import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPanel({ cwd }) {
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current || started.current) return;
    started.current = true;
    const id = `term-${Date.now()}`;
    const term = new Terminal({
      fontFamily: "Menlo, monospace",
      fontSize: 12,
      theme: { background: "#1E1E1E", foreground: "#E6E6E6", cursor: "#E6E6E6" },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();

    const unData = listen(`pty:data:${id}`, (e) => term.write(e.payload));
    const unExit = listen(`pty:exit:${id}`, () => term.write("\r\n\x1b[90m[exited]\x1b[0m\r\n"));
    invoke("term_spawn", { id, cwd, cols: term.cols, rows: term.rows });
    term.onData((d) => invoke("pty_write", { id, data: d }));

    const ro = new ResizeObserver(() => {
      try { fit.fit(); invoke("pty_resize", { id, cols: term.cols, rows: term.rows }); } catch {}
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      unData.then((f) => f());
      unExit.then((f) => f());
      invoke("pty_kill", { id });
      term.dispose();
    };
  }, [cwd]);

  return <div ref={ref} style={{ width: "100%", height: "100%", padding: 6, background: "#1E1E1E" }} />;
}
