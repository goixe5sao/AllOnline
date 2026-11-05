import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Config } from "../config";
import type { Db } from "../db";
import type { Auth } from "../auth";
import type { Hub } from "../hub";
import type { Storage } from "../storage";
import { sniffMime } from "../storage";
import { appendCookie, parseCookies, readBody, readJson, serializeCookie } from "../http";
import { AppError, confirmPayment, getOrder } from "../services/rooms";
import { findOrCreateZaloUser, identitiesOf, linkIdentity, oaUserIdOf, userByIdentity } from "../services/identities";
import type { AppUser } from "../services/users";
import { recordBankTransfer, sepaySchema } from "../payments/bank";
import { verifyZaloSignature, CaptureSender } from "./oa";
import type { ZaloBot, ZaloEvent } from "./bot";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  user: AppUser | null;
}
type Route = (method: string, pattern: string, handler: (ctx: Ctx) => Promise<unknown>, opts?: { public?: boolean }) => void;

const STATE_COOKIE = "ao_zst";
const b64url = (b: Buffer) => b.toString("base64url");
const redirect = (res: ServerResponse, to: string) => {
  res.statusCode = 302;
  res.setHeader("Location", to);
  res.end();
  return undefined;
};
/** Only same-site paths after sign-in (no open redirect). */
const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

