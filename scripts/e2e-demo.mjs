import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * "Phòng trải nghiệm" in real Chrome (limit set to 1 minute/day to keep the test short):
 *  - the home page lists the 3 demo rooms (created automatically) with host / seats;
 *  - visitor A becomes the host: to-do list, free text on screen (like a real room), YouTube → ticked;
 *  - visitor B sees the host seat taken, enters as a guest and goes live at once (REAL=1:
 *    through Cloudflare, A sees "LIVE · Minh" on the stage screen);
 *  - A's minute (one visit) runs out → "Hết lượt" with "Vào lại" + the sign-up button, the room resets
 *    (showcase back on screen) and the host seat is free again on the home page;
 *  - visits are unlimited: A comes straight back in with a fresh minute.
 *   BASE=http://localhost:3100 node scripts/e2e-demo.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  protocolTimeout: 240000,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const errors = [];
async function page(vp = { width: 1200, height: 800 }) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["camera", "microphone"]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  await p.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("ao-gfx", "lite");
    } catch {
      /* ignore */
    }
  });
  return p;
}
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(400);
  }
  return false;
}

// ---- the app owner exists (owns the demo rooms); 1 minute a day for this test
const admin = await page();
await admin.goto(BASE + "/login", { waitUntil: "networkidle0" });
await admin.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ ứng dụng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo_minutes_per_day: 1 }) });
});

