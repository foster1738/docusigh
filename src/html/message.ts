import type { EmailAddress, EmailAttachment, EmailMessage } from "../types.js";
import type { RenderedEmail } from "./types.js";

export interface MessageEnvelope {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress;
  subject: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  tags?: Record<string, string>;
}

/**
 * Combine a rendered bulletproof email (html + text) with the envelope fields
 * into an `EmailMessage` ready for `EmailSender.enqueue`. Always includes the
 * plaintext part, which improves deliverability and covers text-only clients.
 */
export function toEmailMessage(rendered: RenderedEmail, envelope: MessageEnvelope): EmailMessage {
  return {
    from: envelope.from,
    to: envelope.to,
    ...(envelope.cc ? { cc: envelope.cc } : {}),
    ...(envelope.bcc ? { bcc: envelope.bcc } : {}),
    ...(envelope.replyTo ? { replyTo: envelope.replyTo } : {}),
    subject: envelope.subject,
    text: rendered.text,
    html: rendered.html,
    ...(envelope.attachments ? { attachments: envelope.attachments } : {}),
    ...(envelope.headers ? { headers: envelope.headers } : {}),
    ...(envelope.tags ? { tags: envelope.tags } : {}),
  };
}
