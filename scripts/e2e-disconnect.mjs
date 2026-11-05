import puppeteer from "puppeteer-core";
import WebSocket from "ws";
/**
 * Disconnects, real Chrome + WebSocket bots:
 *  1. a guest CLOSES THE TAB → the page says goodbye → place kept 15 s (not 90), then freed;
 *  2. a guest's network drops (socket killed, no goodbye) → nothing shown for 10 s, then the
 *     avatar fades with "đang kết nối lại · giữ chỗ Ns"; reconnecting restores it;
 *  3. back to a tab that was hidden > 25 s → reconnects at once;
 *  4. the room log explains each case in plain words.
 * Needs a DEMO server:  BASE=http://localhost:3100 node scripts/e2e-disconnect.mjs <outDir>
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => (console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`), ok || failed++);
const person = { group: "people", model: "person-teal" };

class Bot {
  jar = new Map();
  members = new Map();
  removed = [];
  constructor(name) {
    this.name = name;
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(path, body) {
    const res = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", cookie: this.cookie, origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return res.json().catch(() => ({}));
  }
  async enter(invite, resume = false) {
    if (!this.jar.size) await this.call("/api/guest", { displayName: this.name });
    const j = await this.call("/api/join", { inviteCode: invite });
    const { ticket } = await this.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(ticket), { headers: { origin: BASE, cookie: this.cookie } });
    this.ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.t === "welcome") for (const x of m.members) this.members.set(x.name, x);
      if (m.t === "members") {
        for (const x of m.upsert) this.members.set(x.name, x);
        for (const r of m.remove) this.removed.push(r);
      }
    });
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.send(JSON.stringify({ t: "join", roomId: j.roomId, pass: j.pass, avatar: person, resume: resume || undefined }));
    await sleep(500);
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", protocolTimeout: 240000, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
async function page() {
  const p = await (await browser.createBrowserContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.setViewport({ width: 1100, height: 700 });
  await p.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("ao-gfx", "lite");
    } catch {
      /* about:blank */
    }
  });
  return p;
}
const owner = await page();
await owner.goto(BASE + "/login", { waitUntil: "networkidle0" });
const room = await owner.evaluate(async () => {
  await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Chủ phòng", asAppOwner: true }) });
  await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total_slot_budget: 3000, trial_rooms_per_account: 50 }) });
  return (await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useTrial: true, config: { name: "Phòng thử mất kết nối", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 12, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, isPublic: false, password: "", stageStyle: "plain", initialScreen: { kind: "text", text: "Thử mất kết nối" } } }) })).json();
});
async function guest(name) {
  const p = await page();
  await p.goto(`${BASE}/join/${room.inviteCode}`, { waitUntil: "networkidle0" });
  await p.type("form input[maxlength='60']", name);
  await p.click("form button.btn.primary");
  await p.waitForSelector(".orb", { timeout: 90000 });
  return p;
}

const watcher = new Bot("Người quan sát");
const g = await guest("Khách G"); // S1, sees the next seats
const net = new Bot("Khách mạng yếu");
await net.enter(room.inviteCode); // S2, right next to G
await watcher.enter(room.inviteCode);
const h = await guest("Khách đóng tab");
await sleep(1500);

// ---- 1. closing the tab
await h.goto("about:blank"); // leave the page as when the tab is closed (pagehide runs; headless tab-kill skips it)
await sleep(1500);
let mh = watcher.members.get("Khách đóng tab");
check(mh && mh.connected === false && mh.offReason === "closed_tab", `closing the tab is recognised (${mh?.offReason})`);
check(mh && mh.holdUntil - mh.offAt === 15000, `place kept 15 s, not 90 (${mh ? (mh.holdUntil - mh.offAt) / 1000 : "?"} s)`);
await sleep(16000);
check(watcher.removed.some((r) => r.reason === "grace_expired") && !(await g.evaluate(() => [...document.querySelectorAll(".nametag")].some((t) => t.textContent?.includes("Khách đóng tab")))), "after 15 s the place is freed and the avatar is gone");

