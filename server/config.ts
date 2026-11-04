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
  dataDir: string;
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
    dataDir: env("DEMO_DATA_DIR") ?? path.join(process.cwd(), ".data"),
  };
}
