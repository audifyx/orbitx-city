-- Real billboard ads: order ledger + burn receipts on bookings.
-- Idempotent: safe to run more than once.

create table if not exists public.ad_orders (
  id text primary key,
  user_id text not null default '',
  player_id text not null default '',
  board_id text not null default '',
  days integer not null default 0,
  project text not null default '',
  text text not null default '',
  status text not null default 'processing',
  sol_lamports bigint not null default 0,
  orbitx_amount text not null default '',
  swap_signature text not null default '',
  burn_signature text not null default '',
  idempotency_key text not null default '',
  error text not null default '',
  expires_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ad_orders_idempotency_key_unique
  on public.ad_orders (idempotency_key) where idempotency_key <> '';

create index if not exists ad_orders_user_created_idx
  on public.ad_orders (user_id, created_at desc);

-- Burn receipts on the booking itself: which swap bought the ORBITX and
-- which transaction burned it. The board still renders from the same row.
alter table public.bookings add column if not exists swap_signature text not null default '';
alter table public.bookings add column if not exists burn_signature text not null default '';
alter table public.bookings add column if not exists status text not null default 'live';
alter table public.bookings add column if not exists orbitx_amount text not null default '';
alter table public.bookings add column if not exists sol_lamports bigint not null default 0;

alter table public.ad_orders enable row level security;

-- The browser never reads or writes ad orders directly; the API (service
-- role) is the only writer, and it serves a user only their own orders.
revoke insert, update, delete on table public.ad_orders from anon, authenticated;
