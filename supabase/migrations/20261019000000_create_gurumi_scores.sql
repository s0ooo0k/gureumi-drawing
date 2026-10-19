begin;

create table public.gurumi_scores (
  id text primary key,
  name text not null,
  score integer not null check (score between 0 and 100),
  calibrated double precision not null,
  raw double precision not null,
  semantic double precision not null,
  global_score double precision not null,
  density_ratio double precision not null,
  overdraw_efficiency double precision not null,
  orientation_entropy double precision not null,
  loop_monotony double precision not null,
  part_scores jsonb not null,
  score_details jsonb not null,
  strokes text not null,
  point_count integer not null check (point_count >= 0),
  created_at timestamptz not null,
  score_version text not null
);
create index gurumi_scores_ranking on public.gurumi_scores
  (score desc, calibrated desc, raw desc, created_at asc);
create index gurumi_scores_created_at on public.gurumi_scores (created_at desc);

-- All access goes through server-side Next.js handlers. No browser policies.
alter table public.gurumi_scores enable row level security;
revoke all on public.gurumi_scores from anon, authenticated;
grant select, insert, update, delete on public.gurumi_scores to service_role;

commit;
