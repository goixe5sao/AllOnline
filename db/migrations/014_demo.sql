-- "Phòng trải nghiệm": always-open rooms to try the service before signing up (not billed, no slots).
alter table app.rooms add column if not exists is_demo boolean not null default false;
-- Minutes per person (device / network) per day; 0 = demo rooms hidden.
alter table app.settings add column if not exists demo_minutes_per_day integer not null default 5 check (demo_minutes_per_day between 0 and 1440);
-- Seconds used per day: who = 'dev:<device id>' or 'ip:<ip hash>' (no personal data).
create table if not exists app.demo_usage (
  day date not null,
  who text not null,
  seconds integer not null default 0,
  primary key (day, who)
);

-- Defence in depth for Supabase (same as 001): every table in schema "app" — including the new
-- demo_usage and the tables added since 001 (kv, identities, payments…) — has row level security,
-- and the client roles get nothing. The server connects as the table owner, so it is not affected.
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
