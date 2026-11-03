import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServerClient } from "@supabase/ssr";
import type { Config } from "./config";
import type { Db } from "./db";
import { appendCookie, parseCookies, serializeCookie } from "./http";
import { createGuest, getUser, upsertUser, type AppUser } from "./services/users";

const DEMO_COOKIE = "ao_demo";
const GUEST_COOKIE = "ao_guest";
const DEVICE_COOKIE = "ao_dev";

export class Signer {
  constructor(private secret: string) {}
  sign(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${body}.${mac}`;
  }
  verify<T extends { exp: number }>(token: string | undefined | null): T | null {
    if (!token) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const expected = createHmac("sha256", this.secret).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
      return p.exp > Date.now() ? p : null;
    } catch {
      return null;
    }
  }
}

export class Auth {
  readonly signer: Signer;
  private cache = new Map<string, { user: AppUser; at: number }>();

  constructor(
    private cfg: Config,
    private db: Db,
  ) {
    this.signer = new Signer(cfg.appSecret);
  }

  supabase(req: IncomingMessage, res: ServerResponse) {
    const cookies = parseCookies(req.headers.cookie);
    return createServerClient(this.cfg.supabaseUrl!, this.cfg.supabasePublishableKey!, {
      cookies: {
        getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const { name, value, options } of list)
            appendCookie(res, serializeCookie(name, value, { ...options, sameSite: (options?.sameSite as "lax") ?? "lax", secure: this.cfg.production }));
        },
      },
    });
  }

  /** Resolves the signed-in user, else the guest identity. Roles always come from app.users. */
  async currentUser(req: IncomingMessage, res: ServerResponse): Promise<AppUser | null> {
    return (await this.accountUser(req, res)) ?? (await this.guestUser(req));
  }

  async guestUser(req: IncomingMessage): Promise<AppUser | null> {
    const p = this.signer.verify<{ k: string; uid: string; exp: number }>(parseCookies(req.headers.cookie)[GUEST_COOKIE]);
    if (!p || p.k !== "guest") return null;
    const u = await getUser(this.db, p.uid);
    return u?.is_guest ? u : null;
  }

  async startGuest(res: ServerResponse, displayName: string): Promise<AppUser> {
    const u = await createGuest(this.db, randomUUID(), displayName);
    appendCookie(res, serializeCookie(GUEST_COOKIE, this.signer.sign({ k: "guest", uid: u.id, exp: Date.now() + 30 * 86400_000 }), { httpOnly: true, sameSite: "lax", maxAge: 30 * 86400, secure: this.cfg.production }));
    return u;
  }

  clearGuest(res: ServerResponse) {
    appendCookie(res, serializeCookie(GUEST_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "lax" }));
  }

  private async accountUser(req: IncomingMessage, res: ServerResponse): Promise<AppUser | null> {
    if (this.cfg.mode === "demo") {
      const p = this.signer.verify<{ uid: string; exp: number }>(parseCookies(req.headers.cookie)[DEMO_COOKIE]);
      return p ? getUser(this.db, p.uid) : null;
    }
    const { data } = await this.supabase(req, res).auth.getUser();
    const u = data.user;
    if (!u) return null;
    if (u.is_anonymous) return null; // accounts are required: one ballot per real account
    const cached = this.cache.get(u.id);
    if (cached && Date.now() - cached.at < 30_000) return cached.user;
    const name = (u.user_metadata?.display_name as string | undefined) ?? u.email?.split("@")[0] ?? "Người dùng";
    await upsertUser(this.db, u.id, u.email ?? null, name, false);
    const user = await getUser(this.db, u.id);
    if (user) this.cache.set(u.id, { user, at: Date.now() });
    return user;
  }

  /**
   * Random per-browser device id (signed, httpOnly, 1 year). Not a fingerprint: nothing about the
   * hardware is read. Incognito / cleared cookies = a new device, by design.
   */
  deviceId(req: IncomingMessage): string | null {
    const p = this.signer.verify<{ k: string; id: string; exp: number }>(parseCookies(req.headers.cookie)[DEVICE_COOKIE]);
    return p && p.k === "dev" ? p.id : null;
  }

  ensureDevice(req: IncomingMessage, res: ServerResponse) {
    if (this.deviceId(req)) return;
    appendCookie(res, serializeCookie(DEVICE_COOKIE, this.signer.sign({ k: "dev", id: randomUUID(), exp: Date.now() + 365 * 86400_000 }), { httpOnly: true, sameSite: "lax", maxAge: 365 * 86400, secure: this.cfg.production }));
  }

  /** Stable pseudonymous id for an IP; the raw address is never stored. */
  ipHash(ip: string) {
    return createHmac("sha256", this.cfg.appSecret).update("ip:" + ip).digest("hex").slice(0, 32);
  }

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  // ----- demo identities (clearly labelled in the UI, refused outside demo mode) -----

  async demoLogin(res: ServerResponse, displayName: string, asAppOwner: boolean): Promise<AppUser> {
    if (this.cfg.mode !== "demo") throw new Error("demo login disabled");
    const id = randomUUID();
    await upsertUser(this.db, id, null, displayName, true);
    if (asAppOwner) await this.db.query("update app.users set role = 'app_owner' where id = $1 and is_demo", [id]);
    appendCookie(res, serializeCookie(DEMO_COOKIE, this.signer.sign({ uid: id, exp: Date.now() + 7 * 86400_000 }), { httpOnly: true, sameSite: "lax", maxAge: 7 * 86400, secure: this.cfg.production }));
    return (await getUser(this.db, id))!;
  }

  demoLogout(res: ServerResponse) {
    appendCookie(res, serializeCookie(DEMO_COOKIE, "", { maxAge: 0, httpOnly: true, sameSite: "lax" }));
  }

  // ----- short-lived tickets -----

  wsTicket(userId: string) {
    return this.signer.sign({ k: "ws", uid: userId, exp: Date.now() + 60_000 });
  }

  verifyWsTicket(t: string | null) {
    const p = this.signer.verify<{ k: string; uid: string; exp: number }>(t);
    return p && p.k === "ws" ? p.uid : null;
  }

  /** Proof that this user passed the invite/password check for this room. */
  roomPass(userId: string, roomId: string) {
    return this.signer.sign({ k: "pass", uid: userId, rid: roomId, exp: Date.now() + 24 * 3600_000 });
  }

  verifyRoomPass(t: string | null | undefined, userId: string, roomId: string) {
    const p = this.signer.verify<{ k: string; uid: string; rid: string; exp: number }>(t);
    return !!p && p.k === "pass" && p.uid === userId && p.rid === roomId;
  }
}
