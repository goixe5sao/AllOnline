import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Db, Queryable } from "../db";
import { canReserve, waitingCapacity } from "@/core/slots";
import { applyDiscount, quoteOpenEnded, quoteRoom, settleOpenEnded, type PriceTier, type Quote, type QuoteResult } from "@/core/pricing";
import { checkPromo, redeemPromo } from "./promos";
import { MAP_INFO, type MapCode } from "@/core/maps";
import { BLANK_SCREEN, screenContentSchema, type ScreenState } from "@/core/screen";
import { getPriceTiers, getSettings, lockSlots, slotBudget, type Settings } from "./settings";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const roomConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  map: z.enum(["hall", "carpet", "tables", "drive_in"]),
  avatarGroups: z.array(z.enum(["people", "animals", "vehicles"])).min(1).max(3),
  officialCapacity: z.number().int().min(1),
  waitingEnabled: z.boolean(),
  entryMode: z.enum(["auto_assign", "gate_entry"]),
  /** Ignored when openEnded is true. */
  durationHours: z.number().int().min(1),
  /** "Mở vô thời hạn – đến khi tắt": deposit up front, settled by hours used on close. */
  openEnded: z.boolean().optional().default(false),
  /** Listed on the home page (the owner can change it later). */
  isPublic: z.boolean().optional().default(false),
  password: z.string().max(64).optional().default(""),
  initialScreen: screenContentSchema.optional(),
});
export type RoomConfig = z.infer<typeof roomConfigSchema>;

export interface RoomRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  map_code: MapCode;
  avatar_groups: string[];
  official_capacity: number;
  waiting_enabled: boolean;
  waiting_capacity: number;
  total_slots: number;
  entry_mode: "auto_assign" | "gate_entry";
  invite_code: string;
  status: "open" | "closed" | "expired";
  is_trial: boolean;
  starts_at: Date;
  expires_at: Date;
  closed_at: Date | null;
  slots_released_at: Date | null;
  screen_state: ScreenState | Record<string, never>;
  is_public: boolean;
  open_ended: boolean;
  hourly_rate_vnd: number | null;
  has_password: boolean;
  created_at: Date;
}

export function roomColumns(alias = "") {
  const p = alias ? alias + "." : "";
  return ["id", "owner_id", "name", "description", "map_code", "avatar_groups", "official_capacity", "waiting_enabled", "waiting_capacity", "total_slots", "entry_mode", "invite_code", "status", "is_trial", "starts_at", "expires_at", "closed_at", "slots_released_at", "screen_state", "is_public", "open_ended", "created_at"]
    .map((c) => p + c)
    .concat(`${p}hourly_rate_vnd::float8 as hourly_rate_vnd`, `(${p}password_hash is not null) as has_password`)
    .join(", ");
}
export const ROOM_COLUMNS = roomColumns();

