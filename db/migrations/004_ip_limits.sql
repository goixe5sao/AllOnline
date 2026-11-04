-- Per-IP limits. Only an HMAC hash of the client IP is stored (never the raw address).
alter table app.settings add column if not exists ip_limit_room_creator boolean not null default true;
alter table app.settings add column if not exists ip_limit_participant boolean not null default true;
alter table app.rooms add column if not exists creator_ip_hash text;
alter table app.orders add column if not exists creator_ip_hash text;
create index if not exists rooms_creator_ip_idx on app.rooms (creator_ip_hash) where slots_released_at is null;
create index if not exists orders_creator_ip_idx on app.orders (creator_ip_hash) where status = 'pending';
