import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openPglite, type Db } from "../server/db";
import { FULL_HISTORY_FROM, MarketService, STOCK_HISTORY_FROM, aggregate, inVnSession } from "../server/market/service";
import { parseVciSymbols, refreshSymbols, searchSymbols } from "../server/market/symbols";
import { vnDayKey, type UpstreamSource } from "../server/market/providers";
import type { Candle } from "@/core/market";

const bar = (time: number, close: number, volume = 10): Candle => ({ time, open: close - 1, high: close + 2, low: close - 2, close, volume });

describe("market helpers", () => {
  it("VN session: Mon–Fri 08:45–15:15 ICT", () => {
    // 2026-11-04 is a Wednesday. 02:00 UTC = 09:00 ICT.
    expect(inVnSession(Date.UTC(2026, 10, 4, 2, 0))).toBe(true);
    expect(inVnSession(Date.UTC(2026, 10, 4, 9, 0))).toBe(false); // 16:00 ICT
    expect(inVnSession(Date.UTC(2026, 10, 8, 2, 0))).toBe(false); // Sunday
  });

  it("daily keys use the Vietnam calendar date", () => {
    // 2026-11-03 18:00 UTC is already 2026-11-04 01:00 in Vietnam.
    expect(vnDayKey(Date.UTC(2026, 10, 3, 18, 0) / 1000)).toBe(Date.UTC(2026, 10, 4) / 1000);
  });

  it("aggregates 1m bars into 5m OHLCV", () => {
    const t0 = Date.UTC(2026, 10, 4, 2, 0) / 1000;
    const bars = [bar(t0, 10, 1), bar(t0 + 60, 12, 2), bar(t0 + 240, 9, 3), bar(t0 + 300, 11, 4)];
    const out = aggregate(bars, (t) => Math.floor(t / 300) * 300);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ time: t0, open: 9, high: 14, low: 7, close: 9, volume: 6 });
  });
});

describe("MarketService (fake upstreams, real SQL)", () => {
  let db: Db;
  const now = Math.floor(Date.now() / 1000);
  const m1 = Array.from({ length: 30 }, (_, i) => bar(Math.floor(now / 60) * 60 - (29 - i) * 60, 1700 + i));
  const daily = Array.from({ length: 5 }, (_, i) => bar(vnDayKey(now) - (5 - i) * 86400 + 7200, 1650 + i * 10));
  let calls: string[] = [];
  const broken: UpstreamSource = { id: "broken", label: "Broken", fetch: async () => { calls.push("broken"); throw new Error("HTTP 500"); } };
  const good: UpstreamSource = { id: "good", label: "Good (không chính thức)", fetch: async (_s, res) => { calls.push("good:" + res); return res === "1" ? m1 : daily; } };

  beforeEach(async () => {
    db = await openPglite();
    await migrate(db);
    calls = [];
  }, 30_000);

  it("falls back to the next source and stores 1m + daily bars", async () => {
    const svc = new MarketService(db, [broken, good]);
    await svc.syncSymbol("VNINDEX");
    expect(calls).toEqual(["broken", "good:1", "broken", "good:D"]);
    const n = await db.query<{ r: string; n: number }>("select resolution as r, count(*)::int as n from app.market_candles group by 1 order by 1");
    expect(n.rows).toEqual([{ r: "1", n: 30 }, { r: "D", n: 5 }]);
    expect(await svc.lastSourceLabel("VNINDEX")).toBe("Good (không chính thức)");
  });

  it("re-sync is idempotent (upsert, no duplicates)", async () => {
    const svc = new MarketService(db, [good]);
    await svc.syncSymbol("VNINDEX");
    await svc.syncSymbol("VNINDEX");
    const n = await db.query<{ n: number }>("select count(*)::int as n from app.market_candles");
    expect(n.rows[0].n).toBe(35);
  });

  it("daily view = stored daily bars + today's bar rebuilt from 1-minute bars", async () => {
    const svc = new MarketService(db, [good]);
    await svc.syncSymbol("VNINDEX");
    const d = await svc.candles("VNINDEX", "D", 100);
    const todayKey = vnDayKey(now);
    const todays = m1.filter((b) => vnDayKey(b.time) === todayKey);
    expect(d[d.length - 1].time).toBe(todays.length ? todayKey : vnDayKey(daily[daily.length - 1].time));
    if (todays.length) expect(d[d.length - 1].close).toBe(todays[todays.length - 1].close);
    for (let i = 1; i < d.length; i++) expect(d[i].time).toBeGreaterThan(d[i - 1].time);
  });

  it("1m view returns stored bars in time order", async () => {
    const svc = new MarketService(db, [good]);
    await svc.syncSymbol("VNINDEX");
    const one = await svc.candles("VNINDEX", "1", 10);
    expect(one).toHaveLength(10);
    expect(one[9].close).toBe(1729);
  });
});

