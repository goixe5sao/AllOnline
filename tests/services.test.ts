import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate, openPglite, type Db } from "../server/db";
import { upsertUser } from "../server/services/users";
import { slotBudget, updateSettings } from "../server/services/settings";
import { closeRoom, confirmPayment, dueRooms, expireOrders, requestExtension, requestRoom, getRoom, type RoomConfig } from "../server/services/rooms";
import { castVote, createPoll, pollView, setPollStatus } from "../server/services/polls";

let db: Db;
let owner: string;
let admin: string;

const cfg = (official: number, extra: Partial<RoomConfig> = {}): RoomConfig => ({
  name: "Phòng test",
  description: "",
  map: "hall",
  avatarGroups: ["people"],
  officialCapacity: official,
  waitingEnabled: true,
  entryMode: "auto_assign",
  durationHours: 6,
  openEnded: false,
  isPublic: false,
  password: "",
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
  await updateSettings(db, admin, { trial_rooms_per_account: 100, trial_max_capacity: 100 });
}, 30_000);

describe("slot budget", () => {
  it("50 official + 20% waiting takes 60 of 100, leaving 40", async () => {
    const r = await requestRoom(db, owner, cfg(50), true);
    expect(r.kind === "room" && r.room.total_slots).toBe(60);
    expect(r.kind === "room" && r.room.waiting_capacity).toBe(10);
    expect((await slotBudget(db)).remaining).toBe(40);
  });

  it("concurrent creations never exceed the budget", async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => requestRoom(db, owner, cfg(10), true)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    // each room = 12 slots → at most 8 fit in 100.
    expect(ok).toBe(8);
    const b = await slotBudget(db);
    expect(b.allocated).toBe(96);
    expect(b.allocated + b.held).toBeLessThanOrEqual(b.budget);
  });

  it("budget is configurable and not hardcoded", async () => {
    await updateSettings(db, admin, { total_slot_budget: 20 });
    await expect(requestRoom(db, owner, cfg(20), true)).rejects.toMatchObject({ code: "SLOT_BUDGET_EXCEEDED" });
  });

  it("closing a room returns its slots exactly once and keeps the log", async () => {
    const r = await requestRoom(db, owner, cfg(50), true);
    const id = r.kind === "room" ? r.room.id : "";
    const [a, b] = await Promise.all([closeRoom(db, id, "closed_by_owner", owner), closeRoom(db, id, "expired", null)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await slotBudget(db)).remaining).toBe(100);
    const releases = await db.query("select * from app.room_events where room_id = $1 and type = 'slots_released'", [id]);
    expect(releases.rows).toHaveLength(1);
  });

  it("rooms expire by server time, with no client involved", async () => {
    const r = await requestRoom(db, owner, cfg(10), true);
    const id = r.kind === "room" ? r.room.id : "";
    await db.query("update app.rooms set expires_at = now() - interval '1 second' where id = $1", [id]);
    expect(await dueRooms(db)).toEqual([id]);
    await closeRoom(db, id, "expired", null);
    expect((await getRoom(db, id))!.status).toBe("expired");
    expect(await dueRooms(db)).toEqual([]);
  });
});

describe("trial rules", () => {
  it("limits free rooms per account", async () => {
    await updateSettings(db, admin, { trial_rooms_per_account: 1 });
    await requestRoom(db, owner, cfg(5), true);
    await expect(requestRoom(db, owner, cfg(5), true)).rejects.toMatchObject({ code: "TRIAL_NOT_ELIGIBLE" });
  });
});

