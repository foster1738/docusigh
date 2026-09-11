# Bulletproof Mailer

A general-purpose transactional and bulk email sender that does not lose,
duplicate, or endlessly retry messages. It is a library, not a service: embed
it in any app that needs to send email — notifications, receipts, newsletters,
announcements.

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
import { EmailSender, ResendProvider, PostmarkProvider, SmtpProvider, consoleLogger } from "bulletproof-mailer";

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
    from: { email: "noreply@example.com", name: "Example" },
    to: [{ email: "user@example.com", name: "Sam Example" }],
    subject: "Welcome to Example",
    text: "Thanks for signing up.",
    html: "<p>Thanks for signing up.</p>",
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
import { EmailSender, PostgresOutboxStore, PostgresSuppressionStore } from "bulletproof-mailer";

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
import { parseResendWebhook, verifySvixSignature } from "bulletproof-mailer";

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
  subdomain (e.g. `mail.example.com`) so a reputation hit does not affect
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

## Bulletproof HTML emails

Sending reliably is only half the job; the HTML also has to *render* in clients
that ignore modern CSS (Outlook's Word engine, Gmail's style stripping). The
`html/` module produces "bulletproof" markup — table layouts, fully inlined
styles, MSO conditionals, VML buttons, a hidden preheader, dark-mode hints —
and escapes every caller-supplied value.

```ts
import { EmailSender, renderSimpleEmail, toEmailMessage, ResendProvider } from "bulletproof-mailer";

const rendered = renderSimpleEmail({
  heading: "Your order has shipped",
  greeting: "Hi Sam,",
  body: "Your package is on its way and should arrive **Friday**.\n\nTrack it any time using the button below.",
  button: { text: "Track your order", url: "https://shop.example.com/track/abc" },
  header: { name: "Example Shop" },
  footer: { lines: ["Example Shop"], address: "123 Market St, San Francisco, CA", unsubscribeUrl: "https://shop.example.com/u/abc" },
});

const message = toEmailMessage(rendered, {
  from: { email: "noreply@example.com", name: "Example Shop" },
  to: [{ email: "user@example.com", name: "Sam Example" }],
  subject: "Your order has shipped",
  tags: { campaign: "ship-notify" },
});

const sender = new EmailSender({ providers: [new ResendProvider({ apiKey: process.env.RESEND_API_KEY! })] });
await sender.enqueue(message, { idempotencyKey: "ship-notify:order-9f2c1a:user@example.com" });
```

`renderBulletproofEmail(input)` renders arbitrary block content (headings,
text with a safe `**bold**` / `*italic*` / `[link](url)` subset, buttons,
images, callouts, dividers). Both helpers return `{ html, text }`; the
plaintext part is generated for you.

### Hosted composer (GitHub Pages)

`docs/index.html` is a self-contained composer that renders bulletproof HTML
**live in the browser** using the exact same code as the sender (bundled to
`docs/app.bundle.js`), so the preview and the sent email cannot drift. It lets
you edit content and branding, switch between desktop/mobile preview, view the
generated HTML and plaintext, and copy or download the result. Nothing is
uploaded — all rendering is client-side.

The `.github/workflows/pages.yml` workflow tests, rebuilds the bundle, and
deploys `docs/` to GitHub Pages on every push to `main`. To enable it once:
**Settings → Pages → Build and deployment → Source: GitHub Actions**. The
composer is then served at `https://foster1738.github.io/docusigh/`.

Rebuild the bundle locally after changing the renderer:

```bash
npm run build:browser   # regenerates docs/app.bundle.js
```

## Message priority

Set `priority` on a message to mark importance. It emits the standard
`X-Priority` / `X-MSMail-Priority` / `Importance` headers (and Nodemailer's
native priority for SMTP); clients may honour or ignore them.

```ts
await sender.enqueue({ ...message, priority: "high" });
```

Reserve `"high"` for genuinely time-critical mail — flagging routine messages
trains recipients to ignore it and can hurt deliverability.

## Using several SMTP providers

The provider list is a fallback chain, tried in order per attempt. Register up
to five SMTP relays (own domain, SES, a backup MX, etc.) for redundancy:

```ts
const sender = new EmailSender({
  providers: [
    new SmtpProvider({ name: "primary", host: "smtp1.example.com", auth: { user, pass } }),
    new SmtpProvider({ name: "backup", host: "smtp2.example.com", auth: { user, pass } }),
    // …up to five
  ],
});
```

This is for reliability. Deliverability still comes from authenticating every
sending domain (SPF, DKIM, DMARC), sending only to recipients who opted in, and
honouring the suppression list — not from rotating relays to dodge limits.

## AI drafting in the composer

