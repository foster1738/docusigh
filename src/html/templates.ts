import { blocksFromText } from "./markdown.js";
import { renderBulletproofEmail } from "./render.js";
import type { BulletproofEmailInput, EmailBlock, RenderedEmail } from "./types.js";

export interface SimpleEmailInput {
  /** Optional bold heading at the top of the email. */
  heading?: string;
  /** Optional greeting line, e.g. "Hi Sam,". */
  greeting?: string;
  /**
   * Body copy. Blank lines separate paragraphs; `**bold**`, `*italic*` and
   * `[label](https://url)` are supported, and a lone `[Label](url)` line
   * becomes a button.
   */
  body: string;
  /** Optional call-to-action button rendered after the body. */
  button?: { text: string; url: string };
  /** Inbox preview text; defaults to the heading or the first line of the body. */
  preheader?: string;
  header?: BulletproofEmailInput["header"];
  footer?: BulletproofEmailInput["footer"];
  theme?: BulletproofEmailInput["theme"];
  title?: string;
}

/**
 * A general-purpose transactional/marketing email: an optional heading and
 * greeting, body copy, and an optional call-to-action button, rendered as
 * bulletproof HTML with a plaintext alternative. Suitable for announcements,
 * notifications, receipts, newsletters — any ordinary email.
 */
export function renderSimpleEmail(input: SimpleEmailInput): RenderedEmail {
  const blocks: EmailBlock[] = [];
  if (input.heading) blocks.push({ type: "heading", text: input.heading });
  if (input.greeting) blocks.push({ type: "text", text: input.greeting });
  blocks.push(...blocksFromText(input.body));
  if (input.button) blocks.push({ type: "button", text: input.button.text, url: input.button.url });

  const preheader = input.preheader ?? input.heading ?? firstLine(input.body);
  const email: BulletproofEmailInput = {
    blocks,
    ...(preheader ? { preheader } : {}),
    ...(input.title ? { title: input.title } : input.heading ? { title: input.heading } : {}),
    ...(input.header ? { header: input.header } : {}),
    ...(input.footer ? { footer: input.footer } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
  };
  return renderBulletproofEmail(email);
}

function firstLine(body: string): string {
  const line = body.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.replace(/^#+\s*/, "").slice(0, 150);
}