/** Zalo Login, the Zalo OA bot webhook + simulator, SePay webhook, payment proofs for the admin. */
export function zaloRoutes(route: Route, deps: { cfg: Config; db: Db; auth: Auth; hub: Hub; storage: Storage; bot: ZaloBot }) {
  const { cfg, db, auth, hub, storage, bot } = deps;
  const origin = (url: URL) => cfg.publicOrigin ?? url.origin;
  const needUser = (ctx: Ctx) => {
    if (!ctx.user || ctx.user.is_guest) throw new AppError("ACCOUNT_REQUIRED", "Cần đăng nhập tài khoản.", 401);
    return ctx.user;
  };
  const needAdmin = (ctx: Ctx) => {
    const u = needUser(ctx);
    if (u.role !== "app_owner") throw new AppError("FORBIDDEN", "Chỉ chủ ứng dụng.", 403);
    return u;
  };
  /** After any confirmed payment: tell the payer on Zalo, refresh a live room's expiry. */
  const afterPaid = async (r: { outcome: string; order: { id: string; kind: string } | null; roomId?: string }) => {
    if (!r.order || !(r.outcome === "fulfilled" || r.outcome === "fulfilled_late")) return;
    if (r.roomId && r.order.kind === "extend_room") await hub.refreshRoom(r.roomId);
    await bot.notifyPaid(r.order.id).catch((e) => console.error("[zalo] notify", e));
  };

  // ---------- Zalo Login (OAuth v4 + PKCE) ----------
  route(
    "GET",
    "/api/auth/zalo/start",
    async ({ req, res, url, user }) => {
      if (!cfg.zaloAppId || !cfg.zaloAppSecret) throw new AppError("ZALO_DISABLED", "Chưa bật đăng nhập Zalo.", 404);
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const nonce = b64url(randomBytes(12));
      // A signed-in account (e.g. email) links Zalo to itself instead of creating a new account.
      const link = user && !user.is_guest ? user.id : null;
      appendCookie(res, serializeCookie(STATE_COOKIE, auth.signer.sign({ k: "zst", v: verifier, n: nonce, next: safeNext(url.searchParams.get("next")), link, exp: Date.now() + 10 * 60_000 }), { httpOnly: true, sameSite: "lax", maxAge: 600, secure: cfg.secureCookies }));
      void req;
      const q = new URLSearchParams({ app_id: cfg.zaloAppId, redirect_uri: `${origin(url)}/api/auth/zalo/callback`, code_challenge: challenge, state: nonce });
      return redirect(res, `https://oauth.zaloapp.com/v4/permission?${q.toString()}`);
    },
    { public: true },
  );

  route(
    "GET",
    "/api/auth/zalo/callback",
    async ({ req, res, url }) => {
      const st = auth.signer.verify<{ k: string; v: string; n: string; next: string; link: string | null; exp: number }>(parseCookies(req.headers.cookie)[STATE_COOKIE]);
      appendCookie(res, serializeCookie(STATE_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "lax" }));
      const code = url.searchParams.get("code");
      if (!st || st.k !== "zst" || st.n !== url.searchParams.get("state") || !code || !cfg.zaloAppId || !cfg.zaloAppSecret) return redirect(res, "/login?error=zalo");
      const tok = (await (
        await fetch("https://oauth.zaloapp.com/v4/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: cfg.zaloAppSecret },
          body: new URLSearchParams({ code, app_id: cfg.zaloAppId, grant_type: "authorization_code", code_verifier: st.v }),
        })
      )
        .json()
        .catch(() => ({}))) as { access_token?: string };
      if (!tok.access_token) return redirect(res, "/login?error=zalo");
      const me = (await (await fetch("https://graph.zalo.me/v2.0/me?fields=id,name,picture", { headers: { access_token: tok.access_token } })).json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        picture?: { data?: { url?: string } };
      };
      if (!me.id) return redirect(res, "/login?error=zalo");
      const avatar = me.picture?.data?.url;
      let userId: string;
      if (st.link) {
        const other = await userByIdentity(db, "zalo", me.id);
        if (other && other.id !== st.link) return redirect(res, "/account?error=zalo_taken");
        await linkIdentity(db, "zalo", me.id, st.link, { name: me.name, avatar });
        userId = st.link;
      } else {
        userId = (await findOrCreateZaloUser(db, "zalo", me.id, me.name ?? "Người dùng Zalo", avatar)).user.id;
        auth.startAccount(res, userId);
      }
      auth.invalidate(userId);
      return redirect(res, st.link ? "/account?linked=zalo" : st.next);
    },
    { public: true },
  );

  /** Login page → Zalo: a code to send to the bot; the page then polls with its secret claim. */
  route(
    "POST",
    "/api/auth/zalo/code",
    async () => {
      if (!cfg.zaloOaId) throw new AppError("ZALO_DISABLED", "Chưa bật bot Zalo.", 404);
      return { ...bot.createWebLogin(), botUrl: `https://zalo.me/${cfg.zaloOaId}` };
    },
    { public: true },
  );

  route(
    "POST",
    "/api/auth/zalo/code/check",
    async ({ req, res }) => {
      const b = z.object({ code: z.string().regex(/^\d{6}$/), claim: z.string().min(10).max(100) }).parse(await readJson(req, 4096));
      const r = bot.checkWebLogin(b.code, b.claim);
      if (r.status !== "ok") return { status: r.status };
      auth.startAccount(res, r.userId);
      auth.invalidate(r.userId);
      return { status: "ok" };
    },
    { public: true },
  );

  /** One-time link the bot sends ("ĐĂNG KÝ" / "ĐĂNG NHẬP"). */
  route(
    "GET",
    "/api/auth/zalo/bot-login",
    async ({ res, url }) => {
      const uid = bot.useLoginToken(url.searchParams.get("t"));
      if (!uid) return redirect(res, "/login?error=link");
      auth.startAccount(res, uid);
      return redirect(res, "/?welcome=zalo");
    },
    { public: true },
  );

  route("GET", "/api/me/identities", async (ctx) => {
    const u = needUser(ctx);
    return {
      identities: (await identitiesOf(db, u.id)).map((i) => ({ provider: i.provider, name: i.display_name, since: i.created_at })),
      zaloLogin: !!(cfg.zaloAppId && cfg.zaloAppSecret),
      bot: cfg.zaloOaId ? { url: `https://zalo.me/${cfg.zaloOaId}` } : null,
      simulator: cfg.mode === "demo",
    };
  });

  route("POST", "/api/me/zalo-link-code", async (ctx) => {
    const u = needUser(ctx);
    return { code: bot.linkCodeFor(u.id), expiresInMin: 10 };
  });

  route("POST", "/api/me/zalo-unlink", async (ctx) => {
    const u = needUser(ctx);
    await db.query("delete from app.user_identities where user_id = $1 and provider = 'zalo_oa'", [u.id]);
    return { ok: true };
  });

  // ---------- Zalo OA webhook ----------
  route(
    "POST",
    "/api/zalo/webhook",
    async ({ req }) => {
      const raw = (await readBody(req, 256 * 1024)).toString("utf8");
      if (!cfg.zaloAppId || !cfg.zaloOaSecret) throw new AppError("ZALO_DISABLED", "Chưa cấu hình bot Zalo.", 404);
      if (!verifyZaloSignature(raw, req.headers["x-zevent-signature"] as string | undefined, cfg.zaloAppId, cfg.zaloOaSecret)) throw new AppError("BAD_SIGNATURE", "Chữ ký không hợp lệ.", 401);
      const evt = JSON.parse(raw) as ZaloEvent;
      // Answer Zalo right away; the bot replies through the OA API.
      void bot.handle(evt).catch((e) => console.error("[zalo] bot", e));
      return { ok: true };
    },
    { public: true },
  );

  /**
   * Demo only: talk to the bot from the browser (no Zalo account needed). Messages the bot
   * "sends" are returned instead of going to Zalo.
   */
  route(
    "POST",
    "/api/zalo/simulate",
    async ({ req }) => {
      if (cfg.mode !== "demo" || !(bot.sender instanceof CaptureSender)) throw new AppError("NOT_FOUND", "Chỉ có ở chế độ demo.", 404);
      const b = z.object({ oaUserId: z.string().min(3).max(64), text: z.string().max(2000).optional(), image: z.string().max(12_000_000).optional() }).parse(await readJson(req, 12_500_000));
      const cap = bot.sender;
      const from = cap.sent.length;
      if (b.image) {
        const m = b.image.match(/^data:image\/[a-z]+;base64,(.+)$/);
        if (!m) throw new AppError("INVALID", "Ảnh không hợp lệ.");
        const url = `https://zalo.simulator/${Date.now()}`;
        cap.images.set(url, Buffer.from(m[1], "base64"));
        await bot.handle({ event_name: "user_send_image", sender: { id: b.oaUserId }, message: { attachments: [{ type: "image", payload: { url } }] } });
      } else await bot.handle({ event_name: "user_send_text", sender: { id: b.oaUserId }, message: { text: b.text ?? "" } });
      return { replies: cap.sent.slice(from).filter((m) => m.to === b.oaUserId).map((m) => m.text) };
    },
    { public: true },
  );

  // ---------- SePay (bank account watcher) ----------
  route(
    "POST",
    "/api/payments/sepay",
    async ({ req }) => {
      if (!cfg.sepayApiKey) throw new AppError("SEPAY_DISABLED", "Chưa cấu hình SePay.", 404);
      const authz = String(req.headers.authorization ?? "");
      if (authz !== `Apikey ${cfg.sepayApiKey}`) throw new AppError("BAD_SIGNATURE", "Sai API key.", 401);
      const tx = sepaySchema.parse(await readJson(req, 64 * 1024));
      const r = await recordBankTransfer(db, "sepay", tx);
      if (r.orderId) await afterPaid({ outcome: r.outcome, order: { id: r.orderId, kind: r.kind ?? "" }, roomId: r.roomId });
      return { success: true, outcome: r.outcome };
    },
    { public: true },
  );

  // ---------- admin: screenshots and bank transfers to check ----------
  route("GET", "/api/admin/proofs", async (ctx) => {
    needAdmin(ctx);
    const proofs = await db.query(
      `select p.id, p.status, p.note, p.extracted, p.created_at, u.display_name as user_name, o.code as order_code, o.amount_vnd::float8 as order_amount, o.status as order_status
       from app.payment_proofs p left join app.users u on u.id = p.user_id left join app.orders o on o.id = p.order_id
       order by (p.status in ('pending_review', 'waiting_bank')) desc, p.created_at desc limit 100`,
    );
    const bank = await db.query("select id, amount_vnd::float8 as amount_vnd, content, occurred_at, order_code, outcome, created_at from app.bank_transactions order by created_at desc limit 50");
    return { proofs: proofs.rows, bank: bank.rows, sepay: !!cfg.sepayApiKey, receiptAi: !!cfg.anthropicApiKey, bot: !!cfg.zaloOaId };
  });

  route("GET", "/api/admin/proofs/:id/image", async (ctx) => {
    needAdmin(ctx);
    const img = await storage.get(`receipts/${ctx.params[0]}`);
    if (!img) throw new AppError("NOT_FOUND", "Không còn ảnh.", 404);
    ctx.res.writeHead(200, { "Content-Type": sniffMime(img) ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" });
    ctx.res.end(img);
    return undefined;
  });

  route("POST", "/api/admin/proofs/:id/approve", async (ctx) => {
    const u = needAdmin(ctx);
    const p = (await db.query<{ order_id: string | null; user_id: string }>("select order_id, user_id from app.payment_proofs where id = $1", [ctx.params[0]])).rows[0];
    if (!p?.order_id) throw new AppError("NO_ORDER", "Biên lai chưa gắn đơn — duyệt trong tab Đơn hàng.");
    const o = await getOrder(db, p.order_id);
    if (!o) throw new AppError("NOT_FOUND", "Không tìm thấy đơn.", 404);
    const r = await confirmPayment(db, { orderCode: o.code, provider: "manual", txnId: `proof:${ctx.params[0]}`, amount: o.amount_vnd, actorId: u.id, raw: { proof: ctx.params[0] } });
    await db.query("update app.payment_proofs set status = 'approved', reviewed_by = $2, reviewed_at = now() where id = $1", [ctx.params[0], u.id]);
    await afterPaid(r);
    return { outcome: r.outcome };
  });

  route("POST", "/api/admin/proofs/:id/reject", async (ctx) => {
    const u = needAdmin(ctx);
    const b = z.object({ note: z.string().trim().max(300).default("") }).parse(await readJson(ctx.req));
    const p = (await db.query<{ user_id: string }>("update app.payment_proofs set status = 'rejected', note = $2, reviewed_by = $3, reviewed_at = now() where id = $1 returning user_id", [ctx.params[0], b.note || null, u.id])).rows[0];
    const to = p ? await oaUserIdOf(db, p.user_id) : null;
    if (to) await bot.sender.sendText(to, `Biên lai bạn gửi chưa được chấp nhận${b.note ? ": " + b.note : ""}. Nhắn ĐƠN để xem lại nội dung chuyển khoản.`).catch(() => undefined);
    return { ok: true };
  });

  return { afterPaid };
}
