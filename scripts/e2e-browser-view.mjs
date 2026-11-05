import puppeteer from "puppeteer-core";
/**
 * Screenshots of the participant camera (real headless Chrome):
 *  - own view, level with the stage-screen centre (seated, and right after joining via the gate),
 *  - ↓ = view from 2 rows behind (own avatar visible), ↑ = back.
 * Needs a running DEMO server (see e2e-browser-seat.mjs):
 *   BASE=http://localhost:3100 node scripts/e2e-browser-view.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
let failed = 0;

const op = await (await browser.createBrowserContext()).newPage();
await op.goto(BASE + "/login", { waitUntil: "networkidle0" });
await op.evaluate(async () => fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) }));
await op.evaluate(async () => fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 10, trial_max_capacity: 100 }) }));
await op.evaluate(async () => { const o = await (await fetch("/api/admin/overview")).json(); for (const r of o.rooms) if (r.status === "open") await fetch("/api/rooms/" + r.id + "/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); });
const mkRoom = (mode) => op.evaluate(async (mode) => (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Góc nhìn " + mode, description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 60, waitingEnabled: false, entryMode: mode, durationHours: 6, password: "" } }) })).json(), mode);

async function guest(invite, name, wait = 1500) {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/join/${invite}`, { waitUntil: "networkidle0" });
  await p.type("input[maxlength='60']", name);
  await p.click("button.btn.primary");
  await p.waitForSelector(".hud-top", { timeout: 60000 });
  await sleep(wait);
  return p;
}

// A) auto-assign: fill the front row, then a guest seated in the 2nd row.
const a = await mkRoom("auto_assign");
const crowd = [];
for (let i = 0; i < 14; i++) {
  const p = await guest(a.inviteCode, "Khách " + (i + 1), 300);
  // "Xem màn hình" pauses the 3D render loop, so the crowd tabs cost almost no CPU.
  await p.evaluate(() => [...document.querySelectorAll(".hud-btn")].find((x) => x.textContent === "Xem màn hình")?.click());
  crowd.push(p);
}
const me = await guest(a.inviteCode, "Tôi", 5000);
await me.screenshot({ path: `${OUT}/view-seated-own.png` });
await me.keyboard.press("ArrowDown");
await sleep(1500);
await me.screenshot({ path: `${OUT}/view-seated-behind.png` });
const behindBtn = await me.evaluate(() => [...document.querySelectorAll(".hud-btn")].map((b) => b.textContent).find((t) => t?.includes("Góc của tôi")) ?? null);
await me.keyboard.press("ArrowUp");
await sleep(1000);
const backBtn = await me.evaluate(() => [...document.querySelectorAll(".hud-btn")].map((b) => b.textContent).find((t) => t?.includes("Xem từ phía sau")) ?? null);
console.log("seat:", await me.evaluate(() => [...document.querySelectorAll(".hud-chip")].map((e) => e.textContent).find((t) => t?.startsWith("Chỗ"))));
console.log(behindBtn && backBtn ? "PASS  ↓ / ↑ toggles the behind view" : "FAIL  toggle", behindBtn, backBtn);
if (!behindBtn || !backBtn) failed++;

// B) gate entry: the view right after joining (walking, before taking a seat).
await op.evaluate(async (id) => fetch("/api/rooms/" + id + "/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), a.roomId);
const b = await mkRoom("gate_entry");
if (!b.inviteCode) throw new Error("create room B: " + JSON.stringify(b));
const walker = await guest(b.inviteCode, "Khách mới", 5000);
await walker.screenshot({ path: `${OUT}/view-join-gate.png` });
// The behind-view button also works while walking.
await walker.evaluate(() => [...document.querySelectorAll(".hud-btn")].find((x) => x.textContent?.includes("Xem từ phía sau"))?.click());
await sleep(1500);
await walker.screenshot({ path: `${OUT}/view-join-gate-behind.png` });

console.log("errors:", errors.length ? errors : "none");
for (const p of crowd) await p.close();
await browser.close();
process.exit(failed ? 1 : 0);
