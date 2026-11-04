import { bollinger, demoMarketProvider, ema, rsi, sma } from "@/core/market";
import { describe, expect, it } from "vitest";
import { totalSlots, waitingCapacity, summarizeBudget, canReserve } from "@/core/slots";
import { quoteRoom } from "@/core/pricing";
import { applyScreenAction, BLANK_SCREEN, currentPosition, parseYouTubeId, screenContentSchema } from "@/core/screen";
import { DuplicateFilter, RateLimiter, sanitizeChat } from "@/core/chat";

describe("slot maths", () => {
  it("waiting = floor(official × ratio)", () => {
    expect(waitingCapacity(50, true, 0.2)).toBe(10);
    expect(waitingCapacity(7, true, 0.2)).toBe(1);
    expect(waitingCapacity(4, true, 0.2)).toBe(0);
    expect(waitingCapacity(50, false, 0.2)).toBe(0);
    expect(totalSlots(50, true, 0.2)).toBe(60);
  });

  it("budget 100 with a 60-slot room leaves 40", () => {
    const s = summarizeBudget(100, 60, 0);
    expect(s.remaining).toBe(40);
    expect(canReserve(s, 40)).toBe(true);
    expect(canReserve(s, 41)).toBe(false);
    expect(summarizeBudget(100, 60, 30).remaining).toBe(10);
  });
});

describe("pricing", () => {
  const tiers = [
    { max_capacity: 10, duration_hours: 6, price_vnd: 49000 },
    { max_capacity: 50, duration_hours: 6, price_vnd: 199000 },
    { max_capacity: 50, duration_hours: 12, price_vnd: 319000 },
  ];
  it("uses the smallest tier covering official seats; waiting seats included by default", () => {
    const q = quoteRoom(tiers, 11, 2, 6, 0);
    expect(q.ok && q.quote.amount).toBe(199000);
    expect(q.ok && q.quote.totalSlots).toBe(13);
  });
  it("applies a configured waiting surcharge", () => {
    const q = quoteRoom(tiers, 10, 2, 6, 10);
    expect(q.ok && q.quote.amount).toBe(49000 + 4900);
  });
  it("returns an error when no tier exists", () => {
    expect(quoteRoom(tiers, 60, 0, 6, 0)).toEqual({ ok: false, error: "NO_PRICE_TIER" });
  });
});

describe("screen sync", () => {
  it("late joiners compute the current position from server time", () => {
    let s = applyScreenAction(BLANK_SCREEN, { action: "set", content: { kind: "youtube", videoId: "dQw4w9WgXcQ" } }, 1000);
    s = applyScreenAction(s, { action: "play" }, 2000);
    expect(currentPosition(s, 12_000)).toBeCloseTo(10);
    s = applyScreenAction(s, { action: "pause" }, 7000);
    expect(currentPosition(s, 99_000)).toBeCloseTo(5);
    s = applyScreenAction(s, { action: "seek", positionSec: 42 }, 8000);
    expect(currentPosition(s, 50_000)).toBe(42);
  });
  it("text cannot be 'played'", () => {
    const s = applyScreenAction(BLANK_SCREEN, { action: "set", content: { kind: "text", text: "hi" } }, 0);
    expect(applyScreenAction(s, { action: "play" }, 1).playing).toBe(false);
  });
  it("parses YouTube links", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("rejects non-https media", () => {
    expect(screenContentSchema.safeParse({ kind: "image", url: "http://x.com/a.png" }).success).toBe(false);
    expect(screenContentSchema.safeParse({ kind: "image", url: "javascript:alert(1)" }).success).toBe(false);
    expect(screenContentSchema.safeParse({ kind: "image", url: "https://x.com/a.png" }).success).toBe(true);
  });
});

describe("chat safety", () => {
  it("strips control/bidi characters and limits length", () => {
    expect(sanitizeChat("  hi‮there\u0000  ", 200)).toBe("hithere");
    expect(sanitizeChat("x".repeat(500), 200)).toHaveLength(200);
    expect(sanitizeChat("   ", 200)).toBeNull();
    expect(sanitizeChat(42, 200)).toBeNull();
  });
  it("rate limits bursts", () => {
    const r = new RateLimiter(3, 1000);
    expect([r.take("u", 0), r.take("u", 0), r.take("u", 0), r.take("u", 0)]).toEqual([true, true, true, false]);
    expect(r.take("u", 1000)).toBe(true);
  });
  it("blocks repeated spam", () => {
    const d = new DuplicateFilter(10_000, 2);
    expect([d.allow("u", "a", 0), d.allow("u", "a", 1), d.allow("u", "a", 2)]).toEqual([true, true, false]);
  });
});


describe("market indicators & demo data", () => {
  it("SMA / EMA", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBeCloseTo(2);
    expect(e[4]).toBeCloseTo(4);
  });
  it("Bollinger bands are symmetric around the SMA", () => {
    const b = bollinger([1, 2, 3, 4, 5, 6], 3, 2);
    expect(b[1]).toBeNull();
    expect(b[5]!.mid).toBeCloseTo(5);
    expect(b[5]!.upper - b[5]!.mid).toBeCloseTo(b[5]!.mid - b[5]!.lower);
  });
  it("RSI is 100 on a pure uptrend and stays within 0..100", () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(rsi(up, 14)[29]).toBe(100);
    const zig = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5);
    for (const v of rsi(zig, 14)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(100);
  });
  it("demo candles are deterministic and well-formed", async () => {
    const a = await demoMarketProvider.candles("VNINDEX", "D", 50, 1_800_000_000_000);
    const b = await demoMarketProvider.candles("VNINDEX", "D", 50, 1_800_000_000_000);
    expect(a).toEqual(b);
    expect(a).toHaveLength(50);
    for (const c of a) expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close)), expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    expect(a[1].time - a[0].time).toBe(86400);
  });
});

describe("hourly bell timing", async () => {
  const { hourIndex, vnHourLabel } = await import("@/components/room/bell");
  it("rings on each hh:00 crossing and labels it in Vietnam time", () => {
    const t = Date.UTC(2026, 10, 4, 7, 59, 59); // 14:59:59 in Vietnam
    expect(hourIndex(t + 1000)).toBe(hourIndex(t) + 1);
    expect(hourIndex(t + 1000) * 3_600_000).toBe(Date.UTC(2026, 10, 4, 8, 0, 0));
    expect(vnHourLabel(Date.UTC(2026, 10, 4, 8, 0, 0))).toBe("15:00");
  });
});
