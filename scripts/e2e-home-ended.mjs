import puppeteer from "puppeteer-core";
/**
 * Home page hides rooms that have ended:
 *  - "Phòng của tôi" shows only open rooms; ended ones sit behind "Xem N phòng đã kết thúc";
 *  - the public "Phòng đang mở" list never shows a closed room.
 *   BASE=http://localhost:3100 node scripts/e2e-home-ended.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const errors = [];
const p = await (await browser.createBrowserContext()).newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.setViewport({ width: 1280, height: 900 });
await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
const ids = await p.evaluate(async () => {
  const j = (path, method, body) => fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
  await j("/api/auth/demo-login", "POST", { displayName: "Chủ nhiều phòng", asAppOwner: true });
  await j("/api/admin/settings", "PATCH", { total_slot_budget: 3000, trial_rooms_per_account: 50 });
  const mk = (name) => j("/api/rooms", "POST", { useTrial: true, config: { name, description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "" } });
  const a = await mk("Phòng còn mở A");
  const b = await mk("Phòng còn mở B");
  const c = await mk("Phòng đã đóng C");
  await j(`/api/rooms/${c.roomId}/close`, "POST", {});
  return { a: a.roomId, b: b.roomId, c: c.roomId };
});
check(!!ids.a && !!ids.c, "3 rooms created, one closed");
await p.goto(BASE + "/", { waitUntil: "networkidle0" });
await p.waitForSelector(".mr-grid .mr", { timeout: 15000 });
const titles = () => p.$$eval(".mr-grid .mr h3", (h) => h.map((x) => x.textContent));
let t = await titles();
check(t.length === 2 && !t.includes("Phòng đã đóng C"), `“Phòng của tôi” shows only the open rooms (${t.join(", ")})`);
const btn = await p.$eval(".mr-more", (b) => b.textContent).catch(() => "");
check(/Xem 1 phòng đã kết thúc/.test(btn), `button “${btn}”`);
await p.evaluate(() => document.querySelector("#my-rooms-h")?.scrollIntoView());
await p.screenshot({ path: `${OUT}/home-my-rooms.png` });
await p.click(".mr-more");
await sleep(200);
t = await titles();
check(t.length === 3 && t.includes("Phòng đã đóng C"), "tap → the ended room appears (dimmed)");
check(await p.$eval(".mr.ended h3", (h) => h.textContent).then((x) => x === "Phòng đã đóng C").catch(() => false), "ended room is marked as ended");
const pub = await p.evaluate(async () => (await (await fetch("/api/rooms/public")).json()).rooms.map((r) => r.name));
check(pub.includes("Phòng còn mở A") && !pub.includes("Phòng đã đóng C"), "public list: open rooms only");
const html = await p.evaluate(() => document.body.innerText);
check(!html.includes("Phòng đã đóng C") || (await p.$(".mr.ended")), "home page shows the closed room nowhere except the expanded “ended” list");
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
