import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Graphics setting follows the owner's stage choice:
 *  - "Đơn sắc" room → no "Đồ hoạ" row in ⚙️ Cài đặt (one simple look for everyone);
 *  - owner switches to "Hành tinh tương lai" → the row appears at once; "Siêu đẹp" = bloom;
 *  - back to "Đơn sắc" → the row goes away; back again → the viewer's choice is remembered.
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
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng Đơn sắc", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json();
});
const setStage = (style) => owner.evaluate(async (a) => (await fetch(`/api/rooms/${a.id}/stage-style`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: a.style }) })).status, { id: room.roomId, style });
const hasRow = (p) => p.evaluate(() => !!document.querySelector(".gfx-seg"));
const gfx = (p) => p.evaluate(() => document.querySelector('.gfx-seg button[aria-checked="true"]')?.textContent ?? null);
const openSettings = async (p) => {
  if (!(await p.$(".orb-settings"))) await orb(p, "settings");
  await sleep(300);
};
const tap = (p, label) => p.evaluate((l) => [...document.querySelectorAll(".gfx-seg button")].find((b) => b.textContent === l)?.click(), label);
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

for (const [name, vp] of [
  ["laptop", { width: 1280, height: 760 }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  await setStage("plain");
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", "Khách " + name);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(3000);
  await openSettings(g);
  check(!(await hasRow(g)), `${name}: “Đơn sắc” room → no “Đồ hoạ” row in Cài đặt`);
  await g.screenshot({ path: `${OUT}/gfx-${name}-plain-settings.png` });

  // owner switches to the alien stage: the row appears without reloading
  await setStage("glam");
  check(await waitFor(() => hasRow(g)), `${name}: owner picks “Hành tinh tương lai” → “Đồ hoạ” row appears`);
  check((await gfx(g)) === "Đầy đủ", `${name}: default level “Đầy đủ”`);
  await tap(g, "Siêu đẹp");
  await sleep(400);
  check((await gfx(g)) === "Siêu đẹp", `${name}: “Siêu đẹp” selected`);
  await g.screenshot({ path: `${OUT}/gfx-${name}-glam-settings.png` });
  await g.evaluate(() => document.querySelector('[aria-label="Đóng cài đặt"]')?.click());
  await sleep(3500);
  await g.screenshot({ path: `${OUT}/gfx-${name}-glam-ultra.png` });

  if (name === "laptop") {
    // watchdog: software rendering is slow → temporarily back to "Đầy đủ"; tapping again keeps it
    let now = "Siêu đẹp";
    for (let k = 0; k < 40 && now === "Siêu đẹp"; k++) {
      await sleep(1500);
      await openSettings(g);
      now = await gfx(g);
    }
    check(now === "Đầy đủ", `too slow → temporarily back to “Đầy đủ” (${now})`);
    await tap(g, "Siêu đẹp");
    await sleep(30000);
    await openSettings(g);
    check((await gfx(g)) === "Siêu đẹp", "tapping “Siêu đẹp” again keeps it");
  }

  // back to "Đơn sắc": row gone, the plain hall is shown; the choice is remembered for later
  await openSettings(g);
  await setStage("plain");
  check(await waitFor(async () => !(await hasRow(g))), `${name}: owner picks “Đơn sắc” → “Đồ hoạ” row disappears`);
  await g.evaluate(() => document.querySelector('[aria-label="Đóng cài đặt"]')?.click());
  await sleep(3000);
  await g.screenshot({ path: `${OUT}/gfx-${name}-back-plain.png` });
  await setStage("glam");
  await openSettings(g);
  check(await waitFor(() => hasRow(g)), `${name}: alien stage again → row back`);
  check((await gfx(g)) === "Siêu đẹp", `${name}: viewer's choice remembered (“${await gfx(g)}”)`);
  await g.close();
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
