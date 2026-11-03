-- AllOnline initial schema
-- Run once in the SQL Editor of project lhyessbzkmmurkwlsdzc.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Người dùng',
  avatar_url text,
  role text not null default 'participant'
    check (role in ('app_owner', 'room_owner', 'participant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id text primary key default 'default' check (id = 'default'),
  total_slot_budget integer not null default 100 check (total_slot_budget > 0),
  default_waiting_ratio numeric(5,4) not null default 0.20
    check (default_waiting_ratio >= 0 and default_waiting_ratio <= 1),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id) values ('default') on conflict (id) do nothing;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text not null default '',
  map_type text not null check (map_type in ('hall', 'carpet', 'tables', 'drive_in')),
  avatar_group text not null default 'people'
    check (avatar_group in ('people', 'animals', 'vehicles', 'mixed')),
  official_capacity integer not null check (official_capacity between 1 and 100),
  waiting_enabled boolean not null default true,
  waiting_ratio numeric(5,4) not null default 0.20
    check (waiting_ratio >= 0 and waiting_ratio <= 1),
  waiting_capacity integer generated always as (
    case when waiting_enabled then floor(official_capacity * waiting_ratio)::integer else 0 end
  ) stored,
  total_slots integer generated always as (
    official_capacity + case when waiting_enabled then floor(official_capacity * waiting_ratio)::integer else 0 end
  ) stored,
  entry_mode text not null default 'auto_assign'
    check (entry_mode in ('auto_assign', 'gate_entry')),
  status text not null default 'open'
    check (status in ('draft', 'open', 'expired', 'closed')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rooms_owner_id_idx on public.rooms(owner_id);
create index rooms_status_idx on public.rooms(status);

create table public.room_seats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat_number integer not null check (seat_number > 0),
  label text not null,
  position jsonb not null default '{}'::jsonb,
  is_waiting_area boolean not null default false,
  created_at timestamptz not null default now(),
  unique (room_id, seat_number)
);

create index room_seats_room_id_idx on public.room_seats(room_id);

create table public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat_id uuid references public.room_seats(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'finding_seat', 'seated', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  unique (room_id, user_id)
);

create index room_members_room_id_idx on public.room_members(room_id);
create index room_members_user_id_idx on public.room_members(user_id);

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.rooms enable row level security;
alter table public.room_seats enable row level security;
alter table public.room_members enable row level security;

create policy "users can read own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "users can create own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "users can update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "members can read open rooms"
  on public.rooms for select to authenticated
  using (status = 'open' or owner_id = (select auth.uid()));

create policy "users can create rooms for themselves"
  on public.rooms for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "owners can update their rooms"
  on public.rooms for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners can delete their rooms"
  on public.rooms for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "members can read seats in open rooms"
  on public.room_seats for select to authenticated
  using (exists (
    select 1 from public.rooms r
    where r.id = room_seats.room_id
      and (r.status = 'open' or r.owner_id = (select auth.uid()))
  ));

create policy "room owners can manage seats"
  on public.room_seats for all to authenticated
  using (exists (
    select 1 from public.rooms r
    where r.id = room_seats.room_id and r.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.rooms r
    where r.id = room_seats.room_id and r.owner_id = (select auth.uid())
  ));

create policy "users can read their memberships"
  on public.room_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid()))
  );

create policy "users can join as themselves"
  on public.room_members for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "users and owners can update memberships"
  on public.room_members for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid()))
  );

create policy "users and owners can leave memberships"
  on public.room_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.rooms r where r.id = room_members.room_id and r.owner_id = (select auth.uid()))
  );
