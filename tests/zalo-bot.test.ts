import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { migrate, openPglite, type Db } from "../server/db";
import type { Config } from "../server/config";
import { Auth } from "../server/auth";
import { createApi } from "../server/routes";
import { discoverBotAccount } from "../server/zalo/startup";
import { userByIdentity } from "../server/services/identities";
import { ZaloBot } from "../server/zalo/bot";
import { BOT_API, BotTransport, CaptureSender, botInfo, verifyBotSecret } from "../server/zalo/transport";

const cfg = { mode: "demo", appSecret: "test-secret", secureCookies: false, port: 0,
  zaloBotToken: "fake-token", zaloBotWebhookSecret: "test-webhook-secret" } as Config;
let db: Db;
let server: Server;
let base: string;
let bot: ZaloBot;
let auth: Auth;
const cap = new CaptureSender();

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  auth = new Auth(cfg, db);
  const storage = { put: async () => {}, get: async () => null, remove: async () => {} };
  bot = new ZaloBot({ cfg, db, auth, storage, sender: cap, origin: () => base });
  // These routes do not use room/realtime services; omit those dependencies in this harness.
  const api = createApi({ cfg, db, auth, storage, bot } as unknown as Parameters<typeof createApi>[0]);
  server = createServer((req, res) => void api(req, res, new URL(req.url!, base)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  if (db) await db.close();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const event = (id: string, text: string) => ({ event_name: "message.text.received", message: {
  from: { id, display_name: "Demo person", is_bot: false }, chat: { id, chat_type: "PRIVATE" }, text,
} });

describe("Bot Platform webhook and demo login", () => {
  it("records provider inbound time and private chat without reopening the window on replay", async () => {
    const date=Date.now()-60000;
    const incoming=(at?:number)=>({...event('alert-contact','help'),message:{...event('alert-contact','help').message,date:at,chat:{id:'different-private-chat',chat_type:'PRIVATE'}}});
    await bot.handle(incoming(date));
    await bot.handle(incoming(date-60000));
    await bot.handle(incoming(Date.now()+60000));
    await bot.handle(incoming());
    const row=(await db.query<{chat_id:string;last_inbound_at:Date}>("select chat_id,last_inbound_at from app.stock_zalo_contacts where provider_uid='alert-contact'")).rows[0];
    expect(row.chat_id).toBe('different-private-chat');
    expect(new Date(row.last_inbound_at).getTime()).toBe(date);
  });
  it.each([undefined, "bad", "\u00e9", "x".repeat(500)])("rejects missing/bad secret before processing (%s)", async secret => {
    const res = await post("/api/zalo/bot-webhook", {}, secret ? { "X-Bot-Api-Secret-Token": secret } : {});
    expect(res.status).toBe(401);
  });

  it("accepts authenticated provider requests without an Origin header; DN signs in once", async () => {
    const made = await post("/api/auth/zalo/code", {}, { origin: base });
    expect(made.status).toBe(200);
    const { code, claim, botUrl } = await made.json();
    expect(botUrl).toBe("https://zalo.me/demo-bot");
    const poll = (c: string) => post("/api/auth/zalo/code/check", { code, claim: c }, { origin: base });
    expect((await (await poll(claim)).json()).status).toBe("pending");
    expect((await post("/api/zalo/bot-webhook", event("test-person", `DN ${code}`), {
      "X-Bot-Api-Secret-Token": cfg.zaloBotWebhookSecret!,
    })).status).toBe(200);
    expect((await (await poll("wrong-claim")).json()).status).toBe("expired");
    await vi.waitFor(() => expect(cap.sent.at(-1)?.to).toBe("test-person"));
    const signedIn = await poll(claim);
    expect((await signedIn.json()).status).toBe("ok");
    expect(signedIn.headers.get("set-cookie")).toContain("ao_acc=");
    expect((await (await poll(claim)).json()).status).toBe("expired");
    expect(cap.sent.at(-1)?.to).toBe("test-person");
  });

  it("demo simulator still supports signup and DN with the same account", async () => {
    const simulate = (text: string) => post("/api/zalo/simulate", { oaUserId: "demo-person", text }, { origin: base });
    const signup = await (await simulate("dang ky")).json();
    const token = new URL(signup.replies[0].match(/https?:\S+/)[0]).searchParams.get("t");
    const uid = bot.useLoginToken(token);
    expect(uid).toBeTruthy();
    const { code, claim } = bot.createWebLogin();
    const res = await simulate(`DN ${code}`);
    expect(res.status).toBe(200);
    expect((await res.json()).replies[0]).toContain("Đã đăng nhập");
    expect(bot.checkWebLogin(code, claim)).toEqual({ status: "ok", userId: uid });
  });

  it("ignores group chats, bots and unsupported events; expires codes", async () => {
    const { code, claim, expiresAt } = bot.createWebLogin();
    const e = event("group-person", `DN ${code}`);
    e.message.chat = { id: "group", chat_type: "GROUP" };
    await bot.handle(e);
    await bot.handle({ ...event("test-bot", `DN ${code}`), message: { ...event("test-bot", "").message, from: { id: "test-bot", is_bot: true } } });
    await bot.handle({ event_name: "message.unsupported.received" });
    expect(bot.checkWebLogin(code, claim)).toEqual({ status: "pending" });
    const now = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1);
    try { expect(bot.checkWebLogin(code, claim)).toEqual({ status: "expired" }); } finally { now.mockRestore(); }
  });
});

describe("Bot transport", () => {
  it("compares secrets safely, including arrays and missing configuration", () => {
    expect(verifyBotSecret("abc", "abc")).toBe(true);
    expect(verifyBotSecret(["abc"], "abc")).toBe(false);
    expect(verifyBotSecret("abc", undefined)).toBe(false);
    expect(verifyBotSecret("\u00e9", "x")).toBe(false);
  });
  it("resolves public links from account_name and gates production on token", async () => {
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: {
      id: "3431386737049524427", account_name: "bot.JwUidOjZ",
    } })));
    vi.stubGlobal("fetch", fake);
    const account = await new BotTransport("fake-token").accountName();
    expect(botInfo({ ...cfg, mode: "supabase", zaloBotId: account })?.url).toBe("https://zalo.me/bot.JwUidOjZ");
    expect(botInfo({ ...cfg, mode: "supabase", zaloBotId: "3431386737049524427" })).toBeNull();
    expect(botInfo({ ...cfg, mode: "supabase", zaloBotId: account, zaloBotToken: undefined })).toBeNull();
  });
  it("posts chat_id/text and fails closed on provider and HTTP errors", async () => {
    const fake = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fake);
    const sender = new BotTransport("fake-token");
    expect(await sender.sendText("chat", "hello")).toBe(true);
    expect(fake).toHaveBeenCalledWith(`${BOT_API}/botfake-token/sendMessage`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ chat_id: "chat", text: "hello" }),
    }));
    fake.mockResolvedValue(new Response('{"ok":false}'));
    await expect(sender.sendText("chat", "hello")).rejects.toThrow("Zalo Bot sendMessage failed");
    fake.mockResolvedValue(new Response('{"ok":true}', { status: 500 }));
    await expect(sender.sendText("chat", "hello")).rejects.toThrow();
    fake.mockRejectedValue(new Error("https://secret-token"));
    await expect(sender.sendText("chat", "hello")).rejects.toThrow(/^Zalo Bot sendMessage failed$/);
  });
  it("registers the expected webhook only when explicitly called (mocked API)", async () => {
    const fake = vi.fn().mockResolvedValue(new Response('{"ok":true,"result":{"verification":{"ok":true}}}'));
    vi.stubGlobal("fetch", fake);
    const body = { url: "https://sankhau.pro.vn/api/zalo/bot-webhook", secret_token: "test-secret" };
    expect((await new BotTransport("fake-token").call("setWebhook", body))?.verification?.ok).toBe(true);
    expect(fake).toHaveBeenCalledWith(`${BOT_API}/botfake-token/setWebhook`, expect.objectContaining({
      method: "POST", body: JSON.stringify(body),
    }));
  });
});


