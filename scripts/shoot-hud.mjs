import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Room controls = one alien orb. Closed: nothing but a small status pill and the orb over the
 * 3D view. Open: every function on two arcs (+ reactions). Guest and owner, desktop and phone.
 *   BASE=http://localhost:3100 node scripts/shoot-hud.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 180000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const owner = await (await browser.createBrowserContext()).newPage();
owner.on("pageerror", (e) => errors.push(e.message));
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đêm nhạc Tương Lai — Sân khấu 3D", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }) })).json();
});
/** Buttons over the 3D view while the orb is closed (should be only the orb itself). */
const visibleControls = (p) =>
  p.evaluate(() => [...document.querySelectorAll(".room-root button, .room-root a")].filter((b) => { const r = b.getBoundingClientRect(); const st = getComputedStyle(b); return r.width > 0 && st.opacity !== "0" && st.visibility !== "hidden" && st.pointerEvents !== "none" && !b.closest(".fullscreen-view, .orb-item"); }).map((b) => b.getAttribute("aria-label") || b.textContent?.trim().slice(0, 20)));

const sizes = [
  ["desktop", { width: 1280, height: 760 }],
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];
for (const [name, vp] of sizes) {
  // guest
  const g = await (await browser.createBrowserContext()).newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  await g.setViewport(vp);
  await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await g.type("form input[maxlength='60']", "Khách " + name);
  await g.click("form button.btn.primary");
  await g.waitForSelector(".orb", { timeout: 60000 });
  await sleep(4500);
  const vis = await visibleControls(g);
  check(vis.length === 1, `guest ${name}: only the orb over the screen when closed (${vis.join(", ")})`);
  await g.screenshot({ path: `${OUT}/orb-guest-${name}-closed.png` });
  await g.click(".orb");
  await sleep(700);
  check((await g.$$eval(".orb-root.open .orb-item", (els) => els.length)) >= 8, `guest ${name}: orb opens with all functions`);
  await g.screenshot({ path: `${OUT}/orb-guest-${name}-open.png` });
  await g.evaluate(() => document.querySelector('[data-orb="react"]')?.click());
  await sleep(600);
  await g.screenshot({ path: `${OUT}/orb-guest-${name}-reactions.png` });
  await g.keyboard.press("Escape");
  await sleep(300);
  await orb(g, "chat");
  await sleep(300);
  check(!!(await g.$(".chat-box input")), `guest ${name}: chat opens from the orb`);
  await g.close();
  // owner
  await owner.setViewport(vp);
  await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
  await owner.waitForSelector(".orb", { timeout: 60000 });
  await sleep(3000);
  await owner.click(".orb");
  await sleep(700);
  check(!!(await owner.$('[data-orb="control"]')), `owner ${name}: “Điều khiển” in the orb`);
  await owner.screenshot({ path: `${OUT}/orb-owner-${name}-open.png` });
  await owner.keyboard.press("Escape");
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
