import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "../config";

// Current official docs: https://bot.zapps.me/docs/apis/sendMessage/
export const BOT_API = "https://bot-api.zaloplatforms.com";

export interface BotSender {
  sendText(oaUserId: string, text: string): Promise<boolean>;
  profile(oaUserId: string): Promise<{ name: string; avatar?: string } | null>;
  /** Download an image a follower sent (attachments carry a CDN URL). */
  fetchImage(url: string): Promise<Buffer | null>;
}

/** Compare fixed-length digests, including non-ASCII and different-length inputs. */
export function verifyBotSecret(header: string | string[] | undefined, secret: string | undefined): boolean {
  if (!secret || typeof header !== "string") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(secret));
}

/** Public chat links use getMe.account_name, never the numeric API id. */
export function botInfo(cfg: Config) {
  if (cfg.mode === "demo") return { url: "https://zalo.me/demo-bot" };
  if (!cfg.zaloBotToken || !cfg.zaloBotId?.startsWith("bot.")) return null;
  return { url: `https://zalo.me/${encodeURIComponent(cfg.zaloBotId)}` };
}

export class BotTransport implements BotSender {
  constructor(private token: string) {}

  async call(method: "getMe" | "sendMessage" | "setWebhook", body: object = {}) {
    // Never include the token-bearing URL or provider errors in logs/exceptions.
    try {
      const res = await fetch(`${BOT_API}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json() as { ok?: boolean; result?: { account_name?: string; verification?: { ok?: boolean } } };
      if (!res.ok || data.ok !== true) throw new Error();
      return data.result;
    } catch {
      throw new Error(`Zalo Bot ${method} failed`);
    }
  }

  async accountName() {
    const name = (await this.call("getMe"))?.account_name;
    if (!name || !/^bot\.[A-Za-z0-9]+$/.test(name)) throw new Error("Invalid Zalo Bot account_name");
    return name;
  }

  async sendText(chatId: string, text: string): Promise<boolean> {
    await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 2000) });
    return true;
  }

  // Bot Platform has no OA profile endpoint; use a neutral name for new accounts.
  async profile() { return null; }

  async fetchImage(url: string) {
    if (!/^https:\/\//.test(url)) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 8 * 1024 * 1024 ? null : buf;
  }
}


/** In-memory sender for the demo simulator and tests: keeps what the bot would have sent. */
export class CaptureSender implements BotSender {
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
