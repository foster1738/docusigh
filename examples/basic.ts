/**
 * Minimal end-to-end example. Runs with no credentials using the console
 * provider; set RESEND_API_KEY / POSTMARK_SERVER_TOKEN / SMTP_HOST to send
 * for real through a fallback chain.
 *
 *   npm run example
 */
import {
  ConsoleProvider,
  EmailSender,
  PostmarkProvider,
  ResendProvider,
  SmtpProvider,
  consoleLogger,
  type EmailProvider,
} from "../src/index.js";

const providers: EmailProvider[] = [];
if (process.env.RESEND_API_KEY) providers.push(new ResendProvider({ apiKey: process.env.RESEND_API_KEY }));
if (process.env.POSTMARK_SERVER_TOKEN) providers.push(new PostmarkProvider({ serverToken: process.env.POSTMARK_SERVER_TOKEN }));
if (process.env.SMTP_HOST) {
  providers.push(
    new SmtpProvider({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      ...(process.env.SMTP_USER && process.env.SMTP_PASS ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {}),
    }),
  );
}
if (providers.length === 0) providers.push(new ConsoleProvider());

const sender = new EmailSender({
  providers,
  logger: consoleLogger("info"),
  maxAttempts: 6,
  attemptTimeoutMs: 10_000,
  rateLimits: { resend: { perSecond: 10 }, postmark: { perSecond: 10 } },
});

sender.on("dead", ({ record, error }) => {
  console.error(`DEAD LETTER ${record.id}: ${error.code} ${error.message}`);
});

sender.start();

const result = await sender.enqueue(
  {
    from: { email: process.env.EMAIL_FROM ?? "noreply@example.com", name: "Example" },
    to: [{ email: process.env.EMAIL_TO ?? "signer@example.com" }],
    subject: "Welcome to Example",
    text: "Thanks for signing up. Visit https://example.com/start to get started.",
    html: '<p>Thanks for signing up. <a href="https://example.com/start">Get started</a>.</p>',
  },
  { idempotencyKey: "welcome:user@example.com", metadata: { campaign: "welcome" } },
);
console.log("enqueued", result);

// Give the worker a moment, then report and shut down cleanly.
await new Promise((r) => setTimeout(r, 1500));
console.log("status", (await sender.getStatus(result.id))?.status);
console.log("stats", await sender.getStats());
console.log("providers", sender.providerHealth());
await sender.stop();