// ---------- password & codes ----------

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [, saltHex, hashHex] = stored.split("$");
  const a = scryptSync(pw, Buffer.from(saltHex, "hex"), 32);
  const b = Buffer.from(hashHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

// ---------- validation ----------

export function validateConfig(cfg: RoomConfig, s: Settings, opts: { trial: boolean }) {
  if (!s.enabled_maps.includes(cfg.map)) throw new AppError("MAP_DISABLED", "MAP này đang tắt.");
  const allowed = MAP_INFO[cfg.map].groups.filter((g) => s.enabled_avatar_groups.includes(g));
  if (cfg.avatarGroups.some((g) => !allowed.includes(g)))
    throw new AppError("AVATAR_GROUP_NOT_ALLOWED", `MAP này chỉ cho phép nhóm: ${allowed.join(", ")}.`);
  if (cfg.officialCapacity > s.max_room_capacity) throw new AppError("CAPACITY_TOO_LARGE", `Tối đa ${s.max_room_capacity} chỗ chính thức mỗi phòng.`);
  if (cfg.openEnded) {
    if (opts.trial) throw new AppError("TRIAL_OPEN_ENDED", "Dùng thử không áp dụng cho phòng mở vô thời hạn.");
    if (!s.open_ended_enabled) throw new AppError("OPEN_ENDED_DISABLED", "Phòng mở vô thời hạn đang tắt.");
  } else if (opts.trial) {
    if (cfg.durationHours > s.trial_max_hours) throw new AppError("TRIAL_DURATION", `Dùng thử tối đa ${s.trial_max_hours} giờ.`);
    if (cfg.officialCapacity > s.trial_max_capacity) throw new AppError("TRIAL_CAPACITY", `Dùng thử tối đa ${s.trial_max_capacity} chỗ chính thức.`);
  } else if (!s.duration_options.includes(cfg.durationHours)) {
    throw new AppError("INVALID_DURATION", "Thời hạn không nằm trong các gói hiện có.");
  }
}

export async function trialEligibility(q: Queryable, userId: string, s: Settings): Promise<{ eligible: boolean; reason?: string; used: number }> {
  const used = Number((await q.query<{ n: number }>("select count(*)::int as n from app.trial_usages where user_id = $1", [userId])).rows[0].n);
  const now = Date.now();
  if (!s.trial_enabled) return { eligible: false, reason: "Dùng thử đang tắt.", used };
  if (s.trial_starts_at && now < new Date(s.trial_starts_at).getTime()) return { eligible: false, reason: "Chưa đến thời gian dùng thử.", used };
  if (s.trial_ends_at && now > new Date(s.trial_ends_at).getTime()) return { eligible: false, reason: "Đã hết thời gian dùng thử.", used };
  if (used >= s.trial_rooms_per_account) return { eligible: false, reason: "Bạn đã dùng hết lượt tạo phòng miễn phí.", used };
  return { eligible: true, used };
}

// ---------- quote (read-only preview; the order stores its own snapshot) ----------

function quoteFor(tiers: PriceTier[], cfg: RoomConfig, waiting: number, s: Settings): QuoteResult {
  return cfg.openEnded
    ? quoteOpenEnded(tiers, cfg.officialCapacity, waiting, s.waiting_surcharge_pct, Number(s.open_ended_deposit_vnd))
    : quoteRoom(tiers, cfg.officialCapacity, waiting, cfg.durationHours, s.waiting_surcharge_pct);
}

export async function previewQuote(db: Db, userId: string, cfg: RoomConfig, promoCode?: string) {
  const s = await getSettings(db);
  const waiting = waitingCapacity(cfg.officialCapacity, cfg.waitingEnabled, s.waiting_ratio);
  const q = quoteFor(await getPriceTiers(db), cfg, waiting, s);
  const budget = await slotBudget(db);
  const trial = await trialEligibility(db, userId, s);
  let quote = q.ok ? q.quote : null;
  let promoError: string | null = null;
  if (quote && promoCode?.trim()) {
    try {
      const pr = await checkPromo(db, promoCode, userId);
      quote = applyDiscount(quote, pr.code, pr.percent_off);
    } catch (e) {
      promoError = (e as Error).message;
    }
  }
  return { waitingCapacity: waiting, totalSlots: cfg.officialCapacity + waiting, waitingRatio: s.waiting_ratio, quote, promoError, budget, trial };
}

// ---------- room creation ----------

/** Open-ended rooms get a far-away technical expiry; they end when the owner (or the app owner) closes them. */
const OPEN_ENDED_YEARS = 100;

async function insertRoom(q: Queryable, ownerId: string, cfg: RoomConfig, s: Settings, opts: { trial: boolean; orderId?: string; waitingRatio: number; hourlyRate?: number | null }) {
  const waiting = waitingCapacity(cfg.officialCapacity, cfg.waitingEnabled, opts.waitingRatio);
  const screen: ScreenState = cfg.initialScreen ? { ...BLANK_SCREEN, content: cfg.initialScreen, updatedAt: Date.now(), rev: 1 } : BLANK_SCREEN;
  let room: RoomRow | undefined;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    const rows = (
      await q.query<RoomRow>(
        `insert into app.rooms (owner_id, created_by, name, description, map_code, avatar_groups, official_capacity, waiting_enabled,
          waiting_ratio, waiting_capacity, total_slots, entry_mode, invite_code, password_hash, is_trial, order_id, expires_at, screen_state,
          is_public, open_ended, hourly_rate_vnd)
         values ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          now() + case when $19 then make_interval(years => ${OPEN_ENDED_YEARS}) else make_interval(hours => $16) end, $17, $18, $19, $20)
         on conflict (invite_code) do nothing
         returning ${ROOM_COLUMNS}`,
        [
          ownerId,
          cfg.name,
          cfg.description,
          cfg.map,
          cfg.avatarGroups,
          cfg.officialCapacity,
          cfg.waitingEnabled,
          opts.waitingRatio,
          waiting,
          cfg.officialCapacity + waiting,
          cfg.entryMode,
          randomCode(8),
          cfg.password ? hashPassword(cfg.password) : null,
          opts.trial,
          opts.orderId ?? null,
          cfg.durationHours,
          JSON.stringify(screen),
          !!cfg.isPublic,
          !!cfg.openEnded,
          cfg.openEnded ? (opts.hourlyRate ?? 0) : null,
        ],
      )
    ).rows;
    room = rows[0];
  }
  if (!room) throw new AppError("INVITE_CODE_COLLISION", "Không tạo được mã mời, thử lại.", 500);
  await q.query("insert into app.room_owner_history (room_id, owner_id, changed_by) values ($1, $2, $2)", [room.id, ownerId]);
  const { password: _pw, ...safeCfg } = cfg;
  await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'room_created', $3)", [
    room.id,
    ownerId,
    JSON.stringify({ config: { ...safeCfg, hasPassword: !!cfg.password }, waitingCapacity: waiting, totalSlots: room.total_slots, trial: opts.trial, orderId: opts.orderId ?? null, expiresAt: room.expires_at }),
  ]);
  void s;
  return room;
}

