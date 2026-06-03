import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({width:1400,height:900});
await p.goto("http://localhost:1420",{waitUntil:"networkidle"}).catch(()=>{});
await p.waitForTimeout(2500);
await p.getByText("设置",{exact:false}).last().click({timeout:3000}).catch(()=>{});
await p.waitForTimeout(1200);
// click MCP nav button
await p.locator("button:has-text('MCP'), [role=button]:has-text('MCP')").first().click({timeout:3000}).catch(async()=>{ await p.getByText("MCP").first().click().catch(()=>{}); });
await p.waitForTimeout(1500);
await p.screenshot({path:"/tmp/shots/mcp_page.png"});
// 技能
await p.getByText("技能",{exact:true}).first().click({timeout:3000}).catch(()=>{});
await p.waitForTimeout(1500);
await p.screenshot({path:"/tmp/shots/skill_page.png"});
await b.close();console.log("done");
