-- AllOnline room creation, invite links and anonymous guest access.
-- Run once after 001_initial_schema.sql and 002_auth_profile_trigger.sql.

alter table public.rooms add column if not exists invite_code text;
alter table public.rooms add column if not exists password_hash text;
alter table public.rooms add column if not exists guests_enabled boolean not null default true;

update public.rooms
set invite_code = encode(gen_random_bytes(8), 'hex')
where invite_code is null;

alter table public.rooms alter column invite_code set not null;
create unique index if not exists rooms_invite_code_uidx on public.rooms(invite_code);

drop policy if exists "members can read open rooms" on public.rooms;
create policy "members can read joined or owned rooms"
  on public.rooms for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id and m.user_id = (select auth.uid()) and m.status not in ('left', 'removed')
    )
  );

drop policy if exists "members can read seats in open rooms" on public.room_seats;
create policy "members can read seats in their rooms"
  on public.room_seats for select to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_seats.room_id
        and (
          r.owner_id = (select auth.uid())
          or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = (select auth.uid()) and m.status not in ('left', 'removed'))
        )
    )
  );

create or replace function public.create_room(
  p_name text,
  p_description text,
  p_map_type text,
  p_avatar_group text,
  p_official_capacity integer,
  p_waiting_enabled boolean,
  p_waiting_ratio numeric,
  p_entry_mode text,
  p_password text default null,
  p_expires_at timestamptz default null
)
returns table (room_id uuid, invite_code text, total_slots integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_budget integer;
  v_used integer;
  v_waiting integer := case when p_waiting_enabled then floor(p_official_capacity * coalesce(p_waiting_ratio, 0.20))::integer else 0 end;
  v_total integer := p_official_capacity + v_waiting;
  v_room public.rooms;
begin
  if v_owner is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_official_capacity < 1 or p_official_capacity > 100 then raise exception 'INVALID_CAPACITY'; end if;
  if coalesce(p_waiting_ratio, 0.20) < 0 or coalesce(p_waiting_ratio, 0.20) > 1 then raise exception 'INVALID_WAITING_RATIO'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'INVALID_ROOM_NAME'; end if;

  select total_slot_budget into v_budget from public.app_settings where id = 'default' for update;
  select coalesce(sum(r.total_slots), 0) into v_used from public.rooms r where r.status in ('draft', 'open');
  if v_used + v_total > v_budget then raise exception 'SLOT_BUDGET_EXCEEDED'; end if;

  insert into public.rooms (owner_id, name, description, map_type, avatar_group, official_capacity, waiting_enabled, waiting_ratio, entry_mode, expires_at, password_hash)
  values (v_owner, trim(p_name), coalesce(p_description, ''), p_map_type, p_avatar_group, p_official_capacity, p_waiting_enabled, coalesce(p_waiting_ratio, 0.20), p_entry_mode, p_expires_at, case when nullif(trim(coalesce(p_password, '')), '') is null then null else crypt(p_password, gen_salt('bf')) end)
  returning * into v_room;

  return query select v_room.id, v_room.invite_code, v_room.total_slots;
end;
$$;

create or replace function public.join_room_by_invite(
  p_invite_code text,
  p_password text default null,
  p_display_name text default 'Khách'
)
returns table (room_id uuid, member_id uuid, room_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_room public.rooms;
  v_member uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_room from public.rooms r
  where r.invite_code = lower(trim(p_invite_code)) and r.status = 'open' and r.guests_enabled = true;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.password_hash is not null and crypt(coalesce(p_password, ''), v_room.password_hash) <> v_room.password_hash then raise exception 'INVALID_ROOM_PASSWORD'; end if;

  insert into public.profiles (id, display_name)
  values (v_user, left(coalesce(nullif(trim(p_display_name), ''), 'Khách'), 80))
  on conflict (id) do update set display_name = excluded.display_name, updated_at = now();

  insert into public.room_members (room_id, user_id, status, last_seen_at)
  values (v_room.id, v_user, 'waiting', now())
  on conflict (room_id, user_id) do update set status = 'waiting', last_seen_at = now(), left_at = null
  returning id into v_member;

  return query select v_room.id, v_member, v_room.name;
end;
$$;

revoke execute on function public.create_room(text, text, text, text, integer, boolean, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.create_room(text, text, text, text, integer, boolean, numeric, text, text, timestamptz) to authenticated;
revoke execute on function public.join_room_by_invite(text, text, text) from public, anon;
grant execute on function public.join_room_by_invite(text, text, text) to authenticated;
