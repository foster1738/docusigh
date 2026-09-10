import type { EmailStatus, OutboxRecord, SuppressionEntry } from "../types.js";

export interface ClaimOptions {
  workerId: string;
  limit: number;
  leaseMs: number;
  now: Date;
}

export interface OutboxStats {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  dead: number;
  suppressed: number;
  cancelled: number;
  bounced: number;
}

/**
 * Durable outbox. All methods must be safe to call concurrently from several
 * worker processes; `claim` must be atomic so two workers never lease the
 * same record.
 */
export interface OutboxStore {
  /**
   * Insert a record unless one with the same idempotency key already exists,
   * in which case the existing record is returned and `created` is false.
   */
  insert(record: OutboxRecord): Promise<{ record: OutboxRecord; created: boolean }>;
  get(id: string): Promise<OutboxRecord | null>;
  getByIdempotencyKey(key: string): Promise<OutboxRecord | null>;
  /**
   * Atomically lease up to `limit` records that are due (`queued` or `failed`
   * with `nextAttemptAt <= now`) or whose lease has expired (`sending` with
   * `leaseExpiresAt <= now`, which means a worker died mid-send).
   */
  claim(options: ClaimOptions): Promise<OutboxRecord[]>;
  /**
   * Persist a record. Implementations should reject the update when the
   * record is leased by a different worker (`leaseOwner` mismatch) to guard
   * against a stale worker overwriting a newer state.
   */
  update(record: OutboxRecord, expectedLeaseOwner?: string): Promise<void>;
  listByStatus(status: EmailStatus, limit?: number): Promise<OutboxRecord[]>;
  /** Look up a sent record by the id the provider assigned, for bounce webhooks. */
  getByProviderMessageId(providerMessageId: string): Promise<OutboxRecord | null>;
  stats(): Promise<OutboxStats>;
}

export interface SuppressionStore {
  get(email: string): Promise<SuppressionEntry | null>;
  add(entry: SuppressionEntry): Promise<void>;
  remove(email: string): Promise<void>;
  list(limit?: number): Promise<SuppressionEntry[]>;
}
