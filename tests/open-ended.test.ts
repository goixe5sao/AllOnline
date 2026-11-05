import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate, openPglite, type Db } from "../server/db";
import { upsertUser } from "../server/services/users";
import { updateSettings } from "../server/services/settings";
import {
  closeRoom,
  confirmPayment,
  getRoom,
  listPublicRooms,
  listSettlements,
  markSettlementDone,
  requestExtension,
  requestRoom,
  setRoomVisibility,
  type RoomConfig,
} from "../server/services/rooms";
import { applyDiscount, openEndedHourlyRate, quoteOpenEnded, settleOpenEnded } from "@/core/pricing";

const TIERS = [
  { max_capacity: 10, duration_hours: 6, price_vnd: 49000 },
  { max_capacity: 10, duration_hours: 24, price_vnd: 129000 },
  { max_capacity: 20, duration_hours: 24, price_vnd: 229000 },
];

describe("open-ended pricing", () => {
  it("hourly rate = cheapest per-hour package of the fitting tier, rounded up to 100 ₫", () => {
    expect(openEndedHourlyRate(TIERS, 8, 0, 0)).toBe(5400); // 129000 / 24 = 5375
    expect(openEndedHourlyRate(TIERS, 15, 0, 0)).toBe(9600); // 229000 / 24 = 9541.7
    expect(openEndedHourlyRate(TIERS, 15, 3, 10)).toBe(10500); // + 10 % waiting surcharge
    expect(openEndedHourlyRate(TIERS, 50, 0, 0)).toBeNull();
  });

  it("deposit is what is paid now; a discount applies to the deposit and to the rate", () => {
    const q = quoteOpenEnded(TIERS, 10, 2, 0, 1_000_000);
    if (!q.ok) throw new Error();
    expect(q.quote.amount).toBe(1_000_000);
    expect(q.quote.openEnded).toEqual({ hourlyRate: 5400, deposit: 1_000_000 });
    const half = applyDiscount(q.quote, "HALF", 50);
    expect(half.amount).toBe(500_000);
    expect(half.openEnded).toEqual({ hourlyRate: 2700, deposit: 500_000 });
  });

  it("every started hour counts, at least one; balance > 0 refund, < 0 collect", () => {
    const h = 3_600_000;
    expect(settleOpenEnded(0, 10 * 60_000, 5400, 1_000_000)).toMatchObject({ billedHours: 1, charge: 5400, balance: 994_600, status: "refund_due" });
    expect(settleOpenEnded(0, 3 * h + 1, 5400, 1_000_000)).toMatchObject({ billedHours: 4, charge: 21_600 });
    expect(settleOpenEnded(0, 200 * h, 5400, 1_000_000)).toMatchObject({ charge: 1_080_000, balance: -80_000, status: "collect_due" });
    expect(settleOpenEnded(0, 5 * h, 0, 0)).toMatchObject({ balance: 0, status: "settled" });
  });
});

let db: Db;
let owner: string;
let admin: string;
const cfg = (extra: Partial<RoomConfig> = {}): RoomConfig => ({
  name: "Phòng vô hạn",
  description: "",
  map: "hall",
  avatarGroups: ["people"],
  officialCapacity: 10,
  waitingEnabled: false,
  entryMode: "auto_assign",
  durationHours: 6,
  openEnded: true,
  isPublic: false,
  password: "",
  stageStyle: "plain",
  ...extra,
});

beforeEach(async () => {
  db = await openPglite();
  await migrate(db);
  owner = randomUUID();
  admin = randomUUID();
  await upsertUser(db, owner, "owner@test.local", "Owner", false);
  await upsertUser(db, admin, "admin@test.local", "Admin", false);
  await db.query("update app.users set role = 'app_owner' where id = $1", [admin]);
}, 30_000);

async function paidOpenRoom(extra: Partial<RoomConfig> = {}) {
  const r = await requestRoom(db, owner, cfg(extra), false);
  if (r.kind !== "order") throw new Error("expected an order");
  const res = await confirmPayment(db, { orderCode: r.order.code, provider: "manual", txnId: null, amount: r.order.amount_vnd, actorId: admin });
  return { order: r.order, roomId: res.roomId! };
}

