-- Repair the RPC grants if the function was created before the auth role was ready.
grant usage on schema public to authenticated;
grant execute on function public.create_room(text, text, text, text, integer, boolean, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.join_room_by_invite(text, text, text) to authenticated;
