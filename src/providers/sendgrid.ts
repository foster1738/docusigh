import type { EmailMessage, EmailProvider, ProviderSendResult } from "../types.js";
import { EmailError, classifyHttpStatus, toEmailError } from "../errors.js";
import { toBase64 } from "./http.js";
import { effectiveHeaders, hasKeys } from "../priority.js";

export interface SendGridProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** https://docs.sendgrid.com/api-reference/mail-send/mail-send */
export class SendGridProvider implements EmailProvider {
  readonly name = "sendgrid";
  private readonly baseUrl: string;

  constructor(private readonly options: SendGridProviderOptions) {
    if (!options.apiKey) throw new Error("SendGridProvider requires an apiKey");
    this.baseUrl = (options.baseUrl ?? "https://api.sendgrid.com").replace(/\/$/, "");
  }

  async send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult> {
    const content: { type: string; value: string }[] = [];
    if (message.text) content.push({ type: "text/plain", value: message.text });
    if (message.html) content.push({ type: "text/html", value: message.html });

    const body = {
      personalizations: [
        {
          to: message.to,
          ...(message.cc ? { cc: message.cc } : {}),
          ...(message.bcc ? { bcc: message.bcc } : {}),
        },
      ],
      from: message.from,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      subject: message.subject,
      content,
      ...(hasKeys(effectiveHeaders(message)) ? { headers: effectiveHeaders(message) } : {}),
      ...(message.tags ? { custom_args: message.tags } : {}),
      ...(message.attachments
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content, a.encoding),
              ...(a.contentType ? { type: a.contentType } : {}),
              ...(a.cid ? { content_id: a.cid, disposition: "inline" } : {}),
            })),
          }
        : {}),
    };

    // SendGrid returns 202 with an empty body and the id in X-Message-Id, so
    // we cannot reuse httpJson's JSON parsing here.
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(`${this.baseUrl}/v3/mail/send`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw toEmailError(err, this.name);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw classifyHttpStatus(this.name, res.status, text, res.headers.get("retry-after"));
    }
    const id = res.headers.get("x-message-id");
    if (res.status !== 202 && res.status !== 200) {
      throw new EmailError(`sendgrid returned unexpected status ${res.status}`, {
        code: "UNKNOWN",
        retryable: true,
        provider: this.name,
        statusCode: res.status,
      });
    }
    return id ? { providerMessageId: id } : {};
  }
}
