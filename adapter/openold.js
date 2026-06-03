import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const ws=[]; const reqs=[];
p.on("websocket",w=>{ ws.push("WS→"+w.url().replace("ws://127.0.0.1:3789","")); w.on("framesent",f=>ws.push("SEND "+String(f.payload).slice(0,80))); w.on("framereceived",f=>ws.push("RECV "+String(f.payload).slice(0,80))); });
p.on("request",r=>{const u=r.url();if(u.includes("/api/sessions/"))reqs.push(r.method()+" "+u.replace("http://127.0.0.1:3789","").slice(0,80));});
await p.goto("http://localhost:1420",{waitUntil:"networkidle"}).catch(()=>{});
await p.waitForTimeout(2500);
// click first session in sidebar
await p.locator("[class*=session], [class*=sidebar] [class*=item]").first().click({timeout:3000}).catch(()=>{});
await p.waitForTimeout(6000);
console.log("=== session reqs ==="); reqs.slice(0,10).forEach(r=>console.log(r));
console.log("=== ws ==="); ws.slice(0,15).forEach(w=>console.log(w));
await b.close();
