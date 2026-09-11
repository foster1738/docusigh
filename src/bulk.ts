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
      await new Promise((r) => setTimeout(r, options.perMessageDelayMs));
    }
  }
  return result;
}
