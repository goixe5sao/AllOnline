import { beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { migrate, openPglite, type Db } from "../server/db";
import { upsertUser } from "../server/services/users";
import { updateSettings } from "../server/services/settings";
import { requestRoom, type RoomConfig } from "../server/services/rooms";
import { Auth } from "../server/auth";
import type { Config } from "../server/config";
import type { Storage } from "../server/storage";
import { ZaloBot, parseCommand, plain } from "../server/zalo/bot";
import { CaptureSender, verifyZaloSignature } from "../server/zalo/oa";
import { decideReceipt, findOrderCode, type Receipt } from "../server/payments/receipt";
import { parseVnTime, recordBankTransfer } from "../server/payments/bank";
import { userByIdentity } from "../server/services/identities";

describe("bot commands", () => {
  it("work with or without accents", () => {
    expect(plain("  Đăng   KÝ ")).toBe("dang ky");
    expect(parseCommand("Đăng ký")).toEqual({ kind: "login" });
    expect(parseCommand("dang nhap")).toEqual({ kind: "login" });
    expect(parseCommand("LK 123456")).toEqual({ kind: "link", code: "123456" });
    expect(parseCommand("DN 482913")).toEqual({ kind: "weblogin", code: "482913" });
    expect(parseCommand("đăng nhập 482913")).toEqual({ kind: "weblogin", code: "482913" });
    expect(parseCommand(" 482913 ")).toEqual({ kind: "weblogin", code: "482913" });
    expect(parseCommand("dn482913")).toEqual({ kind: "weblogin", code: "482913" });
    expect(parseCommand("DN 4829")).toEqual({ kind: "login" });
    expect(parseCommand("liên kết 654321")).toEqual({ kind: "link", code: "654321" });
    expect(parseCommand("Nhắc ab12cd34")).toEqual({ kind: "remind", invite: "AB12CD34", on: true });
    expect(parseCommand("hủy nhắc AB12CD34")).toEqual({ kind: "remind", invite: "AB12CD34", on: false });
    expect(parseCommand("Lịch")).toEqual({ kind: "events" });
    expect(parseCommand("đơn")).toEqual({ kind: "orders" });
    expect(parseCommand("xin chào")).toEqual({ kind: "help" });
  });
});

describe("receipts", () => {
  const ok: Receipt = {
    is_bank_transfer_receipt: true,
    success: true,
    amount_vnd: 99000,
    transfer_content: "MBVCB.123 ao k3pq9x chuyen tien",
    recipient_account: "0123456789",
    recipient_name: "CONG TY",
    bank: "Vietcombank",
    transferred_at: "05/11/2026 20:01",
    reference: "FT123",
    confidence: "high",
  };
  const pending = [
    { code: "AOK3PQ9X", amount_vnd: 99000 },
    { code: "AOZZZZ22", amount_vnd: 50000 },
  ];
  const opts = { accountNo: "0123456789", autoMax: 200000, recentAutoApprovals: 0 };

  it("finds the order code even when banks squash spaces / add prefixes", () => {
    expect(findOrderCode("MBVCB.123 ao k3pq9x chuyen tien")).toBe("AOK3PQ9X");
    expect(findOrderCode("IBFT AOK3PQ9X")).toBe("AOK3PQ9X");
    expect(findOrderCode("no code here")).toBeNull();
  });

  it("auto-approves only when every check passes", () => {
    expect(decideReceipt(ok, pending, opts)).toEqual({ kind: "auto_ok", orderCode: "AOK3PQ9X" });
    expect(decideReceipt(ok, pending, { ...opts, autoMax: 0 })).toMatchObject({ kind: "review", reason: expect.stringContaining("vượt mức") });
    expect(decideReceipt({ ...ok, confidence: "medium" }, pending, opts)).toMatchObject({ kind: "review" });
    expect(decideReceipt({ ...ok, recipient_account: "999999" }, pending, opts)).toMatchObject({ kind: "review", reason: expect.stringContaining("tài khoản") });
    expect(decideReceipt({ ...ok, amount_vnd: 90000 }, pending, opts)).toMatchObject({ kind: "review", reason: expect.stringContaining("số tiền") });
    expect(decideReceipt(ok, pending, { ...opts, recentAutoApprovals: 2 })).toMatchObject({ kind: "review" });
    expect(decideReceipt({ ...ok, success: false }, pending, opts)).toMatchObject({ kind: "not_receipt" });
    expect(decideReceipt({ ...ok, is_bank_transfer_receipt: false }, pending, opts)).toMatchObject({ kind: "not_receipt" });
    // no code: a unique amount still points to one order (but needs review)
    expect(decideReceipt({ ...ok, transfer_content: "chuyen tien" }, pending, opts)).toMatchObject({ kind: "review", orderCode: "AOK3PQ9X" });
    expect(decideReceipt({ ...ok, transfer_content: "chuyen tien", amount_vnd: 12345 }, pending, opts)).toMatchObject({ kind: "no_order" });
  });

  it("Zalo webhook signature and SePay time", () => {
    const raw = JSON.stringify({ event_name: "user_send_text", timestamp: "1730800000000" });
    const mac = createHash("sha256").update("APP" + raw + "1730800000000" + "SECRET").digest("hex");
    expect(verifyZaloSignature(raw, `mac=${mac}`, "APP", "SECRET")).toBe(true);
    expect(verifyZaloSignature(raw, `mac=${mac}`, "APP", "OTHER")).toBe(false);
    expect(verifyZaloSignature(raw, undefined, "APP", "SECRET")).toBe(false);
    expect(parseVnTime("2026-11-05 20:01:00")?.toISOString()).toBe("2026-11-05T13:01:00.000Z");
  });
});

let db: Db;
let owner: string;
let bot: ZaloBot;
let cap: CaptureSender;
const cfgRoom: RoomConfig = { name: "Đêm nhạc", description: "", map: "hall", avatarGroups: ["people"], officialCapacity: 10, waitingEnabled: false, entryMode: "auto_assign", durationHours: 6, openEnded: false, isPublic: true, password: "", stageStyle: "plain" };

beforeEach(async () => {
  db = await openPglite();
  await migrate(db);
  owner = randomUUID();
  await upsertUser(db, owner, "owner@test.local", "Chủ phòng", false);
  await updateSettings(db, owner, { qr_account_no: "0123456789", qr_account_name: "ALLONLINE", qr_bank_bin: "970436" });
  const cfg = { mode: "demo", appSecret: "x".repeat(64), secureCookies: false, port: 3000 } as unknown as Config;
  const files = new Map<string, Buffer>();
  const storage: Storage = { put: async (k, d) => void files.set(k, d), get: async (k) => files.get(k) ?? null, remove: async (k) => void files.delete(k) };
  cap = new CaptureSender();
  bot = new ZaloBot({ cfg, db, auth: new Auth(cfg, db), storage, sender: cap, origin: () => "https://sankhau.pro.vn" });
}, 30_000);

const last = () => cap.sent[cap.sent.length - 1]?.text ?? "";

describe("Zalo bot", () => {
  it("ĐĂNG KÝ creates an account and a one-time login link", async () => {
    await bot.onText("oa-1", "Đăng ký");
    expect(last()).toContain("Đã tạo tài khoản");
    const t = new URL(last().match(/https:\S+/)![0]).searchParams.get("t");
    const uid = bot.useLoginToken(t);
    expect(uid).toBeTruthy();
    expect(bot.useLoginToken(t)).toBeNull(); // one-time
    expect((await userByIdentity(db, "zalo_oa", "oa-1"))?.id).toBe(uid);
    await bot.onText("oa-1", "dang nhap");
    expect(last()).toMatch(/^Chào /);
  });

  it("LK <code> links a web account; reminders reach it before and at the start", async () => {
    const code = bot.linkCodeFor(owner);
    await bot.onText("oa-owner", `LK ${code}`);
    expect(last()).toContain("Đã liên kết");
    const r = await requestRoom(db, owner, { ...cfgRoom, scheduledAt: Date.now() + 30 * 60_000 }, true);
    if (r.kind !== "room") throw new Error("expected trial room");
    await bot.onText("oa-owner", `nhắc ${r.room.invite_code}`);
    expect(last()).toContain("Sẽ nhắc bạn");
    await bot.tick();
    expect(last()).toContain("“Đêm nhạc” bắt đầu");
    const n = cap.sent.length;
    await bot.tick();
    expect(cap.sent.length).toBe(n); // never twice
    await db.query("update app.rooms set scheduled_at = now() - interval '1 minute' where id = $1", [r.room.id]);
    await bot.tick();
    expect(last()).toContain("đang bắt đầu");
    await bot.onText("oa-owner", "lịch");
    expect(last()).toContain("Đêm nhạc");
  });

  it("payment: SePay transfer with the order code opens the room and the bot tells the payer", async () => {
    await bot.onText("oa-owner", `LK ${bot.linkCodeFor(owner)}`);
    const r = await requestRoom(db, owner, cfgRoom, false);
    if (r.kind !== "order") throw new Error("expected order");
    await bot.onText("oa-owner", "ĐƠN");
    expect(last()).toContain(r.order.code);
    const res = await recordBankTransfer(db, "sepay", { id: 9001, transferType: "in", transferAmount: r.order.amount_vnd, content: `ND ${r.order.code} thanh toan`, transactionDate: "2026-11-05 20:01:00" });
    expect(res.outcome).toBe("fulfilled");
    expect((await recordBankTransfer(db, "sepay", { id: 9001, transferType: "in", transferAmount: r.order.amount_vnd, content: r.order.code })).outcome).toBe("duplicate_tx");
    expect((await recordBankTransfer(db, "sepay", { id: 9002, transferType: "in", transferAmount: 5000, content: "khong ma" })).outcome).toBe("no_code");
    await bot.notifyPaid(res.orderId!);
    expect(last()).toContain("đã mở");
    expect(last()).toContain("https://sankhau.pro.vn/join/");
  });

  it("payment screenshot without an API key goes to review, never opens a room by itself", async () => {
    await bot.onText("oa-owner", `LK ${bot.linkCodeFor(owner)}`);
    const r = await requestRoom(db, owner, cfgRoom, false);
    if (r.kind !== "order") throw new Error("expected order");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");
    cap.images.set("https://zalo.cdn/receipt.png", png);
    await bot.onImage("oa-owner", "https://zalo.cdn/receipt.png");
    expect(last()).toContain("Quản trị viên sẽ đối chiếu");
    const p = (await db.query<{ status: string; order_id: string }>("select status, order_id from app.payment_proofs")).rows[0];
    expect(p).toEqual({ status: "pending_review", order_id: r.order.id });
    expect((await db.query<{ status: string }>("select status from app.orders where id = $1", [r.order.id])).rows[0].status).toBe("pending");
  });

  it("unknown followers are asked to sign up first", async () => {
    await bot.onImage("oa-unknown", "https://zalo.cdn/x.png");
    expect(last()).toContain("ĐĂNG KÝ");
  });
});
