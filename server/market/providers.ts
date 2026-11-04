/**
 * UNOFFICIAL Vietnamese market data endpoints (TradingView-UDF-like JSON: t/o/h/l/c/v arrays).
 * Used at the project owner's request until a licensed feed is contracted. They can change or
 * block without notice and their terms may not allow commercial use — hence the fallback chain,
 * the source label shown on the chart, and the MarketDataProvider abstraction.
 */
import type { Candle } from "@/core/market";

export type Resolution = "1" | "D";

export interface UpstreamSource {
  id: string;
  label: string;
  fetch(symbol: string, resolution: Resolution, from: number, to: number): Promise<Candle[]>;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

export const INDEX_SYMBOLS = new Set(["VNINDEX", "VN30", "VN100", "VNMID", "VNSML", "VNALL", "HNXINDEX", "HNX30", "UPCOMINDEX", "VNXALL"]);

interface Udf {
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
}

function parseUdf(x: Udf | undefined): Candle[] {
  if (!x?.t?.length || !x.o || !x.h || !x.l || !x.c) return [];
  const out: Candle[] = [];
  for (let i = 0; i < x.t.length; i++) {
    const c = { time: Number(x.t[i]), open: Number(x.o[i]), high: Number(x.h[i]), low: Number(x.l[i]), close: Number(x.c[i]), volume: Number(x.v?.[i] ?? 0) };
    if ([c.time, c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low) out.push(c);
  }
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const entrade: UpstreamSource = {
  id: "entrade",
  label: "DNSE/Entrade (API không chính thức)",
  async fetch(symbol, resolution, from, to) {
    const kind = INDEX_SYMBOLS.has(symbol) ? "index" : "stock";
    const res = resolution === "D" ? "1D" : "1";
    return parseUdf((await getJson(`https://services.entrade.com.vn/chart-api/v2/ohlcs/${kind}?symbol=${encodeURIComponent(symbol)}&resolution=${res}&from=${from}&to=${to}`)) as Udf);
  },
};

export const ssi: UpstreamSource = {
  id: "ssi",
  label: "SSI iBoard (API không chính thức)",
  async fetch(symbol, resolution, from, to) {
    const res = resolution === "D" ? "1D" : "1";
    const d = (await getJson(`https://iboard-api.ssi.com.vn/statistics/charts/history?resolution=${res}&symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`)) as { data?: Udf };
    return parseUdf(d.data);
  },
};

export const vps: UpstreamSource = {
  id: "vps",
  label: "VPS (API không chính thức)",
  async fetch(symbol, resolution, from, to) {
    return parseUdf((await getJson(`https://histdatafeed.vps.com.vn/tradingview/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`)) as Udf);
  },
};

export const SOURCES: UpstreamSource[] = [entrade, ssi, vps];

/** Vietnam is UTC+7 with no DST. */
export const VN_OFFSET_SEC = 7 * 3600;

/** 00:00 UTC of the Vietnam calendar date containing `t` (so daily bars are labelled by VN date). */
export function vnDayKey(t: number): number {
  return Math.floor((t + VN_OFFSET_SEC) / 86400) * 86400;
}
