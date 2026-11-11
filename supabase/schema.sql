-- Run this once in the Supabase SQL editor after you connect the project.
-- The game server uses the service role key. The anon key is only allowed to read
-- the live player list and chat, which is what the browser subscribes to.
-- Demo credits only. In-app wallet tables are at the bottom of this file
-- and in supabase/migrations/20261111140000_auth_and_wallets.sql.

create table if not exists public.players (
  id text primary key,
  token text unique not null,
  name text not null,
  balance integer not null default 250,
  burned integer not null default 0,
  owned jsonb not null default '[]'::jsonb,
  color text not null default 'white',
  hat text not null default 'none',
  car text not null default 'black',
  friends jsonb not null default '[]'::jsonb,
  inbox jsonb not null default '[]'::jsonb,
  job jsonb,
  party text not null default '',
  mission integer not null default 0,
  mission_at bigint not null default 0,
  look text not null default 'tjr',
  updated_at timestamptz not null default now()
);

alter table public.players add column if not exists look text not null default 'tjr';
alter table public.players add column if not exists earned integer not null default 0;
alter table public.players add column if not exists best_race integer not null default 0;
alter table public.players add column if not exists best_hover integer not null default 0;
alter table public.players add column if not exists daily jsonb not null default '{}'::jsonb;
alter table public.players add column if not exists wallet text not null default '';
alter table public.players add column if not exists holder boolean not null default false;

create table if not exists public.properties (
  id text primary key,
  owner_id text not null default '',
  owner_name text not null default '',
  furniture jsonb not null default '[]'::jsonb
);

create table if not exists public.announcements (
  id text primary key,
  text text not null default '',
  author text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.properties enable row level security;
alter table public.announcements enable row level security;

create table if not exists public.presence (
  id text primary key,
  state jsonb not null,
  seen timestamptz not null default now()
);

create table if not exists public.chat (
  id bigint generated always as identity primary key,
  player_id text,
  name text,
  text text,
  scope text,
  x double precision,
  z double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id text primary key,
  project text not null,
  text text not null,
  start text not null,
  "end" text not null,
  burned integer not null default 0
);

create table if not exists public.events (
  id text primary key,
  title text not null,
  place text not null,
  when_at text not null,
  detail text not null
);

create table if not exists public.parties (
  id text primary key,
  members jsonb not null default '[]'::jsonb
);

alter table public.players enable row level security;
alter table public.presence enable row level security;
alter table public.chat enable row level security;
alter table public.bookings enable row level security;
alter table public.events enable row level security;
alter table public.parties enable row level security;

drop policy if exists presence_read on public.presence;
create policy presence_read on public.presence for select to anon, authenticated using (true);

drop policy if exists chat_read on public.chat;
create policy chat_read on public.chat for select to anon, authenticated using (true);

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (true);

-- Balances, bookings, and parties have no anon policy.
-- The service role key bypasses RLS and is the only writer.

do $$
begin
  alter publication supabase_realtime add table public.presence;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.chat;
exception when duplicate_object then null;
end $$;

-- Accounts, RLS for a player's own rows, and the custodial wallet tables.
-- Same statements as supabase/migrations/20261111140000_auth_and_wallets.sql.

-- OrbitX City accounts and in-app wallets.
-- Safe to run more than once. The service role is the only writer for balances and keys.
-- Apply with the Supabase SQL editor, or `supabase db push` if you use the CLI.

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
