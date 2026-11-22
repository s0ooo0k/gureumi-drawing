begin;
set local lock_timeout = '3s';

alter table public.gurumi_scores
  add column if not exists is_visible boolean not null default true;

commit;
