import puppeteer from "puppeteer-core";
/**
 * Screenshots of the open orb menu: the owner's "Điều khiển" must stand out (desktop + phone),
 * a guest's menu has no such button.
 *   BASE=http://localhost:3100 node scripts/shot-orb.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
async function page(vp) {
  const p = await (await browser.createBrowserContext()).newPage();
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
const owner = await page({ width: 1200, height: 760 });
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng thử menu", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "glam", initialScreen: { kind: "text", text: "Menu quả cầu" } } }) })).json();
});
async function openOrb(p, name) {
  await p.waitForSelector(".orb", { timeout: 90000 });
  await sleep(2500);
  await p.evaluate(() => document.querySelector(".orb")?.click());
  await sleep(1200);
  await p.screenshot({ path: `${OUT}/${name}.png` });
}
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await openOrb(owner, "orb-owner");
const f = await owner.evaluate(() => {
  const b = document.querySelector(".orb-item.featured");
  const o = document.querySelector(".orb").getBoundingClientRect();
  const dist = (e) => { const r = e.getBoundingClientRect(); return Math.hypot(r.x + r.width / 2 - (o.x + o.width / 2), r.y + r.height / 2 - (o.y + o.height / 2)); };
  const others = [...document.querySelectorAll(".orb-item:not(.featured)")];
  return { id: b?.dataset.orb, w: b?.getBoundingClientRect().width, nearest: !!b && others.every((e) => dist(b) <= dist(e) + 4) };
});
check(f.id === "control", "owner: “Điều khiển” is the featured button");
check(f.w >= 60 && f.nearest, `bigger (${f.w}px) and in the first ring next to the orb`);
await owner.evaluate(() => document.querySelector('[data-orb="control"]')?.click());
check(!!(await owner.waitForSelector(".side-panel", { timeout: 10000 }).catch(() => null)), "it opens the control panel");

const phone = await page({ width: 390, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const cookies = await owner.cookies();
await phone.setCookie(...cookies);
await phone.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await openOrb(phone, "orb-owner-phone");

const guest = await page({ width: 1100, height: 700 });
await guest.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
await guest.type("form input[maxlength='60']", "Khách");
await guest.click("form button.btn.primary");
await openOrb(guest, "orb-guest");
check((await guest.$$(".orb-item.featured")).length === 0, "guest: no featured button");
await browser.close();
process.exit(failed ? 1 : 0);
