-- Market candles collected by the server's 1-minute scheduler (see server/market).
-- resolution: '1' (1-minute bars) or 'D' (daily bars, time = 00:00 UTC of the Vietnam trading date).
create table if not exists app.market_candles (
  symbol text not null,
  resolution text not null check (resolution in ('1', 'D')),
  time bigint not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null default 0,
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (symbol, resolution, time)
);
alter table app.market_candles enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.market_candles from anon, authenticated';
  end if;
end $$;
