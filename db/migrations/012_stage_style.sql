-- Stage look chosen by the room owner: 'glam' (neon frame, velvet curtains, light beams, sparkles —
-- like the home page) or 'plain' (the original single-colour hall). Changeable while the room is open.
alter table app.rooms add column if not exists stage_style text not null default 'plain' check (stage_style in ('plain', 'glam'));
