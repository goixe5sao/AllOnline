import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * "Siêu đẹp" graphics, the way a viewer uses it: a room whose owner chose "Đơn sắc", the viewer
 * opens ⚙️ Cài đặt and taps "Siêu đẹp" → alien-future stage + bloom on their screen only.
 * Headless software rendering is slow, so the watchdog must fall back to "Đầy đủ"; tapping
 * "Siêu đẹp" again must then keep it.
 *   BASE=http://localhost:3100 node scripts/shoot-ultra.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const owner = await (await browser.createBrowserContext()).newPage();
owner.on("pageerror", (e) => errors.push(e.message));
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng cũ (Đơn sắc)", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json();
});
const gfx = (p) => p.evaluate(() => document.querySelector('.gfx-seg button[aria-checked="true"]')?.textContent ?? null);
async function tapUltra(p) {
  if (!(await p.$(".gfx-seg"))) await orb(p, "settings");
  await p.evaluate(() => [...document.querySelectorAll(".gfx-seg button")].find((b) => b.textContent === "Siêu đẹp")?.click());
}

for (const [name, vp] of [
  ["laptop", { width: 1280, height: 760 }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", "Khách " + name);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(4000);
  await g.screenshot({ path: `${OUT}/ultra-${name}-before.png` });
  await tapUltra(g);
  await sleep(500);
  check((await gfx(g)) === "Siêu đẹp", `${name}: “Siêu đẹp” selected from ⚙️ Cài đặt`);
  await g.screenshot({ path: `${OUT}/ultra-${name}-settings.png` });
  await g.evaluate(() => document.querySelector('[aria-label="Đóng cài đặt"]')?.click());
  await sleep(4000);
  await g.screenshot({ path: `${OUT}/ultra-${name}-after.png` });
  if (name === "laptop") {
    let now = "Siêu đẹp";
    for (let k = 0; k < 40 && now === "Siêu đẹp"; k++) {
      await sleep(1500);
      if (!(await g.$(".gfx-seg"))) await orb(g, "settings");
      now = await gfx(g);
    }
    check(now === "Đầy đủ", `too slow → temporarily back to “Đầy đủ” (${now})`);
    await tapUltra(g);
    await sleep(30000);
    if (!(await g.$(".gfx-seg"))) await orb(g, "settings");
    check((await gfx(g)) === "Siêu đẹp", "tapping “Siêu đẹp” again keeps it");
  }
  await g.close();
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
