/**
 * AllOnline server: one Node.js process serving
 *   - the Next.js UI,
 *   - the REST API under /api,
 *   - the authoritative realtime WebSocket under /ws,
 *   - background sweepers (room expiry, payment holds, upload retention)
 * so expiry works even when no browser is open.
 */
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
import { closeRoom, dueRooms, expireOrders } from "./services/rooms";
import { getUser } from "./services/users";
import { clientIp } from "./http";
import path from "node:path";

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
  if (process.env.MARKET_DATA !== "off") market.start();
  const api = createApi({ cfg, db, auth, hub, storage, market });

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

  server.listen(cfg.port, () => {
    console.log(`> AllOnline ${cfg.mode === "demo" ? "[CHẾ ĐỘ DEMO — PGlite cục bộ, đăng nhập demo, thanh toán giả]" : "[Supabase]"} http://localhost:${cfg.port}`);
  });

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
