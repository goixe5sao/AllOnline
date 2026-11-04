import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Db } from "./db";
import type { Auth } from "./auth";
import { buildLayout, isValidAvatar, type AvatarGroup } from "@/core/maps";
import { RoomEngine } from "@/core/room-engine";
import { applyScreenAction, BLANK_SCREEN, screenContentSchema, type ScreenState } from "@/core/screen";
import { DuplicateFilter, RateLimiter, sanitizeChat } from "@/core/chat";
import { ERROR_TEXT, type ClientMsg, type RoomInfoDto, type RoomRole, type ServerMsg } from "@/core/protocol";
import { getSettings, type Settings } from "./services/settings";
import { getRoom, logRoomEvent, saveScreenState, AppError, type RoomRow } from "./services/rooms";
import { castVote, createPoll, listPolls, myVotes, pollCreateSchema, pollView, setPollStatus } from "./services/polls";
import type { AppUser } from "./services/users";

interface Client {
  id: string;
  ws: WebSocket;
  user: AppUser;
  roomId: string | null;
  role: RoomRole | null;
  alive: boolean;
  lastObserveAt: number;
  msgCount: number;
  msgWindowStart: number;
  ipHash: string;
  deviceId: string;
}

interface LiveRoom {
  row: RoomRow;
  engine: RoomEngine;
  screen: ScreenState;
  clients: Set<Client>;
  /** Messages the owner actually received, kept in memory ≤ 2 min so one can be promoted. Never persisted. */
  ownerInbox: Map<string, { text: string; name: string; at: number }>;
  movesPending: boolean;
}

const num = z.number().finite();
const msgSchema = z.union([
  z.object({ t: z.literal("join"), roomId: z.string().uuid(), pass: z.string().max(2000).optional(), avatar: z.object({ group: z.string(), model: z.string() }).optional(), asParticipant: z.boolean().optional() }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("move"), x: num, z: num, rotY: num }),
  z.object({ t: z.literal("claim"), seatId: z.string().max(10) }),
  z.object({ t: z.literal("change_seat"), seatId: z.string().max(10) }),
  z.object({ t: z.literal("accept_invite") }),
  z.object({ t: z.literal("chat"), text: z.string().max(2000) }),
  z.object({ t: z.literal("vote"), pollId: z.string().uuid(), optionId: z.string().max(10) }),
  z.object({ t: z.literal("ping"), c: num }),
  z.object({ t: z.literal("observe"), x: num, z: num }),
  z.object({ t: z.literal("screen"), action: z.literal("set"), content: screenContentSchema }),
  z.object({ t: z.literal("screen"), action: z.enum(["play", "pause"]) }),
  z.object({ t: z.literal("screen"), action: z.literal("seek"), positionSec: num.min(0).max(86400) }),
  z.object({ t: z.literal("promote_chat"), id: z.string().max(64) }),
  z.object({ t: z.literal("kick"), userId: z.string().uuid() }),
  z.object({ t: z.literal("poll_create"), question: z.string(), options: z.array(z.string()), verifiedOnly: z.boolean().optional() }),
  z.object({ t: z.literal("poll_open"), id: z.string().uuid() }),
  z.object({ t: z.literal("poll_close"), id: z.string().uuid() }),
  z.object({ t: z.literal("poll_show"), id: z.string().uuid() }),
] as const) as unknown as z.ZodType<ClientMsg>;

