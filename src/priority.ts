import type { EmailMessage, EmailPriority } from "./types.js";

/**
 * Standard importance headers. "high"/"low" set the trio understood across
 * Outlook, Apple Mail and most webmail; "normal" emits nothing. Clients are
 * free to ignore these — importance is a hint, never a delivery guarantee.
 */
export function priorityHeaders(priority?: EmailPriority): Record<string, string> {
  if (!priority || priority === "normal") return {};
  if (priority === "high") {
    return { "X-Priority": "1 (Highest)", "X-MSMail-Priority": "High", Importance: "High" };
  }
  return { "X-Priority": "5 (Lowest)", "X-MSMail-Priority": "Low", Importance: "Low" };
}

/** Caller headers merged with the priority headers derived from `message.priority`. */
export function effectiveHeaders(message: EmailMessage): Record<string, string> {
  const priority = priorityHeaders(message.priority);
  if (!message.headers && Object.keys(priority).length === 0) return {};
  return { ...(message.headers ?? {}), ...priority };
}

/** Nodemailer's native priority option, mapped from `message.priority`. */
export function nodemailerPriority(priority?: EmailPriority): "high" | "normal" | "low" | undefined {
  return priority && priority !== "normal" ? priority : undefined;
}

/** True when the object has at least one own enumerable key. */
export function hasKeys(o: Record<string, unknown>): boolean {
  for (const _ in o) return true;
  return false;
}
