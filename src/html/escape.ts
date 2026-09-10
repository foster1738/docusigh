/**
 * HTML/attribute escaping. All caller-supplied strings that land in the
 * email markup pass through here, so an attacker who controls (say) a signer's
 * name cannot inject tags, break out of an attribute, or smuggle in a
 * `javascript:` link.
 */

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text destined for element content or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

/**
 * Sanitise a URL used in an `href`/`src`. Only http, https and mailto are
 * allowed; anything else (notably `javascript:` and `data:`) becomes `#`.
 * The result is additionally HTML-attribute-escaped.
 */
export function safeUrl(url: string): string {
  const trimmed = url.trim();
  // Strip whitespace and control characters that clients ignore but that can
  // be used to hide a scheme, e.g. "java\nscript:alert(1)".
  const cleaned = trimmed.replace(/[\u0000-\u0020\u007f-\u00a0]/g, "");
  if (/^(https?:|mailto:)/i.test(cleaned)) return escapeHtml(cleaned);
  // Any other explicit scheme (javascript:, data:, vbscript:, ...) is unsafe.
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return "#";
  // Scheme-relative or relative URL: keep but escape.
  return escapeHtml(cleaned);
}

/** Validate a CSS color token (`#rgb`, `#rrggbb`, `rgba()`, or a keyword). */
export function safeColor(value: string, fallback: string): string {
  const v = value.trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^rgba?\(\s*[\d.\s,%/]+\)$/i.test(v)) return v;
  if (/^[a-z]{1,20}$/i.test(v)) return v; // named color
  return fallback;
}
