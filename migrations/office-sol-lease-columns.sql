-- Office leases in real SOL (office-sol-* ops).
-- Apply to Supabase (project blue-chair) BEFORE the real-economy push
-- goes live, or SOL leases degrade to in-memory only in production:
-- the claim upsert errors on the missing columns and the lease is only
-- recorded on the serving instance.
--
-- The Neon path adds these columns itself (ensureSchema in api/city.js);
-- this file is the Supabase equivalent. Safe to run twice.

alter table public.office_claims
  add column if not exists paid text not null default 'city',
  add column if not exists sol_lamports bigint not null default 0,
  add column if not exists burn_signature text not null default '',
  add column if not exists orbitx_amount text not null default '',
  add column if not exists order_id text not null default '';

-- The lease order store (payment + burn receipt), mirroring ad_orders.
create table if not exists public.office_leases (
  id text primary key,
  user_id text not null,
  player_id text not null default '',
  suite text not null,
  server_id integer not null default 1,
  tier text not null default 'standard',
  days integer not null,
  extend boolean not null default false,
  project text not null default '',
  logo text not null default '',
  site text not null default '',
  status text not null,
  sol_lamports bigint not null default 0,
  price_usd numeric not null default 0,
  orbitx_amount text not null default '0',
  swap_signature text not null default '',
  burn_signature text not null default '',
  idempotency_key text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists office_leases_user_idx on public.office_leases (user_id, created_at desc);
create index if not exists office_leases_key_idx on public.office_leases (idempotency_key);
