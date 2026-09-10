import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  EmailSender,
  FakeProvider,
  escapeHtml,
  inlineFormat,
  renderBulletproofEmail,
  renderSigningCompleted,
  renderSigningInvitation,
  renderText,
  safeColor,
  safeUrl,
  toEmailMessage,
  validateMessage,
  type BulletproofEmailInput,
} from "../src/index.js";

describe("escaping", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });

  it("neutralises dangerous URL schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
    expect(safeUrl("vbscript:msgbox")).toBe("#");
    // obfuscated with control chars / whitespace
    expect(safeUrl("java\tscript:alert(1)")).toBe("#");
    expect(safeUrl("  JavaScript:alert(1)")).toBe("#");
    expect(safeUrl("https://example.com/sign?a=1&b=2")).toBe("https://example.com/sign?a=1&amp;b=2");
    expect(safeUrl("mailto:help@docusigh.com")).toBe("mailto:help@docusigh.com");
    expect(safeUrl("/relative/path")).toBe("/relative/path");
  });

  it("validates colors and falls back on garbage", () => {
    expect(safeColor("#2563eb", "#000")).toBe("#2563eb");
    expect(safeColor("rgb(1,2,3)", "#000")).toBe("rgb(1,2,3)");
    expect(safeColor("red", "#000")).toBe("red");
    expect(safeColor("#zzz; background:url(x)", "#000")).toBe("#000");
    expect(safeColor("</style>", "#111")).toBe("#111");
  });
});

describe("inlineFormat", () => {
  it("supports a safe markdown subset and escapes first", () => {
    const out = inlineFormat("**bold** and *italic* and [link](https://x.com) <b>raw</b>", DEFAULT_THEME);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain("&lt;b&gt;raw&lt;/b&gt;"); // raw HTML inert
  });

  it("sanitises link URLs inside markdown", () => {
    expect(inlineFormat("[click](javascript:alert(1))", DEFAULT_THEME)).toContain('href="#"');
  });
});

const sample = (): BulletproofEmailInput => ({
  preheader: "Please review and sign your document.",
  header: { name: "DocuSigh" },
  blocks: [
    { type: "heading", text: "Sign your document" },
    { type: "text", text: "Hi Sam," },
    { type: "button", text: "Review & Sign", url: "https://docusigh.test/sign/abc" },
  ],
  footer: { lines: ["DocuSigh Inc."], address: "1 Market St, San Francisco, CA", unsubscribeUrl: "https://docusigh.test/u/abc" },
});

describe("renderBulletproofEmail", () => {
  const { html, text } = renderBulletproofEmail(sample());

  it("emits a bulletproof document skeleton", () => {
    expect(html).toContain("<!DOCTYPE html PUBLIC");
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain("x-apple-disable-message-reformatting");
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain('role="presentation"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("includes MSO conditionals for Outlook width and VML button", () => {
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("<v:roundrect");
    expect(html).toContain("<w:anchorlock/>");
    expect(html).toContain("<!--[if !mso]><!-- -->");
  });

  it("renders a hidden preheader with the preview text", () => {
    expect(html).toContain("Please review and sign your document.");
    expect(html).toContain("display:none");
  });

  it("inlines styles on elements (Gmail strips head CSS)", () => {
    expect(html).toMatch(/<p class="es-text" style="[^"]*font-size:16px/);
    expect(html).toMatch(/<h1 class="es-h1" style="[^"]*font-weight:700/);
  });

  it("produces a readable plaintext alternative", () => {
    expect(text).toContain("Sign your document");
    expect(text).toContain("Review & Sign: https://docusigh.test/sign/abc");
    expect(text).toContain("DocuSigh Inc.");
    expect(text).not.toContain("<");
  });

  it("escapes attacker-controlled content", () => {
    const evil = renderBulletproofEmail({
      blocks: [
        { type: "heading", text: '<script>alert(1)</script>' },
        { type: "button", text: "x", url: "javascript:alert(1)" },
        { type: "text", text: '"><img src=x onerror=alert(1)>' },
      ],
      header: { name: '<b>Evil</b>' },
    });
    expect(evil.html).not.toContain("<script>alert(1)</script>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.html).not.toContain("javascript:alert(1)");
    // The img tag is neutralised (escaped), so it cannot execute.
    expect(evil.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(evil.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("clamps and sanitises theme values", () => {
    const out = renderBulletproofEmail({
      blocks: [{ type: "text", text: "hi" }],
      theme: { brandColor: "red; }</style><script>", width: 5000, borderRadius: 999 },
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("width:800px"); // clamped
  });

  it("renders every block type without throwing", () => {
    const out = renderBulletproofEmail({
      blocks: [
        { type: "heading", text: "H", level: 2 },
        { type: "text", text: "T", align: "center" },
        { type: "callout", text: "C" },
        { type: "divider" },
        { type: "spacer", height: 40 },
        { type: "image", src: "https://x.com/a.png", alt: "a", href: "https://x.com" },
        { type: "html", trustedHtml: "<em>ok</em>" },
        { type: "button", text: "B", url: "https://x.com" },
      ],
    });
    expect(out.html).toContain("<em>ok</em>");
    expect(out.html).toContain("es-callout");
    expect(renderText).toBeTypeOf("function");
  });
});

describe("templates", () => {
  it("renders a signing invitation with the sign URL in the button and body", () => {
    const { html, text } = renderSigningInvitation({
      senderName: "Acme Legal",
      signerName: "Sam Signer",
      documentName: "Lease Agreement",
      signUrl: "https://docusigh.test/sign/xyz",
      message: "Looking forward to working with you.",
      expiresAt: "March 1, 2026",
    });
    expect(html).toContain("Acme Legal has requested your signature");
    expect(html).toContain("Review &amp; Sign Document");
    expect(html).toContain("https://docusigh.test/sign/xyz");
    expect(html).toContain("Looking forward to working with you.");
    expect(text).toContain("expires on March 1, 2026");
  });

  it("renders a completion receipt", () => {
    const { html } = renderSigningCompleted({
      documentName: "Lease Agreement",
      downloadUrl: "https://docusigh.test/download/xyz",
    });
    expect(html).toContain("fully signed");
    expect(html).toContain("Download Signed Document");
  });
});

describe("toEmailMessage + sender integration", () => {
  it("produces a message that passes validation and sends", async () => {
    const rendered = renderSigningInvitation({
      senderName: "Acme Legal",
      documentName: "Lease Agreement",
      signUrl: "https://docusigh.test/sign/xyz",
    });
    const message = toEmailMessage(rendered, {
      from: { email: "noreply@docusigh.test", name: "DocuSigh" },
      to: [{ email: "signer@example.com" }],
      subject: "Please sign: Lease Agreement",
      tags: { envelope: "xyz" },
    });
    expect(() => validateMessage(message)).not.toThrow();
    expect(message.html).toContain("<!DOCTYPE html");
    expect(message.text).toBeTruthy();

    const provider = new FakeProvider("p");
    const sender = new EmailSender({ providers: [provider] });
    const record = await sender.send(message);
    expect(record.status).toBe("sent");
    expect(provider.sent[0]?.message.html).toContain("v:roundrect");
  });
});
