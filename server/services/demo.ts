/**
 * "Phòng trải nghiệm" storage: the demo rooms themselves (owned by the app owner, never billed,
 * no slots, open "forever") and the minutes each device / network used today.
 */
import type { Db, Queryable } from "../db";
import { MAP_INFO, type MapCode } from "@/core/maps";
import { DEMO_SHOWCASE, demoDay } from "@/core/demo";
import { getRoom, insertRoom, type RoomRow } from "./rooms";
import { getSettings } from "./settings";

export const DEMO_SEATS = 3;
const DEMO_DESCRIPTION = "Phòng mẫu để trải nghiệm Sân Khấu Online trước khi đăng ký. Mỗi lượt vài phút, vào lại không giới hạn.";
const DEMO_WAITING = 6;

const DEFAULT_DEMOS: { map: MapCode; name: string }[] = [
  { map: "hall", name: "Phòng trải nghiệm 1 · Hội trường" },
  { map: "drive_in", name: "Phòng trải nghiệm 2 · Bãi đỗ xe" },
  { map: "meeting", name: "Phòng trải nghiệm 3 · Phòng họp" },
];

/** Open demo rooms, oldest first. */
export async function listDemoRooms(q: Queryable): Promise<RoomRow[]> {
  const ids = (await q.query<{ id: string }>("select id from app.rooms where is_demo and status = 'open' and slots_released_at is null order by created_at")).rows;
  const out: RoomRow[] = [];
  for (const r of ids) {
    const row = await getRoom(q as Db, r.id);
    if (row) out.push(row);
  }
  return out;
}

/** A new demo room on a map: 3 seats + a small waiting area, Hành tinh tương lai stage (furnished rooms: their own look), no end date. */
export async function createDemoRoom(db: Db, ownerId: string, map: MapCode, name: string): Promise<RoomRow> {
  return db.tx(async (q) => {
    const s = await getSettings(q);
    const room = await insertRoom(
      q,
      ownerId,
      {
        name,
        description: DEMO_DESCRIPTION,
        map,
        avatarGroups: map === "drive_in" ? ["vehicles"] : ["people", "animals"],
        officialCapacity: DEMO_SEATS,
        waitingEnabled: true,
        entryMode: "auto_assign",
        durationHours: 1,
        isPublic: false,
        password: "",
        stageStyle: MAP_INFO[map].furnished ? "plain" : "glam",
        initialScreen: DEMO_SHOWCASE[0],
      } as Parameters<typeof insertRoom>[2],
      s,
      { trial: false, waitingRatio: 0 },
    );
    await q.query(
      `update app.rooms set is_demo = true, open_ended = false, expires_at = '2099-12-31T00:00:00Z', waiting_capacity = $2, total_slots = $3, waiting_enabled = true where id = $1`,
      [room.id, DEMO_WAITING, DEMO_SEATS + DEMO_WAITING],
    );
    await q.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'demo_created', $3)", [room.id, ownerId, JSON.stringify({ map })]);
    return (await getRoom(q as Db, room.id))!;
  });
}

let ensuring: Promise<void> | null = null;
/**
 * One demo room of each default type exists as soon as there is an app owner to own them. Each
 * type is created once ever: one the admin closed on purpose stays closed (they can add more).
 * Returns the open demo rooms.
 */
export async function ensureDemoRooms(db: Db): Promise<RoomRow[]> {
  if (!ensuring) {
    ensuring = (async () => {
      const s = await getSettings(db);
      const owner = (await db.query<{ id: string }>("select id from app.users where role = 'app_owner' order by created_at limit 1")).rows[0];
      if (s.demo_minutes_per_day <= 0 || !owner) return void (ensuring = null); // try again later
      // the rule changed from "N minutes a day" to "N minutes a visit, come back any time"
      await db.query("update app.rooms set description = $1 where is_demo and description like '%mỗi ngày%'", [DEMO_DESCRIPTION]);
      for (const d of DEFAULT_DEMOS) {
        const ever = (await db.query("select 1 from app.rooms where is_demo and map_code = $1 limit 1", [d.map])).rows.length > 0;
        if (!ever) await createDemoRoom(db, owner.id, d.map, d.name);
      }
    })().catch((e) => {
      ensuring = null;
      throw e;
    });
  }
  await ensuring;
  return listDemoRooms(db);
}

/** Seconds used today by these keys ('dev:…', 'ip:…'). */
export async function demoUsage(q: Queryable, keys: string[], now = Date.now()): Promise<Record<string, number>> {
  const rows = (await q.query<{ who: string; seconds: number }>("select who, seconds from app.demo_usage where day = $1 and who = any($2)", [demoDay(now), keys])).rows;
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = 0;
  for (const r of rows) out[r.who] = Number(r.seconds);
  return out;
}

export async function addDemoUsage(q: Queryable, keys: string[], seconds: number, now = Date.now()) {
  if (seconds <= 0) return;
  for (const k of keys)
    await q.query("insert into app.demo_usage (day, who, seconds) values ($1, $2, $3) on conflict (day, who) do update set seconds = app.demo_usage.seconds + excluded.seconds", [demoDay(now), k, Math.round(seconds)]);
}

