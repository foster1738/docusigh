import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import { nextRetryDelayMs, type BackoffOptions } from "./backoff.js";
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState } from "./circuit-breaker.js";
import { EmailError, toEmailError } from "./errors.js";
import { silentLogger, type Logger } from "./logger.js";
import { TokenBucket, type RateLimiterOptions } from "./rate-limiter.js";
import { MemoryOutboxStore, MemorySuppressionStore } from "./store/memory.js";
import type { OutboxStats, OutboxStore, SuppressionStore } from "./store/types.js";
import type {
  BounceEvent,
  EmailAttempt,
  EmailMessage,
  EmailProvider,
  EnqueueResult,
  OutboxRecord,
  SendOptions,
  SuppressionEntry,
} from "./types.js";
import { allRecipients, validateMessage } from "./validate.js";

export interface EmailSenderOptions {
  /** Providers in priority order. The first healthy one wins; the rest are fallbacks. */
  providers: EmailProvider[];
  store?: OutboxStore;
  suppressions?: SuppressionStore;
  logger?: Logger;
  /** Passes over the whole provider chain before a message is dead-lettered. Default 8. */
  maxAttempts?: number;
  /** Backoff between attempts. Default 2s base, 10min cap, factor 2, full jitter. */
  backoff?: Partial<BackoffOptions>;
  /** Timeout for a single provider call. Default 15s. */
  attemptTimeoutMs?: number;
  /** How long a worker holds a record. Must exceed attemptTimeoutMs × providers. */
  leaseMs?: number;
  /** Polling interval of the background worker. Default 1s. */
  pollIntervalMs?: number;
  /** Records claimed per poll. Default 25. */
  batchSize?: number;
  /** Records processed in parallel. Default 5. */
  concurrency?: number;
  circuitBreaker?: CircuitBreakerOptions;
  /** Per-provider local rate limits keyed by provider name. */
  rateLimits?: Record<string, RateLimiterOptions>;
  maxMessageBytes?: number;
  /** Temporary suppression after a soft bounce. Default 0 (none). */
  softBounceSuppressMs?: number;
  workerId?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

export type SenderEvent =
  | { type: "enqueued"; record: OutboxRecord; deduplicated: boolean }
  | { type: "sent"; record: OutboxRecord }
  | { type: "retry"; record: OutboxRecord; error: EmailError; delayMs: number }
  | { type: "dead"; record: OutboxRecord; error: EmailError }
  | { type: "suppressed"; record: OutboxRecord; recipients: string[] }
  | { type: "provider_failure"; provider: string; error: EmailError; recordId: string }
  | { type: "circuit_open"; provider: string }
  | { type: "bounce"; event: BounceEvent; suppressed: boolean }
  | { type: "worker_error"; error: Error };

export type SenderEventType = SenderEvent["type"];
export type SenderEventOf<T extends SenderEventType> = Extract<SenderEvent, { type: T }>;

export interface EmailSender {
  on<T extends SenderEventType>(event: T, listener: (event: SenderEventOf<T>) => void): this;
  on(event: "event", listener: (event: SenderEvent) => void): this;
  once<T extends SenderEventType>(event: T, listener: (event: SenderEventOf<T>) => void): this;
  once(event: "event", listener: (event: SenderEvent) => void): this;
  off<T extends SenderEventType>(event: T, listener: (event: SenderEventOf<T>) => void): this;
  off(event: "event", listener: (event: SenderEvent) => void): this;
}

export interface ProviderHealth {
  name: string;
  circuit: CircuitState;
}

/**
 * The bulletproof sender.
 *
 * Lifecycle of a message:
 *   enqueue → (validated, deduplicated, persisted) → claimed by a worker →
 *   provider chain tried in order → sent | failed (retry later) | dead.
 *
 * Guarantees:
 *   - A message is persisted before we return from `enqueue`, so a crash
 *     never loses it.
 *   - The same idempotency key is never delivered twice by this sender.
 *   - A provider failure never blocks other messages (leases + SKIP LOCKED).
 *   - Permanent errors (bad address, message too large) are dead-lettered
 *     immediately instead of burning retries.
 *   - Suppressed recipients (bounces, complaints) are never contacted again.
 */
export class EmailSender extends EventEmitter {
  private readonly providers: EmailProvider[];
  private readonly store: OutboxStore;
  private readonly suppressions: SuppressionStore;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly attemptTimeoutMs: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly maxMessageBytes: number | undefined;
  private readonly softBounceSuppressMs: number;
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly limiters = new Map<string, TokenBucket>();

