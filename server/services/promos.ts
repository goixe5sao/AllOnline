import { z } from "zod";
import type { Db, Queryable } from "../db";
import { AppError } from "./rooms";

export interface PromoRow {
  code: string;
  percent_off: number;
  active: boolean;
  max_uses: number | null;
  per_user_limit: number | null;
  used_count: number;
  valid_from: Date | null;
  valid_to: Date | null;
  note: string;
  created_at: Date;
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

/**
 * Checks a code for a user. Pass `lock` inside the order transaction so concurrent orders
 * cannot exceed max_uses / per_user_limit.
 */
export async function checkPromo(q: Queryable, rawCode: string, userId: string, lock = false): Promise<PromoRow> {
  const code = normalizeCode(rawCode);
  const p = (await q.query<PromoRow>(`select * from app.promo_codes where code = $1 ${lock ? "for update" : ""}`, [code])).rows[0];
  if (!p || !p.active) throw new AppError("PROMO_INVALID", "Mã giảm giá không hợp lệ.", 400);
  const now = Date.now();
  if (p.valid_from && now < new Date(p.valid_from).getTime()) throw new AppError("PROMO_NOT_STARTED", "Mã giảm giá chưa đến thời gian áp dụng.", 400);
  if (p.valid_to && now > new Date(p.valid_to).getTime()) throw new AppError("PROMO_EXPIRED", "Mã giảm giá đã hết hạn.", 400);
  if (p.max_uses !== null && p.used_count >= p.max_uses) throw new AppError("PROMO_USED_UP", "Mã giảm giá đã hết lượt sử dụng.", 400);
  if (p.per_user_limit !== null) {
    const used = Number((await q.query<{ n: number }>("select count(*)::int as n from app.promo_redemptions where code = $1 and user_id = $2", [code, userId])).rows[0].n);
    if (used >= p.per_user_limit) throw new AppError("PROMO_USER_LIMIT", "Bạn đã dùng hết lượt của mã giảm giá này.", 400);
  }
  return p;
}

/** Records one use. Must run in the same transaction as the order insert (after checkPromo with lock). */
export async function redeemPromo(q: Queryable, p: PromoRow, userId: string, orderId: string) {
  await q.query("update app.promo_codes set used_count = used_count + 1 where code = $1", [p.code]);
  await q.query("insert into app.promo_redemptions (code, user_id, order_id, percent_off) values ($1, $2, $3, $4)", [p.code, userId, orderId, p.percent_off]);
}

export const promoInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Mã 3–32 ký tự: chữ, số, - hoặc _"),
  percent_off: z.number().int().min(1).max(100),
  active: z.boolean().default(true),
  max_uses: z.number().int().min(1).nullable().default(null),
  per_user_limit: z.number().int().min(1).nullable().default(null),
  valid_from: z.string().datetime({ offset: true }).nullable().default(null),
  valid_to: z.string().datetime({ offset: true }).nullable().default(null),
  note: z.string().trim().max(200).default(""),
});

export async function listPromos(q: Queryable) {
  return (await q.query<PromoRow>("select * from app.promo_codes order by created_at desc")).rows;
}

export async function upsertPromo(db: Db, actorId: string, input: z.infer<typeof promoInputSchema>) {
  await db.tx(async (q) => {
    await q.query(
      `insert into app.promo_codes (code, percent_off, active, max_uses, per_user_limit, valid_from, valid_to, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (code) do update set percent_off = excluded.percent_off, active = excluded.active, max_uses = excluded.max_uses,
         per_user_limit = excluded.per_user_limit, valid_from = excluded.valid_from, valid_to = excluded.valid_to, note = excluded.note`,
      [input.code, input.percent_off, input.active, input.max_uses, input.per_user_limit, input.valid_from, input.valid_to, input.note, actorId],
    );
    await q.query("insert into app.system_events (actor_id, type, data) values ($1, 'promo_saved', $2)", [actorId, JSON.stringify(input)]);
  });
}
