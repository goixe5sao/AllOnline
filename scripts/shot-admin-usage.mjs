import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Admin "Hạn mức live camera & nói chuyện": with someone live on the stage and two people talking,
 * the card shows the month's total used (live + voice together) and what is left under the cap.
 * Needs Cloudflare Realtime keys on the server.
 *   BASE=http://localhost:3100 node scripts/shot-admin-usage.mjs <outDir>
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
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
async function page(vp = { width: 1100, height: 720 }) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["microphone", "camera"]);
  const p = await ctx.newPage();
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
const owner = await page({ width: 1200, height: 1400 });
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ ứng dụng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng đo hạn mức", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Đo hạn mức" } } }) })).json();
});
await owner.evaluate(async (id) => {
  // anyone may go live in this test room
  await fetch(`/api/rooms/${id}`).catch(() => {});
}, room.roomId);
async function guest(name) {
  const p = await page();
  await p.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await p.type("form input[maxlength='60']", name);
  await p.click("form button.btn.primary");
  await p.waitForSelector(".orb", { timeout: 90000 });
  await sleep(1500);
  return p;
}
const lan = await guest("Lan");
const minh = await guest("Minh");
await orb(lan, "mic");
await orb(minh, "mic");
await orb(minh, "sound");
await orb(lan, "sound");
// the owner goes live from the room (moderators may always)
const stage = await page();
await stage.setCookie(...(await owner.cookies()));
await stage.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await stage.waitForSelector(".orb", { timeout: 90000 });
await orb(stage, "live");
await stage.waitForSelector(".live-panel");
await stage.evaluate(() => [...document.querySelectorAll(".live-panel button")].find((x) => x.textContent?.includes("Bật camera"))?.click());
await sleep(2500);
await stage.evaluate(() => document.querySelector(".live-go")?.click());
await sleep(20000); // let the meter count a little

await owner.goto(BASE + "/admin", { waitUntil: "networkidle0" });
await owner.waitForSelector(".usage-card", { timeout: 20000 });
await sleep(1500);
const t = await owner.$eval(".usage-card", (e) => e.textContent ?? "");
const u = await owner.evaluate(async () => (await fetch("/api/admin/live-usage")).json());
const nums = await owner.$$eval(".usage-num", (x) => x.map((e) => e.textContent));
check(/Đã dùng/.test(t) && /Còn lại/.test(t), `admin: “Đã dùng ${nums[0]}” · “Còn lại ${nums[1]}” · trần ${nums[2]}`);
check(u.usedGb > 0, `live camera + voice counted together (${u.usedGb} GB this month)`);
check(!/Giọng nói|Video \(live/.test(t), "one total only (no video / voice split shown)");
await owner.evaluate(() => document.querySelector(".usage-card")?.scrollIntoView({ block: "start" }));
await owner.evaluate(() => window.scrollBy(0, -80));
await sleep(500);
await owner.screenshot({ path: `${OUT}/admin-usage.png` });
await browser.close();
process.exit(failed ? 1 : 0);
