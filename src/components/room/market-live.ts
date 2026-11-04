"use client";

/**
 * Tiny pub/sub for live market bars pushed over the room WebSocket.
 * The stage chart lives in a separate React root (drei <Html>), so it subscribes here
 * instead of receiving props from the room component.
 */
import type { Candle } from "@/core/market";

type Listener = (symbol: string, bars: Candle[]) => void;
const listeners = new Set<Listener>();

export function publishLiveBars(symbol: string, bars: Candle[]) {
  for (const l of listeners) l(symbol, bars);
}

export function subscribeLiveBars(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
