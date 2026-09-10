import { describe, expect, it, vi } from "vitest";
import {
  EmailError,
  EmailSender,
  FakeProvider,
  MemoryOutboxStore,
  MemorySuppressionStore,
  deriveIdempotencyKey,
  type SenderEvent,
} from "../src/index.js";
import { FakeClock, msg } from "./helpers.js";

function setup(opts: Partial<ConstructorParameters<typeof EmailSender>[0]> = {}) {
  const clock = new FakeClock();
  const primary = new FakeProvider("primary");
  const backup = new FakeProvider("backup");
  const store = new MemoryOutboxStore();
  const suppressions = new MemorySuppressionStore({ now: clock.now });
  const events: SenderEvent[] = [];
  const sender = new EmailSender({
    providers: [primary, backup],
    store,
    suppressions,
    now: clock.now,
    backoff: { baseMs: 1000, maxMs: 60_000, random: () => 0.5 },
    maxAttempts: 3,
    attemptTimeoutMs: 200,
    circuitBreaker: { failureThreshold: 2, openMs: 5000 },
    ...opts,
  });
  sender.on("event", (e: SenderEvent) => events.push(e));
  return { clock, primary, backup, store, suppressions, sender, events };
}

const transient = () => new EmailError("503", { code: "PROVIDER_UNAVAILABLE", retryable: true, statusCode: 503 });
const permanent = () => new EmailError("422 bad address", { code: "PROVIDER_REJECTED", retryable: false, statusCode: 422 });
const auth = () => new EmailError("401", { code: "AUTH", retryable: false, statusCode: 401 });

