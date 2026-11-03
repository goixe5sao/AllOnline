/**
 * Market data layer for the stage chart. The server calls a MarketDataProvider; browsers only
 * ever talk to /api/market/candles (provider keys never reach the client).
 *
 * Only the DEMO provider exists today: deterministic synthetic candles, clearly labelled
 * "DỮ LIỆU DEMO" wherever shown. A licensed Vietnamese market data feed (e.g. SSI FastConnect
 * Data, a broker API, or a paid vendor) should implement MarketDataProvider.
 */
export const CHART_INTERVALS = ["1", "5", "15", "60", "D", "W"] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

export const INTERVAL_LABEL: Record<ChartInterval, string> = { "1": "1p", "5": "5p", "15": "15p", "60": "1g", D: "1N", W: "1T" };
const INTERVAL_SEC: Record<ChartInterval, number> = { "1": 60, "5": 300, "15": 900, "60": 3600, D: 86400, W: 604800 };

export const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const INDICATORS = ["volume", "ma20", "ema50", "bb", "rsi"] as const;
export type Indicator = (typeof INDICATORS)[number];

export interface Candle {
  /** UTC seconds, start of the bar. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResult {
  symbol: string;
  interval: ChartInterval;
  source: string;
  isDemo: boolean;
  candles: Candle[];
}

export interface MarketDataProvider {
  readonly id: string;
  readonly isDemo: boolean;
  candles(symbol: string, interval: ChartInterval, count: number, nowMs: number): Promise<Candle[]>;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rnd(seed: number) {
  let x = seed || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

/** Deterministic per (symbol, interval, bar) so every viewer and every refresh agree. */
export const demoMarketProvider: MarketDataProvider = {
  id: "demo",
  isDemo: true,
  async candles(symbol, interval, count, nowMs) {
    const step = INTERVAL_SEC[interval];
    const last = Math.floor(nowMs / 1000 / step) * step;
    const seed = hash(symbol + "|" + interval);
    const base = symbol === "VNINDEX" ? 1250 : symbol === "VN30" ? 1330 : 20 + (hash(symbol) % 180);
    const vol = interval === "D" || interval === "W" ? 0.012 : 0.003;
    const out: Candle[] = [];
    let price = base;
    // Random walk with mild mean reversion so the series stays plausible.
    for (let i = count + 200; i >= 0; i--) {
      const t = last - i * step;
      const k = Math.floor(t / step);
      const r1 = rnd(seed ^ Math.imul(k, 2654435761));
      const r2 = rnd((seed * 31) ^ Math.imul(k, 40503));
      const r3 = rnd((seed * 17) ^ Math.imul(k, 9301));
      const open = price;
      const drift = (base - price) / base * 0.02;
      const close = Math.max(0.01, open * (1 + (r1 - 0.5) * 2 * vol + drift));
      const high = Math.max(open, close) * (1 + r2 * vol * 0.6);
      const low = Math.min(open, close) * (1 - r3 * vol * 0.6);
      price = close;
      if (i < count) out.push({ time: t, open: round(open), high: round(high), low: round(low), close: round(close), volume: Math.round((0.5 + r2) * (symbol.startsWith("VN") ? 4e8 : 2e6)) });
    }
    return out;
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

// ---------- indicators (pure, unit-testable) ----------

export function sma(values: number[], period: number): (number | null)[] {
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  let prev: number | null = null;
  return values.map((v, i) => {
    if (i < period - 1) return null;
    if (prev === null) prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    else prev = v * k + prev * (1 - k);
    return prev;
  });
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  return values.map((_, i) => {
    const m = mid[i];
    if (m === null) return null;
    const slice = values.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(slice.reduce((a, v) => a + (v - m) ** 2, 0) / period);
    return { mid: m, upper: m + mult * sd, lower: m - mult * sd };
  });
}

export function rsi(values: number[], period = 14): (number | null)[] {
  let gain = 0;
  let loss = 0;
  return values.map((v, i) => {
    if (i === 0) return null;
    const d = v - values[i - 1];
    if (i <= period) {
      gain += Math.max(0, d);
      loss += Math.max(0, -d);
      if (i < period) return null;
      gain /= period;
      loss /= period;
    } else {
      gain = (gain * (period - 1) + Math.max(0, d)) / period;
      loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    }
    return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  });
}
