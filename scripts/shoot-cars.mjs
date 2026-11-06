import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * Drive-in cars (VF 3 / VF 7 / Limo Green / VF Wild) + paint colours:
 *  - invite page: colour row, 3D preview of each model in the chosen colour;
 *  - the server keeps the chosen colour (bad colours are dropped → model colour);
 *  - drive-in room full of cars in many colours, seen from the owner's camera and from a guest
 *    looking at their own car from behind.
 *   BASE=http://localhost:3100 node scripts/shoot-cars.mjs <outDir>
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
    this.msgs = [];
    this.ws.on("message", (d) => this.msgs.push(JSON.parse(String(d))));
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.send(JSON.stringify({ t: "join", roomId: j.roomId, pass: j.pass, avatar }));
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const owner = await (await browser.createBrowserContext()).newPage();
owner.on("pageerror", (e) => errors.push(e.message));
await owner.setViewport({ width: 1280, height: 800 });
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ bãi xe", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Đêm phim VinFast", description: "", map: "drive_in", avatarGroups: ["vehicles"], officialCapacity: 16, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", initialScreen: { kind: "text", text: "Đêm phim ngoài trời 🚗" } } }) })).json();
});

// ---- invite page: colours + preview per model
const g = await (await browser.createBrowserContext()).newPage();
g.on("pageerror", (e) => errors.push(e.message));
await g.setViewport({ width: 520, height: 1100, deviceScaleFactor: 1 });
await g.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
check((await g.$$(".car-color")).length >= 12, "invite page shows the colour row");
const labels = await g.$$eval("[data-model]", (b) => b.map((x) => x.textContent?.trim()));
check(["VF 3", "VF 7", "Limo Green", "VF Wild"].every((n) => labels.some((l) => l?.includes(n))), `4 VinFast models offered (${labels.join(", ")})`);
for (const [model, colour] of [
  ["mini", "Hồng"],
  ["suv", "Đỏ"],
  ["sedan", "Trắng"],
  ["pickup", "Cam"],
]) {
  await g.click(`[data-model="${model}"]`);
  await g.click(`.car-color[aria-label="${colour}"]`);
  await sleep(2500);
  const el = await g.$(".car-preview");
  await el.screenshot({ path: `${OUT}/car-${model}.png` });
}
check(await g.$eval('.car-color[aria-label="Cam"]', (b) => b.getAttribute("aria-checked") === "true"), "picked colour is marked");
await g.evaluate(() => document.querySelector(".car-colors")?.scrollIntoView({ block: "center" }));
await g.screenshot({ path: `${OUT}/car-join-colours.png` });

// guest enters in an orange VF Wild → own car seen from behind
await g.type("form input[maxlength='60']", "Tài xế VF Wild");
await g.setViewport({ width: 1280, height: 760 });
await g.click("form button.btn.primary");
await g.waitForSelector(".orb", { timeout: 90000 });

// bots: every model in many colours (+ one bad colour → falls back to the model colour)
const MODELS = ["mini", "suv", "sedan", "pickup"];
const COLS = ["#f2c230", "#c8102e", "#f2f2ee", "#16181c", "#1f8f7a", "#5bc0de", "#e98aa6", "#b8bcc2", "#1d4f91", "#8cc63f", "#7a1f2b"];
const bots = [];
for (let i = 0; i < 11; i++) {
  const b = new Bot(`Xe ${i + 1}`);
  await b.enter(room.inviteCode, { group: "vehicles", model: MODELS[i % 4], color: i === 10 ? "#123456" : COLS[i] });
  bots.push(b);
}
await sleep(1500);
const welcome = bots[10].msgs.find((m) => Array.isArray(m.members));
const mem = welcome?.members ?? [];
const byName = (n) => mem.find((m) => m.name === n)?.avatar;
check(byName("Xe 2")?.color === "#c8102e", "server keeps a palette colour");
check(byName("Xe 11") && byName("Xe 11").color === undefined, "server drops a colour outside the palette");
check(byName("Tài xế VF Wild")?.color === "#e8702a" && byName("Tài xế VF Wild")?.model === "pickup", "browser guest joined with the chosen car + colour");

await sleep(5000);
await g.screenshot({ path: `${OUT}/car-guest-behind.png` });

await owner.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
await owner.waitForSelector(".canvas-wrap canvas", { timeout: 60000 });
await owner.addStyleTag({ content: ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel{display:none!important}" });
await sleep(7000);
await owner.screenshot({ path: `${OUT}/car-lot-owner.png` });

for (const b of bots) b.ws?.close();
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
