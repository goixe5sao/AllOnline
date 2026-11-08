import { stockScanSchema, type StockScan } from "@/core/ai-stock";

// Synthetic examples only. Never represented as a historical backtest or current prices.
export const STOCK_FIXTURE: StockScan = stockScanSchema.parse({
  asOf: "2026-11-09T07:30:00Z", universe: "VN100", dataDelayMin: 1,
  picks: ["FPT", "HPG", "VCB", "SSI", "MWG", "VHM", "TCB", "VNM"].map((symbol, i) => ({
    symbol, score: Number((0.82 - i * 0.03).toFixed(2)), rank: i + 1, bias: i % 3 === 1 ? "down" : "up", price: 132.5 - i * 10, changePct: Number((1.2 - i * 0.3).toFixed(2)),
    levels: { support: [128 - i * 10], resistance: [136.4 - i * 10], poc: 129.1 - i * 10, vwap: 130.2 - i * 10, kijun: 128.8 - i * 10, valueArea: [125 - i * 10, 133 - i * 10] },
    signals: [{ type: "poc_breakout", direction: "up", date: "2026-11-06", level: 129.1 - i * 10, volumeRatio: 1.8, stats: { horizon: 10, hitRate: 0.63, n: 214, ci95: [0.56, 0.69], avgReturnPct: 3.1 } },
      { type: "pattern:ascending_triangle", direction: "up", date: "2026-11-06", level: 136.4 - i * 10, volumeRatio: 1.5, stats: { horizon: 5, hitRate: 0.58, n: 120, ci95: [0.49, 0.67], avgReturnPct: 1.4 } }],
    overlays: { lines: [{ label: "Hỗ trợ", points: [{ time: 1791244800, value: 126 - i * 10 }, { time: 1793923200, value: 128 - i * 10 }] }], zones: [], patterns: [{ label: "Tam giác tăng (mẫu)", points: [{ time: 1791244800, value: 136.4 - i * 10 }, { time: 1793923200, value: 136.4 - i * 10 }, { time: 1791244800, value: 126 - i * 10 }] }] },
  })),
});
export interface ScanProvider { fixture: boolean; scan(): Promise<StockScan> }
export class FixtureScanProvider implements ScanProvider {
  fixture = true;
  async scan() { return structuredClone(STOCK_FIXTURE); }
}
/** Opt-in only after S-3 is available; no silent substitution of fixture for real data. */
export class StockVnScanProvider implements ScanProvider {
  fixture = false;
  private cached?: { at: number; scan: StockScan };
  constructor(private url: string, private token: string) {}
  async scan(): Promise<StockScan> {
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.scan;
    const url = new URL("/api/ai/scan?universe=VN100", this.url);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("Không tải được bản quét AI Stock.");
    const scan = stockScanSchema.parse(await r.json());
    this.cached = { at: Date.now(), scan };
    return scan;
  }
}
