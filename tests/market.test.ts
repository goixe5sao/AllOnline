import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openPglite, type Db } from "../server/db";
import { MarketService, aggregate, inVnSession } from "../server/market/service";
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
