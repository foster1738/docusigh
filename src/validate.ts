import { z } from "zod";
import { EmailError } from "./errors.js";
import type { EmailMessage } from "./types.js";

/**
 * Pragmatic RFC 5322 address check: one `@`, a non-empty local part without
 * whitespace or control characters, and a domain with at least one dot and no
 * leading/trailing hyphen in labels. Full RFC grammar is intentionally not
 * reproduced here; providers perform the authoritative check.
 */
const EMAIL_RE =
  /^(?!\.)(?!.*\.\.)[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** CR, LF and NUL are never legal inside a header value. */
const HEADER_INJECTION_RE = /[\r\n\0]/;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,78}$/;

/** Headers the caller must not set because the transport controls them. */
const RESERVED_HEADERS = new Set([
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "reply-to",
  "content-type",
  "content-transfer-encoding",
  "mime-version",
  "date",
  "message-id",
  "return-path",
  "received",
  "dkim-signature",
]);

export const DEFAULT_MAX_MESSAGE_BYTES = 10 * 1024 * 1024; // 10 MiB, below most provider limits

const addressSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, "Email address too long")
    .refine((v) => EMAIL_RE.test(v), { message: "Invalid email address" })
    .transform((v) => v.toLowerCase()),
  name: z
    .string()
    .trim()
    .max(255)
    .refine((v) => !HEADER_INJECTION_RE.test(v), { message: "Display name contains illegal characters" })
    .optional(),
});

const attachmentSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((v) => !HEADER_INJECTION_RE.test(v) && !v.includes("/") && !v.includes("\\"), {
      message: "Invalid attachment filename",
    }),
  content: z.union([z.instanceof(Uint8Array), z.string()]),
  contentType: z.string().max(255).optional(),
  encoding: z.literal("base64").optional(),
  cid: z.string().max(255).optional(),
});

export const messageSchema = z
  .object({
    from: addressSchema,
    to: z.array(addressSchema).min(1, "At least one recipient is required").max(50),
    cc: z.array(addressSchema).max(50).optional(),
    bcc: z.array(addressSchema).max(50).optional(),
    replyTo: addressSchema.optional(),
    subject: z
      .string()
      .trim()
      .min(1, "Subject is required")
      .max(998, "Subject too long")
      .refine((v) => !HEADER_INJECTION_RE.test(v), { message: "Subject contains illegal characters" }),
    text: z.string().optional(),
    html: z.string().optional(),
    attachments: z.array(attachmentSchema).max(20).optional(),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .superRefine((headers, ctx) => {
        if (!headers) return;
        for (const [name, value] of Object.entries(headers)) {
          if (!HEADER_NAME_RE.test(name)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid header name "${name}"` });
          } else if (RESERVED_HEADERS.has(name.toLowerCase())) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Header "${name}" is reserved` });
          }
          if (HEADER_INJECTION_RE.test(value)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Header "${name}" contains illegal characters` });
          }
        }
      }),
    tags: z.record(z.string().max(64), z.string().max(256)).optional(),
  })
  .refine((m) => (m.text && m.text.length > 0) || (m.html && m.html.length > 0), {
    message: "Either text or html body is required",
  });

export interface ValidateOptions {
  maxMessageBytes?: number;
}

/**
 * Validate and normalise a message. Throws a non-retryable `EmailError` with
 * code `VALIDATION` so a bad message is dead-lettered immediately instead of
 * being retried.
 */
export function validateMessage(input: EmailMessage, options: ValidateOptions = {}): EmailMessage {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "message"}: ${i.message}`).join("; ");
    throw new EmailError(`Invalid email message: ${detail}`, { code: "VALIDATION", retryable: false });
  }
  const message = stripUndefined(parsed.data) as EmailMessage;
  const size = estimateMessageBytes(message);
  const limit = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  if (size > limit) {
    throw new EmailError(`Message is ${size} bytes which exceeds the ${limit} byte limit`, {
      code: "MESSAGE_TOO_LARGE",
      retryable: false,
    });
  }
  return message;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Rough size: bodies plus attachments (base64 inflates by ~4/3). */
export function estimateMessageBytes(message: EmailMessage): number {
  let size = Buffer.byteLength(message.subject) + Buffer.byteLength(message.text ?? "") + Buffer.byteLength(message.html ?? "");
  for (const a of message.attachments ?? []) {
    const raw = typeof a.content === "string" ? Buffer.byteLength(a.content) : a.content.byteLength;
    size += a.encoding === "base64" || typeof a.content === "string" ? raw : Math.ceil((raw * 4) / 3);
  }
  return size;
}

export function allRecipients(message: EmailMessage): string[] {
  const out = new Set<string>();
  for (const list of [message.to, message.cc ?? [], message.bcc ?? []]) {
    for (const a of list) out.add(a.email.toLowerCase());
  }
  return [...out];
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object" && !(value instanceof Uint8Array) && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
