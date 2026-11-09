-- Additive, private-schema account follows and durable alert/delivery ledger.
create table app.stock_follows (
  user_id uuid not null references app.users(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9.]{1,12}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
create index stock_follows_symbol_idx on app.stock_follows(symbol);
create table app.stock_alerts (
  dedupe_key text primary key,
  session_day date not null,
  fixture boolean not null,
  alert jsonb not null,
  created_at timestamptz not null default now()
);
create table app.stock_alert_deliveries (
  alert_key text not null references app.stock_alerts(dedupe_key) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  day date not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','skipped','failed')),
  reason text,
  primary key (alert_key, user_id)
);
create index stock_alert_delivery_day_idx on app.stock_alert_deliveries(user_id, day, status);
create table app.stock_zalo_contacts (
  provider_uid text primary key,
  chat_id text not null,
  last_inbound_at timestamptz not null default now()
);
