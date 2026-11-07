import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Live camera on the stage screen, real Chrome with a fake camera + mic:
 *  - default "approve": a guest asks → the owner sees the request and approves;
 *  - the guest turns the camera on (preview), and goes live (needs the Cloudflare keys —
 *    without them the button is disabled and the panel says why);
 *  - REAL=1 (server has REALTIME_APP_ID / SECRET): the owner's stage screen shows the guest's
 *    camera, then the owner cuts the broadcast and the guest's camera stops;
 *  - "mods only" / "off" modes; the room log lists the live events.
 *   BASE=http://localhost:3100 [REAL=1] node scripts/e2e-live.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const REAL = process.env.REAL === "1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  protocolTimeout: 240000,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
async function page(vp = { width: 1200, height: 760 }) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["camera", "microphone"]);
  const p = await ctx.newPage();
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
const clickText = (p, sel, text) => p.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent?.includes(t) && !b.disabled)?.click() ?? null, sel, text);
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng live camera", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Sắp live" } } }) })).json();
});
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".orb", { timeout: 90000 });

const guest = await page({ width: 1100, height: 760 });
await guest.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
check((await guest.evaluate(() => document.body.innerText)).includes("chỉ người được chủ phòng cho phép mới live"), "invite page explains the camera rule");
await guest.type("form input[maxlength='60']", "Ca sĩ Mai");
await guest.click("form button.btn.primary");
await guest.waitForSelector(".orb", { timeout: 90000 });
await sleep(1500);

// ---- guest asks
await orb(guest, "live");
await guest.waitForSelector(".live-panel");
check(/Xin lên sóng/.test(await text(guest, ".live-panel")), "guest: “Xin lên sóng” (owner approves by default)");
await clickText(guest, ".live-panel button", "Xin lên sóng");
check(await waitFor(async () => /chờ chủ phòng duyệt/.test(await text(guest, ".live-panel"))), "guest: waiting for approval");

// ---- owner approves
await orb(owner, "control");
await owner.waitForSelector(".side-panel");
check(await waitFor(async () => /Live · 🙋1/.test(await text(owner, ".side-panel .tabs"))), "owner: the Live tab shows 1 request");
await clickText(owner, ".side-panel .tabs button", "Live");
await sleep(300);
check(/Ca sĩ Mai/.test(await text(owner, ".live-requests")), "owner: request from “Ca sĩ Mai” listed");
await owner.screenshot({ path: `${OUT}/live-owner-requests.png` });
await clickText(owner, ".live-requests button", "Duyệt");
check(await waitFor(async () => /đã cho bạn lên sóng/.test(await text(guest, ".live-panel"))), "guest: approved");

// ---- camera preview
await clickText(guest, ".live-panel button", "Bật camera");
check(await waitFor(() => guest.evaluate(() => (document.querySelector(".live-preview")?.videoWidth ?? 0) > 0)), "guest: camera preview plays (fake camera)");
const goBtn = await guest.$(".live-go");
const disabled = goBtn ? await goBtn.evaluate((b) => b.disabled) : null;
await guest.screenshot({ path: `${OUT}/live-guest-preview.png` });

if (!REAL) {
  check(disabled === true && /chưa bật dịch vụ video/.test(await text(guest, ".live-panel")), "without Cloudflare keys: “Lên sóng” disabled and the panel says why");
} else {
  check(disabled === false, "“Lên sóng” enabled (keys set)");
  await clickText(guest, ".live-panel button", "Lên sóng");
  check(await waitFor(async () => /Bạn đang live/.test(await text(guest, ".live-panel")), 20000), "guest: on air");
  check(await waitFor(() => owner.evaluate(() => [...document.querySelectorAll(".live-on-screen video")].some((v) => v.videoWidth > 0)), 30000), "owner: the stage screen shows the guest's camera (via Cloudflare)");
  check(/LIVE · Ca sĩ Mai/.test(await text(owner, ".live-badge")), "owner: “LIVE · Ca sĩ Mai” badge");
  await owner.screenshot({ path: `${OUT}/live-owner-screen.png` });
  // the whole camera picture fits the screen (a 4:3 camera used to show only its top part)
  const fit = await owner.evaluate(() => {
    const v = document.querySelector(".live-on-screen video");
    const box = document.querySelector(".live-on-screen");
    return { v: v.offsetHeight, box: box.offsetHeight, w: v.videoWidth, h: v.videoHeight, fit: getComputedStyle(v).objectFit };
  });
  check(fit.v <= fit.box + 1 && fit.fit === "contain", `whole camera picture on the screen (${fit.w}×${fit.h} camera, video ${fit.v}px in a ${fit.box}px screen)`);
  await clickText(owner, ".side-panel button", "Cắt sóng");
  check(await waitFor(async () => !(await guest.$(".live-panel .live-preview:not(.empty)"))), "owner cuts → guest's camera stops");
  check(await waitFor(async () => !(await owner.$(".live-on-screen"))), "owner: screen back to normal content");
}

// ---- modes
await owner.select('.side-panel select[aria-label="Chế độ live"]', "mods");
if (!(await guest.$(".live-panel"))) await orb(guest, "live");
check(await waitFor(async () => /Chỉ chủ phòng và trợ lý/.test(await text(guest, ".live-panel"))), "mods only: the guest is told only the owner / co-hosts can go live");
const openOrb = (p) => p.evaluate(() => {
  if (!document.querySelector(".orb-root")?.classList.contains("open")) document.querySelector(".orb")?.click();
});
await openOrb(guest);
await sleep(500);
check(!!(await guest.$('[data-orb="live"]')), "the guest's orb has the 🎥 Live button");
await owner.select('.side-panel select[aria-label="Chế độ live"]', "off");
check(await waitFor(async () => (await openOrb(guest), !(await guest.$('[data-orb="live"]')))), "off: the guest's 🎥 button disappears");
await owner.select('.side-panel select[aria-label="Chế độ live"]', "approve");

// ---- room log
await sleep(800);
const logPage = await (await browser.createBrowserContext()).newPage();
const cookies = await owner.cookies();
await logPage.setCookie(...cookies);
await logPage.goto(`${BASE}/room/${room.roomId}/logs`, { waitUntil: "networkidle0" });
const log = await logPage.evaluate(() => document.body.innerText);
check(/Xin lên sóng/.test(log) && /Được duyệt lên sóng/.test(log) && /Đổi quyền live camera/.test(log) && /Tắt live/.test(log), "room log: request, approval and mode changes");

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
