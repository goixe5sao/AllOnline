/**
 * Technical-analysis overlay for the stage chart, produced by the StockVN analysis service
 * (see server/analysis/stockvn.ts). Times are epoch seconds in AllOnline's convention
 * (minute bars: UTC instant; day bars: 00:00 UTC of the Vietnam trading date).
 */
export const ANALYSIS_LAYERS = ["trendlines", "channel", "levels", "patterns", "common", "breaks", "mtf"] as const;
export type AnalysisLayer = (typeof ANALYSIS_LAYERS)[number];

export const LAYER_LABEL: Record<AnalysisLayer, string> = {
  trendlines: "Trendline",
  channel: "Kênh",
  levels: "HT/KC",
  patterns: "Mô hình nến",
  common: "Nến hay gặp",
  breaks: "Phá vỡ",
  mtf: "Đa khung",
};

/** All layers on by default (owner: show the candle patterns of every candle on screen). */
export const DEFAULT_LAYERS: AnalysisLayer[] = ["trendlines", "channel", "levels", "patterns", "common", "breaks", "mtf"];

export const LINE_COLORS = { resistance: "#d9480f", support: "#1c7ed6", channel_upper: "#f59f00", channel_lower: "#4dabf7" } as const;
export const LEVEL_COLORS = { resistance: "#e8590c", support: "#1971c2" } as const;

export interface OverlayLine {
  kind: keyof typeof LINE_COLORS;
  layer: "trendlines" | "channel";
  label: string;
  touches?: number;
  trend?: string;
  dashed: boolean;
  points: { time: number; value: number }[];
}

export interface OverlayMarker {
  time: number;
  text: string;
  layer: AnalysisLayer;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  size: number;
}

export interface AnalysisOverlay {
  symbol: string;
  interval: string;
  source: string;
  /** First date (YYYY-MM-DD) the analysis covers. */
  from?: string;
  /** Time of the last bar the analysis was computed on. */
  asOf: number;
  lines: OverlayLine[];
  levels: { kind: "resistance" | "support"; price: number; touches: number }[];
  markers: OverlayMarker[];
}
