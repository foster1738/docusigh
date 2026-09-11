import { describe, expect, it, vi } from "vitest";
import { PostmarkProvider, ResendProvider, SmtpProvider, effectiveHeaders, priorityHeaders } from "../src/index.js";
import { msg } from "./helpers.js";

const signal = new AbortController().signal;
function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { init: RequestInit }[] = [];
  const fn = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("priority headers", () => {
  it("maps priority to the standard header trio", () => {
    expect(priorityHeaders("high")).toEqual({ "X-Priority": "1 (Highest)", "X-MSMail-Priority": "High", Importance: "High" });
    expect(priorityHeaders("low")).toMatchObject({ Importance: "Low" });
    expect(priorityHeaders("normal")).toEqual({});
    expect(priorityHeaders(undefined)).toEqual({});
  });

  it("merges caller headers with priority headers", () => {
    const m = msg({ headers: { "X-Envelope": "e1" }, priority: "high" });
    expect(effectiveHeaders(m)).toMatchObject({ "X-Envelope": "e1", Importance: "High" });
  });

  it("Resend sends priority headers", async () => {
    const { fn, calls } = mockFetch(200, { id: "re_1" });
    await new ResendProvider({ apiKey: "k", fetchImpl: fn }).send(msg({ priority: "high" }), signal);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.headers).toMatchObject({ Importance: "High", "X-Priority": "1 (Highest)" });
  });

  it("Postmark converts priority headers to its array shape", async () => {
    const { fn, calls } = mockFetch(200, { MessageID: "pm_1", ErrorCode: 0 });
    await new PostmarkProvider({ serverToken: "t", fetchImpl: fn }).send(msg({ priority: "high" }), signal);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.Headers).toEqual(expect.arrayContaining([{ Name: "Importance", Value: "High" }]));
  });

  it("SMTP sets nodemailer's native priority and headers", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "x", accepted: ["signer@example.com"], rejected: [] }));
    await new SmtpProvider({ host: "u", transporter: { sendMail, close() {} } as never }).send(msg({ priority: "high" }), signal);
    const mail = sendMail.mock.calls[0]![0 as never] as { priority?: string; headers?: Record<string, string> };
    expect(mail.priority).toBe("high");
    expect(mail.headers).toMatchObject({ Importance: "High" });
  });

  it("emits no priority headers for normal mail", async () => {
    const { fn, calls } = mockFetch(200, { id: "re_1" });
    await new ResendProvider({ apiKey: "k", fetchImpl: fn }).send(msg(), signal);
    expect(JSON.parse(calls[0]!.init.body as string).headers).toBeUndefined();
  });
});