The hosted composer includes an optional "Custom email (AI draft)" mode: describe
the email in a prompt, choose plain text or HTML, and it drafts a subject and
body you can edit before rendering. It uses the claude.ai `sample` capability,
so it appears only on the hosted artifact, not on a plain static host.

## Users, roles and admin approval

`AuthService` provides signup, admin approval, roles, sessions and password
hashing, with no secrets in the code.

```ts
import { AuthService, MemoryAuthStore } from "bulletproof-mailer";
// or PostgresAuthStore(pool) with src/auth/schema.sql applied

const auth = new AuthService({ store: new MemoryAuthStore() });

// The first signup bootstraps as an active admin; later signups are pending.
await auth.signup({ email: "owner@acme.com", password: process.env.OWNER_PW! });
const { user: admin, token } = await auth.login("owner@acme.com", process.env.OWNER_PW!);

// New users wait for approval before they can log in.
await auth.signup({ email: "teammate@acme.com", password: "…" });
const [pending] = await auth.listPending(admin);
await auth.approveUser(admin, pending.id);

// Sessions: authenticate on each request, then log out.
const me = await auth.authenticate(token);
```

- **Password hashing** uses scrypt by default (memory-hard, built in, no native
  dependency). Swap in argon2 or bcrypt by implementing `PasswordHasher`.
- **Sessions** are opaque random tokens; only the SHA-256 is stored, so a
  database leak exposes no usable tokens.
- **No committed secrets.** Provision the first admin with `bootstrapAdmin`
  from an env-driven setup script, never hardcoded credentials.

## Bulk sending: recipient files, mail-merge, and AI drafting

Import a recipient list from **CSV** (a header row with an `email` column; every
other column becomes a merge field) or **TXT** (one `email`, `email,Name`, or
`Name <email>` per line):

```ts
import { parseRecipients, sendBulk, AiDrafter } from "bulletproof-mailer";

const { recipients, skipped } = parseRecipients(fileContents); // auto-detects CSV vs TXT
```

Optionally draft the copy with AI (plain text or HTML), keeping `{{merge}}`
tokens for personalisation:

```ts
const draft = await new AiDrafter().draft({
  prompt: "Tell the customer their invoice {{invoice}} is ready, friendly and brief.",
  format: "html",
  senderName: "Acme Billing",
});
```

Then send, personalising each message from that recipient's own fields:

```ts
await sendBulk(sender, {
  from: { email: "billing@acme.com", name: "Acme Billing" },
  subject: draft.subject,          // "Invoice {{invoice}} is ready"
  html: draft.html,                 // merged values are HTML-escaped
  text: draft.text,
}, recipients, {
  campaignId: "2026-09-invoices",   // per-recipient idempotency key; re-runs never double-send
  senderName: "{{rep}} at Acme",    // optional per-send display name (merge fields allowed)
});
```

Mail-merge inserts each recipient's own data from the list you provide (their
name, their invoice number). Merged values are HTML-escaped in HTML bodies.
`sendBulk` enqueues through the durable sender, so retries, provider fallback,
and the suppression list all apply. Run `npm run example:bulk` for a working demo.

### On sender identity and deliverability

You can set an optional display name per send. The From **address** must be an
identity you are authorised to use — a domain you own, with SPF, DKIM and DMARC
configured. The sender does not spoof identities, rotate relays to evade limits,
vary subjects or content to dodge spam filters, or fabricate invoice/reference
numbers. Deliverability comes from authentication, a clean list, and honouring
unsubscribes and bounces.

## Pacing bulk sends

Control your own send rate with `pacing`: after every `batchSize` messages,
wait `pauseMs`. Both numbers are yours to choose.

```ts
await sendBulk(sender, template, recipients, {
  campaignId: "2026-09-invoices",
  pacing: { batchSize: 2, pauseMs: 10_000 }, // send 2, wait 10s, repeat
});
```

Use this (and per-provider rate limits) to stay **within** each provider's
published limits. For the actual delivery rate, set a rate limit on each
provider; the worker enforces it:

```ts
new EmailSender({
  providers: [smtpA, smtpB],
  rateLimits: { "smtp-a": { perSecond: 5 }, "smtp-b": { perSecond: 5 } },
});
```

### Running several SMTP relays

Register each SMTP relay you are authorised to use as a provider with its own
rate limit. When one reaches its configured limit, the sender moves to the next
and defers if all are at capacity, so load is spread across relays **within each
one's real limit**. That is the supported way to use multiple SMTPs.

What the sender deliberately does not do is blind round-robin rotation that
spreads volume across accounts to slip under each provider's per-account limits
or blocklists. That is filter/limit evasion, and it is how spam is sent. Set
each relay's true limit and stay within it instead.