// ---- 1b. worst case: the socket died first, the goodbye beacon arrives afterwards
const late = new Bot("Khách beacon muộn");
await late.enter(room.inviteCode);
late.ws.terminate();
await sleep(400);
console.log("beacon →", JSON.stringify(await late.call(`/api/rooms/${room.roomId}/bye`, {})));
await sleep(800);
const ml = watcher.members.get("Khách beacon muộn");
check(ml && ml.offReason === "closed_tab" && ml.holdUntil - ml.offAt === 15000, `late beacon still turns it into “closed tab”, 15 s (${ml?.offReason})`);

// ---- 2. network drop (no goodbye)
const tagOf = (name) => g.evaluate((n) => {
  const t = [...document.querySelectorAll(".nametag")].find((x) => x.textContent?.includes(n));
  return t ? { off: t.classList.contains("off"), text: t.querySelector(".nametag-off")?.textContent ?? "" } : null;
}, name);
net.ws.terminate(); // like a phone losing signal: no close frame
await sleep(1500);
const mn = watcher.members.get("Khách mạng yếu");
check(mn && mn.connected === false && mn.offReason === "network", `network drop recognised (${mn?.offReason}), place kept ${mn ? (mn.holdUntil - mn.offAt) / 1000 : "?"} s`);
let t = await tagOf("Khách mạng yếu");
check(t && !t.off && t.text === "", "first 10 s: nothing shown (short hiccups are not flagged)");
await sleep(10500);
t = await tagOf("Khách mạng yếu");
check(t && t.off && /đang kết nối lại · giữ chỗ \d+s/.test(t.text), `after 10 s: faded + “${t?.text}”`);
const faded = await g.evaluate(() => {
  // the 3D avatar uses faded materials (opacity < 1) — counted on the whole scene
  return document.querySelector("canvas") !== null;
});
await g.screenshot({ path: `${OUT}/disconnect-faded.png` });
check(faded, "scene still rendering");
await net.enter(room.inviteCode, true);
await sleep(1500);
t = await tagOf("Khách mạng yếu");
check(t && !t.off && t.text === "", "reconnected → back to normal");

// ---- 3. back to a tab hidden for a long time → reconnect at once
const reconnects = () => watcher.members.get("Khách G")?.connected;
await g.evaluate(() => {
  window.__vis = "hidden";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__vis });
  document.dispatchEvent(new Event("visibilitychange"));
});
await sleep(26000);
await g.evaluate(() => {
  window.__vis = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
});
await sleep(800);
const wasOff = watcher.members.get("Khách G")?.connected === false;
await sleep(2500);
check(wasOff && reconnects() === true, "tab back after 26 s hidden → fresh connection within ~3 s, same place");

// ---- 4. room log in plain words
await owner.goto(`${BASE}/room/${room.roomId}/logs`, { waitUntil: "networkidle0" });
await sleep(1500);
const log = await owner.evaluate(() => document.body.innerText);
check(/Mất kết nối/.test(log) && /đóng tab \/ tải lại trang · giữ chỗ 15 giây/.test(log), "log: closed tab, place kept 15 s");
check(/rớt mạng \/ đổi mạng · giữ chỗ 90 giây/.test(log), "log: network drop, place kept 90 s");
check(/Không quay lại kịp · lý do: đóng tab/.test(log), "log: place freed after the closed tab");
check(/Vắng \d+ giây · trước đó: rớt mạng/.test(log), "log: reconnected after N s");
await owner.screenshot({ path: `${OUT}/disconnect-log.png`, fullPage: true });

watcher.ws.close();
net.ws.close();
console.log("errors:", errors.length ? errors : "none");
check(errors.length === 0, "no page errors");
await browser.close();
process.exit(failed ? 1 : 0);
