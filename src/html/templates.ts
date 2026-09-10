import { renderBulletproofEmail } from "./render.js";
import type { BulletproofEmailInput, EmailBlock, RenderedEmail } from "./types.js";

export interface SigningInvitationInput {
  /** Name shown to the signer, e.g. "Sam Signer". */
  signerName?: string;
  /** Name of the person/org requesting the signature. */
  senderName: string;
  /** Human title of the document/envelope. */
  documentName: string;
  /** The signing URL the button links to. */
  signUrl: string;
  /** Optional personal message from the sender. */
  message?: string;
  /** ISO date or human string; shown as a deadline callout when present. */
  expiresAt?: string;
  header?: BulletproofEmailInput["header"];
  footer?: BulletproofEmailInput["footer"];
  theme?: BulletproofEmailInput["theme"];
}

/**
 * A ready-made signing-invitation email, the archetypal DocuSign-style
 * transactional message. Returns bulletproof HTML plus a plaintext part,
 * ready to hand to `EmailSender.enqueue`.
 */
export function renderSigningInvitation(input: SigningInvitationInput): RenderedEmail {
  const greeting = input.signerName ? `Hi ${input.signerName},` : "Hello,";
  const blocks: EmailBlock[] = [
    { type: "heading", text: `${input.senderName} has requested your signature` },
    { type: "text", text: greeting },
    {
      type: "text",
      text: `Please review and sign **${input.documentName}**. It only takes a minute, and you can sign from any device.`,
    },
  ];
  if (input.message) blocks.push({ type: "callout", text: input.message });
  blocks.push({ type: "button", text: "Review & Sign Document", url: input.signUrl });
  if (input.expiresAt) {
    blocks.push({ type: "text", text: `This request expires on ${input.expiresAt}.`, muted: true });
  }
  blocks.push({
    type: "text",
    text: "If the button above does not work, copy and paste this link into your browser:",
    muted: true,
  });
  blocks.push({ type: "text", text: `[${input.signUrl}](${input.signUrl})`, muted: true });

  const email: BulletproofEmailInput = {
    preheader: `${input.senderName} has requested your signature on ${input.documentName}.`,
    title: `Signature requested: ${input.documentName}`,
    blocks,
    ...(input.header ? { header: input.header } : { header: { name: input.senderName } }),
    ...(input.footer ? { footer: input.footer } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
  };
  return renderBulletproofEmail(email);
}

export interface SigningCompletedInput {
  signerName?: string;
  documentName: string;
  /** URL to download the completed, signed document. */
  downloadUrl: string;
  completedAt?: string;
  header?: BulletproofEmailInput["header"];
  footer?: BulletproofEmailInput["footer"];
  theme?: BulletproofEmailInput["theme"];
}

/** Receipt sent once every party has signed. */
export function renderSigningCompleted(input: SigningCompletedInput): RenderedEmail {
  const blocks: EmailBlock[] = [
    { type: "heading", text: "Your document is fully signed" },
    { type: "text", text: input.signerName ? `Hi ${input.signerName},` : "Hello," },
    {
      type: "text",
      text: `Good news — **${input.documentName}** has been signed by all parties${
        input.completedAt ? ` on ${input.completedAt}` : ""
      }. A copy is attached, and you can also download it below.`,
    },
    { type: "button", text: "Download Signed Document", url: input.downloadUrl },
  ];
  const email: BulletproofEmailInput = {
    preheader: `${input.documentName} has been completed and signed by all parties.`,
    title: `Completed: ${input.documentName}`,
    blocks,
    ...(input.header ? { header: input.header } : {}),
    ...(input.footer ? { footer: input.footer } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
  };
  return renderBulletproofEmail(email);
}
