-- OrbitX City world tables.
-- Apply only to Supabase project supabase-blue-chair
-- (ref okeydwkyepdusmldivpf, region us-east-1). Do not run this on any other project.
-- Idempotent. This file is first. 20261111140000_auth_and_wallets.sql is second.

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
  earned integer not null default 0,
  best_race integer not null default 0,
  best_hover integer not null default 0,
  daily jsonb not null default '{}'::jsonb,
  wallet text not null default '',
  holder boolean not null default false,
  email text not null default '',
  avatar text not null default '',
  provider text not null default '',
  auth_user text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.players add column if not exists look text not null default 'tjr';
alter table public.players add column if not exists earned integer not null default 0;
alter table public.players add column if not exists best_race integer not null default 0;
alter table public.players add column if not exists best_hover integer not null default 0;
alter table public.players add column if not exists daily jsonb not null default '{}'::jsonb;
alter table public.players add column if not exists wallet text not null default '';
alter table public.players add column if not exists holder boolean not null default false;
alter table public.players add column if not exists email text not null default '';
alter table public.players add column if not exists avatar text not null default '';
alter table public.players add column if not exists provider text not null default '';
alter table public.players add column if not exists auth_user text not null default '';
alter table public.players add column if not exists address text not null default '';

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
  burned integer not null default 0,
  owner_id text not null default ''
);

alter table public.bookings add column if not exists owner_id text not null default '';

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
alter table public.properties enable row level security;
alter table public.announcements enable row level security;
alter table public.presence enable row level security;
alter table public.chat enable row level security;
alter table public.bookings enable row level security;
alter table public.events enable row level security;
alter table public.parties enable row level security;

-- The browser may read the live list and chat. It cannot write them.
drop policy if exists presence_read on public.presence;
create policy presence_read on public.presence
  for select to anon, authenticated using (true);

drop policy if exists chat_read on public.chat;
create policy chat_read on public.chat
  for select to anon, authenticated using (true);

drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select to anon, authenticated using (true);

-- No select or write policy on announcements or parties.
-- The service role bypasses RLS and is the only writer for every table above.
revoke insert, update, delete on table public.players from anon, authenticated;
revoke insert, update, delete on table public.properties from anon, authenticated;
revoke insert, update, delete on table public.announcements from anon, authenticated;
revoke insert, update, delete on table public.presence from anon, authenticated;
revoke insert, update, delete on table public.chat from anon, authenticated;
revoke insert, update, delete on table public.bookings from anon, authenticated;
revoke insert, update, delete on table public.events from anon, authenticated;
revoke insert, update, delete on table public.parties from anon, authenticated;

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
