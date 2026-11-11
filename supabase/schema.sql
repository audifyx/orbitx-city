-- Run this once in the Supabase SQL editor after you connect the project.
-- The game server uses the service role key. The anon key is only allowed to read
-- the live player list and chat, which is what the browser subscribes to.
-- Demo credits only. This is not a wallet and not a token.

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
