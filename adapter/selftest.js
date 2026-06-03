import WebSocket from "ws";
const BASE = "http://127.0.0.1:3789";
let fails = 0, oks = 0;

async function get(p) {
  try {
    const r = await fetch(BASE + p);
    const ct = r.headers.get("content-type") || "";
    if (!r.ok) { console.log(`❌ ${p} → HTTP ${r.status}`); fails++; return null; }
    if (!ct.includes("application/json")) { console.log(`⚠️  ${p} → non-JSON`); fails++; return null; }
    const j = await r.json();
    console.log(`✅ ${p}`);
    oks++;
    return j;
  } catch (e) { console.log(`❌ ${p} → ${e.message}`); fails++; return null; }
}

// endpoints frontend hits
const eps = [
  "/api/sessions", "/api/models", "/api/models/current", "/api/skills", "/api/mcp",
  "/api/providers", "/api/providers/presets", "/api/providers/auth-status",
  "/api/settings/user", "/api/settings/cli-launcher", "/api/permissions/mode",
  "/api/effort", "/api/h5-access", "/api/desktop-ui/preferences",
  "/api/scheduled-tasks", "/api/scheduled-tasks/runs", "/api/agents", "/api/tasks",
  "/api/teams", "/api/plugins", "/api/adapters", "/api/computer-use",
  "/api/activity-stats", "/api/memory", "/api/diagnostics", "/api/doctor/report",
  "/api/open-targets",
];
console.log("=== HTTP endpoints ===");
for (const e of eps) await get(e);

// session sub-resources
const s = await get("/api/sessions");
const sid = s?.sessions?.[0]?.id;
if (sid) {
  console.log("=== session sub-resources ===");
  for (const sub of ["messages", "git-info", "slash-commands", "inspection", "turn-checkpoints"])
    await get(`/api/sessions/${sid}/${sub}`);
}

// WS chat
console.log("=== WS chat ===");
const resp = await fetch(BASE + "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workDir: "/tmp", model: "auto" }) });
const { session } = await resp.json();
await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:3789/ws/${encodeURIComponent(session.id)}`);
  let got = { connected: false, delta: false, complete: false };
  const to = setTimeout(() => { console.log("❌ WS timeout"); fails++; resolve(); }, 40000);
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "connected") { got.connected = true; setTimeout(() => ws.send(JSON.stringify({ type: "user_message", content: "说你好", attachments: [] })), 1000); }
    if (m.type === "content_delta") got.delta = true;
    if (m.type === "message_complete") {
      got.complete = true;
      console.log(`✅ WS connected=${got.connected} delta=${got.delta} complete=${got.complete}`);
      oks++; clearTimeout(to); ws.close(); resolve();
    }
  });
  ws.on("error", (e) => { console.log("❌ WS", e.message); fails++; clearTimeout(to); resolve(); });
});

console.log(`\n=== RESULT: ${oks} ok, ${fails} fail ===`);
process.exit(fails ? 1 : 0);
