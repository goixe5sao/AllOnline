/**
 * AllOnline server: one Node.js process serving
 *   - the Next.js UI,
 *   - the REST API under /api,
 *   - the authoritative realtime WebSocket under /ws,
 *   - background sweepers (room expiry, payment holds, upload retention)
 * so expiry works even when no browser is open.
 */
import { LiveMeter, RealtimeClient } from "./live";
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { loadEnvFiles, readConfig } from "./config";
import { migrate, openPglite, openPostgres } from "./db";
import { Auth } from "./auth";
import { Hub } from "./hub";
import { createApi } from "./routes";
import { createStorage } from "./storage";
import { MarketService } from "./market/service";
import { StockVnAnalysis } from "./analysis/stockvn";
import { closeRoom, dueRooms, expireOrders, getRoomByInvite, listPublicRooms } from "./services/rooms";
import { getPriceTiers, getSettings } from "./services/settings";
import { openEndedHourlyRate } from "@/core/pricing";
import { registerHomeData, registerInviteMeta, toHomeRoom } from "@/lib/home-data";
import type { MapCode } from "@/core/maps";
import { getUser } from "./services/users";
import { clientIp } from "./http";
import path from "node:path";
import { CaptureSender, BotTransport } from "./zalo/transport";
import { discoverBotAccount } from "./zalo/startup";
import { ZaloBot } from "./zalo/bot";

async function main() {
  loadEnvFiles();
  const cfg = readConfig();
  const db = cfg.mode === "supabase" ? await openPostgres(cfg.databaseUrl!) : await openPglite(path.join(cfg.dataDir, "pglite"));
  await migrate(db);

  const auth = new Auth(cfg, db);
  const hub = new Hub(db, auth);
  await hub.start();
  const storage = createStorage(cfg);
  // Market data scheduler: 1-minute bars + daily bars every minute during the VN session.
  const market = new MarketService(db);
  hub.setMarket(market);
  const rtc = new RealtimeClient(cfg);
  hub.setLive(rtc, new LiveMeter(db));
  if (rtc.configured) console.log("> Live camera: Cloudflare Realtime on" + (cfg.turnKeyId ? " (+TURN)" : ""));
  if (process.env.MARKET_DATA !== "off") market.start();
  // Technical analysis is provided by the StockVN service (trendlines, channels, S/R, patterns…).
  const analysis = new StockVnAnalysis(cfg.stockvnUrl, undefined, undefined, cfg.stockvnToken);
  // Demo mode always captures messages, even when inherited env contains live credentials.
  const origin = () => cfg.publicOrigin ?? `http://localhost:${cfg.port}`;
  const zaloSender = cfg.mode !== "demo" && cfg.zaloBotToken ? new BotTransport(cfg.zaloBotToken) : new CaptureSender();
  if (zaloSender instanceof BotTransport) discoverBotAccount(cfg, zaloSender);
  const bot = new ZaloBot({
    cfg,
    db,
    auth,
    storage,
    sender: zaloSender,
    origin,
    onPaid: async ({ roomId, kind }) => {
      if (roomId && kind === "extend_room") await hub.refreshRoom(roomId);
    },
  });
  setInterval(() => void bot.tick().catch((e) => console.error("[zalo] tick", e)), 60_000);
  const api = createApi({ cfg, db, auth, hub, storage, market, analysis, bot, rtc });
  // Data for the server-rendered home page (same process as Next.js).
  registerHomeData(async () => {
    const [rows, s, tiers] = await Promise.all([listPublicRooms(db), getSettings(db), getPriceTiers(db)]);
    const cheapest = [...tiers].sort((a, b) => a.price_vnd - b.price_vnd)[0];
    return {
      rooms: rows.map((r) => {
        const live = hub.roomStats(r.id);
        return toHomeRoom(r, live ? { admitted: live.admitted, seated: live.seated } : null);
      }),
      enabledMaps: s.enabled_maps as MapCode[],
      online: hub.stats().onlineUsers,
      pricing: {
        trial: { enabled: s.trial_enabled, maxHours: s.trial_max_hours, maxCapacity: s.trial_max_capacity },
        from: cheapest ? { price: cheapest.price_vnd, hours: cheapest.duration_hours } : null,
        durations: s.duration_options,
        openEnded: { enabled: s.open_ended_enabled, deposit: Number(s.open_ended_deposit_vnd), hourlyFrom: openEndedHourlyRate(tiers, 1, 0, 0) },
      },
    };
  });
  // Invite page metadata (title / share image) for the server-rendered layout of /join/[code].
  registerInviteMeta(async (code) => {
    const r = await getRoomByInvite(db, code);
    if (!r || r.status !== "open") return null;
    const owner = await getUser(db, r.owner_id);
    return {
      name: r.name,
      description: r.description,
      map: r.map_code,
      startsAt: r.scheduled_at ? new Date(r.scheduled_at).getTime() : null,
      isPublic: r.is_public,
      ownerName: owner?.display_name ?? "",
    };
  });

  // Sweepers use the database clock (now()), never a browser clock.
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const id of await dueRooms(db)) if (await closeRoom(db, id, "expired", null)) hub.closeRoom(id, "expired");
      await expireOrders(db);
    } catch (e) {
      console.error("[sweeper]", e);
    } finally {
      sweeping = false;
    }
  };
  setInterval(sweep, 5000);
  void sweep();
  setInterval(async () => {
    try {
      const old = await db.query<{ id: string; storage_path: string }>("select id, storage_path from app.uploads where deleted_at is null and delete_after <= now() limit 50");
      for (const u of old.rows) {
        await storage.remove(u.storage_path);
        await db.query("update app.uploads set deleted_at = now() where id = $1", [u.id]);
      }
    } catch (e) {
      console.error("[retention]", e);
    }
  }, 3600_000);

  const dev = !cfg.production;
  const app = next({ dev, dir: process.cwd() });
  const handle = app.getRequestHandler();
  await app.prepare();
  const upgradeNext = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (url.pathname.startsWith("/api/")) return void api(req, res, url);
    return void handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws") return upgradeNext(req, socket, head);
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
    const uid = auth.verifyWsTicket(url.searchParams.get("ticket"));
    const user = uid ? await getUser(db, uid) : null;
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    const ipHash = auth.ipHash(clientIp(req));
    // No device cookie (unusual): treat the connection as its own device.
    const deviceId = auth.deviceId(req) ?? "anon-" + Math.random().toString(36).slice(2);
    wss.handleUpgrade(req, socket, head, (ws) => hub.attach(ws, user, ipHash, deviceId));
  });

  const onListen = () => {
    console.log(`> Sân Khấu Online ${cfg.mode === "demo" ? "[CHẾ ĐỘ DEMO — PGlite cục bộ, đăng nhập demo, thanh toán giả]" : "[Supabase]"} http://${cfg.host ?? "localhost"}:${cfg.port}`);
  };
  if (cfg.host) server.listen(cfg.port, cfg.host, onListen);
  else server.listen(cfg.port, onListen);

  const shutdown = async () => {
    hub.stop();
    market.stop();
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
