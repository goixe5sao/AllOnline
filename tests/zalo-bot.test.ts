import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { migrate, openPglite, type Db } from "../server/db";
import type { Config } from "../server/config";
import { Auth } from "../server/auth";
import { createApi } from "../server/routes";
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
afterEach(() => vi.unstubAllGlobals());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
const event = (id: string, text: string) => ({ event_name: "message.text.received", message: {
  from: { id, display_name: "Demo person", is_bot: false }, chat: { id, chat_type: "PRIVATE" }, text,
} });

describe("Bot Platform webhook and demo login", () => {
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
