import { mergeString } from "./merge.js";
import type { Recipient } from "./recipients.js";
import type { EmailSender } from "./sender.js";
import type { EmailAddress, EmailAttachment, EmailPriority } from "./types.js";

export interface BulkTemplate {
  /** Sender address. Must be an identity you are authorised to send from. */
  from: EmailAddress;
  replyTo?: EmailAddress;
  /** Subject, may contain {{merge}} fields. */
  subject: string;
  /** Plain-text body with {{merge}} fields. Strongly recommended. */
  text?: string;
  /** HTML body with {{merge}} fields (merged values are HTML-escaped). */
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  priority?: EmailPriority;
  /** Campaign-level merge values available to every recipient. */
  globals?: Record<string, string>;
}

export interface BulkSendOptions {
  /**
   * Optional per-send display name. When set, overrides the template's From
   * display name (the address is unchanged — you must still be authorised to
   * send from it). May contain {{merge}} fields.
   */
  senderName?: string;
  /** Stable id used to build per-recipient idempotency keys so re-runs don't double-send. */
  campaignId: string;
  /** Milliseconds between enqueues, to stay within provider rate limits. Default 0. */
  perMessageDelayMs?: number;
  /**
   * Batch pacing, so you can send within a provider's rate limits: after every
   * `batchSize` messages, wait `pauseMs` before continuing. Both numbers are
   * yours to choose — e.g. `{ batchSize: 2, pauseMs: 10_000 }` sends two, waits
   * ten seconds, sends two more, and so on.
   */
  pacing?: { batchSize: number; pauseMs: number };
  /** Injectable sleep, for tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  metadata?: Record<string, unknown>;
}

export interface BulkSendResult {
  campaignId: string;
  enqueued: { email: string; id: string; deduplicated: boolean }[];
  failed: { email: string; error: string }[];
}

/**
 * Send one template to a recipient list, personalising each message from that
 * recipient's own fields (mail-merge). Each message is enqueued through the
 * durable sender with a per-recipient idempotency key, so re-running a
 * campaign never sends a recipient the same message twice, and suppressed or
 * bounced addresses are dropped by the sender as usual.
 *
 * This is for sending to a list you are permitted to email (opted-in, or a
 * legitimate transactional audience). It does not fabricate content or rotate
 * identities.
 */
export async function sendBulk(
  sender: EmailSender,
  template: BulkTemplate,
  recipients: Recipient[],
  options: BulkSendOptions,
): Promise<BulkSendResult> {
  const result: BulkSendResult = { campaignId: options.campaignId, enqueued: [], failed: [] };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pacing = normalizePacing(options.pacing);
  let sincePause = 0;

  for (const recipient of recipients) {
    const ctx = { recipient, ...(template.globals ? { globals: template.globals } : {}) };
    try {
      const displayName = options.senderName ? mergeString(options.senderName, ctx) : template.from.name;
      const message = {
        from: displayName ? { email: template.from.email, name: displayName } : { email: template.from.email },
        to: [recipient.name ? { email: recipient.email, name: recipient.name } : { email: recipient.email }],
        ...(template.replyTo ? { replyTo: template.replyTo } : {}),
        subject: mergeString(template.subject, ctx),
        ...(template.text ? { text: mergeString(template.text, ctx) } : {}),
        ...(template.html ? { html: mergeString(template.html, ctx, { html: true }) } : {}),
        ...(template.attachments ? { attachments: template.attachments } : {}),
        ...(template.headers ? { headers: template.headers } : {}),
        ...(template.priority ? { priority: template.priority } : {}),
      };
      const res = await sender.enqueue(message, {
        idempotencyKey: `campaign:${options.campaignId}:${recipient.email.toLowerCase()}`,
        ...(options.metadata ? { metadata: { ...options.metadata, campaignId: options.campaignId, email: recipient.email } } : { metadata: { campaignId: options.campaignId, email: recipient.email } }),
      });
      result.enqueued.push({ email: recipient.email, id: res.id, deduplicated: res.deduplicated });
    } catch (err) {
      result.failed.push({ email: recipient.email, error: err instanceof Error ? err.message : String(err) });
    }
    if (options.perMessageDelayMs && options.perMessageDelayMs > 0) {
      await sleep(options.perMessageDelayMs);
    }
    // Batch pacing: after every `batchSize` messages, wait `pauseMs`.
    if (pacing) {
      sincePause += 1;
      if (sincePause >= pacing.batchSize) {
        sincePause = 0;
        await sleep(pacing.pauseMs);
      }
    }
  }
  return result;
}

function normalizePacing(pacing: BulkSendOptions["pacing"]): { batchSize: number; pauseMs: number } | null {
  if (!pacing) return null;
  const batchSize = Math.floor(pacing.batchSize);
  const pauseMs = Math.floor(pacing.pauseMs);
  if (!Number.isFinite(batchSize) || batchSize < 1) throw new Error("pacing.batchSize must be a positive integer");
  if (!Number.isFinite(pauseMs) || pauseMs < 0) throw new Error("pacing.pauseMs must be zero or more");
  return { batchSize, pauseMs };
}
