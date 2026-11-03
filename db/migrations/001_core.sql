-- AllOnline core schema.
-- Everything lives in the private schema "app", which Supabase does NOT expose through
-- PostgREST. Browsers never talk to these tables directly: every read/write goes through
-- the AllOnline server, which enforces roles, slots and room ownership.
-- The same file runs on Supabase Postgres (production) and on PGlite (local demo/tests).

create schema if not exists app;

create table app.users (
  id uuid primary key,
  email text,
  display_name text not null,
  -- Only 'app_owner' grants system administration. It can be set only by the server-side
  -- CLI (npm run grant-owner), never from user-editable metadata.
  role text not null default 'user' check (role in ('app_owner', 'user')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_uidx on app.users (lower(email)) where email is not null;

create table app.settings (
  id smallint primary key default 1 check (id = 1),
  total_slot_budget integer not null default 100 check (total_slot_budget >= 0),
  max_room_capacity integer not null default 100 check (max_room_capacity >= 1),
  waiting_ratio numeric(5,4) not null default 0.20 check (waiting_ratio >= 0 and waiting_ratio <= 1),
  find_seat_seconds integer not null default 300 check (find_seat_seconds between 30 and 3600),
  invite_claim_seconds integer not null default 60 check (invite_claim_seconds between 10 and 600),
  requeue_cooldown_seconds integer not null default 30 check (requeue_cooldown_seconds between 0 and 600),
  reconnect_grace_seconds integer not null default 90 check (reconnect_grace_seconds between 5 and 1800),
  chat_radius numeric(6,2) not null default 8 check (chat_radius > 0),
  chat_max_length integer not null default 200 check (chat_max_length between 1 and 1000),
  warning_minutes integer[] not null default '{30,10,1}',
  payment_hold_minutes integer not null default 15 check (payment_hold_minutes between 1 and 1440),
  duration_options integer[] not null default '{6,12,24}',
  waiting_surcharge_pct numeric(6,2) not null default 0 check (waiting_surcharge_pct >= 0),
  trial_enabled boolean not null default true,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  trial_rooms_per_account integer not null default 1 check (trial_rooms_per_account >= 0),
  trial_max_hours integer not null default 6 check (trial_max_hours >= 1),
  trial_max_capacity integer not null default 20 check (trial_max_capacity >= 1),
  extension_enabled boolean not null default true,
  qr_bank_bin text not null default '',
  qr_account_no text not null default '',
  qr_account_name text not null default '',
  upload_max_mb integer not null default 5 check (upload_max_mb between 1 and 50),
  upload_retention_days integer not null default 30 check (upload_retention_days >= 1),
  enabled_maps text[] not null default '{hall,carpet,tables,drive_in}',
  enabled_avatar_groups text[] not null default '{people,animals,vehicles}',
  updated_at timestamptz not null default now(),
  updated_by uuid references app.users(id)
);
insert into app.settings (id) values (1) on conflict do nothing;

create table app.price_tiers (
  id uuid primary key default gen_random_uuid(),
  max_capacity integer not null check (max_capacity >= 1),
  duration_hours integer not null check (duration_hours >= 1),
  price_vnd bigint not null check (price_vnd >= 0),
  unique (max_capacity, duration_hours)
);
-- Sample prices only. The app owner must review them in /admin before real use.
insert into app.price_tiers (max_capacity, duration_hours, price_vnd) values
  (10, 6, 49000), (10, 12, 79000), (10, 24, 129000),
  (20, 6, 89000), (20, 12, 139000), (20, 24, 229000),
  (50, 6, 199000), (50, 12, 319000), (50, 24, 499000),
  (100, 6, 349000), (100, 12, 559000), (100, 24, 899000);

create table app.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references app.users(id),
  kind text not null check (kind in ('create_room', 'extend_room')),
  room_id uuid,
  config jsonb not null,
  quote jsonb not null,
  amount_vnd bigint not null check (amount_vnd >= 0),
  slots integer not null check (slots >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'paid_late', 'expired', 'cancelled', 'underpaid', 'needs_review')),
  hold_expires_at timestamptz not null,
  paid_at timestamptz,
  confirmed_by uuid references app.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_idx on app.orders (status, hold_expires_at);
create index orders_user_idx on app.orders (user_id);

create table app.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app.users(id),
  created_by uuid not null references app.users(id),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  map_code text not null check (map_code in ('hall', 'carpet', 'tables', 'drive_in')),
  avatar_groups text[] not null,
  official_capacity integer not null check (official_capacity >= 1),
  waiting_enabled boolean not null,
  waiting_ratio numeric(5,4) not null,
  waiting_capacity integer not null check (waiting_capacity >= 0),
  total_slots integer not null check (total_slots = official_capacity + waiting_capacity),
  entry_mode text not null check (entry_mode in ('auto_assign', 'gate_entry')),
  invite_code text not null unique,
  password_hash text,
  status text not null default 'open' check (status in ('open', 'closed', 'expired')),
  is_trial boolean not null default false,
  order_id uuid references app.orders(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  close_reason text,
  -- Set exactly once when the room's slots go back to the system budget.
  slots_released_at timestamptz,
  screen_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index rooms_owner_idx on app.rooms (owner_id);
create index rooms_active_idx on app.rooms (status, expires_at) where slots_released_at is null;

alter table app.orders add constraint orders_room_fk foreign key (room_id) references app.rooms(id);

create table app.room_owner_history (
  id bigserial primary key,
  room_id uuid not null references app.rooms(id),
  owner_id uuid not null references app.users(id),
  changed_by uuid references app.users(id),
  changed_at timestamptz not null default now()
);

create table app.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references app.orders(id),
  provider text not null check (provider in ('manual', 'webhook', 'demo')),
  provider_txn_id text,
  amount_vnd bigint not null,
  outcome text not null,
  raw jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  recorded_by uuid references app.users(id),
  unique (provider, provider_txn_id)
);

create table app.trial_usages (
  id bigserial primary key,
  user_id uuid not null references app.users(id),
  room_id uuid not null references app.rooms(id),
  created_at timestamptz not null default now()
);
create index trial_usages_user_idx on app.trial_usages (user_id);

create table app.polls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references app.rooms(id),
  question text not null check (char_length(question) between 1 and 200),
  options jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by uuid not null references app.users(id),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz
);
create index polls_room_idx on app.polls (room_id, created_at);

create table app.poll_votes (
  poll_id uuid not null references app.polls(id),
  user_id uuid not null references app.users(id),
  option_id text not null,
  voted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

-- Room log. Ordinary proximity chat is NEVER written here; only messages the room owner
-- explicitly promotes to the stage screen (type = 'chat_promoted').
create table app.room_events (
  id bigserial primary key,
  room_id uuid not null references app.rooms(id),
  actor_id uuid references app.users(id),
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index room_events_room_idx on app.room_events (room_id, id);

create table app.system_events (
  id bigserial primary key,
  actor_id uuid references app.users(id),
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table app.uploads (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references app.rooms(id),
  owner_id uuid not null references app.users(id),
  storage_path text not null,
  mime text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  delete_after timestamptz not null,
  deleted_at timestamptz
);

-- Defence in depth for Supabase: even if someone exposes schema "app" in the API settings,
-- the client roles get nothing. (Roles do not exist on plain Postgres/PGlite, hence the guard.)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app from anon, authenticated';
    execute 'revoke all on all tables in schema app from anon, authenticated';
  end if;
end $$;
