import puppeteer from "puppeteer-core";
import { orb } from "./orb.mjs";
/**
 * Voice chat with the people around, in real Chrome with a fake mic (a beeping tone) through
 * Cloudflare Realtime (the server needs REALTIME_APP_ID / SECRET):
 *  - Lan (S1) and Minh (S2) sit side by side, Hà moves to a seat far at the back;
 *  - Lan turns her mic on → Minh hears her (audio level > 0, placed left/right, stage turned
 *    down while she talks); Hà, too far, does not get her voice at all;
 *  - Minh blocks Lan just for himself → silent for him;
 *  - the owner turns Lan's mic off → her mic chip disappears, she is told;
 *  - "Chỉ tài khoản đăng ký": guests lose the mic button;
 *  - "Nói riêng với nhóm": Lan talks only with Minh, Tú (near too) is cut both ways, then back;
 *  - two-way talk; after a network drop the mic comes back by itself;
 *  - server stays responsive (ping) the whole time.
 *   BASE=http://localhost:3100 node scripts/e2e-voice.mjs <outDir>
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
const errors = [];
async function page(vp = { width: 1100, height: 720 }) {
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE, ["microphone", "camera"]);
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
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn().catch(() => false)) return true;
    await sleep(400);
  }
  return false;
}
const dbg = (p) => p.evaluate(() => window.__aoVoice?.debugState() ?? null);
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);

const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50, trial_max_capacity: 100 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng nói chuyện", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 48, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Nói chuyện với người xung quanh" } } }) })).json();
});
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".orb", { timeout: 90000 });

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
const ha = await guest("Hà");
const tu = await guest("Tú"); // sits next to them (S3)
// Hà moves to the last row, far corner (> 8 m from the front row)
await orb(ha, "seats");
await ha.waitForSelector('[aria-label="Chỗ S48"]');
await ha.evaluate(() => document.querySelector('[aria-label="Chỗ S48"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
await sleep(1500);
check(/S48/.test(await text(ha, ".hud-pill")), `Hà moved far away (${(await text(ha, ".hud-pill")).trim()})`);

// ---- Lan turns her mic on
check(!!(await lan.evaluate(() => document.querySelector('[data-orb="mic"]') || (document.querySelector(".orb")?.click(), null))) || (await waitFor(() => lan.evaluate(() => !!document.querySelector('[data-orb="mic"]')), 3000)), "guest: 🎤 Bật mic in the orb");
await orb(lan, "mic");
check(await waitFor(async () => (await dbg(lan))?.micOn === true, 20000), "Lan: mic on (published to Cloudflare)");
check(await waitFor(async () => /Mic đang bật/.test(await text(lan, ".hud-status")), 5000), "Lan: “🎙️ Mic đang bật” chip");

// Minh (next seat): sound on, then he should get Lan's voice
await minh.evaluate(() => document.body.click());
await orb(minh, "sound");
const lanId = await lan.evaluate(async () => (await (await fetch("/api/me")).json()).user?.id);
check(await waitFor(async () => !!(await dbg(minh))?.voices?.[lanId]?.connected, 25000), "Minh: Lan's voice arrives (one track pulled)");
let peak = 0;
for (let i = 0; i < 20; i++) {
  const d = await dbg(minh);
  peak = Math.max(peak, d?.voices?.[lanId]?.level ?? 0);
  await sleep(250);
}
check(peak > 0.005, `Minh hears sound from Lan (peak level ${peak})`);
const md = await dbg(minh);
check(md.ctx === "running", `Minh: audio running (${md.ctx}, output gain ${md.out})`);
// stage turned down while Lan talks (the fake mic beeps)
let ducked = false;
for (let i = 0; i < 20 && !ducked; i++) {
  ducked = (await dbg(minh))?.duck === true;
  await sleep(200);
}
check(ducked, "Minh: stage sound turned down while Lan talks");
// Hà is far: nothing pulled
await sleep(2000);
check(!(await dbg(ha))?.voices?.[lanId], "Hà (far away): Lan's voice not pulled at all");

// ---- Minh blocks Lan just for himself
await orb(minh, "voice");
await minh.waitForSelector(".voice-person", { timeout: 10000 });
await minh.screenshot({ path: `${OUT}/voice-settings.png` });
await minh.evaluate(() => document.querySelector(".voice-person")?.click());
check(await waitFor(async () => ((await dbg(minh))?.voices?.[lanId]?.gain ?? 1) < 0.05, 5000), "Minh blocks Lan → silent for him");
await minh.evaluate(() => document.querySelector(".voice-person")?.click());
check(await waitFor(async () => ((await dbg(minh))?.voices?.[lanId]?.gain ?? 0) > 0.9, 5000), "unblock → he hears her again");

// ---- two-way: Minh talks too, Lan hears him
await minh.keyboard.press("Escape");
await orb(minh, "mic");
const minhId = await minh.evaluate(async () => (await (await fetch("/api/me")).json()).user?.id);
check(await waitFor(async () => !!(await dbg(lan))?.voices?.[minhId]?.connected, 25000), "two-way: Lan hears Minh too");
await orb(minh, "mic");

// ---- network drop: Lan offline 4 s → reconnects, her mic comes back by itself
await lan.setOfflineMode(true);
await sleep(4000);
await lan.setOfflineMode(false);
check(await waitFor(async () => (await dbg(lan))?.micOn === true && !!(await dbg(minh))?.voices?.[lanId]?.connected, 40000), "after a network drop Lan's mic is back and Minh hears her again");

// ---- "Nói riêng với nhóm": Lan talks only with Minh, so Tú (also near) no longer gets her voice
const tuId = await tu.evaluate(async () => (await (await fetch("/api/me")).json()).user?.id);
await orb(tu, "sound");
check(await waitFor(async () => !!(await dbg(tu))?.voices?.[lanId]?.connected, 25000), "before: Tú (near) hears Lan too");
await orb(lan, "voice");
await lan.waitForSelector(".voice-pick", { timeout: 10000 });
await lan.evaluate(() => [...document.querySelectorAll(".voice-pick")].find((l) => l.textContent?.includes("Minh"))?.querySelector("input")?.click());
await lan.evaluate(() => [...document.querySelectorAll(".voice-group button")].find((b) => b.textContent?.includes("Chỉ nói với"))?.click());
check(await waitFor(async () => /Nói riêng với 1 người/.test(await text(lan, ".hud-status")), 5000), "Lan: the lock chip (talking only with 1 person)");
await lan.screenshot({ path: `${OUT}/voice-group.png` });
check(await waitFor(async () => !(await dbg(tu))?.voices?.[lanId], 10000), "Tú no longer receives Lan's voice (cut by the server)");
check(!!(await dbg(minh))?.voices?.[lanId]?.connected, "Minh (in her group) still hears her");
await orb(tu, "mic");
check(await waitFor(async () => !!(await dbg(minh))?.voices?.[tuId]?.connected, 25000), "Tú talks: Minh (no group) hears him");
await sleep(2500);
check(!(await dbg(lan))?.voices?.[tuId], "but Lan (talking only with Minh) does not");
await lan.evaluate(() => document.querySelector(".voice-group-chip")?.click());
check(await waitFor(async () => !!(await dbg(tu))?.voices?.[lanId]?.connected && !!(await dbg(lan))?.voices?.[tuId]?.connected, 25000), "back to everyone around: Tú and Lan hear each other again");
await orb(tu, "mic");

// ---- the owner sees the open mic and turns it off
await orb(owner, "control");
await owner.waitForSelector(".side-panel");
await owner.evaluate(() => [...document.querySelectorAll(".side-panel .tabs button, .side-panel [role=tab], .side-panel button")].find((b) => b.textContent?.startsWith("Người tham dự"))?.click());
check(await waitFor(async () => /Lan/.test(await text(owner, ".voice-mics")), 10000), "owner: Lan listed with an open mic");
await owner.screenshot({ path: `${OUT}/voice-owner.png` });
await owner.evaluate(() => [...document.querySelectorAll(".voice-mics button")].find((b) => b.textContent?.includes("Tắt mic"))?.click());
check(await waitFor(async () => (await dbg(lan))?.micOn === false && !/Mic đang bật/.test(await text(lan, ".hud-status")), 8000), "owner turns Lan's mic off → off on her side");
check(await waitFor(async () => !(await dbg(minh))?.voices?.[lanId], 8000), "…and Minh no longer pulls her voice");

// ---- only registered accounts may talk
await owner.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Chế độ nói chuyện"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "accounts");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(1200);
await lan.evaluate(() => document.querySelector(".orb-root.open") || document.querySelector(".orb")?.click());
await sleep(500);
check(!(await lan.$('[data-orb="mic"]')), "“Chỉ tài khoản đăng ký”: the guest's mic button is gone");

// server stayed responsive
const t0 = Date.now();
await owner.evaluate(() => fetch("/api/me").then((r) => r.json()));
check(Date.now() - t0 < 1500, `server responsive (${Date.now() - t0} ms)`);

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
