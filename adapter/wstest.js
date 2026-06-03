import WebSocket from "ws";

// 1) create a new session via HTTP
const resp = await fetch("http://127.0.0.1:3789/api/sessions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ workDir: "/tmp", model: "auto", agent: "kiro_default" }),
});
const { session } = await resp.json();
console.log("SESSION:", session.id);

const ws = new WebSocket(`ws://127.0.0.1:3789/ws/${encodeURIComponent(session.id)}`);
let connected = false;
ws.on("open", () => console.log("WS open"));
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "content_delta") process.stdout.write(m.text || "");
  else console.log("\n[MSG]", JSON.stringify(m).slice(0, 160));
  if (m.type === "connected" && !connected) {
    connected = true;
    setTimeout(() => {
      console.log(">> sending user_message");
      ws.send(JSON.stringify({ type: "user_message", content: "用一句话说你好", attachments: [] }));
    }, 1500);
  }
  if (m.type === "message_complete") { console.log("\n=== DONE ==="); ws.close(); process.exit(0); }
});
ws.on("error", (e) => { console.log("WS ERR", e.message); process.exit(1); });
setTimeout(() => { console.log("\nTIMEOUT"); process.exit(1); }, 60000);
