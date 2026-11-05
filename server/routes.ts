import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";
import type { Auth } from "./auth";
import type { Hub } from "./hub";
import type { Storage } from "./storage";
import { sniffMime } from "./storage";
import { clientIp, readBody, readJson, sameOrigin, sendJson } from "./http";
import { AVATARS, MAP_INFO } from "@/core/maps";
import { CHART_INTERVALS, demoMarketProvider, type CandleResult } from "@/core/market";
import type { MarketService } from "./market/service";
import { searchSymbols } from "./market/symbols";
import type { StockVnAnalysis } from "./analysis/stockvn";
import { getPriceTiers, getSettings, priceTiersSchema, replacePriceTiers, settingsPatchSchema, slotBudget, updateSettings } from "./services/settings";
import {
  AppError,
  cancelOrder,
  closeRoom,
  confirmPayment,
  getOrder,
  getRoom,
  getRoomByInvite,
  listOrders,
  listPublicRooms,
  listRooms,
  listSettlements,
  markSettlementDone,
  previewQuote,
  roomDeposit,
  runningBill,
  setRoomVisibility,
  requestExtension,
  requestRoom,
  roomConfigSchema,
  verifyPassword,
} from "./services/rooms";
import { setDisplayName, type AppUser } from "./services/users";
import { toHomeRoom } from "@/lib/home-data";
import { listPromos, promoInputSchema, upsertPromo } from "./services/promos";

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: string[];
  user: AppUser | null;
}

type Handler = (ctx: Ctx) => Promise<unknown>;

