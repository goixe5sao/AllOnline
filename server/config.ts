import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Mode = "supabase" | "demo";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Load .env.local / .env for the custom server (Next only loads them for its own code). */
export function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export interface Config {
  mode: Mode;
  production: boolean;
  port: number;
  databaseUrl?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  supabaseServiceRoleKey?: string;
  storageBucket: string;
  appSecret: string;
  paymentWebhookSecret?: string;
  publicOrigin?: string;
  /** Secure cookies need HTTPS. Plain-HTTP trials (e.g. http://<public-ip>:3000) must turn them off. */
  secureCookies: boolean;
  /** Private base URL of the StockVN analysis service (e.g. http://127.0.0.1:3200); unset = no overlays. */
  stockvnUrl?: string;
  /** Bearer token StockVN expects when its password gate is on (STOCKVN_API_TOKEN there). */
  stockvnToken?: string;
  /** Interface to listen on; 127.0.0.1 when only a local tunnel/proxy should reach the server. */
  host?: string;
  dataDir: string;
  /** Zalo Login (Zalo for Developers app). */
  zaloAppId?: string;
  /** Cloudflare Realtime (live camera): SFU app id + secret, TURN key id + API token. */
  realtimeAppId?: string;
  realtimeAppSecret?: string;
  turnKeyId?: string;
  turnKeyToken?: string;
  zaloAppSecret?: string;
  /** Zalo domain verification meta tag value. */
  zaloSiteVerification?: string;
  /** Zalo Bot Platform (bot.zapps.me) — replaces the OA bot. Token from Zalo Bot Creator. */
  zaloBotToken?: string;
  /** Bot account_name (e.g. bot.JwUidOjZ), resolved via getMe at startup for public links. */
  zaloBotId?: string;
  /** Official share link copied from the Zalo Bot dashboard; overrides the zalo.me/<account_name> guess. */
  zaloBotUrl?: string;
  /** Sent by Zalo as X-Bot-Api-Secret-Token on every webhook call (set via setWebhook). */
  zaloBotWebhookSecret?: string;
  /** SePay webhook API key (bank transfers confirm orders automatically). */
  sepayApiKey?: string;
  /** Claude API key: reads payment screenshots sent to the bot (amount, content, time). */
  anthropicApiKey?: string;
  aiStockModel?: string;
  aiStockProvider?: string;
  /** Unset until the operator verifies Bot proactive-messaging eligibility. */
  zaloAlertWindowSeconds?: number;
}

export function readConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  const databaseUrl = env("DATABASE_URL");
  const supabaseUrl = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
  const supabasePublishableKey = env("SUPABASE_PUBLISHABLE_KEY") ?? env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const mode: Mode = databaseUrl && supabaseUrl && supabasePublishableKey ? "supabase" : "demo";

  if (production && mode === "demo" && env("ALLOW_DEMO_MODE") !== "1") {
    throw new Error(
      "Thiếu DATABASE_URL/SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY. Production không tự chạy chế độ demo; đặt ALLOW_DEMO_MODE=1 nếu thật sự muốn một bản demo.",
    );
  }

  let appSecret = env("APP_SECRET");
  if (!appSecret) {
    if (production) throw new Error("APP_SECRET bắt buộc ở production (ký vé WebSocket và cookie demo).");
    appSecret = randomBytes(32).toString("hex");
    console.warn("[config] APP_SECRET chưa đặt: dùng khóa ngẫu nhiên tạm thời (phiên sẽ mất khi khởi động lại).");
  }

  return {
    mode,
    production,
    port: Number(env("PORT") ?? 3000),
    databaseUrl,
    supabaseUrl,
    supabasePublishableKey,
    supabaseServiceRoleKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    storageBucket: env("SUPABASE_STORAGE_BUCKET") ?? "allonline-uploads",
    appSecret,
    paymentWebhookSecret: env("PAYMENT_WEBHOOK_SECRET"),
    publicOrigin: env("PUBLIC_ORIGIN"),
    secureCookies: env("COOKIE_SECURE") ? env("COOKIE_SECURE") === "1" : env("PUBLIC_ORIGIN") ? env("PUBLIC_ORIGIN")!.startsWith("https://") : production,
    stockvnUrl: env("STOCKVN_URL"),
    stockvnToken: env("STOCKVN_API_TOKEN"),
    host: env("HOST"),
    dataDir: env("DEMO_DATA_DIR") ?? path.join(process.cwd(), ".data"),
    zaloAppId: env("ZALO_APP_ID"),
    realtimeAppId: env("REALTIME_APP_ID"),
    realtimeAppSecret: env("REALTIME_APP_SECRET"),
    turnKeyId: env("REALTIME_TURN_KEY_ID"),
    turnKeyToken: env("REALTIME_TURN_KEY_TOKEN"),
    zaloAppSecret: env("ZALO_APP_SECRET"),
    zaloSiteVerification: env("ZALO_SITE_VERIFICATION"),
    zaloBotToken: env("ZALO_BOT_TOKEN"),
    zaloBotId: env("ZALO_BOT_ID"),
    zaloBotUrl: env("ZALO_BOT_URL"),
    zaloBotWebhookSecret: env("ZALO_BOT_WEBHOOK_SECRET"),
    sepayApiKey: env("SEPAY_API_KEY"),
    anthropicApiKey: env("ANTHROPIC_API_KEY"),
    aiStockModel: env("AI_STOCK_MODEL") ?? "claude-opus-5-5",
    aiStockProvider: env("AI_STOCK_PROVIDER") ?? "fixture",
    zaloAlertWindowSeconds: env("ZALO_ALERT_VERIFIED_WINDOW_SECONDS") ? Number(env("ZALO_ALERT_VERIFIED_WINDOW_SECONDS")) : undefined,
  };
}
