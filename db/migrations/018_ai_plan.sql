alter table app.users add column ai_plan text not null default 'basic' check (ai_plan in ('off','basic','vip'));
alter table app.users add column ai_plan_until timestamptz;
