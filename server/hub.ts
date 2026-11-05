import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { Db } from "./db";
import type { Auth } from "./auth";
import { buildLayout, isValidAvatar, validAvatarColor, type AvatarGroup } from "@/core/maps";
import { RoomEngine } from "@/core/room-engine";
import { advanceVideo, applyScreenAction, BLANK_SCREEN, currentPosition, PLAYLIST_MAX, screenContentSchema, YOUTUBE_END_MODES, type ScreenState } from "@/core/screen";
import { knownDuration } from "./youtube";
import { DuplicateFilter, RateLimiter, sanitizeChat } from "@/core/chat";
import { ERROR_TEXT, REACTIONS, type ClientMsg, type QuestionDto, type RoomInfoDto, type RoomRole, type ServerMsg } from "@/core/protocol";
import { getSettings, type Settings } from "./services/settings";
import { getRoom, logRoomEvent, saveScreenState, AppError, type RoomRow } from "./services/rooms";
import { castVote, createPoll, listPolls, myVotes, pollCreateSchema, pollView, setPollStatus } from "./services/polls";
import type { AppUser } from "./services/users";
import { askQuestion, getQuestion, listModerators, listQuestions, myQuestionVotes, setQuestionStatus, toggleVote } from "./services/qa";
import type { MarketService } from "./market/service";

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
  /** Signature of the last live market bar sent to this room (avoid resending unchanged data). */
  liveSig?: string;
  /** Co-hosts (user ids): stage, polls, Q&A, kick — not close / pay / transfer. */
  mods: Set<string>;
  /** Raised hands, in order. Cleared when the person leaves or a moderator lowers it. */
  hands: Map<string, { name: string; at: number }>;
  /** Activity since the last statistics sample (counts only, no content). */
  counters: { reactions: number; chats: number };
  /** Stage lights (owner / co-host switch, everyone sees it). Live state only: a new session starts lit. */
  lights: boolean;
}

const num = z.number().finite();
const msgSchema = z.union([
  z.object({ t: z.literal("join"), roomId: z.string().uuid(), pass: z.string().max(2000).optional(), avatar: z.object({ group: z.string(), model: z.string(), color: z.string().max(16).optional() }).optional(), asParticipant: z.boolean().optional() }),
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
  z.object({ t: z.literal("screen"), action: z.literal("yt_options"), endMode: z.enum(YOUTUBE_END_MODES), playlist: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).max(PLAYLIST_MAX) }),
  z.object({ t: z.literal("screen"), action: z.literal("yt_next") }),
  z.object({ t: z.literal("screen_ended"), rev: z.number().int().min(0) }),
  z.object({ t: z.literal("promote_chat"), id: z.string().max(64) }),
  z.object({ t: z.literal("kick"), userId: z.string().uuid() }),
  z.object({ t: z.literal("poll_create"), question: z.string(), options: z.array(z.string()), verifiedOnly: z.boolean().optional() }),
  z.object({ t: z.literal("poll_open"), id: z.string().uuid() }),
  z.object({ t: z.literal("poll_close"), id: z.string().uuid() }),
  z.object({ t: z.literal("poll_show"), id: z.string().uuid() }),
  z.object({ t: z.literal("react"), e: z.enum(REACTIONS) }),
  z.object({ t: z.literal("hand"), up: z.boolean() }),
  z.object({ t: z.literal("q_ask"), text: z.string().max(2000) }),
  z.object({ t: z.literal("q_vote"), id: z.string().uuid() }),
  z.object({ t: z.literal("hand_lower"), userId: z.string().uuid() }),
  z.object({ t: z.literal("q_set"), id: z.string().uuid(), status: z.enum(["open", "answered", "hidden"]) }),
  z.object({ t: z.literal("q_show"), id: z.string().uuid() }),
  z.object({ t: z.literal("stage_lights"), on: z.boolean() }),
] as const) as unknown as z.ZodType<ClientMsg>;

