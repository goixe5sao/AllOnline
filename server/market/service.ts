/**
 * Market data scheduler + store.
 *  - Every minute during the Vietnamese session (Mon–Fri 08:45–15:15 ICT; every 15 min otherwise)
 *    it fetches 1-minute bars and daily bars for watched symbols and upserts them in
 *    app.market_candles. Watched = VNINDEX, VN30 + any symbol a room chart requested in the last hour.
 *  - Charts read from the DB: 1m as stored, 5m/15m/1h aggregated from 1m, D as stored (today's bar
 *    rebuilt from 1m when the daily endpoint lags), W aggregated from D.
 */
import type { Db } from "../db";
import type { Candle, ChartInterval } from "@/core/market";
import { SOURCES, VN_OFFSET_SEC, vnDayKey, type Resolution, type UpstreamSource } from "./providers";

const DEFAULT_SYMBOLS = ["VNINDEX", "VN30"];
/** Forming-bar refresh for symbols on screen (env MARKET_LIVE_MS; owner chose once a minute; min 500 ms). */
const LIVE_POLL_MS = Math.max(500, Number(process.env.MARKET_LIVE_MS ?? 60_000) || 60_000);
const WATCH_TTL_MS = 60 * 60_000;

export interface MarketStatus {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastSource: string | null;
  lastError: string | null;
  watched: string[];
}

export function inVnSession(nowMs: number): boolean {
  const d = new Date(nowMs + VN_OFFSET_SEC * 1000);
  const day = d.getUTCDay();
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && min >= 8 * 60 + 45 && min <= 15 * 60 + 15;
}

export function aggregate(bars: Candle[], bucketOf: (t: number) => number): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const k = bucketOf(b.time);
    const last = out[out.length - 1];
    if (last && last.time === k) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      last.volume += b.volume;
    } else out.push({ ...b, time: k });
  }
  return out;
}

/** Monday 00:00 (VN date key) of the week containing a VN day key. */
const weekKey = (dayKey: number) => {
  const dow = (new Date(dayKey * 1000).getUTCDay() + 6) % 7; // Monday = 0
  return dayKey - dow * 86400;
};

export class MarketService {
  private watch = new Map<string, number>();
  private backfilled = new Set<string>();
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private minuteCount = 0;
  status: MarketStatus = { lastRunAt: null, lastOkAt: null, lastSource: null, lastError: null, watched: [] };

  constructor(
    private db: Db,
    private sources: UpstreamSource[] = SOURCES,
  ) {}

