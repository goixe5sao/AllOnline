import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "./services/rooms";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export interface CookieOpts {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  domain?: string;
  expires?: Date;
}

export function serializeCookie(name: string, value: string, o: CookieOpts = {}): string {
  let s = `${name}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}`;
  if (o.maxAge !== undefined) s += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) s += `; Expires=${o.expires.toUTCString()}`;
  if (o.domain) s += `; Domain=${o.domain}`;
  if (o.httpOnly) s += "; HttpOnly";
  if (o.secure) s += "; Secure";
  if (o.sameSite) s += `; SameSite=${o.sameSite === true ? "Strict" : o.sameSite[0].toUpperCase() + o.sameSite.slice(1)}`;
  return s;
}

export function appendCookie(res: ServerResponse, cookie: string) {
  const prev = res.getHeader("Set-Cookie");
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : [];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

export async function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên quá lớn.", 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = unknown>(req: IncomingMessage, limitBytes = 64 * 1024): Promise<T> {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {} as T;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    throw new AppError("BAD_JSON", "Dữ liệu không hợp lệ.");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Blocks cross-site form/fetch posts to state-changing endpoints (cookie auth → CSRF). */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetch from older browsers / server-to-server
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Client IP. X-Forwarded-For is only trusted when the server runs behind a known proxy
 * (TRUST_PROXY=1); otherwise clients could spoof it to dodge per-IP limits.
 */
export function clientIp(req: IncomingMessage): string {
  let ip = req.socket.remoteAddress ?? "";
  if (process.env.TRUST_PROXY === "1") {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff ?? "").split(",")[0].trim();
    if (first) ip = first;
  }
  return ip.replace(/^::ffff:/, "");
}
