-- OrbitX City accounts and in-app wallets.
-- Apply only to Supabase project supabase-blue-chair
-- (ref okeydwkyepdusmldivpf, region us-east-1). Do not run this on any other project.
-- Idempotent. Run 20261111120000_city.sql first. This file is second.
-- The service role is the only writer for balances and keys.

alter table public.players add column if not exists email text not null default '';
alter table public.players add column if not exists avatar text not null default '';
alter table public.players add column if not exists provider text not null default '';
alter table public.players add column if not exists auth_user text not null default '';
alter table public.players add column if not exists address text not null default '';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default '',
  avatar text not null default '',
  look text not null default 'tjr',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

alter table public.players enable row level security;
drop policy if exists players_select_own on public.players;
create policy players_select_own on public.players
  for select to authenticated using (id = auth.uid()::text);

-- No insert, update, or delete policy on players. A signed-in browser cannot change a balance.
-- The service role bypasses RLS and is what /api/city uses.

create table if not exists public.friendships (
  user_id text not null,
  friend_id text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
alter table public.friendships enable row level security;
drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships
  for select to authenticated using (user_id = auth.uid()::text or friend_id = auth.uid()::text);

alter table public.bookings add column if not exists owner_id text not null default '';
alter table public.bookings enable row level security;
drop policy if exists bookings_select_own on public.bookings;
create policy bookings_select_own on public.bookings
  for select to authenticated using (owner_id = auth.uid()::text);

alter table public.properties enable row level security;
drop policy if exists properties_select_own on public.properties;
create policy properties_select_own on public.properties
  for select to authenticated using (owner_id = auth.uid()::text);

-- Encrypted key material. No policy and no grant for the browser roles.
create table if not exists public.wallet_secrets (
  user_id text primary key,
  public_key text not null,
  wrapped_key text not null,
  wrap_iv text not null,
  wrap_tag text not null,
  secret_iv text not null,
  secret_tag text not null,
  secret_ct text not null,
  created_at timestamptz not null default now()
);
alter table public.wallet_secrets enable row level security;
revoke all on table public.wallet_secrets from anon, authenticated;

create table if not exists public.wallet_audit (
  id text primary key,
  user_id text not null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
alter table public.wallet_audit enable row level security;
revoke all on table public.wallet_audit from anon, authenticated;

create table if not exists public.wallet_ledger (
  id text primary key,
  user_id text not null,
  idempotency_key text not null,
  destination text not null,
  amount text not null,
  unit text not null default 'SOL',
  status text not null,
  signature text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
alter table public.wallet_ledger enable row level security;
drop policy if exists ledger_select_own on public.wallet_ledger;
create policy ledger_select_own on public.wallet_ledger
  for select to authenticated using (user_id = auth.uid()::text);
revoke insert, update, delete on table public.wallet_ledger from anon, authenticated;