export type CreateRoomResult = { kind: "room"; room: RoomRow } | { kind: "order"; order: OrderRow };

/**
 * Trial: allocate slots and create the room immediately.
 * Paid: hold the slots for the payment window and create an order; the room is created
 * only when the payment is confirmed (manual approval or verified webhook).
 */
/**
 * @param deviceHash HMAC hash of the requester device id (null = unknown / not enforced).
 */
export async function requestRoom(db: Db, userId: string, cfg: RoomConfig, useTrial: boolean, deviceHash: string | null = null, promoCode?: string): Promise<CreateRoomResult> {
  return db.tx(async (q) => {
    await lockSlots(q);
    const s = await getSettings(q);
    validateConfig(cfg, s, { trial: useTrial });
    const waiting = waitingCapacity(cfg.officialCapacity, cfg.waitingEnabled, s.waiting_ratio);
    const total = cfg.officialCapacity + waiting;
    const budget = await slotBudget(q);
    if (!canReserve(budget, total))
      throw new AppError("SLOT_BUDGET_EXCEEDED", `Không đủ slot hệ thống: cần ${total}, còn ${budget.remaining}.`, 409);

    // One room creator per device: another account on the same device may not hold an open room / pending order.
    if (deviceHash && s.device_limit_room_creator) {
      const other = await q.query(
        `select 1 from app.rooms where creator_device_hash = $1 and slots_released_at is null and owner_id <> $2
         union all
         select 1 from app.orders where creator_device_hash = $1 and status = 'pending' and hold_expires_at > now() and user_id <> $2
         limit 1`,
        [deviceHash, userId],
      );
      if (other.rows.length)
        throw new AppError("DEVICE_LIMIT_CREATOR", "Thiết bị/trình duyệt này đã có một tài khoản khác đang tạo/giữ phòng. Mỗi thiết bị chỉ một người được tạo phòng.", 409);
    }

    if (useTrial) {
      const t = await trialEligibility(q, userId, s);
      if (!t.eligible) throw new AppError("TRIAL_NOT_ELIGIBLE", t.reason ?? "Không đủ điều kiện dùng thử.", 403);
      const room = await insertRoom(q, userId, cfg, s, { trial: true, waitingRatio: s.waiting_ratio });
      if (deviceHash) await q.query("update app.rooms set creator_device_hash = $2 where id = $1", [room.id, deviceHash]);
      await q.query("insert into app.trial_usages (user_id, room_id) values ($1, $2)", [userId, room.id]);
      return { kind: "room", room };
    }

    const quote = quoteFor(await getPriceTiers(q), cfg, waiting, s);
    // Discount code: validated with a row lock so concurrent orders cannot exceed its limits.
    const promo = quote.ok && promoCode?.trim() ? await checkPromo(q, promoCode, userId, true) : null;
    if (quote.ok && promo) quote.quote = applyDiscount(quote.quote, promo.code, promo.percent_off);
    if (!quote.ok) throw new AppError("NO_PRICE_TIER", "Chưa có giá cho cấu hình này.");
    const order = await insertOrder(q, {
      userId,
      kind: "create_room",
      roomId: null,
      config: { ...cfg, password: cfg.password ? hashPassword(cfg.password) : "", passwordHashed: !!cfg.password, waitingRatio: s.waiting_ratio },
      quote: quote.quote,
      slots: total,
      holdMinutes: s.payment_hold_minutes,
    });
    if (deviceHash) await q.query("update app.orders set creator_device_hash = $2 where id = $1", [order.id, deviceHash]);
    if (promo) await redeemPromo(q, promo, userId, order.id);
    return { kind: "order", order };
  });
}

