import { describe, expect, it } from "vitest";
import { EmailSender, FakeProvider, parseRecipients, sendBulk } from "../src/index.js";

function setup() {
  const provider = new FakeProvider("p");
  const sender = new EmailSender({ providers: [provider] });
  return { provider, sender };
}

const template = {
  from: { email: "billing@acme.test", name: "Acme Billing" },
  subject: "Invoice {{invoice}} for {{name}}",
  text: "Hi {{name}}, your invoice {{invoice}} is ready.",
  html: "<p>Hi {{name}}, invoice <b>{{invoice}}</b> from {{company}}.</p>",
};

describe("sendBulk", () => {
  it("personalises each message from the recipient list and enqueues them", async () => {
    const { sender, provider } = setup();
    const { recipients } = parseRecipients("email,name,invoice,company\nalice@x.com,Alice,INV-1,Acme\nbob@x.com,Bob,INV-2,Acme\n", "csv");
    const res = await sendBulk(sender, template, recipients, { campaignId: "sept-invoices" });
    expect(res.enqueued).toHaveLength(2);
    expect(res.failed).toHaveLength(0);
    // process the queue
    await sender.processOnce();
    expect(provider.sent).toHaveLength(2);
    const first = provider.sent.find((s) => s.message.to[0]?.email === "alice@x.com")!;
    expect(first.message.subject).toBe("Invoice INV-1 for Alice");
    expect(first.message.text).toContain("invoice INV-1 is ready");
    expect(first.message.html).toContain("<b>INV-1</b>");
  });

  it("uses a per-recipient idempotency key so re-runs do not double-send", async () => {
    const { sender, provider } = setup();
    const { recipients } = parseRecipients("email,name\nalice@x.com,Alice\n", "csv");
    await sendBulk(sender, template, recipients, { campaignId: "c1" });
    const second = await sendBulk(sender, template, recipients, { campaignId: "c1" });
    expect(second.enqueued[0]?.deduplicated).toBe(true);
    await sender.processOnce();
    expect(provider.sent).toHaveLength(1);
  });

  it("applies an optional per-send display name with merge fields", async () => {
    const { sender, provider } = setup();
    const { recipients } = parseRecipients("email,name,rep\nalice@x.com,Alice,Dana\n", "csv");
    await sendBulk(sender, template, recipients, { campaignId: "c2", senderName: "{{rep}} at Acme" });
    await sender.processOnce();
    expect(provider.sent[0]?.message.from).toMatchObject({ email: "billing@acme.test", name: "Dana at Acme" });
  });

  it("HTML-escapes merged values to prevent injection", async () => {
    const { sender, provider } = setup();
    const recipients = [{ email: "eve@x.com", name: "Eve", fields: { company: "<script>alert(1)</script>" } }];
    await sendBulk(sender, template, recipients, { campaignId: "c3" });
    await sender.processOnce();
    expect(provider.sent[0]?.message.html).not.toContain("<script>alert(1)</script>");
    expect(provider.sent[0]?.message.html).toContain("&lt;script&gt;");
  });
});

describe("sendBulk pacing", () => {
  it("waits pauseMs after every batchSize messages", async () => {
    const { sender } = setup();
    const recipients = ["a", "b", "c", "d", "e"].map((n) => ({ email: `${n}@x.com`, fields: {} }));
    const pauses: number[] = [];
    const sleep = async (ms: number) => { pauses.push(ms); };
    await sendBulk(sender, template, recipients, { campaignId: "paced", pacing: { batchSize: 2, pauseMs: 10_000 }, sleep });
    // 5 recipients, pause after #2 and #4 → two 10s pauses.
    expect(pauses).toEqual([10_000, 10_000]);
  });

  it("rejects invalid pacing numbers", async () => {
    const { sender } = setup();
    const recipients = [{ email: "a@x.com", fields: {} }];
    await expect(sendBulk(sender, template, recipients, { campaignId: "c", pacing: { batchSize: 0, pauseMs: 100 } })).rejects.toThrow(/batchSize/);
    await expect(sendBulk(sender, template, recipients, { campaignId: "c", pacing: { batchSize: 2, pauseMs: -1 } })).rejects.toThrow(/pauseMs/);
  });
});
