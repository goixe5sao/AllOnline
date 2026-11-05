import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * Screenshots of the stage looks ("glam" / "plain") and the boy / girl avatars (seated on chairs,
 * on the carpet, standing at the gate), in real Chrome; the audience are WebSocket bots.
 *   BASE=http://localhost:3100 node scripts/shoot-stage.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const PEOPLE = ["person-teal", "person-orange", "person-violet", "person-yellow", "person-navy", "person-rose"];

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
  async enter(invite, model) {
    await this.call("/api/guest", { displayName: this.name });
    const j = await this.call("/api/join", { inviteCode: invite });
    const { ticket } = await this.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(ticket), { headers: { origin: BASE, cookie: this.cookie } });
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.send(JSON.stringify({ t: "join", roomId: j.roomId, pass: j.pass, avatar: { group: "people", model } }));
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 180000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const owner = await (await browser.createBrowserContext()).newPage();
owner.on("pageerror", (e) => errors.push(e.message));
await owner.setViewport({ width: 1280, height: 760 });
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 20, trial_max_capacity: 100, total_slot_budget: 2000 }) });
});
const mk = (map, style, entryMode = "auto_assign") =>
  owner.evaluate(
    async (map, style, entryMode) =>
      (
        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ useTrial: true, config: { name: "Đêm nhạc Tương Lai", description: "", map, avatarGroups: ["people"], officialCapacity: 40, waitingEnabled: false, entryMode, durationHours: 6, isPublic: false, password: "", stageStyle: style, initialScreen: { kind: "text", text: "Đêm nhạc Tương Lai ✨" } } }),
        })
      ).json(),
    map,
    style,
    entryMode,
  );

async function guestPage(invite, model, vp = { width: 1280, height: 760 }) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport(vp);
  await p.goto(`${BASE}/join/${invite}`, { waitUntil: "networkidle0" });
  await p.type("form input[maxlength='60']", "Tôi");
  await p.evaluate((model) => [...document.querySelectorAll("form button")].find((b) => b.getAttribute("aria-label")?.includes(model) || b.dataset?.model === model)?.click(), model);
  await p.click("form button.btn.primary");
  await p.waitForSelector(".hud-top", { timeout: 60000 });
  await sleep(6000);
  await p.addStyleTag({ content: ".hud-bottom .chat-box,.status-card{display:none!important}" });
  return p;
}

// ---- hall, glam, 26 people ----
const hall = await mk("hall", "glam");
const bots = [];
for (let i = 0; i < 26; i++) {
  const b = new Bot(`Khách ${i + 1}`);
  await b.enter(hall.inviteCode, PEOPLE[i % PEOPLE.length]);
  bots.push(b);
}
await sleep(1500);
await owner.goto(`${BASE}/room/${hall.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".canvas-wrap canvas", { timeout: 60000 });
await owner.addStyleTag({ content: ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel{display:none!important}" });
await sleep(7000);
await owner.screenshot({ path: `${OUT}/stage-glam-hall.png` });
const me = await guestPage(hall.inviteCode, "person-rose");
await me.screenshot({ path: `${OUT}/stage-glam-seated.png` });
check(errors.length === 0, "glam hall renders without errors");

// switch to plain while the room is open (owner API) → everyone sees it at once
const sw = await owner.evaluate(async (id) => (await fetch(`/api/rooms/${id}/stage-style`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: "plain" }) })).status, hall.roomId);
check(sw === 200, "owner switches the stage to plain");
await sleep(2500);
await me.screenshot({ path: `${OUT}/stage-plain-seated.png` });
await owner.screenshot({ path: `${OUT}/stage-plain-hall.png` });
await owner.evaluate(async (id) => fetch(`/api/rooms/${id}/stage-style`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: "glam" }) }), hall.roomId);
await sleep(2000);
// owner's free camera swung round to the stage side: faces of the audience
await owner.mouse.move(640, 300);
await owner.mouse.down();
for (let i = 1; i <= 19; i++) await owner.mouse.move(640 + i * 20, 300 + i * 6);
await owner.mouse.up();
await sleep(400);

for (const b of bots) b.ws.close();
await me.close();

// ---- carpet (sitting on the floor) and gate entry (standing), glam ----
const carpet = await mk("carpet", "glam");
const cb = [];
for (let i = 0; i < 12; i++) {
  const b = new Bot(`Bạn ${i + 1}`);
  await b.enter(carpet.inviteCode, PEOPLE[(i + 2) % PEOPLE.length]);
  cb.push(b);
}
const cme = await guestPage(carpet.inviteCode, "person-navy");
await cme.screenshot({ path: `${OUT}/stage-glam-carpet.png` });
for (const b of cb) b.ws.close();
await cme.close();

// owner's free camera swung round behind the stage, low: faces of the audience
const faces = await mk("hall", "glam");
const fb = [];
for (let i = 0; i < 18; i++) {
  const b = new Bot(`Bạn ${i + 1}`);
  await b.enter(faces.inviteCode, PEOPLE[i % PEOPLE.length]);
  fb.push(b);
}
await owner.goto(`${BASE}/room/${faces.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".canvas-wrap canvas", { timeout: 60000 });
await owner.addStyleTag({ content: ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel{display:none!important}" });
await sleep(4000);
const drag = async (dx, dy) => {
  await owner.mouse.move(640, 380);
  await owner.mouse.down();
  for (let i = 1; i <= 20; i++) await owner.mouse.move(640 + (dx * i) / 20, 380 + (dy * i) / 20);
  await owner.mouse.up();
  await sleep(300);
};
await drag(380, 0); // half a turn: the camera goes to the stage side
await drag(0, -110); // lower towards the horizon
for (let i = 0; i < 6; i++) await owner.mouse.wheel({ deltaY: -250 });
await sleep(2500);
await owner.screenshot({ path: `${OUT}/stage-glam-faces.png` });
for (const b of fb) b.ws.close();

const gate = await mk("hall", "glam", "gate_entry");
const gme = await guestPage(gate.inviteCode, "person-violet", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await gme.screenshot({ path: `${OUT}/stage-glam-mobile-standing.png` });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
process.exit(failed ? 1 : 0);