export class Hub {
  private rooms = new Map<string, LiveRoom>();
  private loading = new Map<string, Promise<LiveRoom | null>>();
  /** One active attendance session per account. */
  private byUser = new Map<string, Client>();
  private clients = new Set<Client>();
  private chatLimiter = new RateLimiter(5, 2000);
  private reactLimiter = new RateLimiter(8, 2000);
  private qaLimiter = new RateLimiter(1, 20_000);
  private dupFilter = new DuplicateFilter(15_000, 2);
  private settings!: Settings;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private db: Db,
    private auth: Auth,
  ) {}

  private market: MarketService | null = null;

  /** Live market bars are pushed to rooms whose stage shows a chart. */
  setMarket(m: MarketService) {
    this.market = m;
  }

  async start() {
    this.settings = await getSettings(this.db);
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => this.flushMoves(), 100));
    this.timers.push(setInterval(() => void this.sampleStats(), 60_000));
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
      if (leave && room.hands.delete(client.user.id)) this.sendHands(room);
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
      const mods = new Set((await listModerators(this.db, roomId)).map((m) => m.userId));
      const r: LiveRoom = { row, engine, screen, clients: new Set(), ownerInbox: new Map(), movesPending: false, mods, hands: new Map(), counters: { reactions: 0, chats: 0 }, lights: true };
      this.rooms.set(roomId, r);
      return r;
    })().finally(() => this.loading.delete(roomId));
    this.loading.set(roomId, p);
    return p;
  }

  private roomInfo(row: RoomRow, lights = true): RoomInfoDto {
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
      openEnded: row.open_ended,
      isTrial: row.is_trial,
      startsAt: row.scheduled_at ? new Date(row.scheduled_at).getTime() : null,
      stageStyle: row.stage_style ?? "plain",
      stageLights: lights,
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

  /** The owner / a co-host switched the stage look: everyone sees it at once. */
  setStageStyle(roomId: string, style: "glam" | "plain") {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.row = { ...room.row, stage_style: style };
    this.broadcast(room, { t: "stage_style", style });
  }

  /** Co-hosts changed (REST): update powers of everyone connected right away. */
  async refreshModerators(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.mods = new Set((await listModerators(this.db, roomId)).map((m) => m.userId));
    for (const c of room.clients) this.send(c, { t: "mod", isModerator: room.mods.has(c.user.id) });
  }

  /** Ownership moved to another account: reload the row so owner checks follow it. */
  async refreshOwner(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const row = await getRoom(this.db, roomId);
    if (row) room.row = row;
    await this.refreshModerators(roomId);
  }

  private isMod(room: LiveRoom, uid: string) {
    return room.row.owner_id === uid || room.mods.has(uid);
  }

  private sendHands(room: LiveRoom) {
    this.broadcast(room, { t: "hands", hands: [...room.hands].map(([userId, h]) => ({ userId, name: h.name, at: h.at })) });
  }

  /** Hidden questions are visible to moderators only. */
  private sendQuestion(room: LiveRoom, q: QuestionDto) {
    const full = JSON.stringify({ t: "question", q } satisfies ServerMsg);
    const removed = JSON.stringify({ t: "question_remove", id: q.id } satisfies ServerMsg);
    for (const c of room.clients) {
      if (c.ws.readyState !== c.ws.OPEN) continue;
      c.ws.send(q.status !== "hidden" || this.isMod(room, c.user.id) ? full : removed);
    }
  }

  /** Per-minute attendance sample for the owner's report. */
  private async sampleStats() {
    const at = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    for (const room of this.rooms.values()) {
      const st = room.engine.stats();
      const { reactions, chats } = room.counters;
      room.counters = { reactions: 0, chats: 0 };
      await this.db
        .query(
          "insert into app.room_stats (room_id, at, connections, seated, waiting, reactions, chats) values ($1, $2, $3, $4, $5, $6, $7) on conflict (room_id, at) do update set connections = excluded.connections, seated = excluded.seated, waiting = excluded.waiting, reactions = app.room_stats.reactions + excluded.reactions, chats = app.room_stats.chats + excluded.chats",
          [room.row.id, at, room.clients.size, st.seated, st.waiting, reactions, chats],
        )
        .catch((e) => console.error("[hub] stats", e));
    }
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

  /** Every second: keep the on-screen symbol live and push its forming bar if it changed. */
  private pushLiveMarket(room: LiveRoom) {
    const c = room.screen.content;
    if (!this.market || c.kind !== "chart" || !room.clients.size) return;
    this.market.wantLive(c.symbol);
    const bars = this.market.liveBars(c.symbol);
    if (!bars?.length) return;
    const last = bars[bars.length - 1];
    const sig = c.symbol + "|" + last.time + "|" + last.close + "|" + last.volume;
    if (sig === room.liveSig) return;
    room.liveSig = sig;
    this.broadcast(room, { t: "market", symbol: c.symbol, bars });
  }

  private tick() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      room.engine.tick(now);
      this.autoAdvanceVideo(room, now);
      this.pushLiveMarket(room);
      for (const [id, m] of room.ownerInbox) if (now - m.at > 120_000) room.ownerInbox.delete(id);
      this.flush(room);
    }
  }

  // ---------- YouTube: loop / next in playlist, decided by the server ----------

  /** The server knows the video length → it moves on by itself when the video ends. */
  private autoAdvanceVideo(room: LiveRoom, now: number) {
    const c = room.screen.content;
    if (c.kind !== "youtube" || !room.screen.playing) return;
    const d = knownDuration(c.videoId);
    if (typeof d !== "number" || currentPosition(room.screen, now) < d - 0.5) return;
    if (c.endMode && c.endMode !== "stop") return this.advanceVideo(room, now, null, "screen_auto_" + c.endMode);
    // "stop": the video is over → paused on its last frame (the owner sees "tạm dừng", not a running clock)
    room.screen = { ...room.screen, playing: false, positionSec: d, updatedAt: now, rev: room.screen.rev + 1 };
    saveScreenState(this.db, room.row.id, room.screen).catch((e) => console.error("[hub] screen", e));
    this.broadcast(room, { t: "screen", state: room.screen });
  }

  private advanceVideo(room: LiveRoom, now: number, actorId: string | null, type: string, force = false) {
    const next = advanceVideo(room.screen, now, force);
    if (!next) return;
    room.screen = next;
    if (next.content.kind === "youtube") knownDuration(next.content.videoId); // look the next length up now
    saveScreenState(this.db, room.row.id, room.screen).catch((e) => console.error("[hub] screen", e));
    logRoomEvent(this.db, room.row.id, actorId, type, { content: room.screen.content }).catch((e) => console.error("[hub] log", e));
    this.broadcast(room, { t: "screen", state: room.screen });
  }

  // ---------- message handling ----------

  private async handle(c: Client, m: ClientMsg) {
    if (m.t === "ping") return this.send(c, { t: "pong", c: m.c, s: Date.now() });
    if (m.t === "join") return this.join(c, m);
    const room = c.roomId ? this.rooms.get(c.roomId) : null;
    if (!room) return this.error(c, "ROOM_NOT_OPEN", "Bạn chưa ở trong phòng.");
    const uid = c.user.id;
    const now = Date.now();
    // Owner / co-host powers follow the account (they may also attend as a seated participant).
    const isMod = this.isMod(room, uid);
    const requireOwner = () => {
      if (!isMod) throw new AppError("FORBIDDEN", "Chỉ chủ phòng hoặc trợ lý được thao tác này.", 403);
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
      case "screen_ended": {
        // Fallback only when the server could not learn the video length: a player says "ended".
        // Trusted from the owner / a co-host, or from anyone when no moderator is in the room.
        const c = room.screen.content;
        if (m.rev !== room.screen.rev || c.kind !== "youtube" || !room.screen.playing) return;
        if (typeof knownDuration(c.videoId) === "number") return; // the server handles it itself
        const modHere = [...room.clients].some((x) => this.isMod(room, x.user.id));
        if (!isMod && modHere) return;
        if (currentPosition(room.screen, now) < 5) return;
        this.advanceVideo(room, now, uid, "screen_ended_" + (c.endMode ?? "stop"));
        return;
      }
      case "screen": {
        requireOwner();
        if (m.action === "yt_next") {
          this.advanceVideo(room, now, uid, "screen_yt_next", true);
          return;
        }
        room.screen = applyScreenAction(room.screen, m, now);
        if (room.screen.content.kind === "youtube") knownDuration(room.screen.content.videoId); // learn the length early
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
      case "react": {
        if (!this.reactLimiter.take(uid, now)) return;
        room.counters.reactions++;
        this.broadcast(room, { t: "react", from: uid, e: m.e });
        return;
      }
      case "hand": {
        if (c.role !== "participant") return;
        if (m.up) room.hands.set(uid, { name: c.user.display_name, at: now });
        else room.hands.delete(uid);
        this.sendHands(room);
        return;
      }
      case "hand_lower": {
        requireOwner();
        if (room.hands.delete(m.userId)) this.sendHands(room);
        return;
      }
      case "q_ask": {
        const text = sanitizeChat(m.text, 300);
        if (!text) return;
        if (c.role === "observer") return this.error(c, "FORBIDDEN");
        if (!this.qaLimiter.take(uid, now)) return this.error(c, "QA_RATE", ERROR_TEXT.QA_RATE);
        const q = await askQuestion(this.db, room.row.id, uid, c.user.display_name, text);
        this.sendQuestion(room, q);
        return;
      }
      case "q_vote": {
        if (c.role === "observer") return;
        const r = await toggleVote(this.db, room.row.id, m.id, uid);
        this.send(c, { t: "my_qvote", id: m.id, on: r.on });
        this.sendQuestion(room, r.q);
        return;
      }
      case "q_set": {
        requireOwner();
        const q = await setQuestionStatus(this.db, room.row.id, m.id, m.status);
        await logRoomEvent(this.db, room.row.id, uid, "question_" + m.status, { questionId: q.id, text: q.text, author: q.author });
        this.sendQuestion(room, q);
        return;
      }
      case "q_show": {
        requireOwner();
        const q = await getQuestion(this.db, room.row.id, m.id);
        if (!q) return this.error(c, "INVALID");
        room.screen = applyScreenAction(room.screen, { action: "set", content: { kind: "question", questionId: q.id, text: q.text, author: q.author, votes: q.votes } }, now);
        await saveScreenState(this.db, room.row.id, room.screen);
        await logRoomEvent(this.db, room.row.id, uid, "screen_set", { content: room.screen.content });
        this.broadcast(room, { t: "screen", state: room.screen });
        return;
      }
      case "stage_lights": {
        requireOwner();
        if (room.lights === m.on) return;
        room.lights = m.on;
        await logRoomEvent(this.db, room.row.id, uid, "stage_lights", { on: m.on });
        this.broadcast(room, { t: "stage_lights", on: m.on });
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
      const r = room.engine.join(uid, c.user.display_name, { group: m.avatar.group as AvatarGroup, model: m.avatar.model, color: validAvatarColor(m.avatar.group, m.avatar.color) }, Date.now());
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
      you: { userId: uid, name: c.user.display_name, isGuest: c.user.is_guest, isRoomOwner: isOwner, isModerator: room.mods.has(uid) },
      room: this.roomInfo(room.row, room.lights),
      members: room.engine.publicMembers(),
      screen: room.screen,
      polls: await listPolls(this.db, room.row.id),
      myVotes: await myVotes(this.db, room.row.id, uid),
      personal: room.engine.personal(uid),
      serverNow: Date.now(),
      settings: { chatRadius: this.settings.chat_radius, chatMaxLength: this.settings.chat_max_length, warningMinutes: this.settings.warning_minutes, findSeatSeconds: this.settings.find_seat_seconds },
      ad: this.stageAd(),
      hands: [...room.hands].map(([userId, h]) => ({ userId, name: h.name, at: h.at })),
      questions: (await listQuestions(this.db, room.row.id)).filter((q) => q.status !== "hidden" || this.isMod(room, uid)),
      myQuestionVotes: await myQuestionVotes(this.db, room.row.id, uid),
    });
  }

  private chat(room: LiveRoom, c: Client, raw: string, now: number) {
    const text = sanitizeChat(raw, this.settings.chat_max_length);
    if (!text) return;
    if (!this.chatLimiter.take(c.user.id, now)) return this.error(c, "CHAT_RATE");
    if (!this.dupFilter.allow(c.user.id, text, now)) return this.error(c, "CHAT_SPAM");
    room.counters.chats++;
    const msg: ServerMsg = { t: "chat", id: randomUUID(), from: c.user.id, name: c.user.display_name, text, at: now };
    const recipients = new Set(room.engine.chatRecipients(c.user.id));
    // Deliver only to recipients in range. Nothing is written to the DB or logs.
    const data = JSON.stringify(msg);
    for (const rc of room.clients) {
      if (!recipients.has(rc.user.id) || rc.ws.readyState !== rc.ws.OPEN) continue;
      rc.ws.send(data);
      if (this.isMod(room, rc.user.id)) room.ownerInbox.set(msg.id, { text, name: c.user.display_name, at: now });
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

  /** Live numbers not yet in app.room_stats (the report adds them so it is never "0" mid-event). */
  liveActivity(roomId: string) {
    const r = this.rooms.get(roomId);
    if (!r) return null;
    const st = r.engine.stats();
    return { connections: r.clients.size, seated: st.seated, waiting: st.waiting, reactions: r.counters.reactions, chats: r.counters.chats };
  }

  roomStats(roomId: string) {
    const r = this.rooms.get(roomId);
    if (!r) return null;
    return { ...r.engine.stats(), members: r.engine.publicMembers(), queue: r.engine.queueOrder().map((m) => ({ userId: m.userId, name: m.name, cooldownUntil: m.cooldownUntil })) };
  }
}
