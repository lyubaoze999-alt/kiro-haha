import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message.slice(0,200)));
await p.goto("http://localhost:1420", { waitUntil: "networkidle", timeout: 30000 }).catch(()=>{});
await p.waitForTimeout(3000);
// find the composer textarea and type
try {
  const ta = p.locator("textarea").first();
  await ta.waitFor({ timeout: 5000 });
  await ta.fill("用一句话说你好");
  await ta.press("Enter");
  console.log("sent message, waiting for response...");
  // wait for assistant text to appear
  await p.waitForTimeout(12000);
  const body = await p.locator("body").innerText();
  const hasReply = /你好|hello|帮/i.test(body);
  console.log("assistant replied:", hasReply);
} catch(e) { console.log("UI interact err:", e.message.slice(0,150)); }
console.log("pageerrors:", errs.length);
errs.slice(0,5).forEach(e=>console.log(e));
await b.close();