describe("EmailSender", () => {
  it("sends through the primary provider and records the result", async () => {
    const { sender, primary, backup } = setup();
    const record = await sender.send(msg());
    expect(record.status).toBe("sent");
    expect(record.provider).toBe("primary");
    expect(record.providerMessageId).toBe("primary-1");
    expect(record.attempts).toBe(1);
    expect(record.history).toHaveLength(1);
    expect(record.leaseOwner).toBeUndefined();
    expect(primary.sent).toHaveLength(1);
    expect(backup.calls).toBe(0);
  });

  it("persists before sending so enqueue is durable", async () => {
    const { sender, store, primary } = setup();
    const { id, status } = await sender.enqueue(msg());
    expect(status).toBe("queued");
    expect(await store.get(id)).toMatchObject({ status: "queued" });
    expect(primary.calls).toBe(0);
    expect(await sender.processOnce()).toBe(1);
    expect(await store.get(id)).toMatchObject({ status: "sent" });
  });

  it("deduplicates by idempotency key", async () => {
    const { sender, primary } = setup();
    const a = await sender.send(msg(), { idempotencyKey: "envelope-1:invite" });
    const b = await sender.send(msg({ subject: "different" }), { idempotencyKey: "envelope-1:invite" });
    expect(b.id).toBe(a.id);
    expect(primary.calls).toBe(1);
    const r = await sender.enqueue(msg(), { idempotencyKey: "envelope-1:invite" });
    expect(r.deduplicated).toBe(true);
  });

  it("derives a deterministic key from message content", async () => {
    expect(deriveIdempotencyKey(msg())).toBe(deriveIdempotencyKey(msg()));
    expect(deriveIdempotencyKey(msg())).not.toBe(deriveIdempotencyKey(msg({ subject: "x" })));
    const { sender, primary } = setup();
    await sender.send(msg());
    await sender.send(msg());
    expect(primary.calls).toBe(1);
  });

  it("rejects invalid messages at enqueue time without touching the store", async () => {
    const { sender, store } = setup();
    await expect(sender.enqueue(msg({ to: [] }))).rejects.toThrowError(EmailError);
    expect(await store.stats()).toMatchObject({ queued: 0 });
  });

  it("falls back to the backup provider when the primary fails transiently", async () => {
    const { sender, primary, backup, events } = setup();
    primary.failNext(transient());
    const record = await sender.send(msg());
    expect(record.status).toBe("sent");
    expect(record.provider).toBe("backup");
    expect(record.history.map((h) => [h.provider, h.ok])).toEqual([
      ["primary", false],
      ["backup", true],
    ]);
    expect(events.some((e) => e.type === "provider_failure" && e.provider === "primary")).toBe(true);
    expect(backup.sent).toHaveLength(1);
  });

  it("falls through on AUTH errors instead of dead-lettering", async () => {
    const { sender, primary } = setup();
    primary.failNext(auth());
    const record = await sender.send(msg());
    expect(record.status).toBe("sent");
    expect(record.provider).toBe("backup");
  });

  it("schedules a jittered retry when every provider fails, then succeeds", async () => {
    const { sender, primary, backup, clock, store, events } = setup();
    primary.failNext(transient());
    backup.failNext(transient());
    const record = await sender.send(msg());
    expect(record.status).toBe("failed");
    expect(record.attempts).toBe(1);
    // baseMs 1000 * random 0.5 = 500ms
    expect(record.nextAttemptAt.getTime() - clock.nowMs()).toBe(500);
    const retry = events.find((e) => e.type === "retry");
    expect(retry && retry.type === "retry" && retry.delayMs).toBe(500);

    expect(await sender.processOnce()).toBe(0); // not due yet
    clock.advance(500);
    expect(await sender.processOnce()).toBe(1);
    expect(await store.get(record.id)).toMatchObject({ status: "sent", attempts: 2, provider: "primary" });
  });

  it("honours a provider Retry-After hint", async () => {
    const { sender, primary, backup, clock } = setup();
    const rl = new EmailError("429", { code: "RATE_LIMITED", retryable: true, retryAfterMs: 7000 });
    primary.failNext(rl);
    backup.failNext(rl);
    const record = await sender.send(msg());
    expect(record.nextAttemptAt.getTime() - clock.nowMs()).toBe(7000);
  });

  it("dead-letters immediately on a permanent rejection", async () => {
    const { sender, primary, backup, events } = setup();
    primary.failNext(permanent());
    const record = await sender.send(msg());
    expect(record.status).toBe("dead");
    expect(record.lastError).toMatch(/PROVIDER_REJECTED/);
    expect(backup.calls).toBe(0);
    expect(events.some((e) => e.type === "dead")).toBe(true);
    expect(await sender.listDead()).toHaveLength(1);
  });

  it("dead-letters after maxAttempts and can be requeued", async () => {
    const { sender, primary, backup, clock, store } = setup();
    primary.failNext(transient(), transient(), transient());
    backup.failNext(transient(), transient(), transient());
    const record = await sender.send(msg());
    expect(record.status).toBe("failed");
    for (let i = 0; i < 2; i++) {
      clock.advance(60_000);
      await sender.processOnce();
    }
    const dead = await store.get(record.id);
    expect(dead?.status).toBe("dead");
    expect(dead?.attempts).toBe(3);
    expect(dead?.history).toHaveLength(6);

    expect(await sender.retryDead(record.id)).toBe(true);
    clock.advance(5000); // let the tripped circuits cool down
    await sender.processOnce();
    expect(await store.get(record.id)).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("times out a hung provider and moves on", async () => {
    const clock = new FakeClock();
    const hung = new FakeProvider("hung", (_m, _a) => new Promise(() => {}));
    const backup = new FakeProvider("backup");
    const sender = new EmailSender({ providers: [hung, backup], attemptTimeoutMs: 50, now: clock.now });
    const record = await sender.send(msg());
    expect(record.status).toBe("sent");
    expect(record.provider).toBe("backup");
    expect(record.history[0]).toMatchObject({ provider: "hung", ok: false, errorCode: "TIMEOUT" });
  });

  it("opens the circuit after repeated failures and skips the provider", async () => {
    const { sender, primary, backup, clock, events } = setup();
    primary.failNext(transient(), transient());
    await sender.send(msg({ subject: "1" }));
    await sender.send(msg({ subject: "2" }));
    expect(sender.providerHealth()).toEqual([
      { name: "primary", circuit: "open" },
      { name: "backup", circuit: "closed" },
    ]);
    const r3 = await sender.send(msg({ subject: "3" }));
    expect(r3.provider).toBe("backup");
    expect(primary.calls).toBe(2); // third send skipped primary entirely
    expect(events.some((e) => e.type === "circuit_open" && e.provider === "primary")).toBe(true);

    clock.advance(5000);
    const r4 = await sender.send(msg({ subject: "4" }));
    expect(r4.provider).toBe("primary"); // probe succeeded
    expect(sender.providerHealth()[0]?.circuit).toBe("closed");
    expect(backup.sent).toHaveLength(3);
  });

  it("respects local rate limits by skipping to the next provider", async () => {
    const { sender, primary, backup } = setup({ rateLimits: { primary: { perSecond: 1, burst: 1 } } });
    await sender.send(msg({ subject: "a" }));
    await sender.send(msg({ subject: "b" }));
    expect(primary.sent).toHaveLength(1);
    expect(backup.sent).toHaveLength(1);
  });

  it("defers instead of failing when every provider is locally throttled", async () => {
    const { sender, primary, backup, clock, store } = setup({
      rateLimits: { primary: { perSecond: 1, burst: 1 }, backup: { perSecond: 1, burst: 1 } },
    });
    await sender.send(msg({ subject: "a" }));
    await sender.send(msg({ subject: "b" }));
    const c = await sender.send(msg({ subject: "c" }));
    expect(c.status).toBe("queued");
    expect(c.attempts).toBe(0);
    expect(c.history).toHaveLength(0);
    expect(c.nextAttemptAt.getTime()).toBeGreaterThan(clock.nowMs());
    clock.advance(1000);
    await sender.processOnce();
    expect(await store.get(c.id)).toMatchObject({ status: "sent" });
    expect(primary.sent.length + backup.sent.length).toBe(3);
  });

  it("drops suppressed recipients and marks fully-suppressed messages", async () => {
    const { sender, primary, events } = setup();
    await sender.suppress("bounced@example.com", "bounce");
    const partial = await sender.send(
      msg({ to: [{ email: "bounced@example.com" }, { email: "ok@example.com" }], cc: [{ email: "bounced@example.com" }] }),
    );
    expect(partial.status).toBe("sent");
    expect(primary.sent[0]?.message.to.map((a) => a.email)).toEqual(["ok@example.com"]);
    expect(primary.sent[0]?.message.cc).toBeUndefined();
    expect(events.find((e) => e.type === "suppressed")).toMatchObject({ recipients: ["bounced@example.com", "bounced@example.com"] });

    const full = await sender.send(msg({ to: [{ email: "bounced@example.com" }] }));
    expect(full.status).toBe("suppressed");
    expect(primary.calls).toBe(1);
  });

  it("handles bounce events: suppresses hard bounces and complaints, flags the record", async () => {
    const { sender, store } = setup();
    const sent = await sender.send(msg());
    await sender.handleBounce({ type: "bounce", bounceType: "hard", email: "signer@example.com", provider: "primary", providerMessageId: sent.providerMessageId!, raw: {} });
    expect(await sender.isSuppressed("signer@example.com")).toMatchObject({ reason: "bounce" });
    expect(await store.get(sent.id)).toMatchObject({ status: "bounced" });

    await sender.handleBounce({ type: "bounce", bounceType: "soft", email: "soft@example.com", provider: "primary", raw: {} });
    expect(await sender.isSuppressed("soft@example.com")).toBeNull();

    await sender.handleBounce({ type: "complaint", email: "angry@example.com", provider: "primary", raw: {} });
    expect(await sender.isSuppressed("angry@example.com")).toMatchObject({ reason: "complaint" });

    await sender.unsuppress("angry@example.com");
    expect(await sender.isSuppressed("angry@example.com")).toBeNull();
  });

  it("temporarily suppresses soft bounces when configured", async () => {
    const { sender, clock } = setup({ softBounceSuppressMs: 1000 });
    await sender.handleBounce({ type: "bounce", bounceType: "soft", email: "soft@example.com", provider: "p", raw: {} });
    expect(await sender.isSuppressed("soft@example.com")).not.toBeNull();
    clock.advance(1001);
    expect(await sender.isSuppressed("soft@example.com")).toBeNull();
  });

  it("reclaims a record whose worker died mid-send", async () => {
    const clock = new FakeClock();
    const store = new MemoryOutboxStore();
    const crashed = new FakeProvider("crashed", () => new Promise(() => {}));
    const workerA = new EmailSender({ providers: [crashed], store, now: clock.now, leaseMs: 1000, attemptTimeoutMs: 100_000, workerId: "A" });
    const { id } = await workerA.enqueue(msg());
    void workerA.processOnce(); // hangs forever, holding the lease
    await new Promise((r) => setTimeout(r, 10));
    expect(await store.get(id)).toMatchObject({ status: "sending", leaseOwner: "A" });

    const good = new FakeProvider("good");
    const workerB = new EmailSender({ providers: [good], store, now: clock.now, leaseMs: 1000, workerId: "B" });
    expect(await workerB.processOnce()).toBe(0); // lease still valid
    clock.advance(1000);
    expect(await workerB.processOnce()).toBe(1);
    expect(await store.get(id)).toMatchObject({ status: "sent", provider: "good" });
  });

  it("a stale worker cannot overwrite a record another worker completed", async () => {
    const clock = new FakeClock();
    const store = new MemoryOutboxStore();
    let release!: () => void;
    const slow = new FakeProvider("slow", () => new Promise((resolve) => (release = () => resolve({ providerMessageId: "slow-1" }))));
    const workerA = new EmailSender({ providers: [slow], store, now: clock.now, leaseMs: 100, attemptTimeoutMs: 100_000, workerId: "A" });
    const events: SenderEvent[] = [];
    workerA.on("event", (e: SenderEvent) => events.push(e));
    const { id } = await workerA.enqueue(msg());
    const a = workerA.processOnce();
    await new Promise((r) => setTimeout(r, 10));

    clock.advance(100);
    const workerB = new EmailSender({ providers: [new FakeProvider("good")], store, now: clock.now, workerId: "B" });
    await workerB.processOnce();
    expect(await store.get(id)).toMatchObject({ status: "sent", provider: "good" });

    release();
    await a;
    expect(await store.get(id)).toMatchObject({ status: "sent", provider: "good" });
    expect(events.some((e) => e.type === "worker_error")).toBe(true);
  });

  it("cancel only affects unsent messages", async () => {
    const { sender, clock, store } = setup();
    const { id } = await sender.enqueue(msg(), { sendAt: new Date(clock.nowMs() + 60_000) });
    expect(await sender.cancel(id)).toBe(true);
    expect(await store.get(id)).toMatchObject({ status: "cancelled" });
    clock.advance(60_000);
    expect(await sender.processOnce()).toBe(0);

    const sent = await sender.send(msg({ subject: "other" }));
    expect(await sender.cancel(sent.id)).toBe(false);
  });

  it("delays delivery until sendAt", async () => {
    const { sender, clock, primary } = setup();
    await sender.enqueue(msg(), { sendAt: new Date(clock.nowMs() + 1000) });
    expect(await sender.processOnce()).toBe(0);
    clock.advance(1000);
    expect(await sender.processOnce()).toBe(1);
    expect(primary.sent).toHaveLength(1);
  });

  it("processes a batch with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const p = new FakeProvider("p", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return {};
    });
    const sender = new EmailSender({ providers: [p], concurrency: 3, batchSize: 10 });
    for (let i = 0; i < 10; i++) await sender.enqueue(msg({ subject: `s${i}` }));
    expect(await sender.processOnce()).toBe(10);
    expect(peak).toBe(3);
    expect(await sender.getStats()).toMatchObject({ sent: 10 });
  });

  it("background worker drains the queue and stops cleanly", async () => {
    const p = new FakeProvider("p");
    const sender = new EmailSender({ providers: [p], pollIntervalMs: 5 });
    sender.start();
    await sender.enqueue(msg({ subject: "a" }));
    await sender.enqueue(msg({ subject: "b" }));
    await vi.waitFor(() => expect(p.sent).toHaveLength(2));
    await sender.stop();
    await sender.enqueue(msg({ subject: "c" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(p.sent).toHaveLength(2);
  });

  it("refuses duplicate provider names and empty provider lists", () => {
    expect(() => new EmailSender({ providers: [] })).toThrow();
    expect(() => new EmailSender({ providers: [new FakeProvider("x"), new FakeProvider("x")] })).toThrow(/Duplicate/);
  });
});

describe("EmailSender edge cases", () => {
  it("treats a throttled retry pass as a deferral even when earlier attempts failed", async () => {
    const { sender, primary, backup, clock, store } = setup({
      rateLimits: { primary: { perSecond: 1, burst: 1 }, backup: { perSecond: 1, burst: 1 } },
    });
    primary.failNext(transient());
    backup.failNext(transient());
    const r = await sender.send(msg());
    expect(r.status).toBe("failed");
    expect(r.attempts).toBe(1);
    // Retry is due, but both buckets are empty: must defer, not burn an attempt.
    clock.advance(500);
    await sender.processOnce();
    const deferred = await store.get(r.id);
    expect(deferred).toMatchObject({ status: "queued", attempts: 1 });
    expect(deferred?.history).toHaveLength(2);
    clock.advance(1000);
    await sender.processOnce();
    expect(await store.get(r.id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("a throttled skip does not reset the breaker's failure streak", async () => {
    const { sender, primary, backup } = setup({
      rateLimits: { primary: { perSecond: 0.001, burst: 2 } },
      circuitBreaker: { failureThreshold: 2, openMs: 5000 },
    });
    primary.failNext(transient(), transient());
    await sender.send(msg({ subject: "1" })); // primary fails (streak 1), backup ok
    // Bucket had 2 tokens: one used above, one used here.
    await sender.send(msg({ subject: "2" })); // primary fails (streak 2 → open)
    expect(sender.providerHealth()[0]?.circuit).toBe("open");
    expect(backup.sent).toHaveLength(2);
  });
});
