-- Owner's watchlist (2026-11-04): backtests focus on these four stocks and VN-Index.
-- Watchlist symbols get their full daily history and keep their 1-minute bars.
insert into app.market_watchlist (symbol) values ('VDS'), ('IDC'), ('VSC'), ('HDC')
on conflict (symbol) do nothing;
