-- Limits are per DEVICE (random signed browser id), not per IP: an office/school/cafe of many
-- people often shares one public IP (and mobile carriers use CGNAT), so IP rules block real users.
--   * one participant per device at a time
--   * one room-creating account per device (open room / pending order)
-- ip_max_participants stays available as an optional cap (0 = unlimited, the default).
alter table app.settings rename column ip_limit_room_creator to device_limit_room_creator;
alter table app.settings drop column if exists ip_limit_participant;
alter table app.settings add column if not exists ip_max_participants integer not null default 0 check (ip_max_participants >= 0);

alter table app.rooms add column if not exists creator_device_hash text;
alter table app.orders add column if not exists creator_device_hash text;
create index if not exists rooms_creator_device_idx on app.rooms (creator_device_hash) where slots_released_at is null;
create index if not exists orders_creator_device_idx on app.orders (creator_device_hash) where status = 'pending';

-- Fair voting: a poll can require a registered account (guests can still see the results).
alter table app.polls add column if not exists verified_only boolean not null default false;
