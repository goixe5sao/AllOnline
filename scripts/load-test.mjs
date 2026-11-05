import { execFileSync } from "node:child_process";
import WebSocket from "ws";
/**
 * Load test without browsers: ROOMS rooms × PER_ROOM guests over WebSocket, like real viewers
 * (join → auto seat → ping every 5 s → chat now and then → vote when the owner opens a poll).
 * The room owner changes the stage-screen text every 10 s. Measures join success, round-trip
 * time (ping → pong), messages/bytes the server pushes and the SERVER process RAM/CPU.
 *
 * Needs a DEMO server with TRUST_PROXY=1 (each bot gets its own fake IP, like real visitors):
 *   ALLOW_DEMO_MODE=1 DATABASE_URL= NODE_ENV=production TRUST_PROXY=1 PORT=3100 \
 *     PUBLIC_ORIGIN=http://localhost:3100 node node_modules/tsx/dist/cli.mjs server/index.ts
 *   BASE=http://localhost:3100 SERVER_PID=<node pid> STEPS=100,250,500,1000 node scripts/load-test.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const STEPS = (process.env.STEPS ?? "100,250,500").split(",").map(Number);
const PER_ROOM = Number(process.env.PER_ROOM ?? 50);
const HOLD = Number(process.env.HOLD ?? 60); // seconds of steady load per step
const SERVER_PID = process.env.SERVER_PID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ipSeq = 0;
class Client {
  jar = new Map();
  ip = `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call(path, body, method) {
    const res = await fetch(BASE + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", cookie: this.cookie, "x-forwarded-for": this.ip, origin: BASE },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} ${res.status} ${j.error?.code ?? j.code ?? ""}`);
    return j;
  }
  async open(roomId, pass, extra = {}) {
    const { ticket } = await this.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(ticket), { headers: { origin: BASE, cookie: this.cookie, "x-forwarded-for": this.ip } });
    await new Promise((r, x) => (this.ws.once("open", r), this.ws.once("error", x)));
    this.ws.on("message", (d) => this.onMsg(d));
    this.ws.on("close", () => (this.closed = true));
    this.ws.send(JSON.stringify({ t: "join", roomId, pass, ...extra }));
  }
  onMsg() {}
}

// ---- stats ----
const stats = { msgs: 0, bytes: 0, rtt: [], errors: {}, seated: 0, joinFail: {}, chats: 0, votes: 0 };
const bump = (o, k) => (o[k] = (o[k] ?? 0) + 1);

class Viewer extends Client {
  constructor(n) {
    super();
    this.name = `Khách ${n}`;
  }
  onMsg(d) {
    stats.msgs++;
    stats.bytes += d.length;
    const m = JSON.parse(d);
    if (m.t === "pong") stats.rtt.push(Date.now() - m.c);
    else if (m.t === "error") bump(stats.errors, m.code);
    else if (m.t === "session_replaced" || m.t === "kicked" || m.t === "room_closed") bump(stats.errors, m.t);
    else if (m.t === "you" && m.personal?.status === "seated" && !this.seated) (this.seated = true), stats.seated++;
    else if (m.t === "poll" && m.poll?.status === "open" && this.voted !== m.poll.id) {
      this.voted = m.poll.id;
      const opt = m.poll.options[Math.floor(Math.random() * m.poll.options.length)];
      setTimeout(() => this.send({ t: "vote", pollId: m.poll.id, optionId: opt.id }), Math.random() * 8000);
      stats.votes++;
    }
  }
  send(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  async enter(room) {
    await this.call("/api/guest", { displayName: this.name });
    const j = await this.call("/api/join", { inviteCode: room.inviteCode });
    await this.open(j.roomId, j.pass, { avatar: { group: "people", model: "person-teal" } });
    // like a real tab: ping every 5 s, chat about once a minute
    const off = Math.random() * 5000;
    this.timers = [
      setTimeout(() => (this.pinger = setInterval(() => this.send({ t: "ping", c: Date.now() }), 5000)), off),
      setTimeout(() => (this.chatter = setInterval(() => Math.random() < 0.08 && (stats.chats++, this.send({ t: "chat", text: "Xin chào mọi người " + Math.floor(Math.random() * 1000) })), 5000)), off),
    ];
  }
  stop() {
    for (const t of this.timers ?? []) clearTimeout(t);
    clearInterval(this.pinger);
    clearInterval(this.chatter);
    this.ws?.close();
  }
}

// ---- server process sampling ----
function sample() {
  if (!SERVER_PID) return null;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `$p=Get-Process -Id ${SERVER_PID}; "$($p.WorkingSet64) $($p.TotalProcessorTime.TotalMilliseconds)"`], { encoding: "utf8" }).trim();
    const [ws, cpu] = out.split(" ").map(Number);
    return { rss: ws / 1048576, cpuMs: cpu, at: Date.now() };
  } catch {
    return null;
  }
}

// ---- setup: owner + rooms ----
const owner = new Client();
await owner.call("/api/auth/demo-login", { displayName: "Chủ phòng tải", asAppOwner: true });
const maxViewers = Math.max(...STEPS);
const roomCount = Math.ceil(maxViewers / PER_ROOM);
await owner.call("/api/admin/settings", { trial_rooms_per_account: roomCount + 5, trial_max_capacity: PER_ROOM + 10, max_room_capacity: Math.max(200, PER_ROOM + 10), total_slot_budget: maxViewers + 500, ip_max_participants: 0 }, "PATCH");
const ov = await owner.call("/api/admin/overview");
for (const r of ov.rooms ?? []) if (r.status === "open") await owner.call(`/api/rooms/${r.id}/close`, {}).catch(() => {});
// One owner account per room: the server keeps a single live connection per account.
const rooms = [];
for (let i = 0; i < roomCount; i++) {
  const o = new Client();
  await o.call("/api/auth/demo-login", { displayName: `Chủ phòng ${i + 1}`, asAppOwner: true });
  const r = await o.call("/api/rooms", {
    useTrial: true,
    config: { name: `Phòng tải ${i + 1}`, description: "", map: "hall", avatarGroups: ["people"], officialCapacity: PER_ROOM + 5, waitingEnabled: true, entryMode: "auto_assign", durationHours: 6, isPublic: true, password: "" },
  });
  rooms.push({ ...r, owner: o });
}
// the owner's own sockets (one per room): screen text every 10 s, a poll per step
const ownerSockets = [];
for (const r of rooms) {
  const c = r.owner;
  // a new poll arrives as a draft → open it at once
  c.onMsg = (d) => {
    const m = JSON.parse(d);
    if (m.t === "poll" && m.poll?.status === "draft") c.ws.send(JSON.stringify({ t: "poll_open", id: m.poll.id }));
    else if (m.t === "error") bump(stats.errors, "owner:" + m.code);
    else if (m.t === "session_replaced") bump(stats.errors, "owner:session_replaced");
  };
  await c.open(r.roomId, undefined);
  ownerSockets.push({ c, r });
}
let screenTick = 0;
const screenTimer = setInterval(() => {
  screenTick++;
  for (const { c } of ownerSockets) if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: "screen", action: "set", content: { kind: "text", text: `Slide ${screenTick}` } }));
}, 10000);

console.log(`rooms: ${rooms.length} × up to ${PER_ROOM} viewers, steps ${STEPS.join(" → ")}, hold ${HOLD}s`);
const base = sample();
if (base) console.log(`server idle: RAM ${base.rss.toFixed(0)} MB`);
console.log("\nviewers | joined | seated | join fails | RTT p50/p95/p99 ms | server msgs/s | MB/s out | server RAM MB | server CPU % (1 core)");

const viewers = [];
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : NaN);
for (const target of STEPS) {
  // ramp: 25 joins in parallel at a time
  while (viewers.length < target) {
    const batch = [];
    for (let k = 0; k < 25 && viewers.length < target; k++) {
      const v = new Viewer(viewers.length + 1);
      const room = rooms[viewers.length % rooms.length];
      viewers.push(v);
      batch.push(v.enter(room).then(() => (v.ok = true)).catch((e) => bump(stats.joinFail, e.message.slice(0, 60))));
    }
    await Promise.all(batch);
  }
  // one poll per room per step
  for (const { c } of ownerSockets) c.ws.send(JSON.stringify({ t: "poll_create", question: `Bình chọn ${target}`, options: ["A", "B", "C"] }));
  await sleep(1500);
  // steady state
  stats.msgs = 0;
  stats.bytes = 0;
  stats.rtt = [];
  const s0 = sample();
  const t0 = Date.now();
  await sleep(HOLD * 1000);
  const s1 = sample();
  const secs = (Date.now() - t0) / 1000;
  const joined = viewers.filter((v) => v.ok && !v.closed).length;
  const fails = Object.values(stats.joinFail).reduce((a, b) => a + b, 0);
  const cpu = s0 && s1 ? ((s1.cpuMs - s0.cpuMs) / (s1.at - s0.at)) * 100 : NaN;
  console.log(
    `${String(target).padStart(7)} | ${String(joined).padStart(6)} | ${String(stats.seated).padStart(6)} | ${String(fails).padStart(10)} | ${[50, 95, 99].map((p) => pct(stats.rtt, p)).join(" / ").padStart(18)} | ${(stats.msgs / secs).toFixed(0).padStart(13)} | ${(stats.bytes / secs / 1048576).toFixed(2).padStart(8)} | ${s1 ? s1.rss.toFixed(0).padStart(13) : "-"} | ${isNaN(cpu) ? "-" : cpu.toFixed(0)}`,
  );
}
clearInterval(screenTimer);
console.log("\nchats sent:", stats.chats, " votes:", stats.votes);
console.log("errors from server:", Object.keys(stats.errors).length ? stats.errors : "none");
console.log("join failures:", Object.keys(stats.joinFail).length ? stats.joinFail : "none");
for (const v of viewers) v.stop();
for (const { c } of ownerSockets) c.ws.close();
await sleep(500);
process.exit(0);
