/**
 * Secure app-owner bootstrap. Requires direct database access (DATABASE_URL), so only
 * whoever controls the server/database can grant the role — never a browser request.
 *
 *   npm run grant-owner -- someone@example.com          # grant
 *   npm run grant-owner -- someone@example.com --revoke # revoke
 *
 * The person must have signed in once so their account row exists.
 */
import path from "node:path";
import { loadEnvFiles, readConfig } from "../server/config";
import { migrate, openPglite, openPostgres } from "../server/db";

async function main() {
  loadEnvFiles();
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email) throw new Error("Cách dùng: npm run grant-owner -- email@example.com [--revoke]");
  const cfg = readConfig();
  if (cfg.mode === "demo") console.warn("Đang ở chế độ demo (PGlite cục bộ). Trong demo có thể đăng nhập demo với vai trò chủ ứng dụng.");
  const db = cfg.mode === "supabase" ? await openPostgres(cfg.databaseUrl!) : await openPglite(path.join(cfg.dataDir, "pglite"));
  await migrate(db);
  const r = await db.query<{ id: string }>("update app.users set role = $2, updated_at = now() where lower(email) = lower($1) returning id", [email, revoke ? "user" : "app_owner"]);
  if (!r.rows.length) throw new Error("Không tìm thấy tài khoản. Người này cần đăng nhập ít nhất một lần trước.");
  await db.query("insert into app.system_events (type, data) values ($1, $2)", [revoke ? "app_owner_revoked" : "app_owner_granted", JSON.stringify({ email, via: "cli" })]);
  console.log(`${revoke ? "Đã thu hồi" : "Đã cấp"} quyền chủ ứng dụng cho ${email}`);
  await db.close();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
