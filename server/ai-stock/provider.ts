import { z } from "zod";
import { stockPickSchema, stockScanSchema, type StockScan } from "@/core/ai-stock";

// Synthetic examples only. Never represented as a historical backtest or current prices.
export const STOCK_FIXTURE: StockScan = stockScanSchema.parse({
  asOf: "2026-11-09T07:30:00Z", universe: "VN100", dataDelayMin: 1,
  picks: ["FPT", "HPG", "VCB", "SSI", "MWG", "VHM", "TCB", "VNM"].map((symbol, i) => ({
    symbol, score: Number((0.82 - i * 0.03).toFixed(2)), rank: i + 1, bias: i % 3 === 1 ? "down" : "up", price: 132.5 - i * 10, changePct: Number((1.2 - i * 0.3).toFixed(2)),
    levels: { support: [128 - i * 10], resistance: [136.4 - i * 10], poc: 129.1 - i * 10, vwap: 130.2 - i * 10, kijun: 128.8 - i * 10, valueArea: [125 - i * 10, 133 - i * 10] },
    signals: [{ type: "poc_breakout", direction: "up", date: "2026-11-06", level: 129.1 - i * 10, volumeRatio: 1.8, ...(i === 0 ? { baseRate: 0.5, stats: { horizon: 10, hitRate: 0.63, n: 214, ci95: [0.56, 0.69], tier: "EVIDENCE", outcome: "Ví dụ EVIDENCE giả lập" } } : {}) },
      { type: "pattern:ascending_triangle", direction: "up", date: "2026-11-06", level: 136.4 - i * 10, volumeRatio: 1.5 }],
    overlays: { lines: [{ label: "Hỗ trợ", points: [{ time: 1791244800, value: 126 - i * 10 }, { time: 1793923200, value: 128 - i * 10 }] }], zones: [], patterns: [{ label: "Tam giác tăng (mẫu)", points: [{ time: 1791244800, value: 136.4 - i * 10 }, { time: 1793923200, value: 136.4 - i * 10 }, { time: 1791244800, value: 126 - i * 10 }] }] },
  })),
});
export interface ScanProvider { fixture: boolean; scan(): Promise<StockScan> }
export class FixtureScanProvider implements ScanProvider {
  fixture = true;
  constructor(private demo = false) {}
  async scan() {
    const scan = structuredClone(STOCK_FIXTURE);
    if (!this.demo) for (const pick of scan.picks) for (const signal of pick.signals) {
      delete signal.stats;
      delete signal.baseRate;
    }
    return scan;
  }
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
    const scan = mapStockVnScan(await r.json());
    this.cached = { at: Date.now(), scan };
    return scan;
  }
}

const rawSignal = stockPickSchema.shape.signals.element.omit({ type: true }).extend({ method: z.string() });
const rawItem = stockPickSchema.omit({ score: true, rank: true, bias: true, signals: true, overlays: true, levels: true }).extend({
  date: z.string(), score: z.unknown().optional(), rank: z.number().int().positive().optional(),
  levels: stockPickSchema.shape.levels,
  signals: z.array(rawSignal), overlays: z.unknown().optional(),
});
const timedGeometry = stockPickSchema.shape.overlays.shape.patterns.element;
/** Legacy bar indexes cannot be converted to timestamps without a candle series. */
function mapOverlays(raw: unknown) {
  const result: StockScan["picks"][number]["overlays"] = { lines: [], zones: [], patterns: [] };
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const label = typeof entry.method === "string" ? entry.method : "Mô hình";
      const pattern = timedGeometry.safeParse({ label, points: entry.points });
      if (pattern.success && pattern.data.points.length >= 2) result.patterns.push(pattern.data);
      const boundary = timedGeometry.safeParse({ label, points: entry.boundary });
      if (boundary.success && boundary.data.points.length >= 2) result.lines.push(boundary.data);
    }
  } else if (raw && typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    for (const key of ["lines", "zones", "patterns"] as const) {
      const entries = Array.isArray(object[key]) ? object[key] : [];
      for (const entry of entries) {
        const parsed = stockPickSchema.shape.overlays.shape[key].element.safeParse(entry);
        if (parsed.success) (result[key] as unknown[]).push(parsed.data);
      }
    }
  }
  return result;
}
export function mapStockVnScan(input: unknown): StockScan {
  // Retain compatibility with already normalized snapshots.
  if (input && typeof input === "object" && "picks" in input) return stockScanSchema.parse(input);
  const raw = z.object({ asOf: z.string().datetime({ offset: true }), universe: z.literal("VN100"),
    dataDelayMin: z.number().nonnegative().default(0), items: z.array(rawItem).min(1).max(100) }).parse(input);
  return stockScanSchema.parse({ ...raw, asOf: new Date(raw.asOf).toISOString(), picks: raw.items.map((item, i) => {
    const directions = new Set(item.signals.map(s => s.direction));
    return { ...item, score: typeof item.score === "number" ? item.score : (raw.items.length - i) / raw.items.length,
      rank: item.rank ?? i + 1, bias: directions.size === 1 ? item.signals[0].direction : "neutral",
      signals: item.signals.map(({ method, ...signal }) => ({ ...signal, type: method })), overlays: mapOverlays(item.overlays) };
  }) });
}
