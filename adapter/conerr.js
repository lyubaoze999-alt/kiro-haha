import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 300)); });
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0, 300)));
await p.goto("http://localhost:1420", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(4000);
// try clicking settings + nav items
async function clickText(t) { try { await p.getByText(t, { exact: false }).first().click({ timeout: 2000 }); await p.waitForTimeout(1500); } catch {} }
await clickText("设置"); 
for (const t of ["服务商","通用","MCP","Agents","技能","记忆","插件","Token","诊断"]) await clickText(t);
await p.waitForTimeout(1000);
console.log("=== ERRORS (" + errs.length + ") ===");
[...new Set(errs)].slice(0, 25).forEach((e) => console.log(e));
await b.close();
