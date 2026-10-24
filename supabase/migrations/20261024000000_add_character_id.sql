-- Existing event records remain readable; null identifies the legacy reference.
alter table public.gurumi_scores add column if not exists character_id text;
