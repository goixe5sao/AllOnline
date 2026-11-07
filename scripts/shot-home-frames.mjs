import puppeteer from "puppeteer-core";
/**
 * Home page "sảnh": "Trải nghiệm ngay" and "Phòng của tôi" sit in framed windows under neon
 * signs; the reception robot invites you to open a room (first room / a new one); the demo text
 * spans the whole frame. Desktop + phone, with and without rooms.
 *   BASE=http://localhost:3100 node scripts/shot-home-frames.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new" });
const errors = [];
async function page(vp) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  return p;
}
async function shot(p, name) {
  await p.goto(BASE + "/", { waitUntil: "networkidle0" });
  await p.waitForSelector("#trai-nghiem .demo-card", { timeout: 30000 });
  await p.waitForSelector(".frame-mine .robot-invite", { timeout: 30000 });
  await p.evaluate(() => document.querySelector("#trai-nghiem")?.scrollIntoView());
  await p.evaluate(() => window.scrollBy(0, -70));
  await sleep(800);
  await p.screenshot({ path: `${OUT}/${name}.png` });
}

const owner = await page({ width: 1280, height: 1300 });
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ ứng dụng", asAppOwner: true }) });
});
await shot(owner, "home-frames-empty");
check(/mở sân khấu đầu tiên/.test(await owner.$eval(".frame-mine", (e) => e.textContent)), "no rooms: the robot offers to open the first one");
const lead = await owner.evaluate(() => {
  const p = document.querySelector(".demo-lead");
  const w = document.querySelector("#trai-nghiem .frame-window");
  const cs = getComputedStyle(w);
  return { p: p.getBoundingClientRect().width, inner: w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
});
check(Math.abs(lead.p - lead.inner) < 2, `demo text spans the frame (${Math.round(lead.p)} of ${Math.round(lead.inner)} px)`);
check((await owner.$$(".frame .desk-sign")).length === 2, "both sections framed under a neon sign");

// with a room
await owner.evaluate(async () => {
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Họp giao ban tuần", description: "", map: "meeting", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", initialScreen: { kind: "text", text: "Xin chào" } } }) });
});
await shot(owner, "home-frames-rooms");
check(/sân khấu mới/.test(await owner.$eval(".frame-mine", (e) => e.textContent)) && (await owner.$$(".frame-mine .mr")).length === 1, "with a room: the room card + the robot inviting a new one");
await owner.click(".robot-go");
await owner.waitForFunction(() => location.pathname === "/rooms/new", { timeout: 15000 }).catch(() => {});
check(new URL(owner.url()).pathname === "/rooms/new", "“Tạo phòng mới” opens the new-room form");

const phone = await page({ width: 390, height: 1600, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await phone.setCookie(...(await owner.cookies()));
await shot(phone, "home-frames-phone");

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
