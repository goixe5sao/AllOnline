-- Phase 1 (2026-11-05):
--   * Q&A: questions asked in a room, one upvote per account, moderated by the room owner / co-hosts
--   * co-hosts (room moderators) — can run the stage, polls, Q&A and kick; cannot close, pay or transfer
--   * event schedule: optional start time + reminders (sent by the Zalo bot when linked)
--   * attendance statistics sampled every minute (owner report / CSV)
--   * bank transactions (SePay webhook) and payment proofs (screenshots sent to the Zalo bot)
--   * external identities (Zalo login, Zalo OA follower) and a tiny key/value store (OA tokens)

create table if not exists app.room_questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references app.rooms(id) on delete cascade,
  user_id uuid not null references app.users(id),
  author_name text not null,
  text text not null check (char_length(text) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'answered', 'hidden')),
  upvotes integer not null default 0,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists room_questions_room_idx on app.room_questions (room_id, created_at);

create table if not exists app.room_question_votes (
  question_id uuid not null references app.room_questions(id) on delete cascade,
  user_id uuid not null references app.users(id),
  created_at timestamptz not null default now(),
  primary key (question_id, user_id)
);

create table if not exists app.room_moderators (
  room_id uuid not null references app.rooms(id) on delete cascade,
  user_id uuid not null references app.users(id),
  added_by uuid references app.users(id),
  added_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- planned start of the event (rooms.starts_at already means "opened at")
alter table app.rooms add column if not exists scheduled_at timestamptz;

create table if not exists app.room_reminders (
  room_id uuid not null references app.rooms(id) on delete cascade,
  user_id uuid not null references app.users(id),
  created_at timestamptz not null default now(),
  sent_soon_at timestamptz,
  sent_start_at timestamptz,
  primary key (room_id, user_id)
);

create table if not exists app.room_stats (
  room_id uuid not null references app.rooms(id) on delete cascade,
  at timestamptz not null,
  connections integer not null,
  seated integer not null,
  waiting integer not null,
  reactions integer not null default 0,
  chats integer not null default 0,
  primary key (room_id, at)
);

create table if not exists app.bank_transactions (
  id text primary key,                         -- '<provider>:<provider id>'
  provider text not null,
  amount_vnd bigint not null,
  content text not null default '',
  account_no text,
  reference text,
  occurred_at timestamptz,
  order_code text,
  outcome text,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists bank_transactions_code_idx on app.bank_transactions (order_code);

create table if not exists app.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app.users(id),
  order_id uuid references app.orders(id),
  source text not null default 'zalo',
  image_url text,
  extracted jsonb not null default '{}',
  status text not null default 'waiting_bank'
    check (status in ('waiting_bank', 'matched', 'approved', 'pending_review', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  reviewed_by uuid references app.users(id),
  reviewed_at timestamptz
);
create index if not exists payment_proofs_status_idx on app.payment_proofs (status, created_at);

create table if not exists app.user_identities (
  provider text not null check (provider in ('zalo', 'zalo_oa')),
  provider_uid text not null,
  user_id uuid not null references app.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  primary key (provider, provider_uid)
);
create index if not exists user_identities_user_idx on app.user_identities (user_id);

create table if not exists app.kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app.payments drop constraint if exists payments_provider_check;
alter table app.payments add constraint payments_provider_check check (provider in ('manual', 'webhook', 'demo', 'promo', 'sepay', 'receipt'));

-- Screenshot receipts are approved automatically only up to this amount (0 = never; a bank
-- transaction match is always required above it). Fake screenshots are easy to make.
alter table app.settings add column if not exists receipt_auto_approve_max_vnd bigint not null default 0 check (receipt_auto_approve_max_vnd >= 0);
alter table app.settings add column if not exists reminder_minutes_before integer not null default 60 check (reminder_minutes_before between 5 and 1440);
