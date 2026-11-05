import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * Preview images for the home page: one public room per MAP, filled with seated guests
 * (WebSocket bots, no browser), photographed from the room owner's camera in real Chrome.
 * Writes public/maps/<map>.webp. Needs a running DEMO server:
 *   BASE=http://localhost:3100 node scripts/shoot-maps.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? "public/maps";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const ROOMS = [
  { map: "hall", capacity: 48, guests: 30, group: "people", text: "Hội nghị Tương Lai 2026" },
  { map: "carpet", capacity: 21, guests: 15, group: "people", text: "Thiền buổi sáng" },
  { map: "tables", capacity: 24, guests: 17, group: "animals", text: "Workshop AI & Robot" },
  { map: "drive_in", capacity: 16, guests: 12, group: "vehicles", text: "Đêm phim ngoài trời" },
];
const MODELS = { people: ["person-teal", "person-orange", "person-violet", "person-yellow"], animals: ["cat", "dog", "bear", "rabbit"], vehicles: ["sedan", "suv", "pickup", "mini"] };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 180000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE + "/login", { waitUntil: "networkidle0" });
await page.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "MsMai", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trial_rooms_per_account: 50, trial_max_capacity: 100, total_slot_budget: 1000 }) });
});

const bots = [];
for (const r of ROOMS) {
  const room = await page.evaluate(
    async (r) =>
      (
        await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            useTrial: true,
            config: { name: r.text, description: "", map: r.map, avatarGroups: [r.group], officialCapacity: r.capacity, waitingEnabled: true, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "", initialScreen: { kind: "text", text: r.text } },
          }),
        })
      ).json(),
    r,
  );
  if (!room.roomId) throw new Error("create " + r.map + ": " + JSON.stringify(room));
  for (let i = 0; i < r.guests; i++) {
    const b = new Bot(`Khách ${r.map} ${i + 1}`);
    await b.enter(room.inviteCode, { group: r.group, model: MODELS[r.group][i % 4] });
    bots.push(b);
  }
  await page.goto(`${BASE}/room/${room.roomId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".canvas-wrap canvas", { timeout: 60000 });
  await page.addStyleTag({ content: ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel{display:none!important}" });
  await sleep(6000);
  await page.screenshot({ path: `${OUT}/${r.map}.webp`, type: "webp", quality: 78, clip: { x: 160, y: 100, width: 960, height: 600 } });
  console.log("shot", r.map);
}
for (const b of bots) b.ws?.close();
await browser.close();
