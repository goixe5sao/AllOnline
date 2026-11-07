/**
 * "Trang web tự cuộn" on the stage screen: the server photographs the whole page once (a tall
 * image), and every viewer scrolls that picture top → bottom → back to the top, in step (the
 * position comes from the screen clock, so pause / play / "về đầu" work like a video).
 */
export const WEB_SPEEDS = ["slow", "normal", "fast"] as const;
export type WebSpeed = (typeof WEB_SPEEDS)[number];
export const WEB_SPEED_LABEL: Record<WebSpeed, string> = { slow: "Chậm", normal: "Vừa", fast: "Nhanh" };
/** Page pixels per second (pages are photographed 1280 px wide). */
const PX_PER_SEC: Record<WebSpeed, number> = { slow: 60, normal: 120, fast: 240 };

/** The page photo is taken in strips this tall (one huge photo fails in Chrome), at most WEB_MAX_H. */
export const WEB_TILE = 2000;
export const WEB_MAX_H = 12000;

export const WEB_PAUSE_TOP = 3;
export const WEB_PAUSE_BOTTOM = 3;
export const WEB_BACK_UP = 2;

/** The part of the page one screen shows (16:9 at the photo's width). */
export const webViewHeight = (w: number) => Math.round((w * 9) / 16);

export function webCycle(w: number, h: number, speed: WebSpeed) {
  const travel = Math.max(0, h - webViewHeight(w));
  const down = travel > 0 ? Math.max(4, travel / PX_PER_SEC[speed]) : 0;
  return { travel, down, total: travel > 0 ? WEB_PAUSE_TOP + down + WEB_PAUSE_BOTTOM + WEB_BACK_UP : 1 };
}

/** How far down (page px) the screen is after `t` seconds of playing. */
export function webOffset(t: number, w: number, h: number, speed: WebSpeed): number {
  const c = webCycle(w, h, speed);
  if (!c.travel) return 0;
  let x = ((t % c.total) + c.total) % c.total;
  if (x < WEB_PAUSE_TOP) return 0;
  x -= WEB_PAUSE_TOP;
  if (x < c.down) return ease(x / c.down) * c.travel;
  x -= c.down;
  if (x < WEB_PAUSE_BOTTOM) return c.travel;
  x -= WEB_PAUSE_BOTTOM;
  return (1 - ease(x / WEB_BACK_UP)) * c.travel;
}

/** Gentle start and stop. */
const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** Hosts the server must never open (its own machine, the home / office network, cloud metadata). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "::" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const m4 = v.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m4) return false;
  const [a, b] = [Number(m4[1]), Number(m4[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier NAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast / reserved
  );
}

/** A web page link the owner may put on screen: http(s), normal ports, no credentials. */
export function normalizeWebUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost" || host.endsWith(".localhost")) return null;
  if (isPrivateAddress(host)) return null;
  return u.toString();
}
