-- Discount codes. Validated and counted on the server inside the order transaction.
create table if not exists app.promo_codes (
  code text primary key check (code = upper(code) and char_length(code) between 3 and 32),
  percent_off integer not null check (percent_off between 1 and 100),
  active boolean not null default true,
  max_uses integer check (max_uses is null or max_uses > 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  used_count integer not null default 0,
  valid_from timestamptz,
  valid_to timestamptz,
  note text not null default '',
  created_by uuid references app.users(id),
  created_at timestamptz not null default now()
);

create table if not exists app.promo_redemptions (
  id bigserial primary key,
  code text not null references app.promo_codes(code),
  user_id uuid not null references app.users(id),
  order_id uuid not null references app.orders(id),
  percent_off integer not null,
  created_at timestamptz not null default now()
);
create index if not exists promo_redemptions_user_idx on app.promo_redemptions (code, user_id);

-- 100%-discount orders are confirmed by the server itself (provider 'promo').
alter table app.payments drop constraint if exists payments_provider_check;
alter table app.payments add constraint payments_provider_check check (provider in ('manual', 'webhook', 'demo', 'promo'));

-- Code requested by the project owner for testing.
insert into app.promo_codes (code, percent_off, note) values ('ASDFG', 100, 'Mã thử nghiệm giảm 100%') on conflict (code) do nothing;

alter table app.promo_codes enable row level security;
alter table app.promo_redemptions enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.promo_codes, app.promo_redemptions from anon, authenticated';
  end if;
end $$;