describe("history depth: stocks from 2024, indices + watchlist full", () => {
  let db: Db;
  const now = Math.floor(Date.now() / 1000);
  let dailyFrom: Record<string, number[]> = {};
  const src: UpstreamSource = {
    id: "rec",
    label: "Rec",
    fetch: async (sym, res, from) => {
      if (res === "D") (dailyFrom[sym] ??= []).push(from);
      return [bar(res === "D" ? vnDayKey(now) - 86400 : Math.floor(now / 60) * 60, 100)];
    },
  };

  beforeEach(async () => {
    db = await openPglite();
    await migrate(db);
    dailyFrom = {};
  }, 30_000);

  it("ordinary stock: daily from 2024-01-01 once, then only recent days", async () => {
    const svc = new MarketService(db, [src]);
    await svc.syncSymbol("FPT");
    await svc.syncSymbol("FPT");
    expect(dailyFrom.FPT[0]).toBe(STOCK_HISTORY_FROM);
    expect(dailyFrom.FPT[1]).toBeGreaterThan(now - 11 * 86400);
    const h = await db.query<{ full_history: boolean; d: string }>("select full_history, daily_from::text as d from app.market_history where symbol = 'FPT'");
    expect(h.rows[0]).toEqual({ full_history: false, d: "2024-01-01" });
  });

  it("indices (seeded) load everything; a stock added to the watchlist is re-backfilled in full", async () => {
    const svc = new MarketService(db, [src]);
    await svc.syncSymbol("HNXINDEX");
    expect(dailyFrom.HNXINDEX[0]).toBe(FULL_HISTORY_FROM);
    await svc.syncSymbol("FPT");
    await db.query("insert into app.market_symbols (symbol, name, exchange, kind) values ('FPT', 'FPT', 'HOSE', 'stock')");
    await db.query("insert into app.market_watchlist (symbol) values ('FPT')");
    await svc.fullSymbols(true);
    await svc.syncSymbol("FPT");
    expect(dailyFrom.FPT).toEqual([STOCK_HISTORY_FROM, FULL_HISTORY_FROM]);
    const h = await db.query<{ full_history: boolean; d: string }>("select full_history, daily_from::text as d from app.market_history where symbol = 'FPT'");
    expect(h.rows[0]).toEqual({ full_history: true, d: "2000-01-01" });
  });

  it("full backfill keeps the source with the longest history", async () => {
    const short: UpstreamSource = { id: "short", label: "S", fetch: async () => [bar(vnDayKey(now) - 86400, 1)] };
    const long: UpstreamSource = { id: "long", label: "L", fetch: async () => [bar(vnDayKey(now) - 2 * 86400, 1), bar(vnDayKey(now) - 86400, 2)] };
    const svc = new MarketService(db, [short, long]);
    await svc.syncSymbol("VN100");
    const n = await db.query<{ n: number }>("select count(*)::int as n from app.market_candles where symbol = 'VN100' and resolution = 'D' and source = 'long'");
    expect(n.rows[0].n).toBe(2);
  });

  it("first chart request for a new symbol waits for its backfill (no DEMO flash)", async () => {
    const svc = new MarketService(db, [src]);
    const d = await svc.candles("HPG", "D", 50);
    expect(d.length).toBeGreaterThan(0);
  });
});

