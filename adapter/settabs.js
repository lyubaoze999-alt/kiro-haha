import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const reqs = [];
p.on("request", r => { const u=r.url(); if(u.includes("/api/")) reqs.push(r.method()+" "+u.replace("http://127.0.0.1:3789","")); });
await p.goto("http://localhost:1420", { waitUntil: "networkidle" }).catch(()=>{});
await p.waitForTimeout(2500);
async function click(t){ try{ await p.getByText(t,{exact:false}).first().click({timeout:2500}); await p.waitForTimeout(1200);}catch{} }
await click("设置");
for (const tab of ["服务商","通用","MCP","Agents","技能","记忆","插件","Computer Use","Token","诊断"]) {
  reqs.length=0;
  await click(tab);
  // grab main panel text (right of nav)
  let txt=""; try{ txt = await p.locator("main, [class*=content], [class*=panel]").last().innerText(); }catch{}
  console.log(`\n### ${tab} ### reqs=[${reqs.join(", ")}]`);
  console.log((txt||"").replace(/\n+/g," / ").slice(0,200));
}
await b.close();
