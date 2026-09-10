import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parsePostmarkWebhook,
  parseResendWebhook,
  parseSendGridWebhook,
  safeEqual,
  verifySendGridSignature,
  verifySvixSignature,
} from "../src/index.js";

describe("Resend webhooks", () => {
  it("verifies a Svix signature and rejects tampering or stale timestamps", () => {
    const secretBytes = Buffer.from("0123456789abcdef0123456789abcdef");
    const secret = `whsec_${secretBytes.toString("base64")}`;
    const body = JSON.stringify({ type: "email.bounced" });
    const now = 1_700_000_000_000;
    const ts = String(Math.floor(now / 1000));
    const sig = createHmac("sha256", secretBytes).update(`msg_1.${ts}.${body}`).digest("base64");
    const headers = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` };

    expect(verifySvixSignature(body, headers, secret, 300, () => now)).toBe(true);
    expect(verifySvixSignature(body + " ", headers, secret, 300, () => now)).toBe(false);
    expect(verifySvixSignature(body, { ...headers, "svix-signature": "v1,AAAA" }, secret, 300, () => now)).toBe(false);
    expect(verifySvixSignature(body, headers, secret, 300, () => now + 600_000)).toBe(false);
  });

  it("parses bounce, complaint and delivered events", () => {
    const bounced = parseResendWebhook({
      type: "email.bounced",
      created_at: "2026-01-01T00:00:00Z",
      data: { email_id: "re_1", to: ["Sam <signer@example.com>"], bounce: { type: "Permanent" } },
    });
    expect(bounced).toEqual([
      expect.objectContaining({ type: "bounce", bounceType: "hard", email: "signer@example.com", providerMessageId: "re_1", provider: "resend" }),
    ]);
    expect(parseResendWebhook({ type: "email.bounced", data: { to: "a@b.com", bounce: { type: "Transient" } } })[0]).toMatchObject({ bounceType: "soft" });
    expect(parseResendWebhook({ type: "email.complained", data: { to: ["a@b.com"] } })[0]).toMatchObject({ type: "complaint" });
    expect(parseResendWebhook({ type: "email.delivered", data: { to: ["a@b.com"] } })[0]).toMatchObject({ type: "delivered" });
    expect(parseResendWebhook({ type: "email.opened", data: { to: ["a@b.com"] } })).toEqual([]);
    expect(parseResendWebhook(null)).toEqual([]);
  });
});

describe("SendGrid webhooks", () => {
  it("verifies an ECDSA signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = JSON.stringify([{ event: "bounce", email: "a@b.com" }]);
    const ts = "1700000000";
    const signature = sign("sha256", Buffer.from(ts + body), { key: privateKey, dsaEncoding: "der" }).toString("base64");
    const pub = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(verifySendGridSignature(body, signature, ts, pub)).toBe(true);
    expect(verifySendGridSignature(body + "x", signature, ts, pub)).toBe(false);
    expect(verifySendGridSignature(body, signature, ts, "not-a-key")).toBe(false);
  });

  it("parses event batches", () => {
    const events = parseSendGridWebhook([
      { event: "bounce", type: "bounce", email: "hard@x.com", sg_message_id: "abc.filter1", timestamp: 1700000000 },
      { event: "bounce", type: "blocked", email: "soft@x.com" },
      { event: "dropped", email: "dropped@x.com" },
      { event: "spamreport", email: "spam@x.com" },
      { event: "delivered", email: "ok@x.com" },
      { event: "open", email: "ok@x.com" },
    ]);
    expect(events.map((e) => [e.type, e.email, e.bounceType])).toEqual([
      ["bounce", "hard@x.com", "hard"],
      ["bounce", "soft@x.com", "soft"],
      ["bounce", "dropped@x.com", "hard"],
      ["complaint", "spam@x.com", undefined],
      ["delivered", "ok@x.com", undefined],
    ]);
    expect(events[0]?.providerMessageId).toBe("abc");
    expect(parseSendGridWebhook({})).toEqual([]);
  });
});

describe("Postmark webhooks", () => {
  it("parses bounce, complaint and delivery records", () => {
    expect(parsePostmarkWebhook({ RecordType: "Bounce", Type: "HardBounce", Email: "a@b.com", MessageID: "pm_1" })[0]).toMatchObject({
      type: "bounce",
      bounceType: "hard",
      providerMessageId: "pm_1",
    });
    expect(parsePostmarkWebhook({ RecordType: "Bounce", Type: "SoftBounce", Email: "a@b.com" })[0]).toMatchObject({ bounceType: "soft" });
    expect(parsePostmarkWebhook({ RecordType: "Bounce", Type: "SpamComplaint", Email: "a@b.com" })[0]).toMatchObject({ type: "complaint" });
    expect(parsePostmarkWebhook({ RecordType: "SpamComplaint", Email: "a@b.com" })[0]).toMatchObject({ type: "complaint" });
    expect(parsePostmarkWebhook({ RecordType: "Delivery", Recipient: "a@b.com" })[0]).toMatchObject({ type: "delivered" });
    expect(parsePostmarkWebhook({ RecordType: "Open", Recipient: "a@b.com" })).toEqual([]);
    expect(parsePostmarkWebhook("nope")).toEqual([]);
  });

  it("safeEqual compares secrets in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
