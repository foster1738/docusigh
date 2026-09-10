import { describe, expect, it } from "vitest";
import { EmailError, estimateMessageBytes, isValidEmail, validateMessage } from "../src/index.js";
import { msg } from "./helpers.js";

describe("validateMessage", () => {
  it("accepts a well-formed message and lowercases addresses", () => {
    const out = validateMessage(msg({ to: [{ email: "Signer@Example.COM" }] }));
    expect(out.to[0]?.email).toBe("signer@example.com");
  });

  it("rejects a missing recipient", () => {
    expect(() => validateMessage(msg({ to: [] }))).toThrowError(EmailError);
  });

  it("rejects an invalid email address", () => {
    for (const bad of ["nope", "a@b", "a@@b.com", "a b@c.com", ".a@b.com", "a..b@c.com", "a@-b.com"]) {
      expect(() => validateMessage(msg({ to: [{ email: bad }] })), bad).toThrowError(/Invalid email/);
    }
  });

  it("rejects header injection in the subject", () => {
    expect(() => validateMessage(msg({ subject: "Hi\r\nBcc: victim@example.com" }))).toThrowError(/illegal characters/);
  });

  it("rejects header injection in display names and custom headers", () => {
    expect(() => validateMessage(msg({ from: { email: "a@b.com", name: "X\nBcc: y@z.com" } }))).toThrowError(EmailError);
    expect(() => validateMessage(msg({ headers: { "X-Custom": "a\r\nb" } }))).toThrowError(/illegal characters/);
    expect(() => validateMessage(msg({ headers: { "Bad Name": "x" } }))).toThrowError(/Invalid header name/);
  });

  it("rejects reserved headers", () => {
    expect(() => validateMessage(msg({ headers: { Bcc: "x@y.com" } }))).toThrowError(/reserved/);
  });

  it("requires a body", () => {
    expect(() => validateMessage(msg({ text: undefined, html: undefined }))).toThrowError(/body is required/);
  });

  it("marks validation errors as non-retryable", () => {
    try {
      validateMessage(msg({ subject: "" }));
      expect.fail("should throw");
    } catch (err) {
      expect(EmailError.isEmailError(err)).toBe(true);
      expect((err as EmailError).retryable).toBe(false);
      expect((err as EmailError).code).toBe("VALIDATION");
    }
  });

  it("enforces the size limit including attachments", () => {
    const big = new Uint8Array(2000);
    const m = msg({ attachments: [{ filename: "a.pdf", content: big, contentType: "application/pdf" }] });
    expect(estimateMessageBytes(m)).toBeGreaterThan(2000);
    expect(() => validateMessage(m, { maxMessageBytes: 1000 })).toThrowError(/exceeds/);
    expect(validateMessage(m, { maxMessageBytes: 10_000 })).toBeTruthy();
  });

  it("rejects attachment filenames with path separators", () => {
    expect(() => validateMessage(msg({ attachments: [{ filename: "../x.pdf", content: "a" }] }))).toThrowError(EmailError);
  });

  it("isValidEmail is a cheap pre-check", () => {
    expect(isValidEmail("ok@example.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
  });
});