// ---------- orders ----------

export interface OrderRow {
  id: string;
  code: string;
  user_id: string;
  kind: "create_room" | "extend_room";
  room_id: string | null;
  config: Record<string, unknown>;
  quote: Quote;
  amount_vnd: number;
  slots: number;
  status: string;
  hold_expires_at: Date;
  paid_at: Date | null;
  review_note: string | null;
  created_at: Date;
}

const ORDER_COLUMNS = "id, code, user_id, kind, room_id, config, quote, amount_vnd::float8 as amount_vnd, slots, status, hold_expires_at, paid_at, review_note, created_at";

async function insertOrder(
  q: Queryable,
  o: { userId: string; kind: OrderRow["kind"]; roomId: string | null; config: unknown; quote: Quote; slots: number; holdMinutes: number },
): Promise<OrderRow> {
  for (let i = 0; i < 5; i++) {
    const rows = (
      await q.query<OrderRow>(
        `insert into app.orders (code, user_id, kind, room_id, config, quote, amount_vnd, slots, hold_expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(mins => $9))
         on conflict (code) do nothing returning ${ORDER_COLUMNS}`,
        ["AO" + randomCode(6), o.userId, o.kind, o.roomId, JSON.stringify(o.config), JSON.stringify(o.quote), o.quote.amount, o.slots, o.holdMinutes],
      )
    ).rows;
    if (rows[0]) {
      await q.query("insert into app.system_events (actor_id, type, data) values ($1, 'order_created', $2)", [
        o.userId,
        JSON.stringify({ orderId: rows[0].id, code: rows[0].code, kind: o.kind, amount: o.quote.amount, slots: o.slots, roomId: o.roomId }),
      ]);
      return { ...rows[0], amount_vnd: Number(rows[0].amount_vnd) };
    }
  }
  throw new AppError("ORDER_CODE_COLLISION", "Không tạo được mã đơn.", 500);
}

export async function getOrder(q: Queryable, id: string): Promise<OrderRow | null> {
  const r = (await q.query<OrderRow>(`select ${ORDER_COLUMNS} from app.orders where id = $1`, [id])).rows[0];
  return r ? { ...r, amount_vnd: Number(r.amount_vnd) } : null;
}

export async function listOrders(q: Queryable, filter: { userId?: string; status?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) where.push(`user_id = $${params.push(filter.userId)}`);
  if (filter.status) where.push(`status = $${params.push(filter.status)}`);
  const rows = (await q.query<OrderRow>(`select ${ORDER_COLUMNS} from app.orders ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit 200`, params)).rows;
  return rows.map((r) => ({ ...r, amount_vnd: Number(r.amount_vnd) }));
}

export async function requestExtension(db: Db, userId: string, roomId: string, hours: number, promoCode?: string): Promise<OrderRow> {
  return db.tx(async (q) => {
    const s = await getSettings(q);
    if (!s.extension_enabled) throw new AppError("EXTENSION_DISABLED", "Gia hạn đang tắt.");
    if (!s.duration_options.includes(hours)) throw new AppError("INVALID_DURATION", "Thời hạn gia hạn không hợp lệ.");
    const room = (await q.query<RoomRow>(`select ${ROOM_COLUMNS} from app.rooms where id = $1`, [roomId])).rows[0];
    if (!room || room.owner_id !== userId) throw new AppError("FORBIDDEN", "Chỉ chủ phòng được gia hạn.", 403);
    if (room.status !== "open") throw new AppError("ROOM_NOT_OPEN", "Phòng đã đóng, không thể gia hạn.", 409);
    if (room.open_ended) throw new AppError("OPEN_ENDED_NO_EXTENSION", "Phòng mở vô thời hạn không cần gia hạn.", 409);
    const quote = quoteRoom(await getPriceTiers(q), room.official_capacity, room.waiting_capacity, hours, s.waiting_surcharge_pct);
    if (!quote.ok) throw new AppError("NO_PRICE_TIER", "Chưa có giá cho thời hạn này.");
    // Same capacity: an extension does not take new slots.
    const promo = promoCode?.trim() ? await checkPromo(q, promoCode, userId, true) : null;
    const finalQuote = promo ? applyDiscount(quote.quote, promo.code, promo.percent_off) : quote.quote;
    const order = await insertOrder(q, { userId, kind: "extend_room", roomId, config: { hours }, quote: finalQuote, slots: 0, holdMinutes: s.payment_hold_minutes });
    if (promo) await redeemPromo(q, promo, userId, order.id);
    return order;
  });
}

