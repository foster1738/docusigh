import type { EmailMessage, EmailProvider, ProviderSendResult } from "../types.js";
import { EmailError } from "../errors.js";
import { httpJson, toBase64 } from "./http.js";
import { effectiveHeaders, hasKeys } from "../priority.js";
import { formatAddress } from "./resend.js";

/**
 * 300 invalid email request, 400 sender signature not found, 401 sender not
 * confirmed, 402 invalid JSON, 403 incompatible JSON, 406 inactive recipient,
 * 409 JSON too large, 300-series validation failures. None will succeed on retry.
 */
const POSTMARK_PERMANENT = new Set([300, 400, 401, 402, 403, 405, 406, 409, 410, 411, 412, 413]);

export interface PostmarkProviderOptions {
  serverToken: string;
  baseUrl?: string;
  /** Postmark message stream, e.g. "outbound" (default) or "broadcast". */
  messageStream?: string;
  fetchImpl?: typeof fetch;
}

/** https://postmarkapp.com/developer/api/email-api */
export class PostmarkProvider implements EmailProvider {
  readonly name = "postmark";
  private readonly baseUrl: string;

  constructor(private readonly options: PostmarkProviderOptions) {
    if (!options.serverToken) throw new Error("PostmarkProvider requires a serverToken");
    this.baseUrl = (options.baseUrl ?? "https://api.postmarkapp.com").replace(/\/$/, "");
  }

  async send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult> {
    const body = {
      From: formatAddress(message.from),
      To: message.to.map(formatAddress).join(","),
      ...(message.cc ? { Cc: message.cc.map(formatAddress).join(",") } : {}),
      ...(message.bcc ? { Bcc: message.bcc.map(formatAddress).join(",") } : {}),
      ...(message.replyTo ? { ReplyTo: formatAddress(message.replyTo) } : {}),
      Subject: message.subject,
      ...(message.text ? { TextBody: message.text } : {}),
      ...(message.html ? { HtmlBody: message.html } : {}),
      MessageStream: this.options.messageStream ?? "outbound",
      ...(hasKeys(effectiveHeaders(message)) ? { Headers: Object.entries(effectiveHeaders(message)).map(([Name, Value]) => ({ Name, Value })) } : {}),
      ...(message.tags?.tag ? { Tag: message.tags.tag } : {}),
      ...(message.tags ? { Metadata: message.tags } : {}),
      ...(message.attachments
        ? {
            Attachments: message.attachments.map((a) => ({
              Name: a.filename,
              Content: toBase64(a.content, a.encoding),
              ContentType: a.contentType ?? "application/octet-stream",
              ...(a.cid ? { ContentID: `cid:${a.cid}` } : {}),
            })),
          }
        : {}),
    };

    const res = await httpJson<{ MessageID?: string; ErrorCode?: number; Message?: string }>({
      provider: this.name,
      url: `${this.baseUrl}/email`,
      headers: { "X-Postmark-Server-Token": this.options.serverToken },
      body,
      signal,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });

    // Postmark can return HTTP 200 with a non-zero ErrorCode.
    // https://postmarkapp.com/developer/api/overview#error-codes
    if (res.ErrorCode && res.ErrorCode !== 0) {
      const detail = `postmark error ${res.ErrorCode}: ${res.Message ?? "unknown"}`;
      if (res.ErrorCode === 10) {
        // Bad or missing server token: fall through to the next provider.
        throw new EmailError(detail, { code: "AUTH", retryable: false, provider: this.name });
      }
      if (POSTMARK_PERMANENT.has(res.ErrorCode)) {
        throw new EmailError(detail, { code: "PROVIDER_REJECTED", retryable: false, provider: this.name });
      }
      throw new EmailError(detail, { code: "PROVIDER_UNAVAILABLE", retryable: true, provider: this.name });
    }
    return res.MessageID ? { providerMessageId: res.MessageID } : {};
  }
}
