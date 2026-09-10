import { escapeHtml, safeColor, safeUrl } from "./escape.js";
import {
  DEFAULT_THEME,
  type BulletproofEmailInput,
  type EmailBlock,
  type EmailFooter,
  type EmailTheme,
  type RenderedEmail,
} from "./types.js";

/**
 * Render a "bulletproof" HTML email: markup that renders consistently across
 * the notoriously inconsistent email-client landscape (Outlook 2007-2021 on
 * the Word engine, Gmail's style stripping, Apple Mail, dark mode, etc.).
 *
 * The techniques applied here are the industry-standard defences:
 *   - XHTML 1.0 Transitional doctype and MSO namespaces so Outlook behaves.
 *   - A `role="presentation"` table skeleton (not divs) for layout, because
 *     Outlook's Word engine has no real box model.
 *   - Every visual style is inlined on the element; the `<style>` head block
 *     only carries progressive enhancements (media queries, dark mode) that
 *     stripping clients can safely ignore.
 *   - MSO conditional comments give Outlook fixed pixel widths and VML.
 *   - Buttons are "VML bulletproof buttons": a filled rounded rectangle for
 *     Outlook plus a padded anchor for everyone else, so the whole shape is
 *     clickable and colored even where CSS padding/radius is dropped.
 *   - A hidden preheader controls the inbox preview snippet.
 *   - All caller-supplied text and URLs are escaped/sanitised.
 *
 * The function is dependency-free and safe to run in the browser, so the same
 * code powers the sender and the hosted composer.
 */
export function renderBulletproofEmail(input: BulletproofEmailInput): RenderedEmail {
  const theme = resolveTheme(input.theme);
  const lang = sanitizeToken(input.lang ?? "en", "en");
  const dir = input.dir === "rtl" ? "rtl" : "ltr";
  const width = Math.max(320, Math.min(800, Math.round(theme.width)));
  const title = escapeHtml(input.title ?? input.header?.name ?? "");

  const preheader = input.preheader ? renderPreheader(input.preheader) : "";
  const header = input.header ? renderHeader(input.header, theme, width) : "";
  const body = input.blocks.map((b) => renderBlock(b, theme, width)).join("\n");
  const footer = input.footer ? renderFooter(input.footer, theme) : "";

  const html = buildDocument({ lang, dir, title, theme, width, preheader, header, body, footer });
  const text = renderText(input);
  return { html, text };
}

function resolveTheme(overrides?: Partial<EmailTheme>): EmailTheme {
  const t = { ...DEFAULT_THEME, ...overrides };
  return {
    brandColor: safeColor(t.brandColor, DEFAULT_THEME.brandColor),
    backgroundColor: safeColor(t.backgroundColor, DEFAULT_THEME.backgroundColor),
    cardColor: safeColor(t.cardColor, DEFAULT_THEME.cardColor),
    textColor: safeColor(t.textColor, DEFAULT_THEME.textColor),
    mutedColor: safeColor(t.mutedColor, DEFAULT_THEME.mutedColor),
    buttonTextColor: safeColor(t.buttonTextColor, DEFAULT_THEME.buttonTextColor),
    fontFamily: t.fontFamily,
    width: t.width,
    borderRadius: Math.max(0, Math.min(40, Math.round(t.borderRadius))),
  };
}

// ---------------------------------------------------------------------------
// Document skeleton
// ---------------------------------------------------------------------------

interface DocParts {
  lang: string;
  dir: string;
  title: string;
  theme: EmailTheme;
  width: number;
  preheader: string;
  header: string;
  body: string;
  footer: string;
}