export type PaymentOutcome = "fulfilled" | "fulfilled_late" | "duplicate" | "already_paid" | "underpaid" | "needs_review" | "unknown_order";

/**
 * Single entry point for every payment confirmation (manual approval, verified webhook, demo).
 * Idempotent per (provider, txnId). Never allocates beyond the slot budget.
 */
export async function confirmPayment(
  db: Db,
  p: { orderCode: string; provider: "manual" | "webhook" | "demo" | "promo"; txnId: string | null; amount: number; actorId: string | null; raw?: unknown },
): Promise<{ outcome: PaymentOutcome; order: OrderRow | null; roomId?: string }> {
  return db.tx(async (q) => {
    await lockSlots(q);
    const order = (await q.query<OrderRow>(`select ${ORDER_COLUMNS} from app.orders where code = $1 for update`, [p.orderCode.trim().toUpperCase()])).rows[0] ?? null;
    const record = async (outcome: PaymentOutcome) => {
      const r = await q.query(
        `insert into app.payments (order_id, provider, provider_txn_id, amount_vnd, outcome, raw, recorded_by) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (provider, provider_txn_id) do nothing returning id`,
        [order?.id ?? null, p.provider, p.txnId, p.amount, outcome, JSON.stringify(p.raw ?? {}), p.actorId],
      );
      return r.rows.length > 0;
    };
    const setOrder = async (status: string, note: string | null, roomId?: string) => {
      await q.query(
        "update app.orders set status = $2, review_note = coalesce($3, review_note), room_id = coalesce($4, room_id), paid_at = case when $2 in ('paid','paid_late') then now() else paid_at end, confirmed_by = coalesce($5, confirmed_by), updated_at = now() where id = $1",
        [order!.id, status, note, roomId ?? null, p.actorId],
      );
      await q.query("insert into app.system_events (actor_id, type, data) values ($1, 'order_status', $2)", [p.actorId, JSON.stringify({ code: order!.code, status, note, provider: p.provider, txnId: p.txnId, amount: p.amount })]);
    };

    if (!order) {
      await record("unknown_order");
      return { outcome: "unknown_order", order: null };
    }
    if (p.txnId) {
      const dup = await q.query("select 1 from app.payments where provider = $1 and provider_txn_id = $2", [p.provider, p.txnId]);
      if (dup.rows.length) return { outcome: "duplicate", order };
    }
    if (order.status === "paid" || order.status === "paid_late") {
      await record("already_paid");
      await q.query("update app.orders set review_note = $2, updated_at = now() where id = $1", [order.id, `Nhận thêm thanh toán ${p.amount} (đơn đã thanh toán) — cần kiểm tra hoàn tiền.`]);
      return { outcome: "already_paid", order };
    }
    if (p.amount < Number(order.amount_vnd)) {
      await record("underpaid");
      await setOrder("underpaid", `Thiếu tiền: nhận ${p.amount}, cần ${order.amount_vnd}.`);
      return { outcome: "underpaid", order };
    }

    const holdValid = order.status === "pending" && new Date(order.hold_expires_at).getTime() > Date.now();
    const s = await getSettings(q);

    if (order.kind === "create_room") {
      if (!holdValid) {
        // Late payment: the hold was already returned. Only fulfil if slots are free now.
        const budget = await slotBudget(q);
        if (!canReserve(budget, order.slots)) {
          await record("needs_review");
          await setOrder("needs_review", "Thanh toán trễ nhưng không còn đủ slot — cần hoàn tiền hoặc xử lý thủ công.");
          return { outcome: "needs_review", order };
        }
      }
      const cfg = order.config as RoomConfig & { passwordHashed?: boolean; waitingRatio: number };
      const room = await insertRoom(q, order.user_id, { ...cfg, password: "" }, s, {
        trial: false,
        orderId: order.id,
        waitingRatio: Number(cfg.waitingRatio),
        hourlyRate: order.quote.openEnded?.hourlyRate ?? null,
      });
      await q.query("update app.rooms set creator_device_hash = (select creator_device_hash from app.orders where id = $2) where id = $1", [room.id, order.id]);
      if (cfg.passwordHashed && cfg.password) await q.query("update app.rooms set password_hash = $2 where id = $1", [room.id, cfg.password]);
      const outcome = holdValid ? "fulfilled" : "fulfilled_late";
      await record(outcome);
      await setOrder(holdValid ? "paid" : "paid_late", p.amount > Number(order.amount_vnd) ? `Thừa tiền: nhận ${p.amount}.` : null, room.id);
      return { outcome, order, roomId: room.id };
    }

    // extend_room
    const hours = Number((order.config as { hours: number }).hours);
    const upd = await q.query<{ expires_at: Date }>(
      `update app.rooms set expires_at = greatest(expires_at, now()) + make_interval(hours => $2)
       where id = $1 and status = 'open' and slots_released_at is null returning expires_at`,
      [order.room_id, hours],
    );
    if (!upd.rows.length) {
      await record("needs_review");
      await setOrder("needs_review", "Phòng đã đóng trước khi xác nhận gia hạn — cần hoàn tiền.");
      return { outcome: "needs_review", order };
    }
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'extended', $3)", [
      order.room_id,
      p.actorId ?? order.user_id,
      JSON.stringify({ hours, orderCode: order.code, expiresAt: upd.rows[0].expires_at }),
    ]);
    const outcome = holdValid ? "fulfilled" : "fulfilled_late";
    await record(outcome);
    await setOrder(holdValid ? "paid" : "paid_late", null);
    return { outcome, order, roomId: order.room_id! };
  });
}

