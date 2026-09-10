import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import type { EmailMessage, EmailProvider, ProviderSendResult } from "../types.js";
import { EmailError, toEmailError } from "../errors.js";

export interface SmtpProviderOptions {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  /** Reuse connections; strongly recommended for throughput. */
  pool?: boolean;
  name?: string;
  connectionTimeoutMs?: number;
  /** Pre-built transporter (for tests or custom transports). */
  transporter?: SmtpTransporter;
}

export type SmtpTransporter = Transporter<SMTPTransport.SentMessageInfo> | Transporter<SMTPPool.SentMessageInfo>;

/**
 * SMTP transport via Nodemailer. Works with Amazon SES SMTP, Mailgun SMTP,
 * Google Workspace, or an in-house relay. Useful as a last-resort fallback
 * behind the HTTP providers.
 */
export class SmtpProvider implements EmailProvider {
  readonly name: string;
  private readonly transporter: SmtpTransporter;

  constructor(options: SmtpProviderOptions) {
    this.name = options.name ?? "smtp";
    if (options.transporter) {
      this.transporter = options.transporter;
      return;
    }
    const common = {
      host: options.host,
      port: options.port ?? 587,
      secure: options.secure ?? false,
      ...(options.auth ? { auth: options.auth } : {}),
      connectionTimeout: options.connectionTimeoutMs ?? 10_000,
      greetingTimeout: options.connectionTimeoutMs ?? 10_000,
      socketTimeout: options.connectionTimeoutMs ?? 30_000,
    };
    this.transporter =
      options.pool === false
        ? nodemailer.createTransport(common satisfies SMTPTransport.Options)
        : nodemailer.createTransport({ ...common, pool: true } satisfies SMTPPool.Options);
  }

  async send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult> {
    const addr = (a: { email: string; name?: string }) => ({ address: a.email, name: a.name ?? "" });
    const mail = {
      from: addr(message.from),
      to: message.to.map(addr),
      ...(message.cc ? { cc: message.cc.map(addr) } : {}),
      ...(message.bcc ? { bcc: message.bcc.map(addr) } : {}),
      ...(message.replyTo ? { replyTo: addr(message.replyTo) } : {}),
      subject: message.subject,
      ...(message.text ? { text: message.text } : {}),
      ...(message.html ? { html: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.attachments
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: typeof a.content === "string" ? a.content : Buffer.from(a.content),
              ...(a.encoding ? { encoding: a.encoding } : {}),
              ...(a.contentType ? { contentType: a.contentType } : {}),
              ...(a.cid ? { cid: a.cid } : {}),
            })),
          }
        : {}),
    };

    if (signal.aborted) throw toEmailError(new DOMException("Aborted", "AbortError"), this.name);

    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });

    let info: SMTPTransport.SentMessageInfo | SMTPPool.SentMessageInfo;
    try {
      info = await Promise.race([(this.transporter as Transporter<SMTPTransport.SentMessageInfo>).sendMail(mail), abortPromise]);
    } catch (err) {
      throw classifySmtpError(err, this.name);
    }

    if (info.rejected && info.rejected.length > 0 && info.accepted.length === 0) {
      throw new EmailError(`smtp server rejected all recipients: ${info.rejected.map(String).join(", ")}`, {
        code: "PROVIDER_REJECTED",
        retryable: false,
        provider: this.name,
      });
    }
    return info.messageId ? { providerMessageId: info.messageId } : {};
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

/**
 * SMTP reply codes: 4xx are transient, 5xx are permanent. Nodemailer exposes
 * the code as `responseCode`.
 */
export function classifySmtpError(err: unknown, provider: string): EmailError {
  if (EmailError.isEmailError(err)) return err;
  const code = (err as { responseCode?: number })?.responseCode;
  if (typeof code === "number") {
    const message = err instanceof Error ? err.message : String(err);
    if (code === 421 || code === 450 || code === 451 || code === 452 || (code >= 400 && code < 500)) {
      return new EmailError(`smtp transient failure ${code}: ${message}`, {
        code: code === 421 ? "PROVIDER_UNAVAILABLE" : "RATE_LIMITED",
        retryable: true,
        provider,
        statusCode: code,
        cause: err,
      });
    }
    if (code === 535 || code === 530) {
      return new EmailError(`smtp authentication failed ${code}: ${message}`, {
        code: "AUTH",
        retryable: false,
        provider,
        statusCode: code,
        cause: err,
      });
    }
    if (code === 552) {
      return new EmailError(`smtp message too large ${code}: ${message}`, {
        code: "MESSAGE_TOO_LARGE",
        retryable: false,
        provider,
        statusCode: code,
        cause: err,
      });
    }
    if (code >= 500) {
      return new EmailError(`smtp permanent failure ${code}: ${message}`, {
        code: "PROVIDER_REJECTED",
        retryable: false,
        provider,
        statusCode: code,
        cause: err,
      });
    }
  }
  return toEmailError(err, provider);
}
