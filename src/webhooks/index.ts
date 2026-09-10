import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import type { BounceEvent } from "../types.js";

/**
 * Normalise provider webhook payloads into `BounceEvent`s and verify their
 * signatures. Feed the resulting events to `EmailSender.handleBounce`.
 *
 * Always verify before parsing: an unauthenticated webhook endpoint lets
 * anyone suppress arbitrary addresses.
 */

// ---------------------------------------------------------------------------
// Resend (Svix-signed)
// ---------------------------------------------------------------------------

export interface SvixHeaders {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
}

/**
 * Verify a Svix signature (used by Resend). `secret` is the `whsec_…` value
 * from the dashboard. Rejects payloads older than `toleranceSec`.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  toleranceSec = 300,
  now: () => number = Date.now,
): boolean {
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sigHeader = headers["svix-signature"];
  if (!id || !ts || !sigHeader) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now() / 1000 - tsNum) > toleranceSec) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  for (const part of sigHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

interface ResendPayload {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; subType?: string; message?: string };
  };
}

export function parseResendWebhook(payload: unknown): BounceEvent[] {
  const p = payload as ResendPayload;
  if (!p || typeof p.type !== "string") return [];
  const recipients = normaliseList(p.data?.to);
  const occurredAt = p.created_at ? new Date(p.created_at) : undefined;
  const base = {
    provider: "resend",
    raw: payload,
    ...(p.data?.email_id ? { providerMessageId: p.data.email_id } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  };
  switch (p.type) {
    case "email.bounced": {
      const kind = (p.data?.bounce?.type ?? "").toLowerCase();
      const bounceType: "hard" | "soft" = kind === "transient" || kind === "undetermined" ? "soft" : "hard";
      return recipients.map((email) => ({ ...base, type: "bounce", email, bounceType }));
    }
    case "email.complained":
      return recipients.map((email) => ({ ...base, type: "complaint", email }));
    case "email.delivered":
      return recipients.map((email) => ({ ...base, type: "delivered", email }));
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// SendGrid (ECDSA-signed event webhook)
// ---------------------------------------------------------------------------

/**
 * Verify SendGrid's Event Webhook signature. `publicKey` is the base64 value
 * shown in Mail Settings → Signed Event Webhook.
 */
export function verifySendGridSignature(rawBody: string, signature: string, timestamp: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return cryptoVerify("sha256", Buffer.from(timestamp + rawBody), { key, dsaEncoding: "der" }, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

interface SendGridEvent {
  event: string;
  email?: string;
  type?: string;
  sg_message_id?: string;
  timestamp?: number;
  reason?: string;
}

export function parseSendGridWebhook(payload: unknown): BounceEvent[] {
  if (!Array.isArray(payload)) return [];
  const out: BounceEvent[] = [];
  for (const raw of payload as SendGridEvent[]) {
    if (!raw || typeof raw.email !== "string") continue;
    const providerMessageId = raw.sg_message_id?.split(".")[0];
    const base = {
      provider: "sendgrid",
      raw,
      email: raw.email,
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(raw.timestamp ? { occurredAt: new Date(raw.timestamp * 1000) } : {}),
    };
    switch (raw.event) {
      case "bounce":
        // type "bounce" = hard, "blocked" = soft/transient
        out.push({ ...base, type: "bounce", bounceType: raw.type === "blocked" ? "soft" : "hard" });
        break;
      case "dropped":
        // SendGrid already refused to send (invalid address, on its suppression list)
        out.push({ ...base, type: "bounce", bounceType: "hard" });
        break;
      case "spamreport":
        out.push({ ...base, type: "complaint" });
        break;
      case "delivered":
        out.push({ ...base, type: "delivered" });
        break;
      default:
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postmark (protected by HTTP basic auth on the URL; no body signature)
// ---------------------------------------------------------------------------

interface PostmarkPayload {
  RecordType?: string;
  Type?: string;
  Email?: string;
  Recipient?: string;
  MessageID?: string;
  BouncedAt?: string;
  DeliveredAt?: string;
}

/** Postmark bounce types that permanently invalidate an address. */
const POSTMARK_HARD = new Set(["HardBounce", "BadEmailAddress", "Blocked", "ManuallyDeactivated", "Unsubscribe", "Unconfirmed"]);

export function parsePostmarkWebhook(payload: unknown): BounceEvent[] {
  const p = payload as PostmarkPayload;
  if (!p || typeof p !== "object") return [];
  const email = p.Email ?? p.Recipient;
  if (!email) return [];
  const base = {
    provider: "postmark",
    raw: payload,
    email,
    ...(p.MessageID ? { providerMessageId: p.MessageID } : {}),
  };
  switch (p.RecordType) {
    case "Bounce":
      if (p.Type === "SpamComplaint" || p.Type === "SpamNotification") {
        return [{ ...base, type: "complaint", ...(p.BouncedAt ? { occurredAt: new Date(p.BouncedAt) } : {}) }];
      }
      return [
        {
          ...base,
          type: "bounce",
          bounceType: POSTMARK_HARD.has(p.Type ?? "") ? "hard" : "soft",
          ...(p.BouncedAt ? { occurredAt: new Date(p.BouncedAt) } : {}),
        },
      ];
    case "SpamComplaint":
      return [{ ...base, type: "complaint", ...(p.BouncedAt ? { occurredAt: new Date(p.BouncedAt) } : {}) }];
    case "Delivery":
      return [{ ...base, type: "delivered", ...(p.DeliveredAt ? { occurredAt: new Date(p.DeliveredAt) } : {}) }];
    default:
      return [];
  }
}

/** Constant-time comparison for basic-auth secrets on webhook URLs. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function normaliseList(value: string[] | string | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(extractEmail).filter((v): v is string => Boolean(v));
}

function extractEmail(value: string): string | undefined {
  const m = value.match(/<([^>]+)>/);
  const email = (m?.[1] ?? value).trim().toLowerCase();
  return email || undefined;
}
