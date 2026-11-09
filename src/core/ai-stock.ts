import { z } from "zod";

const point = z.object({ time: z.number().finite(), value: z.number().finite() });
export const stockLevelsSchema = z.union([z.number().finite(), z.null(), z.array(z.number().finite())])
  .transform(v => v === null ? [] : typeof v === "number" ? [v] : v);
export const stockPickSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9.]{1,12}$/), score: z.number().min(0).max(1), rank: z.number().int().positive(),
  bias: z.enum(["up", "down", "neutral"]), price: z.number().positive(), changePct: z.number().finite(),
  levels: z.object({ support: stockLevelsSchema, resistance: stockLevelsSchema, poc: z.number().nullable(), vwap: z.number().nullable(), kijun: z.number().nullable(), valueArea: z.tuple([z.number(), z.number()]).nullable() }),
  signals: z.array(z.object({ type: z.string(), direction: z.enum(["up", "down"]), date: z.string(), level: z.number().nullable(), volumeRatio: z.number(), stats: z.object({ horizon: z.number().int().positive(), hitRate: z.number().min(0).max(1), n: z.number().int().positive(), ci95: z.tuple([z.number(), z.number()]), tier: z.enum(["PASS", "EVIDENCE"]), outcome: z.string().optional(), avgReturnPct: z.number().optional() }).optional(), baseRate: z.number().min(0).max(1).optional() })),
  overlays: z.object({ lines: z.array(z.object({ label: z.string(), points: z.array(point) })), zones: z.array(z.object({ label: z.string(), low: z.number(), high: z.number(), from: z.number(), to: z.number() })), patterns: z.array(z.object({ label: z.string(), points: z.array(point) })) }),
});
export const stockScanSchema = z.object({ asOf: z.string().datetime(), universe: z.literal("VN100"), dataDelayMin: z.number().nonnegative(), picks: z.array(stockPickSchema).min(1).max(100) });
export type StockPick = z.infer<typeof stockPickSchema>;
export type StockScan = z.infer<typeof stockScanSchema>;
export function stockMethodLabel(method: string): string {
  const patterns: Record<string, string> = { double_top: "Hai đỉnh", double_bottom: "Hai đáy", head_shoulders: "Vai đầu vai", inverse_head_shoulders: "Vai đầu vai ngược", ascending_triangle: "Tam giác tăng", descending_triangle: "Tam giác giảm", symmetrical_triangle: "Tam giác cân", bullish_marubozu: "Marubozu tăng", bearish_marubozu: "Marubozu giảm", bullish_engulfing: "Nhấn chìm tăng", bearish_engulfing: "Nhấn chìm giảm", hammer: "Búa", shooting_star: "Sao băng", doji: "Doji", morning_star: "Sao mai", evening_star: "Sao hôm" };
  const eq = /^eq_(poc|vwap|kijun)_(confirmed|weak|retest)_(up|down)$/.exec(method);
  if (eq) return `${eq[1].toUpperCase()} · ${{ confirmed: "xác nhận", weak: "yếu", retest: "kiểm tra lại" }[eq[2]]} ${eq[3] === "up" ? "tăng" : "giảm"}`;
  if (method.startsWith("res_touch")) return "Chạm kháng cự";
  if (method.startsWith("sup_touch")) return "Chạm hỗ trợ";
  if (method === "res_break_vol") return "Vượt kháng cự kèm khối lượng";
  if (method === "sup_break_vol") return "Thủng hỗ trợ kèm khối lượng";
  patterns.inverted_hammer = "Búa ngược";
  const legacy: Record<string, string> = { poc_breakout: "Vượt POC", poc_breakdown: "Thủng POC", sr_breakout: "Vượt hỗ trợ / kháng cự", ml_rank: "Xếp hạng mô hình" };
  if (legacy[method]) return legacy[method];
  const name = method.replace(/^(candle_|pat_|pattern:)/, "").replace(/_(up|down)$/, "");
  return `${method.startsWith("candle_") ? "Nến" : "Mô hình"} ${patterns[name] ?? name.replaceAll("_", " ")}${method.endsWith("_up") ? " · tăng" : method.endsWith("_down") ? " · giảm" : ""}`;
}
export function stockStatsLine(s: StockPick["signals"][number]): string | null {
  if (!s.stats) return null;
  return `Lịch sử: ${Number((s.stats.hitRate * 100).toFixed(2))}%${s.baseRate === undefined ? "" : ` · nền ${Number((s.baseRate * 100).toFixed(2))}%`} · ${s.stats.n} lần · ${s.stats.horizon} phiên`;
}
export const STOCK_DISCLAIMER = "Chỉ bình luận thị trường và giáo dục, không phải khuyến nghị mua bán. Đầu tư có rủi ro.";
export interface AiStockContent {
  kind: "ai-stock"; snapshot: StockScan; fixture: boolean; index: number; topN: number; seconds: number;
  paused: boolean; pinned: boolean; nextAt: number; commentary: string;
}
export type AiStockCommand = { action: "ai_stock"; command: "start" | "pause" | "resume" | "skip" | "pin" | "stop"; symbol?: string; topN?: number; seconds?: number };
export function stockFallback(p: StockPick): string {
  const levels = [["POC", p.levels.poc], ["VWAP", p.levels.vwap], ["Kijun", p.levels.kijun]]
    .filter(([, value]) => value !== null).map(([label, value]) => `${label} ${value}`).join(", ");
  return `${p.symbol} có điểm xếp hạng ${p.score}; giá trong ảnh chụp dữ liệu là ${p.price}.${levels ? ` ${levels}.` : ""} ${STOCK_DISCLAIMER}`;
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
