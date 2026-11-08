# AI Stock: architecture (2026-11-09)

The owner wants an **AI presenter** that drives the room screen. It scans **VN100**, finds support/resistance, chart patterns and the **equilibrium point**, ranks the stocks, attaches **historical hit rates** to each signal, and shows the best-rated stocks on the stage chart with text commentary. The host picker stays VN-Index only, but AI Stock mode may show any symbol it ranks.

## Honesty rules (product and legal)
- A "probability" is always an **empirical hit rate from a backtest**, shown with its sample size and horizon. Example: "63% · n=214 · 10 phiên". Never "AI predicts X%".
- Commentary is **market commentary and education**, not a buy/sell recommendation: no profit promises, and every screen carries a risk disclaimer. The users are freelance advisors (see BROKER-ROOM.md).
- Data comes from unofficial sources (VCI/VNDirect), so every card shows a freshness timestamp.

## What StockVN already has (Codex survey)
- VCI daily and minute OHLCV for VN30/VN100 plus VNINDEX in SQLite `data/stockpilot.sqlite`.
- Pivots, trendlines, channels and clustered S/R with ATR-based breakout rules; 26 candlestick patterns; standard indicators.
- LightGBM daily ranking of VN100, with Vietnamese contribution explanations. Its probability means "top 30% of 10-session forward return", which is not a signal hit rate.
- Walk-forward backtests and `pattern_eval` hit rates at 5/10/20 sessions.
- `/api/ai/*`, gated by a cookie or `Bearer STOCKVN_API_TOKEN` (the gate is OFF when `STOCKVN_PASSWORD` is unset).
- **Missing:** POC/VWAP/Kijun equilibrium, classical chart patterns, unified per-signal hit rates, a cached top-picks API.

## Split
- **StockVN does all the maths:** levels, patterns, equilibrium, backtests, ranking and snapshots.
- **AllOnline does the presentation:** the AI director, Claude commentary, stage chart overlays and the user-facing list.

## Equilibrium definitions (compute all 3; the backtest decides which one leads)
- **POC:** the volume profile over the last N sessions (default 120). Spread each bar's volume across its high–low range in price bins (use minute bars when available). The POC is the bin with the most volume. Also compute the value area (70%).
- **Anchored VWAP:** Σ(typical price × volume) / Σvolume, anchored at the last confirmed swing low (for uptrends) and swing high (for downtrends).
- **Kijun-26:** (the highest high + the lowest low of the last 26 sessions) / 2.
- **Events:** a close below or above the level with volume ≥ 1.5× the 20-day average counts as a confirmed break. A break on low volume is weak. A retest after the break is tracked too.

## Contract: StockVN `GET /api/ai/scan?universe=VN100` (Bearer token, cached snapshot)
```json
{ "asOf": "2026-11-09T07:30:00Z", "universe": "VN100", "dataDelayMin": 1,
  "picks": [ { "symbol": "FPT", "score": 0.82, "rank": 1, "bias": "up|down|neutral",
    "price": 132.5, "changePct": 1.2,
    "levels": { "support": [128.0], "resistance": [136.4], "poc": 129.1, "vwap": 130.2, "kijun": 128.8, "valueArea": [125.0, 133.0] },
    "signals": [ { "type": "poc_breakout|poc_breakdown|vwap_*|kijun_*|sr_breakout|pattern:<name>|candle:<name>|ml_rank",
       "direction": "up|down", "date": "2026-11-08", "level": 129.1, "volumeRatio": 1.8,
       "stats": { "horizon": 10, "hitRate": 0.63, "n": 214, "ci95": [0.56, 0.69], "avgReturnPct": 3.1 } } ],
    "overlays": { "lines": [], "zones": [], "patterns": [] } } ] }
```

## AllOnline: "AI Stock" stage mode
- The host turns on **AI dẫn chương trình** in the owner panel. A server-side director cycles through the top N picks (default 8, about 45 s each) and broadcasts the screen state. The host can pause, skip, pin a symbol or hand control back.
- The stage shows the stock chart with S/R, the three equilibrium lines (the leading one highlighted), the value-area zone and pattern drawings. Next to it, a **signal card**: score, bias, the top 3 signals with "hitRate · n · horizon", freshness, and a disclaimer.
- **Commentary:** Claude writes 3–4 Vietnamese sentences from the structured pick only (no invented numbers). It is cached per (symbol, snapshot) and uses the model from config (default `claude-opus-5-5`). It reuses the existing Anthropic key and runs only on the server.
- **Viewer list "Bảng AI Stock":** the ranked VN100 list on the viewer's own phone. Tapping a stock opens it privately; the stage is not affected.
