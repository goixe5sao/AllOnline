/**
 * Cloudflare Realtime (SFU + TURN) client for live camera on the stage screen.
 * The App Secret / TURN token never leave this server: browsers send their SDP here and get
 * the SFU's answer back. Docs: https://developers.cloudflare.com/realtime/sfu/https-api/
 *
 * Also keeps the monthly traffic meter (estimate: viewers × bitrate × time) so live stops
 * before the free tier is used up.
 */
import type { Config } from "./config";
import type { Db } from "./db";
import { AppError } from "./services/rooms";
import { LIVE_BITRATE_BPS, quotaMonth } from "@/core/live";

const BASE = "https://rtc.live.cloudflare.com/v1";

export interface SessionDescription {
  type: "offer" | "answer";
  sdp: string;
}
interface TracksResponse {
  sessionDescription?: SessionDescription;
  requiresImmediateRenegotiation?: boolean;
  tracks?: { trackName?: string; mid?: string; sessionId?: string; errorCode?: string; errorDescription?: string }[];
  errorCode?: string;
  errorDescription?: string;
}

export class RealtimeClient {
  private ice: { at: number; servers: unknown[] } | null = null;

  constructor(private cfg: Config) {}

  get configured() {
    return !!(this.cfg.realtimeAppId && this.cfg.realtimeAppSecret);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new AppError("LIVE_NOT_CONFIGURED", "Máy chủ chưa có mã Cloudflare Realtime nên chưa live được.", 503);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await fetch(`${BASE}/apps/${this.cfg.realtimeAppId}${path}`, {
        method,
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${this.cfg.realtimeAppSecret}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as T & { errorCode?: string; errorDescription?: string };
      if (!r.ok || j.errorCode) {
        console.error("[live] cloudflare", method, path, r.status, j.errorCode, j.errorDescription);
        throw new AppError("LIVE_SFU", "Máy chủ video (Cloudflare) báo lỗi, thử lại nhé.", 502);
      }
      return j;
    } catch (e) {
      if (e instanceof AppError) throw e;
      console.error("[live] cloudflare", method, path, e);
      throw new AppError("LIVE_SFU", "Không kết nối được máy chủ video (Cloudflare), thử lại nhé.", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async newSession(): Promise<string> {
    const r = await this.call<{ sessionId: string }>("POST", "/sessions/new");
    return r.sessionId;
  }

  /** Broadcaster: their offer with local tracks → the SFU's answer. */
  async publish(sessionId: string, offer: SessionDescription, tracks: { mid: string; trackName: string }[]) {
    const r = await this.call<TracksResponse>("POST", `/sessions/${sessionId}/tracks/new`, { sessionDescription: offer, tracks: tracks.map((t) => ({ location: "local", ...t })) });
    if (r.tracks?.some((t) => t.errorCode)) throw new AppError("LIVE_SFU", "Máy chủ video từ chối luồng camera.", 502);
    return r;
  }

  /** Viewer: ask for the broadcaster's tracks → an offer from the SFU (answered via renegotiate). */
  async pull(sessionId: string, remote: { sessionId: string; trackName: string }[]) {
    const r = await this.call<TracksResponse>("POST", `/sessions/${sessionId}/tracks/new`, { tracks: remote.map((t) => ({ location: "remote", ...t })) });
    if (r.tracks?.some((t) => t.errorCode)) throw new AppError("LIVE_SFU", "Chưa nhận được hình từ người đang live, thử lại sau giây lát.", 502);
    return r;
  }

  async renegotiate(sessionId: string, answer: SessionDescription) {
    return this.call<TracksResponse>("PUT", `/sessions/${sessionId}/renegotiate`, { sessionDescription: answer });
  }

  /** STUN/TURN servers for the browsers (TURN lets 4G / office networks through). Cached 12 h. */
  async iceServers(): Promise<unknown[]> {
    const stun = [{ urls: "stun:stun.cloudflare.com:3478" }];
    if (!this.cfg.turnKeyId || !this.cfg.turnKeyToken) return stun;
    if (this.ice && Date.now() - this.ice.at < 12 * 3600_000) return this.ice.servers;
    try {
      const r = await fetch(`${BASE}/turn/keys/${this.cfg.turnKeyId}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.turnKeyToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
      });
      const j = (await r.json()) as { iceServers?: { urls: string | string[]; username?: string; credential?: string }[] };
      if (!r.ok || !j.iceServers) throw new Error(`status ${r.status}`);
      // port 53 is blocked by browsers (would only time out)
      const servers = j.iceServers.map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }));
      this.ice = { at: Date.now(), servers };
      return servers;
    } catch (e) {
      console.error("[live] turn", e);
      return stun;
    }
  }
}

/** Monthly live traffic estimate, kept in app.kv ("live_usage:2026-11" → { bytes }). */
export class LiveMeter {
  private month = "";
  private bytes = 0;
  private dirty = false;
  private loaded = false;

  constructor(private db: Db) {}

  private async ensure(now: number) {
    const m = quotaMonth(now);
    if (this.loaded && m === this.month) return;
    if (this.dirty) await this.save();
    this.month = m;
    const row = (await this.db.query<{ value: { bytes: number } }>("select value from app.kv where key = $1", [`live_usage:${m}`])).rows[0];
    this.bytes = Number(row?.value?.bytes ?? 0);
    this.loaded = true;
  }

  /** Add `viewers` watching for `seconds`. */
  async add(viewers: number, seconds: number, now = Date.now()) {
    await this.ensure(now);
    if (viewers <= 0) return;
    this.bytes += (viewers * seconds * LIVE_BITRATE_BPS) / 8;
    this.dirty = true;
  }

  async save() {
    if (!this.dirty || !this.month) return;
    this.dirty = false;
    await this.db.query("insert into app.kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [`live_usage:${this.month}`, JSON.stringify({ bytes: Math.round(this.bytes) })]);
  }

  async usedGb(now = Date.now()) {
    await this.ensure(now);
    return this.bytes / 1e9;
  }

  get monthKey() {
    return this.month;
  }
}