export async function cancelOrder(db: Db, userId: string, orderId: string) {
  const r = await db.query("update app.orders set status = 'cancelled', updated_at = now() where id = $1 and user_id = $2 and status = 'pending' returning code", [orderId, userId]);
  if (!r.rows.length) throw new AppError("ORDER_NOT_PENDING", "Đơn không còn ở trạng thái chờ.", 409);
}

/** Pending orders past their hold window: status flips exactly once, returning the held slots. */
export async function expireOrders(db: Db) {
  const r = await db.query<{ code: string; slots: number }>(
    "update app.orders set status = 'expired', updated_at = now() where status = 'pending' and hold_expires_at <= now() returning code, slots",
  );
  for (const o of r.rows) await db.query("insert into app.system_events (type, data) values ('order_expired', $1)", [JSON.stringify(o)]);
  return r.rows;
}

// ---------- room lifecycle ----------

/** Close/expire a room. The slot release happens at most once (guarded by slots_released_at). */
export async function closeRoom(db: Db, roomId: string, reason: "expired" | "closed_by_owner" | "closed_by_admin", actorId: string | null) {
  return db.tx(async (q) => {
    const r = await q.query<{ total_slots: number; open_ended: boolean; owner_id: string; order_id: string | null; starts_at: Date; closed_at: Date; hourly_rate_vnd: number | null }>(
      `update app.rooms set status = $2, closed_at = now(), close_reason = $3, slots_released_at = now()
       where id = $1 and slots_released_at is null
       returning total_slots, open_ended, owner_id, order_id, starts_at, closed_at, hourly_rate_vnd::float8 as hourly_rate_vnd`,
      [roomId, reason === "expired" ? "expired" : "closed", reason],
    );
    if (!r.rows.length) return false;
    const row = r.rows[0];
    if (row.open_ended) await writeSettlement(q, roomId, row);
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'room_closed', $3)", [roomId, actorId, JSON.stringify({ reason })]);
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, null, 'slots_released', $2)", [roomId, JSON.stringify({ slots: r.rows[0].total_slots })]);
    return true;
  });
}

