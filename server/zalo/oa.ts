import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import type { Db } from "../db";

/**
 * Zalo Official Account API (https://developers.zalo.me/docs/official-account): send messages,
 * read follower profiles, verify webhooks. The OA access token lives ~25 hours; the refresh token
 * is single-use and rotated, so the latest pair is kept in app.kv (first one from env).
 */
export interface OaSender {
  sendText(oaUserId: string, text: string): Promise<boolean>;
  profile(oaUserId: string): Promise<{ name: string; avatar?: string } | null>;
  /** Download an image a follower sent (attachments carry a CDN URL). */
  fetchImage(url: string): Promise<Buffer | null>;
}

const TOKEN_KEY = "zalo_oa_token";

export class ZaloOa implements OaSender {
  private token: { access: string; refresh: string; expiresAt: number } | null = null;

  constructor(
    private cfg: Config,
    private db: Db,
  ) {}

  get enabled() {
    return !!(this.cfg.zaloAppId && this.cfg.zaloAppSecret && (this.cfg.zaloOaRefreshToken || this.token));
  }

  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.access;
    if (!this.token) {
      const row = (await this.db.query<{ value: { access: string; refresh: string; expiresAt: number } }>("select value from app.kv where key = $1", [TOKEN_KEY])).rows[0];
      if (row) this.token = row.value;
      if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.access;
    }
    const refresh = this.token?.refresh ?? this.cfg.zaloOaRefreshToken;
    if (!refresh || !this.cfg.zaloAppId || !this.cfg.zaloAppSecret) return null;
    const res = await fetch("https://oauth.zaloapp.com/v4/oa/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", secret_key: this.cfg.zaloAppSecret },
      body: new URLSearchParams({ refresh_token: refresh, app_id: this.cfg.zaloAppId, grant_type: "refresh_token" }),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: string | number; error?: number; message?: string };
    if (!j.access_token || !j.refresh_token) {
      console.error("[zalo] refresh token failed", j.error, j.message);
      return null;
    }
    this.token = { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + Number(j.expires_in ?? 90000) * 1000 };
    await this.db.query("insert into app.kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [TOKEN_KEY, JSON.stringify(this.token)]);
    return this.token.access;
  }

  /** Customer-care message (free within Zalo's window after the follower's last interaction). */
  async sendText(oaUserId: string, text: string): Promise<boolean> {
    const token = await this.accessToken();
    if (!token) return false;
    const res = await fetch("https://openapi.zalo.me/v3.0/oa/message/cs", {
      method: "POST",
      headers: { "Content-Type": "application/json", access_token: token },
      body: JSON.stringify({ recipient: { user_id: oaUserId }, message: { text: text.slice(0, 2000) } }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
    if (j.error) console.error("[zalo] send", j.error, j.message);
    return !j.error;
  }

  async profile(oaUserId: string) {
    const token = await this.accessToken();
    if (!token) return null;
    const res = await fetch(`https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent(JSON.stringify({ user_id: oaUserId }))}`, { headers: { access_token: token } });
    const j = (await res.json().catch(() => ({}))) as { error?: number; data?: { display_name?: string; avatar?: string } };
    return j.error || !j.data?.display_name ? null : { name: j.data.display_name, avatar: j.data.avatar };
  }

  async fetchImage(url: string) {
    if (!/^https:\/\//.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 8 * 1024 * 1024 ? null : buf;
  }
}

/**
 * Webhook signature: header `X-ZEvent-Signature: mac=<hex>` where
 * mac = sha256(app_id + raw body + timestamp + OA secret key).
 */
export function verifyZaloSignature(raw: string, header: string | undefined, appId: string, oaSecret: string): boolean {
  if (!header) return false;
  let ts = "";
  try {
    ts = String((JSON.parse(raw) as { timestamp?: string | number }).timestamp ?? "");
  } catch {
    return false;
  }
  const expected = createHash("sha256").update(appId + raw + ts + oaSecret).digest("hex");
  const got = header.replace(/^mac=/, "").trim().toLowerCase();
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** In-memory sender for the demo simulator and tests: keeps what the bot would have sent. */
export class CaptureSender implements OaSender {
  sent: { to: string; text: string }[] = [];
  images = new Map<string, Buffer>();
  async sendText(to: string, text: string) {
    this.sent.push({ to, text });
    return true;
  }
  async profile(id: string) {
    return { name: `Zalo ${id.slice(-4)}` };
  }
  async fetchImage(url: string) {
    return this.images.get(url) ?? null;
  }
}
