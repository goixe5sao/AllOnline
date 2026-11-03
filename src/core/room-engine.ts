/**
 * Authoritative in-memory state of ONE open room: who is admitted, who sits where, the
 * waiting queue, seat-finding timers, reconnect grace and proximity.
 *
 * It is pure (no I/O, injected clock). Every public method runs synchronously to completion,
 * so on the single Node.js event loop each operation is atomic: two people can never take
 * the same seat and admissions can never exceed the room's allocated slots.
 */
import {
  type AvatarGroup,
  type EntryMode,
  type Layout,
  clampToRect,
  gateEntrySpot,
  inRect,
  waitingSpot,
} from "./maps";

export type MemberStatus = "waiting" | "invited" | "finding" | "seated";

export interface EngineSettings {
  findSeatMs: number;
  inviteClaimMs: number;
  requeueCooldownMs: number;
  reconnectGraceMs: number;
  chatRadius: number;
}

export interface RoomEngineConfig {
  roomId: string;
  entryMode: EntryMode;
  officialCapacity: number;
  waitingCapacity: number;
  layout: Layout;
}

export interface Member {
  userId: string;
  name: string;
  avatar: { group: AvatarGroup; model: string };
  status: MemberStatus;
  seatId: string | null;
  x: number;
  z: number;
  rotY: number;
  connected: boolean;
  disconnectedAt: number | null;
  /** Seat-finding (finding) or invitation-claim (invited) deadline, server ms. */
  deadline: number | null;
  cooldownUntil: number;
  queueSeq: number;
  lastMoveAt: number;
}

export type PublicMember = Pick<Member, "userId" | "name" | "avatar" | "status" | "seatId" | "x" | "z" | "rotY" | "connected">;

export interface PersonalState {
  status: MemberStatus;
  seatId: string | null;
  deadline: number | null;
  cooldownUntil: number;
  queuePosition: number | null;
}

export type JoinResult =
  | { ok: true; member: Member; resumed: boolean }
  | { ok: false; code: "ROOM_FULL" | "BANNED" };

export type ActionResult = { ok: true } | { ok: false; code: string };

export interface LogEntry {
  type: string;
  actorId: string | null;
  data: Record<string, unknown>;
}

export interface EngineChanges {
  upserts: PublicMember[];
  removals: { userId: string; reason: string }[];
  personal: string[];
  logs: LogEntry[];
}

export class RoomEngine {
  readonly members = new Map<string, Member>();
  private seatOccupant = new Map<string, string>();
  private seatById: Map<string, Layout["seats"][number]>;
  private banned = new Set<string>();
  private observers = new Map<string, { x: number; z: number }>();
  private seq = 0;
  private dirty = new Set<string>();
  private personalDirty = new Set<string>();
  private removed: { userId: string; reason: string }[] = [];
  private logs: LogEntry[] = [];

  constructor(
    readonly config: RoomEngineConfig,
    public settings: EngineSettings,
  ) {
    this.seatById = new Map(config.layout.seats.map((s) => [s.id, s]));
  }

  // ---------- counters ----------

  get totalSlots() {
    return this.config.officialCapacity + this.config.waitingCapacity;
  }

  countBy(status: MemberStatus): number {
    let n = 0;
    for (const m of this.members.values()) if (m.status === status) n++;
    return n;
  }

