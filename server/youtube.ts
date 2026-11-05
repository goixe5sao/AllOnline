/**
 * Title and length of a YouTube video, read from its public watch page (no API key; same
 * "unofficial source" approach as the market data). Used so the SERVER knows when a video ends
 * (loop / next in playlist keep working when the owner's tab is closed, and no viewer can skip a
 * video by faking an "ended" event) and to show titles in the owner's playlist.
 *
 * Cached per video id; failures are cached briefly and return null (callers fall back).
 */
export interface VideoInfo {
  title: string;
  durationSec: number;
}

const OK_TTL = 6 * 3600_000;
const FAIL_TTL = 10 * 60_000;
const cache = new Map<string, { at: number; info: VideoInfo | null }>();
const inflight = new Map<string, Promise<VideoInfo | null>>();

/** Extract the video details from a watch page (exported for tests). */
export function parseWatchPage(html: string): VideoInfo | null {
  const len = html.match(/"lengthSeconds":"(\d+)"/);
  if (!len) return null;
  const durationSec = Number(len[1]);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  let title = "";
  const t = html.match(/"videoDetails":\{[^{}]*?"title":"((?:[^"\\]|\\.)*)"/);
  if (t) {
    try {
      title = JSON.parse(`"${t[1]}"`);
    } catch {
      title = t[1];
    }
  }
  return { title: title.slice(0, 200), durationSec };
}

async function fetchInfo(id: string): Promise<VideoInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=vi`, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SanKhauOnline/1.0", "Accept-Language": "vi,en;q=0.8" },
    });
    if (!r.ok) return null;
    return parseWatchPage(await r.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getVideoInfo(id: string): Promise<VideoInfo | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.info ? OK_TTL : FAIL_TTL)) return hit.info;
  let p = inflight.get(id);
  if (!p) {
    p = fetchInfo(id).then((info) => {
      cache.set(id, { at: Date.now(), info });
      inflight.delete(id);
      return info;
    });
    inflight.set(id, p);
  }
  return p;
}

/** Length if already known (never waits); starts a lookup otherwise. undefined = not known yet. */
export function knownDuration(id: string): number | null | undefined {
  const hit = cache.get(id);
  if (hit) return hit.info?.durationSec ?? null;
  void getVideoInfo(id);
  return undefined;
}
