import { z } from "zod";

const point = z.object({ time: z.number().finite(), value: z.number().finite() });
export const stockPickSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,12}$/), score: z.number().min(0).max(1), rank: z.number().int().positive(),
  bias: z.enum(["up", "down", "neutral"]), price: z.number().positive(), changePct: z.number().finite(),
  levels: z.object({ support: z.array(z.number()), resistance: z.array(z.number()), poc: z.number(), vwap: z.number(), kijun: z.number(), valueArea: z.tuple([z.number(), z.number()]) }),
  signals: z.array(z.object({ type: z.string(), direction: z.enum(["up", "down"]), date: z.string(), level: z.number(), volumeRatio: z.number(), stats: z.object({ horizon: z.number().int().positive(), hitRate: z.number().min(0).max(1), n: z.number().int().positive(), ci95: z.tuple([z.number(), z.number()]), avgReturnPct: z.number() }) })),
  overlays: z.object({ lines: z.array(z.object({ label: z.string(), points: z.array(point) })), zones: z.array(z.object({ label: z.string(), low: z.number(), high: z.number(), from: z.number(), to: z.number() })), patterns: z.array(z.object({ label: z.string(), points: z.array(point) })) }),
});
export const stockScanSchema = z.object({ asOf: z.string().datetime(), universe: z.literal("VN100"), dataDelayMin: z.number().nonnegative(), picks: z.array(stockPickSchema).min(1).max(100) });
export type StockPick = z.infer<typeof stockPickSchema>;
export type StockScan = z.infer<typeof stockScanSchema>;
export const STOCK_DISCLAIMER = "Chỉ bình luận thị trường và giáo dục, không phải khuyến nghị mua bán. Đầu tư có rủi ro.";
export interface AiStockContent {
  kind: "ai-stock"; snapshot: StockScan; fixture: boolean; index: number; topN: number; seconds: number;
  paused: boolean; pinned: boolean; nextAt: number; commentary: string;
}
export type AiStockCommand = { action: "ai_stock"; command: "start" | "pause" | "resume" | "skip" | "pin" | "stop"; symbol?: string; topN?: number; seconds?: number };
export function stockFallback(p: StockPick): string {
  return `${p.symbol} có điểm xếp hạng ${p.score}; giá trong ảnh chụp dữ liệu là ${p.price}. POC ${p.levels.poc}, VWAP ${p.levels.vwap}, Kijun ${p.levels.kijun}. ${STOCK_DISCLAIMER}`;
}
/** Pure director: all clients receive the same persisted screen, including late joins. */
export function directStock(c: AiStockContent, command: Exclude<AiStockCommand["command"], "start" | "stop"> | "tick", now: number, symbol?: string): AiStockContent {
  if (command === "tick" && (c.paused || c.pinned || now < c.nextAt)) return c;
  if (command === "pin") {
    const index = c.snapshot.picks.findIndex(p => p.symbol === symbol);
    if (index < 0) return c;
    return { ...c, index, pinned: true, commentary: stockFallback(c.snapshot.picks[index]) };
  }
  if (command === "pause") return { ...c, paused: true };
  if (command === "resume") return { ...c, paused: false, pinned: false, nextAt: now + c.seconds * 1000 };
  const index = (c.index + 1) % Math.min(c.topN, c.snapshot.picks.length);
  return { ...c, index, pinned: false, nextAt: now + c.seconds * 1000, commentary: stockFallback(c.snapshot.picks[index]) };
}
export function startStock(snapshot: StockScan, fixture: boolean, now: number, topN = 8, seconds = 45): AiStockContent {
  return { kind: "ai-stock", snapshot, fixture, index: 0, topN: Math.min(topN, snapshot.picks.length), seconds, paused: false, pinned: false, nextAt: now + seconds * 1000, commentary: stockFallback(snapshot.picks[0]) };
}
