import type { EmailAddress, EmailMessage, EmailProvider, ProviderSendResult } from "../types.js";
import { httpJson, toBase64 } from "./http.js";

export interface ResendProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** https://resend.com/docs/api-reference/emails/send-email */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly baseUrl: string;

  constructor(private readonly options: ResendProviderOptions) {
    if (!options.apiKey) throw new Error("ResendProvider requires an apiKey");
    this.baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
  }

  async send(message: EmailMessage, signal: AbortSignal): Promise<ProviderSendResult> {
    const body = {
      from: formatAddress(message.from),
      to: message.to.map(formatAddress),
      ...(message.cc ? { cc: message.cc.map(formatAddress) } : {}),
      ...(message.bcc ? { bcc: message.bcc.map(formatAddress) } : {}),
      ...(message.replyTo ? { reply_to: formatAddress(message.replyTo) } : {}),
      subject: message.subject,
      ...(message.text ? { text: message.text } : {}),
      ...(message.html ? { html: message.html } : {}),
      ...(message.headers ? { headers: message.headers } : {}),
      ...(message.tags ? { tags: Object.entries(message.tags).map(([name, value]) => ({ name, value })) } : {}),
      ...(message.attachments
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: toBase64(a.content, a.encoding),
              ...(a.contentType ? { content_type: a.contentType } : {}),
              ...(a.cid ? { content_id: a.cid } : {}),
            })),
          }
        : {}),
    };
    const res = await httpJson<{ id?: string }>({
      provider: this.name,
      url: `${this.baseUrl}/emails`,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body,
      signal,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
    return res.id ? { providerMessageId: res.id } : {};
  }
}

export function formatAddress(a: EmailAddress): string {
  return a.name ? `${a.name.replace(/"/g, "'")} <${a.email}>` : a.email;
}
