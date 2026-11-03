/**
 * Market data integration layer for the candlestick screen.
 * Only a DEMO provider exists today; it is labelled as demo everywhere it is shown.
 * A real provider (e.g. a licensed VN market data API) must implement MarketDataProvider
 * and be called from the server so API keys never reach the browser.
 */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface MarketDataProvider {
  readonly isDemo: boolean;
  candles(symbol: string, count: number, nowMs: number): Candle[];
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rand(seed: number) {
  let x = seed || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

/** Deterministic per symbol + minute, so every viewer sees the same demo chart. */
export const demoProvider: MarketDataProvider = {
  isDemo: true,
  candles(symbol, count, nowMs) {
    const minute = Math.floor(nowMs / 60_000);
    const base = 800 + (hash(symbol) % 900);
    const out: Candle[] = [];
    let price = base;
    for (let i = minute - 400; i <= minute; i++) {
      const r1 = rand(hash(symbol) ^ i);
      const r2 = rand((hash(symbol) * 31) ^ i);
      const o = price;
      const c = Math.max(1, o * (1 + (r1 - 0.5) * 0.012));
      const h = Math.max(o, c) * (1 + r2 * 0.004);
      const l = Math.min(o, c) * (1 - r2 * 0.004);
      price = c;
      if (i > minute - count) out.push({ t: i * 60_000, o, h, l, c });
    }
    return out;
  },
};
