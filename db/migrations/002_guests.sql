-- Guests: people who join through an invite link with only a display name + avatar.
-- A guest identity is created by the server and bound to a signed browser cookie.
-- Guests can attend, chat and vote; they cannot create rooms, pay, or administer.
alter table app.users add column if not exists is_guest boolean not null default false;
alter table app.settings add column if not exists guest_join_enabled boolean not null default true;
