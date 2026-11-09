import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import sample from "./fixtures-stockvn-scan.json";
import { mapStockVnScan, STOCK_FIXTURE, StockVnScanProvider, FixtureScanProvider } from "../server/ai-stock/provider";
import { validCommentary } from "../server/ai-stock/commentary";
import { STOCK_DISCLAIMER, stockMethodLabel } from "@/core/ai-stock";
import { StockSignal } from "@/components/room/ai-stock";

describe("real StockVN scan", () => {
  it("maps the supplied payload through the HTTP provider without fabricated evidence", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(sample)));
    try {
      const scan = await new StockVnScanProvider("http://stockvn.test", "test").scan();
      expect(scan.picks).toHaveLength(sample.items.length);
      expect(scan.picks[0]).toMatchObject({ symbol: "SAB", rank: 1, bias: "up", levels: { support: [42.15], resistance: [43.45] } });
      expect(scan.picks[1].bias).toBe("neutral");
      expect(scan.picks.every(p => p.signals.every(s => !s.stats))).toBe(true);
      expect(scan.picks.every(p => p.overlays.patterns.length === 0)).toBe(true);
      expect(scan.asOf).toBe("2026-11-09T00:40:33.761Z");
    } finally { fetcher.mockRestore(); }
  });
  it("accepts improved stats, null levels, scores and timed geometry; drops unknown shapes", () => {
    const input = structuredClone(sample) as unknown as Record<string, unknown>;
    const item = { ...sample.items[0], levels: { support: null, resistance: null, poc: null, vwap: null, kijun: null, valueArea: null },
      score: 0.91, rank: 7, overlays: [{ method: "double_top", points: [{ time: 1793923200, value: 42 }, { time: 1794009600, value: 43 }] }, { strange: true }] };
    const scan = mapStockVnScan({ ...input, asOf: "2026-11-09T00:40:33Z", dataDelayMin: 15, items: [item] });
    expect(scan).toMatchObject({ dataDelayMin: 15, picks: [{ score: 0.91, rank: 7, levels: { support: [], resistance: [], poc: null } }] });
    expect(scan.picks[0].overlays.patterns).toHaveLength(1);
    expect(mapStockVnScan({ ...input, items: [{ ...item, signals: [] }] }).picks[0].bias).toBe("neutral");
  });
  it("renders no percentage without stats, including changePct or a lone baseRate", () => {
    const scan = mapStockVnScan(sample), pick = scan.picks[0];
    pick.signals[0].baseRate = 0.5;
    const html = renderToStaticMarkup(<StockSignal pick={pick} snapshot={scan} fixture={false}/>);
    expect(html).not.toContain("%");
    expect(html).toContain("VWAP · xác nhận tăng");
    expect(validCommentary(`Giá ${pick.price}%. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
    expect(validCommentary(`50 phần trăm. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
    expect(validCommentary(`Tám mươi %. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
    expect(validCommentary(`1％. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
  });
  it.each(["PASS", "EVIDENCE"] as const)("renders %s evidence and permits only supplied percentages", tier => {
    const scan = mapStockVnScan({ ...sample, items: [{ ...sample.items[0], signals: [{ ...sample.items[0].signals[0], baseRate: 0.5,
      stats: { horizon: 10, hitRate: 0.81, n: 120, ci95: [0.75, 0.86], tier } }] }] });
    const pick = scan.picks[0];
    const html = renderToStaticMarkup(<StockSignal pick={pick} snapshot={scan} fixture={false}/>);
    expect(html).toContain("Lịch sử: 81% · nền 50% · 120 lần · 10 phiên");
    expect(html.includes("Đạt chuẩn 80%")).toBe(tier === "PASS");
    expect(validCommentary(`Lịch sử 81%, nền 50%. ${STOCK_DISCLAIMER}`, pick)).toBe(true);
    expect(validCommentary(`120%. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
    expect(validCommentary(`1%. ${STOCK_DISCLAIMER}`, pick)).toBe(false);
  });
  it("keeps exactly one explicitly synthetic EVIDENCE example in demo only and labels method families", async () => {
    expect((await new FixtureScanProvider().scan()).picks.flatMap(p => p.signals).some(s => s.stats)).toBe(false);
    expect((await new FixtureScanProvider(true).scan()).picks[0].signals[0].stats?.tier).toBe("EVIDENCE");
    expect(STOCK_FIXTURE.picks.flatMap(p => p.signals).filter(s => s.stats)).toHaveLength(1);
    expect(STOCK_FIXTURE.picks[0].signals[0].stats?.tier).toBe("EVIDENCE");
    for (const method of ["candle_bullish_marubozu", "eq_kijun_retest_down", "res_touch_weak", "sup_touch", "res_break_vol", "sup_break_vol", "pat_double_top"]) expect(stockMethodLabel(method)).not.toContain("_");
  });
});
