-- Listed symbols (for the owner's stock picker), the market watchlist, and per-symbol history depth.
create table if not exists app.market_symbols (
  symbol text primary key,
  name text not null,
  exchange text not null,
  kind text not null check (kind in ('index', 'stock', 'etf')),
  industry text,
  updated_at timestamptz not null default now()
);
create index if not exists market_symbols_name_idx on app.market_symbols (lower(name));

insert into app.market_symbols (symbol, name, exchange, kind) values
  ('VNINDEX', 'Chỉ số VN-Index', 'HOSE', 'index'),
  ('VN30', 'Chỉ số VN30', 'HOSE', 'index'),
  ('VN100', 'Chỉ số VN100', 'HOSE', 'index'),
  ('HNXINDEX', 'Chỉ số HNX-Index', 'HNX', 'index'),
  ('HNX30', 'Chỉ số HNX30', 'HNX', 'index'),
  ('UPCOMINDEX', 'Chỉ số UPCoM-Index', 'UPCOM', 'index')
on conflict (symbol) do nothing;

-- Watchlist symbols (like indices) get their FULL daily history and 1-minute bars kept forever.
create table if not exists app.market_watchlist (
  symbol text primary key,
  added_by uuid references app.users(id),
  added_at timestamptz not null default now()
);

-- How far back daily history has been backfilled for each symbol.
create table if not exists app.market_history (
  symbol text primary key,
  daily_from date not null,
  full_history boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table app.market_symbols enable row level security;
alter table app.market_watchlist enable row level security;
alter table app.market_history enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.market_symbols, app.market_watchlist, app.market_history from anon, authenticated';
  end if;
end $$;
