/**
 * StockVN as an analysis service (owner's choice "B"): AllOnline does NOT re-implement the
 * trendline / channel / support-resistance / candle-pattern / breakout / multi-timeframe logic.
 * It calls StockVN's `/api/ai/replay` (server-to-server, StockVN has no auth so it must stay
 * private), caches the result, and converts the LATEST replay state into a time-based overlay that
 * the stage chart draws exactly like StockVN's backtest page. When StockVN improves its analysis,
 * AllOnline picks it up automatically.
 *
 * Display helpers below mirror StockVN `src/lib/backtest/playback.ts` (linesAt, lineSeries,
 * levelsAt, markerStyle) — keep them in sync if StockVN changes how it draws.
 */
import type { ChartInterval } from "@/core/market";
import type { AnalysisLayer, AnalysisOverlay, OverlayMarker } from "@/core/analysis";

// ---------- StockVN replay payload (subset of StockVN src/lib/backtest/types.ts) ----------

type ReplayLine = { kind: "resistance" | "support" | "channel_upper" | "channel_lower"; trend: string; touches: number; from: number; from_value: number; to: number; to_value: number };
type ReplayLevel = { kind: "resistance" | "support"; price: number; touches: number };
type ReplayMarker = { i: number; kind: "pattern" | "confirmed_up" | "confirmed_down" | "panic_down" | "mtf_up" | "mtf_down"; text: string; direction: number; neutral?: boolean };
export interface ReplayResult {
  mode: "replay";
  symbol: string;
  interval: string;
  source: string;
  bars: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  frames: { i: number; lines: ReplayLine[] }[];
  level_frames?: { i: number; levels: ReplayLevel[] }[];
  markers: ReplayMarker[];
}

/** AllOnline interval → StockVN replay interval (others are not provided by StockVN). */
export const STOCKVN_INTERVAL: Partial<Record<ChartInterval, "1m" | "5m" | "15m" | "1d">> = { "1": "1m", "5": "5m", "15": "15m", D: "1d" };
/** Calendar days of history requested per interval (enough context for ~120 visible bars). */
const RANGE_DAYS: Record<"1m" | "5m" | "15m" | "1d", number> = { "1m": 2, "5m": 4, "15m": 8, "1d": 200 };

const LINE_LABELS: Record<ReplayLine["kind"], string> = {
  resistance: "Trendline kháng cự",
  support: "Trendline hỗ trợ",
  channel_upper: "Cạnh trên kênh",
  channel_lower: "Cạnh dưới kênh",
};

function linesAt(r: ReplayResult, t: number): ReplayLine[] {
  let lines: ReplayLine[] = [];
  for (const f of r.frames) {
    if (f.i > t) break;
    lines = f.lines;
  }
  return lines;
}

function levelsAt(r: ReplayResult, t: number): ReplayLevel[] {
  let levels: ReplayLevel[] = [];
  for (const f of r.level_frames ?? []) {
    if (f.i > t) break;
    levels = f.levels;
  }
  return levels;
}

/** Straight line in log(price) per bar index, from the anchor to bar t (as StockVN draws it). */
function lineSeries(line: ReplayLine, t: number): { index: number; value: number }[] {
  if (line.to <= line.from || line.from_value <= 0 || line.to_value <= 0 || t < line.from) return [];
  const l0 = Math.log(line.from_value);
  const step = (Math.log(line.to_value) - l0) / (line.to - line.from);
  const out: { index: number; value: number }[] = [];
  for (let i = line.from; i <= t; i++) out.push({ index: i, value: Math.round(Math.exp(l0 + step * (i - line.from)) * 100) / 100 });
  return out;
}

function markerStyle(m: ReplayMarker): Pick<OverlayMarker, "position" | "shape" | "color" | "size"> {
  switch (m.kind) {
    case "confirmed_up":
      return { position: "belowBar", shape: "arrowUp", color: "#0b8f4d", size: 1.6 };
    case "confirmed_down":
      return { position: "aboveBar", shape: "arrowDown", color: "#d6336c", size: 1.6 };
    case "panic_down":
      return { position: "aboveBar", shape: "square", color: "#e8590c", size: 1.3 };
    case "mtf_up":
      return { position: "belowBar", shape: "arrowUp", color: "#7048e8", size: 2.2 };
    case "mtf_down":
      return { position: "aboveBar", shape: "arrowDown", color: "#7048e8", size: 2.2 };
    default:
      if (m.direction > 0) return { position: "belowBar", shape: "circle", color: "#099268", size: 0.7 };
      if (m.direction < 0) return { position: "aboveBar", shape: "circle", color: "#c92a2a", size: 0.7 };
      return { position: "aboveBar", shape: "circle", color: "#868e96", size: 0.5 };
  }
}

function markerLayer(m: ReplayMarker): AnalysisLayer {
  if (m.kind === "pattern") return m.neutral ? "common" : "patterns";
  if (m.kind === "mtf_up" || m.kind === "mtf_down") return "mtf";
  return "breaks";
}

