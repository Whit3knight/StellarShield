CREATE TABLE IF NOT EXISTS stellar_shield_events (
  id               text PRIMARY KEY,
  contract_id      text NOT NULL,
  topics           text NOT NULL,
  data             text NOT NULL,
  transaction_hash text NOT NULL,
  transaction_index bigint NOT NULL,
  ledger_sequence  bigint NOT NULL,
  ledger_closed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS stellar_shield_events_ledger_idx
  ON stellar_shield_events (contract_id, ledger_sequence);
