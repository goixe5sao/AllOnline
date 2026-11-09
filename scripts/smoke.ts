/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed test harness over raw JSON messages */
/**
 * End-to-end smoke test against a running server in DEMO mode.
 *   PORT=3100 npm run dev   (in another terminal)
 *   BASE=http://localhost:3100 npx tsx scripts/smoke.ts
 * Exercises real HTTP + WebSocket flows with several demo users.
 */
import WebSocket from "ws";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One simulated browser: its own cookie jar (session + device id). */
class User {
  jar = new Map<string, string>();
  id = "";
  constructor(public name: string) {}
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async call<T = any>(path: string, body?: unknown, method?: string): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + path, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", cookie: this.cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.jar.delete(name);
      else this.jar.set(name, pair.slice(i + 1).trim());
    }
    return { status: res.status, data: (await res.json().catch(() => ({}))) as T };
  }
  async login(asAppOwner = false) {
    const r = await this.call("/api/auth/demo-login", { displayName: this.name, asAppOwner });
    this.id = r.data.user.id;
  }
}

class Sock {
  ws!: WebSocket;
  msgs: any[] = [];
  async open(u: User) {
    const { data } = await u.call("/api/ws-ticket");
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws?ticket=" + encodeURIComponent(data.ticket), { headers: { origin: BASE, cookie: u.cookie } });
    this.ws.on("message", (d) => this.msgs.push(JSON.parse(String(d))));
    await new Promise((r, j) => (this.ws.once("open", r), this.ws.once("error", j)));
    return this;
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async wait(pred: (m: any) => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = this.msgs.findIndex(pred);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(30);
    }
    return null;
  }
  last(t: string) {
    return [...this.msgs].reverse().find((m) => m.t === t);
  }
}

