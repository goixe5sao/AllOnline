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
  createSeriesMarkers,
  LineStyle,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type IChartApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { CHART_INTERVALS, CHART_TYPES, INDICATORS, INTERVAL_LABEL, bollinger, ema, mergeLiveBars, rsi, sma, type Candle, type CandleResult, type ChartInterval, type ChartType, type Indicator } from "@/core/market";
import { subscribeLiveBars } from "./market-live";
import { ANALYSIS_LAYERS, DEFAULT_LAYERS, LAYER_LABEL, LEVEL_COLORS, LINE_COLORS, type AnalysisLayer, type AnalysisOverlay, type OverlayLine } from "@/core/analysis";

type AnalysisState = { available: true; overlay: AnalysisOverlay } | { available: false; reason: string };

const C = { bg: "#131722", grid: "#1e222d", text: "#d1d4dc", muted: "#787b86", up: "#26a69a", down: "#ef5350", ma: "#f7c948", ema: "#2962ff", bb: "#9c6ade", rsi: "#7e57c2" };

const TYPE_LABEL: Record<ChartType, string> = { candles: "Nến", bars: "Thanh", line: "Đường", area: "Vùng" };
const IND_LABEL: Record<Indicator, string> = { volume: "KL", ma20: "MA20", ema50: "EMA50", bb: "BB", rsi: "RSI" };

