import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openPglite, type Db } from "../server/db";
import type { Config } from "../server/config";
import { Auth } from "../server/auth";
import { userByIdentity } from "../server/services/identities";
import { parseCommand, ZaloBot } from "../server/zalo/bot";
import { zaloRoutes } from "../server/zalo/routes";
import { CaptureSender } from "../server/zalo/transport";

const cfg = { mode: "demo", appSecret: "test-secret", secureCookies: false } as Config;
const storage = { put: async () => {}, get: async () => null, remove: async () => {} };
const cap = new CaptureSender();
let db: Db, bot: ZaloBot, auth: Auth;
beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  auth = new Auth(cfg, db);
  bot = new ZaloBot({ cfg, db, auth, storage, sender: cap, origin: () => "http://example.test" });
}, 30_000);
afterAll(async () => { await db?.close(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("StockVN account link", () => {
  const setup = async (id: string) => {
    await bot.onText(id, "dang ky");
    return (await userByIdentity(db, "zalo_oa", id))!;
  };
  const fakeFetch = (status = 200, body: unknown = { stockvnUserId: 42, displayName: "Stock user" }) => {
    const fake = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fake);
    return fake;
  };
  afterEach(() => { delete cfg.sankhauLinkSecret; delete cfg.stockvnBaseUrl; });

  it("requires an existing sender account and includes SV in help", async () => {
    const fake = fakeFetch();
    await bot.onText("sv-unknown", "SV ABC234");
    expect(cap.sent.at(-1)?.text).toBe("Nhắn ĐĂNG KÝ để tạo tài khoản Sân Khấu Online (hoặc LK <mã> nếu đã có), rồi gửi lại SV <mã>.");
    expect(await userByIdentity(db, "zalo_oa", "sv-unknown")).toBeNull();
    await bot.onText("sv-unknown", "CÓ");
    expect(cap.sent.at(-1)?.text).toContain("SV <mã> — liên kết với tài khoản StockVN");
    expect(fake).not.toHaveBeenCalled();
  });

  it("confirms once, normalizes commands, persists/upserts and exposes only the current account link", async () => {
    const user = await setup("sv-success");
    cfg.sankhauLinkSecret = "fake-link-secret";
    cfg.stockvnBaseUrl = "http://stockvn.test/";
    const fake = fakeFetch();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await bot.onText("sv-success", "stóckvn abc234", "sv-chat");
    expect(cap.sent.at(-1)).toEqual(expect.objectContaining({ to: "sv-chat", text: expect.stringContaining(`«${user.display_name}»`) }));
    expect(fake).not.toHaveBeenCalled();
    await bot.onText("sv-success", "cÓ", "sv-chat");
    expect(fake).toHaveBeenCalledWith("http://stockvn.test/api/integrations/sankhau/link", {
      method: "POST", headers: { Authorization: "Bearer fake-link-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABC234", sankhauUserId: user.id, sankhauName: user.display_name }),
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(cap.sent.at(-1)).toEqual(expect.objectContaining({ to: "sv-chat", text: "Đã liên kết với StockVN." }));
    await bot.onText("sv-success", "co");
    expect(fake).toHaveBeenCalledTimes(1);
    await bot.onText("sv-success", "SV XYZ789");
    fake.mockResolvedValue(new Response('{"stockvnUserId":43}'));
    await bot.onText("sv-success", "co");
    const rows = (await db.query("select * from app.stockvn_links where user_id=$1", [user.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stockvn_user_id: "43", linked_at: expect.any(Date) });
    const getStatus = async (user: Awaited<ReturnType<typeof setup>>) => {
      let handler: Parameters<Parameters<typeof zaloRoutes>[0]>[2] | undefined;
      const register: Parameters<typeof zaloRoutes>[0] = (method, path, fn) => {
        if (method === "GET" && path === "/api/me/identities") handler = fn;
      };
      zaloRoutes(register, { cfg, db, auth, storage, bot } as unknown as Parameters<typeof zaloRoutes>[1]);
      return await handler!({ user } as Parameters<NonNullable<typeof handler>>[0]) as { stockvnLinked: boolean };
    };
    expect((await getStatus(user)).stockvnLinked).toBe(true);
    expect((await getStatus(await setup("sv-other"))).stockvnLinked).toBe(false);

  });

  it("cancels, expires, replaces pending codes and isolates accounts", async () => {
    await setup("sv-pending");
    await setup("sv-isolated");
    const fake = fakeFetch();
    cfg.sankhauLinkSecret = "fake";
    await bot.onText("sv-pending", "SV ABC234");
    await bot.onText("sv-isolated", "co");
    expect(fake).not.toHaveBeenCalled();
    await bot.onText("sv-pending", "KHÔNG");
    expect(cap.sent.at(-1)?.text).toBe("Đã hủy liên kết StockVN.");
    await bot.onText("sv-pending", "co");
    expect(fake).not.toHaveBeenCalled();
    await bot.onText("sv-pending", "SV ABC234");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 300_000);
    await bot.onText("sv-pending", "co");
    expect(cap.sent.at(-1)?.text).toContain("hết hạn");
    expect(fake).not.toHaveBeenCalled();
    clock.mockRestore();
    await bot.onText("sv-pending", "SV ABC234");
    await bot.onText("sv-pending", "SV XYZ789");
    await bot.onText("sv-pending", "co");
    expect(JSON.parse(fake.mock.calls[0][1].body).code).toBe("XYZ789");
  });

  it.each([
    [404, "Mã không đúng hoặc đã hết hạn, lấy mã mới ở bot StockVN (nhắn LIÊN KẾT)."],
    [409, "Tài khoản StockVN này đã liên kết với tài khoản khác."],
    [429, "Sai mã quá nhiều lần, lấy mã mới."],
    [500, "StockVN chưa phản hồi, thử lại sau."],
    [503, "StockVN chưa phản hồi, thử lại sau."],
  ])("handles HTTP %s without storing a link", async (status, reply) => {
    const id = `sv-http-${status}`;
    const user = await setup(id);
    cfg.sankhauLinkSecret = "fake";
    const fake = fakeFetch(status);
    await bot.onText(id, "SV ABC234");
    await bot.onText(id, "co");
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:3200/api/integrations/sankhau/link");
    expect(cap.sent.at(-1)?.text).toBe(reply);
    expect((await db.query("select 1 from app.stockvn_links where user_id=$1", [user.id])).rows).toHaveLength(0);
  });

  it("handles missing configuration, timeout and malformed success safely", async () => {
    const user = await setup("sv-failure");
    const fake = fakeFetch();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await bot.onText("sv-failure", "SV ABC234");
    await bot.onText("sv-failure", "co");
    expect(cap.sent.at(-1)?.text).toBe("Liên kết StockVN chưa được cấu hình.");
    expect(fake).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    cfg.sankhauLinkSecret = "secret-never-log";
    for (const outcome of ["timeout", "invalid"]) {
      if (outcome === "timeout") fake.mockRejectedValueOnce(new DOMException("secret-never-log", "TimeoutError"));
      else fake.mockResolvedValueOnce(new Response('{"displayName":"missing id"}'));
      await bot.onText("sv-failure", "SV ABC234");
      await bot.onText("sv-failure", "co");
      expect(cap.sent.at(-1)?.text).toBe("StockVN chưa phản hồi, thử lại sau.");
    }
    expect((await db.query("select 1 from app.stockvn_links where user_id=$1", [user.id])).rows).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-never-log");
  });
});


it("parses only six-character StockVN codes without colliding with existing commands", () => {
  for (const text of ["SV ABC234", "stockvn abc234", "ŚV abc234"]) expect(parseCommand(text)).toEqual({ kind: "stockvn", code: "ABC234" });
  for (const text of ["SV ABC01D", "SV ABC2345", "SV ABC23", "SV"]) expect(parseCommand(text)).toEqual({ kind: "help" });
  expect(parseCommand("LK 123456")).toEqual({ kind: "link", code: "123456" });
  expect(parseCommand("DN 123456")).toEqual({ kind: "weblogin", code: "123456" });
});