  /** Official places already granted: seated + finding a seat + invited to a seat. */
  officialAccessUsed(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.status !== "waiting") n++;
    return n;
  }

  officialAccessAvailable(): number {
    return Math.max(0, this.config.officialCapacity - this.officialAccessUsed());
  }

  stats() {
    let connected = 0;
    for (const m of this.members.values()) if (m.connected) connected++;
    return {
      admitted: this.members.size,
      seated: this.countBy("seated"),
      finding: this.countBy("finding"),
      invited: this.countBy("invited"),
      waiting: this.countBy("waiting"),
      connected,
      official: this.config.officialCapacity,
      waitingCapacity: this.config.waitingCapacity,
    };
  }

  // ---------- membership ----------

  join(userId: string, name: string, avatar: Member["avatar"], now: number): JoinResult {
    if (this.banned.has(userId)) return { ok: false, code: "BANNED" };
    const existing = this.members.get(userId);
    if (existing) {
      // Reconnect inside the grace period: same seat / queue place.
      existing.connected = true;
      existing.disconnectedAt = null;
      this.touch(existing);
      this.log("reconnected", userId, { status: existing.status, seatId: existing.seatId });
      this.processQueue(now);
      return { ok: true, member: existing, resumed: true };
    }
    if (this.members.size >= this.totalSlots) return { ok: false, code: "ROOM_FULL" };

    // Eligible people already waiting go first.
    this.processQueue(now);

    const m: Member = {
      userId,
      name,
      avatar,
      status: "waiting",
      seatId: null,
      x: 0,
      z: 0,
      rotY: 0,
      connected: true,
      disconnectedAt: null,
      deadline: null,
      cooldownUntil: 0,
      queueSeq: ++this.seq,
      lastMoveAt: now,
    };
    this.members.set(userId, m);

    if (this.officialAccessAvailable() > 0 && !this.hasEligibleWaiting(now, userId)) {
      if (this.config.entryMode === "auto_assign") this.seatNearest(m);
      else this.admitToMainArea(m, now);
    } else {
      this.toWaiting(m, now, false);
    }
    this.log("joined", userId, { status: m.status, seatId: m.seatId, avatar });
    this.touch(m);
    return { ok: true, member: m, resumed: false };
  }

  disconnect(userId: string, now: number) {
    const m = this.members.get(userId);
    if (!m || !m.connected) return;
    m.connected = false;
    m.disconnectedAt = now;
    this.touch(m);
  }

  leave(userId: string, now: number, reason = "left") {
    const m = this.members.get(userId);
    if (!m) return;
    if (m.seatId) this.seatOccupant.delete(m.seatId);
    this.members.delete(userId);
    this.dirty.delete(userId);
    this.removed.push({ userId, reason });
    this.log(reason, userId, { status: m.status, seatId: m.seatId });
    this.processQueue(now);
  }

  kick(userId: string, actorId: string, now: number): ActionResult {
    if (!this.members.has(userId)) return { ok: false, code: "NOT_IN_ROOM" };
    this.banned.add(userId);
    this.leave(userId, now, "kicked");
    this.log("kick", actorId, { userId });
    return { ok: true };
  }

  isBanned(userId: string) {
    return this.banned.has(userId);
  }

  // ---------- seats ----------

  private freeSeats() {
    return this.config.layout.seats.filter((s) => !this.seatOccupant.has(s.id));
  }

  private seatNearest(m: Member) {
    const seat = this.freeSeats().sort((a, b) => a.rank - b.rank)[0];
    if (!seat) throw new Error("invariant: official access granted without a free seat");
    this.sitAt(m, seat.id);
  }

  private sitAt(m: Member, seatId: string) {
    const seat = this.seatById.get(seatId)!;
    if (m.seatId) this.seatOccupant.delete(m.seatId);
    this.seatOccupant.set(seatId, m.userId);
    m.status = "seated";
    m.seatId = seatId;
    m.deadline = null;
    m.x = seat.x;
    m.z = seat.z;
    m.rotY = seat.rotY;
    this.touch(m);
  }

  private admitToMainArea(m: Member, now: number) {
    const spot = gateEntrySpot(this.config.layout);
    m.status = "finding";
    m.seatId = null;
    m.deadline = now + this.settings.findSeatMs;
    m.x = spot.x;
    m.z = spot.z;
    m.rotY = spot.rotY;
    m.lastMoveAt = now;
    this.touch(m);
  }

  private toWaiting(m: Member, now: number, withCooldown: boolean) {
    if (m.seatId) this.seatOccupant.delete(m.seatId);
    const spot = waitingSpot(this.config.layout, this.countBy("waiting"));
    m.status = "waiting";
    m.seatId = null;
    m.deadline = null;
    m.queueSeq = ++this.seq;
    m.cooldownUntil = withCooldown ? now + this.settings.requeueCooldownMs : 0;
    m.x = spot.x;
    m.z = spot.z;
    m.rotY = spot.rotY;
    m.lastMoveAt = now;
    this.touch(m);
  }

  /** Gate mode: "Vào chỗ" next to a free seat. */
  claimSeat(userId: string, seatId: string, now: number): ActionResult {
    const m = this.members.get(userId);
    if (!m) return { ok: false, code: "NOT_IN_ROOM" };
    if (this.config.entryMode !== "gate_entry") return { ok: false, code: "WRONG_MODE" };
    if (m.status !== "finding") return { ok: false, code: "NOT_FINDING" };
    if (m.deadline !== null && now > m.deadline) return { ok: false, code: "FIND_TIME_OVER" };
    const seat = this.seatById.get(seatId);
    if (!seat) return { ok: false, code: "NO_SUCH_SEAT" };
    if (this.seatOccupant.has(seatId)) return { ok: false, code: "SEAT_TAKEN" };
    if (Math.hypot(seat.x - m.x, seat.z - m.z) > this.config.layout.claimDistance) return { ok: false, code: "TOO_FAR" };
    this.sitAt(m, seatId);
    this.log("seat_claimed", userId, { seatId });
    return { ok: true };
  }

  /** Auto mode: "Đổi chỗ" to another free official seat. */
  changeSeat(userId: string, seatId: string): ActionResult {
    const m = this.members.get(userId);
    if (!m) return { ok: false, code: "NOT_IN_ROOM" };
    if (m.status !== "seated") return { ok: false, code: "NOT_SEATED" };
    if (!this.seatById.has(seatId)) return { ok: false, code: "NO_SUCH_SEAT" };
    if (this.seatOccupant.has(seatId)) return { ok: false, code: "SEAT_TAKEN" };
    const from = m.seatId;
    this.sitAt(m, seatId);
    this.log("seat_changed", userId, { from, to: seatId });
    return { ok: true };
  }

  /** Auto mode: accept the invitation from the waiting queue. */
  acceptInvite(userId: string, now: number): ActionResult {
    const m = this.members.get(userId);
    if (!m) return { ok: false, code: "NOT_IN_ROOM" };
    if (m.status !== "invited") return { ok: false, code: "NOT_INVITED" };
    if (m.deadline !== null && now > m.deadline) return { ok: false, code: "INVITE_EXPIRED" };
    this.seatNearest(m);
    this.log("invite_accepted", userId, { seatId: m.seatId });
    return { ok: true };
  }

  // ---------- queue & timers ----------

  private hasEligibleWaiting(now: number, except?: string) {
    for (const m of this.members.values())
      if (m.userId !== except && m.status === "waiting" && m.connected && m.cooldownUntil <= now) return true;
    return false;
  }

  queueOrder(): Member[] {
    return [...this.members.values()].filter((m) => m.status === "waiting").sort((a, b) => a.queueSeq - b.queueSeq);
  }

  processQueue(now: number) {
    while (this.officialAccessAvailable() > 0) {
      const next = this.queueOrder().find((m) => m.connected && m.cooldownUntil <= now);
      if (!next) break;
      if (this.config.entryMode === "auto_assign") {
        next.status = "invited";
        next.deadline = now + this.settings.inviteClaimMs;
        this.touch(next);
        this.log("invited", next.userId, {});
      } else {
        this.admitToMainArea(next, now);
        this.log("admitted_to_main", next.userId, {});
      }
    }
    // Queue positions shift for everybody still waiting.
    for (const m of this.members.values()) if (m.status === "waiting") this.personalDirty.add(m.userId);
  }

  tick(now: number) {
    for (const m of [...this.members.values()]) {
      if (!m.connected && m.disconnectedAt !== null && now - m.disconnectedAt >= this.settings.reconnectGraceMs) {
        this.leave(m.userId, now, "grace_expired");
        continue;
      }
      if (m.deadline !== null && now >= m.deadline) {
        const type = m.status === "finding" ? "find_seat_timeout" : "invite_timeout";
        this.toWaiting(m, now, true);
        this.log(type, m.userId, {});
      }
    }
    this.processQueue(now);
  }

  // ---------- movement ----------

  move(userId: string, x: number, z: number, rotY: number, now: number): { ok: boolean; corrected: boolean } {
    const m = this.members.get(userId);
    if (!m || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rotY)) return { ok: false, corrected: false };
    if (m.status === "seated" || m.status === "invited") return { ok: false, corrected: false };
    const dtMs = now - m.lastMoveAt;
    if (dtMs < 40) return { ok: false, corrected: false }; // > 25 Hz: drop
    const layout = this.config.layout;
    const allowed = m.status === "finding" ? layout.main : layout.waiting;
    let target = clampToRect(allowed, x, z);
    let corrected = target.x !== x || target.z !== z;
    const maxDist = (layout.maxSpeed * Math.min(dtMs, 1000)) / 1000 * 1.5 + 0.3;
    const dist = Math.hypot(target.x - m.x, target.z - m.z);
    if (dist > maxDist) {
      const k = maxDist / dist;
      target = { x: m.x + (target.x - m.x) * k, z: m.z + (target.z - m.z) * k };
      corrected = true;
    }
    if (!inRect(allowed, target.x, target.z)) target = clampToRect(allowed, target.x, target.z);
    m.x = Math.round(target.x * 100) / 100;
    m.z = Math.round(target.z * 100) / 100;
    m.rotY = Math.round(rotY * 1000) / 1000;
    m.lastMoveAt = now;
    this.dirty.add(userId);
    return { ok: true, corrected };
  }

  setObserver(userId: string, x: number, z: number) {
    const l = this.config.layout;
    const r = { minX: l.main.minX, maxX: l.main.maxX, minZ: l.main.minZ, maxZ: l.waiting.maxZ };
    this.observers.set(userId, clampToRect(r, x, z));
  }

  removeObserver(userId: string) {
    this.observers.delete(userId);
  }

  // ---------- proximity ----------

  positionOf(userId: string): { x: number; z: number } | null {
    const m = this.members.get(userId);
    if (m) return { x: m.x, z: m.z };
    return this.observers.get(userId) ?? null;
  }

  /**
   * Server-side recipient filtering: only connected members / observers whose
   * server-validated position is within the chat radius get the message.
   */
  chatRecipients(senderId: string): string[] {
    const from = this.positionOf(senderId);
    if (!from) return [];
    const r = this.settings.chatRadius;
    const out: string[] = [];
    for (const m of this.members.values())
      if (m.connected && Math.hypot(m.x - from.x, m.z - from.z) <= r) out.push(m.userId);
    for (const [id, p] of this.observers) if (Math.hypot(p.x - from.x, p.z - from.z) <= r && !out.includes(id)) out.push(id);
    return out;
  }

  canVote(userId: string): boolean {
    return this.members.has(userId);
  }

  // ---------- change tracking ----------

  personal(userId: string): PersonalState | null {
    const m = this.members.get(userId);
    if (!m) return null;
    const queue = this.queueOrder();
    const idx = queue.findIndex((q) => q.userId === userId);
    return { status: m.status, seatId: m.seatId, deadline: m.deadline, cooldownUntil: m.cooldownUntil, queuePosition: idx >= 0 ? idx + 1 : null };
  }

  publicMember(m: Member): PublicMember {
    return { userId: m.userId, name: m.name, avatar: m.avatar, status: m.status, seatId: m.seatId, x: m.x, z: m.z, rotY: m.rotY, connected: m.connected };
  }

  publicMembers(): PublicMember[] {
    return [...this.members.values()].map((m) => this.publicMember(m));
  }

  occupiedSeats(): string[] {
    return [...this.seatOccupant.keys()];
  }

  private touch(m: Member) {
    this.dirty.add(m.userId);
    this.personalDirty.add(m.userId);
  }

  private log(type: string, actorId: string | null, data: Record<string, unknown>) {
    this.logs.push({ type, actorId, data });
  }

  /** Movement-only changes are reported separately so they can be throttled. */
  drain(): EngineChanges {
    const upserts = [...this.dirty].map((id) => this.members.get(id)).filter((m): m is Member => !!m).map((m) => this.publicMember(m));
    const out: EngineChanges = { upserts, removals: this.removed, personal: [...this.personalDirty], logs: this.logs };
    this.dirty = new Set();
    this.personalDirty = new Set();
    this.removed = [];
    this.logs = [];
    return out;
  }
}
