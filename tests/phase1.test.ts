import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { migrate, openPglite, type Db } from "../server/db";
import { createGuest, upsertUser } from "../server/services/users";
import { confirmPayment, requestRoom, transferOwnership, getRoom, type RoomConfig } from "../server/services/rooms";
import { addModerator, askQuestion, listModerators, listQuestions, myQuestionVotes, removeModerator, setQuestionStatus, toggleVote } from "../server/services/qa";
import { reportCsv, roomReport } from "../server/services/report";
import { eventIcs, googleCalendarUrl } from "../server/services/calendar";

let db: Db;
let owner: string;
let alice: string;
let bob: string;
let roomId: string;

const cfg: RoomConfig = {
  name: "Hội thảo AI",
  description: "Buổi chia sẻ",
  map: "hall",
  avatarGroups: ["people"],
  officialCapacity: 10,
  waitingEnabled: false,
  entryMode: "auto_assign",
  durationHours: 6,
  openEnded: false,
  isPublic: true,
  password: "",
  stageStyle: "plain",
};

beforeEach(async () => {
  db = await openPglite();
  await migrate(db);
  owner = randomUUID();
  alice = randomUUID();
  bob = randomUUID();
  await upsertUser(db, owner, "owner@test.local", "Chủ phòng", false);
  await upsertUser(db, alice, "alice@test.local", "Alice", false);
  await upsertUser(db, bob, "bob@test.local", "Bob", false);
  const r = await requestRoom(db, owner, cfg, false);
  if (r.kind !== "order") throw new Error("expected order");
  roomId = (await confirmPayment(db, { orderCode: r.order.code, provider: "manual", txnId: null, amount: r.order.amount_vnd, actorId: owner })).roomId!;
}, 30_000);

describe("Q&A", () => {
  it("ask, upvote once per account (toggle), not own question, answer and hide", async () => {
    const q = await askQuestion(db, roomId, alice, "Alice", "AI có thay thế con người không?");
    expect(q).toMatchObject({ votes: 0, status: "open", author: "Alice" });
    await expect(toggleVote(db, roomId, q.id, alice)).rejects.toMatchObject({ code: "QA_OWN" });
    expect((await toggleVote(db, roomId, q.id, bob)).q.votes).toBe(1);
    expect(await myQuestionVotes(db, roomId, bob)).toEqual([q.id]);
    const off = await toggleVote(db, roomId, q.id, bob);
    expect(off).toMatchObject({ on: false, q: { votes: 0 } });
    await toggleVote(db, roomId, q.id, owner);
    expect((await setQuestionStatus(db, roomId, q.id, "answered")).status).toBe("answered");
    const hidden = await setQuestionStatus(db, roomId, q.id, "hidden");
    await expect(toggleVote(db, roomId, hidden.id, bob)).rejects.toMatchObject({ code: "QA_NOT_FOUND" });
    expect((await listQuestions(db, roomId))[0].votes).toBe(1);
  });

  it("at most 3 waiting questions per person", async () => {
    for (let i = 0; i < 3; i++) await askQuestion(db, roomId, alice, "Alice", "Câu " + i);
    await expect(askQuestion(db, roomId, alice, "Alice", "Câu 4")).rejects.toMatchObject({ code: "QA_LIMIT" });
  });
});

describe("co-hosts and ownership", () => {
  it("co-hosts must be registered accounts; by id or email; max one row each", async () => {
    const guest = randomUUID();
    await createGuest(db, guest, "Khách");
    await expect(addModerator(db, roomId, owner, { userId: guest })).rejects.toMatchObject({ code: "GUEST_NOT_ALLOWED" });
    await expect(addModerator(db, roomId, owner, { email: "nobody@test.local" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(addModerator(db, roomId, owner, { userId: owner })).rejects.toMatchObject({ code: "ALREADY_OWNER" });
    await addModerator(db, roomId, owner, { email: "ALICE@test.local" });
    await addModerator(db, roomId, owner, { userId: alice });
    expect((await listModerators(db, roomId)).map((m) => m.name)).toEqual(["Alice"]);
    await removeModerator(db, roomId, owner, alice);
    expect(await listModerators(db, roomId)).toEqual([]);
  });

  it("transfer moves the owner and keeps a history row", async () => {
    await transferOwnership(db, roomId, bob, owner);
    expect((await getRoom(db, roomId))?.owner_id).toBe(bob);
    const h = await db.query("select owner_id from app.room_owner_history where room_id = $1", [roomId]);
    expect(h.rows.map((r) => (r as { owner_id: string }).owner_id)).toContain(bob);
  });
});

describe("report", () => {
  it("peak, totals, polls and questions; CSV opens in Excel (BOM, quoted cells)", async () => {
    const t = Date.UTC(2026, 10, 5, 13, 0);
    for (const [i, n] of [3, 9, 5].entries())
      await db.query("insert into app.room_stats (room_id, at, connections, seated, waiting, reactions, chats) values ($1, $2, $3, $3, 0, 4, 2)", [roomId, new Date(t + i * 60_000), n]);
    const q = await askQuestion(db, roomId, alice, "Alice", 'Câu hỏi có "ngoặc", dấu phẩy');
    await toggleVote(db, roomId, q.id, bob);
    await setQuestionStatus(db, roomId, q.id, "answered");
    const r = await roomReport(db, roomId);
    expect(r.peak).toEqual({ connections: 9, at: t + 60_000 });
    expect(r.totals).toMatchObject({ reactions: 12, chats: 6, questions: 1, answered: 1 });
    expect(r.series).toHaveLength(3);
    const csv = reportCsv(r);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Câu hỏi có ""ngoặc"", dấu phẩy",Alice,1,đã trả lời');
  });
});

describe("calendar", () => {
  it(".ics has the event in UTC, a 30-minute alarm and escaped text", () => {
    const ics = eventIcs({ uid: "r1", title: "Hội thảo; AI, 2026", description: "Dòng 1\nDòng 2", startsAt: Date.UTC(2026, 10, 12, 13, 0), url: "https://sankhau.pro.vn/join/ABC123" });
    expect(ics).toContain("DTSTART:20261112T130000Z");
    expect(ics).toContain("DTEND:20261112T150000Z");
    expect(ics).toContain("SUMMARY:Hội thảo\\; AI\\, 2026");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
    expect(googleCalendarUrl({ title: "A", description: "", startsAt: Date.UTC(2026, 10, 12, 13, 0), url: "https://x" })).toContain("dates=20261112T130000Z%2F20261112T150000Z");
  });
});