async function main() {
  const admin = new User("Admin demo");
  const owner = new User("Chủ phòng");
  const a = new User("An");
  const b = new User("Bình");
  const c = new User("Chi");
  await admin.login(true);
  for (const u of [owner, a, b, c]) await u.login();

  // privileges
  ok((await fetch(BASE + "/api/ai-stock/scan")).status === 401, "AI Stock scan requires an attendee session");
  ok((await fetch(BASE + "/api/ai-stock/alerts")).status === 401, "alert history requires an attendee session");
  ok((await fetch(BASE + "/api/ai-stock/follows")).status === 401, "follows require an account");
  const feed = await owner.call("/api/ai-stock/alerts");
  ok(feed.status === 200 && feed.data.fixture === true && Array.isArray(feed.data.alerts), "typed fixture alert feed available");
  ok((await owner.call("/api/ai-stock/follows", { symbol: "FPT", following: true })).status === 200, "account follows FPT");
  await owner.call("/api/ai-stock/follows", { symbol: "FPT", following: true });
  const follows = (await owner.call("/api/ai-stock/follows")).data;
  ok(follows.symbols.length === 1 && follows.symbols[0] === "FPT" && follows.dailyCap === 5 && !follows.deliveryAvailable, "follow is idempotent with daily cap and unknown policy disabled");
  ok((await a.call("/api/ai-stock/follows")).data.symbols.length === 0, "follows isolated per account");
  ok((await owner.call("/api/ai-stock/follows", { symbol: "bad symbol", following: true })).status === 400, "invalid follow symbol rejected");
  await owner.call("/api/ai-stock/follows", { symbol: "FPT", following: false });
  ok((await owner.call("/api/ai-stock/follows")).data.symbols.length === 0, "unfollow persisted");
  ok((await owner.call("/api/admin/overview")).status === 403, "normal user cannot open admin API");
  ok((await admin.call("/api/admin/overview")).status === 200, "app owner can open admin API");
  await admin.call("/api/admin/settings", { trial_rooms_per_account: 5, find_seat_seconds: 30, chat_radius: 2, device_limit_room_creator: false, ip_max_participants: 0 }, "PATCH");

  // Start from a clean slate: the app owner closes rooms left open by earlier runs.
  for (const r of (await admin.call("/api/admin/overview")).data.rooms) if (r.status === "open") await admin.call(`/api/rooms/${r.id}/close`, {});
  const base0 =(await admin.call("/api/admin/overview")).data.budget.allocated as number;
  // create gate-entry trial room: 2 official + 20% → 0 waiting... use 5 → 1 waiting
  const cfg = { name: "Phòng smoke", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 5, waitingEnabled: true, entryMode: "gate_entry", durationHours: 6, password: "123" };
  const created = await owner.call("/api/rooms", { config: cfg, useTrial: true });
  ok(created.status === 200 && created.data.roomId, "trial room created");
  const roomId = created.data.roomId;
  const invite = created.data.inviteCode;
  const budget = (await admin.call("/api/admin/overview")).data.budget;
  ok(budget.allocated - base0 === 6, `room holds 5 + 1 waiting = 6 slots (+${budget.allocated - base0})`);

  // logs isolation
  ok((await a.call(`/api/rooms/${roomId}/logs`)).status === 403, "other users cannot read the room log");

  // wrong password
  ok((await a.call("/api/join", { inviteCode: invite, password: "x" })).status === 403, "wrong room password rejected");
  const passes: Record<string, string> = {};
  for (const u of [a, b, c]) passes[u.name] = (await u.call("/api/join", { inviteCode: invite, password: "123" })).data.pass;

  const so = await new Sock().open(owner);
  so.send({ t: "join", roomId });
  const ow = await so.wait((m) => m.t === "welcome");
  ok(ow?.role === "owner", "owner joins as owner (free camera)");

  const sa = await new Sock().open(a);
  sa.send({ t: "join", roomId, pass: passes["An"], avatar: { group: "vehicles", model: "sedan" } });
  const e1 = await sa.wait((m) => m.t === "error");
  ok(e1?.code === "AVATAR_NOT_ALLOWED", "avatar group not allowed by the room is refused");
  sa.ws.close();

  const sA = await new Sock().open(a);
  sA.send({ t: "join", roomId, avatar: { group: "people", model: "person-teal" } });
  ok((await sA.wait((m) => m.t === "error"))?.code === "NO_PASS", "joining without invite pass is refused");
  sA.send({ t: "join", roomId, pass: passes["An"], avatar: { group: "people", model: "person-teal" } });
  const wA = await sA.wait((m) => m.t === "welcome");
  ok(wA?.personal?.status === "finding", "gate mode: admitted to main area with find-seat timer");

  const sB = await new Sock().open(b);
  sB.send({ t: "join", roomId, pass: passes["Bình"], avatar: { group: "people", model: "person-orange" } });
  await sB.wait((m) => m.t === "welcome");

  // claim far seat → TOO_FAR
  sA.send({ t: "claim", seatId: "S1" });
  ok((await sA.wait((m) => m.t === "error"))?.code === "TOO_FAR", "cannot claim a seat from the gate (server checks distance)");

  // teleport attempt is corrected
  sA.send({ t: "move", x: 0, z: -2, rotY: 0 });
  ok(!!(await sA.wait((m) => m.t === "corrected")), "teleport is corrected by the server");

  // walk to S1 legitimately
  const seatS1 = { x: -1.45, z: -1 };
  for (let i = 0; i < 80; i++) {
    const me = sA.last("corrected") ?? null;
    void me;
    await sleep(110);
    sA.send({ t: "move", x: seatS1.x, z: seatS1.z, rotY: 0 });
  }
  await sleep(300);
  sA.send({ t: "claim", seatId: "S1" });
  const you = await sA.wait((m) => m.t === "you" && m.personal?.status === "seated", 3000);
  ok(!!you, "after walking there, the seat is taken atomically");

  // proximity chat: A (front seat) and B (at gate, far) – B should NOT receive A's message, owner observer near? owner observes main center.
  sB.msgs = [];
  sA.send({ t: "chat", text: "Xin chào gần đây" });
  const gotA = await sA.wait((m) => m.t === "chat", 1500);
  const gotB = await sB.wait((m) => m.t === "chat", 1500);
  ok(!!gotA && !gotB, "proximity chat: far user did not receive the message (filtered on server)");
  for (let i = 0; i < 6; i++) sA.send({ t: "chat", text: "spam " + i });
  ok(!!(await sA.wait((m) => m.t === "error" && m.code === "CHAT_RATE", 2000)), "chat rate limit");

  // screen sync & late joiner
  so.send({ t: "screen", action: "set", content: { kind: "youtube", videoId: "dQw4w9WgXcQ" } });
  so.send({ t: "screen", action: "play" });
  await sA.wait((m) => m.t === "screen" && m.state.playing);
  sA.send({ t: "screen", action: "pause" });
  ok(!!(await sA.wait((m) => m.t === "error" && m.code === "FORBIDDEN")), "participants cannot control the screen");
  await sleep(1200);
  const sC = await new Sock().open(c);
  sC.send({ t: "join", roomId, pass: passes["Chi"], avatar: { group: "people", model: "person-violet" } });
  const wC = await sC.wait((m) => m.t === "welcome");
  ok(wC?.screen?.content?.kind === "youtube" && wC.screen.playing && wC.serverNow - wC.screen.updatedAt >= 1000, "late joiner receives current screen state with server timestamps");

  // AI Stock uses the same authoritative screen channel and moderator permission gate.
  sA.send({ t: "screen", action: "ai_stock", command: "start" });
  ok(!!(await sA.wait((m) => m.t === "error" && m.code === "FORBIDDEN")), "AI Stock start is moderator-only");
  so.send({ t: "screen", action: "ai_stock", command: "start", topN: 2, seconds: 10 });
  const aiStart = (await sA.wait((m) => m.t === "screen" && m.state.content.kind === "ai-stock"))?.state;
  ok(aiStart?.content.fixture && aiStart.content.index === 0 && aiStart.content.topN === 2, "AI Stock starts with typed fixture and configured timing");
  const aiNext = (await sA.wait((m) => m.t === "screen" && m.state.content.kind === "ai-stock" && m.state.content.index === 1, 12000))?.state;
  ok(!!aiNext, "AI Stock rotates on the server without viewer commands");
  so.send({ t: "screen", action: "ai_stock", command: "pause" });
  ok(!!(await sA.wait((m) => m.t === "screen" && m.state.content.paused)), "AI Stock pauses for all viewers");
  so.send({ t: "screen", action: "ai_stock", command: "pin", symbol: "VNM" });
  const aiPinned = (await sA.wait((m) => m.t === "screen" && m.state.content.pinned))?.state;
  ok(aiPinned?.content.snapshot.picks[aiPinned.content.index].symbol === "VNM", "AI Stock pins any symbol in the snapshot");
  const aiObserver = await new Sock().open(admin);
  aiObserver.send({ t: "join", roomId });
  const aiWelcome = await aiObserver.wait((m) => m.t === "welcome");
  ok(aiWelcome?.screen.rev === aiPinned?.rev && aiWelcome?.screen.content.pinned && aiWelcome?.screen.content.paused, "AI Stock late join gets identical snapshot, pin, pause and revision");
  aiObserver.ws.close();
  const privateScan = await a.call("/api/ai-stock/scan");
  ok(privateScan.status === 200 && privateScan.data.fixture && privateScan.data.snapshot.picks.length === 8, "viewer can read fixture list privately");
  so.send({ t: "screen", action: "ai_stock", command: "resume" });
  ok(!!(await sA.wait((m) => m.t === "screen" && m.state.content.kind === "ai-stock" && !m.state.content.paused && !m.state.content.pinned)), "AI Stock resumes and unpins");
  so.send({ t: "screen", action: "ai_stock", command: "skip" });
  ok(!!(await sA.wait((m) => m.t === "screen" && m.state.content.kind === "ai-stock" && m.state.content.index === 0)), "AI Stock skip wraps within top N");
  so.send({ t: "screen", action: "ai_stock", command: "stop" });
  ok(!!(await sA.wait((m) => m.t === "screen" && m.state.content.kind === "blank")), "AI Stock stop hands the screen back to manual controls");

  // poll
  so.send({ t: "poll_create", question: "Bạn thích phim nào?", options: ["A", "B"] });
  const poll = (await sA.wait((m) => m.t === "poll"))?.poll;
  sA.send({ t: "vote", pollId: poll.id, optionId: "o1" });
  ok(!!(await sA.wait((m) => m.t === "error" && m.code === "POLL_NOT_OPEN")), "cannot vote before the poll opens");
  so.send({ t: "poll_open", id: poll.id });
  await sleep(300);
  sA.send({ t: "vote", pollId: poll.id, optionId: "o1" });
  sA.send({ t: "vote", pollId: poll.id, optionId: "o2" });
  sB.send({ t: "vote", pollId: poll.id, optionId: "o2" });
  so.send({ t: "vote", pollId: poll.id, optionId: "o1" });
  ok((await so.wait((m) => m.t === "error"))?.code === "NOT_A_PARTICIPANT", "room owner (not a participant) cannot vote");
  await sleep(500);
  const tally = [...sC.msgs].reverse().find((m) => m.t === "poll" && m.poll.id === poll.id)?.poll;
  ok(tally?.totalVoters === 2 && tally.options[1].votes === 2, `one ballot per account, change allowed (voters=${tally?.totalVoters})`);
  so.send({ t: "poll_close", id: poll.id });
  await sleep(300);
  sB.send({ t: "vote", pollId: poll.id, optionId: "o1" });
  ok((await sB.wait((m) => m.t === "error"))?.code === "POLL_NOT_OPEN", "vote rejected after closing");

  // single session: B opens a second tab
  const sB2 = await new Sock().open(b);
  ok(!!(await sB.wait((m) => m.t === "session_replaced")), "second tab replaces the first session");
  sB2.send({ t: "join", roomId, pass: passes["Bình"], avatar: { group: "people", model: "person-orange" } });
  const wB2 = await sB2.wait((m) => m.t === "welcome");
  ok(wB2?.personal?.status === "finding", "reconnect resumes the same place");

  // kick
  so.send({ t: "kick", userId: c.id });
  ok(!!(await sC.wait((m) => m.t === "kicked")), "owner can remove a participant");

  // owner log contains promoted chat only if promoted; ordinary chat is never logged
  const logs = (await owner.call(`/api/rooms/${roomId}/logs`)).data.events as { type: string; data: unknown }[];
  ok(!JSON.stringify(logs).includes("Xin chào gần đây"), "ordinary chat is not stored in the room log");
  ok(logs.some((e) => e.type === "screen_play"), "screen actions are logged");

  // paid order + demo pay
  const ord = await owner.call("/api/rooms", { config: { ...cfg, name: "Phòng trả phí", officialCapacity: 10, entryMode: "auto_assign" }, useTrial: false });
  ok(!!ord.data.orderId, "paid order created with slot hold");
  const hold = (await admin.call("/api/admin/overview")).data.budget;
  ok(hold.held >= 12, `12 slots held during payment (held=${hold.held})`);
  const paid = await owner.call(`/api/orders/${ord.data.orderId}/demo-pay`, {});
  ok(paid.data.outcome === "fulfilled", "demo payment creates the room (demo mode only)");

  // expiry with no client: force expires_at via admin? use close endpoint as owner instead + check slot release
  const closed = await owner.call(`/api/rooms/${roomId}/close`, {});
  ok(closed.data.closed === true, "owner closes room");
  ok(!!(await sA.wait((m) => m.t === "room_closed")), "participants are notified and sessions end");
  const after = (await admin.call("/api/admin/overview")).data.budget;
  ok(after.allocated - base0 === 12, `slots returned once (+${after.allocated - base0} = only the new paid room)`);
  ok((await owner.call(`/api/rooms/${roomId}/close`, {})).data.closed === false, "second close does not release again");

  // ---- guests: name + avatar (+ room password), no account ----
  const room2 = await owner.call("/api/rooms", { config: { ...cfg, name: "Phòng khách", officialCapacity: 3, entryMode: "auto_assign", password: "789" }, useTrial: true });
  const g = new User("Khách Hoa");
  const inv = await g.call(`/api/invite/${room2.data.inviteCode}`);
  ok(inv.data.guestJoinEnabled === true && inv.data.isOwner === false, "invite page offers guest join");
  const gs = await g.call("/api/guest", { displayName: "Khách Hoa" });
  ok(gs.status === 200 && gs.data.user.isGuest === true, "guest identity created from just a name");
  ok((await g.call("/api/ai-stock/alerts")).status === 200, "guests can read alert history");
  ok((await g.call("/api/ai-stock/follows", { symbol: "FPT", following: true })).status === 403, "guests cannot follow symbols");
  ok((await g.call("/api/join", { inviteCode: room2.data.inviteCode, password: "sai" })).status === 403, "guest still needs the room password");
  const gj = await g.call("/api/join", { inviteCode: room2.data.inviteCode, password: "789" });
  ok(!!gj.data.pass, "guest joins with correct password");
  const sG = await new Sock().open(g as User);
  sG.send({ t: "join", roomId: gj.data.roomId, pass: gj.data.pass, avatar: { group: "people", model: "person-yellow" } });
  const wG = await sG.wait((m) => m.t === "welcome");
  ok(wG?.role === "participant" && wG.you.name === "Khách Hoa" && wG.personal?.status === "seated", "guest enters the 3D room and is seated");
  ok((await g.call("/api/rooms", { config: cfg, useTrial: true })).status === 403, "guests cannot create rooms");
  ok((await g.call("/api/orders/mine")).status === 403, "guests cannot access orders");
  ok((await g.call("/api/admin/overview")).status === 403, "guests cannot access admin");
  await admin.call("/api/admin/settings", { guest_join_enabled: false }, "PATCH");
  ok((await new User("Khách 2").call("/api/guest", { displayName: "Khách 2" })).status === 403, "app owner can disable guest join");
  ok((await g.call("/api/join", { inviteCode: room2.data.inviteCode, password: "789" })).status === 403, "existing guests are refused when guest join is off");
  await admin.call("/api/admin/settings", { guest_join_enabled: true }, "PATCH");
  await owner.call(`/api/rooms/${room2.data.roomId}/close`, {});
  sG.ws.close();

  // ---- room owner attends their own room as a participant ----
  const ownRoom = await owner.call("/api/rooms", { config: { ...cfg, name: "Chủ phòng ngồi ghế", officialCapacity: 4, entryMode: "auto_assign", password: "xyz" }, useTrial: true });
  const oj = await owner.call("/api/join", { inviteCode: ownRoom.data.inviteCode, password: "" });
  ok(oj.status === 200, "the owner opens their own invite link without the room password");
  const sp = await new Sock().open(owner);
  sp.send({ t: "join", roomId: ownRoom.data.roomId, pass: oj.data.pass, avatar: { group: "people", model: "person-teal" }, asParticipant: true });
  const wp = await sp.wait((m) => m.t === "welcome");
  ok(wp?.role === "participant" && wp.personal?.status === "seated" && wp.you.isRoomOwner === true, "owner attends as a seated participant and is still flagged as room owner");
  sp.send({ t: "screen", action: "set", content: { kind: "text", text: "Chủ phòng điều khiển từ ghế" } });
  ok((await sp.wait((m) => m.t === "screen"))?.state.content.text === "Chủ phòng điều khiển từ ghế", "owner keeps screen controls while seated");
  sp.send({ t: "poll_create", question: "Q?", options: ["A", "B"] });
  const opoll = (await sp.wait((m) => m.t === "poll"))?.poll;
  sp.send({ t: "poll_open", id: opoll.id });
  await sleep(300);
  sp.send({ t: "vote", pollId: opoll.id, optionId: "o1" });
  ok(!!(await sp.wait((m) => m.t === "my_vote")), "owner attending as a participant can vote");
  sp.ws.close();
  await owner.call(`/api/rooms/${ownRoom.data.roomId}/close`, {});

  // ---- discount code ASDFG = 100% off ----
  const pcfg = { ...cfg, name: "Phòng mã ASDFG", officialCapacity: 4, entryMode: "auto_assign" };
  const pq = await owner.call("/api/rooms/quote", { ...pcfg, promoCode: "asdfg" });
  ok(pq.data.quote?.amount === 0 && pq.data.quote?.promo?.percentOff === 100, "quote with ASDFG shows 0 ₫ (100% off)");
  ok((await owner.call("/api/rooms/quote", { ...pcfg, promoCode: "SAI" })).data.promoError, "an invalid code is reported in the quote");
  const pr = await owner.call("/api/rooms", { config: pcfg, useTrial: false, promoCode: "ASDFG" });
  ok(pr.status === 200 && !!pr.data.roomId && pr.data.free === true, "ASDFG creates the room immediately, no QR payment");
  if (pr.data.roomId) await owner.call(`/api/rooms/${pr.data.roomId}/close`, {});

  // ---- per-device limits (all test users share one IP, like an office of 100 people) ----
  await admin.call("/api/admin/settings", { device_limit_room_creator: true, ip_max_participants: 0 }, "PATCH");
  const other = new User("Người tạo thứ hai");
  await other.login();
  ok((await owner.call("/api/rooms", { config: { ...cfg, name: "DEV 1", officialCapacity: 10 }, useTrial: true })).status === 200, "creator on device A can create a room");
  ok((await other.call("/api/rooms", { config: { ...cfg, name: "DEV 2", officialCapacity: 2 }, useTrial: true })).status === 200, "another account on another device, same IP, can also create (offices are not blocked)");
  const sharedDevice = new User("Tài khoản thứ ba, cùng máy với chủ phòng");
  await sharedDevice.login();
  sharedDevice.jar.set("ao_dev", owner.jar.get("ao_dev")!);
  const blocked = await sharedDevice.call("/api/rooms", { config: { ...cfg, name: "DEV 3", officialCapacity: 2 }, useTrial: true });
  ok(blocked.status === 409 && blocked.data.error === "DEVICE_LIMIT_CREATOR", "a second account on the same device cannot create a room");

  const devRoom = (await owner.call("/api/rooms/mine")).data.rooms.find((r: any) => r.name === "DEV 1");
  const guests = Array.from({ length: 6 }, (_, i) => new User("Nhân viên " + (i + 1)));
  const socks: Sock[] = [];
  let entered = 0;
  for (const gu of guests) {
    await gu.call("/api/guest", { displayName: gu.name });
    const j = await gu.call("/api/join", { inviteCode: devRoom.invite_code, password: "123" });
    const sk = await new Sock().open(gu);
    sk.send({ t: "join", roomId: j.data.roomId, pass: j.data.pass, avatar: { group: "people", model: "person-teal" } });
    if (await sk.wait((m) => m.t === "welcome")) entered++;
    socks.push(sk);
  }
  ok(entered === 6, `6 people on the same IP but different devices all enter (${entered}/6)`);

  // Same device, second identity (e.g. logged out then joined as a new guest in the same browser).
  const twin = new User("Cùng máy với Nhân viên 1");
  twin.jar.set("ao_dev", guests[0].jar.get("ao_dev")!);
  await twin.call("/api/guest", { displayName: twin.name });
  const jt = await twin.call("/api/join", { inviteCode: devRoom.invite_code, password: "123" });
  const st = await new Sock().open(twin);
  st.send({ t: "join", roomId: jt.data.roomId, pass: jt.data.pass, avatar: { group: "people", model: "person-teal" } });
  ok((await st.wait((m) => m.t === "error"))?.code === "DEVICE_LIMIT", "a second person on the same device is refused");
  socks[0].send({ t: "leave" });
  await sleep(300);
  st.send({ t: "join", roomId: jt.data.roomId, pass: jt.data.pass, avatar: { group: "people", model: "person-teal" } });
  ok(!!(await st.wait((m) => m.t === "welcome")), "after the first person on that device leaves, the device can be used again");

  // Optional IP cap still works when the app owner turns it on.
  await admin.call("/api/admin/settings", { ip_max_participants: 3 }, "PATCH");
  const late = new User("Người thứ 8");
  await late.call("/api/guest", { displayName: late.name });
  const jl = await late.call("/api/join", { inviteCode: devRoom.invite_code, password: "123" });
  const sl = await new Sock().open(late);
  sl.send({ t: "join", roomId: jl.data.roomId, pass: jl.data.pass, avatar: { group: "people", model: "person-teal" } });
  ok((await sl.wait((m) => m.t === "error"))?.code === "IP_LIMIT_PARTICIPANT", "optional per-IP cap (off by default) is enforced when set");
  await admin.call("/api/admin/settings", { ip_max_participants: 0 }, "PATCH");

  // Verified-only poll: guests see results but cannot vote.
  const sOwn = await new Sock().open(owner);
  sOwn.send({ t: "join", roomId: devRoom.id });
  await sOwn.wait((m) => m.t === "welcome");
  sOwn.send({ t: "poll_create", question: "Chọn ngày họp?", options: ["Thứ 2", "Thứ 3"], verifiedOnly: true });
  const vpoll = (await sOwn.wait((m) => m.t === "poll"))?.poll;
  ok(vpoll?.verifiedOnly === true, "owner can create an accounts-only poll");
  sOwn.send({ t: "poll_open", id: vpoll.id });
  await sleep(300);
  socks[1].send({ t: "vote", pollId: vpoll.id, optionId: "o1" });
  ok((await socks[1].wait((m) => m.t === "error" && m.code === "VERIFIED_ONLY")) !== null, "guests cannot vote in an accounts-only poll");

  for (const r of (await owner.call("/api/rooms/mine")).data.rooms) if (r.status === "open") await owner.call(`/api/rooms/${r.id}/close`, {});
  for (const r of (await other.call("/api/rooms/mine")).data.rooms) if (r.status === "open") await other.call(`/api/rooms/${r.id}/close`, {});
  for (const s of [...socks, st, sl, sOwn]) s.ws.close();

  for (const s of [so, sA, sB2, sC]) s.ws.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
