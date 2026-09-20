import { chromium } from "@playwright/test";
// Does the stall come from many browser CONTEXTS, or many browser PROCESSES?
const BASE = "http://127.0.0.1:8090";
async function timeGoto(page) { const t = Date.now(); await page.goto(BASE, { timeout: 30000 }); return Date.now() - t; }

const browser = await chromium.launch();
for (const n of [3, 6]) {
  const ctxs = await Promise.all(Array.from({ length: n }, () => browser.newContext()));
  const pages = await Promise.all(ctxs.map(c => c.newPage()));
  const t = Date.now();
  const times = await Promise.all(pages.map(timeGoto));
  console.log(`${n} contexts in ONE browser: total ${Date.now() - t}ms, per-page ${times.join(", ")}ms`);
  await Promise.all(ctxs.map(c => c.close()));
}
await browser.close();

for (const n of [3, 6]) {
  const t = Date.now();
  const browsers = await Promise.all(Array.from({ length: n }, () => chromium.launch()));
  const launchMs = Date.now() - t;
  const t2 = Date.now();
  const times = await Promise.all(browsers.map(async b => timeGoto(await (await b.newContext()).newPage())));
  console.log(`${n} SEPARATE browsers: launch ${launchMs}ms, goto total ${Date.now() - t2}ms, per-page ${times.join(", ")}ms`);
  await Promise.all(browsers.map(b => b.close()));
}
