import { describe, expect, it, vi } from "vitest";
import { EmailError, PostmarkProvider, ResendProvider, SendGridProvider, SmtpProvider, classifySmtpError } from "../src/index.js";
import { msg } from "./helpers.js";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const signal = new AbortController().signal;
const withAttachment = msg({
  attachments: [{ filename: "lease.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
  headers: { "X-Envelope": "env_1" },
  tags: { envelope: "env_1" },
});

describe("ResendProvider", () => {
  it("posts the expected payload and returns the id", async () => {
    const { fn, calls } = mockFetch(200, { id: "re_123" });
    const p = new ResendProvider({ apiKey: "re_key", fetchImpl: fn });
    const res = await p.send(withAttachment, signal);
    expect(res.providerMessageId).toBe("re_123");
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.from).toBe("DocuSigh <noreply@docusigh.test>");
    expect(body.to).toEqual(["Sam Signer <signer@example.com>"]);
    expect(body.attachments[0]).toMatchObject({ filename: "lease.pdf", content: "AQID", content_type: "application/pdf" });
    expect(body.tags).toEqual([{ name: "envelope", value: "env_1" }]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
  });

  it("classifies a 429 with Retry-After", async () => {
    const { fn } = mockFetch(429, { message: "slow down" }, { "retry-after": "2" });
    const p = new ResendProvider({ apiKey: "k", fetchImpl: fn });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfterMs: 2000 });
  });

  it("classifies a 422 as permanent", async () => {
    const { fn } = mockFetch(422, { message: "invalid to" });
    const p = new ResendProvider({ apiKey: "k", fetchImpl: fn });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
  });

  it("maps network failures to retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    }) as unknown as typeof fetch;
    const p = new ResendProvider({ apiKey: "k", fetchImpl: fn });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "NETWORK", retryable: true });
  });
});

describe("SendGridProvider", () => {
  it("reads the message id from the header on 202", async () => {
    const { fn, calls } = mockFetch(202, "", { "x-message-id": "sg_abc" });
    const p = new SendGridProvider({ apiKey: "SG.key", fetchImpl: fn });
    const res = await p.send(withAttachment, signal);
    expect(res.providerMessageId).toBe("sg_abc");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.personalizations[0].to).toEqual([{ email: "signer@example.com", name: "Sam Signer" }]);
    expect(body.content).toEqual([
      { type: "text/plain", value: "Open the link to sign." },
      { type: "text/html", value: "<p>Open the link to sign.</p>" },
    ]);
    expect(body.attachments[0]).toMatchObject({ filename: "lease.pdf", content: "AQID", type: "application/pdf" });
  });

  it("classifies 5xx as retryable", async () => {
    const { fn } = mockFetch(500, "oops");
    const p = new SendGridProvider({ apiKey: "k", fetchImpl: fn });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });
});

describe("PostmarkProvider", () => {
  it("posts the expected payload", async () => {
    const { fn, calls } = mockFetch(200, { MessageID: "pm_1", ErrorCode: 0 });
    const p = new PostmarkProvider({ serverToken: "tok", fetchImpl: fn });
    const res = await p.send(withAttachment, signal);
    expect(res.providerMessageId).toBe("pm_1");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.To).toBe("Sam Signer <signer@example.com>");
    expect(body.MessageStream).toBe("outbound");
    expect(body.Attachments[0]).toMatchObject({ Name: "lease.pdf", Content: "AQID" });
    expect((calls[0]!.init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("tok");
  });

  it("treats an inactive recipient (ErrorCode 406) as permanent", async () => {
    const { fn } = mockFetch(200, { ErrorCode: 406, Message: "Inactive recipient" });
    const p = new PostmarkProvider({ serverToken: "tok", fetchImpl: fn });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
  });
});

describe("SmtpProvider", () => {
  it("sends through a supplied transporter", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<abc@smtp>", accepted: ["signer@example.com"], rejected: [] }));
    const p = new SmtpProvider({ host: "unused", transporter: { sendMail, close() {} } as never });
    const res = await p.send(withAttachment, signal);
    expect(res.providerMessageId).toBe("<abc@smtp>");
    const mail = sendMail.mock.calls[0]![0 as never] as { from: unknown; to: unknown };
    expect(mail.from).toEqual({ address: "noreply@docusigh.test", name: "DocuSigh" });
    expect(mail.to).toEqual([{ address: "signer@example.com", name: "Sam Signer" }]);
  });

  it("fails permanently when every recipient is rejected", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "x", accepted: [], rejected: ["signer@example.com"] }));
    const p = new SmtpProvider({ host: "unused", transporter: { sendMail, close() {} } as never });
    await expect(p.send(msg(), signal)).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
  });

  it("aborts on the signal", async () => {
    const sendMail = vi.fn(() => new Promise(() => {}));
    const p = new SmtpProvider({ host: "unused", transporter: { sendMail, close() {} } as never });
    const controller = new AbortController();
    const pending = p.send(msg(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("classifies SMTP reply codes", () => {
    const mk = (responseCode: number) => Object.assign(new Error("smtp"), { responseCode });
    expect(classifySmtpError(mk(421), "smtp")).toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(classifySmtpError(mk(450), "smtp")).toMatchObject({ retryable: true });
    expect(classifySmtpError(mk(535), "smtp")).toMatchObject({ code: "AUTH", retryable: false });
    expect(classifySmtpError(mk(552), "smtp")).toMatchObject({ code: "MESSAGE_TOO_LARGE", retryable: false });
    expect(classifySmtpError(mk(550), "smtp")).toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
    expect(classifySmtpError(new Error("x"), "smtp")).toBeInstanceOf(EmailError);
  });
});
