import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({width:1400,height:900});
await p.goto("http://localhost:1420", { waitUntil: "networkidle" }).catch(()=>{});
await p.waitForTimeout(2500);
async function click(t){ try{ await p.getByText(t,{exact:false}).first().click({timeout:2500}); await p.waitForTimeout(1000);}catch(e){console.log("click fail",t)} }
await click("设置");
await p.waitForTimeout(1000);
await p.screenshot({ path: "/tmp/shots/set_open.png" });
await click("MCP"); await p.screenshot({ path: "/tmp/shots/set_mcp.png" });
await click("技能"); await p.screenshot({ path: "/tmp/shots/set_skill.png" });
await b.close();
console.log("shots saved");
