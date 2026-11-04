import { describe, expect, it } from "vitest";
import { StockVnAnalysis, analysisFrom, barTime, toOverlay, type ReplayResult } from "../server/analysis/stockvn";

const replay = (): ReplayResult => ({
  mode: "replay",
  symbol: "VNINDEX",
  interval: "1d",
  source: "VCI",
  bars: ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"].map((time, i) => ({ time, open: 1700 + i, high: 1710 + i, low: 1690 + i, close: 1705 + i, volume: 1e6 })),
  frames: [
    { i: 0, lines: [{ kind: "support", trend: "tăng", touches: 3, from: 0, from_value: 1600, to: 1, to_value: 1610 }] },
    { i: 2, lines: [{ kind: "resistance", trend: "giảm", touches: 4, from: 1, from_value: 1800, to: 3, to_value: 1780 }] },
  ],
  level_frames: [{ i: 3, levels: [{ kind: "support", price: 1650, touches: 5 }] }],
  markers: [
    { i: 1, kind: "pattern", text: "Búa", direction: 1 },
    { i: 2, kind: "pattern", text: "Doji", direction: 0, neutral: true },
    { i: 3, kind: "confirmed_up", text: "Bứt phá kênh", direction: 1 },
    { i: 3, kind: "mtf_up", text: "Break đa khung", direction: 1 },
  ],
});

describe("StockVN replay → overlay", () => {
  it("converts StockVN bar times to AllOnline times", () => {
    expect(barTime("2026-11-04")).toBe(Date.UTC(2026, 10, 4) / 1000);
    expect(barTime("2026-11-04T09:15:00+07:00")).toBe(Date.UTC(2026, 10, 4, 2, 15) / 1000);
  });

  it("uses the LATEST frame (state at the last bar), like StockVN's chart page", () => {
    const o = toOverlay(replay(), "D");
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ kind: "resistance", layer: "trendlines", dashed: false });
    // drawn from the anchor (bar 1) to the last bar (3), straight in log(price) like StockVN
    expect(o.lines[0].points.map((p) => p.time)).toEqual([barTime("2026-11-02"), barTime("2026-11-03"), barTime("2026-11-04")]);
    expect(o.lines[0].points[0].value).toBe(1800);
    expect(o.lines[0].points[2].value).toBe(1780);
    expect(o.levels).toEqual([{ kind: "support", price: 1650, touches: 5 }]);
    expect(o.asOf).toBe(barTime("2026-11-04"));
  });

  it("assigns markers to layers with StockVN's styles", () => {
    const o = toOverlay(replay(), "D");
    expect(o.markers.map((m) => m.layer)).toEqual(["patterns", "common", "breaks", "mtf"]);
    expect(o.markers.find((m) => m.layer === "mtf")).toMatchObject({ shape: "arrowUp", color: "#7048e8" });
  });
});

describe("StockVnAnalysis service", () => {
  it("is disabled without STOCKVN_URL and for intervals StockVN does not provide", async () => {
    expect((await new StockVnAnalysis(undefined).get("VNINDEX", "D")).available).toBe(false);
    const s = new StockVnAnalysis("http://stockvn.local", 60_000, (async () => new Response("{}")) as typeof fetch);
    expect(await s.get("VNINDEX", "60")).toMatchObject({ available: false });
  });

  it("calls StockVN once, caches, and maps the interval/range", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(replay()), { status: 200 });
    }) as typeof fetch;
    const s = new StockVnAnalysis("http://stockvn.local/", 60_000, fake);
    const [a, b] = await Promise.all([s.get("VNINDEX", "D"), s.get("VNINDEX", "D")]);
    expect(a.available && b.available).toBe(true);
    await s.get("VNINDEX", "D");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^http:\/\/stockvn\.local\/api\/ai\/replay\?symbol=VNINDEX&interval=1d&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it("reports StockVN errors and an unreachable service without throwing", async () => {
    const err = new StockVnAnalysis("http://x", 60_000, (async () => new Response(JSON.stringify({ error: "Mã chưa có dữ liệu" }), { status: 400 })) as typeof fetch);
    expect(await err.get("ABC", "D")).toEqual({ available: false, reason: "StockVN: Mã chưa có dữ liệu" });
    const down = new StockVnAnalysis("http://x", 60_000, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(await down.get("ABC", "D")).toMatchObject({ available: false });
  });
});

describe("price units", () => {
  it("stock prices from StockVN (VND) are converted to AllOnline's thousand VND; indices unchanged", () => {
    const r = { ...replay(), symbol: "HPG" };
    r.level_frames = [{ i: 3, levels: [{ kind: "resistance", price: 22555.61, touches: 4 }] }];
    const o = toOverlay(r, "D");
    expect(o.levels[0].price).toBeCloseTo(22.556, 3);
    expect(o.lines[0].points[0].value).toBeCloseTo(1.8, 3);
    expect(toOverlay(replay(), "D").levels[0].price).toBe(1650);
  });
});

describe("analysis range follows the visible candles", () => {
  const now = Date.UTC(2026, 10, 4, 3, 0);
  it("defaults to the recent range; older visible dates round down to the month (daily)", () => {
    expect(analysisFrom("1d", undefined, now)).toBe("2026-04-18");
    expect(analysisFrom("1d", "2026-10-01", now)).toBe("2026-04-18"); // inside default → default
    expect(analysisFrom("1d", "2021-03-17", now)).toBe("2021-03-01");
    expect(analysisFrom("1d", "1999-05-05", now)).toBe("2000-01-01");
    expect(analysisFrom("1m", "2026-11-01", now)).toBe("2026-11-01");
    expect(analysisFrom("1m", "2026-01-01", now)).toBe("2026-10-05"); // intraday: at most 30 days
    expect(analysisFrom("1d", "2021-3-1x", now)).toBe("2026-04-18");
  });

  it("requests StockVN from the visible start and caches per start", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(replay()), { status: 200 });
    }) as typeof fetch;
    const s = new StockVnAnalysis("http://x", 60_000, fake);
    const a = await s.get("VDS", "D", "2020-06-15");
    await s.get("VDS", "D", "2020-06-28");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("from=2020-06-01");
    expect(a.available && a.overlay.from).toBe("2020-06-01");
  });
});
