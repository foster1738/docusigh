/**
 * Bulk send with AI drafting, CSV/TXT recipients, and mail-merge personalisation.
 *
 *   RECIPIENTS=list.csv ANTHROPIC_API_KEY=... npm run example:bulk
 *
 * With no ANTHROPIC_API_KEY the AI step is skipped and a static template is used.
 */
import { readFileSync } from "node:fs";
import {
  AiDrafter,
  ConsoleProvider,
  EmailSender,
  parseRecipients,
  sendBulk,
  type BulkTemplate,
} from "../src/index.js";

const sender = new EmailSender({ providers: [new ConsoleProvider()] });
sender.start();

const file = process.env.RECIPIENTS ?? "";
const csv = file ? readFileSync(file, "utf8") : "email,name,invoice\nsam@example.com,Sam,INV-1001\n";
const { recipients, skipped } = parseRecipients(csv);
console.log(`Loaded ${recipients.length} recipients (${skipped.length} skipped)`);

// Optional AI drafting step. The body keeps {{merge}} tokens for personalisation.
let subject = "Your invoice {{invoice}}";
let html = "<p>Hi {{name}}, invoice <b>{{invoice}}</b> is attached.</p>";
let text = "Hi {{name}}, invoice {{invoice}} is attached.";
if (process.env.ANTHROPIC_API_KEY) {
  const draft = await new AiDrafter().draft({
    prompt: "A short, friendly note telling the customer their monthly invoice {{invoice}} is ready to view.",
    format: "html",
    senderName: "Acme Billing",
  });
  subject = draft.subject;
  text = draft.text;
  html = draft.html ?? html;
  console.log("AI drafted subject:", subject);
}

const template: BulkTemplate = {
  from: { email: "billing@acme.example", name: "Acme Billing" },
  subject,
  text,
  html,
  priority: "normal",
};

const result = await sendBulk(sender, template, recipients, { campaignId: "2026-09-invoices" });
console.log(`Enqueued ${result.enqueued.length}, failed ${result.failed.length}`);

await new Promise((r) => setTimeout(r, 500));
console.log("stats", await sender.getStats());
await sender.stop();
