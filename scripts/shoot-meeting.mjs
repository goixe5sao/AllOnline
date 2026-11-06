import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * "Phòng họp" in real Chrome: a 12-seat meeting room with 9 guests (WebSocket bots), photographed
 * from the owner's camera, from a guest's chair, from the chairperson's chair (the owner attending
 * as a participant takes it), and with the lights off (presentation mode).
 * Also writes public/maps/meeting.webp (home page / room form preview).
 *   BASE=http://localhost:3100 node scripts/shoot-meeting.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);

class Bot {
  jar = new Map();
  constructor(name) {
    this.name = name;
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(path, body) {
    const res = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return res.json().catch(() => ({}));
  }
  async enter(invite, avatar) {
    await this.call("/api/guest", { displayName: this.name });
    const j = await this.call("/api/join", { inviteCode: invite });
    const { ticket } = await this.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(ticket), { headers: { origin: BASE, cookie: this.cookie } });
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.send(JSON.stringify({ t: "join", roomId: j.roomId, pass: j.pass, avatar }));
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
async function page(vp = { width: 1280, height: 800 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  return p;
}
const HIDE = ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel,.orb-root{display:none!important}";

const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Giám đốc Lan", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50, trial_max_capacity: 100 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Họp giao ban tuần", description: "", map: "meeting", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Họp giao ban tuần 45 — Báo cáo kết quả kinh doanh Q3" } } }) })).json();
});
check(!!room.roomId, `meeting room created (${room.roomId ? "ok" : JSON.stringify(room)})`);

// the new-room form offers it, with no stage style to pick
await owner.goto(BASE + "/rooms/new", { waitUntil: "networkidle0" });
const picked = await owner.evaluate(() => {
  const b = [...document.querySelectorAll("button.choice")].find((x) => x.textContent?.includes("Phòng họp"));
  b?.click();
  return !!b;
});
await sleep(400);
check(picked, "new room: “Phòng họp” is offered");
check(!(await owner.evaluate(() => document.body.textContent?.includes("Hành tinh tương lai"))), "new room: no stage style for a meeting room");
await owner.screenshot({ path: `${OUT}/meeting-new-room.png`, fullPage: false });

const MODELS = ["person-teal", "person-orange", "person-violet", "person-yellow", "person-navy", "person-rose"];
const bots = [];
for (let i = 0; i < 9; i++) {
  const b = new Bot(["An", "Bình", "Chi", "Dũng", "Hà", "Khoa", "Linh", "Minh", "Nga"][i]);
  await b.enter(room.inviteCode, { group: "people", model: MODELS[i % MODELS.length] });
  bots.push(b);
}
await sleep(1500);

// owner's camera
await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".canvas-wrap canvas", { timeout: 90000 });
await owner.addStyleTag({ content: HIDE });
await sleep(7000);
await owner.screenshot({ path: `${OUT}/meeting-owner.png` });

// a guest at the table
const guest = await page();
await guest.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
await guest.type("form input[maxlength='60']", "Phương");
await guest.click("form button.btn.primary");
await guest.waitForSelector(".canvas-wrap canvas", { timeout: 90000 });
await guest.addStyleTag({ content: HIDE });
await sleep(7000);
await guest.screenshot({ path: `${OUT}/meeting-guest.png` });

// the owner attends as a participant → the chairperson's seat
const chairP = await page();
const cookies = await owner.cookies();
await chairP.setCookie(...cookies);
await chairP.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
await chairP.evaluate(async (rid, code) => {
  const j = await (await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inviteCode: code }) })).json();
  sessionStorage.setItem(`ao-pass-${rid}`, j.pass);
  sessionStorage.setItem(`ao-mode-${rid}`, "participant");
  sessionStorage.setItem(`ao-avatar-${rid}`, JSON.stringify({ group: "people", model: "person-navy" }));
}, room.roomId, room.inviteCode);
await owner.close(); // one session per account
await chairP.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await chairP.waitForSelector(".canvas-wrap canvas", { timeout: 90000 });
await chairP.addStyleTag({ content: HIDE });
await sleep(7000);
await chairP.screenshot({ path: `${OUT}/meeting-chair.png` });
await chairP.screenshot({ path: `public/maps/meeting.webp`, type: "webp", quality: 78, clip: { x: 160, y: 100, width: 960, height: 600 } });

// the owner's panel: room lights, no stage styles
await chairP.addStyleTag({ content: ".orb-root{display:block!important}.side-panel{display:block!important}" });
await chairP.evaluate(() => document.querySelector(".orb")?.click());
await sleep(500);
await chairP.evaluate(() => document.querySelector('[data-orb="control"]')?.click());
await chairP.waitForSelector(".side-panel", { timeout: 10000 });
const panel = await chairP.$eval(".side-panel", (e) => e.textContent ?? "");
check(/Đèn phòng/.test(panel) && !/Hành tinh tương lai/.test(panel), "control panel: “Đèn phòng”, no stage styles");
await chairP.evaluate(() => document.querySelector(".side-panel .close, .side-panel button[aria-label='Đóng']")?.click());
await chairP.addStyleTag({ content: ".side-panel{display:none!important}" });

// lights off: presentation mode
await chairP.addStyleTag({ content: ".orb-root{display:block!important}" });
await chairP.evaluate(() => document.querySelector(".orb")?.click());
await sleep(500);
await chairP.evaluate(() => document.querySelector('[data-orb="lights"]')?.click());
await sleep(2500);
await chairP.addStyleTag({ content: ".orb-root{display:none!important}" });
await sleep(800);
await chairP.screenshot({ path: `${OUT}/meeting-chair-dark.png` });

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
for (const b of bots) b.ws?.close();
await browser.close();
process.exit(failed ? 1 : 0);
