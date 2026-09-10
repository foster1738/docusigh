import type { EmailStatus, OutboxRecord, SuppressionEntry } from "../types.js";
import type { ClaimOptions, OutboxStats, OutboxStore, SuppressionStore } from "./types.js";

/**
 * In-memory store. Suitable for tests, local development and single-process
 * apps where losing the queue on restart is acceptable. Use `PostgresOutboxStore`
 * for anything that must survive a crash.
 */
export class MemoryOutboxStore implements OutboxStore {
  private readonly byId = new Map<string, OutboxRecord>();
  private readonly byKey = new Map<string, string>();

  async insert(record: OutboxRecord): Promise<{ record: OutboxRecord; created: boolean }> {
    const existingId = this.byKey.get(record.idempotencyKey);
    if (existingId) {
      return { record: clone(this.byId.get(existingId)!), created: false };
    }
    this.byId.set(record.id, clone(record));
    this.byKey.set(record.idempotencyKey, record.id);
    return { record: clone(record), created: true };
  }

  async get(id: string): Promise<OutboxRecord | null> {
    const r = this.byId.get(id);
    return r ? clone(r) : null;
  }

  async getByIdempotencyKey(key: string): Promise<OutboxRecord | null> {
    const id = this.byKey.get(key);
    return id ? this.get(id) : null;
  }

  async claim({ workerId, limit, leaseMs, now }: ClaimOptions): Promise<OutboxRecord[]> {
    const due: OutboxRecord[] = [];
    for (const r of this.byId.values()) {
      if (due.length >= limit) break;
      const isDue = (r.status === "queued" || r.status === "failed") && r.nextAttemptAt.getTime() <= now.getTime();
      const leaseExpired = r.status === "sending" && r.leaseExpiresAt !== undefined && r.leaseExpiresAt.getTime() <= now.getTime();
      if (!isDue && !leaseExpired) continue;
      r.status = "sending";
      r.leaseOwner = workerId;
      r.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      r.updatedAt = now;
      due.push(clone(r));
    }
    due.sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
    return due;
  }

  async update(record: OutboxRecord, expectedLeaseOwner?: string): Promise<void> {
    const current = this.byId.get(record.id);
    if (!current) throw new Error(`Outbox record ${record.id} not found`);
    if (expectedLeaseOwner !== undefined && current.leaseOwner !== expectedLeaseOwner) {
      throw new Error(`Outbox record ${record.id} is leased by ${current.leaseOwner ?? "nobody"}, not ${expectedLeaseOwner}`);
    }
    this.byId.set(record.id, clone(record));
  }

  async getByProviderMessageId(providerMessageId: string): Promise<OutboxRecord | null> {
    for (const r of this.byId.values()) {
      if (r.providerMessageId === providerMessageId) return clone(r);
    }
    return null;
  }

  async listByStatus(status: EmailStatus, limit = 100): Promise<OutboxRecord[]> {
    const out: OutboxRecord[] = [];
    for (const r of this.byId.values()) {
      if (r.status === status) out.push(clone(r));
      if (out.length >= limit) break;
    }
    return out;
  }

  async stats(): Promise<OutboxStats> {
    const s: OutboxStats = { queued: 0, sending: 0, sent: 0, failed: 0, dead: 0, suppressed: 0, cancelled: 0, bounced: 0 };
    for (const r of this.byId.values()) s[r.status] += 1;
    return s;
  }

  /** Test helper. */
  clear(): void {
    this.byId.clear();
    this.byKey.clear();
  }
}

export class MemorySuppressionStore implements SuppressionStore {
  private readonly entries = new Map<string, SuppressionEntry>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async get(email: string): Promise<SuppressionEntry | null> {
    const e = this.entries.get(email.toLowerCase());
    if (!e) return null;
    if (e.expiresAt && e.expiresAt.getTime() <= this.now().getTime()) {
      this.entries.delete(email.toLowerCase());
      return null;
    }
    return { ...e };
  }

  async add(entry: SuppressionEntry): Promise<void> {
    this.entries.set(entry.email.toLowerCase(), { ...entry, email: entry.email.toLowerCase() });
  }

  async remove(email: string): Promise<void> {
    this.entries.delete(email.toLowerCase());
  }

  async list(limit = 100): Promise<SuppressionEntry[]> {
    return [...this.entries.values()].slice(0, limit).map((e) => ({ ...e }));
  }
}

function clone(record: OutboxRecord): OutboxRecord {
  return structuredClone(record);
}
