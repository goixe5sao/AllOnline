"use client";

/**
 * TradingView-style chart for the stage screen, built on TradingView's open-source
 * Lightweight Charts (Apache-2.0; the library shows its attribution logo).
 * Data comes from /api/market/candles (server-side provider; DEMO data is labelled).
 *
 * The room owner sets the shared symbol / interval / chart type / indicators. In the
 * full-screen view each viewer can additionally pan, zoom and change these locally.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { CHART_INTERVALS, CHART_TYPES, INDICATORS, INTERVAL_LABEL, bollinger, ema, rsi, sma, type CandleResult, type ChartInterval, type ChartType, type Indicator } from "@/core/market";

const C = { bg: "#131722", grid: "#1e222d", text: "#d1d4dc", muted: "#787b86", up: "#26a69a", down: "#ef5350", ma: "#f7c948", ema: "#2962ff", bb: "#9c6ade", rsi: "#7e57c2" };

const TYPE_LABEL: Record<ChartType, string> = { candles: "Nến", bars: "Thanh", line: "Đường", area: "Vùng" };
const IND_LABEL: Record<Indicator, string> = { volume: "KL", ma20: "MA20", ema50: "EMA50", bb: "BB", rsi: "RSI" };

export interface StageChartProps {
  symbol: string;
  interval?: ChartInterval;
  chartType?: ChartType;
  indicators?: Indicator[];
  interactive: boolean;
}

function fmt(n: number | undefined) {
  return n === undefined ? "–" : n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export function StageChart(p: StageChartProps) {
  // Local view state starts from the owner's shared settings (component is re-keyed when they change).
  const [interval, setInterval_] = useState<ChartInterval>(p.interval ?? "D");
  const [type, setType] = useState<ChartType>(p.chartType ?? "candles");
  const [inds, setInds] = useState<Indicator[]>(p.indicators ?? ["volume", "ma20"]);
  const [data, setData] = useState<CandleResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [legend, setLegend] = useState<{ o?: number; h?: number; l?: number; c?: number; v?: number; t?: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // Fetch + periodic refresh
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/market/candles?symbol=${encodeURIComponent(p.symbol)}&interval=${interval}&count=300`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: CandleResult) => {
          if (!cancelled) {
            setData(d);
            setErr(null);
          }
        })
        .catch(() => !cancelled && setErr("Không tải được dữ liệu biểu đồ."));
    load();
    const id = setInterval(load, interval === "D" || interval === "W" ? 60_000 : 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [p.symbol, interval]);

  const last = data?.candles[data.candles.length - 1];
  const prev = data?.candles[data.candles.length - 2];

  // Build / rebuild the chart when data or view options change.
  useEffect(() => {
    const el = host.current;
    if (!el || !data?.candles.length) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontSize: 12, attributionLogo: true, panes: { separatorColor: C.grid } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, timeVisible: interval !== "D" && interval !== "W", secondsVisible: false },
      localization: { locale: "vi-VN" },
      handleScroll: p.interactive,
      handleScale: p.interactive,
    });
    chartRef.current = chart;
    const cs = data.candles;
    const t = (x: number) => x as UTCTimestamp;
    const closes = cs.map((c) => c.close);

    let main;
    if (type === "candles" || type === "bars") {
      main = chart.addSeries(type === "candles" ? CandlestickSeries : BarSeries, { upColor: C.up, downColor: C.down, ...(type === "candles" ? { wickUpColor: C.up, wickDownColor: C.down, borderVisible: false } : {}) });
      main.setData(cs.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (type === "line") {
      main = chart.addSeries(LineSeries, { color: C.ema, lineWidth: 2 });
      main.setData(cs.map((c) => ({ time: t(c.time), value: c.close })));
    } else {
      main = chart.addSeries(AreaSeries, { lineColor: C.ema, topColor: "rgba(41,98,255,0.35)", bottomColor: "rgba(41,98,255,0.02)", lineWidth: 2 });
      main.setData(cs.map((c) => ({ time: t(c.time), value: c.close })));
    }

    const line = (values: (number | null)[], color: string, pane = 0, width: 1 | 2 = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(values.map((v, i) => (v === null ? { time: t(cs[i].time) } : { time: t(cs[i].time), value: v })));
      return s;
    };

    if (inds.includes("volume")) {
      const v = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(cs.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)" })));
    }
    if (inds.includes("ma20")) line(sma(closes, 20), C.ma, 0, 2);
    if (inds.includes("ema50")) line(ema(closes, 50), C.ema, 0, 2);
    if (inds.includes("bb")) {
      const b = bollinger(closes, 20, 2);
      line(b.map((x) => x?.upper ?? null), C.bb);
      line(b.map((x) => x?.mid ?? null), C.bb);
      line(b.map((x) => x?.lower ?? null), C.bb);
    }
    if (inds.includes("rsi")) {
      const r = line(rsi(closes, 14), C.rsi, 1, 2);
      r.createPriceLine({ price: 70, color: C.muted, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      r.createPriceLine({ price: 30, color: C.muted, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(Math.round(el.clientHeight * 0.22));
    }

    chart.timeScale().setVisibleLogicalRange({ from: cs.length - 120, to: cs.length + 3 });

    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData) return setLegend(null);
      const idx = cs.findIndex((c) => c.time === (param.time as number));
      const c = cs[idx];
      if (!c) return setLegend(null);
      setLegend({ o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume, t: new Date(c.time * 1000).toLocaleString("vi-VN", { hour12: false }) });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, type, inds, interval, p.interactive]);

  const shown = legend ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume } : null);
  const change = last && prev ? last.close - prev.close : 0;
  const changePct = last && prev ? (change / prev.close) * 100 : 0;
  const btn = (active: boolean) => ({
    background: active ? "#2a2e39" : "transparent",
    color: active ? "#fff" : C.muted,
    border: 0,
    borderRadius: 4,
    padding: "3px 7px",
    fontSize: 13,
    cursor: p.interactive ? "pointer" : "default",
  });
  const toggles = useMemo(() => new Set(inds), [inds]);

  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto auto 1fr", background: C.bg, color: C.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: `1px solid ${C.grid}`, fontSize: 13, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15, marginRight: 8 }}>{p.symbol}</strong>
        {CHART_INTERVALS.map((iv) => (
          <button key={iv} style={btn(iv === interval)} onClick={() => p.interactive && setInterval_(iv)}>
            {INTERVAL_LABEL[iv]}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: C.grid, margin: "0 6px" }} />
        {CHART_TYPES.map((ct) => (
          <button key={ct} style={btn(ct === type)} onClick={() => p.interactive && setType(ct)}>
            {TYPE_LABEL[ct]}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: C.grid, margin: "0 6px" }} />
        {INDICATORS.map((ind) => (
          <button key={ind} style={btn(toggles.has(ind))} onClick={() => p.interactive && setInds(toggles.has(ind) ? inds.filter((x) => x !== ind) : [...inds, ind])}>
            {IND_LABEL[ind]}
          </button>
        ))}
        {data?.isDemo && <span style={{ marginLeft: "auto", color: "#f0b860", fontWeight: 700, fontSize: 12 }}>DỮ LIỆU DEMO — không phải giá thật</span>}
      </div>
      <div style={{ padding: "4px 10px", fontSize: 13, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        {shown && (
          <>
            <span>
              <span style={{ color: C.muted }}>O</span> {fmt(shown.o)}
            </span>
            <span>
              <span style={{ color: C.muted }}>H</span> {fmt(shown.h)}
            </span>
            <span>
              <span style={{ color: C.muted }}>L</span> {fmt(shown.l)}
            </span>
            <span>
              <span style={{ color: C.muted }}>C</span> {fmt(shown.c)}
            </span>
            {inds.includes("volume") && (
              <span>
                <span style={{ color: C.muted }}>KL</span> {shown.v?.toLocaleString("vi-VN")}
              </span>
            )}
            {!legend && last && (
              <span style={{ color: change >= 0 ? C.up : C.down, fontWeight: 700 }}>
                {change >= 0 ? "+" : ""}
                {fmt(change)} ({changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
            )}
            {legend?.t && <span style={{ color: C.muted }}>{legend.t}</span>}
          </>
        )}
        {p.interactive && <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>Kéo để di chuyển · cuộn/chụm để zoom</span>}
      </div>
      <div ref={host} style={{ position: "relative", minHeight: 0 }}>
        {err && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: C.muted }}>{err}</div>}
      </div>
    </div>
  );
}

/** Official TradingView Advanced Chart widget (real data + full drawing tools). */
export function TradingViewWidget({ symbol, interval, interactive }: { symbol: string; interval: ChartInterval; interactive: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';
    const s = document.createElement("script");
    s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    s.async = true;
    s.type = "text/javascript";
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Asia/Ho_Chi_Minh",
      theme: "dark",
      style: "1",
      locale: "vi_VN",
      allow_symbol_change: interactive,
      hide_side_toolbar: !interactive,
      withdateranges: true,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(s);
    return () => {
      el.innerHTML = "";
    };
  }, [symbol, interval, interactive]);
  return <div ref={host} className="tradingview-widget-container" style={{ position: "absolute", inset: 0, pointerEvents: interactive ? "auto" : "none" }} />;
}
