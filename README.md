# @docusigh/email — bulletproof email sender

A transactional email sender for DocuSigh that does not lose, duplicate, or
endlessly retry messages. It is a library, not a service: embed it in the app
that needs to send signing invitations, reminders and receipts.

## What "bulletproof" means here

| Failure mode | Defence |
| --- | --- |
| App crashes after the user clicks "send" | **Outbox pattern**: the message is persisted before `enqueue` returns; a worker delivers it later. |
| Provider outage or 5xx | **Provider fallback chain** (Resend → Postmark → SMTP …) tried in order on every attempt. |
| Provider keeps failing | **Circuit breaker** per provider stops hammering it and probes for recovery. |
| Transient network errors, timeouts, 429s | **Retries with exponential backoff and full jitter**, honouring `Retry-After`, capped. |
| Bad address, oversized message, 4xx rejection | **Immediate dead-letter**: permanent errors never burn retries. |
| Bad API key on one provider | Treated as a **provider** problem, so the chain falls through instead of dead-lettering the message. |
| Duplicate sends from HTTP retries or double clicks | **Idempotency keys**, explicit or derived from content, enforced by a unique constraint. |
| Worker dies mid-send | **Leases**: the record is reclaimed by another worker once the lease expires. |
| Two workers grab the same row | **`FOR UPDATE SKIP LOCKED`** in Postgres; optimistic lease-owner check on every write. |
| Slow provider hangs a request | **Per-attempt timeout** enforced with both `AbortSignal` and a race, so a provider that ignores the signal still cannot block. |
| Exceeding provider quotas | **Local token-bucket rate limits** per provider; throttled passes defer instead of failing. |
| Emailing addresses that bounced or complained | **Suppression list** populated from provider webhooks; suppressed recipients are stripped before sending. |
| Header injection (`Subject: x\r\nBcc: …`) | **Strict validation** of every address, subject, display name, header name and value. |
| Leaking API keys into logs | Structured logger **redacts** anything that looks like a credential. |
| Nobody notices dead letters | **Events** (`sent`, `retry`, `dead`, `suppressed`, `circuit_open`, `bounce`, …) for metrics and alerting; `listDead()` / `retryDead()` for operators. |

## Install

```bash
npm install
npm test
npm run build
```

Requires Node 20+. `pg` is an optional dependency, needed only for the
Postgres store.

## Quick start

```ts
import { EmailSender, ResendProvider, PostmarkProvider, SmtpProvider, consoleLogger } from "@docusigh/email";

const sender = new EmailSender({
  providers: [
    new ResendProvider({ apiKey: process.env.RESEND_API_KEY! }),
    new PostmarkProvider({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
    new SmtpProvider({ host: "email-smtp.us-east-1.amazonaws.com", auth: { user: "…", pass: "…" } }),
  ],
  logger: consoleLogger("info"),
  maxAttempts: 8,
  rateLimits: { resend: { perSecond: 10 }, postmark: { perSecond: 10 } },
});

sender.start(); // background worker in this process

await sender.enqueue(
  {
    from: { email: "noreply@docusigh.com", name: "DocuSigh" },
    to: [{ email: "signer@example.com", name: "Sam Signer" }],
    subject: "Please sign: Lease Agreement",
    text: "Open the link to review and sign.",
    html: "<p>Open the link to review and sign.</p>",
  },
  { idempotencyKey: `envelope:${envelopeId}:invite:${signerId}` },
);
```

`enqueue` returns once the message is durably stored. Use `send()` instead
if you want the calling process to attempt delivery immediately (it is still
persisted first, so a failure just leaves it for the worker).

Run `npm run example` to see it work with no credentials.

## Durable storage

The default `MemoryOutboxStore` is fine for tests and single-process apps
that can tolerate losing the queue on restart. For production use Postgres:

```bash
psql "$DATABASE_URL" -f src/store/schema.sql
```

```ts
import pg from "pg";
import { EmailSender, PostgresOutboxStore, PostgresSuppressionStore } from "@docusigh/email";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sender = new EmailSender({
  providers,
  store: new PostgresOutboxStore(pool),
  suppressions: new PostgresSuppressionStore(pool),
});
```

Any number of processes can run `sender.start()` against the same table.
Claims use `FOR UPDATE SKIP LOCKED`, so workers never contend or double-send.
If you need a different database, implement the small `OutboxStore` and
`SuppressionStore` interfaces in `src/store/types.ts`.

## Bounce and complaint webhooks

Wire each provider's webhook to an endpoint that verifies the signature,
normalises the payload and hands events to `handleBounce`:

```ts
import { parseResendWebhook, verifySvixSignature } from "@docusigh/email";

app.post("/webhooks/resend", express.text({ type: "*/*" }), async (req, res) => {
  const ok = verifySvixSignature(req.body, req.headers as never, process.env.RESEND_WEBHOOK_SECRET!);
  if (!ok) return res.status(401).end();
  for (const event of parseResendWebhook(JSON.parse(req.body))) await sender.handleBounce(event);
  res.status(204).end();
});
```

`parseSendGridWebhook` + `verifySendGridSignature` and `parsePostmarkWebhook`
(protect the URL with basic auth and compare using `safeEqual`) work the same
way. Hard bounces and complaints suppress the address permanently and mark the
outbox record `bounced`; soft bounces are ignored unless
`softBounceSuppressMs` is set.

## Operating it

- **Watch dead letters.** Subscribe to `sender.on("dead", …)` and alert. Inspect
  with `listDead()`, fix the cause, then `retryDead(id)`.
- **Watch provider health.** `providerHealth()` reports each circuit's state;
  `circuit_open` events tell you a provider is being skipped.
- **Tune timeouts.** `leaseMs` must exceed `attemptTimeoutMs × providers.length`
  or a slow send could be picked up twice; the constructor warns if not.
- **Idempotency keys.** Prefer an explicit key that names the business event
  (`envelope:123:reminder:2026-09-10`). The derived key hashes the full
  content, so two identical reminders sent an hour apart would be deduplicated.
- **Deliverability.** The code cannot fix DNS: publish SPF, DKIM and DMARC for
  every sending domain on every provider in the chain, and use a dedicated
  subdomain (e.g. `mail.docusigh.com`) so a reputation hit does not affect
  your root domain.

## Layout

```
src/
  sender.ts            EmailSender: outbox, retries, fallback, breakers, limits, worker loop
  validate.ts          Zod schema, header-injection and size checks
  errors.ts            EmailError and HTTP/SMTP/network error classification
  backoff.ts           exponential backoff with full jitter, Retry-After handling
  circuit-breaker.ts   per-provider circuit breaker
  rate-limiter.ts      token bucket
  logger.ts            structured logger with credential redaction
  store/               OutboxStore / SuppressionStore interfaces, memory and Postgres impls, schema.sql
  providers/           Resend, SendGrid, Postmark, SMTP (Nodemailer), Fake, Console
  webhooks/            signature verification and payload normalisation
test/                  Vitest suite covering every failure mode above
examples/basic.ts      runnable demo
```
