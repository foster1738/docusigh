import type { EmailAttempt, EmailStatus, OutboxRecord, SuppressionEntry } from "../types.js";
import type { ClaimOptions, OutboxStats, OutboxStore, SuppressionStore } from "./types.js";

/**
 * Minimal subset of `pg.Pool` / `pg.Client` we depend on, so callers can pass
 * a pool, a client, or a transaction-scoped client.
 */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

interface OutboxRow {
  id: string;
  idempotency_key: string;
  message: OutboxRecord["message"];
  status: EmailStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  provider: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  history: SerializedAttempt[];
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  sent_at: Date | null;
}

type SerializedAttempt = Omit<EmailAttempt, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string };

/**
 * Postgres-backed outbox. Uses `FOR UPDATE SKIP LOCKED` so any number of
 * worker processes can poll the same table without double-sending.
 * Schema: see `schema.sql` next to this file.
 */
export class PostgresOutboxStore implements OutboxStore {
  constructor(
    private readonly db: PgQueryable,
    private readonly table = "email_outbox",
  ) {}

  async insert(record: OutboxRecord): Promise<{ record: OutboxRecord; created: boolean }> {
    const res = await this.db.query(
      `INSERT INTO ${this.table}
         (id, idempotency_key, message, status, attempts, max_attempts, next_attempt_at,
          lease_owner, lease_expires_at, provider, provider_message_id, last_error, history,
          metadata, created_at, updated_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      toRowValues(record),
    );
    const row = res.rows[0] as OutboxRow | undefined;
    if (row) return { record: fromRow(row), created: true };
    const existing = await this.getByIdempotencyKey(record.idempotencyKey);
    if (!existing) throw new Error("Insert conflicted but existing record could not be loaded");
    return { record: existing, created: false };
  }

  async get(id: string): Promise<OutboxRecord | null> {
    const res = await this.db.query(`SELECT * FROM ${this.table} WHERE id = $1`, [id]);
    const row = res.rows[0] as OutboxRow | undefined;
    return row ? fromRow(row) : null;
  }

  async getByIdempotencyKey(key: string): Promise<OutboxRecord | null> {
    const res = await this.db.query(`SELECT * FROM ${this.table} WHERE idempotency_key = $1`, [key]);
    const row = res.rows[0] as OutboxRow | undefined;
    return row ? fromRow(row) : null;
  }

  async claim({ workerId, limit, leaseMs, now }: ClaimOptions): Promise<OutboxRecord[]> {
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const res = await this.db.query(
      `WITH due AS (
         SELECT id FROM ${this.table}
         WHERE (status IN ('queued','failed') AND next_attempt_at <= $1)
            OR (status = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ${this.table} o
       SET status = 'sending', lease_owner = $3, lease_expires_at = $4, updated_at = $1
       FROM due WHERE o.id = due.id
       RETURNING o.*`,
      [now, limit, workerId, leaseUntil],
    );
    return (res.rows as unknown as OutboxRow[]).map(fromRow);
  }

  async update(record: OutboxRecord, expectedLeaseOwner?: string): Promise<void> {
    const values = toRowValues(record);
    const res = await this.db.query(
      `UPDATE ${this.table} SET
         message = $3, status = $4, attempts = $5, max_attempts = $6, next_attempt_at = $7,
         lease_owner = $8, lease_expires_at = $9, provider = $10, provider_message_id = $11,
         last_error = $12, history = $13, metadata = $14, updated_at = $16, sent_at = $17
       WHERE id = $1 AND ($18::text IS NULL OR lease_owner = $18)`,
      [...values, expectedLeaseOwner ?? null],
    );
    if (res.rowCount === 0) {
      throw new Error(`Outbox record ${record.id} not updated: missing or leased by another worker`);
    }
  }

  async getByProviderMessageId(providerMessageId: string): Promise<OutboxRecord | null> {
    const res = await this.db.query(`SELECT * FROM ${this.table} WHERE provider_message_id = $1 LIMIT 1`, [providerMessageId]);
    const row = res.rows[0] as OutboxRow | undefined;
    return row ? fromRow(row) : null;
  }

  async listByStatus(status: EmailStatus, limit = 100): Promise<OutboxRecord[]> {
    const res = await this.db.query(`SELECT * FROM ${this.table} WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [
      status,
      limit,
    ]);
    return (res.rows as unknown as OutboxRow[]).map(fromRow);
  }

  async stats(): Promise<OutboxStats> {
    const res = await this.db.query(`SELECT status, count(*)::int AS n FROM ${this.table} GROUP BY status`);
    const s: OutboxStats = { queued: 0, sending: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, cancelled: 0, bounced: 0 };
    for (const row of res.rows as { status: EmailStatus; n: number }[]) s[row.status] = row.n;
    return s;
  }
}

export class PostgresSuppressionStore implements SuppressionStore {
  constructor(
    private readonly db: PgQueryable,
    private readonly table = "email_suppressions",
  ) {}

  async get(email: string): Promise<SuppressionEntry | null> {
    const res = await this.db.query(
      `SELECT * FROM ${this.table} WHERE email = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [email.toLowerCase()],
    );
    const row = res.rows[0] as
      | { email: string; reason: SuppressionEntry["reason"]; source: string | null; created_at: Date; expires_at: Date | null }
      | undefined;
    if (!row) return null;
    return {
      email: row.email,
      reason: row.reason,
      createdAt: row.created_at,
      ...(row.source !== null ? { source: row.source } : {}),
      ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
    };
  }

  async add(entry: SuppressionEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.table} (email, reason, source, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, source = EXCLUDED.source,
         created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
      [entry.email.toLowerCase(), entry.reason, entry.source ?? null, entry.createdAt, entry.expiresAt ?? null],
    );
  }

  async remove(email: string): Promise<void> {
    await this.db.query(`DELETE FROM ${this.table} WHERE email = $1`, [email.toLowerCase()]);
  }

  async list(limit = 100): Promise<SuppressionEntry[]> {
    const res = await this.db.query(`SELECT * FROM ${this.table} ORDER BY created_at DESC LIMIT $1`, [limit]);
    return (res.rows as { email: string; reason: SuppressionEntry["reason"]; source: string | null; created_at: Date; expires_at: Date | null }[]).map(
      (row) => ({
        email: row.email,
        reason: row.reason,
        createdAt: row.created_at,
        ...(row.source !== null ? { source: row.source } : {}),
        ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
      }),
    );
  }
}

function toRowValues(r: OutboxRecord): unknown[] {
  return [
    r.id,
    r.idempotencyKey,
    JSON.stringify(serializeMessage(r.message)),
    r.status,
    r.attempts,
    r.maxAttempts,
    r.nextAttemptAt,
    r.leaseOwner ?? null,
    r.leaseExpiresAt ?? null,
    r.provider ?? null,
    r.providerMessageId ?? null,
    r.lastError ?? null,
    JSON.stringify(r.history),
    r.metadata ? JSON.stringify(r.metadata) : null,
    r.createdAt,
    r.updatedAt,
    r.sentAt ?? null,
  ];
}

/** Binary attachments are stored base64-encoded inside the JSONB column. */
function serializeMessage(message: OutboxRecord["message"]): unknown {
  if (!message.attachments) return message;
  return {
    ...message,
    attachments: message.attachments.map((a) =>
      typeof a.content === "string"
        ? a
        : { ...a, content: Buffer.from(a.content).toString("base64"), encoding: "base64" as const },
    ),
  };
}

function fromRow(row: OutboxRow): OutboxRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    message: row.message,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: new Date(row.next_attempt_at),
    ...(row.lease_owner !== null ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at !== null ? { leaseExpiresAt: new Date(row.lease_expires_at) } : {}),
    ...(row.provider !== null ? { provider: row.provider } : {}),
    ...(row.provider_message_id !== null ? { providerMessageId: row.provider_message_id } : {}),
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    history: (row.history ?? []).map((h) => ({ ...h, startedAt: new Date(h.startedAt), finishedAt: new Date(h.finishedAt) })),
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(row.sent_at !== null ? { sentAt: new Date(row.sent_at) } : {}),
  };
}
