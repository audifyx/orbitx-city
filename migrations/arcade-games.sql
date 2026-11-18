-- Mini-Games Hub (Neon Arcade): 2-player PvP pot games in real ORBITX.
-- One row per game; the row is the matchmaking authority (a creator and
-- a joiner on different lambda instances see the same game). The escrow
-- keypair lives in arcade_state (one row, id='escrow'), sealed with
-- WALLET_MASTER_KEY by the server — the secret never leaves the server.
-- Apply to Supabase blue-chair (okeydwkyepdusmldivpf). Idempotent.
CREATE TABLE IF NOT EXISTS arcade_games (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  joiner_id TEXT NOT NULL DEFAULT '',
  game TEXT NOT NULL,
  tier_usd INTEGER NOT NULL,
  entry_raw TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL,
  creator_name TEXT NOT NULL DEFAULT '',
  creator_pick TEXT NOT NULL DEFAULT '',
  creator_address TEXT NOT NULL DEFAULT '',
  joiner_name TEXT NOT NULL DEFAULT '',
  joiner_pick TEXT NOT NULL DEFAULT '',
  joiner_address TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  winner_id TEXT NOT NULL DEFAULT '',
  winner_name TEXT NOT NULL DEFAULT '',
  payout_signature TEXT NOT NULL DEFAULT '',
  refund_signature TEXT NOT NULL DEFAULT '',
  entry_signature TEXT NOT NULL DEFAULT '',
  joiner_entry_signature TEXT NOT NULL DEFAULT '',
  message_hash TEXT NOT NULL DEFAULT '',
  joiner_message_hash TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  join_expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  error TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS arcade_games_status_idx ON arcade_games (status, created_at DESC);
CREATE INDEX IF NOT EXISTS arcade_games_user_idx ON arcade_games (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arcade_games_joiner_idx ON arcade_games (joiner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arcade_games_key_idx ON arcade_games (idempotency_key);

CREATE TABLE IF NOT EXISTS arcade_state (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL DEFAULT '',
  sealed JSONB,
  funded BOOLEAN NOT NULL DEFAULT FALSE,
  ata_ready BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
