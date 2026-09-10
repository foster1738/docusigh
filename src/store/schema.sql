-- Outbox schema for PostgresOutboxStore / PostgresSuppressionStore.
-- Apply with your migration tool of choice (or `psql -f schema.sql`).

CREATE TABLE IF NOT EXISTS email_outbox (
  id                  TEXT PRIMARY KEY,
  idempotency_key     TEXT NOT NULL UNIQUE,
  message             JSONB NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued','sending','sent','failed','dead','suppressed','cancelled','bounced')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL,
  next_attempt_at     TIMESTAMPTZ NOT NULL,
  lease_owner         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  provider            TEXT,
  provider_message_id TEXT,
  last_error          TEXT,
  history             JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata            JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

-- The worker polls for due work; this partial index keeps that cheap even
-- with millions of sent rows.
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox (next_attempt_at)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS email_outbox_lease_idx
  ON email_outbox (lease_expires_at)
  WHERE status = 'sending';

CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox (status, created_at);

CREATE INDEX IF NOT EXISTS email_outbox_provider_message_idx
  ON email_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_suppressions (
  email       TEXT PRIMARY KEY,
  reason      TEXT NOT NULL CHECK (reason IN ('bounce','complaint','unsubscribe','manual')),
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