export class Hub {
  private rooms = new Map<string, LiveRoom>();
  private loading = new Map<string, Promise<LiveRoom | null>>();
  /** One active attendance session per account. */
  private byUser = new Map<string, Client>();
  private clients = new Set<Client>();
  private chatLimiter = new RateLimiter(5, 2000);
  private dupFilter = new DuplicateFilter(15_000, 2);
  private settings!: Settings;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private db: Db,
    private auth: Auth,
  ) {}

  async start() {
    this.settings = await getSettings(this.db);
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => this.flushMoves(), 100));
    this.timers.push(
      setInterval(() => {
        for (const c of this.clients) {
          if (!c.alive) {
            c.ws.terminate();
            continue;
          }
          c.alive = false;
          c.ws.ping();
        }
      }, 15_000),
    );
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  async reloadSettings() {
    this.settings = await getSettings(this.db);
    for (const r of this.rooms.values()) {
      r.engine.settings = this.engineSettings();
      this.broadcast(r, { t: "ad", ad: this.stageAd() });
    }
  }

  private stageAd() {
    const s = this.settings;
    return s.stage_ad_enabled && s.stage_ad_url.startsWith("https://") ? { text: s.stage_ad_text, url: s.stage_ad_url } : null;
  }

  private engineSettings() {
    const s = this.settings;
    return {
      findSeatMs: s.find_seat_seconds * 1000,
      inviteClaimMs: s.invite_claim_seconds * 1000,
      requeueCooldownMs: s.requeue_cooldown_seconds * 1000,
      reconnectGraceMs: s.reconnect_grace_seconds * 1000,
      chatRadius: s.chat_radius,
    };
  }

  // ---------- connections ----------

  /** Participant userId → network/device of the connection that admitted them (per-IP / per-device rules). */
  private participantIp = new Map<string, { ip: string; device: string }>();

  attach(ws: WebSocket, user: AppUser, ipHash: string, deviceId: string) {
    const client: Client = { id: randomUUID(), ws, user, roomId: null, role: null, alive: true, lastObserveAt: 0, msgCount: 0, msgWindowStart: Date.now(), ipHash, deviceId };
    const prev = this.byUser.get(user.id);
    if (prev) {
      this.send(prev, { t: "session_replaced" });
      this.detach(prev, false);
      prev.ws.close(4001, "session_replaced");
    }
    this.byUser.set(user.id, client);
    this.clients.add(client);
    ws.on("pong", () => (client.alive = true));
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - client.msgWindowStart > 1000) {
        client.msgWindowStart = now;
        client.msgCount = 0;
      }
      if (++client.msgCount > 40) return; // flood guard
      let parsed: ClientMsg;
      try {
        const r = msgSchema.safeParse(JSON.parse(String(data)));
        if (!r.success) return this.error(client, "INVALID");
        parsed = r.data;
      } catch {
        return this.error(client, "INVALID");
      }
      this.handle(client, parsed).catch((e) => {
        if (e instanceof AppError) this.send(client, { t: "error", code: e.code, message: e.message });
        else {
          console.error("[hub]", e);
          this.error(client, "INTERNAL", "Lỗi máy chủ, vui lòng thử lại.");
        }
      });
    });
    ws.on("close", () => {
      this.clients.delete(client);
      if (this.byUser.get(user.id) === client) {
        this.byUser.delete(user.id);
        this.detach(client, false);
      }
    });
  }

  /** Socket gone: participants keep their place for the reconnect grace period. */
  private detach(client: Client, leave: boolean) {
    const room = client.roomId ? this.rooms.get(client.roomId) : null;
    if (room) {
      room.clients.delete(client);
      if (client.role === "participant") {
        if (leave) room.engine.leave(client.user.id, Date.now(), "left");
        else room.engine.disconnect(client.user.id, Date.now());
      } else room.engine.removeObserver(client.user.id);
      this.flush(room);
    }
    client.roomId = null;
    client.role = null;
  }

  private send(c: Client, m: ServerMsg) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m));
  }

  private error(c: Client, code: string, message = "") {
    this.send(c, { t: "error", code, message });
  }

  private broadcast(room: LiveRoom, m: ServerMsg) {
    const data = JSON.stringify(m);
    for (const c of room.clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }

  // ---------- rooms ----------

  private async load(roomId: string): Promise<LiveRoom | null> {
    const live = this.rooms.get(roomId);
    if (live) return live;
    const pending = this.loading.get(roomId);
    if (pending) return pending;
    const p = (async () => {
      const row = await getRoom(this.db, roomId);
      if (!row || row.status !== "open" || row.slots_released_at || new Date(row.expires_at).getTime() <= Date.now()) return null;
      const engine = new RoomEngine(
        { roomId, entryMode: row.entry_mode, officialCapacity: row.official_capacity, waitingCapacity: row.waiting_capacity, layout: buildLayout(row.map_code, row.official_capacity) },
        this.engineSettings(),
      );
      const screen = (row.screen_state as ScreenState)?.content ? (row.screen_state as ScreenState) : BLANK_SCREEN;
      const r: LiveRoom = { row, engine, screen, clients: new Set(), ownerInbox: new Map(), movesPending: false };
      this.rooms.set(roomId, r);
      return r;
    })().finally(() => this.loading.delete(roomId));
    this.loading.set(roomId, p);
    return p;
  }

  private roomInfo(row: RoomRow): RoomInfoDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      map: row.map_code,
      entryMode: row.entry_mode,
      officialCapacity: row.official_capacity,
      waitingCapacity: row.waiting_capacity,
      avatarGroups: row.avatar_groups as AvatarGroup[],
      expiresAt: new Date(row.expires_at).getTime(),
      isTrial: row.is_trial,
    };
  }

  /** Called by the sweeper / owner / admin after the DB marked the room closed. */
  closeRoom(roomId: string, reason: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.broadcast(room, { t: "room_closed", reason });
    for (const uid of room.engine.members.keys()) this.participantIp.delete(uid);
    for (const c of room.clients) {
      c.roomId = null;
      c.role = null;
    }
    this.rooms.delete(roomId);
  }

  async refreshRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const row = await getRoom(this.db, roomId);
    if (!row) return;
    room.row = row;
    this.broadcast(room, { t: "room", expiresAt: new Date(row.expires_at).getTime() });
  }

  private flush(room: LiveRoom) {
    const ch = room.engine.drain();
    room.movesPending = false;
    if (ch.upserts.length || ch.removals.length) this.broadcast(room, { t: "members", upsert: ch.upserts, remove: ch.removals });
    for (const uid of ch.personal) {
      const c = this.byUser.get(uid);
      if (c && c.roomId === room.row.id) this.send(c, { t: "you", personal: room.engine.personal(uid) });
    }
    for (const r of ch.removals) {
      this.participantIp.delete(r.userId);
      const c = this.byUser.get(r.userId);
      if (c && c.roomId === room.row.id && c.role === "participant" && r.reason !== "left") {
        if (r.reason === "kicked") this.send(c, { t: "kicked" });
        c.roomId = null;
        c.role = null;
        room.clients.delete(c);
      }
    }
    for (const l of ch.logs) logRoomEvent(this.db, room.row.id, l.actorId, l.type, l.data).catch((e) => console.error("[hub] log", e));
  }

  private flushMoves() {
    for (const room of this.rooms.values()) if (room.movesPending) this.flush(room);
  }

  private tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.engine.tick(now);
      for (const [id, m] of room.ownerInbox) if (now - m.at > 120_000) room.ownerInbox.delete(id);
      this.flush(room);
    }
  }

  // ---------- message handling ----------

  private async handle(c: Client, m: ClientMsg) {
    if (m.t === "ping") return this.send(c, { t: "pong", c: m.c, s: Date.now() });
    if (m.t === "join") return this.join(c, m);
    const room = c.roomId ? this.rooms.get(c.roomId) : null;
    if (!room) return this.error(c, "ROOM_NOT_OPEN", "Bạn chưa ở trong phòng.");
    const uid = c.user.id;
    const now = Date.now();
    // Owner powers follow the account (the owner may also attend as a seated participant).
    const isOwner = room.row.owner_id === uid;
    const requireOwner = () => {
      if (!isOwner) throw new AppError("FORBIDDEN", "Chỉ chủ phòng được thao tác này.", 403);
    };

    switch (m.t) {
      case "leave":
        this.detach(c, true);
        return;
      case "move": {
        if (c.role !== "participant") return;
        const r = room.engine.move(uid, m.x, m.z, m.rotY, now);
        if (r.ok) room.movesPending = true;
        if (r.corrected) {
          const p = room.engine.positionOf(uid)!;
          this.send(c, { t: "corrected", x: p.x, z: p.z });
        }
        return;
      }
      case "observe":
        if (c.role === "participant" || now - c.lastObserveAt < 100) return;
        c.lastObserveAt = now;
        room.engine.setObserver(uid, m.x, m.z);
        return;
      case "claim":
      case "change_seat":
      case "accept_invite": {
        const r = m.t === "claim" ? room.engine.claimSeat(uid, m.seatId, now) : m.t === "change_seat" ? room.engine.changeSeat(uid, m.seatId) : room.engine.acceptInvite(uid, now);
        if (!r.ok) this.error(c, r.code);
        this.flush(room);
        return;
      }
      case "chat":
        return this.chat(room, c, m.text, now);
      case "vote": {
        if (c.role !== "participant" || !room.engine.canVote(uid)) return this.error(c, "NOT_A_PARTICIPANT");
        await castVote(this.db, room.row.id, m.pollId, uid, m.optionId, { isGuest: c.user.is_guest });
        this.send(c, { t: "my_vote", pollId: m.pollId, optionId: m.optionId });
        const v = await pollView(this.db, m.pollId);
        if (v) this.broadcast(room, { t: "poll", poll: v });
        return;
      }
      case "screen": {
        requireOwner();
        room.screen = applyScreenAction(room.screen, m, now);
        await saveScreenState(this.db, room.row.id, room.screen);
        await logRoomEvent(this.db, room.row.id, uid, `screen_${m.action}`, m.action === "set" ? { content: m.content } : { positionSec: room.screen.positionSec, playing: room.screen.playing });
        this.broadcast(room, { t: "screen", state: room.screen });
        return;
      }
      case "promote_chat": {
        requireOwner();
        const msg = room.ownerInbox.get(m.id);
        if (!msg) return this.error(c, "INVALID", "Tin nhắn không còn khả dụng (chỉ giữ tạm 2 phút trong bộ nhớ).");
        room.screen = applyScreenAction(room.screen, { action: "set", content: { kind: "chat", text: msg.text, author: msg.name } }, now);
        await saveScreenState(this.db, room.row.id, room.screen);
        // Exception to "chat is never stored": a message promoted to the screen is logged from now on.
        await logRoomEvent(this.db, room.row.id, uid, "chat_promoted", { text: msg.text, author: msg.name });
        this.broadcast(room, { t: "screen", state: room.screen });
        return;
      }
      case "kick": {
        requireOwner();
        const r = room.engine.kick(m.userId, uid, now);
        if (!r.ok) this.error(c, r.code);
        this.flush(room);
        return;
      }
      case "poll_create": {
        requireOwner();
        const input = pollCreateSchema.parse({ question: m.question, options: m.options, verifiedOnly: m.verifiedOnly ?? false });
        const id = await createPoll(this.db, room.row.id, uid, input);
        const v = await pollView(this.db, id);
        if (v) this.broadcast(room, { t: "poll", poll: v });
        return;
      }
      case "poll_open":
      case "poll_close": {
        requireOwner();
        const closed = await setPollStatus(this.db, room.row.id, m.id, uid, m.t === "poll_open" ? "open" : "closed");
        for (const id of [...closed, m.id]) {
          const v = await pollView(this.db, id);
          if (v) this.broadcast(room, { t: "poll", poll: v });
        }
        return;
      }
      case "poll_show": {
        requireOwner();
        const v = await pollView(this.db, m.id);
        if (!v) return this.error(c, "INVALID");
        room.screen = applyScreenAction(room.screen, { action: "set", content: { kind: "poll", pollId: m.id } }, now);
        await saveScreenState(this.db, room.row.id, room.screen);
        await logRoomEvent(this.db, room.row.id, uid, "screen_set", { content: room.screen.content });
        this.broadcast(room, { t: "screen", state: room.screen });
        return;
      }
    }
  }

  private async join(c: Client, m: Extract<ClientMsg, { t: "join" }>) {
    const room = await this.load(m.roomId);
    if (!room) return this.error(c, "ROOM_NOT_OPEN", "Phòng đã đóng, hết hạn hoặc không tồn tại.");
    if (c.roomId && c.roomId !== m.roomId) this.detach(c, true);
    // A user switching rooms leaves the previous one immediately.
    for (const other of this.rooms.values()) {
      if (other !== room && other.engine.members.has(c.user.id)) {
        other.engine.leave(c.user.id, Date.now(), "switched_room");
        this.flush(other);
      }
    }

    const uid = c.user.id;
    const isOwner = room.row.owner_id === uid;
    let role: RoomRole;
    if (isOwner && !m.asParticipant) role = "owner";
    else if (!isOwner && c.user.role === "app_owner" && !m.pass) role = "observer";
    else {
      if (!isOwner && !this.auth.verifyRoomPass(m.pass, uid, room.row.id)) return this.error(c, "NO_PASS");
      if (!m.avatar || !isValidAvatar(m.avatar.group, m.avatar.model) || !room.row.avatar_groups.includes(m.avatar.group)) return this.error(c, "AVATAR_NOT_ALLOWED");
      // System-wide (members in reconnect grace still count): one participant per device,
      // at most N participants per IP (shared Wi-Fi / mobile CGNAT can hold a few people).
      let sameIp = 0;
      for (const other of this.rooms.values())
        for (const mid of other.engine.members.keys()) {
          const net = mid !== uid ? this.participantIp.get(mid) : undefined;
          if (!net) continue;
          if (net.device === c.deviceId) return this.error(c, "DEVICE_LIMIT", ERROR_TEXT.DEVICE_LIMIT);
          if (net.ip === c.ipHash) sameIp++;
        }
      const cap = this.settings.ip_max_participants;
      if (cap > 0 && sameIp >= cap) return this.error(c, "IP_LIMIT_PARTICIPANT", ERROR_TEXT.IP_LIMIT_PARTICIPANT);
      this.participantIp.set(uid, { ip: c.ipHash, device: c.deviceId });
      const r = room.engine.join(uid, c.user.display_name, { group: m.avatar.group as AvatarGroup, model: m.avatar.model }, Date.now());
      if (!r.ok) {
        this.participantIp.delete(uid);
        this.flush(room);
        return this.error(c, r.code);
      }
      role = "participant";
    }
    c.roomId = room.row.id;
    c.role = role;
    room.clients.add(c);
    if (role !== "participant") {
      const l = room.engine.config.layout;
      room.engine.setObserver(uid, 0, (l.main.minZ + l.main.maxZ) / 2);
    }
    this.flush(room);
    this.send(c, {
      t: "welcome",
      role,
      you: { userId: uid, name: c.user.display_name, isGuest: c.user.is_guest, isRoomOwner: isOwner },
      room: this.roomInfo(room.row),
      members: room.engine.publicMembers(),
      screen: room.screen,
      polls: await listPolls(this.db, room.row.id),
      myVotes: await myVotes(this.db, room.row.id, uid),
      personal: room.engine.personal(uid),
      serverNow: Date.now(),
      settings: { chatRadius: this.settings.chat_radius, chatMaxLength: this.settings.chat_max_length, warningMinutes: this.settings.warning_minutes, findSeatSeconds: this.settings.find_seat_seconds },
      ad: this.stageAd(),
    });
  }

  private chat(room: LiveRoom, c: Client, raw: string, now: number) {
    const text = sanitizeChat(raw, this.settings.chat_max_length);
    if (!text) return;
    if (!this.chatLimiter.take(c.user.id, now)) return this.error(c, "CHAT_RATE");
    if (!this.dupFilter.allow(c.user.id, text, now)) return this.error(c, "CHAT_SPAM");
    const msg: ServerMsg = { t: "chat", id: randomUUID(), from: c.user.id, name: c.user.display_name, text, at: now };
    const recipients = new Set(room.engine.chatRecipients(c.user.id));
    // Deliver only to recipients in range. Nothing is written to the DB or logs.
    const data = JSON.stringify(msg);
    for (const rc of room.clients) {
      if (!recipients.has(rc.user.id) || rc.ws.readyState !== rc.ws.OPEN) continue;
      rc.ws.send(data);
      if (rc.user.id === room.row.owner_id) room.ownerInbox.set(msg.id, { text, name: c.user.display_name, at: now });
    }
  }

  // ---------- stats for the admin dashboard ----------

  stats() {
    const rooms = [...this.rooms.values()].map((r) => ({ roomId: r.row.id, name: r.row.name, connections: r.clients.size, ...r.engine.stats() }));
    const sum = (k: "seated" | "finding" | "invited" | "waiting" | "connected") => rooms.reduce((a, r) => a + r[k], 0);
    return {
      onlineUsers: this.byUser.size,
      connections: this.clients.size,
      seated: sum("seated"),
      findingSeat: sum("finding") + sum("invited"),
      waiting: sum("waiting"),
      rooms,
    };
  }

  roomStats(roomId: string) {
    const r = this.rooms.get(roomId);
    if (!r) return null;
    return { ...r.engine.stats(), members: r.engine.publicMembers(), queue: r.engine.queueOrder().map((m) => ({ userId: m.userId, name: m.name, cooldownUntil: m.cooldownUntil })) };
  }
}
