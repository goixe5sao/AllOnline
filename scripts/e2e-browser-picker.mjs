import puppeteer from "puppeteer-core";
/**
 * Browser check (real Chrome, headless): room owner picks a stock in the owner panel and shows it.
 * Needs a running DEMO server (market data on), e.g.
 *   ALLOW_DEMO_MODE=1 DATABASE_URL= NODE_ENV=production PORT=3100 npx tsx server/index.ts
 *   BASE=http://localhost:3100 node scripts/e2e-browser-picker.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const SYMBOL = process.env.SYMBOL ?? "FPT";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await (await browser.createBrowserContext()).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.setViewport(process.env.MOBILE ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 800 });
await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
await p.evaluate(async () => fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) }));
await p.evaluate(async () => fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 10 }) }));
// close earlier test rooms (demo DB) so the slot budget is free
await p.evaluate(async () => { const o = await (await fetch("/api/admin/overview")).json(); for (const r of o.rooms) if (r.status === "open") await fetch("/api/rooms/" + r.id + "/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); });
const room = await p.evaluate(async () => (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Chọn cổ phiếu", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, password: "" } }) })).json());
if (!room.roomId) throw new Error("room create failed: " + JSON.stringify(room));
await p.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await p.waitForSelector(".hud-top", { timeout: 60000 });
await p.evaluate(() => [...document.querySelectorAll("button.hud-btn.primary")].find((b) => /điều khiển|chủ phòng/i.test(b.textContent ?? ""))?.click());
await sleep(800);
await p.evaluate(() => {
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "chart"));
  sel.value = "chart";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(300);
await p.click(".symbol-picker input");
await p.type(".symbol-picker input", SYMBOL, { delay: 60 });
await p.waitForFunction((s) => [...document.querySelectorAll(".symbol-hit b")].some((b) => b.textContent === s), { timeout: 15000 }, SYMBOL);
await sleep(500);
await p.screenshot({ path: `${OUT}/chon-co-phieu-danh-sach.png` });
const hits = await p.evaluate(() => [...document.querySelectorAll(".symbol-hit")].slice(0, 5).map((e) => e.textContent));
console.log("hits:", hits);
await p.evaluate((s) => [...document.querySelectorAll(".symbol-hit")].find((e) => e.querySelector("b")?.textContent === s)?.click(), SYMBOL);
await sleep(300);
console.log("note:", await p.evaluate(() => document.querySelector(".symbol-picker > small")?.textContent));
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Hiển thị lên màn hình"))?.click());
await sleep(1500);
await p.evaluate(() => [...document.querySelectorAll("button.hud-btn.primary")].find((b) => /điều khiển|chủ phòng/i.test(b.textContent ?? ""))?.click());
// Wait for real data in the stage chart (first request waits for the backfill)
await sleep(25000);
await p.screenshot({ path: `${OUT}/chon-co-phieu-man-hinh.png` });
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Xem màn hình")?.click());
await sleep(6000);
await p.screenshot({ path: `${OUT}/chon-co-phieu-toan-man-hinh.png` });
// zoom out (older candles): their candle patterns must load too
await p.mouse.move(600, 400);
for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: 400 }); await sleep(150); }
await sleep(20000);
await p.screenshot({ path: `${OUT}/chon-co-phieu-thu-nho.png` });
const r = await p.evaluate(async (s) => {
  const d = await (await fetch(`/api/market/candles?symbol=${s}&interval=D&count=8000`)).json();
  return { isDemo: d.isDemo, n: d.candles.length, first: new Date(d.candles[0].time * 1000).toISOString().slice(0, 10) };
}, SYMBOL);
const idx = await p.evaluate(async () => {
  const d = await (await fetch(`/api/market/candles?symbol=VNINDEX&interval=D&count=8000`)).json();
  return { isDemo: d.isDemo, n: d.candles.length, first: new Date(d.candles[0].time * 1000).toISOString().slice(0, 10), head: d.candles.slice(0, 3).map((c) => new Date(c.time * 1000).toISOString().slice(0, 10)) };
});
console.log(SYMBOL, r, "VNINDEX", idx, "errors:", errors);
await browser.close();
process.exit(r.isDemo || errors.length ? 1 : 0);
