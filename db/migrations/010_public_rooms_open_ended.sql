-- 1) Public listing on the home page: the room owner decides (default hidden for old rooms).
alter table app.rooms add column if not exists is_public boolean not null default false;
create index if not exists rooms_public_idx on app.rooms (created_at desc) where is_public and slots_released_at is null;

-- 2) Open-ended rooms ("mở vô thời hạn – đến khi tắt"): the owner pays a deposit up front,
--    the real cost (hours used × hourly rate) is settled when the room is closed.
alter table app.rooms add column if not exists open_ended boolean not null default false;
alter table app.rooms add column if not exists hourly_rate_vnd bigint check (hourly_rate_vnd is null or hourly_rate_vnd >= 0);

alter table app.settings add column if not exists open_ended_enabled boolean not null default true;
alter table app.settings add column if not exists open_ended_deposit_vnd bigint not null default 1000000 check (open_ended_deposit_vnd >= 0);

-- One settlement per open-ended room, written in the same transaction that closes the room.
-- balance_vnd = deposit - charge: > 0 → refund to the owner, < 0 → the owner still owes.
create table if not exists app.room_settlements (
  room_id uuid primary key references app.rooms(id),
  owner_id uuid not null references app.users(id),
  order_id uuid references app.orders(id),
  deposit_vnd bigint not null,
  hourly_rate_vnd bigint not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  billed_hours integer not null check (billed_hours >= 1),
  charge_vnd bigint not null,
  balance_vnd bigint not null,
  status text not null check (status in ('refund_due', 'collect_due', 'settled')),
  settled_at timestamptz,
  settled_by uuid references app.users(id),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists room_settlements_status_idx on app.room_settlements (status, created_at desc);
