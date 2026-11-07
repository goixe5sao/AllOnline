/**
 * Photographs a whole web page (headless Chrome) for "Trang web tự cuộn" on the stage screen.
 * Why a photo and not the live page in a frame: most big sites refuse to be framed, a framed page
 * from another site cannot be scrolled by us, and a photo is the same for every viewer, light on
 * phones, and runs none of the site's scripts / trackers in the viewers' browsers.
 *
 * Safety (the server opens links typed by room owners): only public http(s) addresses — every
 * request the page makes (images, frames, redirects) is checked, so a page cannot make the server
 * show its own machine or the home network. One page at a time, 25 s max, 1280 × ≤ 16000 px.
 */
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import type { Browser } from "puppeteer-core";
import { isPrivateAddress, normalizeWebUrl, WEB_MAX_H, WEB_TILE } from "@/core/webscroll";
import { AppError } from "./services/rooms";

const WIDTH = 1280;
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => !!p);

export function chromePath(): string | null {
  return CHROME_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

const dnsCache = new Map<string, { at: number; ok: boolean }>();
/** Public host? (every address it resolves to must be public) */
async function publicHost(host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateAddress(h)) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  const hit = dnsCache.get(h);
  if (hit && Date.now() - hit.at < 300_000) return hit.ok;
  let ok = false;
  try {
    const addrs = await lookup(h, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    ok = false;
  }
  dnsCache.set(h, { at: Date.now(), ok });
  return ok;
}

let browserP: Promise<Browser> | null = null;
async function browser(): Promise<Browser> {
  if (!browserP) {
    const exe = chromePath();
    if (!exe) throw new AppError("WEBSHOT_UNAVAILABLE", "Máy chủ chưa có trình duyệt Chrome để chụp trang web.", 503);
    const { default: puppeteer } = await import("puppeteer-core");
    browserP = puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-first-run", "--mute-audio", "--hide-scrollbars"] });
    browserP.then((b) => b.on("disconnected", () => (browserP = null))).catch(() => (browserP = null));
  }
  return browserP;
}

async function resetBrowser() {
  const p = browserP;
  browserP = null;
  const b = await p?.catch(() => null);
  if (b) await Promise.race([b.close().catch(() => b.process()?.kill()), new Promise((r) => setTimeout(r, 5000))]);
}

let queue: Promise<unknown> = Promise.resolve();

export interface WebShot {
  /** strips of WEB_TILE px, top to bottom */
  tiles: Buffer[];
  width: number;
  height: number;
  title: string;
  finalUrl: string;
}

export function captureWebPage(raw: string): Promise<WebShot> {
  const url = normalizeWebUrl(raw);
  if (!url) return Promise.reject(new AppError("WEB_URL", "Link trang web không hợp lệ (cần http/https, địa chỉ công khai).", 400));
  // never let one stuck page block the queue: past 60 s give up and start a fresh browser
  const run = queue.then(() =>
    Promise.race([
      capture(url),
      new Promise<never>((_, x) =>
        setTimeout(() => {
          void resetBrowser();
          x(new AppError("WEB_FETCH", "Trang mở quá lâu, thử lại sau nhé.", 504));
        }, 60_000),
      ),
    ]),
  );
  queue = run.catch(() => undefined);
  return run;
}

async function capture(url: string): Promise<WebShot> {
  if (!(await publicHost(new URL(url).hostname))) throw new AppError("WEB_URL", "Không mở trang này được: địa chỉ không công khai.", 400);
  const b = await browser();
  const ctx = await b.createBrowserContext();
  const page = await ctx.newPage();
  const timer = setTimeout(() => void page.close().catch(() => {}), 58_000); // just before the 60 s limit
  try {
    await page.setViewport({ width: WIDTH, height: 800, deviceScaleFactor: 1 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 SanKhauOnline-Screen");
    await page.setExtraHTTPHeaders({ "Accept-Language": "vi,en;q=0.8" });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      void (async () => {
        try {
          const u = new URL(req.url());
          if (u.protocol === "data:" || u.protocol === "blob:") return req.continue();
          if ((u.protocol !== "https:" && u.protocol !== "http:") || !(await publicHost(u.hostname))) return req.abort("blockedbyclient");
          if (["media", "websocket", "eventsource"].includes(req.resourceType())) return req.abort("blockedbyclient");
          return req.continue();
        } catch {
          return req.abort("blockedbyclient").catch(() => {});
        }
      })();
    });
    const resp = await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 }).catch(async (e) => {
      // slow pages: take what has loaded
      if (String(e).includes("timeout")) return null;
      throw e;
    });
    if (resp && resp.status() >= 400) throw new AppError("WEB_FETCH", `Trang trả về lỗi ${resp.status()}.`, 502);
    if (!(await publicHost(new URL(page.url()).hostname))) throw new AppError("WEB_URL", "Trang chuyển hướng tới địa chỉ không công khai.", 400);
    // walk down once so lazy pictures load, then back to the top
    await page.evaluate(async (max) => {
      const step = window.innerHeight * 0.9;
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
    }, WEB_MAX_H);
    const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, document.scrollingElement?.scrollHeight ?? 0));
    const height = Math.min(WEB_MAX_H, Math.max(450, full));
    const tiles: Buffer[] = [];
    for (let y = 0; y < height; y += WEB_TILE)
      tiles.push(Buffer.from(await page.screenshot({ type: "jpeg", quality: 72, clip: { x: 0, y, width: WIDTH, height: Math.min(WEB_TILE, height - y) }, captureBeyondViewport: true })));
    const title = (await page.title().catch(() => "")).slice(0, 200);
    return { tiles, width: WIDTH, height, title, finalUrl: page.url() };
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error("[webshot]", url, String(e).slice(0, 300));
    // the browser may be gone (crashed / closed): start a fresh one next time
    if (/Target closed|Session closed|Connection closed|Protocol error/i.test(String(e))) void resetBrowser();
    throw new AppError("WEB_FETCH", "Không mở được trang này (trang chặn, quá chậm hoặc không tồn tại).", 502);
  } finally {
    clearTimeout(timer);
    await Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  }
}