/** Final bill of an open-ended room, in the closing transaction (exactly once: room_id is the key). */
async function writeSettlement(
  q: Queryable,
  roomId: string,
  row: { owner_id: string; order_id: string | null; starts_at: Date; closed_at: Date; hourly_rate_vnd: number | null },
) {
  const paid = row.order_id
    ? Number((await q.query<{ amount: number }>("select amount_vnd::float8 as amount from app.orders where id = $1 and status in ('paid', 'paid_late')", [row.order_id])).rows[0]?.amount ?? 0)
    : 0;
  const rate = Number(row.hourly_rate_vnd ?? 0);
  const bill = settleOpenEnded(new Date(row.starts_at).getTime(), new Date(row.closed_at).getTime(), rate, paid);
  await q.query(
    `insert into app.room_settlements (room_id, owner_id, order_id, deposit_vnd, hourly_rate_vnd, started_at, ended_at, billed_hours, charge_vnd, balance_vnd, status, settled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $11 = 'settled' then now() end)
     on conflict (room_id) do nothing`,
    [roomId, row.owner_id, row.order_id, paid, rate, row.starts_at, row.closed_at, bill.billedHours, bill.charge, bill.balance, bill.status],
  );
  const data = { deposit: paid, hourlyRate: rate, billedHours: bill.billedHours, charge: bill.charge, balance: bill.balance, status: bill.status };
  await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, null, 'settlement', $2)", [roomId, JSON.stringify(data)]);
  await q.query("insert into app.system_events (actor_id, type, data) values (null, 'room_settlement', $1)", [JSON.stringify({ roomId, ownerId: row.owner_id, ...data })]);
}

export interface SettlementRow {
  room_id: string;
  room_name: string;
  owner_id: string;
  owner_name: string;
  deposit_vnd: number;
  hourly_rate_vnd: number;
  started_at: Date;
  ended_at: Date;
  billed_hours: number;
  charge_vnd: number;
  balance_vnd: number;
  status: "refund_due" | "collect_due" | "settled";
  settled_at: Date | null;
  note: string;
}

export async function listSettlements(q: Queryable, filter: { ownerId?: string; status?: string }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ownerId) where.push(`s.owner_id = $${params.push(filter.ownerId)}`);
  if (filter.status) where.push(`s.status = $${params.push(filter.status)}`);
  return (
    await q.query<SettlementRow>(
      `select s.room_id, r.name as room_name, s.owner_id, u.display_name as owner_name, s.deposit_vnd::float8 as deposit_vnd, s.hourly_rate_vnd::float8 as hourly_rate_vnd,
        s.started_at, s.ended_at, s.billed_hours, s.charge_vnd::float8 as charge_vnd, s.balance_vnd::float8 as balance_vnd, s.status, s.settled_at, s.note
       from app.room_settlements s join app.rooms r on r.id = s.room_id join app.users u on u.id = s.owner_id
       ${where.length ? "where " + where.join(" and ") : ""} order by s.created_at desc limit 300`,
      params,
    )
  ).rows;
}

/** App owner marks a refund as paid out / a shortfall as collected. */
export async function markSettlementDone(db: Db, roomId: string, actorId: string, note: string) {
  const r = await db.query<{ balance_vnd: number }>(
    `update app.room_settlements set status = 'settled', settled_at = now(), settled_by = $2, note = $3
     where room_id = $1 and status <> 'settled' returning balance_vnd::float8 as balance_vnd`,
    [roomId, actorId, note],
  );
  if (!r.rows.length) throw new AppError("SETTLEMENT_NOT_DUE", "Quyết toán này không còn chờ xử lý.", 409);
  const data = JSON.stringify({ roomId, balance: r.rows[0].balance_vnd, note });
  await db.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'settlement_done', $3)", [roomId, actorId, data]);
  await db.query("insert into app.system_events (actor_id, type, data) values ($1, 'settlement_done', $2)", [actorId, data]);
}

/** Deposit actually paid for a room (0 when free / promo 100%). */
export async function roomDeposit(q: Queryable, roomId: string): Promise<number> {
  const r = await q.query<{ amount: number }>(
    "select o.amount_vnd::float8 as amount from app.rooms r join app.orders o on o.id = r.order_id where r.id = $1 and o.status in ('paid', 'paid_late')",
    [roomId],
  );
  return Number(r.rows[0]?.amount ?? 0);
}

