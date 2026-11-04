-- OPTIONAL one-time cleanup for the AllOnline Supabase project (lhyessbzkmmurkwlsdzc ONLY).
-- Removes the first prototype objects (supabase/legacy/001–005) that were exposed through the
-- public API and allowed users to edit their own role / seat. The new schema lives in "app"
-- and is created automatically by the server (db/migrations).
--
-- Review before running. Do NOT run this on any other project (e.g. goixe5sao.vn).

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists private.handle_new_user();
drop function if exists public.create_room(text, text, text, text, integer, boolean, numeric, text, text, timestamptz);
drop function if exists public.join_room_by_invite(text, text, text);
-- The legacy RLS policies reference each other's tables, so drop all five together.
-- CASCADE only removes those policies / foreign keys between these five tables.
drop table if exists public.room_members, public.room_seats, public.rooms, public.app_settings, public.profiles cascade;
