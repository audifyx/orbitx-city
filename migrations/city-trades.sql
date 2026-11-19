-- Trading Floor (OrbitX exchange hall): real Solana swaps via Jupiter.
-- One row per trade; the row is the compose/submit authority (the
-- server composes, the device signs once, the server verifies + broadcasts).
-- Apply to Supabase blue-chair. Idempotent.
CREATE TABLE IF NOT EXISTS city_trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  player_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  input_amount TEXT NOT NULL DEFAULT '0',
  expected_out TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS city_trades_status_idx ON city_trades (status, created_at DESC);
CREATE INDEX IF NOT EXISTS city_trades_user_idx ON city_trades (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS city_trades_key_idx ON city_trades (idempotency_key);
