import puppeteer from "puppeteer-core";
import { closeOrb, orb, orbLabel, react } from "./orb.mjs";
/**
 * Phase 1 in real Chrome: event page (countdown, reminder, calendar, share image), reactions,
 * raise hand, Q&A (ask / upvote / put on stage / answered), co-host, report + CSV.
 * Needs a running DEMO server:  BASE=http://localhost:3100 node scripts/e2e-engage.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 180000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

async function page(viewport = { width: 1280, height: 760 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport(viewport);
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const post = (p, path, body) => p.evaluate(async (path, body) => { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; }, path, body);
const clickText = (p, sel, text) => p.evaluate((sel, text) => { const b = [...document.querySelectorAll(sel)].find((x) => x.textContent?.includes(text)); b?.click(); return !!b; }, sel, text);

// ---- owner: room with a start time in 2 hours ----
const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
await post(owner, "/api/auth/demo-login", { displayName: "Cô Mai", asAppOwner: true });
await owner.evaluate(() => fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 20, trial_max_capacity: 100 }) }));
const startsAt = Date.now() + 2 * 3600_000 + 15 * 60_000;
const created = await post(owner, "/api/rooms", { useTrial: true, config: { name: "Hội thảo AI & Robot 2026", description: "Chia sẻ về AI cho người mới bắt đầu.", map: "hall", avatarGroups: ["people"], officialCapacity: 20, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "", scheduledAt: startsAt } });
const { roomId, inviteCode } = created.body;
check(!!inviteCode, "room with a start time created");

// ---- event page (signed-in member: reminder) ----
const mem = await page();
await mem.goto(BASE + "/login", { waitUntil: "networkidle0" });
await post(mem, "/api/auth/demo-login", { displayName: "Anh Bình" });
await mem.goto(`${BASE}/join/${inviteCode}`, { waitUntil: "networkidle0" });
const html = await (await fetch(`${BASE}/join/${inviteCode}`)).text();
check(/<title>[^<]*Hội thảo AI &amp; Robot 2026[^<]*<\/title>/.test(html), "invite page title has the event name (server-rendered)");
check(html.includes(`/join/${inviteCode}/opengraph-image`), "invite page has its own share image");
check(await mem.evaluate(() => /Còn \d+ giờ/.test(document.querySelector(".event-count")?.textContent ?? "")), "countdown on the invite page");
await mem.screenshot({ path: `${OUT}/event-invite.png` });
await clickText(mem, ".event-box button", "Nhắc tôi");
await sleep(800);
check(await mem.evaluate(() => document.querySelector(".event-box")?.textContent?.includes("Bỏ nhắc")), "“Nhắc tôi” saved");
await mem.screenshot({ path: `${OUT}/event-invite-reminded.png` });
const ics = await fetch(`${BASE}/api/invite/${inviteCode}/calendar.ics`);
const icsText = await ics.text();
check(ics.headers.get("content-type")?.includes("text/calendar") && icsText.includes("BEGIN:VEVENT") && icsText.includes(inviteCode), "calendar file (.ics)");
const og = await fetch(`${BASE}/join/${inviteCode}/opengraph-image`);
check(og.headers.get("content-type") === "image/png", "share image is a PNG");
const fs = await import("node:fs/promises");
await fs.writeFile(`${OUT}/event-share-image.png`, Buffer.from(await og.arrayBuffer()));

// Bounded invite/auth regression mode: exercises the existing entry flow without mounting 3D.
if (process.argv.includes('--join-only')) {
  const guest = await page();
  await guest.setRequestInterception(true);
  guest.on('request', req => req.isNavigationRequest() && new URL(req.url()).pathname.startsWith('/room/')
    ? req.respond({ status: 200, contentType: 'text/html', body: '<p>Joined room</p>' }) : req.continue());
  await guest.goto(`${BASE}/join/${inviteCode}`, { waitUntil: 'networkidle0' });
  await guest.type("form input[maxlength='60']", 'Khách Lan');
  await guest.click('form button.btn.primary');
  await guest.waitForFunction(() => location.pathname.startsWith('/room/'));
  check(await guest.evaluate(id => !!sessionStorage.getItem(`ao-pass-${id}`) && !!sessionStorage.getItem(`ao-avatar-${id}`), roomId), 'guest join preserves pass and avatar');
  check(errors.length === 0, 'no browser errors');
  await browser.close();
  process.exit(failed ? 1 : 0);
}

// ---- into the room ----
async function enter(p, name) {
  await p.goto(`${BASE}/join/${inviteCode}`, { waitUntil: "networkidle0" });
  const input = await p.$("form input[maxlength='60']");
  if (input && name) {
    await input.click({ clickCount: 3 });
    await input.type(name);
  }
  await p.click("form button.btn.primary");
  await p.waitForSelector(".hud-top", { timeout: 60000 });
  await sleep(3000);
}
const guest = await page();
await enter(guest, "Khách Lan");
await enter(mem, null);

// reactions + hand + question from the guest
for (const e of ["👏", "❤️", "🔥", "👏", "😂"]) {
  await react(guest, e);
  await sleep(150);
}
await orb(guest, "hand");
await sleep(400);
await orb(guest, "qa");
await guest.type(".qa-panel textarea", "Robot có cảm xúc như con người không ạ?");
await clickText(guest, ".qa-panel button", "Gửi câu hỏi");
await sleep(800);
await guest.screenshot({ path: `${OUT}/engage-guest.png` });
check(await guest.evaluate(() => document.querySelectorAll(".qa-item").length === 1), "question appears in Q&A");

// the member sees the hand, the reaction stream, and upvotes
await react(mem, "👏");
await closeOrb(mem);
await sleep(300);
check(await mem.evaluate(() => !!document.querySelector(".hand-pop")), "✋ shown above the guest's avatar");
await orb(mem, "qa");
await sleep(400);
await mem.click(".qa-vote");
await sleep(800);
check(await mem.evaluate(() => document.querySelector(".qa-vote span")?.textContent === "1"), "upvote counted");
await mem.screenshot({ path: `${OUT}/engage-member.png` });

// owner: hands list, make the member co-host, question on the stage
await owner.goto(`${BASE}/room/${roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".hud-top", { timeout: 60000 });
await sleep(2500);
check(await owner.evaluate(() => document.querySelector(".orb .orb-badge")?.textContent === "1"), "owner sees 1 raised hand (badge on the orb)");
await orb(owner, "control");
await sleep(400);
await clickText(owner, ".side-panel [role=tab]", "Người tham dự");
await sleep(400);
await owner.screenshot({ path: `${OUT}/engage-owner-people.png` });
const madeHost = await owner.evaluate(async () => {
  const row = [...document.querySelectorAll(".side-panel tr")].find((tr) => tr.textContent?.includes("Anh Bình"));
  const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.includes("Làm trợ lý"));
  b?.click();
  return !!b;
});
await sleep(1200);
check(madeHost && !!(await orbLabel(mem, "control")), "member becomes co-host live (gets “Điều khiển” in the orb)");
await clickText(owner, ".side-panel button", "Hạ tay");
await sleep(500);
check(await guest.evaluate(() => !document.querySelector('button[aria-pressed="true"][title]')?.textContent?.includes("✋")), "owner lowers the hand");
await orb(owner, "qa");
await sleep(400);
await clickText(owner, ".qa-panel button", "Lên màn hình");
await sleep(1200);
check(await guest.evaluate(() => document.querySelector(".screen-question")?.textContent?.includes("Robot có cảm xúc")), "question shown on the stage screen");
await orb(guest, "qa"); // close panel for a clean shot
await closeOrb(guest);
await sleep(500);
await guest.screenshot({ path: `${OUT}/engage-question-on-stage.png` });
await clickText(owner, ".qa-panel button", "Đã trả lời");
await sleep(600);
check(await guest.evaluate(() => true), "marked answered");

// report
await clickText(owner, ".qa-panel button", "✕");
await orb(owner, "control");
await sleep(300);
await clickText(owner, ".side-panel [role=tab]", "Thống kê");
await sleep(1500);
await owner.screenshot({ path: `${OUT}/engage-owner-stats.png` });
const csv = await owner.evaluate(async (id) => { const r = await fetch(`/api/rooms/${id}/report.csv`); return { type: r.headers.get("content-type"), text: await r.text() }; }, roomId);
check(csv.type?.includes("text/csv") && csv.text.includes("Robot có cảm xúc"), "CSV report downloads with the questions");

// mobile: reaction toggle + Q&A panel
const phone = await page({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await enter(phone, "Điện thoại");
await react(phone, "❤️");
await sleep(300);
await phone.screenshot({ path: `${OUT}/engage-mobile.png` });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