/** Cost so far of an open-ended room (shown to its owner while it is open). */
export function runningBill(room: Pick<RoomRow, "open_ended" | "starts_at" | "hourly_rate_vnd">, deposit: number, now = Date.now()) {
  if (!room.open_ended) return null;
  return { deposit, hourlyRate: Number(room.hourly_rate_vnd ?? 0), ...settleOpenEnded(new Date(room.starts_at).getTime(), now, Number(room.hourly_rate_vnd ?? 0), deposit) };
}

// ---------- public listing (home page) ----------

export interface PublicRoomRow {
  id: string;
  name: string;
  description: string;
  map_code: MapCode;
  official_capacity: number;
  waiting_capacity: number;
  entry_mode: string;
  invite_code: string;
  open_ended: boolean;
  expires_at: Date;
  created_at: Date;
  has_password: boolean;
  owner_name: string;
}

export async function listPublicRooms(q: Queryable): Promise<PublicRoomRow[]> {
  return (
    await q.query<PublicRoomRow>(
      `select r.id, r.name, r.description, r.map_code, r.official_capacity, r.waiting_capacity, r.entry_mode, r.invite_code, r.open_ended,
        r.expires_at, r.created_at, (r.password_hash is not null) as has_password, u.display_name as owner_name
       from app.rooms r join app.users u on u.id = r.owner_id
       where r.is_public and r.status = 'open' and r.slots_released_at is null and r.expires_at > now()
       order by r.created_at desc limit 60`,
    )
  ).rows;
}

export async function setRoomVisibility(db: Db, roomId: string, isPublic: boolean, actorId: string) {
  const r = await db.query("update app.rooms set is_public = $2 where id = $1 and slots_released_at is null returning id", [roomId, isPublic]);
  if (!r.rows.length) throw new AppError("ROOM_NOT_OPEN", "Phòng không còn mở.", 409);
  await logRoomEvent(db, roomId, actorId, "visibility", { isPublic });
}

export async function dueRooms(db: Db): Promise<string[]> {
  return (await db.query<{ id: string }>("select id from app.rooms where slots_released_at is null and expires_at <= now()")).rows.map((r) => r.id);
}

export async function getRoom(q: Queryable, id: string): Promise<RoomRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await q.query<RoomRow>(`select ${ROOM_COLUMNS} from app.rooms where id = $1`, [id])).rows[0] ?? null;
}

export async function getRoomByInvite(q: Queryable, code: string): Promise<(RoomRow & { password_hash: string | null }) | null> {
  return (await q.query<RoomRow & { password_hash: string | null }>(`select ${ROOM_COLUMNS}, password_hash from app.rooms where invite_code = $1`, [code.trim().toUpperCase()])).rows[0] ?? null;
}

export async function listRooms(q: Queryable, filter: { ownerId?: string }) {
  const rows = filter.ownerId
    ? await q.query<RoomRow>(`select ${ROOM_COLUMNS} from app.rooms where owner_id = $1 order by created_at desc limit 200`, [filter.ownerId])
    : await q.query<RoomRow & { owner_name: string }>(
        `select ${roomColumns("r")}, u.display_name as owner_name from app.rooms r join app.users u on u.id = r.owner_id order by r.created_at desc limit 500`,
      );
  return rows.rows;
}

export async function transferOwnership(db: Db, roomId: string, newOwnerId: string, actorId: string) {
  await db.tx(async (q) => {
    const r = await q.query("update app.rooms set owner_id = $2 where id = $1 and slots_released_at is null returning id", [roomId, newOwnerId]);
    if (!r.rows.length) throw new AppError("ROOM_NOT_OPEN", "Phòng không còn mở.", 409);
    await q.query("insert into app.room_owner_history (room_id, owner_id, changed_by) values ($1, $2, $3)", [roomId, newOwnerId, actorId]);
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'owner_changed', $3)", [roomId, actorId, JSON.stringify({ newOwnerId })]);
  });
}

export async function logRoomEvent(q: Queryable, roomId: string, actorId: string | null, type: string, data: unknown) {
  await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, $3, $4)", [roomId, actorId, type, JSON.stringify(data ?? {})]);
}

export async function saveScreenState(q: Queryable, roomId: string, state: ScreenState) {
  await q.query("update app.rooms set screen_state = $2 where id = $1", [roomId, JSON.stringify(state)]);
}
