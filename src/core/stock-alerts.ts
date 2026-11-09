import { z } from "zod";
import { STOCK_DISCLAIMER } from "./ai-stock";

export const alertSchema = z.object({
  id: z.string().min(1).max(150), symbol: z.string().regex(/^[A-Z0-9.]{1,12}$/),
  kind: z.enum(["near_resistance", "near_support", "break_resistance", "break_support", "break_equilibrium_down", "break_equilibrium_up"]),
  beat: z.enum(["intraday", "close"]), level: z.number().positive(), price: z.number().positive(),
  levelType: z.enum(["resistance", "support", "poc", "vwap", "kijun"]),
  candle: z.enum(["shooting_star", "long_upper_wick", "bearish_engulfing", "doji", "hammer", "bullish_engulfing", "close_beyond_with_volume"]).optional(),
  stats: z.object({ horizon: z.number().int().positive(), hitRate: z.number().min(0).max(1), n: z.number().int().positive(), ci95: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]), outcome: z.string().max(120) }).optional(),
  baseRate: z.number().min(0).max(1).optional(), createdAt: z.string().datetime(),
});
export const alertsSchema = z.object({ asOf: z.string().datetime(), alerts: z.array(alertSchema).max(1000) });
export type StockAlert = z.infer<typeof alertSchema>;
export const alertLabel: Record<StockAlert["kind"], string> = { near_resistance: "Gần kháng cự", near_support: "Gần hỗ trợ", break_resistance: "Vượt kháng cự", break_support: "Thủng hỗ trợ", break_equilibrium_down: "Thủng cân bằng", break_equilibrium_up: "Vượt cân bằng" };
export interface AlertFeed { alerts: StockAlert[]; fixture: boolean; asOf: string | null; error?: string }
export function vnSession(iso: string | number) { return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10); }
export function alertKey(a: StockAlert) { return `${vnSession(a.createdAt)}:${a.symbol}:${a.level}:${a.beat}`; }
const candleNames: Record<NonNullable<StockAlert["candle"]>, string> = { shooting_star: "sao băng", long_upper_wick: "bóng trên dài", bearish_engulfing: "nhấn chìm giảm", doji: "doji", hammer: "búa", bullish_engulfing: "nhấn chìm tăng", close_beyond_with_volume: "đóng vượt mức kèm khối lượng" };
export function alertCopy(a: StockAlert) {
  const words = {
    near_resistance: "Gần kháng cự; bạn có thể cân nhắc chốt lời/giảm tỷ trọng, quyết định thuộc về bạn.",
    near_support: "Gần hỗ trợ; bạn tự quyết có mua thăm dò hay không.",
    break_resistance: a.candle === "close_beyond_with_volume" ? "Tín hiệu mạnh, kháng cự cũ thành hỗ trợ; bạn tự quyết định." : "Vượt kháng cự; chưa xác nhận khối lượng, bạn tự quyết định.",
    break_support: "Thủng hỗ trợ; cảnh báo quản trị rủi ro, bạn tự quyết định.",
    break_equilibrium_down: "Thủng cân bằng; cảnh báo quản trị rủi ro, bạn tự quyết định.",
    break_equilibrium_up: "Vượt cân bằng; bạn tự đánh giá và quyết định.",
  };
  const stats = a.stats ? ` Tần suất thực nghiệm ${(a.stats.hitRate * 100).toFixed(0)}% · n=${a.stats.n} · ${a.stats.horizon} phiên · CI 95%: ${(a.stats.ci95[0]*100).toFixed(0)}–${(a.stats.ci95[1]*100).toFixed(0)}% · ${a.stats.outcome}.${a.baseRate === undefined ? "" : ` Tần suất nền ${(a.baseRate*100).toFixed(0)}%.`}` : " Chỉ thông tin giá/mức; chưa có thống kê được duyệt.";
  return `${a.symbol} · Giá ${a.price} · ${a.levelType.toUpperCase()} ${a.level} (nghìn đồng). ${words[a.kind]} ${a.beat === "intraday" ? "Trong phiên: chờ nến kết phiên." : `Kết phiên${a.candle ? ` · Nến ${candleNames[a.candle]}` : ""}.`}${stats}`;
}
export function alertMessage(a: StockAlert, fixture: boolean) { return `${fixture ? "DỮ LIỆU MẪU · Thống kê giả lập\n" : ""}⚠ ${alertCopy(a)}\n${a.createdAt} · Nguồn không chính thức\n${STOCK_DISCLAIMER}`; }
export function fixtureAlerts(now = Date.now()) {
  const date = vnSession(now);
  return alertsSchema.parse({ asOf: new Date(now).toISOString(), alerts: [
    { id: `sample-${date}-fpt`, symbol: "FPT", kind: "near_resistance", beat: "intraday", level: 136.4, levelType: "resistance", price: 135.8, baseRate: .54, createdAt: `${date}T03:00:00Z` },
    { id: `sample-${date}-hpg`, symbol: "HPG", kind: "break_support", beat: "close", level: 118, levelType: "support", price: 117, candle: "bearish_engulfing", stats: { horizon: 10, hitRate: .81, n: 214, ci95: [.75,.86], outcome: "≥3% trong 10 phiên" }, baseRate: .54, createdAt: `${date}T07:45:00Z` },
  ] });
}
