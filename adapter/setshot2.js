import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({width:1400,height:900});
await p.goto("http://localhost:1420",{waitUntil:"networkidle"}).catch(()=>{});
await p.waitForTimeout(2500);
// click footer 设置 (last occurrence)
try { await p.getByText("设置",{exact:false}).last().click({timeout:3000}); await p.waitForTimeout(1500);}catch(e){console.log("set click fail")}
await p.screenshot({path:"/tmp/shots/s_open.png"});
// click MCP nav
for(const t of ["MCP"]){ try{await p.getByText(t,{exact:true}).first().click({timeout:3000});await p.waitForTimeout(1500);}catch(e){console.log("fail",t)} }
await p.screenshot({path:"/tmp/shots/s_mcp.png"});
await b.close(); console.log("done");