  private running = false;
  private loopPromise: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  private inFlight = new Set<Promise<void>>();

  constructor(options: EmailSenderOptions) {
    super();
    if (!options.providers.length) throw new Error("EmailSender requires at least one provider");
    const names = new Set<string>();
    for (const p of options.providers) {
      if (names.has(p.name)) throw new Error(`Duplicate provider name "${p.name}"`);
      names.add(p.name);
    }
    this.providers = options.providers;
    this.store = options.store ?? new MemoryOutboxStore();
    this.suppressions = options.suppressions ?? new MemorySuppressionStore();
    this.logger = options.logger ?? silentLogger;
    this.maxAttempts = options.maxAttempts ?? 8;
    this.backoff = { baseMs: 2_000, maxMs: 10 * 60_000, factor: 2, ...options.backoff };
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 15_000;
    this.leaseMs = options.leaseMs ?? Math.max(60_000, this.attemptTimeoutMs * this.providers.length + 10_000);
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.batchSize = options.batchSize ?? 25;
    this.concurrency = options.concurrency ?? 5;
    this.maxMessageBytes = options.maxMessageBytes;
    this.softBounceSuppressMs = options.softBounceSuppressMs ?? 0;
    this.workerId = options.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;

    for (const p of this.providers) {
      this.breakers.set(p.name, new CircuitBreaker(p.name, { ...options.circuitBreaker, now: () => this.now().getTime() }));
      const limit = options.rateLimits?.[p.name];
      if (limit) this.limiters.set(p.name, new TokenBucket({ ...limit, now: () => this.now().getTime() }));
    }
    if (this.leaseMs < this.attemptTimeoutMs * this.providers.length) {
      this.logger.warn("leaseMs is shorter than attemptTimeoutMs × providers; a slow send may be double-delivered", {
        leaseMs: this.leaseMs,
        attemptTimeoutMs: this.attemptTimeoutMs,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Validate, deduplicate and durably persist a message for delivery. */
  async enqueue(input: EmailMessage, options: SendOptions = {}): Promise<EnqueueResult> {
    const message = validateMessage(input, this.maxMessageBytes !== undefined ? { maxMessageBytes: this.maxMessageBytes } : {});
    const idempotencyKey = options.idempotencyKey ?? deriveIdempotencyKey(message);
    const now = this.now();
    const record: OutboxRecord = {
      id: this.idGenerator(),
      idempotencyKey,
      message,
      status: "queued",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.maxAttempts,
      nextAttemptAt: options.sendAt ?? now,
      history: [],
      createdAt: now,
      updatedAt: now,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
    const { record: stored, created } = await this.store.insert(record);
    this.emitEvent({ type: "enqueued", record: stored, deduplicated: !created });
    this.logger.info(created ? "email enqueued" : "email deduplicated", {
      id: stored.id,
      idempotencyKey,
      to: allRecipients(message),
    });
    if (created) this.wakeWorker();
    return { id: stored.id, idempotencyKey, deduplicated: !created, status: stored.status };
  }

  /**
   * Enqueue and immediately attempt delivery in the calling process. The
   * message is still persisted first, so a failure here simply leaves it for
   * the background worker to retry.
   */
  async send(input: EmailMessage, options: SendOptions = {}): Promise<OutboxRecord> {
    const { id, deduplicated } = await this.enqueue(input, options);
    const existing = await this.store.get(id);
    if (!existing) throw new Error(`Record ${id} vanished after enqueue`);
    if (deduplicated || existing.status !== "queued") return existing;
    const now = this.now();
    const [claimed] = await this.store.claim({ workerId: this.workerId, limit: 1, leaseMs: this.leaseMs, now });
    // Another worker may have grabbed it already; that is fine.
    if (!claimed || claimed.id !== id) return (await this.store.get(id)) ?? existing;
    await this.deliver(claimed);
    return (await this.store.get(id)) ?? existing;
  }

  /** Claim one batch of due work and process it. Returns the number processed. */
  async processOnce(): Promise<number> {
    const batch = await this.store.claim({
      workerId: this.workerId,
      limit: this.batchSize,
      leaseMs: this.leaseMs,
      now: this.now(),
    });
    if (batch.length === 0) return 0;
    await this.runWithConcurrency(batch, (record) => this.deliver(record));
    return batch.length;
  }

  /** Start the background worker loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.info("email worker started", { workerId: this.workerId, providers: this.providers.map((p) => p.name) });
  }

  /** Stop the worker and wait for in-flight deliveries to finish. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeWorker();
    await this.loopPromise;
    await Promise.allSettled([...this.inFlight]);
    this.logger.info("email worker stopped", { workerId: this.workerId });
  }

  async getStatus(id: string): Promise<OutboxRecord | null> {
    return this.store.get(id);
  }

  async getStats(): Promise<OutboxStats> {
    return this.store.stats();
  }

  /** Cancel a message that has not been sent yet. Returns false if it already went out. */
  async cancel(id: string): Promise<boolean> {
    const record = await this.store.get(id);
    if (!record) return false;
    if (record.status !== "queued" && record.status !== "failed" && record.status !== "dead") return false;
    record.status = "cancelled";
    record.updatedAt = this.now();
    await this.store.update(record);
    return true;
  }

  /** Move a dead-lettered message back into the queue with a fresh attempt budget. */
  async retryDead(id: string): Promise<boolean> {
    const record = await this.store.get(id);
    if (!record || record.status !== "dead") return false;
    record.status = "queued";
    record.attempts = 0;
    record.nextAttemptAt = this.now();
    record.updatedAt = this.now();
    delete record.lastError;
    delete record.leaseOwner;
    delete record.leaseExpiresAt;
    await this.store.update(record);
    this.wakeWorker();
    return true;
  }

  listDead(limit = 100): Promise<OutboxRecord[]> {
    return this.store.listByStatus("dead", limit);
  }

  /** Apply a normalised bounce/complaint event: suppress the address and flag the record. */
  async handleBounce(event: BounceEvent): Promise<void> {
    let suppressed = false;
    const email = event.email.toLowerCase();
    if (event.type === "complaint" || (event.type === "bounce" && event.bounceType !== "soft")) {
      await this.suppress(email, event.type === "complaint" ? "complaint" : "bounce", event.provider);
      suppressed = true;
    } else if (event.type === "bounce" && this.softBounceSuppressMs > 0) {
      await this.suppress(email, "bounce", event.provider, new Date(this.now().getTime() + this.softBounceSuppressMs));
      suppressed = true;
    }
    if (event.providerMessageId && (event.type === "bounce" || event.type === "complaint")) {
      const record = await this.store.getByProviderMessageId(event.providerMessageId);
      if (record && record.status === "sent") {
        record.status = "bounced";
        record.lastError = `${event.type} from ${email}${event.bounceType ? ` (${event.bounceType})` : ""}`;
        record.updatedAt = this.now();
        await this.store.update(record);
      }
    }
    this.emitEvent({ type: "bounce", event, suppressed });
    this.logger.info("bounce event processed", { email, type: event.type, provider: event.provider, suppressed });
  }

  async suppress(email: string, reason: SuppressionEntry["reason"], source?: string, expiresAt?: Date): Promise<void> {
    await this.suppressions.add({
      email: email.toLowerCase(),
      reason,
      createdAt: this.now(),
      ...(source !== undefined ? { source } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
  }

  async unsuppress(email: string): Promise<void> {
    await this.suppressions.remove(email);
  }

  isSuppressed(email: string): Promise<SuppressionEntry | null> {
    return this.suppressions.get(email);
  }

  providerHealth(): ProviderHealth[] {
    return this.providers.map((p) => ({ name: p.name, circuit: this.breakers.get(p.name)!.getState() }));
  }

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  private async deliver(record: OutboxRecord): Promise<void> {
    const task = this.deliverInner(record).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error("unexpected error delivering email", { id: record.id, error: error.message });
      this.emitEvent({ type: "worker_error", error });
    });
    this.inFlight.add(task);
    try {
      await task;
    } finally {
      this.inFlight.delete(task);
    }
  }

  private async deliverInner(record: OutboxRecord): Promise<void> {
    // 1. Strip suppressed recipients.
    const { message, removed } = await this.applySuppressions(record.message);
    if (removed.length > 0) {
      this.emitEvent({ type: "suppressed", record, recipients: removed });
      this.logger.warn("dropped suppressed recipients", { id: record.id, recipients: removed });
    }
    if (message.to.length === 0) {
      record.status = "suppressed";
      record.lastError = `All recipients suppressed: ${removed.join(", ")}`;
      await this.finish(record);
      return;
    }
    record.message = message;

    // 2. One attempt = one pass over the provider chain.
    record.attempts += 1;
    const historyBefore = record.history.length;
    let lastError: EmailError | undefined;
    let deferMs: number | undefined;

    for (const provider of this.providers) {
      const breaker = this.breakers.get(provider.name)!;
      if (!breaker.tryAcquire()) {
        this.emitEvent({ type: "circuit_open", provider: provider.name });
        lastError = new EmailError(`Circuit for "${provider.name}" is open`, {
          code: "CIRCUIT_OPEN",
          retryable: true,
          provider: provider.name,
        });
        continue;
      }
      const limiter = this.limiters.get(provider.name);
      if (limiter && !limiter.tryTake()) {
        // Skip this provider without counting a failure against it; remember
        // how long until it frees up in case every provider is throttled.
        const wait = limiter.msUntilNextToken();
        deferMs = deferMs === undefined ? wait : Math.min(deferMs, wait);
        breaker.release();
        lastError = new EmailError(`Local rate limit reached for "${provider.name}"`, {
          code: "RATE_LIMITED",
          retryable: true,
          provider: provider.name,
        });
        continue;
      }

      const attempt = await this.tryProvider(provider, record);
      record.history.push(attempt);
      if (attempt.ok) {
        breaker.recordSuccess();
        record.status = "sent";
        record.provider = provider.name;
        if (attempt.providerMessageId !== undefined) record.providerMessageId = attempt.providerMessageId;
        record.sentAt = attempt.finishedAt;
        delete record.lastError;
        await this.finish(record);
        this.emitEvent({ type: "sent", record });
        this.logger.info("email sent", { id: record.id, provider: provider.name, providerMessageId: record.providerMessageId });
        return;
      }

      const error = attempt.error;
      breaker.recordFailure(error);
      this.emitEvent({ type: "provider_failure", provider: provider.name, error, recordId: record.id });
      this.logger.warn("provider failed", {
        id: record.id,
        provider: provider.name,
        code: error.code,
        retryable: error.retryable,
        error: error.message,
      });
      lastError = error;

      if (!error.retryable && !FALL_THROUGH_CODES.has(error.code)) {
        // The message itself is bad; no provider will accept it.
        await this.deadLetter(record, error);
        return;
      }
    }

    // 3. Every provider failed or was unavailable.
    const error = lastError ?? new EmailError("No provider available", { code: "PROVIDER_UNAVAILABLE", retryable: true });
    const onlyThrottled = deferMs !== undefined && record.history.length === historyBefore;
    if (onlyThrottled) {
      // Not a real failure: give the attempt back and try again shortly.
      record.attempts -= 1;
      record.status = "queued";
      record.nextAttemptAt = new Date(this.now().getTime() + Math.max(50, deferMs!));
      await this.finish(record);
      return;
    }
    if (record.attempts >= record.maxAttempts) {
      await this.deadLetter(record, error);
      return;
    }
    const delayMs = nextRetryDelayMs(record.attempts, this.backoff, error.retryAfterMs);
    record.status = "failed";
    record.lastError = `${error.code}: ${error.message}`;
    record.nextAttemptAt = new Date(this.now().getTime() + delayMs);
    await this.finish(record);
    this.emitEvent({ type: "retry", record, error, delayMs });
    this.logger.warn("email delivery failed; will retry", {
      id: record.id,
      attempt: record.attempts,
      maxAttempts: record.maxAttempts,
      delayMs,
      code: error.code,
    });
  }

  private async tryProvider(
    provider: EmailProvider,
    record: OutboxRecord,
  ): Promise<EmailAttempt & ({ ok: true; error?: never } | { ok: false; error: EmailError })> {
    const startedAt = this.now();
    const controller = new AbortController();
    // Race the send against the timeout as well as signalling it: a provider
    // that ignores the AbortSignal must still not hang the worker.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const reason = new DOMException("Attempt timed out", "TimeoutError");
        controller.abort(reason);
        reject(reason);
      }, this.attemptTimeoutMs);
    });
    try {
      const result = await Promise.race([provider.send(record.message, controller.signal), timeout]);
      const finishedAt = this.now();
      return {
        attempt: record.attempts,
        provider: provider.name,
        startedAt,
        finishedAt,
        ok: true,
        ...(result.providerMessageId !== undefined ? { providerMessageId: result.providerMessageId } : {}),
      };
    } catch (err) {
      const error = toEmailError(controller.signal.aborted ? controller.signal.reason : err, provider.name);
      return {
        attempt: record.attempts,
        provider: provider.name,
        startedAt,
        finishedAt: this.now(),
        ok: false,
        errorCode: error.code,
        errorMessage: error.message,
        retryable: error.retryable,
        error,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async deadLetter(record: OutboxRecord, error: EmailError): Promise<void> {
    record.status = "dead";
    record.lastError = `${error.code}: ${error.message}`;
    await this.finish(record);
    this.emitEvent({ type: "dead", record, error });
    this.logger.error("email dead-lettered", {
      id: record.id,
      attempts: record.attempts,
      code: error.code,
      error: error.message,
      to: allRecipients(record.message),
    });
  }

  /** Release the lease and persist. Uses the lease owner as an optimistic lock. */
  private async finish(record: OutboxRecord): Promise<void> {
    const owner = record.leaseOwner;
    delete record.leaseOwner;
    delete record.leaseExpiresAt;
    record.updatedAt = this.now();
    await this.store.update(record, owner);
  }

  private async applySuppressions(message: EmailMessage): Promise<{ message: EmailMessage; removed: string[] }> {
    const removed: string[] = [];
    const filter = async (list: EmailMessage["to"] | undefined) => {
      if (!list) return undefined;
      const kept: EmailMessage["to"] = [];
      for (const a of list) {
        const entry = await this.suppressions.get(a.email);
        if (entry) removed.push(a.email);
        else kept.push(a);
      }
      return kept;
    };
    const to = (await filter(message.to)) ?? [];
    const cc = await filter(message.cc);
    const bcc = await filter(message.bcc);
    const next: EmailMessage = { ...message, to };
    if (cc && cc.length > 0) next.cc = cc;
    else delete next.cc;
    if (bcc && bcc.length > 0) next.bcc = bcc;
    else delete next.bcc;
    return { message: next, removed };
  }

  // -------------------------------------------------------------------------
  // Worker loop
  // -------------------------------------------------------------------------

  private async loop(): Promise<void> {
    while (this.running) {
      let processed = 0;
      try {
        processed = await this.processOnce();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.logger.error("worker poll failed", { error: error.message });
        this.emitEvent({ type: "worker_error", error });
      }
      if (!this.running) break;
      // A full batch means there is probably more waiting: poll again at once.
      if (processed < this.batchSize) await this.sleep(this.pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(timer);
        if (self.wake === done) self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }

  private wakeWorker(): void {
    this.wake?.();
  }

  private async runWithConcurrency<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) break;
        await fn(item);
      }
    });
    await Promise.all(workers);
  }

  private emitEvent(event: SenderEvent): void {
    this.emit(event.type, event);
    this.emit("event", event);
  }
}

/**
 * Non-retryable codes that indicate the *provider* is misconfigured rather
 * than the message being bad. Fall through to the next provider instead of
 * dead-lettering.
 */
const FALL_THROUGH_CODES = new Set(["AUTH", "CIRCUIT_OPEN"]);

/**
 * Deterministic key from the message content, so re-enqueuing the exact same
 * email (e.g. a retried HTTP request) never produces a duplicate. Attachments
 * contribute filename and a content hash.
 */
export function deriveIdempotencyKey(message: EmailMessage): string {
  const h = createHash("sha256");
  const addr = (a: { email: string; name?: string }) => `${a.email}|${a.name ?? ""}`;
  h.update(addr(message.from)).update("\n");
  h.update(message.to.map(addr).join(",")).update("\n");
  h.update((message.cc ?? []).map(addr).join(",")).update("\n");
  h.update((message.bcc ?? []).map(addr).join(",")).update("\n");
  h.update(message.replyTo ? addr(message.replyTo) : "").update("\n");
  h.update(message.subject).update("\n");
  h.update(message.text ?? "").update("\n");
  h.update(message.html ?? "").update("\n");
  for (const a of message.attachments ?? []) {
    const content = typeof a.content === "string" ? Buffer.from(a.content) : Buffer.from(a.content);
    h.update(a.filename).update(":").update(createHash("sha256").update(content).digest("hex")).update("\n");
  }
  return `sha256:${h.digest("hex")}`;
}
