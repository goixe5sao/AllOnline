import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * "Trang web tự cuộn" in real Chrome, with real sites (needs internet):
 *  - the owner pastes a link → the server photographs the whole page → the stage scrolls it
 *    (top pause, down, bottom pause, back up), the guest sees the same position;
 *  - pause stops the scrolling for everyone; speed buttons; "Chụp lại";
 *  - links to the server's own machine / home network are refused (also when a public name
 *    points to 127.0.0.1).
 *   BASE=http://localhost:3100 node scripts/e2e-web.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
async function page(vp = { width: 1200, height: 760 }) {
  const p = await (await browser.createBrowserContext()).newPage();
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
const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng xem trang web", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Sắp chiếu trang web" } } }) })).json();
});
const api = (path, body) => owner.evaluate(async (a) => { const r = await fetch(a.path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body) }); return { status: r.status, body: await r.json().catch(() => null) }; }, { path, body });

// ---- safety: never the server's own machine / home network
for (const bad of ["http://127.0.0.1:3100/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/"]) {
  const r = await api(`/api/rooms/${room.roomId}/webshot`, { url: bad });
  check(r.status === 400, `refused ${bad} (${r.status} ${r.body?.message ?? ""})`);
  await sleep(8200);
}
const sneaky = await api(`/api/rooms/${room.roomId}/webshot`, { url: "http://localtest.me/" }); // public name → 127.0.0.1
check(sneaky.status === 400 && /không công khai/.test(sneaky.body?.message ?? ""), `refused a public name pointing to 127.0.0.1 (${sneaky.status} ${sneaky.body?.message ?? ""})`);
await sleep(8200);

// ---- owner puts a long page on screen
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".orb", { timeout: 90000 });
await orb(owner, "control");
await owner.waitForSelector(".side-panel");
await owner.evaluate(() => {
  const sel = [...document.querySelectorAll(".side-panel label.field")].find((l) => l.textContent?.includes("Loại nội dung"))?.querySelector("select");
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "web");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await owner.waitForSelector(".web-panel");
await owner.type('.web-panel input[aria-label="Link trang web"]', "https://vnexpress.net");
const t0 = Date.now();
await owner.evaluate(() => [...document.querySelectorAll(".web-panel button")].find((b) => b.textContent?.includes("Chụp trang"))?.click());
const shown = await owner.waitForSelector(".web-scroll img", { timeout: 90000 }).then(() => true).catch(() => false);
check(shown, `page photographed and on screen (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (!shown) console.log("panel:", await owner.evaluate(() => document.querySelector(".web-panel")?.innerText));
await sleep(2000);
const imgH = await owner.evaluate(() => [...document.querySelectorAll(".web-scroll img")].reduce((n, i) => n + i.naturalHeight, 0));
check(imgH > 3000, `whole page photographed (${imgH} px tall, ${await owner.$$eval(".web-scroll img", (x) => x.length)} strips)`);
check(/vnexpress\.net/.test(await owner.$eval(".web-label", (e) => e.textContent)), "label shows the site");
// position as % of the page photo (independent of the viewer's screen size)
const ty = (p) => p.evaluate(() => { const s = document.querySelector(".web-strip"); const m = (s?.style.transform ?? "").match(/-?[\d.]+/); return m && s.clientHeight ? (Number(m[0]) / s.clientHeight) * 100 : 0; });
check(Math.abs(await ty(owner)) < 0.01, "starts at the top (pause)");
await owner.screenshot({ path: `${OUT}/web-top.png` });

// ---- guest joins
const guest = await page({ width: 1100, height: 700 });
await guest.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
await guest.type("form input[maxlength='60']", "Khách xem web");
await guest.click("form button.btn.primary");
await guest.waitForSelector(".orb", { timeout: 90000 });
await guest.waitForSelector(".web-scroll img", { timeout: 30000 });
await sleep(9000);
const [a, b] = await Promise.all([ty(owner), ty(guest)]);
check(a < -1, `scrolling down after the pause (owner at ${a.toFixed(2)}%)`);
check(Math.abs(a - b) < 1.5, `owner and guest at the same place (${a.toFixed(2)}% vs ${b.toFixed(2)}%)`);
await guest.screenshot({ path: `${OUT}/web-guest-scrolling.png` });

// ---- pause stops it for everyone
await owner.evaluate(() => [...document.querySelectorAll(".side-panel button")].find((x) => x.textContent?.includes("Tạm dừng") || x.textContent?.includes("⏸"))?.click());
await sleep(1500);
const p1 = await ty(guest);
await sleep(3000);
const p2 = await ty(guest);
check(Math.abs(p1 - p2) < 0.05, `paused → the guest's page stops too (${p1.toFixed(2)} → ${p2.toFixed(2)})`);
await owner.evaluate(() => [...document.querySelectorAll(".side-panel button")].find((x) => x.textContent?.includes("Về đầu"))?.click());
await sleep(1200);
check(Math.abs(await ty(guest)) < 0.05, "“Về đầu” → back to the top for everyone");

// ---- "Chụp lại": a fresh photo of the same page
await sleep(8500); // one photo per 8 s per room
const before = await owner.$$eval(".web-scroll img", (x) => x.map((i) => i.src).join());
await owner.evaluate(() => [...document.querySelectorAll(".web-panel button")].find((b) => b.textContent?.includes("Chụp lại"))?.click());
let changed = false;
for (let k = 0; k < 90 && !changed; k++) {
  await sleep(1000);
  changed = (await owner.$$eval(".web-scroll img", (x) => x.map((i) => i.src).join()).catch(() => before)) !== before;
}
check(changed, "“Chụp lại” → a fresh photo on screen");
await sleep(12000);
await owner.screenshot({ path: `${OUT}/web-vnexpress.png` });

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
