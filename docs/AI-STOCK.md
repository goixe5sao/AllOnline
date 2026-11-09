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

## A-1 implementation and configuration

- The owner panel's **AI dẫn chương trình** card starts/restarts the director with top N (1–100, capped to snapshot size) and seconds per stock (10–300). Pause holds the pick; pin selects any symbol in the snapshot and holds it; resume unpins and starts a fresh interval; skip advances within top N; stop clears the stage. Selecting ordinary screen content also ends AI mode. **Bảng AI Stock** is available from the room menu and has only local selection state.
- The complete snapshot, index, deadline, controls and commentary travel in the existing persisted `screen` state as kind `ai-stock`. Late joins use the existing welcome payload. Moderator commands use `screen/action: ai_stock`; clients cannot inject an `ai-stock` snapshot through generic `set`. No migration is needed. After a server restart the saved screen is restored; an overdue unpaused/unpinned pick advances once on the next tick, rather than replaying missed picks.
- `AI_STOCK_PROVIDER=fixture` is the default until S-3 ships. Fixture prices, candles and statistics are explicitly synthetic and never mixed with live candles. Fixture presentation always uses template commentary and makes no Claude calls. Demo configuration and demo rooms always select the fixture.
- Future opt-in: `AI_STOCK_PROVIDER=stockvn` requires the existing `STOCKVN_URL` and `STOCKVN_API_TOKEN`. The server calls `/api/ai/scan?universe=VN100` with Bearer auth, validates the response and caches it for one minute. Failures do not silently replace real data with sample statistics. The private list endpoint `/api/ai-stock/scan` requires an attendee session, including guests.
- Commentary reuses `ANTHROPIC_API_KEY` and the shared server-only SDK client factory used by receipt reading. `AI_STOCK_MODEL` defaults to `claude-opus-5-5`. Cache: `(symbol, asOf)`, at most 200 entries, including in-flight requests. Rate limit: one new request per ten seconds across the process, no retries, fifteen-second timeout; missing key, rate limit, refusal, API failure or rejected output uses the deterministic template. Late responses cannot overwrite a later screen revision. The prompt requires Vietnamese, input numbers only, no trading advice and the exact disclaimer; the output guard rejects unknown digit sequences and common advice phrases (it is not a proof of semantic correctness).
- Current SDK usage was checked against the [official Anthropic TypeScript SDK documentation](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) and [official SDK README](https://github.com/anthropics/anthropic-sdk-typescript): `new Anthropic({ apiKey })`, `client.messages.create`, typed text blocks and request timeout/retry options. No SDK dependency change or live API request was required.
- `StockScan` in `src/core/ai-stock.ts` preserves the documented contract fields. The previously unspecified overlay array items currently use `{label, points:[{time,value}]}` for lines/pattern polylines and `{label,low,high,from,to}` for zones; times are UTC seconds and prices use the chart's thousand-VND unit. S-3 must confirm these details before enabling the real provider. S-1 has not selected a leading equilibrium definition, so the UI labels that as pending and draws all three without claiming one is superior.
- CPU-safe visual checks: `node scripts/ui-ai-stock.mjs` temporarily mounts the real stage, controls and list components without a Three scene, checks four viewport/theme combinations, saves `docs/screenshots/ui/after/ai-stock-*`, then removes the temporary route and closes every context. Start a demo server on 3100 first. Run this separately from `tsc` because the temporary route is deleted at the end.

## Alerts (owner 2026-11-09): two beats, "warn + stats + the user decides"
StockVN contract `GET /api/ai/alerts?since=<iso>` (Bearer) returns `{ asOf, alerts: [ { id, symbol, kind, beat, level, levelType, price, candle?, stats?, baseRate?, createdAt } ] }`
- `kind`: `near_resistance | near_support | break_resistance | break_support | break_equilibrium_down | break_equilibrium_up`
- `beat`: `intraday` (entering the zone, base-rate only, "chờ nến kết phiên") or `close` (the session-close candle class + the conditional stats vs the base rate)
- `levelType`: `resistance | support | poc | vwap | kijun`. `candle`: `shooting_star | long_upper_wick | bearish_engulfing | doji | hammer | bullish_engulfing | close_beyond_with_volume`.
- `stats` = `{ horizon, hitRate, n, ci95, outcome: "≥X% trong H phiên" }`. These are present ONLY when the method × symbol is in `approved_methods` (the 80% gate). Otherwise the alert is informational: price/level only, no percentage.
Copy per kind (the user always decides, never imperative): near resistance → "cân nhắc chốt lời/giảm tỷ trọng"; break resistance with volume → "tín hiệu mạnh, kháng cự cũ thành hỗ trợ"; near support → "bạn tự quyết có mua thăm dò hay không"; break support/POC → "cảnh báo quản trị rủi ro".
Rules: once per symbol × level × beat per session.

## A-2 implementation and messaging policy

- Additive migration `017_stock_alerts.sql` stores account follows, alerts, delivery reservations/outcomes and the last private-human Bot chat contact. Follows use the existing account identity; guests can read alerts but cannot follow. APIs are `/api/ai-stock/alerts` (attendee GET) and `/api/ai-stock/follows` (account GET/POST `{symbol, following}`). There is a 100-symbol account limit. Unfollowing prevents queued sends.
- Default/demo alerts are typed, explicitly synthetic fixtures; fixture delivery uses `CaptureSender`, never the live transport. Opt-in real alerts reuse `AI_STOCK_PROVIDER=stockvn`, `STOCKVN_URL` and `STOCKVN_API_TOKEN`. The server polls every 60 seconds in the existing weekday VN session envelope (08:45–15:15 ICT); this includes lunch and is not an exchange-holiday calendar. The `since` cursor overlaps the latest stored event by one minute. Future-dated events are ignored. Failed polls retain history and expose a stale-data error. Browsers refresh the feed every 15 seconds; alerts are separate from the persisted director state.
- Durable dedupe is `(provider, VN calendar session date, symbol, numeric level, beat)`, independent of upstream ID/kind. Delivery is queued only for current account followers. The worker checks the follow and linked `zalo_oa` identity again, uses the private `chat.id` recorded on authenticated inbound messages, rejects old-session alerts, and reserves at most five attempts per account per VN day under an account row lock. Sent, failed and interrupted `sending` attempts consume the cap; skipped attempts do not. Ambiguous failures/interrupted sends are never retried automatically. Fixture/real workers process only their own queues. Outcomes/reasons persist; logs contain reason codes without identities, tokens or message bodies.
- Official docs checked on 2026-11-09: [sendMessage](https://bot.zaloplatforms.com/docs/apis/sendMessage/), [API errors](https://bot.zaloplatforms.com/docs/error-code/), [terms](https://bot.zaloplatforms.com/docs/terms/), [webhook](https://bot.zaloplatforms.com/docs/webhook/) and the [docs index](https://bot.zaloplatforms.com/docs/). Direct HTTPS retrieval succeeded after the browser tool failed. The send method documents a recipient `chat_id` and text length 1–2,000; the error table documents quota error 429. Webhook `message.date` is Unix milliseconds; contact tracking uses that event time and rejects missing/future timestamps and older replays, rather than extending eligibility at receipt time. These pages do **not** specify a numeric proactive-messaging window or establish that a follow click authorizes proactive Bot messages. Do not import an OA policy or assume a 24/48-hour window applies to Bot Platform.
- Consequently, unset `ZALO_ALERT_VERIFIED_WINDOW_SECONDS` means **no proactive alert sends**: queue items become `skipped / policy_unknown`, logged. This optional operator setting must only be supplied after checking the Bot's actual plan/permissions and obtaining a verified policy; it is not a platform entitlement check. Missing private chat, unknown policy, expired/future inbound time, stale session, unfollow and daily cap all skip delivery. Transport rejection becomes failed without retry. A linked account and a follow alone never bypass the policy gate. Confirm platform eligibility/quotas before rollout; if it requires criteria beyond a time window, extend the gate first.
- Alert copy covers all six kinds and both beats, never commands a trade, includes source/time/disclaimer, and only displays conditional/base percentages when `stats` is supplied. The upstream approved-method gate remains StockVN's responsibility; AllOnline does not infer approval from a base rate alone. The stage banner shows the current symbol's current-session alert; the private list has warning badges, history and follow controls.
- Repeatable component-only visual check: `node scripts/ui-stock-alerts.mjs` against a demo server on 3100. It mounts real components without a Three scene, intercepts only the alert feed with a deterministic two-beat fixture (including a closing candle before market close), exercises actual demo follow APIs and reload persistence, captures four views at 390/1440 in both themes and removes the temporary route in `finally`.
- Review questions: verify Bot proactive eligibility/window/plan quota; agree history/contact retention and interrupted-delivery reconciliation; confirm the real alerts contract, upstream approved-method gate, exchange holiday calendar and late-close delivery behavior. No live StockVN, Zalo or Claude validation is claimed.
