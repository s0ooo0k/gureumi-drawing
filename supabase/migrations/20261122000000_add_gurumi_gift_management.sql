begin;

alter table public.gurumi_scores
  add column gift_received boolean not null default false;

create table public.gurumi_gift_settings (
  singleton boolean primary key default true check (singleton),
  minimum_score integer not null check (minimum_score between 1 and 100)
);

insert into public.gurumi_gift_settings (minimum_score) values (60);

alter table public.gurumi_gift_settings enable row level security;
revoke all on public.gurumi_gift_settings from anon, authenticated;
grant select, update on public.gurumi_gift_settings to service_role;

commit;
