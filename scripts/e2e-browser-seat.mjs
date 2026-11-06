import puppeteer from "puppeteer-core";
/**
 * Browser end-to-end check (real Chrome, headless): tap a free seat in the 3D view → "Đến".
 *  A) auto-assign: seated user changes seat.  B) gate entry: user auto-walks there and takes it
 *     (also guards the regression where the browser never sent "move" messages).
 * Needs a running DEMO server:  PORT=3100 npm run dev   then
 *   BASE=http://localhost:3100 CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/e2e-browser-seat.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 120000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

async function owner() {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.goto(BASE + "/login", { waitUntil: "networkidle0" });
  await p.evaluate(async () => fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) }));
  await p.evaluate(async () => fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 10 }) }));
  return p;
}
async function guestInto(invite, name) {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 1280, height: 720 });
  await p.evaluateOnNewDocument(() => localStorage.setItem("ao-gfx", "lite")); // software 3D: keep each click fast
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/join/${invite}`, { waitUntil: "networkidle0" });
  await p.type("input[maxlength='60']", name);
  await p.click("button.btn.primary");
  await p.waitForSelector(".hud-top", { timeout: 60000 });
  await sleep(5000);
  return p;
}
// seat number lives in the status pill since the orb HUD ("· Chỗ S3")
const seatChip = (p) => p.evaluate(() => [...document.querySelectorAll(".hud-pill-sub, .hud-chip")].map((e) => e.textContent?.replace(/^·\s*/, "").trim()).find((t) => t?.startsWith("Chỗ")) ?? null);

/** Scan-click the 3D view until the "Chọn chỗ" popup appears. */
async function pickSeat(p) {
  for (let y = 700; y > 200; y -= 30)
    for (let x = 80; x < 1240; x += 40) {
      await p.mouse.click(x, y);
      const ok = await p.$("[aria-label='Chọn chỗ']");
      if (ok) return { x, y, text: await p.evaluate((el) => el.textContent, ok) };
    }
  return null;
}

const op = await owner();
await op.evaluate(async () => { const o = await (await fetch("/api/admin/overview")).json(); for (const r of o.rooms) if (r.status === "open") await fetch("/api/rooms/" + r.id + "/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); });
for (const [mode, label] of [["auto_assign", "A"], ["gate_entry", "B"]]) {
  const room = await op.evaluate(async (mode) => (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đổi chỗ " + mode, description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: mode, durationHours: 6, password: "" } }) })).json(), mode);
  const g = await guestInto(room.inviteCode, "Khách " + label);
  const frames = [];
  const cdp = await g.createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameSent", (e) => frames.push(e.response.payloadData));
  cdp.on("Network.webSocketFrameReceived", (e) => { const d = e.response.payloadData; if (d.includes("corrected") || d.includes("error")) frames.push("<= " + d); });
  console.log(`[${label}] before:`, await seatChip(g), (await g.evaluate(() => document.querySelector(".status-card")?.textContent?.slice(0, 60))) ?? "");
  if (label === "A") {
    // Look left and down from the front-row seat, like a user turning their head.
    await g.mouse.move(640, 300);
    await g.mouse.down();
    await g.mouse.move(340, 450, { steps: 15 });
    await g.mouse.up();
    await sleep(800);
  }
  const hit = await pickSeat(g);
  console.log(`[${label}] popup:`, hit);
  await g.screenshot({ path: `${OUT}/seatpick-${label}-popup.png` });
  await g.evaluate(() => [...document.querySelectorAll("[aria-label='Chọn chỗ'] button")].find((b) => b.textContent === "Đến")?.click());
  const seen = new Set();
  for (let i = 0; i < (label === "B" ? 30 : 5); i++) {
    await sleep(300);
    for (const t of await g.evaluate(() => [...document.querySelectorAll("[role=alert]")].map((e) => e.textContent))) seen.add(t);
  }
  console.log(`[${label}] alerts seen:`, [...seen]);
  console.log(`[${label}] after:`, await seatChip(g), "| toast:", await g.evaluate(() => [...document.querySelectorAll("[role=alert]")].map((e) => e.textContent).join(" / ")));
  const ev = await op.evaluate(async (id) => (await (await fetch("/api/rooms/" + id + "/logs")).json()).events.map((e) => e.type + (e.data?.seatId ? ":" + e.data.seatId : "")).reverse().join(", "), room.roomId);
  console.log(`[${label}] events:`, ev);
  const mv = frames.filter((f) => f.includes("move"));
  console.log(`[${label}] frames: moves=${mv.length} first=${mv[0]} last=${mv[mv.length - 1]}`);
  console.log(`[${label}] other:`, frames.filter((f) => !f.includes("move") && !f.includes("ping")).slice(0, 8));
  await g.screenshot({ path: `${OUT}/seatpick-${label}-after.png` });
  const ok = label === "A" ? (await seatChip(g)) !== "Chỗ S1" && (await seatChip(g))?.startsWith("Chỗ") : (await seatChip(g))?.startsWith("Chỗ");
  console.log(`${ok ? "PASS" : "FAIL"}  [${label}] seat change via tap + Đến`);
  if (!ok) failed++;
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
