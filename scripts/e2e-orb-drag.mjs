import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Movable orb: with chat open the orb must not cover "Gửi"; the viewer drags the orb (mouse on
 * a laptop, finger on a phone), a drag does not open the menu, a tap does, the arcs fan toward
 * the middle of the screen and stay on screen, and the spot is remembered after a reload.
 *   BASE=http://localhost:3100 node scripts/e2e-orb-drag.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const owner = await (await browser.createBrowserContext()).newPage();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đêm nhạc Tương Lai", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "glam", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json();
});
await owner.close();

const rect = (p, sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel)?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null;
}, sel);
const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isOpen = (p) => p.evaluate(() => document.querySelector(".orb-root")?.classList.contains("open"));

for (const [name, vp, touch] of [
  ["laptop", { width: 1280, height: 760 }, false],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true],
]) {
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.evaluateOnNewDocument(() => localStorage.setItem("ao-gfx", "lite")); // faster frames for real input events
  await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", "Khách " + name);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(3000);

  // chat open, orb in its default corner: "Gửi" stays clear
  await orb(g, "chat");
  await sleep(400);
  const send0 = await rect(g, ".chat-input button");
  const orb0 = await rect(g, ".orb");
  check(!overlap(send0, orb0), `${name}: orb does not cover “Gửi” in its default corner`);
  await g.screenshot({ path: `${OUT}/orb-drag-${name}-chat-default.png` });

  // drag the orb to the upper-left part of the screen
  const to = { x: Math.round(vp.width * 0.18), y: Math.round(vp.height * 0.3) };
  if (touch) {
    await g.touchscreen.touchStart(orb0.cx, orb0.cy);
    for (let i = 1; i <= 6; i++) await g.touchscreen.touchMove(orb0.cx + ((to.x - orb0.cx) * i) / 6, orb0.cy + ((to.y - orb0.cy) * i) / 6);
    await g.touchscreen.touchEnd();
  } else {
    await g.mouse.move(orb0.cx, orb0.cy);
    await g.mouse.down();
    await g.mouse.move(to.x, to.y, { steps: 6 });
    await g.mouse.up();
  }
  await sleep(600);
  const orb1 = await rect(g, ".orb");
  check(Math.abs(orb1.cx - to.x) < 30 && Math.abs(orb1.cy - to.y) < 30, `${name}: orb follows the drag (${Math.round(orb1.cx)},${Math.round(orb1.cy)} → target ${to.x},${to.y})`);
  check(!(await isOpen(g)), `${name}: a drag does not open the menu`);
  check(!!(await g.evaluate(() => localStorage.getItem("ao-orb-pos"))), `${name}: position saved on this device`);

  // tap → open; arcs fan right / down (toward the middle) and stay on screen
  await g.evaluate(() => document.querySelector(".orb")?.click());
  await sleep(800);
  check(await isOpen(g), `${name}: a tap still opens the menu`);
  const items = await g.$$eval(".orb-root.open .orb-item", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }));
  check(items.every((i) => i.x >= 0 && i.y >= 0 && i.r <= vp.width && i.b <= vp.height), `${name}: every function stays on screen (${items.length})`);
  check(items.every((i) => i.cx >= orb1.cx - 30 && i.cy >= orb1.cy - 30), `${name}: arcs open toward the middle (right / down)`);
  await g.screenshot({ path: `${OUT}/orb-drag-${name}-moved-open.png` });
  await g.keyboard.press("Escape");

  // remembered after a reload
  await g.reload({ waitUntil: "networkidle0" });
  await g.waitForSelector(".orb", { timeout: 90000 });
  await sleep(2500);
  const orb2 = await rect(g, ".orb");
  check(Math.abs(orb2.cx - orb1.cx) < 30 && Math.abs(orb2.cy - orb1.cy) < 30, `${name}: same spot after reload`);
  await g.close();
}
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
