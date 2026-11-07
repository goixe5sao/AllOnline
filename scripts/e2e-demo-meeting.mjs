import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * "Phòng trải nghiệm 3 · Phòng họp": listed on the home page next to the other two; the demo host
 * sits in the chairperson's seat, a guest at the table; photographed from both chairs.
 *   BASE=http://localhost:3100 node scripts/e2e-demo-meeting.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);

/** A visitor without a browser (WebSocket), to fill the other chairs. */
class Bot {
  jar = new Map();
  msgs = [];
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
  async enter(invite, demoHost) {
    await this.call("/api/guest", { displayName: this.name });
    const j = await this.call("/api/join", { inviteCode: invite });
    const { ticket } = await this.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(ticket), { headers: { origin: BASE, cookie: this.cookie } });
    this.ws.on("message", (d) => this.msgs.push(JSON.parse(String(d))));
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.send(JSON.stringify({ t: "join", roomId: j.roomId, pass: j.pass, demoHost, avatar: { group: "people", model: "person-orange" } }));
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
// the app owner exists (owns the demo rooms)
const admin = await page();
await admin.goto(BASE + "/login", { waitUntil: "networkidle0" });
await admin.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ ứng dụng", asAppOwner: true }) });
});
await admin.goto(BASE + "/", { waitUntil: "networkidle0" });
await admin.waitForSelector("#trai-nghiem .demo-card", { timeout: 20000 });
const cards = await admin.$$eval("#trai-nghiem .demo-card h3", (h) => h.map((x) => x.textContent));
check(cards.length === 3 && /Phòng họp/.test(cards[2]), `home: 3 demo rooms (${cards.join(" | ")})`);
await admin.evaluate(() => document.querySelector("#trai-nghiem")?.scrollIntoView());
await sleep(800);
await admin.screenshot({ path: `${OUT}/demo-home-3.png` });
const rooms = await admin.evaluate(async () => (await (await fetch("/api/demo")).json()).rooms);
const meet = rooms.find((r) => r.map === "meeting");
check(!!meet && meet.seats === 3, `demo meeting room with ${meet?.seats} seats`);

// the demo host (browser) → chairperson's seat
const host = await page();
await host.goto(`${BASE}/join/${meet.inviteCode}?as=host`, { waitUntil: "networkidle0" });
await host.type("form input[maxlength='60']", "Lan");
await host.click("form button.btn.primary");
await host.waitForSelector(".canvas-wrap canvas", { timeout: 90000 });
await sleep(2500);
const info = await host.evaluate(async () => (await (await fetch("/api/demo")).json()).rooms.find((r) => r.map === "meeting"));
check(info.hostName === "Lan", `Lan is the demo host (${info.hostName})`);

// a guest bot sees where everyone sits
const guest = new Bot("Minh");
await guest.enter(meet.inviteCode, false);
await sleep(1500);
const w = guest.msgs.find((m) => m.t === "welcome");
const lan = w?.members?.find((m) => m.name === "Lan");
const minh = w?.members?.find((m) => m.name === "Minh");
// 3 seats: 2 at the table (S1, S2 nearest the screen) + the chairperson at the head (S3)
check(lan?.seatId === "S3", `demo host in the chairperson's seat (${lan?.seatId})`);
check(minh?.seatId && minh.seatId !== "S3", `guest at the table (${minh?.seatId})`);
// voice chat is on in the demo rooms too
await host.evaluate(() => document.querySelector(".orb")?.click());
await sleep(600);
check(!!(await host.$('[data-orb="mic"]')), "demo room: 🎤 Bật mic in the orb (voice chat on)");
await host.evaluate(() => document.querySelector(".orb")?.click());
await host.addStyleTag({ content: ".hud-top,.hud-bottom,.status-card,.demo-ribbon,.side-panel,.orb-root{display:none!important}" });
await sleep(4000);
await host.screenshot({ path: `${OUT}/demo-meeting-host.png` });

console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
guest.ws?.close();
await browser.close();
process.exit(failed ? 1 : 0);