describe("listed symbols", () => {
  it("parses VCI getAll: HOSE/HNX/UPCOM stocks + ETFs only", () => {
    const out = parseVciSymbols([
      { symbol: "fpt", board: "HSX", type: "STOCK", organName: "Công ty Cổ phần FPT" },
      { symbol: "E1VFVN30", board: "HSX", type: "ETF", organName: "Quỹ ETF" },
      { symbol: "CFPT2401", board: "HSX", type: "CW", organName: "Chứng quyền" },
      { symbol: "VN30F1M", board: "DERIVATIVE", type: "FU" },
      { symbol: "AAH", board: "UPCOM", type: "STOCK", organName: "Hợp Nhất" },
    ]);
    expect(out).toEqual([
      { symbol: "AAH", name: "Hợp Nhất", exchange: "UPCOM", kind: "stock" },
      { symbol: "E1VFVN30", name: "Quỹ ETF", exchange: "HOSE", kind: "etf" },
      { symbol: "FPT", name: "Công ty Cổ phần FPT", exchange: "HOSE", kind: "stock" },
    ]);
  });

  it("refresh + search: by code prefix or company name, indices and watchlist first", async () => {
    const db = await openPglite();
    await migrate(db);
    const list = Array.from({ length: 120 }, (_, i) => ({ symbol: `A${String(i).padStart(2, "0")}X`, name: `Công ty ${i}`, exchange: "HOSE", kind: "stock" as const }));
    list.push({ symbol: "VNM", name: "Công ty Cổ phần Sữa Việt Nam (Vinamilk)", exchange: "HOSE", kind: "stock" });
    expect(await refreshSymbols(db, async () => list)).toBe(121);
    expect(await refreshSymbols(db, async () => list)).toBe(0); // fresh for a day
    expect((await searchSymbols(db, "vinamilk"))[0]).toMatchObject({ symbol: "VNM", fullHistory: false });
    await db.query("insert into app.market_watchlist (symbol) values ('A05X')");
    const all = await searchSymbols(db, "", 10);
    expect(all.slice(0, 6).every((h) => h.kind === "index" && h.fullHistory)).toBe(true);
    expect(all[6]).toMatchObject({ symbol: "A05X", watch: true, fullHistory: true });
  }, 30_000);
});

describe("upsert robustness", () => {
  it("duplicate timestamps from a source do not break the upsert", async () => {
    const db = await openPglite();
    await migrate(db);
    const t = vnDayKey(Math.floor(Date.now() / 1000)) - 86400;
    const dup: UpstreamSource = { id: "dup", label: "D", fetch: async () => [bar(t + 3600, 1), bar(t + 7200, 2)] };
    await new MarketService(db, [dup]).syncSymbol("FPT");
    const r = await db.query<{ close: number }>("select close from app.market_candles where symbol = 'FPT' and resolution = 'D'");
    expect(r.rows.map((x) => Number(x.close))).toEqual([2]);
  }, 30_000);
});

describe("full history ordering", () => {
  it("bars before 2001-09-09 (9-digit timestamps) stay in time order", async () => {
    const db = await openPglite();
    await migrate(db);
    const ts = [Date.UTC(2000, 6, 28), Date.UTC(2001, 8, 7), Date.UTC(2001, 8, 10), Date.UTC(2024, 0, 2)].map((x) => x / 1000 - 7 * 3600 + 7200);
    const src: UpstreamSource = { id: "s", label: "S", fetch: async (_s, res) => (res === "D" ? ts.map((t, i) => bar(t, 100 + i)) : []) };
    const svc = new MarketService(db, [src]);
    await svc.syncSymbol("VNINDEX");
    const d = await svc.candles("VNINDEX", "D", 8000);
    expect(d.map((c) => c.close)).toEqual([100, 101, 102, 103]);
  }, 30_000);
});
