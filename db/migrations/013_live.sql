-- Live camera on the stage screen (media via Cloudflare Realtime; this server only decides who).
-- live_mode: off | mods (owner + co-hosts) | approve (viewers ask, a moderator approves) | auto.
alter table app.rooms add column if not exists live_mode text not null default 'approve' check (live_mode in ('off', 'mods', 'approve', 'auto'));
-- Monthly cap on estimated live traffic (GB); 0 = live disabled. Cloudflare's free tier is 1000 GB/month.
alter table app.settings add column if not exists live_monthly_cap_gb integer not null default 800 check (live_monthly_cap_gb between 0 and 100000);