// ---- visitor A: home page → "Vào làm chủ phòng"
const a = await page();
await a.goto(BASE + "/", { waitUntil: "networkidle0" });
await a.waitForSelector("#trai-nghiem .demo-card", { timeout: 20000 });
const cards = await a.$$eval("#trai-nghiem .demo-card h3", (h) => h.map((x) => x.textContent));
check(cards.length === 3 && /Hội trường/.test(cards[0]) && /Bãi đỗ xe/.test(cards[1]) && /Phòng họp/.test(cards[2]), `home: 3 demo rooms (${cards.join(" | ")})`);
check(/Chủ phòng: trống/.test(await text(a, "#trai-nghiem .demo-card")), "home: host seat free");
check(/Mỗi lượt 1 phút/.test(await text(a, "#trai-nghiem")) && /không giới hạn số lượt/.test(await text(a, "#trai-nghiem")), "home: 1 minute a visit, unlimited visits");
check((await a.$$eval(".f-try", (x) => x.length)) >= 4, "feature brochures link to “Thử ngay”");
await a.evaluate(() => document.querySelector("#trai-nghiem")?.scrollIntoView());
await a.screenshot({ path: `${OUT}/demo-home.png` });
await a.evaluate(() => document.querySelector('#trai-nghiem .demo-card a[href*="as=host"]')?.click());
await a.waitForSelector(".demo-intro", { timeout: 20000 });
check((await a.$eval('.demo-roles [role=radio][aria-checked="true"]', (b) => b.textContent)).includes("chủ phòng"), "invite page: “Vào làm chủ phòng” selected");
await a.screenshot({ path: `${OUT}/demo-join.png` });
await a.type("form input[maxlength='60']", "Lan");
await a.click("form button.btn.primary");
await a.waitForSelector(".orb", { timeout: 90000 });
check(await waitFor(async () => /Chủ phòng trải nghiệm/.test(await text(a, ".demo-clock"))), `A: “${await text(a, ".demo-clock")}”`);
await orb(a, "control");
await a.waitForSelector(".demo-missions");
check(/Thử ngay \(0\/5\)/.test(await text(a, ".demo-missions")), "A: to-do list 0/5");
// the main room's functions: free text, picture / sound links
const kinds = await a.$$eval('.side-panel label.field select option', (o) => o.map((x) => x.textContent));
check(kinds.some((k) => /Âm thanh/.test(k)) && !kinds.some((k) => /thư viện mẫu/.test(k)), "A: text, pictures and sound like a real room");
await a.waitForSelector(".side-panel textarea");
await a.evaluate(() => {
  const t = document.querySelector(".side-panel textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Chào cả phòng — chữ tự gõ!");
  t.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
await a.evaluate(() => [...document.querySelectorAll(".side-panel button")].find((b) => /Hiển thị|Đưa lên|Áp dụng|Chiếu/.test(b.textContent ?? "") && !b.disabled)?.click());
check(await waitFor(async () => /chữ tự gõ/.test(await a.evaluate(() => document.querySelector(".screen-surface")?.textContent ?? "")), 8000), "A: free text on the stage screen");
// YouTube: any link
await a.evaluate(() => {
  document.querySelector('[name="host-content-type"][value="youtube"]').click();
});
await a.waitForSelector(".yt-panel");
await a.type('.yt-panel input[aria-label="Link YouTube"]', "https://youtu.be/aqz-KE-bpKQ");
await a.keyboard.press("Enter");
await sleep(400);
await a.evaluate(() => [...document.querySelectorAll(".side-panel button")].find((b) => b.textContent?.includes("Hiển thị video đầu tiên"))?.click());
check(await waitFor(async () => /1\/5/.test(await text(a, ".demo-missions"))), "A: YouTube on screen → mission ticked (1/5)");
await a.screenshot({ path: `${OUT}/demo-host.png` });

// ---- visitor B: host seat taken → guest
const b = await page({ width: 1100, height: 760 });
await b.goto(BASE + "/", { waitUntil: "networkidle0" });
await b.waitForSelector("#trai-nghiem .demo-card", { timeout: 20000 });
check(await waitFor(async () => /Lan đang làm chủ phòng/.test(await text(b, "#trai-nghiem .demo-card")), 15000), "home: “Lan đang làm chủ phòng”");
await b.evaluate(() => document.querySelector('#trai-nghiem .demo-card a[href*="as=guest"]')?.click());
await b.waitForSelector(".demo-intro", { timeout: 20000 });
check(await b.$eval(".demo-roles [role=radio]", (x) => x.disabled), "invite page: host choice disabled (taken)");
await b.type("form input[maxlength='60']", "Minh");
await b.click("form button.btn.primary");
await b.waitForSelector(".orb", { timeout: 90000 });
check(await waitFor(async () => /Trải nghiệm · ⏳/.test(await text(b, ".demo-clock"))), `B (guest): “${await text(b, ".demo-clock")}”`);
check(!(await b.$('[data-orb="control"]')), "B: no owner controls");
await orb(b, "live");
await b.waitForSelector(".live-panel");
// demo rooms: anyone goes live at once (no approval)
await b.evaluate(() => [...document.querySelectorAll(".live-panel button")].find((x) => x.textContent?.includes("Lên sóng"))?.click());
check(await waitFor(() => b.evaluate(() => [...document.querySelectorAll(".live-panel button")].some((x) => x.textContent?.includes("Bật camera"))), 8000), "B (guest): allowed to go live at once, no approval");
await b.evaluate(() => [...document.querySelectorAll(".live-panel button")].find((x) => x.textContent?.includes("Bật camera"))?.click());
check(await waitFor(() => b.evaluate(() => (document.querySelector(".live-preview")?.videoWidth ?? 0) > 0)), "B: camera preview works");
check(!(await b.$eval(".live-go", (x) => x.disabled)), "B: “Lên sóng” enabled in the demo room");
if (process.env.REAL === "1") {
  await b.evaluate(() => document.querySelector(".live-go")?.click());
  check(await waitFor(async () => /LIVE · Minh/.test(await a.evaluate(() => document.querySelector(".screen-surface")?.textContent ?? "")), 30000), "B on air: A sees “LIVE · Minh” on the stage screen (via Cloudflare)");
  await a.screenshot({ path: `${OUT}/demo-live-guest.png` });
}

// ---- A's minute runs out
check(await waitFor(async () => /Hết lượt trải nghiệm/.test(await a.evaluate(() => document.body.innerText)), 75000), "A: visit over → “Hết lượt trải nghiệm”");
check(!!(await a.$('a[href*="mode=signup"]')), "A: “Mở phòng dùng thử miễn phí” button");
check(/Vào lại phòng trải nghiệm/.test(await a.evaluate(() => document.body.innerText)), "A: “Vào lại phòng trải nghiệm” button");
await a.screenshot({ path: `${OUT}/demo-over.png` });
check(await waitFor(async () => /Phòng trải nghiệm 👋/.test(await b.evaluate(() => document.querySelector(".screen-surface")?.textContent ?? "")), 15000), "room reset: the showcase is back on the stage screen");
await b.goto(BASE + "/", { waitUntil: "networkidle0" });
check(await waitFor(async () => /Chủ phòng: trống/.test(await text(b, "#trai-nghiem .demo-card")), 15000), "home: host seat free again");

// ---- unlimited visits: A comes straight back with a fresh minute
await a.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Vào lại phòng trải nghiệm"))?.click());
await a.waitForSelector(".orb", { timeout: 90000 });
check(await waitFor(async () => /còn (1:00|0:5\d)/.test(await text(a, ".demo-clock")), 20000), `A back in the room: “${await text(a, ".demo-clock")}”`);

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