export function createApi(deps: { cfg: Config; db: Db; auth: Auth; hub: Hub; storage: Storage; market: MarketService; analysis: StockVnAnalysis }) {
  const { cfg, db, auth, hub, storage, market, analysis } = deps;
  const routes: { method: string; re: RegExp; handler: Handler; public?: boolean }[] = [];
  const route = (method: string, pattern: string, handler: Handler, opts: { public?: boolean } = {}) =>
    routes.push({ method, re: new RegExp("^" + pattern.replace(/:\w+/g, "([^/]+)") + "$"), handler, public: opts.public });

  /** Anyone allowed into a room: account holders and invite-link guests. */
  const needAttendee = (ctx: Ctx) => {
    if (!ctx.user) throw new AppError("AUTH_REQUIRED", "Vui lòng nhập tên hoặc đăng nhập.", 401);
    return ctx.user;
  };
  /** Real accounts only (default for everything except attending a room). Guests are refused. */
  const needUser = (ctx: Ctx) => {
    const u = needAttendee(ctx);
    if (u.is_guest) throw new AppError("ACCOUNT_REQUIRED", "Chức năng này cần tài khoản. Khách chỉ có thể tham dự phòng.", 403);
    return u;
  };
  const needAdmin = (ctx: Ctx) => {
    const u = needUser(ctx);
    if (u.role !== "app_owner") throw new AppError("FORBIDDEN", "Chỉ chủ ứng dụng.", 403);
    return u;
  };
  /** A 100%-discounted order (amount 0) is confirmed immediately by the server, no QR needed. */
  const settleFreeOrder = async (order: { code: string; id: string; amount_vnd: number; user_id: string }) => {
    if (Number(order.amount_vnd) !== 0) return null;
    const r = await confirmPayment(db, { orderCode: order.code, provider: "promo", txnId: "promo-" + order.id, amount: 0, actorId: order.user_id });
    return r.roomId ? { roomId: r.roomId } : null;
  };
  const ownedRoom = async (ctx: Ctx, id: string, allowAdmin = true) => {
    const u = needUser(ctx);
    const room = await getRoom(db, id);
    if (!room) throw new AppError("NOT_FOUND", "Không tìm thấy phòng.", 404);
    if (room.owner_id !== u.id && !(allowAdmin && u.role === "app_owner")) throw new AppError("FORBIDDEN", "Bạn không phải chủ phòng này.", 403);
    return { u, room };
  };
  const publicUser = (u: AppUser | null) => u && { id: u.id, displayName: u.display_name, email: u.email, role: u.role, isDemo: u.is_demo, isGuest: u.is_guest };

  // ----- session -----
  route("GET", "/api/me", async ({ user }) => ({ user: publicUser(user), mode: cfg.mode }), { public: true });

  route(
    "POST",
    "/api/auth/demo-login",
    async ({ req, res }) => {
      if (cfg.mode !== "demo") throw new AppError("DEMO_DISABLED", "Chế độ demo đã tắt.", 403);
      const b = z.object({ displayName: z.string().trim().min(1).max(60), asAppOwner: z.boolean().default(false) }).parse(await readJson(req));
      return { user: publicUser(await auth.demoLogin(res, b.displayName, b.asAppOwner)) };
    },
    { public: true },
  );

  route(
    "POST",
    "/api/auth/login",
    async ({ req, res }) => {
      if (cfg.mode !== "supabase") throw new AppError("DEMO_MODE", "Đang chạy demo: dùng đăng nhập demo.", 400);
      const b = z.object({ email: z.string().email(), password: z.string().min(6).max(200) }).parse(await readJson(req));
      const { error } = await auth.supabase(req, res).auth.signInWithPassword(b);
      if (error) throw new AppError("LOGIN_FAILED", error.message.includes("confirm") ? "Email chưa được xác nhận." : "Email hoặc mật khẩu không đúng.", 401);
      return { ok: true };
    },
    { public: true },
  );

  route(
    "POST",
    "/api/auth/signup",
    async ({ req, res, url }) => {
      if (cfg.mode !== "supabase") throw new AppError("DEMO_MODE", "Đang chạy demo: dùng đăng nhập demo.", 400);
      const b = z.object({ email: z.string().email(), password: z.string().min(8).max(200), displayName: z.string().trim().min(1).max(60) }).parse(await readJson(req));
      const origin = cfg.publicOrigin ?? url.origin;
      const { data, error } = await auth.supabase(req, res).auth.signUp({
        email: b.email,
        password: b.password,
        options: { emailRedirectTo: `${origin}/api/auth/callback`, data: { display_name: b.displayName } },
      });
      if (error) throw new AppError("SIGNUP_FAILED", error.message, 400);
      return { needsConfirmation: !data.session };
    },
    { public: true },
  );

  route(
    "GET",
    "/api/auth/callback",
    async ({ req, res, url }) => {
      const code = url.searchParams.get("code");
      if (code && cfg.mode === "supabase") await auth.supabase(req, res).auth.exchangeCodeForSession(code);
      res.statusCode = 302;
      res.setHeader("Location", "/");
      res.end();
      return undefined;
    },
    { public: true },
  );

  route(
    "POST",
    "/api/auth/logout",
    async ({ req, res, user }) => {
      auth.clearGuest(res);
      if (cfg.mode === "demo") auth.demoLogout(res);
      else if (!user?.is_guest) await auth.supabase(req, res).auth.signOut();
      if (user) auth.invalidate(user.id);
      return { ok: true };
    },
    { public: true },
  );

  route("PATCH", "/api/me", async (ctx) => {
    const u = needAttendee(ctx);
    const b = z.object({ displayName: z.string().trim().min(1).max(60) }).parse(await readJson(ctx.req));
    await setDisplayName(db, u.id, b.displayName);
    auth.invalidate(u.id);
    return { ok: true };
  });

  route("GET", "/api/ws-ticket", async (ctx) => ({ ticket: auth.wsTicket(needAttendee(ctx).id) }));

  // ----- catalog (public configuration, no secrets) -----
  route(
    "GET",
    "/api/catalog",
    async () => {
      const s = await getSettings(db);
      return {
        mode: cfg.mode,
        maps: Object.entries(MAP_INFO).map(([code, m]) => ({ code, ...m, enabled: s.enabled_maps.includes(code) })),
        avatars: Object.entries(AVATARS).map(([group, g]) => ({ group, ...g, enabled: s.enabled_avatar_groups.includes(group) })),
        durationOptions: s.duration_options,
        waitingRatio: s.waiting_ratio,
        maxRoomCapacity: s.max_room_capacity,
        trial: { enabled: s.trial_enabled, maxHours: s.trial_max_hours, maxCapacity: s.trial_max_capacity, perAccount: s.trial_rooms_per_account, startsAt: s.trial_starts_at, endsAt: s.trial_ends_at },
        extensionEnabled: s.extension_enabled,
        openEnded: { enabled: s.open_ended_enabled, deposit: Number(s.open_ended_deposit_vnd) },
        priceTiers: await getPriceTiers(db),
        waitingSurchargePct: s.waiting_surcharge_pct,
        budget: await slotBudget(db),
      };
    },
    { public: true },
  );

  // ----- rooms -----
  route("POST", "/api/rooms/quote", async (ctx) => {
    const u = needUser(ctx);
    const raw = await readJson<Record<string, unknown>>(ctx.req);
    const cfgIn = roomConfigSchema.parse(raw);
    const promo = z.string().max(40).optional().parse(raw.promoCode);
    return previewQuote(db, u.id, cfgIn, promo);
  });

  route("POST", "/api/rooms", async (ctx) => {
    const u = needUser(ctx);
    const b = z.object({ config: roomConfigSchema, useTrial: z.boolean(), promoCode: z.string().max(40).optional() }).parse(await readJson(ctx.req));
    const dev = auth.deviceId(ctx.req);
    const r = await requestRoom(db, u.id, b.config, b.useTrial, dev ? auth.ipHash("dev:" + dev) : null, b.useTrial ? undefined : b.promoCode);
    if (r.kind === "room") return { roomId: r.room.id, inviteCode: r.room.invite_code };
    const free = await settleFreeOrder(r.order);
    return free?.roomId ? { roomId: free.roomId, orderId: r.order.id, free: true } : { orderId: r.order.id };
  });

  route("GET", "/api/rooms/mine", async (ctx) => {
    const u = needUser(ctx);
    const rooms = await listRooms(db, { ownerId: u.id });
    const settlements = new Map((await listSettlements(db, { ownerId: u.id })).map((s) => [s.room_id, s]));
    const out = [];
    for (const r of rooms) {
      // Open-ended rooms: cost so far while open, the final bill once closed.
      const bill = r.open_ended && !r.slots_released_at ? runningBill(r, await roomDeposit(db, r.id)) : null;
      out.push({ ...r, live: hub.roomStats(r.id) && { ...hub.roomStats(r.id), members: undefined, queue: undefined }, bill, settlement: settlements.get(r.id) ?? null });
    }
    return { rooms: out };
  });

  // Rooms their owners chose to show on the home page (no secrets: invite links are meant to be shared).
  route(
    "GET",
    "/api/rooms/public",
    async () => {
      const rooms = await listPublicRooms(db);
      return {
        rooms: rooms.map((r) => {
          const live = hub.roomStats(r.id);
          return toHomeRoom(r, live ? { admitted: live.admitted, seated: live.seated } : null);
        }),
        online: hub.stats().onlineUsers,
      };
    },
    { public: true },
  );

  route("POST", "/api/rooms/:id/visibility", async (ctx) => {
    const { u, room } = await ownedRoom(ctx, ctx.params[0]);
    const b = z.object({ isPublic: z.boolean() }).parse(await readJson(ctx.req));
    await setRoomVisibility(db, room.id, b.isPublic, u.id);
    return { isPublic: b.isPublic };
  });

  route("GET", "/api/rooms/:id", async (ctx) => {
    const { room } = await ownedRoom(ctx, ctx.params[0]);
    const bill = room.open_ended && !room.slots_released_at ? runningBill(room, await roomDeposit(db, room.id)) : null;
    return { room, live: hub.roomStats(room.id), bill };
  });

  route("POST", "/api/rooms/:id/close", async (ctx) => {
    const { u, room } = await ownedRoom(ctx, ctx.params[0]);
    const ok = await closeRoom(db, room.id, room.owner_id === u.id ? "closed_by_owner" : "closed_by_admin", u.id);
    if (ok) hub.closeRoom(room.id, "closed");
    return { closed: ok };
  });

  route("POST", "/api/rooms/:id/extend", async (ctx) => {
    const u = needUser(ctx);
    const b = z.object({ hours: z.number().int().min(1), promoCode: z.string().max(40).optional() }).parse(await readJson(ctx.req));
    const order = await requestExtension(db, u.id, ctx.params[0], b.hours, b.promoCode);
    const free = await settleFreeOrder(order);
    if (free?.roomId) await hub.refreshRoom(free.roomId);
    return { orderId: order.id, free: !!free };
  });

  route("GET", "/api/rooms/:id/logs", async (ctx) => {
    const { room } = await ownedRoom(ctx, ctx.params[0]);
    const before = Number(ctx.url.searchParams.get("before") ?? 0) || null;
    const events = await db.query(
      `select e.id::text as id, e.type, e.data, e.created_at, u.display_name as actor_name from app.room_events e left join app.users u on u.id = e.actor_id
       where e.room_id = $1 ${before ? "and e.id < $2" : ""} order by e.id desc limit 200`,
      before ? [room.id, before] : [room.id],
    );
    const orders = await db.query("select code, kind, status, amount_vnd::float8 as amount_vnd, created_at, paid_at from app.orders where room_id = $1 or id = (select order_id from app.rooms where id = $1) order by created_at", [room.id]);
    return { events: events.rows, orders: orders.rows };
  });

  route("POST", "/api/rooms/:id/uploads", async (ctx) => {
    const { u, room } = await ownedRoom(ctx, ctx.params[0], false);
    const s = await getSettings(db);
    const data = await readBody(ctx.req, s.upload_max_mb * 1024 * 1024);
    const mime = sniffMime(data);
    if (!mime) throw new AppError("UNSUPPORTED_FILE", "Chỉ nhận ảnh PNG/JPEG/WebP/GIF hoặc âm thanh MP3/OGG/WAV/M4A.", 415);
    const row = (
      await db.query<{ id: string }>(
        "insert into app.uploads (room_id, owner_id, storage_path, mime, size_bytes, delete_after) values ($1, $2, '', $3, $4, now() + make_interval(days => $5)) returning id",
        [room.id, u.id, mime, data.length, s.upload_retention_days],
      )
    ).rows[0];
    const key = `${room.id}/${row.id}`;
    await storage.put(cfg.mode === "supabase" ? key : row.id, data, mime);
    await db.query("update app.uploads set storage_path = $2 where id = $1", [row.id, cfg.mode === "supabase" ? key : row.id]);
    await db.query("insert into app.room_events (room_id, actor_id, type, data) values ($1, $2, 'file_uploaded', $3)", [room.id, u.id, JSON.stringify({ uploadId: row.id, mime, size: data.length })]);
    return { url: `/api/uploads/${row.id}`, mime };
  });

  route(
    "GET",
    "/api/uploads/:id",
    async ({ res, params }) => {
      if (!/^[0-9a-f-]{36}$/.test(params[0])) throw new AppError("NOT_FOUND", "", 404);
      const row = (await db.query<{ storage_path: string; mime: string }>("select storage_path, mime from app.uploads where id = $1 and deleted_at is null", [params[0]])).rows[0];
      const data = row && (await storage.get(row.storage_path));
      if (!data) throw new AppError("NOT_FOUND", "Tệp không còn.", 404);
      res.statusCode = 200;
      res.setHeader("Content-Type", row.mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(data);
      return undefined;
    },
    { public: true },
  );

  // ----- invites -----
  route(
    "GET",
    "/api/invite/:code",
    async ({ params, user }) => {
      const r = await getRoomByInvite(db, params[0]);
      if (!r || r.status !== "open") throw new AppError("NOT_FOUND", "Link mời không hợp lệ hoặc phòng đã đóng.", 404);
      return {
        room: { id: r.id, name: r.name, description: r.description, map: r.map_code, avatarGroups: r.avatar_groups, entryMode: r.entry_mode, hasPassword: !!r.password_hash, expiresAt: r.expires_at, openEnded: r.open_ended },
        isOwner: !!user && user.id === r.owner_id,
        guestJoinEnabled: (await getSettings(db)).guest_join_enabled,
      };
    },
    { public: true },
  );

  const joinLimiter = new Map<string, { n: number; at: number }>();
  // Invite-link guests: only a display name. The per-IP cap is high (offices/schools share one IP)
  // and only stops scripted mass creation; can be disabled in /admin.
  const guestLimiter = new Map<string, { n: number; at: number }>();
  route(
    "POST",
    "/api/guest",
    async (ctx) => {
      const b = z.object({ displayName: z.string().trim().min(1).max(60) }).parse(await readJson(ctx.req));
      if (ctx.user) {
        if (ctx.user.is_guest) {
          await setDisplayName(db, ctx.user.id, b.displayName);
          return { user: publicUser({ ...ctx.user, display_name: b.displayName }) };
        }
        return { user: publicUser(ctx.user) };
      }
      const s = await getSettings(db);
      if (!s.guest_join_enabled) throw new AppError("GUEST_DISABLED", "Phòng yêu cầu đăng nhập tài khoản.", 403);
      const ip = clientIp(ctx.req);
      const now = Date.now();
      const lim = guestLimiter.get(ip);
      if (lim && now - lim.at < 3600_000 && lim.n >= 500) throw new AppError("TOO_MANY_GUESTS", "Tạo quá nhiều lượt khách, thử lại sau.", 429);
      guestLimiter.set(ip, lim && now - lim.at < 3600_000 ? { n: lim.n + 1, at: lim.at } : { n: 1, at: now });
      return { user: publicUser(await auth.startGuest(ctx.res, b.displayName)) };
    },
    { public: true },
  );

  route("POST", "/api/join", async (ctx) => {
    const u = needAttendee(ctx);
    if (u.is_guest && !(await getSettings(db)).guest_join_enabled) throw new AppError("GUEST_DISABLED", "Phòng yêu cầu đăng nhập tài khoản.", 403);
    const b = z.object({ inviteCode: z.string().max(20), password: z.string().max(64).default("") }).parse(await readJson(ctx.req));
    const lim = joinLimiter.get(u.id);
    const now = Date.now();
    if (lim && now - lim.at < 60_000 && lim.n >= 10) throw new AppError("TOO_MANY_ATTEMPTS", "Thử quá nhiều lần, đợi 1 phút.", 429);
    joinLimiter.set(u.id, lim && now - lim.at < 60_000 ? { n: lim.n + 1, at: lim.at } : { n: 1, at: now });
    const r = await getRoomByInvite(db, b.inviteCode);
    if (!r || r.status !== "open") throw new AppError("NOT_FOUND", "Link mời không hợp lệ hoặc phòng đã đóng.", 404);
    // The room owner does not need the room password to attend their own room.
    if (r.owner_id !== u.id && r.password_hash && !verifyPassword(b.password, r.password_hash)) throw new AppError("INVALID_ROOM_PASSWORD", "Mật mã phòng không đúng.", 403);
    return { roomId: r.id, pass: auth.roomPass(u.id, r.id) };
  });

  // ----- market data for the stage chart (provider keys stay on the server) -----
  const candleCache = new Map<string, { at: number; body: CandleResult }>();
  route("GET", "/api/market/candles", async (ctx) => {
    needAttendee(ctx);
    const q = z
      .object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/), interval: z.enum(CHART_INTERVALS).default("D"), count: z.coerce.number().int().min(20).max(8000).default(300) })
      .parse(Object.fromEntries(ctx.url.searchParams));
    const key = `${q.symbol}|${q.interval}|${q.count}`;
    const hit = candleCache.get(key);
    if (hit && Date.now() - hit.at < 5000) return hit.body;
    // Real (collected) data first; synthetic DEMO data only if nothing has been collected yet.
    const real = await market.candles(q.symbol, q.interval, q.count);
    const body: CandleResult = real.length
      ? { symbol: q.symbol, interval: q.interval, source: (await market.lastSourceLabel(q.symbol)) ?? "không chính thức", isDemo: false, candles: real }
      : { symbol: q.symbol, interval: q.interval, source: "demo", isDemo: true, candles: await demoMarketProvider.candles(q.symbol, q.interval, q.count, Date.now()) };
    candleCache.set(key, { at: Date.now(), body });
    if (candleCache.size > 200) candleCache.delete(candleCache.keys().next().value!);
    return body;
  });

  // Stock picker (room owners): search listed symbols; indices and watchlist come first.
  route("GET", "/api/market/symbols", async (ctx) => {
    const u = needUser(ctx);
    const q = z.object({ q: z.string().max(40).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(Object.fromEntries(ctx.url.searchParams));
    return { symbols: await searchSymbols(db, q.q, q.limit), canWatch: u.role === "app_owner" };
  });

  // Watchlist (app owner): full daily history + 1-minute bars kept, always collected.
  route("POST", "/api/admin/watchlist", async (ctx) => {
    const u = needAdmin(ctx);
    const b = z.object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,10}$/), on: z.boolean() }).parse(await readJson(ctx.req));
    const known = (await db.query<{ kind: string }>("select kind from app.market_symbols where symbol = $1", [b.symbol])).rows[0];
    if (!known) throw new AppError("NOT_FOUND", "Mã không có trong danh sách niêm yết.", 404);
    if (known.kind === "index") throw new AppError("INVALID", "Chỉ số luôn được nạp toàn bộ lịch sử.", 400);
    if (b.on) await db.query("insert into app.market_watchlist (symbol, added_by) values ($1, $2) on conflict do nothing", [b.symbol, u.id]);
    else await db.query("delete from app.market_watchlist where symbol = $1", [b.symbol]);
    await market.watchlistChanged(b.symbol);
    return { symbol: b.symbol, watch: b.on };
  });

  // Trendlines / channels / S-R / candle patterns / breakouts from the StockVN service (cached).
  route("GET", "/api/market/analysis", async (ctx) => {
    needAttendee(ctx);
    const q = z
      .object({ symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,10}$/), interval: z.enum(CHART_INTERVALS).default("D"), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
      .parse(Object.fromEntries(ctx.url.searchParams));
    return analysis.get(q.symbol, q.interval, q.from);
  });

  // ----- orders -----
  const orderView = async (orderId: string, u: AppUser) => {
    const o = await getOrder(db, orderId);
    if (!o || (o.user_id !== u.id && u.role !== "app_owner")) throw new AppError("NOT_FOUND", "Không tìm thấy đơn.", 404);
    const s = await getSettings(db);
    const qrConfigured = !!(s.qr_bank_bin && s.qr_account_no);
    const { config, ...rest } = o;
    const safeConfig = { ...config, password: undefined };
    return {
      order: { ...rest, config: safeConfig },
      payment: {
        qrConfigured,
        qrImageUrl: qrConfigured
          ? `https://img.vietqr.io/image/${s.qr_bank_bin}-${s.qr_account_no}-compact2.png?amount=${o.amount_vnd}&addInfo=${encodeURIComponent(o.code)}&accountName=${encodeURIComponent(s.qr_account_name)}`
          : null,
        bankBin: s.qr_bank_bin,
        accountNo: s.qr_account_no,
        accountName: s.qr_account_name,
        transferNote: o.code,
      },
      demoPayAvailable: cfg.mode === "demo",
      room: o.room_id ? await getRoom(db, o.room_id).then((r) => r && { id: r.id, invite_code: r.invite_code, name: r.name }) : null,
    };
  };

  route("GET", "/api/orders/mine", async (ctx) => ({ orders: await listOrders(db, { userId: needUser(ctx).id }) }));
  route("GET", "/api/orders/:id", async (ctx) => orderView(ctx.params[0], needUser(ctx)));
  route("POST", "/api/orders/:id/cancel", async (ctx) => {
    await cancelOrder(db, needUser(ctx).id, ctx.params[0]);
    return { ok: true };
  });
  route("POST", "/api/orders/:id/demo-pay", async (ctx) => {
    // Fake payment exists ONLY in demo mode; production never reaches this branch.
    if (cfg.mode !== "demo") throw new AppError("FORBIDDEN", "Thanh toán giả chỉ có trong chế độ demo.", 403);
    const u = needUser(ctx);
    const o = await getOrder(db, ctx.params[0]);
    if (!o || o.user_id !== u.id) throw new AppError("NOT_FOUND", "Không tìm thấy đơn.", 404);
    const r = await confirmPayment(db, { orderCode: o.code, provider: "demo", txnId: `demo-${o.id}`, amount: o.amount_vnd, actorId: u.id });
    if (r.roomId && o.kind === "extend_room") await hub.refreshRoom(r.roomId);
    return r;
  });

  // ----- payment webhook (generic, HMAC-verified) -----
  route(
    "POST",
    "/api/payments/webhook",
    async ({ req }) => {
      if (!cfg.paymentWebhookSecret) throw new AppError("WEBHOOK_DISABLED", "Chưa cấu hình webhook.", 404);
      const raw = await readBody(req, 64 * 1024);
      const sig = String(req.headers["x-signature"] ?? "");
      const expected = createHmac("sha256", cfg.paymentWebhookSecret).update(raw).digest("hex");
      if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new AppError("BAD_SIGNATURE", "Chữ ký không hợp lệ.", 401);
      const b = z.object({ txnId: z.string().min(1).max(100), orderCode: z.string().max(40), amount: z.number().int().min(0) }).parse(JSON.parse(raw.toString("utf8")));
      const r = await confirmPayment(db, { orderCode: b.orderCode, provider: "webhook", txnId: b.txnId, amount: b.amount, actorId: null, raw: b });
      if (r.roomId && r.order?.kind === "extend_room") await hub.refreshRoom(r.roomId);
      return { outcome: r.outcome };
    },
    { public: true },
  );

  // ----- app owner administration -----
  route("GET", "/api/admin/overview", async (ctx) => {
    needAdmin(ctx);
    const budget = await slotBudget(db);
    const rooms = await listRooms(db, {});
    const pending = await db.query<{ n: number }>("select count(*)::int as n from app.orders where status = 'pending' and hold_expires_at > now()");
    const review = await db.query<{ n: number }>("select count(*)::int as n from app.orders where status in ('needs_review', 'underpaid')");
    const due = await db.query<{ n: number }>("select count(*)::int as n from app.room_settlements where status <> 'settled'");
    const s = await getSettings(db);
    const soon = Math.max(...s.warning_minutes) * 60_000;
    const now = Date.now();
    const alerts = [
      ...rooms.filter((r) => r.status === "open" && !r.open_ended && new Date(r.expires_at).getTime() - now < soon).map((r) => ({ kind: "expiring", text: `Phòng “${r.name}” sắp hết hạn`, roomId: r.id })),
      ...(Number(review.rows[0].n) ? [{ kind: "payments", text: `${review.rows[0].n} giao dịch cần xem xét`, roomId: null }] : []),
      ...(Number(due.rows[0].n) ? [{ kind: "settlements", text: `${due.rows[0].n} phòng vô thời hạn cần hoàn tiền / thu thêm (tab Quyết toán)`, roomId: null }] : []),
      ...(budget.allocated > budget.budget ? [{ kind: "budget", text: "Slot đã phân bổ vượt ngân sách mới — chỉ ảnh hưởng phòng mới.", roomId: null }] : []),
    ];
    return { market: market.status, budget, live: hub.stats(), rooms, pendingOrders: Number(pending.rows[0].n), reviewOrders: Number(review.rows[0].n), alerts };
  });

  route("GET", "/api/admin/settlements", async (ctx) => {
    needAdmin(ctx);
    const status = z.enum(["refund_due", "collect_due", "settled"]).optional().parse(ctx.url.searchParams.get("status") || undefined);
    return { settlements: await listSettlements(db, { status }) };
  });

  route("POST", "/api/admin/settlements/:id/done", async (ctx) => {
    const u = needAdmin(ctx);
    const b = z.object({ note: z.string().trim().max(500).default("") }).parse(await readJson(ctx.req));
    await markSettlementDone(db, ctx.params[0], u.id, b.note);
    return { ok: true };
  });

  route("GET", "/api/admin/settings", async (ctx) => {
    needAdmin(ctx);
    return { settings: await getSettings(db), priceTiers: await getPriceTiers(db) };
  });

  route("PATCH", "/api/admin/settings", async (ctx) => {
    const u = needAdmin(ctx);
    const patch = settingsPatchSchema.parse(await readJson(ctx.req));
    const s = await updateSettings(db, u.id, patch);
    await hub.reloadSettings();
    return { settings: s };
  });

  route("PUT", "/api/admin/price-tiers", async (ctx) => {
    const u = needAdmin(ctx);
    await replacePriceTiers(db, u.id, priceTiersSchema.parse(await readJson(ctx.req)));
    return { priceTiers: await getPriceTiers(db) };
  });

  route("GET", "/api/admin/orders", async (ctx) => {
    needAdmin(ctx);
    return { orders: await listOrders(db, { status: ctx.url.searchParams.get("status") ?? undefined }) };
  });

  route("POST", "/api/admin/orders/:id/approve", async (ctx) => {
    const u = needAdmin(ctx);
    const b = z.object({ amount: z.number().int().min(0), reference: z.string().max(100).optional() }).parse(await readJson(ctx.req));
    const o = await getOrder(db, ctx.params[0]);
    if (!o) throw new AppError("NOT_FOUND", "Không tìm thấy đơn.", 404);
    const r = await confirmPayment(db, { orderCode: o.code, provider: "manual", txnId: b.reference || null, amount: b.amount, actorId: u.id, raw: { reference: b.reference } });
    if (r.roomId && o.kind === "extend_room") await hub.refreshRoom(r.roomId);
    return r;
  });

  route("POST", "/api/admin/orders/:id/reject", async (ctx) => {
    const u = needAdmin(ctx);
    const b = z.object({ note: z.string().max(300).default("") }).parse(await readJson(ctx.req));
    const r = await db.query("update app.orders set status = 'cancelled', review_note = $2, confirmed_by = $3, updated_at = now() where id = $1 and status in ('pending', 'underpaid', 'needs_review') returning code", [ctx.params[0], b.note || "Từ chối bởi chủ ứng dụng", u.id]);
    if (!r.rows.length) throw new AppError("ORDER_NOT_PENDING", "Đơn không thể từ chối ở trạng thái hiện tại.", 409);
    await db.query("insert into app.system_events (actor_id, type, data) values ($1, 'order_rejected', $2)", [u.id, JSON.stringify({ orderId: ctx.params[0], note: b.note })]);
    return { ok: true };
  });

  route("GET", "/api/admin/promos", async (ctx) => {
    needAdmin(ctx);
    return { promos: await listPromos(db) };
  });

  route("POST", "/api/admin/promos", async (ctx) => {
    const u = needAdmin(ctx);
    await upsertPromo(db, u.id, promoInputSchema.parse(await readJson(ctx.req)));
    return { promos: await listPromos(db) };
  });

  route("GET", "/api/admin/logs", async (ctx) => {
    needAdmin(ctx);
    const r = await db.query("select e.id::text as id, e.type, e.data, e.created_at, u.display_name as actor_name from app.system_events e left join app.users u on u.id = e.actor_id order by e.id desc limit 300");
    return { events: r.rows };
  });

  // ----- dispatcher -----
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? "GET";
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      try {
        if (method !== "GET" && url.pathname !== "/api/payments/webhook" && !sameOrigin(req)) throw new AppError("BAD_ORIGIN", "Yêu cầu bị chặn.", 403);
        auth.ensureDevice(req, res);
        const user = await auth.currentUser(req, res).catch(() => null);
        const out = await r.handler({ req, res, url, params: m.slice(1).map(decodeURIComponent), user });
        if (out !== undefined) sendJson(res, 200, out);
      } catch (e) {
        if (e instanceof AppError) sendJson(res, e.status, { error: e.code, message: e.message });
        else if (e instanceof z.ZodError) sendJson(res, 400, { error: "INVALID", message: "Dữ liệu không hợp lệ.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
        else {
          console.error("[api]", method, url.pathname, e);
          sendJson(res, 500, { error: "INTERNAL", message: "Lỗi máy chủ." });
        }
      }
      return;
    }
    sendJson(res, 404, { error: "NOT_FOUND", message: "Không có API này." });
  };
}