describe("paid orders", () => {
  it("holds slots during payment, and releases them once when the hold expires", async () => {
    const r = await requestRoom(db, owner, cfg(50), false);
    expect(r.kind).toBe("order");
    expect((await slotBudget(db)).held).toBe(60);
    await expect(requestRoom(db, owner, cfg(40), false)).rejects.toMatchObject({ code: "SLOT_BUDGET_EXCEEDED" });
    await db.query("update app.orders set hold_expires_at = now() - interval '1 second'");
    expect((await slotBudget(db)).held).toBe(0);
    expect(await expireOrders(db)).toHaveLength(1);
    expect(await expireOrders(db)).toHaveLength(0);
  });

  it("creates the room only after confirmation; duplicate webhooks are idempotent", async () => {
    const r = await requestRoom(db, owner, cfg(10, { password: "bí mật" }), false);
    if (r.kind !== "order") throw new Error();
    expect((await db.query("select * from app.rooms")).rows).toHaveLength(0);
    const first = await confirmPayment(db, { orderCode: r.order.code, provider: "webhook", txnId: "T1", amount: r.order.amount_vnd, actorId: null });
    expect(first.outcome).toBe("fulfilled");
    const again = await confirmPayment(db, { orderCode: r.order.code, provider: "webhook", txnId: "T1", amount: r.order.amount_vnd, actorId: null });
    expect(again.outcome).toBe("duplicate");
    expect((await db.query("select * from app.rooms")).rows).toHaveLength(1);
    const room = (await db.query<{ password_hash: string }>("select password_hash from app.rooms")).rows[0];
    expect(room.password_hash).toMatch(/^scrypt\$/);
    expect((await slotBudget(db)).allocated).toBe(12);
    expect((await slotBudget(db)).held).toBe(0);
  });

  it("underpayment does not create a room", async () => {
    const r = await requestRoom(db, owner, cfg(10), false);
    if (r.kind !== "order") throw new Error();
    const res = await confirmPayment(db, { orderCode: r.order.code, provider: "webhook", txnId: "T2", amount: 1000, actorId: null });
    expect(res.outcome).toBe("underpaid");
    expect((await db.query("select * from app.rooms")).rows).toHaveLength(0);
  });

  it("late payment is fulfilled only if slots are still free, otherwise flagged for review", async () => {
    const r = await requestRoom(db, owner, cfg(50), false);
    if (r.kind !== "order") throw new Error();
    await db.query("update app.orders set hold_expires_at = now() - interval '1 second'");
    await expireOrders(db);
    await requestRoom(db, owner, cfg(50), true); // someone else takes 60 slots
    const res = await confirmPayment(db, { orderCode: r.order.code, provider: "webhook", txnId: "T3", amount: r.order.amount_vnd, actorId: null });
    expect(res.outcome).toBe("needs_review");
    const b = await slotBudget(db);
    expect(b.allocated).toBe(60);
  });

  it("unknown order codes are recorded but do nothing", async () => {
    const res = await confirmPayment(db, { orderCode: "AOXXXXXX", provider: "webhook", txnId: "T4", amount: 5, actorId: null });
    expect(res.outcome).toBe("unknown_order");
  });

  it("extension keeps capacity, takes no new slots and moves the expiry", async () => {
    const r = await requestRoom(db, owner, cfg(10), true);
    if (r.kind !== "room") throw new Error();
    const order = await requestExtension(db, owner, r.room.id, 12);
    expect(order.slots).toBe(0);
    const res = await confirmPayment(db, { orderCode: order.code, provider: "manual", txnId: null, amount: order.amount_vnd, actorId: admin });
    expect(res.outcome).toBe("fulfilled");
    const after = await getRoom(db, r.room.id);
    expect(new Date(after!.expires_at).getTime() - new Date(r.room.expires_at).getTime()).toBeGreaterThan(11.9 * 3600_000);
    expect(after!.total_slots).toBe(12);
  });

  it("only the room owner can request an extension", async () => {
    const r = await requestRoom(db, owner, cfg(10), true);
    if (r.kind !== "room") throw new Error();
    await expect(requestExtension(db, admin, r.room.id, 6)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("polls", () => {
  it("one vote per account, changeable until closed, rejected afterwards", async () => {
    const r = await requestRoom(db, owner, cfg(10), true);
    if (r.kind !== "room") throw new Error();
    const voter = randomUUID();
    await upsertUser(db, voter, null, "Voter", true);
    const id = await createPoll(db, r.room.id, owner, { question: "Q?", options: ["A", "B"] });
    await expect(castVote(db, r.room.id, id, voter, "o1")).rejects.toMatchObject({ code: "POLL_NOT_OPEN" });
    await setPollStatus(db, r.room.id, id, owner, "open");
    await castVote(db, r.room.id, id, voter, "o1");
    await castVote(db, r.room.id, id, voter, "o2");
    let v = await pollView(db, id);
    expect(v!.totalVoters).toBe(1);
    expect(v!.options[1]).toMatchObject({ votes: 1, pct: 100 });
    await setPollStatus(db, r.room.id, id, owner, "closed");
    await expect(castVote(db, r.room.id, id, voter, "o1")).rejects.toMatchObject({ code: "POLL_NOT_OPEN" });
    v = await pollView(db, id);
    expect(v!.options[1].votes).toBe(1);
  });
});

describe("promo codes", () => {
  it("ASDFG gives 100% off: the order is 0 ₫ and is fulfilled without payment", async () => {
    const r = await requestRoom(db, owner, cfg(10), false, null, "asdfg");
    if (r.kind !== "order") throw new Error();
    expect(r.order.amount_vnd).toBe(0);
    expect(r.order.quote.promo).toMatchObject({ code: "ASDFG", percentOff: 100 });
    const res = await confirmPayment(db, { orderCode: r.order.code, provider: "promo", txnId: "promo-" + r.order.id, amount: 0, actorId: owner });
    expect(res.outcome).toBe("fulfilled");
    expect((await slotBudget(db)).allocated).toBe(12);
    const used = await db.query<{ used_count: number }>("select used_count from app.promo_codes where code = 'ASDFG'");
    expect(used.rows[0].used_count).toBe(1);
  });

  it("partial discount, invalid code and usage limits are enforced on the server", async () => {
    await db.query("insert into app.promo_codes (code, percent_off, max_uses, per_user_limit) values ('HALF', 50, 2, 1)");
    const full = await requestRoom(db, owner, cfg(10), false);
    const half = await requestRoom(db, owner, cfg(10), false, null, "HALF");
    if (full.kind !== "order" || half.kind !== "order") throw new Error();
    expect(half.order.amount_vnd).toBe(Math.round(full.order.amount_vnd / 2));
    await expect(requestRoom(db, owner, cfg(10), false, null, "HALF")).rejects.toMatchObject({ code: "PROMO_USER_LIMIT" });
    await expect(requestRoom(db, owner, cfg(10), false, null, "NOPE")).rejects.toMatchObject({ code: "PROMO_INVALID" });
    await requestRoom(db, admin, cfg(10), false, null, "HALF");
    const third = randomUUID();
    await upsertUser(db, third, "third@test.local", "Third", false);
    await expect(requestRoom(db, third, cfg(5), false, null, "HALF")).rejects.toMatchObject({ code: "PROMO_USED_UP" });
  });

  it("a failed order does not consume the code (same transaction)", async () => {
    await db.query("insert into app.promo_codes (code, percent_off, max_uses) values ('ONCE', 100, 1)");
    await expect(requestRoom(db, owner, cfg(200), false, null, "ONCE")).rejects.toBeTruthy();
    const r = await requestRoom(db, owner, cfg(5), false, null, "ONCE");
    expect(r.kind === "order" && r.order.amount_vnd).toBe(0);
  });
});
