import { z } from "zod";
import type { Db, Queryable } from "../db";
import { summarizeBudget, type SlotBudget } from "@/core/slots";
import type { PriceTier } from "@/core/pricing";

export interface Settings {
  total_slot_budget: number;
  max_room_capacity: number;
  waiting_ratio: number;
  find_seat_seconds: number;
  invite_claim_seconds: number;
  requeue_cooldown_seconds: number;
  reconnect_grace_seconds: number;
  chat_radius: number;
  chat_max_length: number;
  warning_minutes: number[];
  payment_hold_minutes: number;
  duration_options: number[];
  waiting_surcharge_pct: number;
  trial_enabled: boolean;
  trial_starts_at: Date | null;
  trial_ends_at: Date | null;
  trial_rooms_per_account: number;
  trial_max_hours: number;
  trial_max_capacity: number;
  extension_enabled: boolean;
  qr_bank_bin: string;
  qr_account_no: string;
  qr_account_name: string;
  upload_max_mb: number;
  upload_retention_days: number;
  enabled_maps: string[];
  enabled_avatar_groups: string[];
  guest_join_enabled: boolean;
  stage_ad_enabled: boolean;
  stage_ad_text: string;
  stage_ad_url: string;
  device_limit_room_creator: boolean;
  ip_max_participants: number;
  updated_at: Date;
}

const SELECT_SETTINGS = `select total_slot_budget, max_room_capacity, waiting_ratio::float8 as waiting_ratio,
  find_seat_seconds, invite_claim_seconds, requeue_cooldown_seconds, reconnect_grace_seconds,
  chat_radius::float8 as chat_radius, chat_max_length, warning_minutes, payment_hold_minutes, duration_options,
  waiting_surcharge_pct::float8 as waiting_surcharge_pct, trial_enabled, trial_starts_at, trial_ends_at,
  trial_rooms_per_account, trial_max_hours, trial_max_capacity, extension_enabled, qr_bank_bin, qr_account_no,
  qr_account_name, upload_max_mb, upload_retention_days, enabled_maps, enabled_avatar_groups, guest_join_enabled, stage_ad_enabled, stage_ad_text, stage_ad_url, device_limit_room_creator, ip_max_participants, updated_at
  from app.settings where id = 1`;

export async function getSettings(q: Queryable): Promise<Settings> {
  return (await q.query<Settings>(SELECT_SETTINGS)).rows[0];
}

/** Serialises every slot-changing transaction (row lock on the single settings row). */
export async function lockSlots(q: Queryable) {
  await q.query("select 1 from app.settings where id = 1 for update");
}

export async function slotBudget(q: Queryable): Promise<SlotBudget> {
  const r = (
    await q.query<{ budget: number; allocated: number; held: number }>(
      `select (select total_slot_budget from app.settings where id = 1) as budget,
        (select coalesce(sum(total_slots), 0)::int from app.rooms where slots_released_at is null) as allocated,
        (select coalesce(sum(slots), 0)::int from app.orders where kind = 'create_room' and status = 'pending' and hold_expires_at > now()) as held`,
    )
  ).rows[0];
  return summarizeBudget(Number(r.budget), Number(r.allocated), Number(r.held));
}

export async function getPriceTiers(q: Queryable): Promise<PriceTier[]> {
  const rows = (await q.query<PriceTier & { id: string }>("select id, max_capacity, duration_hours, price_vnd::float8 as price_vnd from app.price_tiers order by duration_hours, max_capacity")).rows;
  return rows.map((r) => ({ ...r, price_vnd: Number(r.price_vnd) }));
}

const intList = z.array(z.number().int().positive()).min(1).max(10);

export const settingsPatchSchema = z
  .object({
    total_slot_budget: z.number().int().min(0).max(100000),
    max_room_capacity: z.number().int().min(1).max(100000),
    waiting_ratio: z.number().min(0).max(1),
    find_seat_seconds: z.number().int().min(30).max(3600),
    invite_claim_seconds: z.number().int().min(10).max(600),
    requeue_cooldown_seconds: z.number().int().min(0).max(600),
    reconnect_grace_seconds: z.number().int().min(5).max(1800),
    chat_radius: z.number().min(1).max(200),
    chat_max_length: z.number().int().min(1).max(1000),
    warning_minutes: intList,
    payment_hold_minutes: z.number().int().min(1).max(1440),
    duration_options: intList,
    waiting_surcharge_pct: z.number().min(0).max(1000),
    trial_enabled: z.boolean(),
    trial_starts_at: z.string().datetime({ offset: true }).nullable(),
    trial_ends_at: z.string().datetime({ offset: true }).nullable(),
    trial_rooms_per_account: z.number().int().min(0).max(1000),
    trial_max_hours: z.number().int().min(1).max(720),
    trial_max_capacity: z.number().int().min(1).max(100000),
    extension_enabled: z.boolean(),
    qr_bank_bin: z.string().trim().max(10).regex(/^\d*$/),
    qr_account_no: z.string().trim().max(30).regex(/^[0-9A-Za-z]*$/),
    qr_account_name: z.string().trim().max(80),
    upload_max_mb: z.number().int().min(1).max(50),
    upload_retention_days: z.number().int().min(1).max(3650),
    enabled_maps: z.array(z.enum(["hall", "carpet", "tables", "drive_in"])).min(1),
    enabled_avatar_groups: z.array(z.enum(["people", "animals", "vehicles"])).min(1),
    guest_join_enabled: z.boolean(),
    stage_ad_enabled: z.boolean(),
    device_limit_room_creator: z.boolean(),
    ip_max_participants: z.number().int().min(0).max(10000),
    stage_ad_text: z.string().trim().min(1).max(120),
    stage_ad_url: z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Liên kết phải bắt đầu bằng https://"),
  })
  .partial()
  .strict();

export async function updateSettings(db: Db, actorId: string, patch: z.infer<typeof settingsPatchSchema>) {
  const entries = Object.entries(patch);
  if (!entries.length) return getSettings(db);
  return db.tx(async (q) => {
    await lockSlots(q);
    const before = await getSettings(q);
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
    await q.query(`update app.settings set ${sets}, updated_at = now(), updated_by = $1 where id = 1`, [actorId, ...entries.map(([, v]) => v)]);
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of entries) changed[k] = { from: (before as unknown as Record<string, unknown>)[k], to: v };
    await q.query("insert into app.system_events (actor_id, type, data) values ($1, 'settings_updated', $2)", [actorId, JSON.stringify(changed)]);
    return getSettings(q);
  });
}

export const priceTiersSchema = z
  .array(z.object({ max_capacity: z.number().int().min(1), duration_hours: z.number().int().min(1), price_vnd: z.number().int().min(0) }))
  .min(1)
  .max(200);

/** Replaces the price table. Existing orders keep the quote stored at order time. */
export async function replacePriceTiers(db: Db, actorId: string, tiers: z.infer<typeof priceTiersSchema>) {
  await db.tx(async (q) => {
    await q.query("delete from app.price_tiers");
    for (const t of tiers)
      await q.query("insert into app.price_tiers (max_capacity, duration_hours, price_vnd) values ($1, $2, $3) on conflict (max_capacity, duration_hours) do update set price_vnd = excluded.price_vnd", [
        t.max_capacity,
        t.duration_hours,
        t.price_vnd,
      ]);
    await q.query("insert into app.system_events (actor_id, type, data) values ($1, 'price_tiers_replaced', $2)", [actorId, JSON.stringify(tiers)]);
  });
}
