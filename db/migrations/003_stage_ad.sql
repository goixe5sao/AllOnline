-- Persistent clickable promo strip on every stage screen (configurable by the app owner).
alter table app.settings add column if not exists stage_ad_enabled boolean not null default true;
alter table app.settings add column if not exists stage_ad_text text not null default 'Gọi xe 5 sao — đặt xe nhanh tại goixe5sao.vn';
alter table app.settings add column if not exists stage_ad_url text not null default 'https://goixe5sao.vn';
alter table app.settings add constraint settings_stage_ad_url_https check (stage_ad_url like 'https://%');