function buildDocument(p: DocParts): string {
  const { theme, width } = p;
  const font = escapeAttr(theme.fontFamily);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="${p.lang}" dir="${p.dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${p.title}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<!--[if mso]>
<style type="text/css">
  table, td, div, p, a { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<style type="text/css">
  html, body { margin: 0 !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
  * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; border-collapse: collapse !important; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  a { text-decoration: none; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  .es-btn a { color: ${theme.buttonTextColor}; }
  @media only screen and (max-width: ${width}px) {
    .es-container { width: 100% !important; }
    .es-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .es-btn a { display: block !important; }
    .es-h1 { font-size: 24px !important; line-height: 30px !important; }
  }
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    body, .es-body { background: #0b0d12 !important; }
    .es-card { background: #1a1d24 !important; }
    .es-text, .es-h1, .es-h2, .es-h3 { color: #e6e8ec !important; }
    .es-muted { color: #9aa1ac !important; }
    .es-divider { border-color: #2b2f38 !important; }
    .es-callout { background: #14171d !important; }
  }
</style>
</head>
<body class="es-body" style="margin:0;padding:0;width:100%;background:${theme.backgroundColor};-webkit-font-smoothing:antialiased;">
${p.preheader}
<div role="article" aria-roledescription="email" aria-label="${p.title}" lang="${p.lang}" dir="${p.dir}" style="background:${theme.backgroundColor};">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${theme.backgroundColor};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" width="${width}" align="center"><tr><td><![endif]-->
<table role="presentation" class="es-container" cellpadding="0" cellspacing="0" width="${width}" style="width:${width}px;max-width:${width}px;margin:0 auto;">
${p.header}
<tr><td class="es-card es-pad" style="background:${theme.cardColor};border-radius:${theme.borderRadius}px;padding:40px;font-family:${font};">
${p.body}
</td></tr>
${p.footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>
</body>
</html>`;
}

/**
 * Hidden preheader. The zero-width-space padding stops the client from
 * pulling body text into the preview after the intended snippet.
 */
function renderPreheader(text: string): string {
  const padding = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(
    text,
  )}${padding}</div>`;
}

function renderHeader(header: BulletproofEmailInput["header"] & object, theme: EmailTheme, width: number): string {
  const font = escapeAttr(theme.fontFamily);
  let inner: string;
  if (header.logoUrl) {
    const w = header.logoWidth ?? 160;
    const img = `<img src="${safeUrl(header.logoUrl)}" alt="${escapeAttr(header.name)}" width="${w}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:${w}px;" />`;
    inner = header.href ? `<a href="${safeUrl(header.href)}" target="_blank">${img}</a>` : img;
  } else {
    const label = `<span style="font-family:${font};font-size:22px;font-weight:700;color:${theme.brandColor};">${escapeHtml(
      header.name,
    )}</span>`;
    inner = header.href ? `<a href="${safeUrl(header.href)}" target="_blank" style="text-decoration:none;">${label}</a>` : label;
  }
  return `<tr><td class="es-pad" align="center" style="padding:8px 40px 24px;">${inner}</td></tr>`;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderBlock(block: EmailBlock, theme: EmailTheme, width: number): string {
  switch (block.type) {
    case "heading":
      return renderHeading(block.text, block.level ?? 1, theme);
    case "text":
      return renderTextBlock(block.text, theme, block.muted ?? false, block.align ?? "left");
    case "html":
      return `<div class="es-text" style="color:${theme.textColor};font-size:16px;line-height:24px;">${block.trustedHtml}</div>`;
    case "button":
      return renderButton(block.text, block.url, theme);
    case "image":
      return renderImage(block, width);
    case "divider":
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:24px 0;"><div class="es-divider" style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr></table>`;
    case "spacer": {
      const h = Math.max(1, Math.min(120, Math.round(block.height ?? 24)));
      return `<div style="line-height:${h}px;height:${h}px;font-size:1px;">&nbsp;</div>`;
    }
    case "callout":
      return renderCallout(block.text, theme);
    default:
      return "";
  }
}

function renderHeading(text: string, level: 1 | 2 | 3, theme: EmailTheme): string {
  const sizes = { 1: [28, 34], 2: [22, 28], 3: [18, 24] } as const;
  const [size, line] = sizes[level];
  const font = escapeAttr(theme.fontFamily);
  return `<h${level} class="es-h${level}" style="margin:0 0 16px;font-family:${font};font-size:${size}px;line-height:${line}px;font-weight:700;color:${theme.textColor};">${inlineFormat(
    text,
    theme,
  )}</h${level}>`;
}

function renderTextBlock(text: string, theme: EmailTheme, muted: boolean, align: string): string {
  const color = muted ? theme.mutedColor : theme.textColor;
  const cls = muted ? "es-muted" : "es-text";
  const a = align === "center" || align === "right" ? align : "left";
  return `<p class="${cls}" style="margin:0 0 16px;font-family:${escapeAttr(
    theme.fontFamily,
  )};font-size:16px;line-height:24px;color:${color};text-align:${a};">${inlineFormat(text, theme)}</p>`;
}

/**
 * VML bulletproof button. Outlook renders the `<v:roundrect>`; every other
 * client hides it (`mso-hide:all` on the fallback is inverted via the
 * conditional) and shows the padded anchor.
 */
function renderButton(text: string, url: string, theme: EmailTheme): string {
  const href = safeUrl(url);
  const label = escapeHtml(text);
  const font = escapeAttr(theme.fontFamily);
  const radius = theme.borderRadius;
  return `<table role="presentation" class="es-btn" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 24px;"><tr><td align="center">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="${Math.round(
    (radius / 24) * 100,
  )}%" strokecolor="${theme.brandColor}" fillcolor="${theme.brandColor}">
<w:anchorlock/>
<center style="color:${theme.buttonTextColor};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${href}" target="_blank" style="background:${theme.brandColor};border-radius:${radius}px;color:${theme.buttonTextColor};display:inline-block;font-family:${font};font-size:16px;font-weight:bold;line-height:48px;text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;mso-hide:all;">${label}</a>
<!--<![endif]-->
</td></tr></table>`;
}

function renderImage(block: Extract<EmailBlock, { type: "image" }>, containerWidth: number): string {
  const w = Math.min(block.width ?? containerWidth - 80, containerWidth);
  const img = `<img src="${safeUrl(block.src)}" alt="${escapeAttr(block.alt)}" width="${w}" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;margin:0 auto;" />`;
  const wrapped = block.href ? `<a href="${safeUrl(block.href)}" target="_blank">${img}</a>` : img;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:8px 0 24px;">${wrapped}</td></tr></table>`;
}

function renderCallout(text: string, theme: EmailTheme): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;"><tr><td class="es-callout" style="background:#f3f4f6;border-left:4px solid ${theme.brandColor};border-radius:4px;padding:16px 20px;font-family:${escapeAttr(
    theme.fontFamily,
  )};font-size:15px;line-height:22px;color:${theme.textColor};">${inlineFormat(text, theme)}</td></tr></table>`;
}

function renderFooter(footer: EmailFooter, theme: EmailTheme): string {
  const font = escapeAttr(theme.fontFamily);
  const parts: string[] = [];
  for (const line of footer.lines ?? []) parts.push(escapeHtml(line));
  if (footer.address) parts.push(escapeHtml(footer.address));
  if (footer.unsubscribeUrl) {
    const label = escapeHtml(footer.unsubscribeText ?? "Unsubscribe");
    parts.push(`<a href="${safeUrl(footer.unsubscribeUrl)}" target="_blank" style="color:${theme.mutedColor};text-decoration:underline;">${label}</a>`);
  }
  if (parts.length === 0) return "";
  return `<tr><td class="es-pad" align="center" style="padding:24px 40px;font-family:${font};font-size:12px;line-height:18px;color:${theme.mutedColor};" class="es-muted">${parts.join(
    "<br />",
  )}</td></tr>`;
}

// ---------------------------------------------------------------------------
// Inline formatting: a tiny, safe subset of Markdown-ish syntax.
// ---------------------------------------------------------------------------

/**
 * Escape the text, then re-enable a safe subset of formatting:
 *   **bold**, *italic*, and [label](https://url) links.
 * Because escaping runs first, any raw HTML in the input is inert; only these
 * patterns are turned back into tags, and link URLs are sanitised.
 */
export function inlineFormat(text: string, theme: EmailTheme): string {
  let out = escapeHtml(text);
  // Links first so the label can contain bold/italic markers.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${safeUrl(url)}" target="_blank" style="color:${theme.brandColor};text-decoration:underline;">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\n/g, "<br />");
  return out;
}

// ---------------------------------------------------------------------------
// Plaintext alternative
// ---------------------------------------------------------------------------

/** Build a readable text/plain part so every client has a sensible fallback. */
export function renderText(input: BulletproofEmailInput): string {
  const lines: string[] = [];
  if (input.preheader) lines.push(input.preheader, "");
  if (input.header?.name) lines.push(input.header.name.toUpperCase(), "");
  for (const block of input.blocks) {
    switch (block.type) {
      case "heading":
        lines.push(stripInline(block.text), "");
        break;
      case "text":
      case "callout":
        lines.push(stripInline(block.text), "");
        break;
      case "button":
        lines.push(`${stripInline(block.text)}: ${block.url}`, "");
        break;
      case "image":
        if (block.href) lines.push(`${block.alt}: ${block.href}`, "");
        else if (block.alt) lines.push(`[${block.alt}]`, "");
        break;
      case "divider":
        lines.push("----------------------------------------", "");
        break;
      case "html":
        // Best-effort: strip tags from trusted HTML.
        lines.push(block.trustedHtml.replace(/<[^>]+>/g, "").trim(), "");
        break;
      case "spacer":
        break;
    }
  }
  const footerLines: string[] = [];
  for (const l of input.footer?.lines ?? []) footerLines.push(l);
  if (input.footer?.address) footerLines.push(input.footer.address);
  if (input.footer?.unsubscribeUrl) footerLines.push(`${input.footer.unsubscribeText ?? "Unsubscribe"}: ${input.footer.unsubscribeUrl}`);
  if (footerLines.length) {
    lines.push("--", ...footerLines);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Remove the inline markdown markers for the plaintext part. */
function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function sanitizeToken(value: string, fallback: string): string {
  return /^[a-z]{2}(-[a-z0-9]{2,8})*$/i.test(value.trim()) ? value.trim() : fallback;
}