describe("Review regressions", () => {
  it("keeps discovery disabled on failure, retries every five minutes and stops after success", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const accountName = vi.fn().mockRejectedValueOnce(new Error("secret-token"))
      .mockRejectedValueOnce(new Error("secret-token")).mockResolvedValue("bot.Recovered");
    const production = { ...cfg, mode: "supabase", zaloBotId: "bot.Stale" } as Config;
    const stop = discoverBotAccount(production, { accountName });
    try {
      expect(botInfo(production)).toBeNull();
      await vi.advanceTimersByTimeAsync(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
      await vi.advanceTimersByTimeAsync(300_000);
      expect(accountName).toHaveBeenCalledTimes(2);
      expect(botInfo(production)).toBeNull();
      await vi.advanceTimersByTimeAsync(300_000);
      expect(botInfo(production)?.url).toBe("https://zalo.me/bot.Recovered");
      await vi.advanceTimersByTimeAsync(600_000);
      expect(accountName).toHaveBeenCalledTimes(3);
    } finally { stop(); }
  });

  it("acknowledges before handling finishes, dedupes message_id even on failure, and accepts id-less events", async () => {
    let reject!: (e: Error) => void;
    const pending = new Promise<void>((_, r) => { reject = r; });
    const handle = vi.spyOn(bot, "handle").mockImplementation(() => pending);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = { ...event("slow-person", "hello"), message: {
      ...event("slow-person", "hello").message, message_id: "review-slow-message",
    } };
    const send = (body: unknown) => post("/api/zalo/bot-webhook", body, { "X-Bot-Api-Secret-Token": cfg.zaloBotWebhookSecret! });
    try {
      expect((await send(payload)).status).toBe(200);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
      expect((await send(payload)).status).toBe(200);
      expect(handle).toHaveBeenCalledTimes(1);
      reject(new Error("sendMessage failed"));
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith("[zalo] webhook processing failed"));
      handle.mockResolvedValue(undefined);
      expect((await send(payload)).status).toBe(200);
      expect(handle).toHaveBeenCalledTimes(1);
      await send(event("no-id", "hello"));
      await send(event("no-id", "hello"));
      await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(3));
    } finally { reject(new Error("cleanup")); }
  });

  it("validates malformed authenticated payloads before acknowledging", async () => {
    const res = await post("/api/zalo/bot-webhook", { event_name: 123 }, { "X-Bot-Api-Secret-Token": cfg.zaloBotWebhookSecret! });
    expect(res.status).toBe(400);
  });

  it("uses sender identity and display name while replying to a different chat for text and images", async () => {
    const e = event("review-identity", "dang ky");
    e.message.chat.id = "review-chat";
    e.message.from.display_name = "Webhook name";
    await bot.handle(e);
    const user = await userByIdentity(db, "zalo_oa", "review-identity");
    expect(user?.display_name).toBe("Webhook name");
    expect(await userByIdentity(db, "zalo_oa", "review-chat")).toBeNull();
    expect(cap.sent.at(-1)?.to).toBe("review-chat");
    const { code, claim } = bot.createWebLogin();
    await bot.handle({ ...e, message: { ...e.message, text: `DN ${code}` } });
    expect(bot.checkWebLogin(code, claim)).toEqual({ status: "ok", userId: user!.id });
    expect(cap.sent.at(-1)?.to).toBe("review-chat");
    await bot.handle({ event_name: "message.image.received", message: {
      from: { id: "review-identity" }, chat: { id: "review-image-chat", chat_type: "PRIVATE" }, photo_url: "https://example.test/receipt",
    } });
    expect(cap.sent.at(-1)?.to).toBe("review-image-chat");
  });

  it("uses the webhook display name for a new DN account", async () => {
    const { code, claim } = bot.createWebLogin();
    const e = event("review-new-dn", `DN ${code}`);
    e.message.chat.id = "review-new-dn-chat";
    await bot.handle(e);
    const user = await userByIdentity(db, "zalo_oa", e.message.from.id);
    expect(user?.display_name).toBe(e.message.from.display_name);
    expect(bot.checkWebLogin(code, claim)).toEqual({ status: "ok", userId: user!.id });
    expect(cap.sent.at(-1)?.to).toBe(e.message.chat.id);
  });

  it("directs immediate payment confirmations to the receipt chat", async () => {
    const query = vi.spyOn(db, "query").mockResolvedValueOnce({ rows: [{ code: "TEST", user_id: "payer", kind: "create_room", room_id: null }] });
    await bot.notifyPaid("test-order", "receipt-chat");
    expect(query).toHaveBeenCalledTimes(1);
    expect(cap.sent.at(-1)?.to).toBe("receipt-chat");
  });

  it("times out image fetches and rejects declared oversized bodies without reading", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const read = vi.fn();
    const cancel = vi.fn();
    const fake = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ "content-length": String(8 * 1024 * 1024 + 1) }), body: { cancel }, arrayBuffer: read });
    vi.stubGlobal("fetch", fake);
    const sender = new BotTransport("fake-token");
    expect(await sender.fetchImage("https://example.test/image")).toBeNull();
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fake).toHaveBeenCalledWith("https://example.test/image", { signal: expect.any(AbortSignal) });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    fake.mockResolvedValue(new Response("image"));
    expect(await sender.fetchImage("https://example.test/image")).toEqual(Buffer.from("image"));
    fake.mockResolvedValue(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    expect(await sender.fetchImage("https://example.test/image")).toBeNull();
    fake.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    await expect(sender.fetchImage("https://example.test/image")).rejects.toThrow("Timed out");
  });
});
