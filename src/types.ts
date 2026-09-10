/**
 * Core public types for the email sender.
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  /** Raw bytes or base64-encoded string. */
  content: Uint8Array | string;
  contentType?: string;
  /** Set when `content` is a base64 string. */
  encoding?: "base64";
  /** Content-ID for inline images referenced from the HTML body. */
  cid?: string;
}

export interface EmailMessage {
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** Extra SMTP headers. Names and values are validated against header injection. */
  headers?: Record<string, string>;
  /** Free-form tags forwarded to the provider when supported. */
  tags?: Record<string, string>;
}

export type EmailStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "dead"
  | "suppressed"
  | "cancelled"
  | "bounced";

export interface EmailAttempt {
  attempt: number;
  provider: string;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface OutboxRecord {
  id: string;
  idempotencyKey: string;
  message: EmailMessage;
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  /** Worker id that currently holds the lease, if any. */
  leaseOwner?: string;
  leaseExpiresAt?: Date;
  provider?: string;
  providerMessageId?: string;
  lastError?: string;
  history: EmailAttempt[];
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  /** Optional caller-supplied metadata (e.g. envelopeId, userId). */
  metadata?: Record<string, unknown>;
}

export interface SendOptions {
  /**
   * Unique key so the same logical email is never sent twice. When omitted a
   * deterministic key is derived from the message content.
   */
  idempotencyKey?: string;
  /** Override the sender-wide maximum attempts for this message. */
  maxAttempts?: number;
  /** Delay the first delivery attempt until this time. */
  sendAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface EnqueueResult {
  id: string;
  idempotencyKey: string;
  /** True when an existing record with the same idempotency key was returned. */
  deduplicated: boolean;
  status: EmailStatus;
}

export interface ProviderSendResult {
  providerMessageId?: string;
}

/**
 * A transport that can deliver a single message. Implementations must throw an
 * `EmailError` (or any error, which is treated as retryable) on failure.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult>;
}

export type SuppressionReason = "bounce" | "complaint" | "unsubscribe" | "manual";

export interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  source?: string;
  createdAt: Date;
  /** Optional expiry for soft bounces. */
  expiresAt?: Date;
}

export interface BounceEvent {
  type: "bounce" | "complaint" | "delivered" | "unknown";
  email: string;
  /** "hard" bounces are permanent; "soft" bounces are transient. */
  bounceType?: "hard" | "soft";
  providerMessageId?: string;
  provider: string;
  raw: unknown;
  occurredAt?: Date;
}