describe("open-ended rooms", () => {
  it("deposit order of 1,000,000 ₫ creates a room that does not expire on its own", async () => {
    const { order, roomId } = await paidOpenRoom();
    expect(order.amount_vnd).toBe(1_000_000);
    const room = await getRoom(db, roomId);
    expect(room?.open_ended).toBe(true);
    expect(room?.hourly_rate_vnd).toBe(order.quote.openEnded!.hourlyRate);
    expect(new Date(room!.expires_at).getFullYear()).toBeGreaterThan(new Date().getFullYear() + 50);
    await expect(requestExtension(db, owner, roomId, 6)).rejects.toMatchObject({ code: "OPEN_ENDED_NO_EXTENSION" });
  });

  it("is not available as a free trial, and the app owner can switch it off", async () => {
    await expect(requestRoom(db, owner, cfg(), true)).rejects.toMatchObject({ code: "TRIAL_OPEN_ENDED" });
    await updateSettings(db, admin, { open_ended_enabled: false });
    await expect(requestRoom(db, owner, cfg(), false)).rejects.toMatchObject({ code: "OPEN_ENDED_DISABLED" });
  });

  it("closing settles the hours used: refund when the deposit was more than enough", async () => {
    const { roomId } = await paidOpenRoom();
    await db.query("update app.rooms set starts_at = now() - interval '5 hours 30 minutes' where id = $1", [roomId]);
    expect(await closeRoom(db, roomId, "closed_by_owner", owner)).toBe(true);
    expect(await closeRoom(db, roomId, "closed_by_admin", admin)).toBe(false); // once
    const [s] = await listSettlements(db, { ownerId: owner });
    const rate = (await getRoom(db, roomId))!.hourly_rate_vnd!;
    expect(s).toMatchObject({ billed_hours: 6, charge_vnd: 6 * rate, deposit_vnd: 1_000_000, balance_vnd: 1_000_000 - 6 * rate, status: "refund_due" });
    await markSettlementDone(db, roomId, admin, "Đã chuyển khoản hoàn tiền");
    expect((await listSettlements(db, {}))[0]).toMatchObject({ status: "settled", note: "Đã chuyển khoản hoàn tiền" });
    await expect(markSettlementDone(db, roomId, admin, "")).rejects.toMatchObject({ code: "SETTLEMENT_NOT_DUE" });
  });

  it("closing after the deposit is used up records what the owner still owes", async () => {
    const { roomId } = await paidOpenRoom();
    await db.query("update app.rooms set starts_at = now() - interval '200 hours' where id = $1", [roomId]);
    await closeRoom(db, roomId, "closed_by_admin", admin);
    const [s] = await listSettlements(db, { status: "collect_due" });
    expect(s.billed_hours).toBe(201); // 200 h + the seconds of this test → every started hour counts
    expect(s.balance_vnd).toBe(1_000_000 - 201 * s.hourly_rate_vnd);
    expect(s.balance_vnd).toBeLessThan(0);
  });

  it("ASDFG (100 %) open-ended room costs nothing and is settled at once", async () => {
    const r = await requestRoom(db, owner, cfg(), false, null, "ASDFG");
    if (r.kind !== "order") throw new Error();
    expect(r.order.amount_vnd).toBe(0);
    const res = await confirmPayment(db, { orderCode: r.order.code, provider: "promo", txnId: "promo-" + r.order.id, amount: 0, actorId: owner });
    await closeRoom(db, res.roomId!, "closed_by_owner", owner);
    expect((await listSettlements(db, {}))[0]).toMatchObject({ charge_vnd: 0, balance_vnd: 0, status: "settled" });
  });
});

describe("public listing", () => {
  it("lists only open rooms the owner made public, and the owner can hide them again", async () => {
    await updateSettings(db, admin, { trial_rooms_per_account: 10 });
    const shown = await requestRoom(db, owner, cfg({ openEnded: false, isPublic: true, name: "Công khai" }), true);
    const hidden = await requestRoom(db, owner, cfg({ openEnded: false, name: "Riêng tư" }), true);
    if (shown.kind !== "room" || hidden.kind !== "room") throw new Error();
    expect((await listPublicRooms(db)).map((r) => r.name)).toEqual(["Công khai"]);
    await setRoomVisibility(db, hidden.room.id, true, owner);
    expect((await listPublicRooms(db)).length).toBe(2);
    await setRoomVisibility(db, shown.room.id, false, owner);
    await closeRoom(db, hidden.room.id, "closed_by_owner", owner);
    expect(await listPublicRooms(db)).toEqual([]);
  });
});
