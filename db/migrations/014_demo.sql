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