/** StockVN bar time → epoch seconds as AllOnline stores it (minute: UTC instant; day: 00:00 UTC of the VN date). */
export function barTime(time: string): number {
  if (time.includes("T")) return Math.floor(Date.parse(time) / 1000);
  const [y, m, d] = time.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

/** Converts the latest replay state into a time-based overlay. Pure; unit-tested. */
export function toOverlay(r: ReplayResult, interval: ChartInterval): AnalysisOverlay {
  const t = r.bars.length - 1;
  const times = r.bars.map((b) => barTime(b.time));
  return {
    symbol: r.symbol,
    interval,
    source: `StockVN · ${r.source}`,
    asOf: times[t] ?? 0,
    lines: linesAt(r, t).map((line) => ({
      kind: line.kind,
      layer: line.kind.startsWith("channel") ? "channel" : "trendlines",
      label: `${LINE_LABELS[line.kind]} (${line.trend}, ${line.touches} điểm chạm)`,
      dashed: line.kind.startsWith("channel"),
      points: lineSeries(line, t)
        .filter((p) => times[p.index] !== undefined)
        .map((p) => ({ time: times[p.index], value: p.value })),
    })),
    levels: levelsAt(r, t).map((l) => ({ kind: l.kind, price: l.price, touches: l.touches })),
    markers: r.markers
      .filter((m) => m.i <= t && times[m.i] !== undefined)
      .map((m) => ({ time: times[m.i], text: m.text, layer: markerLayer(m), ...markerStyle(m) }))
      .sort((a, b) => a.time - b.time),
  };
}

// ---------- service with cache ----------

export type AnalysisResult = { available: true; overlay: AnalysisOverlay } | { available: false; reason: string };

function vnDate(ms: number) {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

export class StockVnAnalysis {
  private cache = new Map<string, { at: number; value: AnalysisResult }>();
  private inflight = new Map<string, Promise<AnalysisResult>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private baseUrl: string | undefined,
    private ttlMs = 60_000,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get configured() {
    return !!this.baseUrl;
  }

  /**
   * Stale-while-revalidate: returns the cached overlay immediately (refreshing in the background
   * when older than the TTL); only the very first request for a symbol/interval waits.
   */
  async get(symbol: string, interval: ChartInterval): Promise<AnalysisResult> {
    if (!this.baseUrl) return { available: false, reason: "Chưa kết nối dịch vụ phân tích StockVN (STOCKVN_URL)." };
    const sv = STOCKVN_INTERVAL[interval];
    if (!sv) return { available: false, reason: "Lớp phân tích StockVN có ở khung 1p, 5p, 15p và Ngày." };
    const key = `${symbol}|${sv}`;
    const hit = this.cache.get(key);
    const fresh = hit && Date.now() - hit.at < this.ttlMs;
    if (hit && !fresh) void this.refresh(key, symbol, interval, sv).catch(() => undefined);
    if (hit) return hit.value;
    return this.refresh(key, symbol, interval, sv);
  }

  private refresh(key: string, symbol: string, interval: ChartInterval, sv: "1m" | "5m" | "15m" | "1d"): Promise<AnalysisResult> {
    const running = this.inflight.get(key);
    if (running) return running;
    // StockVN runs Python per request: one computation at a time keeps the host responsive.
    const job = this.queue.then(() => this.fetchOverlay(symbol, interval, sv));
    this.queue = job.catch(() => undefined);
    const p = job
      .then((value) => {
        // Errors are cached briefly too, so a down service is not hammered.
        this.cache.set(key, { at: value.available ? Date.now() : Date.now() - this.ttlMs + 15_000, value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fetchOverlay(symbol: string, interval: ChartInterval, sv: "1m" | "5m" | "15m" | "1d"): Promise<AnalysisResult> {
    const now = Date.now();
    const qs = new URLSearchParams({ symbol, interval: sv, from: vnDate(now - RANGE_DAYS[sv] * 86400_000), to: vnDate(now) });
    try {
      const res = await this.fetchImpl(`${this.baseUrl!.replace(/\/$/, "")}/api/ai/replay?${qs}`, { signal: AbortSignal.timeout(150_000) });
      const body = (await res.json().catch(() => null)) as (ReplayResult & { error?: string }) | null;
      if (!res.ok || !body || body.error) return { available: false, reason: `StockVN: ${body?.error ?? "HTTP " + res.status}` };
      if (body.mode !== "replay" || !Array.isArray(body.bars) || !body.bars.length) return { available: false, reason: "StockVN chưa có dữ liệu cho mã này." };
      return { available: true, overlay: toOverlay(body, interval) };
    } catch (e) {
      return { available: false, reason: `Không gọi được StockVN (${(e as Error).name === "TimeoutError" ? "quá thời gian" : "không kết nối"}).` };
    }
  }
}
