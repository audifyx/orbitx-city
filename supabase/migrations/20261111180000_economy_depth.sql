-- Economy depth (polish pass): job streaks, player-run businesses, rent +
-- utilities, and self-serve HQ branding. Idempotent; safe to re-run.
alter table public.players
  add column if not exists job_streak integer not null default 0;
alter table public.players
  add column if not exists business jsonb not null default '{}'::jsonb;
alter table public.players
  add column if not exists rent jsonb not null default '{}'::jsonb;
alter table public.properties
  add column if not exists brand jsonb not null default '{}'::jsonb;