  start() {
    void this.tick(true);
    this.timer = setInterval(() => void this.tick(false), 60_000);
    this.liveTimer = setInterval(() => void this.liveTick(), LIVE_POLL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
  }

  // ---------- live (forming) bars, every second during the session ----------

  private liveTimer: NodeJS.Timeout | null = null;
  private liveDemand = new Map<string, number>();
  private live = new Map<string, { bars: Candle[]; at: number }>();
  private liveBusy = false;
  private liveTurn = 0;

  /** A room is currently showing this symbol: keep its forming bar live for the next 10 s. */
  wantLive(symbol: string) {
    this.liveDemand.set(symbol, Date.now());
  }

  /** Latest 1-minute bars incl. the still-forming one (memory only), or null if stale/none. */
  liveBars(symbol: string): Candle[] | null {
    const l = this.live.get(symbol);
    return l && Date.now() - l.at < Math.max(15_000, 2 * LIVE_POLL_MS + 5_000) ? l.bars : null;
  }

  private async liveTick() {
    const now = Date.now();
    if (this.liveBusy || !inVnSession(now)) return;
    const symbols = [...this.liveDemand].filter(([, at]) => now - at < 10_000).map(([s]) => s);
    if (!symbols.length) return;
    this.liveBusy = true;
    try {
      // Only SSI / VPS return the forming minute; alternate between them to spread the load.
      const live = this.sources.filter((x) => x.id === "ssi" || x.id === "vps");
      const order = this.liveTurn++ % 2 ? [...live].reverse() : live;
      const to = Math.floor(now / 1000) + 60;
      await Promise.all(
        symbols.map(async (sym) => {
          for (const src of order) {
            try {
              const bars = await src.fetch(sym, "1", to - 360, to);
              if (bars.length) {
                this.live.set(sym, { bars: bars.slice(-5), at: Date.now() });
                return;
              }
            } catch {
              /* try the other source */
            }
          }
        }),
      );
    } finally {
      this.liveBusy = false;
    }
  }

  /** Overlay live bars (same timestamps replace stored ones). */
  private withLive(symbol: string, bars: Candle[]): Candle[] {
    const l = this.liveBars(symbol);
    if (!l?.length) return bars;
    const byTime = new Map(bars.map((b) => [b.time, b]));
    for (const b of l) byTime.set(b.time, b);
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  /** A chart asked for this symbol: keep it fresh for the next hour (backfill now if new). */
  touch(symbol: string) {
    const isNew = !this.watch.has(symbol) && !DEFAULT_SYMBOLS.includes(symbol);
    this.watch.set(symbol, Date.now());
    if (isNew && !this.backfilled.has(symbol)) void this.syncSymbol(symbol).catch(() => undefined);
  }

  private watched(now: number) {
    for (const [s, at] of this.watch) if (now - at > WATCH_TTL_MS) this.watch.delete(s);
    return [...new Set([...DEFAULT_SYMBOLS, ...this.watch.keys()])];
  }

  async tick(force: boolean) {
    const now = Date.now();
    this.minuteCount++;
    if (!force && !inVnSession(now) && this.minuteCount % 15 !== 0) return;
    if (this.running) return;
    this.running = true;
    this.status.lastRunAt = new Date(now).toISOString();
    try {
      const symbols = this.watched(now);
      this.status.watched = symbols;
      for (const s of symbols) await this.syncSymbol(s);
      this.status.lastOkAt = new Date().toISOString();
      this.status.lastError = null;
      // Keep 1-minute history bounded (daily bars are kept).
      if (this.minuteCount % 60 === 1) await this.db.query("delete from app.market_candles where resolution = '1' and time < $1", [Math.floor(now / 1000) - 45 * 86400]);
    } catch (e) {
      this.status.lastError = (e as Error).message;
      console.error("[market]", (e as Error).message);
    } finally {
      this.running = false;
    }
  }

  private async fetchWithFallback(symbol: string, res: Resolution, from: number, to: number): Promise<{ bars: Candle[]; source: UpstreamSource | null }> {
    const errors: string[] = [];
    for (const src of this.sources) {
      try {
        const bars = await src.fetch(symbol, res, from, to);
        if (bars.length) return { bars, source: src };
        errors.push(`${src.id}: empty`);
      } catch (e) {
        errors.push(`${src.id}: ${(e as Error).message}`);
      }
    }
    if (errors.length) this.status.lastError = `${symbol}/${res}: ${errors.join("; ")}`;
    return { bars: [], source: null };
  }

  async syncSymbol(symbol: string) {
    const now = Math.floor(Date.now() / 1000);
    const first = !this.backfilled.has(symbol);
    const last1 = Number((await this.db.query<{ m: string | null }>("select max(time)::text as m from app.market_candles where symbol = $1 and resolution = '1'", [symbol])).rows[0].m ?? 0);
    const from1 = first || !last1 ? now - 7 * 86400 : last1 - 10 * 60;
    const fromD = first ? now - 3 * 365 * 86400 : now - 10 * 86400;

    const m1 = await this.fetchWithFallback(symbol, "1", from1, now);
    if (m1.source) await this.upsert(symbol, "1", m1.bars, m1.source.id);
    const dd = await this.fetchWithFallback(symbol, "D", fromD, now);
    if (dd.source) await this.upsert(symbol, "D", dd.bars.map((b) => ({ ...b, time: vnDayKey(b.time) })), dd.source.id);
    if (m1.source || dd.source) {
      this.backfilled.add(symbol);
      this.status.lastSource = (m1.source ?? dd.source)!.label;
    }
  }

  private async upsert(symbol: string, res: Resolution, bars: Candle[], source: string) {
    for (let i = 0; i < bars.length; i += 500) {
      const chunk = bars.slice(i, i + 500);
      await this.db.query(
        `insert into app.market_candles (symbol, resolution, time, open, high, low, close, volume, source)
         select $1, $2, t, o, h, l, c, v, $3
         from unnest($4::bigint[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[]) as x(t, o, h, l, c, v)
         on conflict (symbol, resolution, time) do update
           set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
               volume = excluded.volume, source = excluded.source, updated_at = now()`,
        [symbol, res, source, chunk.map((b) => b.time), chunk.map((b) => b.open), chunk.map((b) => b.high), chunk.map((b) => b.low), chunk.map((b) => b.close), chunk.map((b) => b.volume)],
      );
    }
  }

  private async read(symbol: string, res: Resolution, limit: number): Promise<Candle[]> {
    const rows = (
      await this.db.query<{ time: string; open: number; high: number; low: number; close: number; volume: number }>(
        "select time::text as time, open, high, low, close, volume from app.market_candles where symbol = $1 and resolution = $2 order by time desc limit $3",
        [symbol, res, limit],
      )
    ).rows;
    return rows.reverse().map((r) => ({ time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }));
  }

  async lastSourceLabel(symbol: string): Promise<string | null> {
    const r = (await this.db.query<{ source: string }>("select source from app.market_candles where symbol = $1 order by updated_at desc limit 1", [symbol])).rows[0];
    return r ? (this.sources.find((s) => s.id === r.source)?.label ?? r.source) : null;
  }

  /** Candles for the chart, or [] when nothing has been collected yet. */
  async candles(symbol: string, interval: ChartInterval, count: number): Promise<Candle[]> {
    this.touch(symbol);
    if (interval === "1") return this.withLive(symbol, await this.read(symbol, "1", count)).slice(-count);
    if (interval === "5" || interval === "15" || interval === "60") {
      const size = Number(interval) * 60;
      const bars = this.withLive(symbol, await this.read(symbol, "1", count * Number(interval) + Number(interval)));
      return aggregate(bars, (t) => Math.floor(t / size) * size).slice(-count);
    }
    let daily = await this.read(symbol, "D", interval === "W" ? count * 5 + 5 : count);
    // Today's daily bar from 1-minute bars when the daily endpoint lags behind.
    const today = this.withLive(symbol, await this.read(symbol, "1", 400));
    const todayKey = vnDayKey(Math.floor(Date.now() / 1000));
    const todays = today.filter((b) => vnDayKey(b.time) === todayKey);
    if (todays.length) {
      const agg = aggregate(todays, () => todayKey)[0];
      daily = daily.filter((d) => d.time !== todayKey).concat(agg);
    }
    if (interval === "D") return daily.slice(-count);
    return aggregate(daily, weekKey).slice(-count);
  }
}