export interface StageChartProps {
  symbol: string;
  interval?: ChartInterval;
  chartType?: ChartType;
  indicators?: Indicator[];
  /** StockVN analysis layers to show (owner default; viewers can toggle in full-screen). */
  layers?: AnalysisLayer[];
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
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [layers, setLayers] = useState<AnalysisLayer[]>(p.layers ?? DEFAULT_LAYERS);
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null);
  const [legend, setLegend] = useState<{ o?: number; h?: number; l?: number; c?: number; v?: number; t?: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; draw: (cs: Candle[]) => void; drawOverlay: (o: AnalysisOverlay | null, layers: AnalysisLayer[]) => void; fresh: boolean } | null>(null);
  const overlayRef = useRef<AnalysisOverlay | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const barsRef = useRef<Candle[]>([]);

  // Full fetch on open / interval change, then every minute (live bars fill the gaps in between).
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
    const loadAnalysis = () =>
      fetch(`/api/market/analysis?symbol=${encodeURIComponent(p.symbol)}&interval=${interval}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((a: AnalysisState | null) => !cancelled && a && setAnalysis(a))
        .catch(() => undefined);
    load();
    loadAnalysis();
    const id = setInterval(() => {
      load();
      loadAnalysis();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [p.symbol, interval]);

  const intraday = interval !== "D" && interval !== "W";
  // Lightweight Charts renders in UTC: shift intraday bars to Vietnam time (UTC+7). Daily bars are
  // already keyed to 00:00 UTC of the Vietnam trading date.
  const off = intraday ? 7 * 3600 : 0;

  // Build the chart once per view option (not on every data change).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontSize: 12, attributionLogo: true, panes: { separatorColor: C.grid } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, timeVisible: intraday, secondsVisible: false },
      localization: { locale: "vi-VN" },
      handleScroll: p.interactive,
      handleScale: p.interactive,
    });
    const t = (x: number) => (x + off) as UTCTimestamp;
    const main =
      type === "candles" || type === "bars"
        ? chart.addSeries(type === "candles" ? CandlestickSeries : BarSeries, { upColor: C.up, downColor: C.down, ...(type === "candles" ? { wickUpColor: C.up, wickDownColor: C.down, borderVisible: false } : {}) })
        : type === "line"
          ? chart.addSeries(LineSeries, { color: C.ema, lineWidth: 2 })
          : chart.addSeries(AreaSeries, { lineColor: C.ema, topColor: "rgba(41,98,255,0.35)", bottomColor: "rgba(41,98,255,0.02)", lineWidth: 2 });
    const lineSeries = (color: string, pane = 0, width: 1 | 2 = 1) => chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
    const vol = inds.includes("volume") ? chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }) : null;
    vol?.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ma = inds.includes("ma20") ? lineSeries(C.ma, 0, 2) : null;
    const em = inds.includes("ema50") ? lineSeries(C.ema, 0, 2) : null;
    const bb = inds.includes("bb") ? [lineSeries(C.bb), lineSeries(C.bb), lineSeries(C.bb)] : null;
    const rs = inds.includes("rsi") ? lineSeries(C.rsi, 1, 2) : null;
    if (rs) {
      rs.createPriceLine({ price: 70, color: C.muted, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      rs.createPriceLine({ price: 30, color: C.muted, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
    }

    // StockVN overlay: one line series per line kind (as on StockVN's backtest page), horizontal
    // support/resistance price lines, and markers for candle patterns / breakouts / multi-timeframe.
    const overlayLines = new Map<OverlayLine["kind"], ISeriesApi<"Line">>();
    for (const kind of Object.keys(LINE_COLORS) as OverlayLine["kind"][])
      overlayLines.set(
        kind,
        chart.addSeries(LineSeries, { color: LINE_COLORS[kind], lineWidth: 2, lineStyle: kind.startsWith("channel") ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      );
    let levelLines: IPriceLine[] = [];
    const markers: ISeriesMarkersPluginApi<Time> = createSeriesMarkers(main as ISeriesApi<"Candlestick">, []);

    const ref: { chart: IChartApi; draw: (cs: Candle[]) => void; drawOverlay: (o: AnalysisOverlay | null, layers: AnalysisLayer[]) => void; fresh: boolean } = {
      chart,
      fresh: true,
      draw: () => undefined,
      drawOverlay: () => undefined,
    };
    ref.drawOverlay = (o, on) => {
      const show = new Set(on);
      for (const [kind, series] of overlayLines) {
        const line = o?.lines.find((l) => l.kind === kind && show.has(l.layer));
        series.setData(line ? line.points.map((pt) => ({ time: t(pt.time), value: pt.value })) : []);
      }
      for (const pl of levelLines) main.removePriceLine(pl);
      levelLines =
        o && show.has("levels")
          ? o.levels.map((l) =>
              main.createPriceLine({ price: l.price, color: LEVEL_COLORS[l.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: (l.kind === "resistance" ? "KC " : "HT ") + l.touches + " lần chạm" }),
            )
          : [];
      markers.setMarkers(o ? o.markers.filter((m) => show.has(m.layer)).map((m) => ({ time: t(m.time), text: m.text, position: m.position, shape: m.shape, color: m.color, size: m.size })) : []);
    };
    ref.draw = (cs: Candle[]) => {
      if (!cs.length) return;
      // Keep the viewer's pan/zoom across refreshes.
      const range = ref.fresh ? null : chart.timeScale().getVisibleLogicalRange();
      const closes = cs.map((c) => c.close);
      const lineData = (values: (number | null)[]) => values.map((v, i) => (v === null ? { time: t(cs[i].time) } : { time: t(cs[i].time), value: v }));
      if (type === "candles" || type === "bars") main.setData(cs.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })) as never);
      else main.setData(cs.map((c) => ({ time: t(c.time), value: c.close })) as never);
      vol?.setData(cs.map((c) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)" })));
      ma?.setData(lineData(sma(closes, 20)));
      em?.setData(lineData(ema(closes, 50)));
      if (bb) {
        const b = bollinger(closes, 20, 2);
        bb[0].setData(lineData(b.map((x) => x?.upper ?? null)));
        bb[1].setData(lineData(b.map((x) => x?.mid ?? null)));
        bb[2].setData(lineData(b.map((x) => x?.lower ?? null)));
      }
      rs?.setData(lineData(rsi(closes, 14)));
      if (ref.fresh) {
        ref.fresh = false;
        const panes = chart.panes();
        if (rs && panes[1]) panes[1].setHeight(Math.round(el.clientHeight * 0.22));
        if (cs.length > 120) chart.timeScale().setVisibleLogicalRange({ from: cs.length - 120, to: cs.length + 3 });
        else chart.timeScale().fitContent();
      } else if (range) chart.timeScale().setVisibleLogicalRange(range);
    };
    chartRef.current = ref;
    if (barsRef.current.length) ref.draw(barsRef.current);
    ref.drawOverlay(overlayRef.current, layersRef.current);

    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time || !param.seriesData) return setLegend(null);
      const c = barsRef.current.find((x) => x.time + off === (param.time as number));
      if (!c) return setLegend(null);
      setLegend({
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.volume,
        t: intraday ? new Date(c.time * 1000).toLocaleString("vi-VN", { hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : new Date(c.time * 1000).toLocaleDateString("vi-VN", { timeZone: "UTC" }),
      });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, inds.join(","), interval, p.interactive]);

  // Full data arrived (open / every minute): redraw, keeping the viewport.
  useEffect(() => {
    if (!data) return;
    barsRef.current = data.candles;
    chartRef.current?.draw(barsRef.current);
  }, [data]);

  // StockVN overlay arrived / layer toggles changed.
  useEffect(() => {
    overlayRef.current = analysis?.available ? analysis.overlay : null;
    chartRef.current?.drawOverlay(overlayRef.current, layers);
  }, [analysis, layers]);

  // Live bars pushed over the room WebSocket about every second during the session.
  useEffect(() => {
    if (!data || data.isDemo) return;
    return subscribeLiveBars((symbol, live) => {
      if (symbol !== p.symbol || !barsRef.current.length) return;
      barsRef.current = mergeLiveBars(barsRef.current, live, interval);
      chartRef.current?.draw(barsRef.current);
      setLiveAt(Date.now());
    });
  }, [data, p.symbol, interval]);

  const bars = barsRef.current;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

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
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "auto auto auto 1fr", background: C.bg, color: C.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif" }}>
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
        {data &&
          (data.isDemo ? (
            <span style={{ marginLeft: "auto", color: "#f0b860", fontWeight: 700, fontSize: 12 }}>DỮ LIỆU DEMO — không phải giá thật</span>
          ) : (
            <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>
              {liveAt && Date.now() - liveAt < 150_000 ? <span style={{ color: C.up, fontWeight: 700 }}>● TRỰC TIẾP · cập nhật mỗi phút</span> : "cập nhật mỗi phút"} · Nguồn: {data.source}
              {liveAt && Date.now() - liveAt < 150_000 && " + nến đang chạy từ SSI iBoard/VPS (không chính thức)"}
            </span>
          ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderBottom: `1px solid ${C.grid}`, fontSize: 12, flexWrap: "wrap" }}>
        <span style={{ color: C.muted, marginRight: 4 }}>Phân tích StockVN:</span>
        {analysis?.available ? (
          ANALYSIS_LAYERS.map((l) => (
            <button key={l} style={btn(layers.includes(l))} onClick={() => p.interactive && setLayers(layers.includes(l) ? layers.filter((x) => x !== l) : [...layers, l])}>
              {LAYER_LABEL[l]}
            </button>
          ))
        ) : (
          <span style={{ color: C.muted }}>{analysis ? analysis.reason : "đang tải…"}</span>
        )}
        {analysis?.available && <span style={{ marginLeft: "auto", color: C.muted }}>{analysis.overlay.source}</span>}
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
