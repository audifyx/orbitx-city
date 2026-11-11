-- Voice signaling for key-free mesh WebRTC.
-- Voice offers/answers/ICE candidates must survive across Vercel serverless
-- instances, so they live in Supabase (not per-instance memory or Upstash).
-- The service role is the only writer; browsers never read this table
-- (signals are delivered through POST /api/city only).

create table if not exists public.voice_signals (
  id uuid primary key default gen_random_uuid(),
  from_id text not null,
  to_id text not null,
  room text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists voice_signals_to_created_idx
  on public.voice_signals (to_id, created_at desc);

alter table public.voice_signals enable row level security;

-- No select or write policy: the service role bypasses RLS and is the
-- only reader/writer. Browsers get signals via the /api/city endpoint.
revoke insert, update, delete on table public.voice_signals from anon, authenticated;
revoke select on table public.voice_signals from anon, authenticated;
