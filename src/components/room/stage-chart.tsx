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

/** Bars requested on first load per interval (server caps at 8000). */
const HISTORY_COUNT: Record<ChartInterval, number> = { "1": 2000, "5": 2000, "15": 2000, "60": 2000, D: 8000, W: 2000 };

function mergeByTime(old: Candle[], tail: Candle[]): Candle[] {
  if (!tail.length) return old;
  const from = tail[0].time;
  return old.filter((c) => c.time < from).concat(tail);
}

const LINE_SHORT: Record<OverlayLine["kind"], string> = { resistance: "Trendline KC", support: "Trendline HT", channel_upper: "Kênh trên", channel_lower: "Kênh dưới" };
const LABEL_H = 16;
const LABEL_FONT = "600 11px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif";
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 6.5 + 10;
  measureCtx.font = LABEL_FONT;
  return Math.ceil(measureCtx.measureText(text).width) + 10;
}

/**
 * Places analysis labels ON the chart without covering candles:
 *  - support/resistance levels and trendlines/channel edges are labelled at their LEFT start;
 *  - signals are labelled next to their marker (above/below the bar), moving away from the
 *    candles until there is free space. A label with no free spot is left out (the marker stays
 *    and its text shows in the legend on hover).
 */
function layoutLabels(a: {
  chart: IChartApi;
  main: ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area">;
  el: HTMLDivElement;
  bars: Candle[];
  overlay: AnalysisOverlay | null;
  layers: AnalysisLayer[];
  t: (x: number) => UTCTimestamp;
  volume: boolean;
}) {
  const { chart, main, el, bars, overlay: o, t } = a;
  el.replaceChildren();
  if (!o || !bars.length) return;
  const on = new Set(a.layers);
  const ts = chart.timeScale();
  const W = Math.floor(ts.width());
  const H = Math.floor(chart.panes()[0]?.getHeight() ?? el.clientHeight);
  if (W < 50 || H < 50) return;
  const yOf = (p: number): number | null => main.priceToCoordinate(p);
  const xOf = (time: number): number | null => ts.timeToCoordinate(t(time));

  // Candle occupancy per pixel column: [top, bottom] of the wick range plus a small margin.
  const top = new Float32Array(W).fill(Infinity);
  const bot = new Float32Array(W).fill(-Infinity);
  const half = Math.max(1, (ts.options().barSpacing ?? 6) / 2);
  for (const c of bars) {
    const x = xOf(c.time);
    if (x === null || x < -half || x > W + half) continue;
    const yh = yOf(c.high);
    const yl = yOf(c.low);
    if (yh === null || yl === null) continue;
    for (let i = Math.max(0, Math.floor(x - half - 1)); i <= Math.min(W - 1, Math.ceil(x + half + 1)); i++) {
      if (yh - 3 < top[i]) top[i] = yh - 3;
      if (yl + 3 > bot[i]) bot[i] = yl + 3;
    }
  }
  const floor = a.volume ? H * 0.8 : H; // keep the volume histogram clear too
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const free = (x: number, y: number, w: number) => {
    if (x < 2 || y < 2 || x + w > W - 2 || y + LABEL_H > floor) return false;
    for (let i = Math.floor(x); i < x + w; i++) if (top[i] <= y + LABEL_H && bot[i] >= y) return false;
    return !placed.some((r) => x < r.x2 + 3 && x + w > r.x1 - 3 && y < r.y2 + 2 && y + LABEL_H > r.y1 - 2);
  };
  const put = (text: string, color: string, cands: [number, number][], title?: string) => {
    const w = textWidth(text);
    for (const [cx, cy] of cands) {
      const x = Math.round(cx);
      const y = Math.round(cy);
      if (!free(x, y, w)) continue;
      placed.push({ x1: x, y1: y, x2: x + w, y2: y + LABEL_H });
      const span = document.createElement("span");
      span.textContent = text;
      if (title) span.title = title;
      Object.assign(span.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        height: `${LABEL_H}px`,
        lineHeight: `${LABEL_H - 2}px`,
        padding: "0 4px",
        borderRadius: "3px",
        whiteSpace: "nowrap",
        font: LABEL_FONT,
        color,
        background: "rgba(19,23,34,0.8)",
        border: `1px solid ${color}66`,
      });
      el.appendChild(span);
      return true;
    }
    return false;
  };
  /** Candidate spots at the given x positions, stepping away from y (up or down). */
  const away = (xs: number[], y: number, up: boolean, steps: number) => {
    const out: [number, number][] = [];
    for (let k = 0; k < steps; k++) for (const x of xs) out.push([x, up ? y - LABEL_H - 2 - k * 6 : y + 2 + k * 6]);
    return out;
  };

  // 1) Horizontal support / resistance: label at the left start of the line.
  if (on.has("levels")) {
    const close = bars[bars.length - 1].close;
    for (const l of [...o.levels].sort((p, q) => q.price - p.price)) {
      const y = yOf(l.price);
      if (y === null || y < 0 || y > H) continue;
      const isRes = l.price >= close;
      const text = `${isRes ? "Kháng cự" : "Hỗ trợ"} ${fmt(l.price)} · ${l.touches} chạm`;
      const xs: number[] = [];
      for (let x = 6; x < W * 0.7; x += 20) xs.push(x);
      const color = LEVEL_COLORS[l.kind];
      // right on the line (above for resistance, below for support), sliding right from the left edge
      put(text, color, [...away(xs, y, isRes, 1), ...away(xs, y, !isRes, 1), ...away(xs.slice(0, 6), y, isRes, 8)]);
    }
  }

  // 2) Trendlines / channel edges: label at the left start (first visible point) of the line.
  for (const line of o.lines) {
    if (!on.has(line.layer) || line.points.length < 2) continue;
    const pts = line.points
      .map((p) => ({ x: xOf(p.time), y: yOf(p.value) }))
      .filter((p): p is { x: number; y: number } => p.x !== null && p.y !== null && p.x >= 0 && p.x <= W);
    if (!pts.length) continue;
    const up = line.kind === "resistance" || line.kind === "channel_upper";
    const text = `${LINE_SHORT[line.kind]}${line.touches ? ` · ${line.touches} chạm` : ""}`;
    const stride = Math.max(1, Math.floor(pts.length / 40));
    const cands: [number, number][] = [];
    for (let k = 0; k < 10; k++)
      for (let i = 0; i < pts.length; i += stride) cands.push([pts[i].x, up ? pts[i].y - LABEL_H - 3 - k * 6 : pts[i].y + 3 + k * 6]);
    put(text, LINE_COLORS[line.kind], cands, line.label);
  }

  // 3) Signals: text next to the marker, away from the candles; newest first, merged per bar.
  const byBar = new Map<number, { texts: string[]; color: string; above: boolean }>();
  for (const m of o.markers) {
    if (!on.has(m.layer)) continue;
    const g = byBar.get(m.time) ?? { texts: [], color: m.color, above: m.position === "aboveBar" };
    if (!g.texts.includes(m.text)) g.texts.push(m.text);
    byBar.set(m.time, g);
  }
  const barByTime = new Map(bars.map((c) => [c.time, c]));
  let shown = 0;
  const lastX = new Map<string, number>(); // same text nearby is labelled once (markers stay)
  for (const [time, g] of [...byBar].sort((p, q) => q[0] - p[0])) {
    if (shown >= 12) break;
    const c = barByTime.get(time);
    const x = xOf(time);
    if (!c || x === null || x < 0 || x > W) continue;
    const yRef = g.above ? yOf(c.high) : yOf(c.low);
    if (yRef === null) continue;
    const text = g.texts.join(" · ");
    const near = lastX.get(text);
    if (near !== undefined && Math.abs(near - x) < 140) continue;
    const w = textWidth(text);
    const yStart = g.above ? yRef - 12 : yRef + 12; // clear of the marker symbol
    if (put(text, g.color, away([x - w / 2, x - w + 6, x - 6], yStart, g.above, 16))) {
      shown++;
      lastX.set(text, x);
    }
  }
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
  const [legend, setLegend] = useState<{ o?: number; h?: number; l?: number; c?: number; v?: number; t?: string; sig?: { text: string; color: string }[] } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; draw: (cs: Candle[]) => void; drawOverlay: (o: AnalysisOverlay | null, layers: AnalysisLayer[]) => void; fresh: boolean } | null>(null);
  const overlayRef = useRef<AnalysisOverlay | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const barsRef = useRef<Candle[]>([]);

  // Full fetch on open / interval change, then every minute (live bars fill the gaps in between).
  useEffect(() => {
    let cancelled = false;
    let have: CandleResult | null = null;
    // First load: the whole stored history (indices/watchlist: all of it, other stocks: since 2024);
    // every minute after that only the tail, merged in by time.
    const load = () =>
      fetch(`/api/market/candles?symbol=${encodeURIComponent(p.symbol)}&interval=${interval}&count=${have && !have.isDemo ? 300 : HISTORY_COUNT[interval]}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: CandleResult) => {
          if (cancelled) return;
          have = have && !have.isDemo && !d.isDemo ? { ...d, candles: mergeByTime(have.candles, d.candles) } : d;
          setData(have);
          setErr(null);
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
    // Text labels on the chart, placed where they do not touch any candle (body or wick) or each other.
    const labelLayer = document.createElement("div");
    labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden";
    el.appendChild(labelLayer);
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => layoutLabels({ chart, main, el: labelLayer, bars: barsRef.current, overlay: overlayRef.current, layers: layersRef.current, t, volume: !!vol }));
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(relayout);
    const ro = new ResizeObserver(relayout);
    ro.observe(el);

    ref.drawOverlay = (o, on) => {
      relayout();
      const show = new Set(on);
      for (const [kind, series] of overlayLines) {
        const line = o?.lines.find((l) => l.kind === kind && show.has(l.layer));
        series.setData(line ? line.points.map((pt) => ({ time: t(pt.time), value: pt.value })) : []);
      }
      for (const pl of levelLines) main.removePriceLine(pl);
      levelLines =
        o && show.has("levels")
          ? o.levels.map((l) =>
              main.createPriceLine({ price: l.price, color: LEVEL_COLORS[l.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" }),
            )
          : [];
      markers.setMarkers(o ? o.markers.filter((m) => show.has(m.layer)).map((m) => ({ time: t(m.time), position: m.position, shape: m.shape, color: m.color, size: Math.min(m.size, 1) })) : []);
    };
    ref.draw = (cs: Candle[]) => {
      if (!cs.length) return;
      relayout();
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
        sig: (overlayRef.current?.markers ?? []).filter((m) => m.time === c.time && layersRef.current.includes(m.layer)).map((m) => ({ text: m.text, color: m.color })),
        t: intraday ? new Date(c.time * 1000).toLocaleString("vi-VN", { hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : new Date(c.time * 1000).toLocaleDateString("vi-VN", { timeZone: "UTC" }),
      });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(relayout);
      chart.remove();
      labelLayer.remove();
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
            {legend?.sig?.map((x, i) => (
              <span key={i} style={{ color: x.color, fontWeight: 600 }}>
                {x.text}
              </span>
            ))}
          </>
        )}
        {p.interactive && <span style={{ marginLeft: "auto", color: C.muted, fontSize: 12 }}>Kéo để di chuyển · cuộn/chụm để zoom</span>}
      </div>
      <div ref={host} style={{ position: "relative", minHeight: 0, minWidth: 0 }}>
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
